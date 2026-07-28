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
 * The atomic erasure envelope, ported from parity's
 * `convex/lib/nodeslideDeckDeletion.ts` with its fail-closed semantics intact.
 *
 * Convex currently permits larger transactions, but deletion deliberately
 * reserves substantial headroom for reads, index ranges, and platform changes.
 * Decks beyond either bound are not partially erased.
 *
 * Porting the two constants alone would have changed nothing, which is why the
 * erasure contract recorded them as the one part of parity's deletion module
 * this repository had NOT superseded. What makes them real is the wiring below:
 * every read in `deleteWorkspaceRows` is now taken against the remaining record
 * budget rather than collected without limit, and the whole set is measured
 * before the first `ctx.db.delete`. A deck that does not fit is refused with
 * zero rows written, instead of being erased down to whatever Convex's own read
 * limits happened to allow and then certified `retentionSafe: true`.
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
 * Accumulates the erasure set against the atomic envelope.
 *
 * `admit` is called during the collection phase only, so the first breach
 * throws before any row or blob has been written. `nextLimit` returns one more
 * than the remaining record budget, which is what makes an oversized table
 * detectable: a `take` that comes back full has, by construction, exceeded the
 * budget, while a bare `take(remaining)` would silently look like a fit.
 */
class NodeSlideErasureEnvelope {
  private records = 0;
  private bytes = 0;

  nextLimit(): number {
    return Math.max(1, NODESLIDE_DECK_ERASURE_MAX_RECORDS - this.records + 1);
  }

  admit(rows: readonly unknown[]): void {
    if (this.records + rows.length > NODESLIDE_DECK_ERASURE_MAX_RECORDS) {
      throw new Error(
        `NodeSlide deck deletion failed closed: the complete erasure set exceeds the atomic limit of ${NODESLIDE_DECK_ERASURE_MAX_RECORDS} records; no records were deleted.`,
      );
    }
    this.records += rows.length;
    for (const row of rows) this.bytes += getConvexSize(row as Value);
    if (this.bytes > NODESLIDE_DECK_ERASURE_MAX_BYTES) {
      throw new Error(
        `NodeSlide deck deletion failed closed: the complete erasure set exceeds the atomic limit of ${NODESLIDE_DECK_ERASURE_MAX_BYTES} bytes; no records were deleted.`,
      );
    }
  }
}

/** One collected group, held between the measuring phase and the writing phase. */
interface NodeSlideErasureGroup {
  readonly label: string;
  readonly rows: readonly NodeSlideStoredRow[];
  readonly storageFields: readonly string[];
}

