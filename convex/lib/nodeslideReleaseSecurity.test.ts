import { describe, expect, it } from 'vitest';
import type {
  DeckPatch,
  DeckSnapshot,
  NodeSlideWorkspace,
  PatchOperation,
  PublishedNodeSlide,
} from '../../shared/nodeslide';
import type { SignatureProfile } from '../../shared/nodeslideSignature';
import { planSignatureApplication } from '../../shared/nodeslideSignatureApply';
import { financeIbcsTastePack } from '../../src/domains/nodeslide/signature/packs/index';
import type { MutationCtx } from '../_generated/server';
import {
  acceptPatch,
  addComment,
  applyPatch,
  getPresenterSnapshot,
  packageApplyPatch,
  packageCreateProposal,
  packageResolveProposal,
  proposePatch,
  publishDeck,
  rejectPatch,
  replyComment,
  restoreVersion,
  revokePublication,
} from '../nodeslide';
import {
  NODESLIDE_WORKSPACE_LIMITS,
  loadNodeSlideSnapshot,
  loadNodeSlideWorkspace,
} from './nodeslideData';
import { nodeslideIdDigest, nodeslideStableId } from './nodeslideIds';
import { clocksForNodeSlideOperations } from './nodeslidePatches';
import { buildGoldenNodeSlide } from './nodeslideSeed';
import {
  serializeSignatureProfileForStorage,
  signatureProfileRowId,
} from './nodeslideSignatureProfiles';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

const OWNER_ACCESS_KEY = 'a'.repeat(43);
const SECOND_OWNER_ACCESS_KEY = 'b'.repeat(43);
const HISTORY_TABLES = new Set([
  'nodeslide_comments',
  'nodeslide_patches',
  'nodeslide_versions',
  'nodeslide_traces',
  'nodeslide_validations',
  'nodeslide_exports',
]);

type StoredRow = Record<string, unknown> & {
  _id: string;
  _creationTime: number;
};

type Filter = {
  field: string;
  operation: 'eq' | 'gt' | 'lte';
  value: unknown;
};

type Write = {
  kind: 'insert' | 'patch' | 'replace' | 'delete';
  tableName: string;
  value?: unknown;
};

class MemoryIndex {
  readonly filters: Filter[] = [];

  eq(field: string, value: unknown): this {
    this.filters.push({ field, operation: 'eq', value });
    return this;
  }

  gt(field: string, value: unknown): this {
    this.filters.push({ field, operation: 'gt', value });
    return this;
  }

  lte(field: string, value: unknown): this {
    this.filters.push({ field, operation: 'lte', value });
    return this;
  }
}

class MemoryQuery {
  private filters: readonly Filter[] = [];
  private indexName = '';
  private direction: 'asc' | 'desc' = 'asc';

  constructor(
    private readonly database: MemoryDatabase,
    private readonly tableName: string,
  ) {}

  withIndex(indexName: string, configure: (index: MemoryIndex) => unknown): this {
    const index = new MemoryIndex();
    configure(index);
    this.filters = index.filters;
    this.indexName = indexName;
    return this;
  }

  order(direction: 'asc' | 'desc'): this {
    this.direction = direction;
    return this;
  }

  async collect(): Promise<StoredRow[]> {
    this.database.collectCalls.push(this.tableName);
    return this.evaluate();
  }

  async first(): Promise<StoredRow | null> {
    return this.evaluate()[0] ?? null;
  }

  async take(limit: number): Promise<StoredRow[]> {
    this.database.takeCalls.push({ tableName: this.tableName, limit });
    return this.evaluate().slice(0, limit);
  }

  private evaluate(): StoredRow[] {
    const rows = this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => matchesFilter(row[filter.field], filter)));
    const orderField = orderFieldForIndex(this.indexName);
    rows.sort(
      (left, right) =>
        compareValues(left[orderField], right[orderField]) ||
        compareValues(left._creationTime, right._creationTime),
    );
    if (this.direction === 'desc') rows.reverse();
    return rows;
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;
  readonly collectCalls: string[] = [];
  readonly takeCalls: Array<{ tableName: string; limit: number }> = [];
  readonly writes: Write[] = [];

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }

  async insert(tableName: string, value: object): Promise<string> {
    const row = this.seed(tableName, value);
    this.writes.push({
      kind: 'insert',
      tableName,
      value: structuredClone(value),
    });
    return row._id;
  }

  async patch(rowId: string, fields: object): Promise<void> {
    const located = this.findRow(rowId);
    for (const [field, value] of Object.entries(fields)) {
      if (value === undefined) delete located.row[field];
      else located.row[field] = structuredClone(value);
    }
    this.writes.push({
      kind: 'patch',
      tableName: located.tableName,
      value: structuredClone(fields),
    });
  }

  async replace(rowId: string, value: object): Promise<void> {
    const located = this.findRow(rowId);
    const replacement = {
      ...structuredClone(value),
      _id: located.row._id,
      _creationTime: located.row._creationTime,
    } as StoredRow;
    located.rows[located.index] = replacement;
    this.writes.push({
      kind: 'replace',
      tableName: located.tableName,
      value: structuredClone(value),
    });
  }

  async delete(rowId: string): Promise<void> {
    const located = this.findRow(rowId);
    located.rows.splice(located.index, 1);
    this.writes.push({ kind: 'delete', tableName: located.tableName });
  }

  seed(tableName: string, value: object): StoredRow {
    this.sequence += 1;
    const row = {
      ...structuredClone(value),
      _id: `${tableName}:${this.sequence}`,
      _creationTime: this.sequence,
    } as StoredRow;
    const rows = this.tables.get(tableName) ?? [];
    rows.push(row);
    this.tables.set(tableName, rows);
    return row;
  }

  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }

  resetObservations(): void {
    this.collectCalls.length = 0;
    this.takeCalls.length = 0;
    this.writes.length = 0;
  }

  private findRow(rowId: string): {
    tableName: string;
    rows: StoredRow[];
    row: StoredRow;
    index: number;
  } {
    for (const [tableName, rows] of this.tables) {
      const index = rows.findIndex((candidate) => candidate._id === rowId);
      const row = rows[index];
      if (row) return { tableName, rows, row, index };
    }
    throw new Error(`Memory row ${rowId} was not found.`);
  }
}

type RegisteredHandler<Args, Result> = (ctx: MutationCtx, args: Args) => Promise<Result>;

function registeredHandler<Args, Result>(value: unknown): RegisteredHandler<Args, Result> {
  const handler = (value as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Registered Convex handler is unavailable.');
  return handler as RegisteredHandler<Args, Result>;
}

type PatchRequest = {
  id?: string;
  deckId: string;
  ownerAccessKey: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: DeckPatch['scope'];
  operations: PatchOperation[];
  summary?: string;
  profileId?: string;
  profileDigest?: string;
};

const applyPatchHandler = registeredHandler<PatchRequest, { patch: DeckPatch }>(applyPatch);
const acceptPatchHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string; patchId: string },
  { patch: DeckPatch }
>(acceptPatch);
const rejectPatchHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string; patchId: string },
  DeckPatch | null
>(rejectPatch);
const publishDeckHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string },
  PublishedNodeSlide
>(publishDeck);
const revokePublicationHandler = registeredHandler<
  { deckId: string; ownerAccessKey: string },
  { status: string; revokedAt?: number } | null
>(revokePublication);
const presenterHandler = registeredHandler<{ shareSlug: string }, PublishedNodeSlide | null>(
  getPresenterSnapshot,
);
const addCommentHandler = registeredHandler<
  {
    id?: string;
    deckId: string;
    ownerAccessKey: string;
    anchor: { type: 'deck'; deckId: string };
    authorId: string;
    authorName: string;
    text: string;
  },
  unknown
>(addComment);
const replyCommentHandler = registeredHandler<
  {
    id?: string;
    deckId: string;
    ownerAccessKey: string;
    parentId: string;
    authorId: string;
    authorName: string;
    text: string;
  },
  unknown
>(replyComment);
const restoreVersionHandler = registeredHandler<
  {
    deckId: string;
    ownerAccessKey: string;
    versionId: string;
    baseDeckVersion: number;
  },
  { patch: DeckPatch; workspace: NodeSlideWorkspace | null }
>(restoreVersion);
const packageApplyPatchHandler = registeredHandler<
  {
    deckId: string;
    ownerAccessKey: string;
    patch: Omit<PatchRequest, 'ownerAccessKey'> & Record<string, unknown>;
    principal?: unknown;
  },
  {
    status: 'accepted';
    result: {
      patch: DeckPatch;
      receipt: {
        principalId: string;
        attributes: unknown;
        authorization: {
          principalId: string;
          action: string;
          resource: { kind: string; id: string };
          evidence: unknown;
        };
      };
    };
  }
>(packageApplyPatch);
const packageCreateProposalHandler = registeredHandler<
  {
    deckId: string;
    ownerAccessKey: string;
    patch: Omit<PatchRequest, 'ownerAccessKey'>;
  },
  { patch: DeckPatch; receipt: { id: string } }
>(packageCreateProposal);
const packageResolveProposalHandler = registeredHandler<
  {
    deckId: string;
    ownerAccessKey: string;
    proposalId: string;
    decision: 'accept' | 'reject';
  },
  {
    status: 'accepted' | 'rejected' | 'stale';
    patch: DeckPatch;
    snapshot: DeckSnapshot;
    receipt: { id: string; operation: string; recordedAt: number; authorization: unknown };
  }
>(packageResolveProposal);

