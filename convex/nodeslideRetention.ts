import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation, mutation } from './_generated/server';
import { isOwnerAccessKey, requireOwnerAccess } from './lib/nodeslideAccess';
import { findDeckRow } from './lib/nodeslideData';
import {
  collectNodeSlideScopedRows,
  nodeSlideScopeValue,
  takeNodeSlideScopedRows,
} from './lib/nodeslideDeckRows';
import {
  NODESLIDE_DERIVED_ERASURE_TABLES,
  type NodeSlideErasureEntry,
  type NodeSlideSchemaLike,
  buildNodeSlideErasureContract,
  nodeSlideStorageIdFields,
} from './lib/nodeslideErasureContract';
import { nodeslideContentDigest, nodeslideStableId } from './lib/nodeslideIds';
import {
  isNodeSlideProductionProbeCleanupToken,
  nodeSlideProductionProbeFields,
} from './lib/nodeslideProductionProbe';
import schema from './schema';

/**
 * Built once, at module load, from `convex/schema.ts` itself. A schema that
 * gained a table nobody classified fails here — at import time, in every test
 * and every deploy — rather than after a user pressed "delete my deck" and got
 * a green receipt over surviving rows.
 */
export const NODESLIDE_ERASURE_CONTRACT: readonly NodeSlideErasureEntry[] =
  buildNodeSlideErasureContract(schema as unknown as NodeSlideSchemaLike);

/**
 * Per-table `v.id('_storage')` fields, resolved once alongside the contract.
 * A row delete only removes the pointer; the erasure has to follow it.
 */
export const NODESLIDE_ERASURE_STORAGE_FIELDS: ReadonlyMap<string, readonly string[]> = new Map(
  NODESLIDE_ERASURE_CONTRACT.map((entry): [string, readonly string[]] => [
    entry.table,
    nodeSlideStorageIdFields(schema as unknown as NodeSlideSchemaLike, entry.table),
  ]).filter(([, fields]) => fields.length > 0),
);

const RETENTION_RECEIPT_SCHEMA = 'nodeslide.workspace-retention-receipt/v1' as const;
const RETENTION_TOMBSTONE_SCHEMA = 'nodeslide.retention-tombstone/v1' as const;
const RETENTION_TARGET_BINDING_DOMAIN = 'nodeslide.retention-target/v1';
const RETENTION_PRINCIPAL_BINDING_DOMAIN = 'nodeslide.retention-principal/v1';
const RETENTION_TICKET_DOMAIN = 'nodeslide.retention-ticket/v1';
/** ASCII unit separator: a byte that cannot occur in a deck id or access key. */
const RETENTION_FIELD_SEPARATOR = String.fromCharCode(0x1f);

type DeletedCounts = Record<string, number>;

/**
 * Permanently removes one owner-authorized workspace and every row whose
 * payload can retain deck, source, prompt, trace, export, or snapshot data.
 * The mutation is intentionally transactional: a red response cannot certify
 * partial cleanup, and the returned receipt contains no stable IDs or bearer
 * capabilities.
 */
export const deleteOwnedWorkspace = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    cleanupTicket: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (
      args.deckId.length === 0 ||
      args.deckId.length > 256 ||
      !isOwnerAccessKey(args.ownerAccessKey)
    ) {
      throw new Error('NodeSlide owner access denied.');
    }
    const bindings = nodeSlideRetentionBindings(args.deckId, args.ownerAccessKey);
    if (args.cleanupTicket !== undefined && args.cleanupTicket !== bindings.cleanupTicket) {
      throw new Error('NodeSlide owner access denied.');
    }
    const existing = await findDeckRow(ctx, args.deckId);
    const tombstone = await ctx.db
      .query('nodeslide_retention_tombstones')
      .withIndex('by_target_binding', (index) =>
        index.eq('targetBindingDigest', bindings.targetBindingDigest),
      )
      .first();
    const retainedRows = await countDeckRows(ctx, args.deckId);
    let authorizedDeck: Doc<'nodeslide_decks'> | null = null;
    try {
      authorizedDeck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    } catch {
      // Existing-wrong-owner and never-existing targets deliberately converge
      // on the same denial below, after the same bounded lookup sequence.
    }
    if (!existing) {
      if (
        retainedRows !== 0 ||
        !args.cleanupTicket ||
        !tombstone ||
        tombstone.schemaVersion !== RETENTION_TOMBSTONE_SCHEMA ||
        tombstone.principalBindingDigest !== bindings.principalBindingDigest ||
        tombstone.cleanupTicketDigest !== nodeslideContentDigest(bindings.cleanupTicket)
      ) {
        throw new Error('NodeSlide owner access denied.');
      }
      return retentionReceipt({}, true, bindings);
    }
    if (!authorizedDeck || authorizedDeck._id !== existing._id || tombstone) {
      throw new Error('NodeSlide owner access denied.');
    }
    const counts = await deleteWorkspaceRows(ctx, authorizedDeck);
    const remainingRows = await countDeckRows(ctx, authorizedDeck.id);
    const project = await ctx.db.get(authorizedDeck.projectRowId);
    if (remainingRows !== 0 || project !== null) {
      throw new Error('NodeSlide workspace retention cleanup did not reach zero rows.');
    }
    await ctx.db.insert('nodeslide_retention_tombstones', {
      schemaVersion: RETENTION_TOMBSTONE_SCHEMA,
      targetBindingDigest: bindings.targetBindingDigest,
      principalBindingDigest: bindings.principalBindingDigest,
      cleanupTicketDigest: nodeslideContentDigest(bindings.cleanupTicket),
      createdAt: Date.now(),
    });
    return retentionReceipt(counts, false, bindings);
  },
});

