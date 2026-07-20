import {
  type NodeSlideJsonValue,
  type NodeSlidePatchCommand,
  type NodeSlideReceipt,
  type NodeSlideReceiptDraft,
  parseNodeSlideAuthorizationEvidence,
} from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot, DeckVersion, ValidationIssue } from '@nodeslide/contracts';
import {
  applyDeckPatch,
  validateNodeSlidePatch,
  validateNodeSlideSnapshot,
} from '@nodeslide/engine';
import { v } from 'convex/values';
import { type DatabaseReader, type DatabaseWriter, mutation, query } from './_generated/server.js';
import {
  type NodeSlideComponentGrant,
  nodeSlideAuthorizationReceiptFromGrant,
  nodeSlideComponentGrantValidator,
} from './protocol.js';

const snapshotValidator = v.any();
const patchValidator = v.any();
const receiptValidator = v.any();

export const initializeDeck = mutation({
  args: { snapshot: snapshotValidator, grant: nodeSlideComponentGrantValidator },
  returns: snapshotValidator,
  handler: async (ctx, args) => {
    const snapshot = clone(args.snapshot as DeckSnapshot);
    assertGrant(args.grant, 'deck.initialize', 'deck', snapshot.deck.id);
    assertValidSnapshot(snapshot, args.grant.authorizedAt);
    if (await deckRow(ctx.db, snapshot.deck.id)) {
      throw new Error(`Deck ${snapshot.deck.id} is already initialized.`);
    }
    await consumeGrant(ctx.db, args.grant);
    await ctx.db.insert('nodeslide_decks', {
      deckId: snapshot.deck.id,
      ownerId: args.grant.principalId,
      ...(args.grant.organizationId === undefined
        ? {}
        : { organizationId: args.grant.organizationId }),
      version: snapshot.deck.version,
      snapshot,
      updatedAt: snapshot.deck.updatedAt,
    });
    await insertVersion(ctx.db, {
      id: `version:${snapshot.deck.id}:${snapshot.deck.version}`,
      deckId: snapshot.deck.id,
      version: snapshot.deck.version,
      label: 'Initial component snapshot',
      source: 'human',
      snapshot,
      createdAt: snapshot.deck.updatedAt,
    });
    return snapshot;
  },
});

export const getDeck = query({
  args: { deckId: v.string(), grant: nodeSlideComponentGrantValidator },
  returns: v.union(v.null(), snapshotValidator),
  handler: async (ctx, args) => {
    assertGrant(args.grant, 'deck.read', 'deck', args.deckId);
    const row = await deckRow(ctx.db, args.deckId);
    return row ? clone(row.snapshot as DeckSnapshot) : null;
  },
});

export const applyPatch = mutation({
  args: { deckId: v.string(), patch: patchValidator, grant: nodeSlideComponentGrantValidator },
  returns: v.any(),
  handler: async (ctx, args) => {
    const command = clone(args.patch as NodeSlidePatchCommand);
    assertGrant(args.grant, 'patch.apply', 'patch', command.id, args.deckId);
    await consumeGrant(ctx.db, args.grant);
    return (await applyCommand(
      ctx.db,
      args.deckId,
      command,
      args.grant,
      'patch.applied',
    )) as unknown;
  },
});

export const createProposal = mutation({
  args: { deckId: v.string(), patch: patchValidator, grant: nodeSlideComponentGrantValidator },
  returns: patchValidator,
  handler: async (ctx, args) => {
    const command = clone(args.patch as NodeSlidePatchCommand);
    assertGrant(args.grant, 'proposal.create', 'patch', command.id, args.deckId);
    const row = await requiredDeckRow(ctx.db, args.deckId);
    assertPatchCanApply(row.snapshot as DeckSnapshot, command, args.grant.authorizedAt);
    const existing = await proposalRow(ctx.db, command.id);
    if (existing) throw new Error(`Proposal ${command.id} already exists.`);
    await consumeGrant(ctx.db, args.grant);
    const proposal = persistedPatch(command, 'ready', args.grant.authorizedAt);
    await ctx.db.insert('nodeslide_proposals', {
      deckId: args.deckId,
      proposalId: proposal.id,
      status: proposal.status,
      patch: proposal,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
    });
    await insertReceipt(ctx.db, receiptFor(proposal, row.version, 'proposal.created', args.grant));
    return proposal;
  },
});

