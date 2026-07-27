/**
 * Owner data export: one deck, everything the erasure contract would destroy,
 * minus a set of omissions the manifest states out loud.
 *
 * The collection list is the erasure contract, so the export cannot drift away
 * from the deletion. A table added to `convex/schema.ts` with a `deckId` is in
 * the bundle without a change here; a table that cannot be classified stops
 * the contract from building at all.
 */

import {
  NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE,
  NODESLIDE_OWNER_DATA_EXPORT_REDACTION_VERSION,
  NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION,
  type NodeSlideDataExportCollectionManifest,
  type NodeSlideDataExportOmission,
  type NodeSlideDataExportRecord,
  type NodeSlideDataExportValue,
  type NodeSlideOwnerDataExport,
} from '../../shared/nodeslideDataExport';
import type { Doc } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import {
  type NodeSlideStoredRow,
  nodeSlideScopeValue,
  takeNodeSlideScopedRows,
} from './nodeslideDeckRows';
import {
  NODESLIDE_ERASURE_EXCLUSIONS,
  type NodeSlideErasureEntry,
  type NodeSlideSchemaLike,
  nodeSlideBinaryFields,
} from './nodeslideErasureContract';

export const NODESLIDE_DATA_EXPORT_MAX_ROWS_PER_COLLECTION = 1_000;
export const NODESLIDE_DATA_EXPORT_MAX_RECORDS = 8_000;
export const NODESLIDE_DATA_EXPORT_MAX_BYTES = 8 * 1024 * 1024;

const REDACTED = '[REDACTED]';
const OMITTED_BINARY_DATA = '[OMITTED_BINARY_DATA]';

type ExportCtx = Pick<QueryCtx, 'db'>;

interface RedactionState {
  removedFieldCount: number;
  redactedValueCount: number;
  sensitiveValues: string[];
}

/**
 * Field-level omissions, expressed as one predicate rather than a per-table
 * list. A new column named `providerRefreshToken` is withheld the moment it
 * exists; nobody has to remember to add it anywhere.
 */
export function isNodeSlideSensitiveExportField(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (
    [
      'owneraccesskey',
      'shareslug',
      'idempotencykey',
      'ownerdigest',
      'clientsessionid',
      'tokendigest',
    ].includes(normalized)
  ) {
    return true;
  }
  if (
    normalized.includes('ciphertext') ||
    normalized.includes('password') ||
    normalized.includes('passphrase') ||
    normalized.includes('secret') ||
    normalized.includes('credential') ||
    normalized.includes('privatekey') ||
    normalized.includes('apikey') ||
    normalized.includes('accesskey') ||
    normalized.includes('capabilitykey') ||
    normalized.endsWith('capability') ||
    normalized.endsWith('capabilitytoken')
  ) {
    return true;
  }
  if (normalized.endsWith('storageid')) return true;
  if (normalized.endsWith('cleanupdigest') || normalized.endsWith('cleanuptoken')) return true;
  return /^(?:access|refresh|auth|authorization|bearer|oauth|provider)?token(?:ciphertext|value)?$/.test(
    normalized,
  );
}

export interface NodeSlideDataExportInput {
  deck: Doc<'nodeslide_decks'>;
  ownerAccessKey: string;
  generatedAt: number;
  contract: readonly NodeSlideErasureEntry[];
  schema: NodeSlideSchemaLike;
}

/**
 * Reads one complete, deck-bound owner export. Every collection is bounded and
 * the function throws rather than returning a partial bundle: a truncated
 * "your data" archive that does not say it is truncated is a lie with a
 * download button.
 */