/**
 * Walks the derived contract. There is no table list in this function, and
 * that is the point: the set of things erased is whatever `schema.ts` says
 * hangs off a deck, resolved at runtime.
 *
 * The pass is split in two. Everything is READ and measured first; nothing is
 * written until the whole set is known to fit the atomic envelope. A deletion
 * that cannot complete has to leave the deck exactly as it found it, because a
 * half-erased deck with a green receipt is worse than a refusal.
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

  // ---- Phase 1: collect and measure. No writes below this line. ----
  const envelope = new NodeSlideErasureEnvelope();
  const project = await ctx.db.get(deck.projectRowId);
  // The two anchors are charged first so their bytes cannot be crowded out by a
  // child table and leave the deck row itself outside the measured set.
  envelope.admit(project === null ? [deck] : [deck, project]);

  const groups: NodeSlideErasureGroup[] = [];
  for (const entry of NODESLIDE_ERASURE_CONTRACT) {
    if (entry.scope.kind === 'deck' || entry.scope.kind === 'project') continue;
    const value = nodeSlideScopeValue(entry, deck);
    if (value === null) continue;
    const rows = await takeNodeSlideScopedRows(ctx, entry, value, envelope.nextLimit());
    envelope.admit(rows);
    if (rows.length > 0) {
      groups.push({
        label: entry.label,
        rows,
        storageFields: NODESLIDE_ERASURE_STORAGE_FIELDS.get(entry.table) ?? [],
      });
    }
  }

  const { groups: derived, budgetIds } = await collectJobDerivedRows(ctx, deck.id, envelope);

  // ---- Phase 2: write. The set is known to fit; every refusal already threw. ----
  for (const group of groups) {
    for (const row of group.rows) {
      // Blobs first. If the row went first and the storage delete then threw,
      // the bytes would survive with nothing left pointing at them.
      await deleteRowStorageObjects(ctx, row, group.storageFields);
      await ctx.db.delete(row._id);
    }
    counts[group.label] = group.rows.length;
  }

  for (const group of derived) {
    for (const row of group.rows) {
      await deleteRowStorageObjects(ctx, row, group.storageFields);
      await ctx.db.delete(row._id);
    }
    if (group.rows.length > 0) {
      counts[group.label] = (counts[group.label] ?? 0) + group.rows.length;
    }
  }

  for (const entry of NODESLIDE_ERASURE_CONTRACT) {
    if (entry.scope.kind === 'deck') {
      await ctx.db.delete(deck._id);
      counts[entry.label] = 1;
    }
    if (entry.scope.kind === 'project') {
      await ctx.db.delete(deck.projectRowId);
      counts[entry.label] = 1;
    }
  }

  await assertNoStrandedBudgetRows(ctx, budgetIds);

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
 * The tables `collectJobDerivedRows` below actually gathers for deletion. Written by hand
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
 * The derived pass deletes rows by id and follows no storage pointers, because
 * no table it sweeps has one. That is true today and nothing enforces it, which
 * is the same shape of latent hole the erasure contract exists to prevent: the
 * day a job or replay row gains a `v.id('_storage')` column, its blobs would
 * outlive the deck with no row left pointing at them and the receipt would
 * still read `retentionSafe: true`.
 *
 * So it is asserted at module load rather than trusted. Whoever adds that
 * column gets a failure here, in every test and every deploy, and has to teach
 * `collectJobDerivedRows` to carry the field list — the same treatment the
 * schema-derived path already gets from `NODESLIDE_ERASURE_STORAGE_FIELDS`.
 */
{
  const withBlobs = DERIVED_SWEEP_TABLES.filter(
    (table) => nodeSlideStorageIdFields(schema as unknown as NodeSlideSchemaLike, table).length > 0,
  );
  if (withBlobs.length > 0) {
    throw new Error(
      `NodeSlide derived erasure sweep would strand stored files: ${withBlobs.join(', ')} now declare v.id('_storage') fields, and the derived pass deletes rows without following them. Carry the storage fields into collectJobDerivedRows before shipping this schema.`,
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
 * This function only READS. It hands its groups back to `deleteWorkspaceRows`
 * so that a derived table breaching the envelope refuses the whole erasure
 * before the schema-derived rows have been written — the derived pass runs last
 * and would otherwise be the one place a partial delete could still occur.
 *
 * It also hands back the budget ids it resolved. They are the one thing in this
 * traversal that cannot be recomputed after the write phase, because they come
 * from `job.budgetId` and the jobs are deleted in that phase. See
 * `assertNoStrandedBudgetRows`.
 */
async function collectJobDerivedRows(
  ctx: MutationCtx,
  deckId: string,
  envelope: NodeSlideErasureEnvelope,
): Promise<{ groups: NodeSlideErasureGroup[]; budgetIds: ReadonlySet<string> }> {
  const groups: NodeSlideErasureGroup[] = [];
  const admit = (label: string, rows: readonly { _id: Id<TableNames> }[]) => {
    envelope.admit(rows);
    if (rows.length > 0) {
      groups.push({ label, rows: rows as readonly NodeSlideStoredRow[], storageFields: [] });
    }
  };
  /** Never read more than the envelope can still afford to delete. */
  const sweepLimit = () => Math.min(DERIVED_SWEEP_LIMIT, envelope.nextLimit());

  // Jobs keep `sweepLimit()`. An uncollected job is not deleted by anything —
  // `admit('agentJobs', [job])` below is its only deleter — so it survives the
  // transaction, `countJobDerivedRows` finds it by `by_result_deck`, and the
  // receipt refuses to claim success. Incremental is safe precisely because
  // the residue stays reachable.
  const jobs = await ctx.db
    .query('nodeslide_agent_jobs')
    .withIndex('by_result_deck', (index) => index.eq('resultDeckId', deckId))
    .take(sweepLimit());

  // Runs do NOT keep it, for the same reason the budget child tables below do
  // not. Runs are deck-scoped, so the schema-derived pass deletes ALL of them
  // against the envelope; this read only harvests their budget ids. Capping it
  // at `DERIVED_SWEEP_LIMIT` while the deleter is uncapped means run 513's
  // budget id is never collected, its run row is deleted anyway, and — if no
  // job referenced that budget — the ledger is stranded behind an id nothing
  // can produce again, under `remainingDeckRows: 0`. Reading against the
  // envelope makes the two passes agree: either both see the whole set, or
  // `admit` refuses the erasure with nothing written.
  const runs = await ctx.db
    .query('nodeslide_agent_runs')
    .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
    .take(envelope.nextLimit());

  const budgetIds = new Set<string>();
  for (const job of jobs) if (job.budgetId) budgetIds.add(job.budgetId);
  for (const run of runs) if (run.budgetId) budgetIds.add(run.budgetId);

  for (const job of jobs) {
    const sessionId = nodeslideStableId('nsession', job.id);

    admit(
      'durableSessionEvents',
      await ctx.db
        .query('nodeslide_durable_session_events')
        .withIndex('by_session_job', (index) =>
          index.eq('sessionId', sessionId).eq('jobId', job.id),
        )
        .take(sweepLimit()),
    );

    admit(
      'durableJobJournalEntries',
      await ctx.db
        .query('nodeslide_durable_job_journal_entries')
        .withIndex('by_binding_sequence', (index) =>
          index.eq('sessionId', sessionId).eq('jobId', job.id),
        )
        .take(sweepLimit()),
    );

    admit(
      'durableModelResultReplays',
      await ctx.db
        .query('nodeslide_durable_model_result_replays')
        .withIndex('by_exact_binding', (index) =>
          index.eq('sessionId', sessionId).eq('jobId', job.id),
        )
        .take(sweepLimit()),
    );

    admit(
      'durableSessions',
      await ctx.db
        .query('nodeslide_durable_sessions')
        .withIndex('by_stable_id', (index) => index.eq('id', sessionId))
        .take(2),
    );

    admit('agentJobs', [job]);
  }

  // The budget child tables are read against the ENVELOPE, not `sweepLimit()`.
  //
  // `DERIVED_SWEEP_LIMIT` is sound for the job-anchored tables because a job
  // that does not fit one transaction survives it, and the next call re-derives
  // everything hanging off that surviving row. The budget tables have no such
  // anchor: their id comes from `job.budgetId`, and the job is deleted in this
  // same pass. A `take(512)` that came back full would therefore strand rows
  // 513+ behind an id nothing can produce again — permanently invisible to
  // `countJobDerivedRows`, under a receipt reporting `remainingDeckRows: 0` and
  // `retentionSafe: true`.
  //
  // `envelope.nextLimit()` returns one more than the remaining budget, so an
  // over-large ledger comes back full, breaches `admit`, and refuses the whole
  // erasure with zero rows written. That is the same failure this module already
  // chose for an over-large deck, reached from the one direction where an
  // incremental sweep cannot be made correct.
  for (const budgetId of budgetIds) {
    admit(
      'billableCalls',
      await ctx.db
        .query('nodeslide_billable_calls')
        .withIndex('by_budget_call', (index) => index.eq('budgetId', budgetId))
        .take(envelope.nextLimit()),
    );

    admit(
      'budgetEvents',
      await ctx.db
        .query('nodeslide_budget_events')
        .withIndex('by_budget_sequence', (index) => index.eq('budgetId', budgetId))
        .take(envelope.nextLimit()),
    );

    admit(
      'runBudgets',
      await ctx.db
        .query('nodeslide_run_budgets')
        .withIndex('by_stable_id', (index) => index.eq('id', budgetId))
        .take(2),
    );
  }

  return { groups, budgetIds };
}

/**
 * Re-reads the derived tables after the sweep. The delete loop's own arithmetic
 * is not evidence: it counts what it decided to visit, which is exactly the
 * quantity a traversal bug gets wrong.
 *
 * It anchors on the job row, which is what every other derived table hangs off,
 * and that is sufficient for all of them BUT the budget cluster — see
 * `assertNoStrandedBudgetRows` for the one case this cannot see.
 */
async function countJobDerivedRows(ctx: MutationCtx, deckId: string): Promise<number> {
  const jobs = await ctx.db
    .query('nodeslide_agent_jobs')
    .withIndex('by_result_deck', (index) => index.eq('resultDeckId', deckId))
    .take(1);
  return jobs.length;
}

/**
 * The blind spot in the function above, closed at the only moment it can be.
 *
 * `countJobDerivedRows` re-derives a deck's derived rows through
 * `by_result_deck` on `nodeslide_agent_jobs`. Every derived table is reachable
 * that way except the budget cluster: a run budget has no `deckId` and no
 * `jobId`: it is addressed only by the id stored in `job.budgetId`, and the
 * write phase deletes the job. Once that row is gone the id cannot be produced
 * by any deck-anchored query, so a surviving `nodeslide_run_budgets`,
 * `nodeslide_billable_calls` or `nodeslide_budget_events` row is not merely
 * uncounted — it is unreachable, and the receipt says `remainingDeckRows: 0`
 * and `retentionSafe: true` over real user spend data.
 *
 * So the ids are carried out of the collection phase and checked here, after
 * the writes and while they still exist. Being inside the same mutation, a
 * throw rolls the whole erasure back, which is the same fail-closed posture the
 * envelope takes: nothing deleted beats something deleted and mis-certified.
 *
 * HONEST STATUS: this has no reachable trigger today, and deleting it does not
 * turn any test red. Both known strand paths were closed at their source
 * instead — the run read and the budget child reads now use the envelope rather
 * than `DERIVED_SWEEP_LIMIT`, so the collection and deletion passes cannot
 * disagree. It is kept because every other derived table has
 * `countJobDerivedRows` as its backstop and the budget cluster structurally
 * cannot: its id dies with the job. Without this, a future traversal change
 * that reintroduces a gap produces a green receipt over surviving spend data
 * and no failing test. With it, that change rolls back and says so. The cost is
 * one indexed `.first()` per table per budget id, and the count of budget ids
 * is itself bounded by the envelope.
 *
 * Until the budget ledger had a writer, nothing ever inserted these rows and
 * none of this was reachable. `nodeslideJobs.startCreateDeck` /
 * `startEditProposal` now open a ledger row for every provider-backed job.
 */
async function assertNoStrandedBudgetRows(
  ctx: MutationCtx,
  budgetIds: ReadonlySet<string>,
): Promise<void> {
  for (const budgetId of budgetIds) {
    const survivors = await Promise.all([
      ctx.db
        .query('nodeslide_run_budgets')
        .withIndex('by_stable_id', (index) => index.eq('id', budgetId))
        .first(),
      ctx.db
        .query('nodeslide_billable_calls')
        .withIndex('by_budget_call', (index) => index.eq('budgetId', budgetId))
        .first(),
      ctx.db
        .query('nodeslide_budget_events')
        .withIndex('by_budget_sequence', (index) => index.eq('budgetId', budgetId))
        .first(),
    ]);
    if (survivors.some((row) => row !== null)) {
      throw new Error(
        'NodeSlide deck deletion failed closed: the erasure left run-budget rows that no deck-anchored query can reach; no records were deleted.',
      );
    }
  }
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