describe('NodeSlide release security', () => {
  it('derives package receipts from owner capability and ignores forged principal/provenance', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-host', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Package-hosted edit');
    const clocks = clocksForNodeSlideOperations(snapshot, [edit.operation]);

    const response = await packageApplyPatchHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      principal: {
        userId: 'forged:administrator',
        roles: ['administrator'],
        permissions: ['*'],
      },
      patch: {
        id: 'package-host-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocks,
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Package host path',
        source: 'agent',
        traceId: 'forged-trace',
      },
    });

    expect(response.status).toBe('accepted');
    expect(response.result.patch.source).toBe('human');
    expect(response.result.patch.traceId).toBeUndefined();
    expect(response.result.receipt.principalId).toBe(
      `anonymous-owner:${nodeslideIdDigest(OWNER_ACCESS_KEY)}`,
    );
    expect(response.result.receipt.principalId).not.toContain('forged');
    expect(response.result.receipt.attributes).toEqual(
      expect.objectContaining({ governancePath: 'existing_nodeslide_server' }),
    );
    expect(response.result.receipt.authorization).toEqual(
      expect.objectContaining({
        principalId: `anonymous-owner:${nodeslideIdDigest(OWNER_ACCESS_KEY)}`,
        action: 'patch.apply',
        resource: { kind: 'patch', id: 'package-host-patch' },
        evidence: expect.objectContaining({
          issuer: 'nodeslide.convex.capability-host',
          policyId: 'anonymous-owner-capability',
          policyVersion: '1',
        }),
      }),
    );
    expect(JSON.stringify(response.result.receipt.authorization)).not.toContain(OWNER_ACCESS_KEY);
    expect(database.rows('nodeslide_package_receipts')).toHaveLength(1);
    expect(database.rows('nodeslide_versions')).toHaveLength(2);
  });

  it('replays an exact package apply from immutable history and rejects a conflicting command', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-apply-replay', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Idempotent package edit');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-apply-replay-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Idempotent package apply',
      },
    };

    const first = await packageApplyPatchHandler(context, request);
    const afterFirst = await requiredSnapshot(context, snapshot.deck.id);
    expect(first.status).toBe('accepted');
    expect(afterFirst.deck.version).toBe(snapshot.deck.version + 1);
    expect(database.rows('nodeslide_patches')).toHaveLength(1);
    expect(database.rows('nodeslide_versions')).toHaveLength(2);
    expect(database.rows('nodeslide_package_receipts')).toHaveLength(1);

    const laterEdit = textEdit(afterFirst, 'Later independent edit');
    await applyPatchHandler(context, {
      id: 'later-independent-patch',
      deckId: afterFirst.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: afterFirst.deck.version,
      ...clocksForNodeSlideOperations(afterFirst, [laterEdit.operation]),
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Advance after the package apply',
    });
    const afterLaterEdit = await requiredSnapshot(context, snapshot.deck.id);
    expect(afterLaterEdit.deck.version).toBe(snapshot.deck.version + 2);

    database.resetObservations();
    const replay = await packageApplyPatchHandler(context, request);
    expect(replay).toEqual(first);
    expect(database.writes).toEqual([]);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(afterLaterEdit);
    expect(database.rows('nodeslide_patches')).toHaveLength(2);
    expect(database.rows('nodeslide_versions')).toHaveLength(3);
    expect(database.rows('nodeslide_package_receipts')).toHaveLength(1);

    await expect(
      packageApplyPatchHandler(context, {
        ...request,
        patch: { ...request.patch, summary: 'Conflicting package apply' },
      }),
    ).rejects.toThrow(/already bound to a different command/i);
    expect(database.writes).toEqual([]);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(afterLaterEdit);
    expect(database.rows('nodeslide_patches')).toHaveLength(2);
    expect(database.rows('nodeslide_versions')).toHaveLength(3);
    expect(database.rows('nodeslide_package_receipts')).toHaveLength(1);
  });

  it('replays an exact stale package apply without duplicating rows or receipts', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-stale-replay', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Stale package edit');
    const clocks = clocksForNodeSlideOperations(snapshot, [edit.operation]);
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-stale-replay-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        baseSlideVersions: clocks.baseSlideVersions,
        baseElementVersions: clocks.baseElementVersions,
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Stale package apply',
      },
    };

    const firstAdvance = textEdit(snapshot, 'Advance before stale evaluation');
    await applyPatchHandler(context, {
      id: 'before-stale-patch',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [firstAdvance.operation]),
      scope: firstAdvance.scope,
      operations: [firstAdvance.operation],
      summary: 'Advance before stale evaluation',
    });

    const first = await packageApplyPatchHandler(context, request);
    expect(first.status).toBe('stale');
    expect(database.rows('nodeslide_patches')).toHaveLength(2);
    expect(database.rows('nodeslide_versions')).toHaveLength(2);
    expect(database.rows('nodeslide_package_receipts')).toHaveLength(1);

    const afterStale = await requiredSnapshot(context, snapshot.deck.id);
    const laterAdvance = textEdit(afterStale, 'Advance after stale evaluation');
    await applyPatchHandler(context, {
      id: 'after-stale-patch',
      deckId: afterStale.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: afterStale.deck.version,
      ...clocksForNodeSlideOperations(afterStale, [laterAdvance.operation]),
      scope: laterAdvance.scope,
      operations: [laterAdvance.operation],
      summary: 'Advance after stale evaluation',
    });
    const afterLaterAdvance = await requiredSnapshot(context, snapshot.deck.id);

    database.resetObservations();
    const replay = await packageApplyPatchHandler(context, request);
    expect(replay).toEqual(first);
    expect(database.writes).toEqual([]);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(afterLaterAdvance);
    expect(database.rows('nodeslide_patches')).toHaveLength(3);
    expect(database.rows('nodeslide_versions')).toHaveLength(3);
    expect(database.rows('nodeslide_package_receipts')).toHaveLength(1);
  });

  it('replays an exact package proposal and rejects a conflicting command before receipt writes', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-proposal-replay', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Idempotent proposal edit');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-proposal-replay-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Idempotent package proposal',
      },
    };

    const first = await packageCreateProposalHandler(context, request);
    expect(first.patch.status).toBe('ready');
    expect(database.rows('nodeslide_patches')).toHaveLength(1);
    expect(database.rows('nodeslide_versions')).toHaveLength(1);
    expect(database.rows('nodeslide_package_receipts')).toHaveLength(1);

    const interveningEdit = textEdit(snapshot, 'Advance after proposal creation');
    await applyPatchHandler(context, {
      id: 'after-proposal-patch',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [interveningEdit.operation]),
      scope: interveningEdit.scope,
      operations: [interveningEdit.operation],
      summary: 'Advance after proposal creation',
    });

    database.resetObservations();
    const replay = await packageCreateProposalHandler(context, request);
    expect(replay).toEqual(first);
    expect(database.writes).toEqual([]);

    await expect(
      packageCreateProposalHandler(context, {
        ...request,
        patch: { ...request.patch, summary: 'Conflicting package proposal' },
      }),
    ).rejects.toThrow(/already bound to a different command/i);
    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_patches')).toHaveLength(2);
    expect(database.rows('nodeslide_versions')).toHaveLength(2);
    expect(database.rows('nodeslide_package_receipts')).toHaveLength(1);
  });

  it('fails closed when a resolved proposal creation response can no longer be reconstructed', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(
      database,
      'package-resolved-proposal-replay',
      OWNER_ACCESS_KEY,
      '8',
    );
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Resolved proposal edit');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-resolved-proposal-replay-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Resolved package proposal',
      },
    };

    await packageCreateProposalHandler(context, request);
    await acceptPatchHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patchId: request.patch.id,
    });
    const afterAcceptance = await requiredSnapshot(context, snapshot.deck.id);
    database.resetObservations();

    await expect(packageCreateProposalHandler(context, request)).rejects.toThrow(
      /already resolved/i,
    );
    expect(database.writes).toEqual([]);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(afterAcceptance);
    expect(database.rows('nodeslide_patches')).toHaveLength(1);
    expect(database.rows('nodeslide_versions')).toHaveLength(2);
    expect(database.rows('nodeslide_package_receipts')).toHaveLength(1);
  });

  it('replays an immutable accepted proposal result and rejects an opposite decision', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-accept-resolution', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Accepted proposal result');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-accepted-proposal',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Accept exactly once',
      },
    };

    await packageCreateProposalHandler(context, request);
    const first = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    expect(first.status).toBe('accepted');
    expect(first.receipt.operation).toBe('proposal.accepted');

    const laterEdit = textEdit(first.snapshot, 'Later after accepted proposal');
    await applyPatchHandler(context, {
      id: 'after-accepted-proposal',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: first.snapshot.deck.version,
      ...clocksForNodeSlideOperations(first.snapshot, [laterEdit.operation]),
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Advance after accepted proposal',
    });
    const afterLaterEdit = await requiredSnapshot(context, snapshot.deck.id);

    database.resetObservations();
    const replay = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    expect(replay).toEqual(first);
    expect(database.writes).toEqual([]);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(afterLaterEdit);

    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'reject',
      }),
    ).rejects.toThrow(/already resolved as accept/i);
    expect(database.writes).toEqual([]);
  });

  it('replays an immutable rejected proposal result after later deck edits', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-reject-resolution', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Rejected proposal result');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-rejected-proposal',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Reject exactly once',
      },
    };

    await packageCreateProposalHandler(context, request);
    const first = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'reject',
    });
    expect(first.status).toBe('rejected');
    expect(first.receipt.operation).toBe('proposal.rejected');

    const laterEdit = textEdit(snapshot, 'Later after rejected proposal');
    await applyPatchHandler(context, {
      id: 'after-rejected-proposal',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [laterEdit.operation]),
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Advance after rejected proposal',
    });
    const afterLaterEdit = await requiredSnapshot(context, snapshot.deck.id);

    database.resetObservations();
    const replay = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'reject',
    });
    expect(replay).toEqual(first);
    expect(database.writes).toEqual([]);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(afterLaterEdit);

    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'accept',
      }),
    ).rejects.toThrow(/already resolved as reject/i);
    expect(database.writes).toEqual([]);
  });

  it('replays an immutable stale proposal result and fails closed on rejection', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-stale-resolution', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Stale proposal result');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-stale-proposal',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Become stale exactly once',
      },
    };

    await packageCreateProposalHandler(context, request);
    const winner = textEdit(snapshot, 'Winner before stale resolution');
    await applyPatchHandler(context, {
      id: 'before-stale-proposal-resolution',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [winner.operation]),
      scope: winner.scope,
      operations: [winner.operation],
      summary: 'Advance before stale proposal resolution',
    });
    const first = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    expect(first.status).toBe('stale');
    expect(first.receipt.operation).toBe('proposal.stale');

    const laterEdit = textEdit(first.snapshot, 'Later after stale proposal');
    await applyPatchHandler(context, {
      id: 'after-stale-proposal-resolution',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: first.snapshot.deck.version,
      ...clocksForNodeSlideOperations(first.snapshot, [laterEdit.operation]),
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Advance after stale proposal resolution',
    });
    const afterLaterEdit = await requiredSnapshot(context, snapshot.deck.id);

    database.resetObservations();
    const replay = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    expect(replay).toEqual(first);
    expect(database.writes).toEqual([]);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(afterLaterEdit);

    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'reject',
      }),
    ).rejects.toThrow(/already resolved as accept/i);
    expect(database.writes).toEqual([]);
  });

  it('binds package IDs to direct or proposal submission before any resolution writes', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-submission-kind', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const directEdit = textEdit(snapshot, 'Direct kind');
    const directRequest = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-direct-kind',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [directEdit.operation]),
        scope: directEdit.scope,
        operations: [directEdit.operation],
        summary: 'Direct kind binding',
      },
    };
    await packageApplyPatchHandler(context, directRequest);

    database.resetObservations();
    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: directRequest.patch.id,
        decision: 'accept',
      }),
    ).rejects.toThrow(/bound to a direct package submission/i);
    expect(database.writes).toEqual([]);
    expect(
      database
        .rows('nodeslide_package_receipts')
        .some((row) =>
          ['proposal.accepted', 'proposal.rejected', 'proposal.stale'].includes(
            String((row.receipt as { operation?: unknown }).operation),
          ),
        ),
    ).toBe(false);

    const directSubmission = database
      .rows('nodeslide_package_submissions')
      .find((row) => row.patchId === directRequest.patch.id);
    if (!directSubmission) throw new Error('Expected direct submission fixture.');
    await database.delete(directSubmission._id);
    const directReceipt = database
      .rows('nodeslide_package_receipts')
      .find((row) => row.patchId === directRequest.patch.id);
    if (!directReceipt) throw new Error('Expected direct receipt fixture.');
    Reflect.deleteProperty(directReceipt.receipt as Record<string, unknown>, 'authorization');
    database.resetObservations();
    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: directRequest.patch.id,
        decision: 'accept',
      }),
    ).rejects.toThrow(/bound to a direct package submission/i);
    expect(database.writes).toEqual([]);
    expect((directReceipt.receipt as { authorization?: unknown }).authorization).toBeUndefined();

    const afterDirect = await requiredSnapshot(context, snapshot.deck.id);
    const proposalEdit = textEdit(afterDirect, 'Proposal kind');
    const proposalRequest = {
      deckId: afterDirect.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-proposal-kind',
        deckId: afterDirect.deck.id,
        baseDeckVersion: afterDirect.deck.version,
        ...clocksForNodeSlideOperations(afterDirect, [proposalEdit.operation]),
        scope: proposalEdit.scope,
        operations: [proposalEdit.operation],
        summary: 'Proposal kind binding',
      },
    };
    await packageCreateProposalHandler(context, proposalRequest);

    database.resetObservations();
    await expect(packageApplyPatchHandler(context, proposalRequest)).rejects.toThrow(
      /bound to a proposal package submission/i,
    );
    expect(database.writes).toEqual([]);
    expect(onlyStableRow(database, 'nodeslide_patches', proposalRequest.patch.id).status).toBe(
      'ready',
    );

    const proposalSubmission = database
      .rows('nodeslide_package_submissions')
      .find((row) => row.patchId === proposalRequest.patch.id);
    if (!proposalSubmission) throw new Error('Expected proposal submission fixture.');
    await database.delete(proposalSubmission._id);
    const proposalReceipt = database
      .rows('nodeslide_package_receipts')
      .find((row) => row.patchId === proposalRequest.patch.id);
    if (!proposalReceipt) throw new Error('Expected proposal receipt fixture.');
    Reflect.deleteProperty(proposalReceipt.receipt as Record<string, unknown>, 'authorization');
    database.resetObservations();
    await expect(packageApplyPatchHandler(context, proposalRequest)).rejects.toThrow(
      /bound to a proposal package submission/i,
    );
    expect(database.writes).toEqual([]);
    expect((proposalReceipt.receipt as { authorization?: unknown }).authorization).toBeUndefined();
  });

  it('does not resolve a proposal that was already stale when it was created', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-created-stale', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const staleEdit = textEdit(snapshot, 'Created stale');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-created-stale-proposal',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [staleEdit.operation]),
        scope: staleEdit.scope,
        operations: [staleEdit.operation],
        summary: 'Created after its base moved',
      },
    };
    const winner = textEdit(snapshot, 'Move base before proposal creation');
    await applyPatchHandler(context, {
      id: 'before-stale-proposal-creation',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [winner.operation]),
      scope: winner.scope,
      operations: [winner.operation],
      summary: 'Move base before proposal creation',
    });
    const created = await packageCreateProposalHandler(context, request);
    expect(created.patch.status).toBe('stale');
    expect((created.receipt as { authorization?: { action?: string } }).authorization?.action).toBe(
      'proposal.create',
    );

    database.resetObservations();
    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'accept',
      }),
    ).rejects.toThrow(/cannot be resolved from status stale/i);
    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'reject',
      }),
    ).rejects.toThrow(/cannot be resolved from status stale/i);
    expect(database.writes).toEqual([]);
  });

  it('lazily upgrades a legacy direct accepted apply and preserves its historical result', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-legacy-direct', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Legacy direct accepted');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-direct-accepted',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Legacy direct accepted replay',
      },
    };
    const first = await packageApplyPatchHandler(context, request);
    if (first.status !== 'accepted') throw new Error('Expected accepted direct fixture.');

    const laterEdit = textEdit(first.result.snapshot, 'Advance after legacy direct apply');
    await applyPatchHandler(context, {
      id: 'after-legacy-direct-accepted',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: first.result.snapshot.deck.version,
      ...clocksForNodeSlideOperations(first.result.snapshot, [laterEdit.operation]),
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Advance after legacy direct apply',
    });
    const current = await requiredSnapshot(context, snapshot.deck.id);
    await downgradePackagePatchToLegacy(database, request.patch.id);

    const upgraded = await packageApplyPatchHandler(context, request);
    expect(upgraded).toEqual(first);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(current);
    expect(database.rows('nodeslide_package_submissions')).toHaveLength(1);
    expect(database.writes.length).toBeGreaterThan(0);

    database.resetObservations();
    expect(await packageApplyPatchHandler(context, request)).toEqual(first);
    expect(database.writes).toEqual([]);
  });

  it('lazily upgrades a legacy proposal creation receipt without rebasing its response', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-legacy-create', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Legacy proposal creation');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-proposal-created',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Legacy proposal creation replay',
      },
    };
    const first = await packageCreateProposalHandler(context, request);
    const laterEdit = textEdit(snapshot, 'Advance after legacy proposal creation');
    await applyPatchHandler(context, {
      id: 'after-legacy-proposal-created',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [laterEdit.operation]),
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Advance after legacy proposal creation',
    });
    const current = await requiredSnapshot(context, snapshot.deck.id);
    await downgradePackagePatchToLegacy(database, request.patch.id);

    const upgraded = await packageCreateProposalHandler(context, request);
    expect(upgraded).toEqual(first);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(current);
    expect(database.writes.length).toBeGreaterThan(0);

    database.resetObservations();
    expect(await packageCreateProposalHandler(context, request)).toEqual(first);
    expect(database.writes).toEqual([]);
  });

  it('lazily upgrades a legacy accepted proposal resolution and freezes its version', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-legacy-accept', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Legacy accepted proposal');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-proposal-accepted',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Legacy accepted proposal replay',
      },
    };
    await packageCreateProposalHandler(context, request);
    const first = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    if (first.status !== 'accepted') throw new Error('Expected accepted proposal fixture.');
    const laterEdit = textEdit(first.snapshot, 'Advance after legacy accepted proposal');
    await applyPatchHandler(context, {
      id: 'after-legacy-proposal-accepted',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: first.snapshot.deck.version,
      ...clocksForNodeSlideOperations(first.snapshot, [laterEdit.operation]),
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Advance after legacy accepted proposal',
    });
    const current = await requiredSnapshot(context, snapshot.deck.id);
    await downgradePackagePatchToLegacy(database, request.patch.id);

    const upgraded = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    expect(upgraded).toEqual(first);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(current);
    expect(database.writes.length).toBeGreaterThan(0);

    database.resetObservations();
    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'reject',
      }),
    ).rejects.toThrow(/already resolved as accept/i);
    expect(database.writes).toEqual([]);
    expect(
      await packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'accept',
      }),
    ).toEqual(first);
    expect(database.writes).toEqual([]);
  });

  it('lazily upgrades a legacy rejected proposal resolution and freezes its version', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-legacy-reject', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Legacy rejected proposal');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-proposal-rejected',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Legacy rejected proposal replay',
      },
    };
    await packageCreateProposalHandler(context, request);
    const first = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'reject',
    });
    if (first.status !== 'rejected') throw new Error('Expected rejected proposal fixture.');
    const laterEdit = textEdit(snapshot, 'Advance after legacy rejected proposal');
    await applyPatchHandler(context, {
      id: 'after-legacy-proposal-rejected',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [laterEdit.operation]),
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Advance after legacy rejected proposal',
    });
    const current = await requiredSnapshot(context, snapshot.deck.id);
    await downgradePackagePatchToLegacy(database, request.patch.id);

    const upgraded = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'reject',
    });
    expect(upgraded).toEqual(first);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(current);
    expect(database.writes.length).toBeGreaterThan(0);

    database.resetObservations();
    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'accept',
      }),
    ).rejects.toThrow(/already resolved as reject/i);
    expect(database.writes).toEqual([]);
    expect(
      await packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'reject',
      }),
    ).toEqual(first);
    expect(database.writes).toEqual([]);
  });

  it('fails closed without writes when a legacy receipt binding is malformed', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-malformed-legacy', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Malformed legacy receipt');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-malformed-legacy-receipt',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Malformed legacy receipt fails closed',
      },
    };
    await packageApplyPatchHandler(context, request);
    await downgradePackagePatchToLegacy(database, request.patch.id);
    const receiptRow = database
      .rows('nodeslide_package_receipts')
      .find((row) => row.patchId === request.patch.id);
    if (!receiptRow) throw new Error('Expected malformed receipt fixture.');
    (receiptRow.receipt as { principalId: string }).principalId = 'forged:principal';
    database.resetObservations();

    await expect(packageApplyPatchHandler(context, request)).rejects.toThrow(
      /does not match its stored binding/i,
    );
    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_package_submissions')).toEqual([]);
  });

  it('fails closed before writes when legacy proposal receipts contain opposite terminal decisions', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(
      database,
      'package-legacy-conflicting-resolution',
      OWNER_ACCESS_KEY,
      '8',
    );
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Legacy conflicting proposal');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-conflicting-proposal',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Legacy contradictory terminal history',
      },
    };
    await packageCreateProposalHandler(context, request);
    const winner = textEdit(snapshot, 'Advance before contradictory stale result');
    await applyPatchHandler(context, {
      id: 'before-legacy-conflicting-resolution',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [winner.operation]),
      scope: winner.scope,
      operations: [winner.operation],
      summary: 'Make the legacy proposal stale',
    });
    const stale = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    expect(stale.status).toBe('stale');
    const rejected = await rejectPatchHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patchId: request.patch.id,
    });
    if (!rejected) throw new Error('Expected rejected legacy proposal fixture.');
    const rejectedReceipt = {
      ...structuredClone(stale.receipt),
      id: nodeslideStableId(
        'repository_receipt',
        snapshot.deck.id,
        request.patch.id,
        'proposal.rejected',
        String(stale.snapshot.deck.version),
      ),
      operation: 'proposal.rejected' as const,
      recordedAt: rejected.updatedAt,
      attributes: {
        ...structuredClone(stale.receipt.attributes),
        status: 'rejected',
      },
    };
    Reflect.deleteProperty(rejectedReceipt, 'authorization');
    database.seed('nodeslide_package_receipts', {
      receiptId: rejectedReceipt.id,
      deckId: snapshot.deck.id,
      patchId: request.patch.id,
      principalId: rejectedReceipt.principalId,
      receipt: rejectedReceipt,
      recordedAt: rejectedReceipt.recordedAt,
    });
    await downgradePackagePatchToLegacy(database, request.patch.id);

    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'reject',
      }),
    ).rejects.toThrow(/conflicting terminal package receipts/i);
    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_package_submissions')).toEqual([]);
  });

  it('rejects a self-consistent but noncanonical legacy receipt ID without writes', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(
      database,
      'package-legacy-noncanonical-receipt',
      OWNER_ACCESS_KEY,
      '8',
    );
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Noncanonical receipt ID');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-noncanonical-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Reject noncanonical legacy receipt ID',
      },
    };
    await packageApplyPatchHandler(context, request);
    await downgradePackagePatchToLegacy(database, request.patch.id);
    const receiptRow = database
      .rows('nodeslide_package_receipts')
      .find((row) => row.patchId === request.patch.id);
    if (!receiptRow) throw new Error('Expected noncanonical receipt fixture.');
    receiptRow.receiptId = 'legacy-noncanonical-receipt-id';
    (receiptRow.receipt as { id: string }).id = receiptRow.receiptId;
    database.resetObservations();

    await expect(packageApplyPatchHandler(context, request)).rejects.toThrow(
      /canonical stable ID/i,
    );
    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_package_submissions')).toEqual([]);
  });

  it('rejects duplicate canonical legacy receipt rows without writes', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(
      database,
      'package-legacy-duplicate-receipt',
      OWNER_ACCESS_KEY,
      '8',
    );
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Duplicate canonical receipt');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-duplicate-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Reject duplicate legacy receipt rows',
      },
    };
    await packageApplyPatchHandler(context, request);
    await downgradePackagePatchToLegacy(database, request.patch.id);
    const receiptRow = database
      .rows('nodeslide_package_receipts')
      .find((row) => row.patchId === request.patch.id);
    if (!receiptRow) throw new Error('Expected duplicate receipt fixture.');
    database.seed('nodeslide_package_receipts', {
      receiptId: receiptRow.receiptId,
      deckId: receiptRow.deckId,
      patchId: receiptRow.patchId,
      principalId: receiptRow.principalId,
      receipt: structuredClone(receiptRow.receipt),
      recordedAt: receiptRow.recordedAt,
    });
    database.resetObservations();

    await expect(packageApplyPatchHandler(context, request)).rejects.toThrow(
      /receipt ID collision/i,
    );
    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_package_submissions')).toEqual([]);
  });

  it('preflights every legacy receipt before upgrading a resolved proposal', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(
      database,
      'package-legacy-semantic-duplicate-receipt',
      OWNER_ACCESS_KEY,
      '8',
    );
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Semantic duplicate terminal receipt');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-semantic-duplicate-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Preflight all legacy terminal receipts',
      },
    };
    await packageCreateProposalHandler(context, request);
    await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    await downgradePackagePatchToLegacy(database, request.patch.id);
    const terminalRow = database
      .rows('nodeslide_package_receipts')
      .find(
        (row) =>
          row.patchId === request.patch.id &&
          (row.receipt as { operation?: unknown }).operation === 'proposal.accepted',
      );
    if (!terminalRow) throw new Error('Expected terminal receipt fixture.');
    const duplicateReceipt = structuredClone(terminalRow.receipt) as Record<string, unknown>;
    duplicateReceipt.id = 'noncanonical-semantic-terminal-receipt';
    database.seed('nodeslide_package_receipts', {
      receiptId: duplicateReceipt.id,
      deckId: terminalRow.deckId,
      patchId: terminalRow.patchId,
      principalId: terminalRow.principalId,
      receipt: duplicateReceipt,
      recordedAt: terminalRow.recordedAt,
    });
    database.resetObservations();

    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'accept',
      }),
    ).rejects.toThrow(/canonical stable ID/i);
    expect(database.writes).toEqual([]);
    expect(database.rows('nodeslide_package_submissions')).toEqual([]);
    expect(
      database
        .rows('nodeslide_package_receipts')
        .filter((row) => row.patchId === request.patch.id)
        .every((row) => (row.receipt as { authorization?: unknown }).authorization === undefined),
    ).toBe(true);
  });

  it('rejects noncanonical and duplicate package submission coordinates before writes', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(
      database,
      'package-submission-coordinate-collision',
      OWNER_ACCESS_KEY,
      '8',
    );
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Submission coordinate collision');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-submission-coordinate-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Reject invalid submission coordinates',
      },
    };
    await packageApplyPatchHandler(context, request);
    const submission = database
      .rows('nodeslide_package_submissions')
      .find((row) => row.patchId === request.patch.id);
    if (!submission) throw new Error('Expected package submission fixture.');
    const canonicalSubmissionId = String(submission.submissionId);
    submission.submissionId = 'noncanonical-package-submission';
    const originRow = database
      .rows('nodeslide_package_receipts')
      .find((row) => row.patchId === request.patch.id);
    if (!originRow) throw new Error('Expected package origin receipt fixture.');
    Reflect.deleteProperty(originRow.receipt as Record<string, unknown>, 'authorization');
    database.resetObservations();

    await expect(packageApplyPatchHandler(context, request)).rejects.toThrow(
      /noncanonical package submission binding/i,
    );
    expect(database.writes).toEqual([]);
    expect((originRow.receipt as { authorization?: unknown }).authorization).toBeUndefined();

    submission.submissionId = canonicalSubmissionId;
    const { _id, _creationTime, ...duplicateSubmission } = submission;
    database.seed('nodeslide_package_submissions', {
      ...structuredClone(duplicateSubmission),
      submissionId: 'duplicate-package-submission-coordinate',
    });
    database.resetObservations();

    await expect(packageApplyPatchHandler(context, request)).rejects.toThrow(
      /duplicate package submission bindings/i,
    );
    expect(database.writes).toEqual([]);
    expect((originRow.receipt as { authorization?: unknown }).authorization).toBeUndefined();
  });

  it('rejects a canonical package submission ID stored under a conflicting envelope', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(
      database,
      'package-submission-envelope-collision',
      OWNER_ACCESS_KEY,
      '8',
    );
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Submission envelope collision');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-submission-envelope-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Reject a stable ID bound to another envelope',
      },
    };
    await packageApplyPatchHandler(context, request);
    const submission = database
      .rows('nodeslide_package_submissions')
      .find((row) => row.patchId === request.patch.id);
    if (!submission) throw new Error('Expected package submission fixture.');
    submission.deckId = 'forged-deck-envelope';
    submission.patchId = 'forged-patch-envelope';
    const originRow = database
      .rows('nodeslide_package_receipts')
      .find((row) => row.patchId === request.patch.id);
    if (!originRow) throw new Error('Expected package origin receipt fixture.');
    Reflect.deleteProperty(originRow.receipt as Record<string, unknown>, 'authorization');
    database.resetObservations();

    await expect(packageApplyPatchHandler(context, request)).rejects.toThrow(
      /conflicting package submission envelope/i,
    );
    expect(database.writes).toEqual([]);
    expect((originRow.receipt as { authorization?: unknown }).authorization).toBeUndefined();
    expect(database.rows('nodeslide_package_submissions')).toHaveLength(1);
  });

  it('rejects direct and unresolved proposal replays with a mismatched origin deck version', async () => {
    const cases = [
      { kind: 'direct' as const, suffix: 'direct' },
      { kind: 'proposal' as const, suffix: 'proposal' },
    ];

    for (const testCase of cases) {
      const database = new MemoryDatabase();
      const fixture = seedWorkspace(
        database,
        `package-origin-version-${testCase.suffix}`,
        OWNER_ACCESS_KEY,
        '8',
      );
      const context = { db: database } as unknown as MutationCtx;
      const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
      const edit = textEdit(snapshot, `Origin version ${testCase.suffix}`);
      const request = {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        patch: {
          id: `package-origin-version-patch-${testCase.suffix}`,
          deckId: snapshot.deck.id,
          baseDeckVersion: snapshot.deck.version,
          ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
          scope: edit.scope,
          operations: [edit.operation],
          summary: `Reject mismatched ${testCase.suffix} origin version`,
        },
      };
      if (testCase.kind === 'direct') await packageApplyPatchHandler(context, request);
      else await packageCreateProposalHandler(context, request);

      const submission = database
        .rows('nodeslide_package_submissions')
        .find((row) => row.patchId === request.patch.id);
      const originRow = database
        .rows('nodeslide_package_receipts')
        .find((row) => row.patchId === request.patch.id);
      if (!submission || !originRow) throw new Error('Expected package submission fixture.');
      const receipt = originRow.receipt as Record<string, unknown>;
      const operation = String(receipt.operation);
      const wrongDeckVersion = Number(receipt.deckVersion) + 7;
      const wrongReceiptId = nodeslideStableId(
        'repository_receipt',
        request.deckId,
        request.patch.id,
        operation,
        String(wrongDeckVersion),
      );
      receipt.id = wrongReceiptId;
      receipt.deckVersion = wrongDeckVersion;
      Reflect.deleteProperty(receipt, 'authorization');
      originRow.receiptId = wrongReceiptId;
      submission.originReceiptId = wrongReceiptId;
      database.resetObservations();

      const replay =
        testCase.kind === 'direct'
          ? packageApplyPatchHandler(context, request)
          : packageCreateProposalHandler(context, request);
      await expect(replay).rejects.toThrow(/conflicting package origin deck version/i);
      expect(database.writes).toEqual([]);
      expect((originRow.receipt as { authorization?: unknown }).authorization).toBeUndefined();
    }
  });

  it('rejects an accepted proposal replay whose immutable version misses its candidate digest', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(
      database,
      'package-proposal-digest-replay',
      OWNER_ACCESS_KEY,
      '8',
    );
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Accepted digest-bound proposal');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-proposal-digest-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Digest-bound proposal replay',
      },
    };
    await packageCreateProposalHandler(context, request);
    await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    const versionRow = database
      .rows('nodeslide_versions')
      .find((row) => row.patchId === request.patch.id);
    if (!versionRow) throw new Error('Expected accepted proposal version fixture.');
    const corrupted = structuredClone(versionRow.snapshot as DeckSnapshot);
    const firstElement = corrupted.elements[0];
    if (!firstElement) throw new Error('Expected an element to corrupt.');
    corrupted.elements[0] = { ...firstElement, content: 'Corrupted immutable proposal version' };
    versionRow.snapshot = corrupted;
    database.resetObservations();

    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'accept',
      }),
    ).rejects.toThrow(/immutable candidate digest/i);
    expect(database.writes).toEqual([]);
  });

  it('lazily upgrades a legacy direct-stale apply and replays the original result', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-legacy-direct-stale', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Legacy direct stale');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-direct-stale-patch',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Legacy direct stale replay',
      },
    };
    const winner = textEdit(snapshot, 'Advance before legacy direct stale');
    await applyPatchHandler(context, {
      id: 'before-legacy-direct-stale',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [winner.operation]),
      scope: winner.scope,
      operations: [winner.operation],
      summary: 'Make direct package patch stale',
    });
    const first = await packageApplyPatchHandler(context, request);
    expect(first.status).toBe('stale');
    const laterEdit = textEdit(first.snapshot, 'Advance after legacy direct stale');
    await applyPatchHandler(context, {
      id: 'after-legacy-direct-stale',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: first.snapshot.deck.version,
      ...clocksForNodeSlideOperations(first.snapshot, [laterEdit.operation]),
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Advance after legacy direct stale',
    });
    const current = await requiredSnapshot(context, snapshot.deck.id);
    await downgradePackagePatchToLegacy(database, request.patch.id);
    const patchRow = onlyStableRow(database, 'nodeslide_patches', request.patch.id);
    Reflect.deleteProperty(patchRow, 'resultingDeckVersion');
    database.resetObservations();

    expect(await packageApplyPatchHandler(context, request)).toEqual(first);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(current);
    expect(database.writes.length).toBeGreaterThan(0);
    database.resetObservations();
    expect(await packageApplyPatchHandler(context, request)).toEqual(first);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(current);
    expect(database.writes).toEqual([]);
  });

  it('lazily upgrades a proposal that was stale at creation without making it resolvable', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-legacy-created-stale', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Legacy stale-at-creation proposal');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-created-stale-proposal',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [edit.operation]),
        scope: edit.scope,
        operations: [edit.operation],
        summary: 'Legacy stale proposal creation replay',
      },
    };
    const winner = textEdit(snapshot, 'Advance before legacy stale creation');
    await applyPatchHandler(context, {
      id: 'before-legacy-stale-creation',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [winner.operation]),
      scope: winner.scope,
      operations: [winner.operation],
      summary: 'Make proposal stale before creation',
    });
    const first = await packageCreateProposalHandler(context, request);
    expect(first.patch.status).toBe('stale');
    await downgradePackagePatchToLegacy(database, request.patch.id);
    const patchRow = onlyStableRow(database, 'nodeslide_patches', request.patch.id);
    Reflect.deleteProperty(patchRow, 'resultingDeckVersion');

    expect(await packageCreateProposalHandler(context, request)).toEqual(first);
    expect(database.writes.length).toBeGreaterThan(0);
    database.resetObservations();
    expect(await packageCreateProposalHandler(context, request)).toEqual(first);
    expect(database.writes).toEqual([]);
    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'accept',
      }),
    ).rejects.toThrow(/cannot be resolved from status stale/i);
    expect(database.writes).toEqual([]);
  });

  it('lazily upgrades legacy unauthenticated receipts and stale version rows for exact replay', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'package-legacy-stale', OWNER_ACCESS_KEY, '8');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const staleEdit = textEdit(snapshot, 'Legacy stale proposal');
    const request = {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patch: {
        id: 'package-legacy-stale-proposal',
        deckId: snapshot.deck.id,
        baseDeckVersion: snapshot.deck.version,
        ...clocksForNodeSlideOperations(snapshot, [staleEdit.operation]),
        scope: staleEdit.scope,
        operations: [staleEdit.operation],
        summary: 'Legacy stale proposal replay',
      },
    };
    await packageCreateProposalHandler(context, request);
    const winner = textEdit(snapshot, 'Win before legacy stale result');
    await applyPatchHandler(context, {
      id: 'before-legacy-stale-resolution',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocksForNodeSlideOperations(snapshot, [winner.operation]),
      scope: winner.scope,
      operations: [winner.operation],
      summary: 'Win before legacy stale result',
    });
    const first = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    expect(first.status).toBe('stale');

    const laterEdit = textEdit(first.snapshot, 'Advance after legacy stale result');
    await applyPatchHandler(context, {
      id: 'after-legacy-stale-resolution',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: first.snapshot.deck.version,
      ...clocksForNodeSlideOperations(first.snapshot, [laterEdit.operation]),
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Advance after legacy stale result',
    });
    const current = await requiredSnapshot(context, snapshot.deck.id);

    const submission = database.rows('nodeslide_package_submissions')[0];
    if (!submission) throw new Error('Expected package submission fixture.');
    await database.delete(submission._id);
    const patchRow = onlyStableRow(database, 'nodeslide_patches', request.patch.id);
    Reflect.deleteProperty(patchRow, 'resultingDeckVersion');
    for (const row of database.rows('nodeslide_package_receipts')) {
      if (row.patchId !== request.patch.id) continue;
      const receipt = row.receipt as Record<string, unknown>;
      Reflect.deleteProperty(receipt, 'authorization');
    }

    database.resetObservations();
    const upgraded = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    expect(upgraded).toEqual(first);
    expect(await requiredSnapshot(context, snapshot.deck.id)).toEqual(current);
    expect(
      onlyStableRow(database, 'nodeslide_patches', request.patch.id).resultingDeckVersion,
    ).toBe(first.snapshot.deck.version);
    expect(database.rows('nodeslide_package_submissions')).toHaveLength(1);
    expect(
      database
        .rows('nodeslide_package_receipts')
        .filter((row) => row.patchId === request.patch.id)
        .every((row) => Boolean((row.receipt as { authorization?: unknown }).authorization)),
    ).toBe(true);

    database.resetObservations();
    const replay = await packageResolveProposalHandler(context, {
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      proposalId: request.patch.id,
      decision: 'accept',
    });
    expect(replay).toEqual(first);
    expect(database.writes).toEqual([]);
    await expect(
      packageResolveProposalHandler(context, {
        deckId: snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        proposalId: request.patch.id,
        decision: 'reject',
      }),
    ).rejects.toThrow(/already resolved as accept/i);
    expect(database.writes).toEqual([]);
  });

  it('removes public provenance arguments and forces direct human mutations to human', async () => {
    expect(publicArgNames(applyPatch)).not.toContain('source');
    expect(publicArgNames(applyPatch)).not.toContain('traceId');
    expect(publicArgNames(proposePatch)).not.toContain('source');
    expect(publicArgNames(proposePatch)).not.toContain('traceId');
    expect(publicArgNames(applyPatch)).toEqual(
      expect.arrayContaining(['profileId', 'profileDigest']),
    );

    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'human-provenance', OWNER_ACCESS_KEY, 'a');
    const context = { db: database } as unknown as MutationCtx;
    const snapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const edit = textEdit(snapshot, 'Human content');
    const clocks = clocksForNodeSlideOperations(snapshot, [edit.operation]);
    const request = {
      id: 'human-patch',
      deckId: snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: snapshot.deck.version,
      ...clocks,
      scope: edit.scope,
      operations: [edit.operation],
      summary: 'Human edit',
      source: 'agent',
      traceId: 'forged-trace',
    } as unknown as PatchRequest;

    const receipt = await applyPatchHandler(context, request);

    expect(receipt.patch.source).toBe('human');
    expect(receipt.patch.traceId).toBeUndefined();
    expect(onlyStableRow(database, 'nodeslide_patches', 'human-patch').source).toBe('human');
    expect(onlyStableRow(database, 'nodeslide_patches', 'human-patch').traceId).toBeUndefined();

    const afterHumanEdit = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const pairedEdit = textEdit(afterHumanEdit, 'Profile pair validation');
    const pairedClocks = clocksForNodeSlideOperations(afterHumanEdit, [pairedEdit.operation]);
    const pairedBase = {
      deckId: afterHumanEdit.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: afterHumanEdit.deck.version,
      ...pairedClocks,
      scope: pairedEdit.scope,
      operations: [pairedEdit.operation],
      summary: 'Incomplete profile reference',
    };
    database.resetObservations();
    await expect(
      applyPatchHandler(context, {
        ...pairedBase,
        profileId: 'profile-without-digest',
      }),
    ).rejects.toThrow(/profileId and profileDigest must appear together/i);
    await expect(
      applyPatchHandler(context, {
        ...pairedBase,
        profileDigest: `sha256:${'0'.repeat(64)}`,
      }),
    ).rejects.toThrow(/profileId and profileDigest must appear together/i);
    expect(database.writes).toEqual([]);
  });

  it('resolves signature application and restore by immutable profile digest', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'profile-digest', OWNER_ACCESS_KEY, '4');
    const context = { db: database } as unknown as MutationCtx;
    const firstRevision = structuredClone(financeIbcsTastePack) as SignatureProfile;
    const digestCharacter = firstRevision.source.digest.endsWith('0') ? '1' : '0';
    const secondRevision = structuredClone(firstRevision) as SignatureProfile;
    secondRevision.name = `${firstRevision.name} second revision`;
    secondRevision.source = {
      ...secondRevision.source,
      digest: `sha256:${digestCharacter.repeat(64)}`,
    };
    seedSignatureProfile(database, fixture.snapshot.deck.projectId, firstRevision);
    seedSignatureProfile(database, fixture.snapshot.deck.projectId, secondRevision);

    const beforeSignature = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const application = planSignatureApplication(beforeSignature, firstRevision);
    if (!application.ok) throw new Error(application.error.message);
    const signatureReceipt = await applyPatchHandler(context, {
      id: 'signature-patch-first-revision',
      deckId: beforeSignature.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: application.plan.baseDeckVersion,
      baseSlideVersions: application.plan.baseSlideVersions,
      baseElementVersions: application.plan.baseElementVersions,
      scope: application.plan.scope,
      operations: application.plan.operations,
      summary: 'Apply exact signature revision',
      profileId: firstRevision.id,
      profileDigest: firstRevision.source.digest,
    });

    expect(signatureReceipt.patch).toEqual(
      expect.objectContaining({
        profileId: firstRevision.id,
        profileDigest: firstRevision.source.digest,
      }),
    );
    expect(onlyStableRow(database, 'nodeslide_patches', signatureReceipt.patch.id)).toEqual(
      expect.objectContaining({
        profileId: firstRevision.id,
        profileDigest: firstRevision.source.digest,
      }),
    );
    const signedSnapshot = await requiredSnapshot(context, fixture.snapshot.deck.id);
    expect(signedSnapshot.deck.activeSignatureProfileId).toBe(firstRevision.id);
    expect(signedSnapshot.deck.activeSignatureProfileDigest).toBe(firstRevision.source.digest);
    expect(signedSnapshot.deck.activeSignatureProfileDigest).not.toBe(secondRevision.source.digest);
    const signedVersion = database
      .rows('nodeslide_versions')
      .find((row) => row.version === signedSnapshot.deck.version);
    if (!signedVersion || typeof signedVersion.id !== 'string') {
      throw new Error('Signed version receipt is missing.');
    }
    expect((signedVersion.snapshot as DeckSnapshot).deck.activeSignatureProfileDigest).toBe(
      firstRevision.source.digest,
    );

    const laterEdit = textEdit(signedSnapshot, 'Edit under the immutable active revision');
    const laterClocks = clocksForNodeSlideOperations(signedSnapshot, [laterEdit.operation]);
    await applyPatchHandler(context, {
      deckId: signedSnapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: signedSnapshot.deck.version,
      ...laterClocks,
      scope: laterEdit.scope,
      operations: [laterEdit.operation],
      summary: 'Edit with active signature enforcement',
    });
    const beforeRestore = await requiredSnapshot(context, signedSnapshot.deck.id);
    const restored = await restoreVersionHandler(context, {
      deckId: signedSnapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      versionId: signedVersion.id,
      baseDeckVersion: beforeRestore.deck.version,
    });

    expect(restored.patch.status).toBe('accepted');
    expect(restored.workspace?.deck.activeSignatureProfileId).toBe(firstRevision.id);
    expect(restored.workspace?.deck.activeSignatureProfileDigest).toBe(firstRevision.source.digest);
    expect(
      (await requiredSnapshot(context, signedSnapshot.deck.id)).deck.activeSignatureProfileDigest,
    ).toBe(firstRevision.source.digest);
  });

  it('publishes only current validated, sanitized immutable snapshots and supports bounded republish/revoke', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'publication', OWNER_ACCESS_KEY, 'b', (snapshot) => {
      const publicSourceId = `public-source-${snapshot.deck.id}`;
      snapshot.sources.push({
        id: publicSourceId,
        deckId: snapshot.deck.id,
        title: 'Public evidence',
        url: 'https://example.com/evidence',
        sourceType: 'url',
        retrievedAt: 1_000,
        citation: 'Public evidence citation',
      });
      const element = snapshot.elements[0];
      const internalSource = snapshot.sources.find((source) => source.sourceType !== 'url');
      if (!element || !internalSource) throw new Error('Publication fixture is incomplete.');
      element.sourceIds = [internalSource.id, publicSourceId];
    });
    const context = { db: database } as unknown as MutationCtx;

    const first = await publishDeckHandler(context, {
      deckId: fixture.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    const slug = first.publication.shareSlug;
    expect(slug).not.toBe(fixture.snapshot.deck.shareSlug);
    const publicRead = await presenterHandler(context, { shareSlug: slug });
    if (!publicRead) throw new Error('Published snapshot was unavailable.');

    expect(publicRead.snapshot.slides.every((slide) => !('notes' in slide))).toBe(true);
    expect('projectId' in publicRead.snapshot.deck).toBe(false);
    expect('brief' in publicRead.snapshot.deck).toBe(false);
    expect('activeSignatureProfileId' in publicRead.snapshot.deck).toBe(false);
    expect('shareSlug' in publicRead.snapshot.deck).toBe(false);
    expect(publicRead.snapshot.sources).toEqual([
      expect.objectContaining({
        sourceType: 'url',
        url: 'https://example.com/evidence',
      }),
    ]);
    expect(publicRead.snapshot.elements.flatMap((element) => element.sourceIds)).toEqual([
      `public-source-${fixture.snapshot.deck.id}`,
    ]);
    expect(publicRead.snapshot.elements[0]?.sourceIds).toEqual([
      `public-source-${fixture.snapshot.deck.id}`,
    ]);

    const live = await requiredSnapshot(context, fixture.snapshot.deck.id);
    const editedText = 'This edit exists only in the live workspace.';
    const edit = textEdit(live, editedText);
    const clocks = clocksForNodeSlideOperations(live, [edit.operation]);
    await applyPatchHandler(context, {
      deckId: live.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      baseDeckVersion: live.deck.version,
      ...clocks,
      scope: edit.scope,
      operations: [edit.operation],
      summary: 'Edit after publication',
    });

    const unchanged = await presenterHandler(context, { shareSlug: slug });
    expect(
      unchanged?.snapshot.elements.find((element) => element.id === edit.elementId)?.content,
    ).not.toBe(editedText);

    const republished = await publishDeckHandler(context, {
      deckId: live.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    expect(republished.publication.revision).toBe(2);
    expect(republished.publication.shareSlug).toBe(slug);
    expect(
      (await presenterHandler(context, { shareSlug: slug }))?.snapshot.elements.find(
        (element) => element.id === edit.elementId,
      )?.content,
    ).toBe(editedText);

    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.publications + 3; index += 1) {
      await publishDeckHandler(context, {
        deckId: live.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
      });
    }
    expect(database.rows('nodeslide_publications')).toHaveLength(
      NODESLIDE_WORKSPACE_LIMITS.publications,
    );
    expect(
      database.rows('nodeslide_publications').filter((row) => row.status === 'active'),
    ).toHaveLength(1);

    const revoked = await revokePublicationHandler(context, {
      deckId: live.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    expect(revoked).toEqual(expect.objectContaining({ status: 'revoked' }));
    expect(await presenterHandler(context, { shareSlug: slug })).toBeNull();

    const afterRevoke = await publishDeckHandler(context, {
      deckId: live.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
    });
    expect(afterRevoke.publication.shareSlug).not.toBe(slug);
    expect(await presenterHandler(context, { shareSlug: slug })).toBeNull();
    expect(
      await presenterHandler(context, {
        shareSlug: afterRevoke.publication.shareSlug,
      }),
    ).not.toBeNull();
  });

  it('refuses publication without a publishable validation for the exact live version', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'invalid-publication', OWNER_ACCESS_KEY, 'c');
    const context = { db: database } as unknown as MutationCtx;
    const validation = database.rows('nodeslide_validations')[0];
    if (!validation) throw new Error('Validation fixture is missing.');
    validation.publishOk = false;

    await expect(
      publishDeckHandler(context, {
        deckId: fixture.snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/current deck version must pass publish validation/i);
    expect(database.rows('nodeslide_publications')).toEqual([]);

    validation.publishOk = true;
    const deck = database.rows('nodeslide_decks')[0];
    if (!deck || typeof deck.version !== 'number') throw new Error('Deck fixture is missing.');
    deck.version += 1;
    await expect(
      publishDeckHandler(context, {
        deckId: fixture.snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).rejects.toThrow(/current deck version must pass publish validation/i);
    expect(database.rows('nodeslide_publications')).toEqual([]);
  });

  it('does not complete or reject traces linked to another deck or patch', async () => {
    const database = new MemoryDatabase();
    const first = seedWorkspace(database, 'trace-owner', OWNER_ACCESS_KEY, 'd');
    const second = seedWorkspace(database, 'trace-victim', SECOND_OWNER_ACCESS_KEY, 'e');
    const context = { db: database } as unknown as MutationCtx;

    const rejectCandidate = readyTextPatch(
      first.snapshot,
      'patch-reject',
      'trace-reject',
      'Rejected',
    );
    database.seed('nodeslide_patches', rejectCandidate);
    database.seed(
      'nodeslide_traces',
      traceRow(second.snapshot.deck.id, rejectCandidate.id, 'trace-reject'),
    );

    await rejectPatchHandler(context, {
      deckId: first.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patchId: rejectCandidate.id,
    });
    expect(onlyStableRow(database, 'nodeslide_patches', rejectCandidate.id).status).toBe(
      'rejected',
    );
    expect(onlyStableRow(database, 'nodeslide_traces', 'trace-reject')).toEqual(
      expect.objectContaining({
        status: 'awaiting_review',
        deckId: second.snapshot.deck.id,
      }),
    );
    expect(onlyStableRow(database, 'nodeslide_traces', 'trace-reject').completedAt).toBeUndefined();

    const current = await requiredSnapshot(context, first.snapshot.deck.id);
    const acceptCandidate = readyTextPatch(current, 'patch-accept', 'trace-accept', 'Accepted');
    database.seed('nodeslide_patches', acceptCandidate);
    database.seed(
      'nodeslide_traces',
      traceRow(second.snapshot.deck.id, acceptCandidate.id, 'trace-accept'),
    );

    const accepted = await acceptPatchHandler(context, {
      deckId: first.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patchId: acceptCandidate.id,
    });
    expect(accepted.patch.status).toBe('accepted');
    expect(onlyStableRow(database, 'nodeslide_traces', 'trace-accept')).toEqual(
      expect.objectContaining({
        status: 'awaiting_review',
        deckId: second.snapshot.deck.id,
      }),
    );
    expect(onlyStableRow(database, 'nodeslide_traces', 'trace-accept').completedAt).toBeUndefined();

    const afterAccept = await requiredSnapshot(context, first.snapshot.deck.id);
    const wrongPatchCandidate = readyTextPatch(
      afterAccept,
      'patch-wrong-link',
      'trace-wrong-link',
      'Wrong link',
    );
    database.seed('nodeslide_patches', wrongPatchCandidate);
    database.seed(
      'nodeslide_traces',
      traceRow(first.snapshot.deck.id, 'another-patch', 'trace-wrong-link'),
    );
    await acceptPatchHandler(context, {
      deckId: first.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      patchId: wrongPatchCandidate.id,
    });
    expect(onlyStableRow(database, 'nodeslide_traces', 'trace-wrong-link').status).toBe(
      'awaiting_review',
    );
    expect(
      onlyStableRow(database, 'nodeslide_traces', 'trace-wrong-link').completedAt,
    ).toBeUndefined();
  });

  it('rejects cross-deck comment idempotency collisions for comments and replies', async () => {
    const database = new MemoryDatabase();
    const first = seedWorkspace(database, 'comment-owner', OWNER_ACCESS_KEY, 'f');
    const second = seedWorkspace(database, 'comment-victim', SECOND_OWNER_ACCESS_KEY, '1');
    const context = { db: database } as unknown as MutationCtx;
    database.seed(
      'nodeslide_comments',
      commentRow('collision-comment', second.snapshot.deck.id, undefined, 10),
    );

    await expect(
      addCommentHandler(context, {
        id: 'collision-comment',
        deckId: first.snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        anchor: { type: 'deck', deckId: first.snapshot.deck.id },
        authorId: 'owner',
        authorName: 'Owner',
        text: 'Do not return another deck comment.',
      }),
    ).rejects.toThrow('Comment id is unavailable.');

    database.seed(
      'nodeslide_comments',
      commentRow('parent-comment', first.snapshot.deck.id, undefined, 11),
    );
    database.seed(
      'nodeslide_comments',
      commentRow('collision-reply', second.snapshot.deck.id, 'victim-parent', 12),
    );
    await expect(
      replyCommentHandler(context, {
        id: 'collision-reply',
        deckId: first.snapshot.deck.id,
        ownerAccessKey: OWNER_ACCESS_KEY,
        parentId: 'parent-comment',
        authorId: 'owner',
        authorName: 'Owner',
        text: 'Do not return another deck reply.',
      }),
    ).rejects.toThrow('Comment id is unavailable.');
    expect(database.rows('nodeslide_comments')).toHaveLength(3);
  });

  it('loads deterministic bounded history while retaining latest and actionable rows', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'bounded-history', OWNER_ACCESS_KEY, '2');
    const deckId = fixture.snapshot.deck.id;
    const context = { db: database } as unknown as MutationCtx;

    database.seed('nodeslide_comments', commentRow('old-open-comment', deckId, undefined, 1));
    onlyStableRow(database, 'nodeslide_comments', 'old-open-comment').status = 'open';
    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.comments + 20; index += 1) {
      const row = commentRow(`comment-${index}`, deckId, undefined, 100 + index);
      row.status = 'resolved';
      database.seed('nodeslide_comments', row);
    }

    database.seed('nodeslide_patches', historyPatch('old-ready-patch', deckId, 'ready', 1));
    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.patches + 20; index += 1) {
      database.seed(
        'nodeslide_patches',
        historyPatch(`patch-${index}`, deckId, 'accepted', 100 + index),
      );
    }

    for (let index = 2; index < NODESLIDE_WORKSPACE_LIMITS.versions + 20; index += 1) {
      database.seed('nodeslide_versions', {
        id: `version-${index}`,
        deckId,
        version: index,
        label: `Version ${index}`,
        source: 'human',
        snapshot: fixture.snapshot,
        createdAt: index,
      });
    }

    database.seed('nodeslide_traces', {
      ...traceRow(deckId, 'old-patch', 'old-review-trace', 1),
      reasoningEffort: 'xhigh',
    });
    for (let index = 0; index < 20; index += 1) {
      database.seed('nodeslide_traces', {
        ...traceRow(deckId, `planning-patch-${index}`, `planning-trace-${index}`, 2 + index),
        status: 'planning',
      });
      database.seed('nodeslide_traces', {
        ...traceRow(deckId, `working-patch-${index}`, `working-trace-${index}`, 30 + index),
        status: 'working',
      });
    }
    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.traces + 20; index += 1) {
      const row = traceRow(deckId, `trace-patch-${index}`, `trace-${index}`, 100 + index);
      database.seed('nodeslide_traces', {
        ...row,
        status: 'completed',
        completedAt: 100 + index,
      });
    }

    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.validations + 20; index += 1) {
      database.seed('nodeslide_validations', {
        id: `validation-${index}`,
        deckId,
        deckVersion: index + 2,
        ok: true,
        publishOk: true,
        cleanOk: true,
        issues: [],
        checkedAt: 100 + index,
        toolchainVersion: fixture.snapshot.deck.toolchainVersion,
      });
    }

    database.seed('nodeslide_exports', exportRow('old-rendering-export', deckId, 'rendering', 1));
    for (let index = 0; index < 20; index += 1) {
      database.seed('nodeslide_exports', {
        ...exportRow(`queued-export-${index}`, deckId, 'ready', 2 + index),
        status: 'queued',
      });
    }
    for (let index = 0; index < NODESLIDE_WORKSPACE_LIMITS.exports + 20; index += 1) {
      database.seed(
        'nodeslide_exports',
        exportRow(`export-${index}`, deckId, 'ready', 100 + index),
      );
    }

    database.resetObservations();
    const workspace = await loadNodeSlideWorkspace(context, deckId, 0);
    if (!workspace) throw new Error('Bounded workspace was unavailable.');

    expect(workspace.comments).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.comments);
    expect(workspace.patches).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.patches);
    expect(workspace.versions).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.versions);
    expect(workspace.traces).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.traces);
    expect(workspace.validations).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.validations);
    expect(workspace.exports).toHaveLength(NODESLIDE_WORKSPACE_LIMITS.exports);
    expect(workspace.comments.some((row) => row.id === 'old-open-comment')).toBe(true);
    expect(workspace.patches.some((row) => row.id === 'old-ready-patch')).toBe(true);
    expect(workspace.traces.some((row) => row.id === 'old-review-trace')).toBe(true);
    expect(workspace.traces.find((row) => row.id === 'old-review-trace')?.reasoningEffort).toBe(
      'xhigh',
    );
    expect(workspace.exports.some((row) => row.id === 'old-rendering-export')).toBe(true);
    expect(workspace.comments.at(-1)?.id).toBe(
      `comment-${NODESLIDE_WORKSPACE_LIMITS.comments + 19}`,
    );
    expect(workspace.patches[0]?.id).toBe(`patch-${NODESLIDE_WORKSPACE_LIMITS.patches + 19}`);
    expect(workspace.traces[0]?.id).toBe(`trace-${NODESLIDE_WORKSPACE_LIMITS.traces + 19}`);
    expect(workspace.exports[0]?.id).toBe(`export-${NODESLIDE_WORKSPACE_LIMITS.exports + 19}`);
    expect(isAscending(workspace.comments.map((row) => row.createdAt))).toBe(true);
    expect(isDescending(workspace.patches.map((row) => row.createdAt))).toBe(true);
    expect(isDescending(workspace.versions.map((row) => row.version))).toBe(true);
    expect(isDescending(workspace.traces.map((row) => row.createdAt))).toBe(true);
    expect(isDescending(workspace.validations.map((row) => row.checkedAt))).toBe(true);
    expect(isDescending(workspace.exports.map((row) => row.createdAt))).toBe(true);
    expect(database.collectCalls.filter((tableName) => HISTORY_TABLES.has(tableName))).toEqual([]);
    expect(
      database.takeCalls
        .filter(({ tableName }) => HISTORY_TABLES.has(tableName))
        .every(({ tableName, limit }) => limit <= historyLimit(tableName)),
    ).toBe(true);
  });

  it('returns the existing stale restore receipt without changing the workspace snapshot', async () => {
    const database = new MemoryDatabase();
    const fixture = seedWorkspace(database, 'stale-restore', OWNER_ACCESS_KEY, '3');
    const context = { db: database } as unknown as MutationCtx;
    const before = await requiredSnapshot(context, fixture.snapshot.deck.id);
    database.resetObservations();

    const receipt = await restoreVersionHandler(context, {
      deckId: fixture.snapshot.deck.id,
      ownerAccessKey: OWNER_ACCESS_KEY,
      versionId: fixture.versionId,
      baseDeckVersion: before.deck.version - 1,
    });

    expect(receipt.patch.status).toBe('stale');
    expect(receipt.workspace?.deck.version).toBe(before.deck.version);
    expect(receipt.workspace?.slides).toEqual(before.slides);
    expect(receipt.workspace?.elements).toEqual(before.elements);
    expect(receipt.workspace?.sources).toEqual(before.sources);
    expect(await requiredSnapshot(context, fixture.snapshot.deck.id)).toEqual(before);
    expect(database.writes).toEqual([
      expect.objectContaining({
        kind: 'insert',
        tableName: 'nodeslide_patches',
      }),
    ]);
    expect(onlyStableRow(database, 'nodeslide_patches', receipt.patch.id).status).toBe('stale');
  });
});