/**
 * Deletes a synthetic production probe even when the browser lost the action
 * response before it learned the deck id or owner capability. Only rows
 * created with the same one-use token digest are reachable.
 */
export const deleteProductionProbeWorkspace = mutation({
  args: { clientSessionId: v.string(), cleanupToken: v.string() },
  handler: async (ctx, args) => {
    if (
      args.clientSessionId.length === 0 ||
      args.clientSessionId.length > 256 ||
      !isNodeSlideProductionProbeCleanupToken(args.cleanupToken)
    ) {
      throw new Error('NodeSlide production probe cleanup denied.');
    }
    const { productionProbeCleanupDigest } = nodeSlideProductionProbeFields(
      args.cleanupToken,
      Date.now(),
    );
    const rows = await ctx.db
      .query('nodeslide_decks')
      .withIndex('by_production_probe_cleanup', (index) =>
        index.eq('productionProbeCleanupDigest', productionProbeCleanupDigest),
      )
      .take(2);
    if (rows.length === 0) return productionProbeReceipt({}, true, productionProbeCleanupDigest);
    const deck = rows[0];
    if (
      rows.length !== 1 ||
      !deck ||
      deck.clientSessionId !== args.clientSessionId ||
      deck.productionProbeExpiresAt === undefined
    ) {
      throw new Error('NodeSlide production probe cleanup denied.');
    }
    const counts = await deleteWorkspaceRows(ctx, deck);
    const remainingRows = await countDeckRows(ctx, deck.id);
    const project = await ctx.db.get(deck.projectRowId);
    if (remainingRows !== 0 || project !== null) {
      throw new Error('NodeSlide production probe retention cleanup did not reach zero rows.');
    }
    return productionProbeReceipt(counts, false, productionProbeCleanupDigest);
  },
});

/** Backstop for a runner crash before its finally block can call the cleanup mutation. */
export const deleteExpiredProductionProbeWorkspaces = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query('nodeslide_decks')
      .withIndex('by_production_probe_expiry', (index) =>
        index.gt('productionProbeExpiresAt', 0).lt('productionProbeExpiresAt', now),
      )
      .take(10);
    let deletedWorkspaceCount = 0;
    let deletedRowCount = 0;
    for (const deck of rows) {
      if (!deck.productionProbeCleanupDigest) continue;
      const counts = await deleteWorkspaceRows(ctx, deck);
      const remainingRows = await countDeckRows(ctx, deck.id);
      const project = await ctx.db.get(deck.projectRowId);
      if (remainingRows !== 0 || project !== null) {
        throw new Error('Expired NodeSlide production probe cleanup did not reach zero rows.');
      }
      deletedWorkspaceCount += 1;
      deletedRowCount += Object.values(counts).reduce((sum, count) => sum + count, 0);
    }
    return { deletedWorkspaceCount, deletedRowCount, scannedAt: now };
  },
});

/**
 * Walks the derived contract. There is no table list in this function, and
 * that is the point: the set of things erased is whatever `schema.ts` says
 * hangs off a deck, resolved at runtime.
 */