export const resolveProposal = mutation({
  args: {
    deckId: v.string(),
    proposalId: v.string(),
    decision: v.union(v.literal('accept'), v.literal('reject')),
    grant: nodeSlideComponentGrantValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const action = args.decision === 'accept' ? 'proposal.accept' : 'proposal.reject';
    assertGrant(args.grant, action, 'proposal', args.proposalId, args.deckId);
    const proposalDocument = await proposalRow(ctx.db, args.proposalId);
    if (!proposalDocument || proposalDocument.deckId !== args.deckId) {
      throw new Error(`Proposal ${args.proposalId} was not found for deck ${args.deckId}.`);
    }
    if (proposalDocument.status !== 'ready' && proposalDocument.status !== 'draft') {
      throw new Error(`Proposal ${args.proposalId} is already ${proposalDocument.status}.`);
    }
    const row = await requiredDeckRow(ctx.db, args.deckId);
    const proposal = clone(proposalDocument.patch as DeckPatch);
    await consumeGrant(ctx.db, args.grant);
    if (args.decision === 'reject') {
      const rejected = {
        ...proposal,
        status: 'rejected' as const,
        updatedAt: args.grant.authorizedAt,
      };
      await ctx.db.patch(proposalDocument._id, {
        status: rejected.status,
        patch: rejected,
        updatedAt: rejected.updatedAt,
      });
      const receipt = receiptFor(rejected, row.version, 'proposal.rejected', args.grant);
      await insertReceipt(ctx.db, receipt);
      return {
        status: 'rejected' as const,
        patch: rejected,
        snapshot: row.snapshot,
        receipt,
      } as unknown;
    }
    try {
      const accepted = await applyCommand(
        ctx.db,
        args.deckId,
        commandFromPatch(proposal),
        args.grant,
        'proposal.accepted',
      );
      await ctx.db.patch(proposalDocument._id, {
        status: 'accepted',
        patch: accepted.patch,
        updatedAt: args.grant.authorizedAt,
      });
      return {
        status: 'accepted' as const,
        patch: accepted.patch,
        snapshot: accepted.snapshot,
        receipt: accepted.receipt,
      } as unknown;
    } catch (error) {
      if (!isConflict(error)) throw error;
      const stale = { ...proposal, status: 'stale' as const, updatedAt: args.grant.authorizedAt };
      await ctx.db.patch(proposalDocument._id, {
        status: stale.status,
        patch: stale,
        updatedAt: stale.updatedAt,
      });
      const receipt = receiptFor(stale, row.version, 'proposal.stale', args.grant);
      await insertReceipt(ctx.db, receipt);
      return {
        status: 'stale' as const,
        patch: stale,
        snapshot: row.snapshot,
        receipt,
      } as unknown;
    }
  },
});

export const listVersions = query({
  args: {
    deckId: v.string(),
    limit: v.optional(v.number()),
    grant: nodeSlideComponentGrantValidator,
  },
  returns: v.array(v.any()),
  handler: async (ctx, args) => {
    assertGrant(args.grant, 'versions.list', 'deck', args.deckId);
    const limit = args.limit === undefined ? 100 : boundedLimit(args.limit);
    const rows = await ctx.db
      .query('nodeslide_versions')
      .withIndex('by_deck_version', (range) => range.eq('deckId', args.deckId))
      .order('desc')
      .take(limit);
    return rows.map((row) => clone(row.record as DeckVersion));
  },
});

export const storeReceipt = mutation({
  args: { deckId: v.string(), receipt: receiptValidator, grant: nodeSlideComponentGrantValidator },
  returns: receiptValidator,
  handler: async (ctx, args) => {
    const draft = parseReceiptDraft(args.receipt);
    assertGrant(args.grant, 'receipt.store', 'receipt', draft.id, args.deckId);
    if (draft.deckId !== args.deckId)
      throw new Error(`Receipt ${draft.id} belongs to another deck.`);
    await requiredDeckRow(ctx.db, args.deckId);
    await consumeGrant(ctx.db, args.grant);
    const receipt: NodeSlideReceipt = {
      ...draft,
      principalId: args.grant.principalId,
      authorization: nodeSlideAuthorizationReceiptFromGrant(args.grant),
    };
    await insertReceipt(ctx.db, receipt);
    return receipt;
  },
});

