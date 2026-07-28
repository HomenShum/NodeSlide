/**
 * The budget ledger has a writer again, and this file is what keeps that true.
 *
 * BEFORE this port, `convex/nodeslideJobs.ts` shipped a reader with no writer:
 * `getBudgetReceipt` stamped a `budgetId` on every provider-backed job row and
 * then returned `null` for every one of them, because `convex/nodeslideBudgets.ts`
 * — the only module that inserts into `nodeslide_run_budgets` — was not ported.
 * The three tables, their indexes, and their erasure classification were all
 * already here. Only the mutations were missing.
 *
 * So a port of this cluster that merely copies the file across would move eight
 * audit rows from MISSING to PORTED and change nothing an author can observe:
 * `getBudgetReceipt` would still return `null`, because nothing in this repo
 * would still be calling `create`. Parity calls it lazily from
 * `callNodeSlideBudgetedJson`, which is withheld here pending the model price
 * table. These tests fail if that wiring is removed, so the receipt cannot
 * silently go back to null.
 *
 * There is a second, sharper reason the wiring is not optional. Every terminal
 * transition in `nodeslideJobs.ts` calls `finalizeForJob`, and `finalizeForJob`
 * calls `requireBudget`, which THROWS `budget_not_found` on a missing row. So
 * landing the workflow module without a writer would not have left the receipt
 * merely null — it would have made every provider-backed job fail on its
 * completion mutation, after the deck had already been written. The last
 * describe block below pins exactly that.
 */
import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { nodeslideStableId } from './lib/nodeslideIds';
import { nodeSlideJobOwnerDigest } from './lib/nodeslideJobState';
import { NODESLIDE_OPENROUTER_BRIEF_CONSENT } from './lib/nodeslideValidators';
import * as budgets from './nodeslideBudgets';
import { NODESLIDE_JOB_SIBLING_MODULES, getBudgetReceipt, startCreateDeck } from './nodeslideJobs';

/** 43 URL-safe base64 characters — the shape `isOwnerAccessKey` accepts. */
const OWNER_ACCESS_KEY = 'A'.repeat(43);
const OTHER_ACCESS_KEY = 'B'.repeat(43);

type StoredRow = Record<string, unknown> & { _id: string; _creationTime: number };
type Filter = { field: string; value: unknown };

class MemoryIndex {
  readonly filters: Filter[] = [];
  eq(field: string, value: unknown): this {
    this.filters.push({ field, value });
    return this;
  }
  /** Range bounds do not narrow the in-memory scan; the equality filters do. */
  gt(_field: string, _value: unknown): this {
    return this;
  }
}

class MemoryQuery {
  private filters: readonly Filter[] = [];
  constructor(
    private readonly database: MemoryDatabase,
    private readonly tableName: string,
  ) {}
  withIndex(_indexName: string, configure: (index: MemoryIndex) => unknown): this {
    const index = new MemoryIndex();
    configure(index);
    this.filters = index.filters;
    return this;
  }
  order(_direction: 'asc' | 'desc'): this {
    return this;
  }
  async take(count: number): Promise<StoredRow[]> {
    return this.evaluate().slice(0, count);
  }
  async collect(): Promise<StoredRow[]> {
    return this.evaluate();
  }
  async first(): Promise<StoredRow | null> {
    return this.evaluate()[0] ?? null;
  }
  async unique(): Promise<StoredRow | null> {
    const rows = this.evaluate();
    if (rows.length > 1) throw new Error('Memory query was not unique.');
    return rows[0] ?? null;
  }
  private evaluate(): StoredRow[] {
    return this.database
      .rows(this.tableName)
      .filter((row) => this.filters.every((filter) => row[filter.field] === filter.value));
  }
}

class MemoryDatabase {
  private readonly tables = new Map<string, StoredRow[]>();
  private sequence = 0;

  query(tableName: string): MemoryQuery {
    return new MemoryQuery(this, tableName);
  }
  async insert(tableName: string, value: Record<string, unknown>): Promise<string> {
    this.sequence += 1;
    const row = {
      ...structuredClone(value),
      _id: `${tableName}:${this.sequence}`,
      _creationTime: this.sequence,
    };
    const rows = this.tables.get(tableName) ?? [];
    rows.push(row);
    this.tables.set(tableName, rows);
    return row._id;
  }
  async patch(rowId: string, value: Record<string, unknown>): Promise<void> {
    const located = this.find(rowId);
    if (!located) throw new Error(`Memory row ${rowId} was not found.`);
    Object.assign(located.row, structuredClone(value));
  }
  async get(rowId: string): Promise<StoredRow | null> {
    return this.find(rowId)?.row ?? null;
  }
  rows(tableName: string): StoredRow[] {
    return [...(this.tables.get(tableName) ?? [])];
  }
  private find(rowId: string): { tableName: string; row: StoredRow } | undefined {
    for (const [tableName, rows] of this.tables) {
      const row = rows.find((candidate) => candidate._id === rowId);
      if (row) return { tableName, row };
    }
    return undefined;
  }
}

