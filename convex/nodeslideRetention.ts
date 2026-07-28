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

/**
 * The batch ceilings for `deleteExpiredProductionProbeWorkspaces`, which is the
 * one caller that erases many decks inside a single transaction.
 *
 * The per-deck envelope above is a *unit* bound. It says nothing about a caller
 * that applies it ten times over with a fresh budget each time: ten decks each
 * sitting just inside 4_000 records / 4 MiB totalled 40_000 records / 40 MiB in
 * one transaction, and the per-deck refusal — honest on its own terms — reported
 * nothing at all about the sum. These two budgets are shared across the whole
 * sweep so the transaction has a ceiling, not just each deck in it.
 *
 * They are separate numbers because the sweep does two separable things:
 *
 *   DELETED bounds the write set. It is exactly the per-deck envelope, because
 *   the transaction the batch shares is the same kind of transaction one deck
 *   gets, and a batch has no claim to more room than the unit it is made of.
 *
 *   PLANNED bounds the read set, and is charged for every deck the sweep plans
 *   INCLUDING the ones it refuses. Discovering that a deck is oversized costs a
 *   full envelope of reads and writes nothing; without a separate ceiling those
 *   reads are either uncounted (the batch read set goes unbounded again, one
 *   refusal at a time) or counted against DELETED (the first oversized deck
 *   consumes the whole budget, the sweep deletes nothing, and the next run does
 *   the same thing forever — the wedge, moved rather than fixed). 2x leaves room
 *   for exactly one full-size refusal plus a full batch of healthy decks, which
 *   is the shape of the defect being closed.
 */
export const NODESLIDE_PROBE_SWEEP_MAX_WORKSPACES = 10;
export const NODESLIDE_PROBE_SWEEP_MAX_DELETED_RECORDS = NODESLIDE_DECK_ERASURE_MAX_RECORDS;
export const NODESLIDE_PROBE_SWEEP_MAX_DELETED_BYTES = NODESLIDE_DECK_ERASURE_MAX_BYTES;
export const NODESLIDE_PROBE_SWEEP_MAX_PLANNED_RECORDS = 2 * NODESLIDE_DECK_ERASURE_MAX_RECORDS;
export const NODESLIDE_PROBE_SWEEP_MAX_PLANNED_BYTES = 2 * NODESLIDE_DECK_ERASURE_MAX_BYTES;

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

/**
 * Backstop for a runner crash before its finally block can call the cleanup
 * mutation — and the one caller that erases many decks in a single transaction.
 *
 * It plans each deck before it deletes any of it, against two budgets shared by
 * the whole batch, and every outcome is decided in that read phase:
 *
 *   fits  -> delete it, charge the shared delete budget.
 *   oversized -> skip it, record it, keep going. The deck's own envelope is full
 *     and it still did not fit, so no future run would fit it either; failing
 *     the batch over it is what wedged the sweep, because the next run
 *     re-selects the same deck (the index is expiry-ordered) and fails the same
 *     way forever.
 *   would not fit what is LEFT -> stop the batch here, cleanly. Everything
 *     already deleted stands, this deck and the rest survive, and the next run
 *     starts with a full budget. A partial batch is the correct answer; a
 *     40_000-record transaction is not.
 *
 * None of this is a try/catch. A caught write error would arrive after the
 * transaction was already doomed, so "skip and continue" would be a lie told on
 * top of a rollback — which is precisely why the refusal had to become a value
 * produced before the first delete.
 *
 * Still throws, and still rolls the whole batch back, when an integrity
 * assertion fires (`scope is not one workspace`, a stranded budget row, a
 * non-zero residue). Those say the erasure model itself is wrong about this
 * data, and skipping ahead under that condition would be the unsafe direction.
 */