export const putAsset = mutation({
  args: {
    deckId: v.string(),
    assetId: v.optional(v.string()),
    kind: v.string(),
    fileName: v.string(),
    contentType: v.string(),
    contentDigest: v.string(),
    bytes: v.bytes(),
    metadata: v.any(),
    grant: nodeSlideComponentGrantValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const assetId = args.assetId ?? `asset:${args.grant.id}`;
    assertGrant(args.grant, 'asset.put', 'asset', assetId, args.deckId);
    await requiredDeckRow(ctx.db, args.deckId);
    if (!/^sha256:[0-9a-f]{64}$/u.test(args.contentDigest)) {
      throw new Error('Asset contentDigest must be a canonical sha256 digest.');
    }
    if (await assetRow(ctx.db, assetId)) throw new Error(`Asset ${assetId} already exists.`);
    await consumeGrant(ctx.db, args.grant);
    const reference = {
      id: assetId,
      deckId: args.deckId,
      kind: args.kind,
      fileName: args.fileName,
      contentType: args.contentType,
      byteSize: args.bytes.byteLength,
      contentDigest: args.contentDigest,
      createdAt: args.grant.authorizedAt,
      metadata: clone(args.metadata as Record<string, NodeSlideJsonValue>),
    };
    await ctx.db.insert('nodeslide_assets', {
      deckId: args.deckId,
      assetId,
      reference,
      bytes: args.bytes,
      createdAt: args.grant.authorizedAt,
    });
    return reference;
  },
});

export const getAsset = query({
  args: { deckId: v.string(), assetId: v.string(), grant: nodeSlideComponentGrantValidator },
  returns: v.union(v.null(), v.any()),
  handler: async (ctx, args) => {
    assertGrant(args.grant, 'asset.get', 'asset', args.assetId, args.deckId);
    const row = await assetRow(ctx.db, args.assetId);
    if (!row || row.deckId !== args.deckId) return null;
    return { reference: clone(row.reference), bytes: row.bytes };
  },
});

export const deleteAsset = mutation({
  args: { deckId: v.string(), assetId: v.string(), grant: nodeSlideComponentGrantValidator },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    assertGrant(args.grant, 'asset.delete', 'asset', args.assetId, args.deckId);
    const row = await assetRow(ctx.db, args.assetId);
    await consumeGrant(ctx.db, args.grant);
    if (!row || row.deckId !== args.deckId) return false;
    await ctx.db.delete(row._id);
    return true;
  },
});

export const applyMigration = mutation({
  args: {
    stepId: v.string(),
    fromVersion: v.number(),
    toVersion: v.number(),
    grant: nodeSlideComponentGrantValidator,
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    assertGrant(args.grant, 'migration.apply', 'migration', args.stepId);
    if (args.toVersion !== args.fromVersion + 1) throw new Error('Migration must be contiguous.');
    const existing = await ctx.db
      .query('nodeslide_migration_receipts')
      .withIndex('by_step_id', (range) => range.eq('stepId', args.stepId))
      .unique();
    if (existing) return clone(existing);
    const receipts = await ctx.db.query('nodeslide_migration_receipts').collect();
    const installedVersion = receipts.reduce(
      (maximum, receipt) => Math.max(maximum, receipt.toVersion),
      0,
    );
    if (installedVersion !== args.fromVersion) {
      throw new Error(`Migration expected version ${args.fromVersion}, found ${installedVersion}.`);
    }
    await consumeGrant(ctx.db, args.grant);
    const id = await ctx.db.insert('nodeslide_migration_receipts', {
      stepId: args.stepId,
      fromVersion: args.fromVersion,
      toVersion: args.toVersion,
      appliedAt: args.grant.authorizedAt,
    });
    return {
      id,
      stepId: args.stepId,
      fromVersion: args.fromVersion,
      toVersion: args.toVersion,
      appliedAt: args.grant.authorizedAt,
    };
  },
});