async function deleteWorkspaceRows(
  ctx: MutationCtx,
  deck: Doc<'nodeslide_decks'>,
): Promise<DeletedCounts> {
  const counts: DeletedCounts = {};
  const projectDecks = await ctx.db
    .query('nodeslide_decks')
    .withIndex('by_project_row', (index) => index.eq('projectRowId', deck.projectRowId))
    .take(2);
  if (projectDecks.length !== 1 || projectDecks[0]?._id !== deck._id) {
    throw new Error('NodeSlide project retention scope is not one workspace.');
  }

  for (const entry of NODESLIDE_ERASURE_CONTRACT) {
    if (entry.scope.kind === 'deck') {
      await ctx.db.delete(deck._id);
      counts[entry.label] = 1;
      continue;
    }
    if (entry.scope.kind === 'project') {
      await ctx.db.delete(deck.projectRowId);
      counts[entry.label] = 1;
      continue;
    }
    const value = nodeSlideScopeValue(entry, deck);
    if (value === null) continue;
    const rows = await collectNodeSlideScopedRows(ctx, entry, value);
    const storageFields = NODESLIDE_ERASURE_STORAGE_FIELDS.get(entry.table) ?? [];
    for (const row of rows) {
      // Blobs first. If the row went first and the storage delete then threw,
      // the bytes would survive with nothing left pointing at them.
      await deleteRowStorageObjects(ctx, row, storageFields);
      await ctx.db.delete(row._id);
    }
    if (rows.length > 0) counts[entry.label] = rows.length;
  }

  const derivedCounts = await deleteJobDerivedRows(ctx, deck.id);
  for (const [label, count] of Object.entries(derivedCounts)) {
    if (count > 0) counts[label] = (counts[label] ?? 0) + count;
  }

  // Tenant-scoped profile tables span decks by construction, so re-read them
  // after the pass instead of trusting the delete loop's own arithmetic.
  const retainedTenantRows = await Promise.all(
    NODESLIDE_ERASURE_CONTRACT.filter((entry) => entry.scope.kind === 'tenantScoped').map((entry) =>
      takeNodeSlideScopedRows(ctx, entry, deck.projectId, 1),
    ),
  );
  if (retainedTenantRows.some((rows) => rows.length !== 0)) {
    throw new Error('NodeSlide workspace retention left project-scoped profile rows.');
  }
  return counts;
}

/** Bounds one derived sweep. A deck with more jobs than this is swept in full
 * anyway — the cap only bounds a single transaction's read set, and
 * `countJobDerivedRows` is what decides whether the receipt may claim success. */
const DERIVED_SWEEP_LIMIT = 512;

/**
 * The tables `deleteJobDerivedRows` below actually deletes from. Written by hand
 * on purpose, then checked against the contract's own list at module load: the
 * failure this catches is somebody adding a ninth `derived_scope` exclusion and
 * not extending the sweep, which would turn an excluded-but-erased table into an
 * excluded-and-retained one without a single test going red.
 */
const DERIVED_SWEEP_TABLES = [
  'nodeslide_agent_jobs',
  'nodeslide_durable_sessions',
  'nodeslide_durable_session_events',
  'nodeslide_durable_job_journal_entries',
  'nodeslide_durable_model_result_replays',
  'nodeslide_run_budgets',
  'nodeslide_billable_calls',
  'nodeslide_budget_events',
] as const;

{
  const declared = [...NODESLIDE_DERIVED_ERASURE_TABLES].sort();
  const swept = [...DERIVED_SWEEP_TABLES].sort();
  if (declared.length !== swept.length || declared.some((table, index) => table !== swept[index])) {
    throw new Error(
      `NodeSlide derived erasure sweep does not cover its own contract. Declared: ${declared.join(', ')}. Swept: ${swept.join(', ')}.`,
    );
  }
}

/**
 * The two-hop erasure the schema-derived scan cannot express.
 *
 * `nodeslide_agent_jobs` and everything hanging off it carry no `deckId`
 * column — a create_deck job is enqueued before its deck exists — so they are
 * classified `derived_scope` in `NODESLIDE_ERASURE_EXCLUSIONS` and erased here
 * instead. The traversal is:
 *
 *   deck.id -> jobs by `by_result_deck`
 *           -> session id  = nodeslideStableId('nsession', job.id)
 *           -> session row, its event chain, its journal, its replay payloads
 *           -> budget id from job.budgetId (and from any agent run on this deck)
 *           -> budget row, its billable calls, its event chain
 *
 * Every step uses a leading index. There is no table scan here for the same
 * reason the schema-derived path refuses one: a scan either misses rows under
 * pagination or reads the whole deployment, and both make the receipt a lie.
 */