export const deleteExpiredProductionProbeWorkspaces = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query('nodeslide_decks')
      .withIndex('by_production_probe_expiry', (index) =>
        index.gt('productionProbeExpiresAt', 0).lt('productionProbeExpiresAt', now),
      )
      .take(NODESLIDE_PROBE_SWEEP_MAX_WORKSPACES);

    const deleteBudget = new NodeSlideErasureEnvelope(
      NODESLIDE_PROBE_SWEEP_MAX_DELETED_RECORDS,
      NODESLIDE_PROBE_SWEEP_MAX_DELETED_BYTES,
    );
    const planBudget = new NodeSlideErasureEnvelope(
      NODESLIDE_PROBE_SWEEP_MAX_PLANNED_RECORDS,
      NODESLIDE_PROBE_SWEEP_MAX_PLANNED_BYTES,
    );

    let deletedWorkspaceCount = 0;
    let deletedRowCount = 0;
    /** Bounded by the `take` above; it can never hold more than one batch. */
    const skippedWorkspaces: Array<{ deckId: string; reason: string; detail: string }> = [];
    let deferredWorkspaceCount = 0;
    let stopReason: 'drained' | 'deleteBudgetExhausted' | 'planBudgetExhausted' = 'drained';

    for (let index = 0; index < rows.length; index += 1) {
      const deck = rows[index];
      if (!deck || !deck.productionProbeCleanupDigest) continue;

      const read = await readWorkspaceErasureSet(ctx, deck, planBudget);
      if (!read.ok) {
        if (read.refusal === 'oversized') {
          // Nothing has been written for this deck — the refusal came out of the
          // read phase — so the batch is still clean and can carry on.
          skippedWorkspaces.push({
            deckId: deck.id,
            reason: 'oversized',
            detail: read.detail,
          });
          continue;
        }
        stopReason = 'planBudgetExhausted';
        deferredWorkspaceCount = rows.length - index;
        break;
      }

      if (!deleteBudget.admitMeasured(read.set.records, read.set.bytes)) {
        stopReason = 'deleteBudgetExhausted';
        deferredWorkspaceCount = rows.length - index;
        break;
      }

      const counts = await writeWorkspaceErasureSet(ctx, deck, read.set);
      const remainingRows = await countDeckRows(ctx, deck.id);
      const project = await ctx.db.get(deck.projectRowId);
      if (remainingRows !== 0 || project !== null) {
        throw new Error('Expired NodeSlide production probe cleanup did not reach zero rows.');
      }
      deletedWorkspaceCount += 1;
      deletedRowCount += Object.values(counts).reduce((sum, count) => sum + count, 0);
    }

    return {
      deletedWorkspaceCount,
      deletedRowCount,
      skippedWorkspaceCount: skippedWorkspaces.length,
      skippedWorkspaces,
      deferredWorkspaceCount,
      stopReason,
      scannedAt: now,
    };
  },
});

/**
 * Accumulates an erasure set against one pair of ceilings.
 *
 * `nextLimit` returns one more than the remaining record budget, which is what
 * makes an oversized table detectable: a `take` that comes back full has, by
 * construction, exceeded the budget, while a bare `take(remaining)` would
 * silently look like a fit.
 *
 * It RECORDS a breach rather than throwing it. That is the change the batch
 * caller needed and could not get from a throw: in Convex a mutation is one
 * transaction, so by the time a write has thrown the transaction is already
 * doomed and "skip this deck and carry on" is not expressible downstream of it.
 * The breach has to be a value, produced in the read phase, that the caller can
 * still decide about. `deleteWorkspaceRows` turns it straight back into the same
 * exception it always threw, so the single-deck callers are unchanged; the batch
 * reads it as data.
 */
class NodeSlideErasureEnvelope {
  private records = 0;
  private bytes = 0;
  private breach: string | null = null;

  constructor(
    private readonly maxRecords: number,
    private readonly maxBytes: number,
  ) {}

  get usedRecords(): number {
    return this.records;
  }

  get usedBytes(): number {
    return this.bytes;
  }

  /** The refusal message, or null while the set still fits. */
  get breachMessage(): string | null {
    return this.breach;
  }

  nextLimit(): number {
    return Math.max(1, this.maxRecords - this.records + 1);
  }

  admit(rows: readonly unknown[]): boolean {
    let bytes = 0;
    for (const row of rows) bytes += getConvexSize(row as Value);
    return this.admitMeasured(rows.length, bytes);
  }

