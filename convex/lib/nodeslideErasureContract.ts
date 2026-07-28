/**
 * The erasure contract: which tables hold deck-owned data, derived from the
 * schema at runtime rather than written down.
 *
 * A hand-written table list is a latent data-retention bug. It is correct on
 * the day it is written and silently wrong the first time somebody adds a
 * table, because nothing forces the two edits to happen together. This module
 * makes the schema itself the list: every table in `convex/schema.ts` must
 * either resolve to a deck-owned scope or appear in `NODESLIDE_ERASURE_EXCLUSIONS`
 * with a stated reason. A table that does neither makes the contract throw, so
 * a new table fails loudly at build/test time instead of quietly surviving a
 * "delete everything" request.
 *
 * Nothing here reads or writes rows. It only decides *what* the deletion and
 * the export must cover; `nodeslideRetention.ts` and `nodeslideDataExport.ts`
 * do the work.
 *
 * This module plus `nodeslideDeckRows.ts` and `nodeslideRetention.ts`
 * supersede parity's `convex/lib/nodeslideDeckDeletion.ts` in full, which is
 * why a symbol audit reports four of its exports MISSING:
 *
 *   NODESLIDE_DECK_ERASURE_TABLES -> replaced by `buildNodeSlideErasureContract`
 *     above. It is exactly the hand-written table list this file exists to
 *     eliminate; landing it would restore the bug.
 *   deleteNodeSlideDeckRows -> replaced by `deleteWorkspaceRows` in
 *     `convex/nodeslideRetention.ts`, which walks the derived contract. It also
 *     depends on parity schema fields this repo does not have (`workspaceId`,
 *     `workspaceProjectId`, a `runs` table).
 *
 *   NODESLIDE_DECK_ERASURE_MAX_RECORDS / _MAX_BYTES -> ported, and wired, into
 *     `convex/nodeslideRetention.ts`. This entry previously read "NOT
 *     superseded": `deleteWorkspaceRows` collected with no limit, so the bound
 *     was whatever Convex's own read limits happened to be. It now measures the
 *     whole erasure set against the same 4_000-record / 4 MiB envelope and
 *     refuses before the first write, which is the part that could not be had
 *     by copying the two constants alone.
 */

/** Structural view of `defineSchema(...)`, so a test can pass a fixture schema. */
export interface NodeSlideSchemaTableLike {
  validator: {
    kind: string;
    fields?: Record<string, { kind: string; isOptional?: string; tableName?: string }>;
  };
  indexes: ReadonlyArray<{ indexDescriptor: string; fields: readonly string[] }>;
}

export interface NodeSlideSchemaLike {
  tables: Record<string, NodeSlideSchemaTableLike>;
}

export type NodeSlideErasureScope =
  /** The `nodeslide_decks` row itself, matched on its stable `id`. */
  | { readonly kind: 'deck'; readonly field: 'id'; readonly index: string }
  /** The `projects` shell, reached through `nodeslide_decks.projectRowId`. */
  | { readonly kind: 'project'; readonly field: '_id'; readonly index: null }
  /** Any table carrying a `deckId` string field. */
  | { readonly kind: 'deckScoped'; readonly field: 'deckId'; readonly index: string }
  /** Tenant-wide profile tables, erased only when the project holds one deck. */
  | { readonly kind: 'tenantScoped'; readonly field: 'tenantId'; readonly index: string };

export interface NodeSlideErasureEntry {
  /** Physical table name in `convex/schema.ts`. */
  readonly table: string;
  /** Stable receipt/export key, derived from the table name. */
  readonly label: string;
  readonly scope: NodeSlideErasureScope;
}

/**
 * `derived_scope` is the one reason that does NOT mean "survives the erasure".
 * It means the opposite: the table is erased, but by a hand-written traversal
 * rather than by the schema-derived index scan, because its link to a deck is
 * two hops long and has no column the scan could read. Anything carrying this
 * reason must appear in `NODESLIDE_DERIVED_ERASURE_TABLES` below, and
 * `nodeslideRetention.ts` must sweep every table in that list. The pairing is
 * asserted by a test, so this reason cannot decay into a quiet hole the way a
 * plain omission would.
 */
export type NodeSlideErasureExclusionReason =
  | 'infrastructure_state'
  | 'erasure_receipt'
  | 'derived_scope';

export interface NodeSlideErasureExclusion {
  readonly table: string;
  readonly reason: NodeSlideErasureExclusionReason;
  readonly detail: string;
}

/**
 * The only tables allowed to survive a whole-deck erasure. Each entry is a
 * decision with a reason, not an omission. Adding a table here is a deliberate
 * act; forgetting to classify a table is not possible, because the builder
 * throws on anything it cannot place.
 */
