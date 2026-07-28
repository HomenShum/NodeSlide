import { type Value, getConvexSize, v } from 'convex/values';
import type { Doc, Id, TableNames } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation, mutation } from './_generated/server';
import { isOwnerAccessKey, requireOwnerAccess } from './lib/nodeslideAccess';
import { findDeckRow } from './lib/nodeslideData';
import {
  type NodeSlideStoredRow,
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

/**
 * The size envelope for one whole-workspace erasure.
 *
 * Without it the ceiling is whatever Convex's own transaction limits happen to
 * be: real, but unnamed, untested, and reported to the caller as a platform
 * error about documents scanned rather than as a product rule. These two
 * numbers make the cliff a stated one — measured before the first write, so a
 * workspace that does not fit is refused whole instead of attempted and undone.
 *
 * The values match the export envelope's intent at half its size
 * (`NODESLIDE_DATA_EXPORT_MAX_RECORDS` is 8_000 / 8 MiB): an export pays only
 * read bandwidth, while an erasure pays read *and* write bandwidth for every
 * row plus the file-storage deletes hanging off it, so it gets the tighter
 * half of the same budget. A workspace larger than this needs a durable
 * tombstone/batch workflow that can resume across transactions; until that
 * exists, refusing is the honest answer.
 */
export const NODESLIDE_DECK_ERASURE_MAX_RECORDS = 4_000;
export const NODESLIDE_DECK_ERASURE_MAX_BYTES = 4 * 1024 * 1024;

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
 * One unit of the plan: either a group of rows read from a table, or one of the
 * two anchors, which are addressed by row id rather than by a scan.
 */
type ErasureStep =
  | {
      readonly kind: 'rows';
      readonly label: string;
      readonly rows: readonly NodeSlideStoredRow[];
      readonly storageFields: readonly string[];
    }
  | { readonly kind: 'anchor'; readonly label: string; readonly rowId: Id<TableNames> };

/**
 * The complete deletion set, measured. Producing one of these performs reads
 * only; nothing in the plan phase may write, which is what lets the envelope be
 * enforced before anything is destroyed.
 */
interface WorkspaceErasurePlan {
  readonly steps: readonly ErasureStep[];
  readonly records: number;
  readonly bytes: number;
}

/** Mutable accumulator threaded through the plan phase. */
interface ErasureBudget {
  records: number;
  bytes: number;
}

/**
 * How many rows the next read is allowed to return: the remaining headroom plus
 * one. The extra row is deliberate — it is how an over-limit table is *seen*
 * without reading past the envelope to find out.
 */
function nextErasureLimit(budget: ErasureBudget): number {
  return Math.max(1, NODESLIDE_DECK_ERASURE_MAX_RECORDS - budget.records + 1);
}

/**
 * Charges one group of rows against both ceilings. Throws on either, which in
 * the plan phase means the whole erasure is refused with nothing written.
 */
function chargeErasureRows(budget: ErasureBudget, rows: readonly NodeSlideStoredRow[]): void {
  if (rows.length > NODESLIDE_DECK_ERASURE_MAX_RECORDS - budget.records) {
    throw new Error(
      `NodeSlide workspace erasure refused: the complete erasure set exceeds the atomic limit of ${NODESLIDE_DECK_ERASURE_MAX_RECORDS} records. Nothing was deleted.`,
    );
  }
  budget.records += rows.length;
  for (const row of rows) budget.bytes += getConvexSize(row as unknown as Value);
  if (budget.bytes > NODESLIDE_DECK_ERASURE_MAX_BYTES) {
    throw new Error(
      `NodeSlide workspace erasure refused: the complete erasure set exceeds the atomic limit of ${NODESLIDE_DECK_ERASURE_MAX_BYTES} bytes. Nothing was deleted.`,
    );
  }
}

/**
 * Walks the derived contract and measures what it finds. There is no table list
 * in this function, and that is the point: the set of things erased is whatever
 * `schema.ts` says hangs off a deck, resolved at runtime.
 *
 * Reads only. Every `take` is bounded by the remaining envelope, so the read
 * set of a refused erasure is bounded by the envelope too — a workspace ten
 * times too large costs the same one over-limit read as one row too large.
 */
async function planWorkspaceErasure(
  ctx: MutationCtx,
  deck: Doc<'nodeslide_decks'>,
): Promise<WorkspaceErasurePlan> {
  const budget: ErasureBudget = { records: 0, bytes: 0 };
  const steps: ErasureStep[] = [];

  for (const entry of NODESLIDE_ERASURE_CONTRACT) {
    if (entry.scope.kind === 'deck') {
      chargeErasureRows(budget, [deck as unknown as NodeSlideStoredRow]);
      steps.push({ kind: 'anchor', label: entry.label, rowId: deck._id });
      continue;
    }
    if (entry.scope.kind === 'project') {
      const project = await ctx.db.get(deck.projectRowId);
      chargeErasureRows(budget, project ? [project as unknown as NodeSlideStoredRow] : []);
      steps.push({ kind: 'anchor', label: entry.label, rowId: deck.projectRowId });
      continue;
    }
    const value = nodeSlideScopeValue(entry, deck);
    if (value === null) continue;
    const rows = await takeNodeSlideScopedRows(ctx, entry, value, nextErasureLimit(budget));
    chargeErasureRows(budget, rows);
    steps.push({
      kind: 'rows',
      label: entry.label,
      rows,
      storageFields: NODESLIDE_ERASURE_STORAGE_FIELDS.get(entry.table) ?? [],
    });
  }

  await planJobDerivedRows(ctx, deck.id, budget, steps);

  return { steps, records: budget.records, bytes: budget.bytes };
}

/**
 * Applies a measured plan. Everything this function touches was already read
 * and counted, so there is no discovery left to do and therefore no way to
 * learn halfway through that the workspace was too large.
 */
async function applyWorkspaceErasure(
  ctx: MutationCtx,
  plan: WorkspaceErasurePlan,
): Promise<DeletedCounts> {
  const counts: DeletedCounts = {};
  for (const step of plan.steps) {
    if (step.kind === 'anchor') {
      await ctx.db.delete(step.rowId);
      counts[step.label] = (counts[step.label] ?? 0) + 1;
      continue;
    }
    for (const row of step.rows) {
      // Blobs first. If the row went first and the storage delete then threw,
      // the bytes would survive with nothing left pointing at them.
      await deleteRowStorageObjects(ctx, row, step.storageFields);
      await ctx.db.delete(row._id);
    }
    if (step.rows.length > 0) counts[step.label] = (counts[step.label] ?? 0) + step.rows.length;
  }
  return counts;
}

/**
 * Measures the workspace, refuses it if it does not fit, and only then deletes.
 * The two phases are separate functions so the ordering is structural rather
 * than a comment: `planWorkspaceErasure` has no write in it to get wrong.
 */
async function deleteWorkspaceRows(
  ctx: MutationCtx,
  deck: Doc<'nodeslide_decks'>,
): Promise<DeletedCounts> {
  const projectDecks = await ctx.db
    .query('nodeslide_decks')
    .withIndex('by_project_row', (index) => index.eq('projectRowId', deck.projectRowId))
    .take(2);
  if (projectDecks.length !== 1 || projectDecks[0]?._id !== deck._id) {
    throw new Error('NodeSlide project retention scope is not one workspace.');
  }

  const counts = await applyWorkspaceErasure(ctx, await planWorkspaceErasure(ctx, deck));

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
 *
 * This runs in the plan phase, which is also what makes the run lookup below
 * correct: while this was a delete-as-you-go sweep it ran *after* the
 * schema-derived pass had already deleted every run on the deck, so the read
 * returned nothing and a budget owned only by a run was never erased. Reading
 * before any write is what the comment there always claimed and now describes.
 */
async function planJobDerivedRows(
  ctx: MutationCtx,
  deckId: string,
  budget: ErasureBudget,
  steps: ErasureStep[],
): Promise<void> {
  // No `storageFields` on any derived table: none of them declares a
  // `v.id('_storage')` column, and the contract is what would say otherwise.
  const push = (label: string, rows: readonly NodeSlideStoredRow[]) => {
    chargeErasureRows(budget, rows);
    if (rows.length > 0) steps.push({ kind: 'rows', label, rows, storageFields: [] });
  };

  const jobs = await ctx.db
    .query('nodeslide_agent_jobs')
    .withIndex('by_result_deck', (index) => index.eq('resultDeckId', deckId))
    .take(nextErasureLimit(budget));

  // Read here rather than trusted from the schema-derived pass because a run
  // can own a budget no job ever referenced.
  const runs = await ctx.db
    .query('nodeslide_agent_runs')
    .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
    .take(nextErasureLimit(budget));

  const budgetIds = new Set<string>();
  for (const job of jobs) if (job.budgetId) budgetIds.add(job.budgetId);
  for (const run of runs) if (run.budgetId) budgetIds.add(run.budgetId);

  for (const job of jobs) {
    const sessionId = nodeslideStableId('nsession', job.id);

    push(
      'durableSessionEvents',
      await ctx.db
        .query('nodeslide_durable_session_events')
        .withIndex('by_session_job', (index) =>
          index.eq('sessionId', sessionId).eq('jobId', job.id),
        )
        .take(nextErasureLimit(budget)),
    );
    push(
      'durableJobJournalEntries',
      await ctx.db
        .query('nodeslide_durable_job_journal_entries')
        .withIndex('by_binding_sequence', (index) =>
          index.eq('sessionId', sessionId).eq('jobId', job.id),
        )
        .take(nextErasureLimit(budget)),
    );
    push(
      'durableModelResultReplays',
      await ctx.db
        .query('nodeslide_durable_model_result_replays')
        .withIndex('by_exact_binding', (index) =>
          index.eq('sessionId', sessionId).eq('jobId', job.id),
        )
        .take(nextErasureLimit(budget)),
    );
    push(
      'durableSessions',
      await ctx.db
        .query('nodeslide_durable_sessions')
        .withIndex('by_stable_id', (index) => index.eq('id', sessionId))
        .take(2),
    );
    push('agentJobs', [job as unknown as NodeSlideStoredRow]);
  }

  for (const budgetId of budgetIds) {
    push(
      'billableCalls',
      await ctx.db
        .query('nodeslide_billable_calls')
        .withIndex('by_budget_call', (index) => index.eq('budgetId', budgetId))
        .take(nextErasureLimit(budget)),
    );
    push(
      'budgetEvents',
      await ctx.db
        .query('nodeslide_budget_events')
        .withIndex('by_budget_sequence', (index) => index.eq('budgetId', budgetId))
        .take(nextErasureLimit(budget)),
    );
    push(
      'runBudgets',
      await ctx.db
        .query('nodeslide_run_budgets')
        .withIndex('by_stable_id', (index) => index.eq('id', budgetId))
        .take(2),
    );
  }
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