export async function collectNodeSlideOwnerDataExport(
  ctx: ExportCtx,
  input: NodeSlideDataExportInput,
): Promise<NodeSlideOwnerDataExport> {
  const { deck, ownerAccessKey, generatedAt, contract, schema } = input;
  const limit = NODESLIDE_DATA_EXPORT_MAX_ROWS_PER_COLLECTION + 1;

  const redaction: RedactionState = {
    removedFieldCount: 0,
    redactedValueCount: 0,
    sensitiveValues: [ownerAccessKey, deck.shareSlug ?? ''].filter((value) => value.length >= 8),
  };

  const included = contract.filter((entry) => entry.scope.kind !== 'tenantScoped');
  const data: NodeSlideOwnerDataExport['data'] = {};
  const collections: NodeSlideDataExportCollectionManifest[] = [];
  const fieldOmissions: NodeSlideDataExportOmission[] = [];

  for (const entry of included) {
    const binaryFields = nodeSlideBinaryFields(schema, entry.table);
    for (const field of binaryFields) {
      fieldOmissions.push({
        name: `${entry.table}.${field}`,
        reason: 'binary_blob_contents',
        detail:
          'Stored bytes are withheld; the row that references them is included so the record is still accounted for.',
      });
    }
    const omittedFields = new Set(binaryFields);

    const rows = await readEntryRows(ctx, entry, deck, limit);
    if (rows.length > NODESLIDE_DATA_EXPORT_MAX_ROWS_PER_COLLECTION) {
      throw new Error(
        `NodeSlide data export has more than ${NODESLIDE_DATA_EXPORT_MAX_ROWS_PER_COLLECTION} ${entry.label} records. No partial bundle was returned.`,
      );
    }
    if (entry.scope.kind === 'deckScoped') assertDeckScopedRows(deck.id, entry.label, rows);

    const records = redactRows(rows, redaction, omittedFields);
    data[entry.label] = records;
    collections.push({ path: entry.label, table: entry.table, recordCount: records.length });
  }

  const recordCount = collections.reduce((total, entry) => total + entry.recordCount, 0);
  if (recordCount > NODESLIDE_DATA_EXPORT_MAX_RECORDS) {
    throw new Error(
      `NodeSlide data export exceeds the complete-export limit of ${NODESLIDE_DATA_EXPORT_MAX_RECORDS} records. No partial bundle was returned.`,
    );
  }

  const bundle: NodeSlideOwnerDataExport = {
    manifest: {
      schemaVersion: NODESLIDE_OWNER_DATA_EXPORT_SCHEMA_VERSION,
      generatedAt,
      mediaType: NODESLIDE_OWNER_DATA_EXPORT_MEDIA_TYPE,
      scope: {
        kind: 'deck_owner_capability',
        deckId: deck.id,
        deckVersion: deck.version,
      },
      completeness: { status: 'complete', truncated: false, recordCount },
      collections,
      omissions: {
        policyVersion: NODESLIDE_OWNER_DATA_EXPORT_REDACTION_VERSION,
        removedFieldCount: redaction.removedFieldCount,
        redactedValueCount: redaction.redactedValueCount,
        collections: collectionOmissions(contract),
        fields: [
          ...fieldOmissions,
          {
            name: 'secret, capability, and storage-id fields',
            reason: 'secret_or_capability',
            detail:
              'Owner access keys, share slugs, owner digests, client session ids, approver token digests, and file storage ids are removed everywhere they appear. Values that merely contain a secret-shaped substring are rewritten to [REDACTED].',
          },
        ],
      },
      determinism: {
        collectionOrder: 'schema_defined',
        recordOrder: 'creation_time_then_stable_id',
        objectKeyOrder: 'lexicographic',
        generatedAt: 'request_time_only_nondeterministic_field',
      },
      retention: {
        serverCopyCreated: false,
        bundlePersistence: 'client_download_only',
        sourceSnapshot: 'retained_records_at_export_time',
        expiredOrPrunedRecords: 'not_recoverable',
      },
      mutationPolicy: 'read_only_no_cas_or_proposal_state_changes',
    },
    data,
  };

  const byteLength = new TextEncoder().encode(JSON.stringify(bundle)).byteLength;
  if (byteLength > NODESLIDE_DATA_EXPORT_MAX_BYTES) {
    throw new Error(
      `NodeSlide data export exceeds the complete-export limit of ${NODESLIDE_DATA_EXPORT_MAX_BYTES} bytes. No partial bundle was returned.`,
    );
  }
  return bundle;
}