  /**
   * Charges an already-measured set. The batch's delete budget uses this: it is
   * handed the totals a deck's own envelope computed, so the rows are sized once
   * and the two budgets cannot disagree about how big the deck was.
   */
  admitMeasured(records: number, bytes: number): boolean {
    if (this.breach !== null) return false;
    if (this.records + records > this.maxRecords) {
      this.breach = `NodeSlide deck deletion failed closed: the complete erasure set exceeds the atomic limit of ${this.maxRecords} records; no records were deleted.`;
      return false;
    }
    this.records += records;
    this.bytes += bytes;
    if (this.bytes > this.maxBytes) {
      this.breach = `NodeSlide deck deletion failed closed: the complete erasure set exceeds the atomic limit of ${this.maxBytes} bytes; no records were deleted.`;
      return false;
    }
    return true;
  }
}

/**
 * One deck measured against its own envelope AND against the batch's shared
 * plan budget at the same time.
 *
 * Every read is capped by whichever ceiling is closer, so the sweep can never
 * read more than the batch allows in total, and a deck that breaches its OWN
 * (always fresh, always full) envelope is thereby distinguishable from one that
 * merely ran out of what this particular batch had left. That distinction is the
 * whole point:
 *
 *   deck envelope breached -> the deck cannot fit ANY transaction. Deferring it
 *     to the next run just reproduces the failure, so the sweep skips it and
 *     records it. This is the only classification that is safe to act on, and it
 *     is only reachable because the deck's own budget is full every time.
 *
 *   plan budget breached first -> we stopped reading early and genuinely do not
 *     know how big this deck is. Claiming "oversized" here would be a guess, so
 *     the sweep stops instead and the deck is re-planned next run. The first deck
 *     of a run always has the full plan budget, so it is always classified for
 *     real — which is what keeps the sweep making progress.
 */
class NodeSlideErasureMeter {
  constructor(
    private readonly deck: NodeSlideErasureEnvelope,
    private readonly plan: NodeSlideErasureEnvelope | null,
  ) {}

  nextLimit(): number {
    const deckLimit = this.deck.nextLimit();
    return this.plan === null ? deckLimit : Math.min(deckLimit, this.plan.nextLimit());
  }

  /**
   * The plan budget is charged even when the deck envelope refuses, because the
   * rows were read either way. A refusal that cost nothing to discover would let
   * the batch read set grow without bound one refused deck at a time.
   */
  admit(rows: readonly unknown[]): boolean {
    let bytes = 0;
    for (const row of rows) bytes += getConvexSize(row as Value);
    const planFits = this.plan === null || this.plan.admitMeasured(rows.length, bytes);
    const deckFits = this.deck.admitMeasured(rows.length, bytes);
    return planFits && deckFits;
  }

  /**
   * Deck first: a deck that overflowed its own full envelope is oversized no
   * matter what the plan budget also says, and that is the actionable answer.
   */
  refusal(): { kind: NodeSlideErasureRefusalKind; detail: string } | null {
    const deckBreach = this.deck.breachMessage;
    if (deckBreach !== null) return { kind: 'oversized', detail: deckBreach };
    const planBreach = this.plan?.breachMessage ?? null;
    if (planBreach !== null) return { kind: 'planBudgetExhausted', detail: planBreach };
    return null;
  }

  measured(): { records: number; bytes: number } {
    return { records: this.deck.usedRecords, bytes: this.deck.usedBytes };
  }
}

/**
 * Why a deck was not erased on this pass. Both are decided in the read phase,
 * before a single `ctx.db.delete` for that deck, which is the only place they
 * CAN be decided: a Convex mutation is one transaction, so a try/catch around
 * the write phase would be catching an error that has already poisoned it.
 */
type NodeSlideErasureRefusalKind = 'oversized' | 'planBudgetExhausted';

/** The measured, unwritten erasure set for one deck. */
interface NodeSlideErasureSet {
  readonly groups: readonly NodeSlideErasureGroup[];
  readonly derived: readonly NodeSlideErasureGroup[];
  readonly budgetIds: ReadonlySet<string>;
  readonly records: number;
  readonly bytes: number;
}