async function deleteJobDerivedRows(ctx: MutationCtx, deckId: string): Promise<DeletedCounts> {
  const counts: DeletedCounts = {};
  const bump = (label: string, amount: number) => {
    if (amount > 0) counts[label] = (counts[label] ?? 0) + amount;
  };

  const jobs = await ctx.db
    .query('nodeslide_agent_jobs')
    .withIndex('by_result_deck', (index) => index.eq('resultDeckId', deckId))
    .take(DERIVED_SWEEP_LIMIT);

  // Runs are deck-scoped and already deleted by the schema-derived pass, but
  // their budget ids must be collected *before* that pass runs. They are read
  // here rather than trusted from the loop above because a run can own a budget
  // no job ever referenced.
  const runs = await ctx.db
    .query('nodeslide_agent_runs')
    .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
    .take(DERIVED_SWEEP_LIMIT);

  const budgetIds = new Set<string>();
  for (const job of jobs) if (job.budgetId) budgetIds.add(job.budgetId);
  for (const run of runs) if (run.budgetId) budgetIds.add(run.budgetId);

  for (const job of jobs) {
    const sessionId = nodeslideStableId('nsession', job.id);

    const events = await ctx.db
      .query('nodeslide_durable_session_events')
      .withIndex('by_session_job', (index) => index.eq('sessionId', sessionId).eq('jobId', job.id))
      .take(DERIVED_SWEEP_LIMIT);
    for (const row of events) await ctx.db.delete(row._id);
    bump('durableSessionEvents', events.length);

    const journal = await ctx.db
      .query('nodeslide_durable_job_journal_entries')
      .withIndex('by_binding_sequence', (index) =>
        index.eq('sessionId', sessionId).eq('jobId', job.id),
      )
      .take(DERIVED_SWEEP_LIMIT);
    for (const row of journal) await ctx.db.delete(row._id);
    bump('durableJobJournalEntries', journal.length);

    const replays = await ctx.db
      .query('nodeslide_durable_model_result_replays')
      .withIndex('by_exact_binding', (index) =>
        index.eq('sessionId', sessionId).eq('jobId', job.id),
      )
      .take(DERIVED_SWEEP_LIMIT);
    for (const row of replays) await ctx.db.delete(row._id);
    bump('durableModelResultReplays', replays.length);

    const sessions = await ctx.db
      .query('nodeslide_durable_sessions')
      .withIndex('by_stable_id', (index) => index.eq('id', sessionId))
      .take(2);
    for (const row of sessions) await ctx.db.delete(row._id);
    bump('durableSessions', sessions.length);

    await ctx.db.delete(job._id);
    bump('agentJobs', 1);
  }

  for (const budgetId of budgetIds) {
    const calls = await ctx.db
      .query('nodeslide_billable_calls')
      .withIndex('by_budget_call', (index) => index.eq('budgetId', budgetId))
      .take(DERIVED_SWEEP_LIMIT);
    for (const row of calls) await ctx.db.delete(row._id);
    bump('billableCalls', calls.length);

    const budgetEvents = await ctx.db
      .query('nodeslide_budget_events')
      .withIndex('by_budget_sequence', (index) => index.eq('budgetId', budgetId))
      .take(DERIVED_SWEEP_LIMIT);
    for (const row of budgetEvents) await ctx.db.delete(row._id);
    bump('budgetEvents', budgetEvents.length);

    const budgets = await ctx.db
      .query('nodeslide_run_budgets')
      .withIndex('by_stable_id', (index) => index.eq('id', budgetId))
      .take(2);
    for (const row of budgets) await ctx.db.delete(row._id);
    bump('runBudgets', budgets.length);

    // Re-read, do not trust the loop. `countJobDerivedRows` below can only
    // re-derive a budget id from a SURVIVING job or run row, so once those are
    // deleted a stranded ledger row becomes unreachable by any deck-anchored
    // query — it would sit there forever while the receipt reported
    // `remainingDeckRows: 0` and `retentionSafe: true`. This is the last moment
    // the id is known, so it is the only honest place to verify it.
    //
    // Until this port nothing ever wrote these rows, so the gap was theoretical.
    // `nodeslideJobs.startCreateDeck` / `startEditProposal` now open a ledger
    // row for every provider-backed job, which makes it real.
    for (const table of ['nodeslide_run_budgets', 'nodeslide_billable_calls'] as const) {
      const survivor =
        table === 'nodeslide_run_budgets'
          ? await ctx.db
              .query(table)
              .withIndex('by_stable_id', (index) => index.eq('id', budgetId))
              .first()
          : await ctx.db
              .query(table)
              .withIndex('by_budget_call', (index) => index.eq('budgetId', budgetId))
              .first();
      if (survivor) {
        throw new Error(
          `NodeSlide erasure left a ${table} row for budget ${budgetId}. The receipt was not written.`,
        );
      }
    }
  }

  return counts;
}

/**
 * Re-reads the derived tables after the sweep. The delete loop's own arithmetic
 * is not evidence: it counts what it decided to visit, which is exactly the
 * quantity a traversal bug gets wrong.
 */