async function readEntryRows(
  ctx: ExportCtx,
  entry: NodeSlideErasureEntry,
  deck: Doc<'nodeslide_decks'>,
  limit: number,
): Promise<NodeSlideStoredRow[]> {
  if (entry.scope.kind === 'deck') return [deck as unknown as NodeSlideStoredRow];
  if (entry.scope.kind === 'project') {
    const project = await ctx.db.get(deck.projectRowId);
    return project ? [project as unknown as NodeSlideStoredRow] : [];
  }
  const value = nodeSlideScopeValue(entry, deck);
  if (value === null) return [];
  return await takeNodeSlideScopedRows(ctx, entry, value, limit);
}

/**
 * Names every table the erasure contract knows about but the bundle withholds.
 * Derived from the same contract, so a newly excluded table shows up here
 * without a second edit.
 */
function collectionOmissions(
  contract: readonly NodeSlideErasureEntry[],
): NodeSlideDataExportOmission[] {
  const tenantScoped: NodeSlideDataExportOmission[] = contract
    .filter((entry) => entry.scope.kind === 'tenantScoped')
    .map((entry) => ({
      name: entry.table,
      reason: 'cross_deck_profile' as const,
      detail:
        'Tenant-level profiles can span decks. A single-deck owner capability does not authorize reading them, even though deleting the last deck in the project does erase them.',
    }));
  const infrastructure: NodeSlideDataExportOmission[] = NODESLIDE_ERASURE_EXCLUSIONS.map(
    (exclusion) => ({
      name: exclusion.table,
      reason: exclusion.reason,
      detail: exclusion.detail,
    }),
  );
  return [...tenantScoped, ...infrastructure];
}

function assertDeckScopedRows(
  deckId: string,
  label: string,
  rows: readonly NodeSlideStoredRow[],
): void {
  if (rows.some((row) => row.deckId !== deckId)) {
    throw new Error(
      `NodeSlide data export failed closed: a ${label} row crossed the authorized deck boundary.`,
    );
  }
}

function redactRows(
  rows: readonly NodeSlideStoredRow[],
  state: RedactionState,
  omittedFields: ReadonlySet<string>,
): NodeSlideDataExportRecord[] {
  return [...rows]
    .sort(
      (left, right) =>
        left._creationTime - right._creationTime ||
        String(left.id ?? left._id).localeCompare(String(right.id ?? right._id)),
    )
    .map((row) => {
      const redacted = redactValue(row, state, omittedFields);
      if (!redacted || Array.isArray(redacted) || typeof redacted !== 'object') {
        throw new Error(
          'NodeSlide data export failed closed: a persisted record could not be serialized.',
        );
      }
      return redacted;
    });
}

function redactValue(
  value: unknown,
  state: RedactionState,
  omittedFields: ReadonlySet<string>,
): NodeSlideDataExportValue | undefined {
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return redactString(value, state);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof ArrayBuffer) {
    state.removedFieldCount += 1;
    return OMITTED_BINARY_DATA;
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const redacted = redactValue(item, state, omittedFields);
      return redacted === undefined ? [] : [redacted];
    });
  }
  if (typeof value !== 'object') return undefined;
  const record: NodeSlideDataExportRecord = {};
  for (const [key, item] of Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (key === '_id' || key === '_creationTime' || item === undefined) continue;
    if (omittedFields.has(key) || isNodeSlideSensitiveExportField(key)) {
      state.removedFieldCount += 1;
      continue;
    }
    const redacted = redactValue(item, state, omittedFields);
    if (redacted !== undefined) record[key] = redacted;
  }
  return record;
}

function redactString(value: string, state: RedactionState): string {
  if (/^data:(?:image\/[^;,]+|application\/pdf);base64,/i.test(value)) {
    state.redactedValueCount += 1;
    return OMITTED_BINARY_DATA;
  }
  let redacted = value;
  for (const sensitiveValue of state.sensitiveValues) {
    redacted = redacted.split(sensitiveValue).join(REDACTED);
  }
  redacted = redacted
    .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b(?:sk|rk|pk|api)[-_][A-Za-z0-9_-]{12,}\b/gi, REDACTED)
    .replace(/\b(?:ghp|github_pat|glpat)[-_][A-Za-z0-9_-]{12,}\b/gi, REDACTED)
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, REDACTED)
    .replace(/\bAIza[0-9A-Za-z_-]{30,}\b/g, REDACTED);
  if (redacted !== value) state.redactedValueCount += 1;
  return redacted;
}