type NodeSlideErasureRead =
  | { readonly ok: true; readonly set: NodeSlideErasureSet }
  | { readonly ok: false; readonly refusal: NodeSlideErasureRefusalKind; readonly detail: string };

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
 * The pass is split in two, now literally: `readWorkspaceErasureSet` measures
 * and `writeWorkspaceErasureSet` writes. Nothing is written until the whole set
 * is known to fit the atomic envelope. A deletion that cannot complete has to
 * leave the deck exactly as it found it, because a half-erased deck with a green
 * receipt is worse than a refusal.
 *
 * This function is the single-deck composition of the two, and it restores the
 * throwing contract its callers were written against: the refusal the read phase
 * returns as a value is re-thrown here with the identical message.
 */
async function deleteWorkspaceRows(
  ctx: MutationCtx,
  deck: Doc<'nodeslide_decks'>,
): Promise<DeletedCounts> {
  const read = await readWorkspaceErasureSet(ctx, deck, null);
  if (!read.ok) throw new Error(read.detail);
  return await writeWorkspaceErasureSet(ctx, deck, read.set);
}

/**
 * Phase 1 in isolation: collect and measure. Nothing in here writes.
 *
 * Splitting it out is what makes a per-deck skip expressible at all. The batch
 * caller needs to know whether a deck fits BEFORE it starts deleting that deck's
 * rows, because a Convex mutation is a single transaction and there is no point
 * after the first `ctx.db.delete` at which "never mind, skip this one" still
 * means anything.
 *
 * `plan`, when supplied, is the batch's shared read budget; passing null makes
 * this a single-deck erasure measured against the per-deck envelope alone, which
 * is what the two owner-facing mutations do.
 */
async function readWorkspaceErasureSet(
  ctx: MutationCtx,
  deck: Doc<'nodeslide_decks'>,
  plan: NodeSlideErasureEnvelope | null,
): Promise<NodeSlideErasureRead> {
  const projectDecks = await ctx.db
    .query('nodeslide_decks')
    .withIndex('by_project_row', (index) => index.eq('projectRowId', deck.projectRowId))
    .take(2);
  if (projectDecks.length !== 1 || projectDecks[0]?._id !== deck._id) {
    // Deliberately NOT a refusal value. This is a data-integrity invariant, not
    // a size question: the sweep has found a project shell it cannot reason
    // about, and continuing past it would mean erasing the next deck under an
    // assumption this one just falsified. It throws, and the whole batch rolls
    // back, exactly as before.
    throw new Error('NodeSlide project retention scope is not one workspace.');
  }

  const meter = new NodeSlideErasureMeter(
    new NodeSlideErasureEnvelope(
      NODESLIDE_DECK_ERASURE_MAX_RECORDS,
      NODESLIDE_DECK_ERASURE_MAX_BYTES,
    ),
    plan,
  );
  const refused = (): NodeSlideErasureRead => {
    const refusal = meter.refusal();
    if (refusal === null) {
      throw new Error('NodeSlide erasure measurement reported no fit and no refusal.');
    }
    return { ok: false, refusal: refusal.kind, detail: refusal.detail };
  };

  const project = await ctx.db.get(deck.projectRowId);
  // The two anchors are charged first so their bytes cannot be crowded out by a
  // child table and leave the deck row itself outside the measured set.
  if (!meter.admit(project === null ? [deck] : [deck, project])) return refused();

  const groups: NodeSlideErasureGroup[] = [];
  for (const entry of NODESLIDE_ERASURE_CONTRACT) {
    if (entry.scope.kind === 'deck' || entry.scope.kind === 'project') continue;
    const value = nodeSlideScopeValue(entry, deck);
    if (value === null) continue;
    const rows = await takeNodeSlideScopedRows(ctx, entry, value, meter.nextLimit());
    if (!meter.admit(rows)) return refused();
    if (rows.length > 0) {
      groups.push({
        label: entry.label,
        rows,
        storageFields: NODESLIDE_ERASURE_STORAGE_FIELDS.get(entry.table) ?? [],
      });
    }
  }

  const collected = await collectJobDerivedRows(ctx, deck.id, meter);
  if (collected === null) return refused();

  const { records, bytes } = meter.measured();
  return {
    ok: true,
    set: { groups, derived: collected.groups, budgetIds: collected.budgetIds, records, bytes },
  };
}