async function applyCommand(
  db: DatabaseWriter,
  deckId: string,
  command: NodeSlidePatchCommand,
  grant: NodeSlideComponentGrant,
  operation: 'patch.applied' | 'proposal.accepted',
) {
  const row = await requiredDeckRow(db, deckId);
  const current = clone(row.snapshot as DeckSnapshot);
  const applied = assertPatchCanApply(current, command, grant.authorizedAt);
  const patch = persistedPatch(
    command,
    'accepted',
    grant.authorizedAt,
    applied.snapshot.deck.version,
  );
  const receipt = receiptFor(patch, applied.snapshot.deck.version, operation, grant);
  const version: DeckVersion = {
    id: `version:${deckId}:${applied.snapshot.deck.version}`,
    deckId,
    version: applied.snapshot.deck.version,
    label: patch.summary,
    source: patch.source,
    patchId: patch.id,
    snapshot: applied.snapshot,
    createdAt: grant.authorizedAt,
  };
  await db.patch(row._id, {
    version: applied.snapshot.deck.version,
    snapshot: applied.snapshot,
    updatedAt: applied.snapshot.deck.updatedAt,
  });
  await insertVersion(db, version);
  await insertReceipt(db, receipt);
  return {
    patch,
    snapshot: applied.snapshot,
    affectedSlideIds: applied.affectedSlideIds,
    affectedElementIds: applied.affectedElementIds,
    receipt,
  };
}

function assertPatchCanApply(snapshot: DeckSnapshot, command: NodeSlidePatchCommand, now: number) {
  if (command.deckId !== snapshot.deck.id || command.scope.deckId !== snapshot.deck.id) {
    throw new Error(`Patch ${command.id} belongs to another deck.`);
  }
  const patchErrors = validateNodeSlidePatch(snapshot, command);
  if (patchErrors.length > 0) throw new Error(`Invalid patch: ${patchErrors.join(' ')}`);
  let result: ReturnType<typeof applyDeckPatch>;
  try {
    result = applyDeckPatch(snapshot, command, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('Stale patch:')) throw new Error(`CONFLICT: ${message}`);
    throw error;
  }
  for (const slideId of result.affectedSlideIds) {
    const current = snapshot.slides.find((slide) => slide.id === slideId);
    if (current && command.baseSlideVersions[slideId] !== current.version) {
      throw new Error(
        `CONFLICT: slide ${slideId} expected ${String(command.baseSlideVersions[slideId])}, found ${current.version}.`,
      );
    }
  }
  for (const elementId of result.affectedElementIds) {
    const current = snapshot.elements.find((element) => element.id === elementId);
    if (current && command.baseElementVersions[elementId] !== current.version) {
      throw new Error(
        `CONFLICT: element ${elementId} expected ${String(command.baseElementVersions[elementId])}, found ${current.version}.`,
      );
    }
  }
  assertValidSnapshot(result.snapshot, now);
  return result;
}

function assertValidSnapshot(snapshot: DeckSnapshot, checkedAt: number): void {
  const result = validateNodeSlideSnapshot(snapshot, checkedAt);
  if (!result.ok) {
    throw new Error(`Candidate validation failed: ${errorMessages(result.issues).join(' ')}`);
  }
}

function errorMessages(issues: readonly ValidationIssue[]): string[] {
  return issues.filter((issue) => issue.severity === 'error').map((issue) => issue.message);
}

function assertGrant(
  grant: NodeSlideComponentGrant,
  action: NodeSlideComponentGrant['action'],
  resourceKind: NodeSlideComponentGrant['resource']['kind'],
  resourceId: string,
  deckId = grant.deckId,
): void {
  parseNodeSlideAuthorizationEvidence(grant.evidence);
  if (
    grant.action !== action ||
    grant.deckId !== deckId ||
    grant.resource.kind !== resourceKind ||
    grant.resource.id !== resourceId ||
    !bounded(grant.id) ||
    !bounded(grant.principalId) ||
    !Number.isSafeInteger(grant.authorizedAt) ||
    grant.authorizedAt < 0
  ) {
    throw new Error('NodeSlide component authorization grant is not bound to this request.');
  }
}

async function consumeGrant(db: DatabaseWriter, grant: NodeSlideComponentGrant): Promise<void> {
  const existing = await db
    .query('nodeslide_authorization_grants')
    .withIndex('by_grant_id', (range) => range.eq('grantId', grant.id))
    .unique();
  if (existing) throw new Error(`Authorization grant ${grant.id} was already consumed.`);
  await db.insert('nodeslide_authorization_grants', {
    grantId: grant.id,
    deckId: grant.deckId,
    action: grant.action,
    resourceKind: grant.resource.kind,
    resourceId: grant.resource.id,
    principalId: grant.principalId,
    ...(grant.organizationId === undefined ? {} : { organizationId: grant.organizationId }),
    grant: clone(grant),
    consumedAt: grant.authorizedAt,
  });
}