async function countJobDerivedRows(ctx: MutationCtx, deckId: string): Promise<number> {
  const jobs = await ctx.db
    .query('nodeslide_agent_jobs')
    .withIndex('by_result_deck', (index) => index.eq('resultDeckId', deckId))
    .take(1);
  return jobs.length;
}

/**
 * Deletes the file-storage objects a row points at. A missing or already
 * deleted blob is not an error: erasure has to be idempotent, and a second
 * delete request must not fail because the first one succeeded.
 */
async function deleteRowStorageObjects(
  ctx: MutationCtx,
  row: Record<string, unknown>,
  storageFields: readonly string[],
): Promise<void> {
  for (const field of storageFields) {
    const storageId = row[field];
    if (typeof storageId !== 'string' || storageId.length === 0) continue;
    try {
      await ctx.storage.delete(storageId as Id<'_storage'>);
    } catch {
      // Already gone. The row delete below still has to happen.
    }
  }
}

/**
 * Counts every deck-scoped row still reachable by stable deck id, including
 * the deck row itself. Tenant-scoped tables are verified separately in
 * `deleteWorkspaceRows`, because a sibling deck may legitimately still own them.
 */
async function countDeckRows(ctx: MutationCtx, deckId: string): Promise<number> {
  const rows = await Promise.all(
    NODESLIDE_ERASURE_CONTRACT.filter(
      (entry) => entry.scope.kind === 'deckScoped' || entry.scope.kind === 'deck',
    ).map((entry) => takeNodeSlideScopedRows(ctx, entry, deckId, 1)),
  );
  // The `derived_scope` tables are invisible to the contract filter above, so a
  // receipt that only summed those entries would report `remainingDeckRows: 0`
  // over a surviving job row. Every existing caller of this function is a place
  // that certifies an erasure, which is exactly where the derived residue has to
  // be counted too.
  const derived = await countJobDerivedRows(ctx, deckId);
  return rows.reduce((total, found) => total + found.length, 0) + derived;
}

export function nodeSlideRetentionBindings(deckId: string, ownerAccessKey: string) {
  const targetBindingDigest = nodeslideContentDigest(
    [RETENTION_TARGET_BINDING_DOMAIN, deckId].join(RETENTION_FIELD_SEPARATOR),
  );
  const principalBindingDigest = nodeslideContentDigest(
    [RETENTION_PRINCIPAL_BINDING_DOMAIN, ownerAccessKey].join(RETENTION_FIELD_SEPARATOR),
  );
  const cleanupTicket = nodeslideContentDigest(
    [RETENTION_TICKET_DOMAIN, targetBindingDigest, principalBindingDigest].join(
      RETENTION_FIELD_SEPARATOR,
    ),
  );
  return { targetBindingDigest, principalBindingDigest, cleanupTicket };
}

function retentionReceipt(
  counts: DeletedCounts,
  alreadyAbsent: boolean,
  bindings: ReturnType<typeof nodeSlideRetentionBindings>,
) {
  const deletedRowCount = Object.values(counts).reduce((total, count) => total + count, 0);
  const body = {
    schemaVersion: RETENTION_RECEIPT_SCHEMA,
    status: 'passed' as const,
    retentionSafe: true,
    remainingDeckRows: 0,
    remainingSourceRows: 0,
    deletedRowCount,
    deletedCounts: counts,
    alreadyAbsent,
    targetBindingDigest: bindings.targetBindingDigest,
    principalBindingDigest: bindings.principalBindingDigest,
    cleanupTicket: bindings.cleanupTicket,
  };
  return {
    ...body,
    receiptDigest: nodeslideContentDigest(canonicalJson(body)),
  };
}

function productionProbeReceipt(
  counts: DeletedCounts,
  alreadyAbsent: boolean,
  cleanupBindingDigest: string,
) {
  const deletedRowCount = Object.values(counts).reduce((total, count) => total + count, 0);
  const body = {
    schemaVersion: 'nodeslide.production-probe-retention-receipt/v1' as const,
    status: 'passed' as const,
    retentionSafe: true,
    remainingDeckRows: 0,
    remainingSourceRows: 0,
    deletedRowCount,
    deletedCounts: counts,
    alreadyAbsent,
    cleanupBindingDigest,
  };
  return { ...body, receiptDigest: nodeslideContentDigest(canonicalJson(body)) };
}

/**
 * Convex may serialize object keys in a different order than the server used
 * when it constructed a receipt. Bind the digest to the value, not incidental
 * insertion order, so every runtime verifies the same bytes.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