type Handler = (ctx: unknown, args: Record<string, unknown>) => Promise<unknown>;

/** Convex wraps the handler; `_handler` is the raw function the runtime calls. */
function rawHandler(fn: unknown): Handler {
  const handler = (fn as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Expected a Convex function handler.');
  return handler as Handler;
}

/**
 * A ctx that records every `runMutation` by its resolved path and then runs the
 * real budget handler against the shared memory database. `internal` is
 * `anyApi`, so the reference the caller passes carries the module and function
 * name and nothing else — recording it is the only way to observe, from
 * outside, which sibling mutation the job code actually chose to call.
 */
function recordingContext(database: MemoryDatabase) {
  const calls: Array<{ path: string; args: Record<string, unknown> }> = [];
  const ctx = {
    db: database,
    runMutation: async (reference: unknown, args: Record<string, unknown>) => {
      const path = referencePath(reference);
      calls.push({ path, args });
      if (path === 'nodeslideBudgets:create') {
        return await rawHandler(budgets.create)(ctx, args);
      }
      if (path === 'nodeslideBudgets:finalizeForJob') {
        return await rawHandler(budgets.finalizeForJob)(ctx, args);
      }
      throw new Error(`Unstubbed runMutation: ${path}`);
    },
    runQuery: async () => {
      throw new Error('Unstubbed runQuery.');
    },
  };
  return { ctx: ctx as unknown as MutationCtx, calls };
}

/**
 * `anyApi` references are Proxies with no useful `toString`; `getFunctionName`
 * is Convex's own accessor for the dotted `module:function` path they carry.
 */
function referencePath(reference: unknown): string {
  return getFunctionName(reference as Parameters<typeof getFunctionName>[0]);
}

function readContext(database: MemoryDatabase): QueryCtx {
  return { db: database } as unknown as QueryCtx;
}

const CREATE_ARGS = {
  clientSessionId: 'client-session-budget-wiring',
  title: 'Quarterly board review',
  brief: {
    prompt: 'Draft a board review of the hiring plan.',
    audience: 'Board of directors',
    purpose: 'Approve the hiring plan',
    successCriteria: ['The board approves the plan'],
  },
  themeId: 'aurora',
  route: 'free',
  // A real metered route. This is what makes the run budgeted; a deterministic
  // brief never stamps a budgetId and never opens a ledger.
  providerMode: 'openrouter_free',
  providerConsent: NODESLIDE_OPENROUTER_BRIEF_CONSENT,
  ownerAccessKey: OWNER_ACCESS_KEY,
  idempotencyKey: 'idem-create-budget-wiring',
} as Record<string, unknown>;

const CREATE_JOB_ID = nodeslideStableId(
  'nodeslide_job',
  'create_deck',
  CREATE_ARGS.clientSessionId as string,
  CREATE_ARGS.idempotencyKey as string,
);
const CREATE_BUDGET_ID = nodeslideStableId('nsbudget', CREATE_JOB_ID);

const previousPublicCreation = process.env.NODESLIDE_PUBLIC_CREATION;

beforeEach(() => {
  // Bypass the private-preview admission code so these tests exercise the budget
  // wiring rather than the access gate. Every start-mutation case needs it.
  process.env.NODESLIDE_PUBLIC_CREATION = 'true';
});
afterEach(() => {
  if (previousPublicCreation === undefined) process.env.NODESLIDE_PUBLIC_CREATION = undefined;
  else process.env.NODESLIDE_PUBLIC_CREATION = previousPublicCreation;
});

describe('the budget ledger writer is actually reachable', () => {
  it('declares both newly landed sibling modules as present', () => {
    // `nodeslideJobRuntime.test.ts` checks this table against the directory.
    // This case states the intent: these two are the modules this port landed.
    expect(NODESLIDE_JOB_SIBLING_MODULES.nodeslideBudgets).toBe(true);
    expect(NODESLIDE_JOB_SIBLING_MODULES.nodeslideJobWorkflow).toBe(true);
  });

  it('opens a durable ledger row for a provider-backed create, before any other sibling call', async () => {
    const database = new MemoryDatabase();
    const { ctx, calls } = recordingContext(database);

    // The start mutation reaches a Convex component (`streaming.createStream`)
    // that no in-memory ctx can satisfy, so it throws. That is fine and is the
    // point: the budget must already be open by then, because `budgetId` is
    // minted and the ledger opened before the durable session is enqueued.
    await rawHandler(startCreateDeck)(ctx, CREATE_ARGS).catch(() => undefined);

    const created = calls.filter((call) => call.path === 'nodeslideBudgets:create');
    expect(
      created,
      'startCreateDeck must open the run budget; without it getBudgetReceipt is null forever and finalizeForJob throws',
    ).toHaveLength(1);
    expect(created[0]?.args.budgetId).toBe(CREATE_BUDGET_ID);
    expect(database.rows('nodeslide_run_budgets')).toHaveLength(1);
    expect(database.rows('nodeslide_run_budgets')[0]).toMatchObject({
      id: CREATE_BUDGET_ID,
      status: 'open',
    });
  });

  it('does not open a ledger row for a deterministic run, which carries no budgetId', async () => {
    const database = new MemoryDatabase();
    const { ctx, calls } = recordingContext(database);

    await rawHandler(startCreateDeck)(ctx, {
      ...CREATE_ARGS,
      providerMode: 'deterministic',
      providerConsent: undefined,
    }).catch(() => undefined);

    // A deterministic route never reaches a metered provider. Opening a ledger
    // for it would put a permanently-open zero-spend row on every free run.
    expect(calls.filter((call) => call.path === 'nodeslideBudgets:create')).toEqual([]);
    expect(database.rows('nodeslide_run_budgets')).toEqual([]);
  });
});

describe('getBudgetReceipt returns a real receipt instead of null', () => {
  /** The job row a started provider-backed create leaves behind. */
  function seedJobRow(database: MemoryDatabase, budgetId: string | undefined) {
    return database.insert('nodeslide_agent_jobs', {
      id: CREATE_JOB_ID,
      kind: 'create_deck',
      clientSessionId: CREATE_ARGS.clientSessionId,
      ownerDigest: nodeSlideJobOwnerDigest(OWNER_ACCESS_KEY),
      idempotencyKey: CREATE_ARGS.idempotencyKey,
      requestDigest: 'sha256:request',
      status: 'running',
      phase: 'generating',
      progress: 35,
      attempt: 1,
      maxAttempts: 3,
      streamId: 'stream-1',
      memoryIds: [],
      memoryDigests: [],
      ...(budgetId ? { budgetId } : {}),
      createdAt: 1,
      updatedAt: 1,
    });
  }

  it('is null while the ledger row is absent — the exact defect this port closes', async () => {
    const database = new MemoryDatabase();
    await seedJobRow(database, CREATE_BUDGET_ID);

    // The job row already claims a budget. Nothing wrote the ledger, so the
    // receipt is null. This is what every job returned before this port, and
    // it is why "the file was copied" is not the same as "the port landed".
    await expect(
      rawHandler(getBudgetReceipt)(readContext(database), {
        jobId: CREATE_JOB_ID,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    ).resolves.toBeNull();
  });

  it('projects cap, spend and status once the writer has run', async () => {
    const database = new MemoryDatabase();
    const { ctx } = recordingContext(database);
    await seedJobRow(database, CREATE_BUDGET_ID);
    await rawHandler(budgets.create)(ctx, {
      budgetId: CREATE_BUDGET_ID,
      budget: { maxCostUsd: 2 },
    });

    const receipt = (await rawHandler(getBudgetReceipt)(readContext(database), {
      jobId: CREATE_JOB_ID,
      ownerAccessKey: OWNER_ACCESS_KEY,
    })) as Record<string, unknown> | null;

    expect(receipt, 'the ledger row exists, so the receipt must not be null').not.toBeNull();
    expect(receipt).toMatchObject({
      budgetId: CREATE_BUDGET_ID,
      status: 'open',
      // A budget that has never dispatched reports zero spend, not absent spend.
      spend: { actualMicroUsd: 0, reservedMicroUsd: 0, unreconciledMicroUsd: 0 },
    });
    expect((receipt?.cap as Record<string, unknown>).maxCostMicroUsd).toBe(2_000_000);
    expect(receipt?.calls).toEqual([]);
  });

  it('does not claim a ceiling this deployment cannot apply', async () => {
    const database = new MemoryDatabase();
    const { ctx } = recordingContext(database);
    await seedJobRow(database, CREATE_BUDGET_ID);
    await rawHandler(budgets.create)(ctx, {
      budgetId: CREATE_BUDGET_ID,
      budget: { maxCostUsd: 2 },
    });

    const receipt = (await rawHandler(getBudgetReceipt)(readContext(database), {
      jobId: CREATE_JOB_ID,
      ownerAccessKey: OWNER_ACCESS_KEY,
    })) as Record<string, unknown> | null;

    // `enforcement` is the contract literal and is always 'hard'. Shipping only
    // that, over a deployment with no `reserve`, would be a receipt asserting a
    // cap that no code path can apply — a caller reading it would believe the
    // run was held to $2 when nothing checked. `enforcementPosture` is the
    // honest half, and it is derived from the ledger module's exports rather
    // than declared, so it cannot drift.
    expect(receipt?.enforcement).toBe('hard');
    expect(receipt?.enforcementPosture).toBe('reserve' in budgets ? 'enforced' : 'accounting_only');
    // Stated absolutely too, so this case fails loudly when `reserve` lands and
    // whoever lands it has to come and confirm the flip is real.
    expect(receipt?.enforcementPosture).toBe('accounting_only');
  });

  it('refuses the receipt to a caller who is not the job owner', async () => {
    const database = new MemoryDatabase();
    const { ctx } = recordingContext(database);
    await seedJobRow(database, CREATE_BUDGET_ID);
    await rawHandler(budgets.create)(ctx, { budgetId: CREATE_BUDGET_ID, budget: {} });

    await expect(
      rawHandler(getBudgetReceipt)(readContext(database), {
        jobId: CREATE_JOB_ID,
        ownerAccessKey: OTHER_ACCESS_KEY,
      }),
    ).resolves.toBeNull();
  });
});

describe('job completion cannot outrun its ledger', () => {
  it('throws budget_not_found when a job finalizes a budget nobody opened', async () => {
    const database = new MemoryDatabase();
    const { ctx } = recordingContext(database);

    // This is the failure the eager `create` prevents. It is not a null
    // receipt; it is a job that generated a deck and then died on its
    // completion mutation.
    await expect(
      rawHandler(budgets.finalizeForJob)(ctx, { budgetId: CREATE_BUDGET_ID }),
    ).rejects.toThrowError(expect.objectContaining({ code: 'budget_not_found' }));
    expect(database.rows('nodeslide_run_budgets')).toEqual([]);
  });

  it('finalizes cleanly, and idempotently, once the start mutation has opened it', async () => {
    const database = new MemoryDatabase();
    const { ctx } = recordingContext(database);
    await rawHandler(startCreateDeck)(ctx, CREATE_ARGS).catch(() => undefined);

    const finalized = (await rawHandler(budgets.finalizeForJob)(ctx, {
      budgetId: CREATE_BUDGET_ID,
    })) as { budget: Record<string, unknown> };
    expect(finalized.budget).toMatchObject({ status: 'finalized', unreconciledMicroUsd: 0 });

    // A retried terminal transition must replay, not conflict: `onWorkflowComplete`
    // and the completion mutation can both reach it.
    const events = database.rows('nodeslide_budget_events').length;
    const replayed = await rawHandler(budgets.finalizeForJob)(ctx, { budgetId: CREATE_BUDGET_ID });
    expect(replayed).toEqual(finalized);
    expect(database.rows('nodeslide_budget_events')).toHaveLength(events);
  });
});

describe('the pricing withholding is explicit, not accidental', () => {
  it('exports no reserve, because no part of a reservation is price-free', () => {
    // `reserve` quotes a call before dispatch. Every field it writes —
    // quoteMicroUsd, pricingDigest, providerSafeOutputTokenCeiling,
    // providerTimeoutMs — comes from the withheld price table. A stub that
    // reserved zero would not be conservative, it would be unbounded.
    expect(Object.keys(budgets)).not.toContain('reserve');
  });

  it('exports every ledger mutation that does not need a price', () => {
    // Guards the other direction: withholding one mutation must not become an
    // excuse for a thinner module than the port actually justified.
    expect(Object.keys(budgets).sort()).toEqual([
      'captureTimeout',
      'create',
      'finalize',
      'finalizeForJob',
      'release',
      'replay',
      'settle',
    ]);
  });
});