async function deckRow(db: DatabaseReader, deckId: string) {
  return db
    .query('nodeslide_decks')
    .withIndex('by_deck_id', (range) => range.eq('deckId', deckId))
    .unique();
}

async function requiredDeckRow(db: DatabaseReader, deckId: string) {
  const row = await deckRow(db, deckId);
  if (!row) throw new Error(`Deck ${deckId} was not found.`);
  return row;
}

async function proposalRow(db: DatabaseReader, proposalId: string) {
  return db
    .query('nodeslide_proposals')
    .withIndex('by_proposal_id', (range) => range.eq('proposalId', proposalId))
    .unique();
}

async function assetRow(db: DatabaseReader, assetId: string) {
  return db
    .query('nodeslide_assets')
    .withIndex('by_asset_id', (range) => range.eq('assetId', assetId))
    .unique();
}

async function insertVersion(db: DatabaseWriter, version: DeckVersion): Promise<void> {
  const existing = await db
    .query('nodeslide_versions')
    .withIndex('by_deck_version', (range) =>
      range.eq('deckId', version.deckId).eq('version', version.version),
    )
    .unique();
  if (existing)
    throw new Error(`Deck version ${version.deckId}@${version.version} already exists.`);
  await db.insert('nodeslide_versions', {
    deckId: version.deckId,
    version: version.version,
    record: clone(version),
    createdAt: version.createdAt,
  });
}

async function insertReceipt(db: DatabaseWriter, receipt: NodeSlideReceipt): Promise<void> {
  const existing = await db
    .query('nodeslide_receipts')
    .withIndex('by_receipt_id', (range) => range.eq('receiptId', receipt.id))
    .unique();
  if (existing) throw new Error(`Receipt ${receipt.id} already exists.`);
  await db.insert('nodeslide_receipts', {
    deckId: receipt.deckId,
    receiptId: receipt.id,
    receipt: clone(receipt),
    recordedAt: receipt.recordedAt,
  });
}

function receiptFor(
  patch: Pick<DeckPatch, 'id' | 'deckId' | 'source' | 'traceId'>,
  deckVersion: number,
  operation: NodeSlideReceipt['operation'],
  grant: NodeSlideComponentGrant,
): NodeSlideReceipt {
  return {
    id: `receipt:${patch.id}:${deckVersion}:${operation}`,
    deckId: patch.deckId,
    deckVersion,
    operation,
    principalId: grant.principalId,
    patchId: patch.id,
    ...(patch.traceId === undefined ? {} : { traceId: patch.traceId }),
    recordedAt: grant.authorizedAt,
    attributes: { source: patch.source, component: 'nodeslide' },
    authorization: nodeSlideAuthorizationReceiptFromGrant(grant),
  };
}

function persistedPatch(
  command: NodeSlidePatchCommand,
  status: DeckPatch['status'],
  now: number,
  resultingDeckVersion?: number,
): DeckPatch {
  return {
    ...clone(command),
    status,
    ...(resultingDeckVersion === undefined ? {} : { resultingDeckVersion }),
    createdAt: now,
    updatedAt: now,
  };
}

function commandFromPatch(patch: DeckPatch): NodeSlidePatchCommand {
  const {
    status: _status,
    resultingDeckVersion: _resultingDeckVersion,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...command
  } = patch;
  return command;
}

function parseReceiptDraft(value: unknown): NodeSlideReceiptDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Receipt draft must be an object.');
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record['id'] !== 'string' ||
    !record['id'].startsWith('custom-receipt:') ||
    typeof record['deckId'] !== 'string' ||
    record['operation'] !== 'custom' ||
    !Number.isSafeInteger(record['deckVersion']) ||
    !Number.isSafeInteger(record['recordedAt']) ||
    !record['attributes'] ||
    typeof record['attributes'] !== 'object' ||
    Array.isArray(record['attributes']) ||
    'principalId' in record ||
    'authorization' in record
  ) {
    throw new Error('Receipt draft is malformed or contains server-owned fields.');
  }
  return clone(value as NodeSlideReceiptDraft);
}

function boundedLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 500) {
    throw new Error('Version limit must be an integer from 1 through 500.');
  }
  return value;
}

function bounded(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 256 &&
    value === value.trim() &&
    ![...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  );
}

function isConflict(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('CONFLICT:');
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