function seedWorkspace(
  database: MemoryDatabase,
  label: string,
  ownerAccessKey: string,
  slugCharacter: string,
  mutate?: (snapshot: DeckSnapshot) => void,
): { snapshot: DeckSnapshot; versionId: string } {
  const snapshot = structuredClone(
    buildGoldenNodeSlide(`release-security-${label}`, 1_000).snapshot,
  );
  snapshot.deck.shareSlug = `share-${slugCharacter.repeat(36)}`;
  mutate?.(snapshot);
  const validation = validateNodeSlideSnapshot(snapshot, 1_000);
  if (!validation.publishOk) throw new Error(`Fixture ${label} must begin publishable.`);
  const project = database.seed('projects', {
    clientSessionId: label,
    title: snapshot.deck.title,
    domain: 'nodeslide',
    brief: snapshot.deck.brief,
    sourceType: 'prompt',
    starred: false,
    createdAt: 1_000,
    updatedAt: 1_000,
  });
  database.seed('nodeslide_decks', {
    ...snapshot.deck,
    projectRowId: project._id,
    clientSessionId: label,
    ownerAccessKey,
    plan: [],
    spec: {},
  });
  for (const slide of snapshot.slides) {
    database.seed('nodeslide_slides', {
      ...slide,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
  }
  for (const element of snapshot.elements) {
    database.seed('nodeslide_elements', {
      ...element,
      deckId: snapshot.deck.id,
      createdAt: 1_000,
      updatedAt: 1_000,
    });
  }
  for (const source of snapshot.sources) database.seed('nodeslide_sources', source);
  database.seed('nodeslide_validations', validation);
  const versionId = `initial-version-${snapshot.deck.id}`;
  database.seed('nodeslide_versions', {
    id: versionId,
    deckId: snapshot.deck.id,
    version: snapshot.deck.version,
    label: 'Initial deck',
    source: 'system',
    snapshot,
    createdAt: 1_000,
  });
  return { snapshot, versionId };
}

function seedSignatureProfile(
  database: MemoryDatabase,
  tenantId: string,
  profile: SignatureProfile,
): void {
  database.seed('nodeslide_signature_profiles', {
    id: signatureProfileRowId(tenantId, profile.id, profile.source.digest),
    tenantId,
    profileId: profile.id,
    sourceDigest: profile.source.digest,
    sourceKind: profile.source.kind,
    name: profile.name,
    confidence: profile.confidence,
    warningCount: profile.warnings.length,
    profileJson: serializeSignatureProfileForStorage(profile),
    createdAt: 1_000,
    updatedAt: 1_000,
  });
}

async function requiredSnapshot(ctx: MutationCtx, deckId: string): Promise<DeckSnapshot> {
  const snapshot = await loadNodeSlideSnapshot(ctx, deckId);
  if (!snapshot) throw new Error(`Snapshot ${deckId} is missing.`);
  return snapshot;
}

function textEdit(
  snapshot: DeckSnapshot,
  text: string,
): {
  elementId: string;
  operation: Extract<PatchOperation, { op: 'replace_text' }>;
  scope: DeckPatch['scope'];
} {
  const element = snapshot.elements.find(
    (candidate) => candidate.kind === 'text' && !candidate.locked && candidate.content !== text,
  );
  if (!element) throw new Error('Editable text fixture is missing.');
  return {
    elementId: element.id,
    operation: {
      op: 'replace_text',
      slideId: element.slideId,
      elementId: element.id,
      text,
    },
    scope: {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [element.slideId],
      elementIds: [element.id],
      operationMode: 'copy',
    },
  };
}

function readyTextPatch(
  snapshot: DeckSnapshot,
  id: string,
  traceId: string,
  text: string,
): DeckPatch {
  const edit = textEdit(snapshot, text);
  const clocks = clocksForNodeSlideOperations(snapshot, [edit.operation]);
  return {
    id,
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    ...clocks,
    scope: edit.scope,
    operations: [edit.operation],
    source: 'agent',
    status: 'ready',
    summary: id,
    traceId,
    createdAt: 1_000,
    updatedAt: 1_000,
  };
}

function traceRow(deckId: string, patchId: string, id: string, createdAt = 1_000) {
  return {
    id,
    deckId,
    patchId,
    status: 'awaiting_review',
    summary: id,
    plan: [],
    context: [],
    toolCalls: [],
    guardrails: [],
    createdAt,
  };
}

function commentRow(id: string, deckId: string, parentId: string | undefined, createdAt: number) {
  return {
    id,
    deckId,
    ...(parentId ? { parentId } : {}),
    anchor: { type: 'deck', deckId },
    authorId: 'author',
    authorName: 'Author',
    text: id,
    status: 'open',
    createdAt,
    updatedAt: createdAt,
  };
}

function historyPatch(id: string, deckId: string, status: 'ready' | 'accepted', createdAt: number) {
  return {
    id,
    deckId,
    baseDeckVersion: 1,
    baseSlideVersions: {},
    baseElementVersions: {},
    scope: { kind: 'deck', deckId, operationMode: 'unrestricted' },
    operations: [],
    source: 'human',
    status,
    summary: id,
    createdAt,
    updatedAt: createdAt,
  };
}

function exportRow(id: string, deckId: string, status: 'rendering' | 'ready', createdAt: number) {
  return {
    id,
    deckId,
    deckVersion: 1,
    kind: 'html',
    status,
    capabilityWarnings: [],
    createdAt,
  };
}

function onlyStableRow(database: MemoryDatabase, tableName: string, id: string): StoredRow {
  const rows = database.rows(tableName).filter((row) => row.id === id);
  if (rows.length !== 1 || !rows[0]) {
    throw new Error(`Expected one ${tableName} row with id ${id}; found ${rows.length}.`);
  }
  return rows[0];
}

async function downgradePackagePatchToLegacy(
  database: MemoryDatabase,
  patchId: string,
): Promise<void> {
  const submission = database
    .rows('nodeslide_package_submissions')
    .find((row) => row.patchId === patchId);
  if (!submission) throw new Error(`Expected package submission ${patchId}.`);
  await database.delete(submission._id);
  const receipts = database
    .rows('nodeslide_package_receipts')
    .filter((row) => row.patchId === patchId);
  if (receipts.length === 0) throw new Error(`Expected package receipts for ${patchId}.`);
  for (const row of receipts) {
    Reflect.deleteProperty(row.receipt as Record<string, unknown>, 'authorization');
  }
  database.resetObservations();
}

function matchesFilter(actual: unknown, filter: Filter): boolean {
  if (filter.operation === 'eq') return actual === filter.value;
  if (filter.operation === 'gt') return compareValues(actual, filter.value) > 0;
  return compareValues(actual, filter.value) <= 0;
}

function compareValues(left: unknown, right: unknown): number {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  return String(left ?? '').localeCompare(String(right ?? ''));
}

function orderFieldForIndex(indexName: string): string {
  if (indexName === 'by_deck_revision' || indexName === 'by_share_slug_revision') {
    return 'revision';
  }
  if (indexName === 'by_deck_version') return 'version';
  if (indexName === 'by_deck_version_checked' || indexName === 'by_deck_checked') {
    return 'checkedAt';
  }
  if (indexName === 'by_deck_expiry') return 'expiresAt';
  if (indexName.includes('created')) return 'createdAt';
  return '_creationTime';
}

function historyLimit(tableName: string): number {
  if (tableName === 'nodeslide_comments') return NODESLIDE_WORKSPACE_LIMITS.comments;
  if (tableName === 'nodeslide_patches') return NODESLIDE_WORKSPACE_LIMITS.patches;
  if (tableName === 'nodeslide_versions') return NODESLIDE_WORKSPACE_LIMITS.versions;
  if (tableName === 'nodeslide_traces') return NODESLIDE_WORKSPACE_LIMITS.traces;
  if (tableName === 'nodeslide_validations') return NODESLIDE_WORKSPACE_LIMITS.validations;
  if (tableName === 'nodeslide_exports') return NODESLIDE_WORKSPACE_LIMITS.exports;
  throw new Error(`Unknown history table ${tableName}.`);
}

function isAscending(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value >= (values[index - 1] ?? value));
}

function isDescending(values: readonly number[]): boolean {
  return values.every((value, index) => index === 0 || value <= (values[index - 1] ?? value));
}

function publicArgNames(value: unknown): string[] {
  const exportArgs = (value as { exportArgs?: () => string }).exportArgs;
  if (!exportArgs) throw new Error('Registered Convex argument validator is unavailable.');
  const exported = JSON.parse(exportArgs()) as {
    value?: Record<string, unknown>;
  };
  return Object.keys(exported.value ?? {});
}