export const NODESLIDE_ERASURE_EXCLUSIONS: readonly NodeSlideErasureExclusion[] = [
  {
    table: 'nodeslide_rate_limits',
    reason: 'infrastructure_state',
    detail:
      'Anti-abuse counters are keyed by an opaque rate key shared across principals and hold no deck content. Deleting them on request would hand every caller a free quota reset.',
  },
  {
    table: 'nodeslide_retention_tombstones',
    reason: 'erasure_receipt',
    detail:
      'Content-free digests that prove the erasure happened. They are what makes a repeated delete idempotent instead of unauthenticated; erasing them would erase the evidence of erasure.',
  },
  {
    table: 'nodeslide_agent_jobs',
    reason: 'derived_scope',
    detail:
      'Holds user data (the failure text, the request digests, the result pointers) and IS erased. It has no required deckId because a create_deck job exists before its deck does; the only honest link is the optional resultDeckId, which the by_result_deck index makes scannable. Swept by the derived pass in nodeslideRetention.ts.',
  },
  {
    table: 'nodeslide_durable_sessions',
    reason: 'derived_scope',
    detail:
      'Session state for a job, keyed by a digest of the job id rather than by deck. Erased through job -> nodeslideStableId("nsession", job.id) -> by_stable_id in the derived pass, because no deckId column exists to scan.',
  },
  {
    table: 'nodeslide_durable_session_events',
    reason: 'derived_scope',
    detail:
      'Hash-chained transition log for a durable session. Reached by (sessionId, jobId) through by_session_job in the derived pass; a deckId column would have to be back-filled from a deck that may never have been created.',
  },
  {
    table: 'nodeslide_durable_job_journal_entries',
    reason: 'derived_scope',
    detail:
      'Per-attempt model and web receipts. Digest-only by construction, but still the author’s activity record, so it is erased through (sessionId, jobId) via by_binding_sequence in the derived pass.',
  },
  {
    table: 'nodeslide_durable_model_result_replays',
    reason: 'derived_scope',
    detail:
      'payloadJson is a stored provider result envelope — the most content-bearing row in this cluster. Erased through (sessionId, jobId) via by_exact_binding in the derived pass; excluding it from erasure rather than from the scan would be the worst possible outcome.',
  },
  {
    table: 'nodeslide_run_budgets',
    reason: 'derived_scope',
    detail:
      'Spend ledger for one job or run, addressed by nodeslide_agent_jobs.budgetId and nodeslide_agent_runs.budgetId. Erased through those pointers in the derived pass; it has no deck column of its own.',
  },
  {
    table: 'nodeslide_billable_calls',
    reason: 'derived_scope',
    detail:
      'Per-call reservations under a run budget. Erased by budgetId through by_budget_status once the owning job or run is resolved to its budget in the derived pass.',
  },
  {
    table: 'nodeslide_budget_events',
    reason: 'derived_scope',
    detail:
      'Immutable accounting chain under a run budget. Erased by budgetId through by_budget_sequence in the derived pass, for the same reason as the calls it explains.',
  },
];

/**
 * The tables that the derived pass in `nodeslideRetention.ts` is required to
 * sweep, in dependency order: jobs first (they resolve every other id), then
 * session state, then the budget ledger.
 *
 * This list exists so the pairing can be checked mechanically. A table excluded
 * with `derived_scope` and absent here is a hole; a table here and absent from
 * the retention sweep is also a hole. Both are test failures, not review notes.
 */
export const NODESLIDE_DERIVED_ERASURE_TABLES = [
  'nodeslide_agent_jobs',
  'nodeslide_durable_sessions',
  'nodeslide_durable_session_events',
  'nodeslide_durable_job_journal_entries',
  'nodeslide_durable_model_result_replays',
  'nodeslide_run_budgets',
  'nodeslide_billable_calls',
  'nodeslide_budget_events',
] as const;

export type NodeSlideDerivedErasureTable = (typeof NODESLIDE_DERIVED_ERASURE_TABLES)[number];

const EXCLUDED_TABLES = new Set(NODESLIDE_ERASURE_EXCLUSIONS.map((entry) => entry.table));

const DECK_TABLE = 'nodeslide_decks';
const PROJECT_TABLE = 'projects';