/**
 * Phase 2 in isolation: write. The set arrives already known to fit, so every
 * refusal happened before this function was reachable.
 *
 * What still throws in here are integrity assertions, not size ones —
 * `assertNoStrandedBudgetRows` and the tenant re-read. Those are unchanged and
 * intentionally still poison the transaction: they fire when the erasure that
 * just ran left something behind, and there is no honest way to keep going.
 */
async function writeWorkspaceErasureSet(
  ctx: MutationCtx,
  deck: Doc<'nodeslide_decks'>,
  set: NodeSlideErasureSet,
): Promise<DeletedCounts> {
  const counts: DeletedCounts = {};
  const { groups, derived, budgetIds } = set;

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
  meter: NodeSlideErasureMeter,
): Promise<{ groups: NodeSlideErasureGroup[]; budgetIds: ReadonlySet<string> } | null> {
  const groups: NodeSlideErasureGroup[] = [];
  /**
   * Returns false on a breach instead of throwing, and every call site returns
   * `null` straight up when it does. The breach is still terminal for this deck
   * — it just travels back to the caller as a value now, so a batch can decide
   * what to do about it while the transaction is still clean.
   */
  const admit = (label: string, rows: readonly { _id: Id<TableNames> }[]): boolean => {
    if (!meter.admit(rows)) return false;
    if (rows.length > 0) {
      groups.push({ label, rows: rows as readonly NodeSlideStoredRow[], storageFields: [] });
    }
    return true;
  };
  /** Never read more than the envelope can still afford to delete. */
  const sweepLimit = () => Math.min(DERIVED_SWEEP_LIMIT, meter.nextLimit());

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
    .take(meter.nextLimit());

  const budgetIds = new Set<string>();
  for (const job of jobs) if (job.budgetId) budgetIds.add(job.budgetId);
  for (const run of runs) if (run.budgetId) budgetIds.add(run.budgetId);

  for (const job of jobs) {
    const sessionId = nodeslideStableId('nsession', job.id);

    const admitted =
      admit(
        'durableSessionEvents',
        await ctx.db
          .query('nodeslide_durable_session_events')
          .withIndex('by_session_job', (index) =>
            index.eq('sessionId', sessionId).eq('jobId', job.id),
          )
          .take(sweepLimit()),
      ) &&
      admit(
        'durableJobJournalEntries',
        await ctx.db
          .query('nodeslide_durable_job_journal_entries')
          .withIndex('by_binding_sequence', (index) =>
            index.eq('sessionId', sessionId).eq('jobId', job.id),
          )
          .take(sweepLimit()),
      ) &&
      admit(
        'durableModelResultReplays',
        await ctx.db
          .query('nodeslide_durable_model_result_replays')
          .withIndex('by_exact_binding', (index) =>
            index.eq('sessionId', sessionId).eq('jobId', job.id),
          )
          .take(sweepLimit()),
      ) &&
      admit(
        'durableSessions',
        await ctx.db
          .query('nodeslide_durable_sessions')
          .withIndex('by_stable_id', (index) => index.eq('id', sessionId))
          .take(2),
      ) &&
      admit('agentJobs', [job]);
    if (!admitted) return null;
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
    const admitted =
      admit(
        'billableCalls',
        await ctx.db
          .query('nodeslide_billable_calls')
          .withIndex('by_budget_call', (index) => index.eq('budgetId', budgetId))
          .take(meter.nextLimit()),
      ) &&
      admit(
        'budgetEvents',
        await ctx.db
          .query('nodeslide_budget_events')
          .withIndex('by_budget_sequence', (index) => index.eq('budgetId', budgetId))
          .take(meter.nextLimit()),
      ) &&
      admit(
        'runBudgets',
        await ctx.db
          .query('nodeslide_run_budgets')
          .withIndex('by_stable_id', (index) => index.eq('id', budgetId))
          .take(2),
      );
    if (!admitted) return null;
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