/** `nodeslide_variation_batches` -> `variationBatches`; the two anchors stay singular. */
export function nodeSlideErasureLabel(table: string): string {
  if (table === DECK_TABLE) return 'deck';
  if (table === PROJECT_TABLE) return 'project';
  return table
    .replace(/^nodeslide_/, '')
    .split('_')
    .map((part, index) => (index === 0 ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join('');
}

function requiredStringField(table: NodeSlideSchemaTableLike, field: string): boolean {
  const spec = table.validator.fields?.[field];
  return spec?.kind === 'string' && spec.isOptional !== 'optional';
}

/**
 * A scan is only safe if an index starts with the scoping field: a table scan
 * would either miss rows under pagination or read the whole deployment.
 */
function leadingIndexFor(table: NodeSlideSchemaTableLike, field: string): string | null {
  for (const index of table.indexes) {
    if (index.fields[0] === field) return index.indexDescriptor;
  }
  return null;
}

export class NodeSlideErasureContractError extends Error {}

/**
 * Derives the full erasure contract from a schema definition.
 *
 * Throws when a table can be neither scoped nor excluded, and when a scoped
 * table has no index on its scoping field. Both are refusals to certify an
 * erasure the code cannot actually perform.
 */
export function buildNodeSlideErasureContract(
  schema: NodeSlideSchemaLike,
): readonly NodeSlideErasureEntry[] {
  const scoped: NodeSlideErasureEntry[] = [];
  let deckEntry: NodeSlideErasureEntry | null = null;
  let projectEntry: NodeSlideErasureEntry | null = null;

  for (const [table, definition] of Object.entries(schema.tables)) {
    if (EXCLUDED_TABLES.has(table)) continue;

    if (table === PROJECT_TABLE) {
      projectEntry = {
        table,
        label: nodeSlideErasureLabel(table),
        scope: { kind: 'project', field: '_id', index: null },
      };
      continue;
    }

    if (table === DECK_TABLE) {
      const index = leadingIndexFor(definition, 'id');
      if (!index) throw indexMissing(table, 'id');
      deckEntry = {
        table,
        label: nodeSlideErasureLabel(table),
        scope: { kind: 'deck', field: 'id', index },
      };
      continue;
    }

    if (requiredStringField(definition, 'deckId')) {
      const index = leadingIndexFor(definition, 'deckId');
      if (!index) throw indexMissing(table, 'deckId');
      scoped.push({
        table,
        label: nodeSlideErasureLabel(table),
        scope: { kind: 'deckScoped', field: 'deckId', index },
      });
      continue;
    }

    if (requiredStringField(definition, 'tenantId')) {
      const index = leadingIndexFor(definition, 'tenantId');
      if (!index) throw indexMissing(table, 'tenantId');
      scoped.push({
        table,
        label: nodeSlideErasureLabel(table),
        scope: { kind: 'tenantScoped', field: 'tenantId', index },
      });
      continue;
    }

    throw new NodeSlideErasureContractError(
      `NodeSlide erasure contract cannot place table "${table}": it has no required deckId or tenantId field and no entry in NODESLIDE_ERASURE_EXCLUSIONS. Classify it or exclude it with a reason before it can hold data.`,
    );
  }

  if (!deckEntry) {
    throw new NodeSlideErasureContractError(
      `NodeSlide erasure contract requires the "${DECK_TABLE}" table.`,
    );
  }
  if (!projectEntry) {
    throw new NodeSlideErasureContractError(
      `NodeSlide erasure contract requires the "${PROJECT_TABLE}" table.`,
    );
  }
  // Children first, then the deck row, then the project shell: the two anchors
  // carry the authorization, so a partially applied delete can never strand
  // rows whose owner check is already gone.
  return [...scoped, deckEntry, projectEntry];
}

/**
 * Fields declared `v.bytes()`. Derived rather than listed so a new blob column
 * is withheld from the export the day it is added, not the day somebody
 * notices the bundle grew by a megabyte of base64.
 */
export function nodeSlideBinaryFields(
  schema: NodeSlideSchemaLike,
  table: string,
): readonly string[] {
  const fields = schema.tables[table]?.validator.fields ?? {};
  return Object.entries(fields)
    .filter(([, spec]) => spec.kind === 'bytes')
    .map(([field]) => field)
    .sort();
}

/**
 * Fields declared `v.id('_storage')`. Deleting such a row erases the pointer,
 * not the bytes: the blob outlives the deck in file storage, unreachable and
 * therefore undeletable by any later pass. Derived rather than listed for the
 * same reason as `nodeSlideBinaryFields` — the day someone adds an upload-like
 * table, its blobs join the erasure without anyone remembering to say so.
 */
export function nodeSlideStorageIdFields(
  schema: NodeSlideSchemaLike,
  table: string,
): readonly string[] {
  const fields = schema.tables[table]?.validator.fields ?? {};
  return Object.entries(fields)
    .filter(([, spec]) => spec.kind === 'id' && spec.tableName === '_storage')
    .map(([field]) => field)
    .sort();
}

function indexMissing(table: string, field: string): NodeSlideErasureContractError {
  return new NodeSlideErasureContractError(
    `NodeSlide erasure contract cannot scan table "${table}" by "${field}": no index starts with that field. Add one; a full table scan is not an acceptable erasure path.`,
  );
}
