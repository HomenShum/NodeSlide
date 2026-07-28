/**
 * Proof that the enforcement is real, not merely present.
 *
 * `nodeSlideBudgetEnforcementPosture()` in `convex/nodeslideJobs.ts` reports
 * `'enforced'` because `nodeslideBudgets.reserve` exists. That derivation is
 * only honest if `reserve` is actually reached before money is spent, so this
 * file drives the whole chain with nothing stubbed except the network:
 *
 *   callNodeSlideBudgetedJson  (the adapter, the only caller of reserve)
 *     -> the REAL nodeslideBudgets mutations, against an in-memory database
 *     -> the REAL callNodeSlideFreeJson, with only `complete` injected
 *
 * So a reservation here is a real row written by real mutation code, the quote
 * is computed by the real preflight from the real price table, and the ceiling
 * the provider receives is the one the budget derived. What is NOT proven here
 * is spend against a live provider account: no request leaves the process. That
 * gap is stated in the PR rather than papered over.
 */
import { describe, expect, it, vi } from 'vitest';
import type { MutationCtx } from './_generated/server';
import {
  type NodeSlideBudgetLedgerClient,
  bindNodeSlideBudgetLedgerClient,
  callNodeSlideBudgetedJson,
  createNodeSlideBudgetedEditDispatch,
  nodeSlideProviderBudgetId,
} from './lib/nodeslideBudgetedProvider';
import type { NodeSlideCompletion } from './lib/nodeslideProvider';
import * as budgets from './nodeslideBudgets';

type StoredRow = Record<string, unknown> & { _id: string; _creationTime: number };
type Filter = { field: string; value: unknown };

class MemoryIndex {
  readonly filters: Filter[] = [];
  eq(field: string, value: unknown): this {
    this.filters.push({ field, value });
    return this;
  }
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

function rawHandler(fn: unknown): Handler {
  const handler = (fn as { _handler?: unknown })._handler;
  if (typeof handler !== 'function') throw new Error('Expected a Convex function handler.');
  return handler as Handler;
}

/**
 * The same binding `convex/nodeslideAgent.ts` builds, except that its
 * `ctx.runMutation(internal.nodeslideBudgets.X)` indirection is replaced by a
 * direct call to the same handler. Every mutation body below is production code.
 */
function realLedgerClient(database: MemoryDatabase): NodeSlideBudgetLedgerClient {
  const ctx = { db: database } as unknown as MutationCtx;
  const call =
    <Args extends Record<string, unknown>>(fn: unknown) =>
    // biome-ignore lint/suspicious/noExplicitAny: structural bridge to the real handler
    (args: Args): Promise<any> =>
      rawHandler(fn)(ctx, args);
  return {
    create: call(budgets.create),
    reserve: call(budgets.reserve),
    settle: call(budgets.settle),
    captureTimeout: call(budgets.captureTimeout),
    release: call(budgets.release),
    replay: call(budgets.replay),
  };
}

const PROVIDER_REQUEST = {
  systemPrompt: 'Return a bounded NodeSlide patch.',
  userText: '{"instruction":"Rewrite the headline"}',
  maxTokens: 500,
  model: 'moonshotai/kimi-k3',
  jsonSchema: {
    name: 'nodeslide_enforcement_patch',
    schema: {
      type: 'object',
      required: ['operations'],
      properties: { operations: { type: 'array' } },
    },
  },
} as const;

function completionStub(overrides: Partial<Awaited<ReturnType<NodeSlideCompletion>>> = {}) {
  return vi.fn<NodeSlideCompletion>(async () => ({
    text: '{"operations":[]}',
    stopReason: 'stop',
    costMicroUsd: 4_200,
    inputTokens: 900,
    outputTokens: 120,
    ...overrides,
  }));
}

describe('a metered dispatch is reserved before it is issued', () => {
  it('reserves the worst case, dispatches under the derived ceiling, and settles the receipt', async () => {
    const database = new MemoryDatabase();
    const ledger = realLedgerClient(database);
    const complete = completionStub();

    const result = await callNodeSlideBudgetedJson(
      { runId: 'run-enforced-1', callKey: 'edit-planner-1', providerRequest: PROVIDER_REQUEST },
      {
        ledger,
        provider: async (request, dependencies) => {
          // The reservation must already exist by the time the provider is
          // called. If reserve were skipped, this row would not be here and the
          // posture would be claiming a ceiling nothing applied.
          const held = database.rows('nodeslide_billable_calls');
          expect(held).toHaveLength(1);
          expect(held[0]).toMatchObject({ status: 'reserved' });
          expect((held[0]?.quoteMicroUsd as number) > 0).toBe(true);
          const { callNodeSlideFreeJson } = await import('./lib/nodeslideProvider');
          return await callNodeSlideFreeJson(request, {
            complete,
            dispatchPolicy: dependencies.dispatchPolicy,
          });
        },
      },
    );

    expect(result.accounting.disposition).toBe('settled');
    expect(result.accounting.budgetId).toBe(nodeSlideProviderBudgetId('run-enforced-1'));

    const budget = database.rows('nodeslide_run_budgets')[0] as Record<string, unknown>;
    // Real spend, really metered: the reservation was released back into
    // `actualMicroUsd` at settlement, and it is not zero.
    expect(budget.reservedMicroUsd).toBe(0);
    expect((budget.actualMicroUsd as number) > 0).toBe(true);

    const call = database.rows('nodeslide_billable_calls')[0] as Record<string, unknown>;
    expect(call.status).toBe('settled');
    // The settled cost never exceeds what was authorized before dispatch.
    expect(call.actualMicroUsd as number).toBeLessThanOrEqual(call.quoteMicroUsd as number);

    // The ceiling that reached the wire is the reservation's own, split across
    // the two attempts the estimator paid for.
    const dispatchedMaxTokens = complete.mock.calls[0]?.[0].maxTokens as number;
    expect(dispatchedMaxTokens).toBe(
      Math.floor((call.providerSafeOutputTokenCeiling as number) / 2),
    );
    // The paired OpenRouter price ceiling is the table's own price for the route:
    // $3/M prompt and $15/M completion, expressed in the provider's USD-per-
    // million unit. A wrong table would show up here as a wrong routing ceiling.
    expect(complete.mock.calls[0]?.[0].providerMaxPrice).toEqual({ prompt: 3, completion: 15 });
  });

  it('tightens the wire ceiling when the cap, not the caller, is the binding limit', async () => {
    const database = new MemoryDatabase();
    const ledger = realLedgerClient(database);
    const complete = completionStub();

    // Enough for the conservative input estimate at $3/M, plus 3_000 micro-USD
    // of output headroom — which at $15/M buys 200 output tokens, far below the
    // 500 the caller asked for. Derived from the estimator rather than guessed,
    // so the case does not silently stop biting when the estimator changes.
    const { estimateNodeSlideProviderInputTokens } = await import(
      './lib/nodeslideBudgetedProvider'
    );
    const estimatedInputTokens = estimateNodeSlideProviderInputTokens(PROVIDER_REQUEST);
    const capMicroUsd = estimatedInputTokens * 3 + 3_000;

    const result = await callNodeSlideBudgetedJson(
      {
        runId: 'run-tight-1',
        callKey: 'edit-planner-1',
        budget: { maxCostUsd: capMicroUsd / 1_000_000 },
        providerRequest: PROVIDER_REQUEST,
      },
      {
        ledger,
        provider: async (request, dependencies) => {
          const { callNodeSlideFreeJson } = await import('./lib/nodeslideProvider');
          return await callNodeSlideFreeJson(request, {
            complete,
            dispatchPolicy: dependencies.dispatchPolicy,
          });
        },
      },
    );

    expect(result.accounting.disposition).toBe('settled');
    const dispatchedMaxTokens = complete.mock.calls[0]?.[0].maxTokens as number;
    // The caller asked for 500. The cap said 100. The cap won.
    expect(dispatchedMaxTokens).toBe(100);
    expect(dispatchedMaxTokens).toBeLessThan(PROVIDER_REQUEST.maxTokens);
  });

  it('never reaches the provider for a zero-priced dynamic route', async () => {
    const database = new MemoryDatabase();
    const ledger = realLedgerClient(database);
    const provider = vi.fn();

    const result = await callNodeSlideBudgetedJson(
      {
        runId: 'run-dynamic-1',
        callKey: 'edit-planner-1',
        providerRequest: { ...PROVIDER_REQUEST, model: 'openrouter/free' },
      },
      { ledger, provider: provider as never },
    );

    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.code).toBe('pricing_unknown');
    // A refusal a human can read, naming why — not an opaque throw.
    expect(result.reason).toContain('free router');
    expect(provider).not.toHaveBeenCalled();
    expect(database.rows('nodeslide_billable_calls')).toEqual([]);
    // The budget row still exists so the job can finalize a zero-usage record.
    expect(database.rows('nodeslide_run_budgets')).toHaveLength(1);
  });

  it('refuses rather than throwing when the cap cannot cover the call', async () => {
    const database = new MemoryDatabase();
    const ledger = realLedgerClient(database);
    const provider = vi.fn();

    const result = await callNodeSlideBudgetedJson(
      {
        runId: 'run-poor-1',
        callKey: 'edit-planner-1',
        budget: { maxCostUsd: 0 },
        providerRequest: PROVIDER_REQUEST,
      },
      { ledger, provider: provider as never },
    );

    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.code).toBe('budget_denied');
    // The coded refusal forwards the ledger's own sentence rather than a generic
    // one, so an operator can tell WHICH ceiling refused the run.
    expect(result.reason).toContain('reservation refused');
    expect(provider).not.toHaveBeenCalled();
    expect(database.rows('nodeslide_run_budgets')[0]).toMatchObject({ reservedMicroUsd: 0 });
  });

  it('holds the full reservation as unreconciled when the provider throws', async () => {
    const database = new MemoryDatabase();
    const ledger = realLedgerClient(database);

    const result = await callNodeSlideBudgetedJson(
      { runId: 'run-ambiguous-1', callKey: 'edit-planner-1', providerRequest: PROVIDER_REQUEST },
      {
        ledger,
        provider: async () => {
          throw new Error('socket hang up');
        },
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.code).toBe('ambiguous_provider_call');

    // A call that may have been billed upstream is NOT released back into the
    // cap. Its worst case stays held, so the run cannot spend it twice.
    const budget = database.rows('nodeslide_run_budgets')[0] as Record<string, unknown>;
    expect(budget.reservedMicroUsd).toBe(0);
    expect((budget.unreconciledMicroUsd as number) > 0).toBe(true);
    expect(database.rows('nodeslide_billable_calls')[0]).toMatchObject({
      status: 'unreconciled',
    });
  });

  it('does not dispatch the same call twice on replay', async () => {
    const database = new MemoryDatabase();
    const ledger = realLedgerClient(database);
    const complete = completionStub();
    const dispatch = async (request: never, dependencies: never) => {
      const { callNodeSlideFreeJson } = await import('./lib/nodeslideProvider');
      return await callNodeSlideFreeJson(request, {
        complete,
        dispatchPolicy: (dependencies as { dispatchPolicy: never }).dispatchPolicy,
      });
    };
    const args = {
      runId: 'run-replay-1',
      callKey: 'edit-planner-1',
      providerRequest: PROVIDER_REQUEST,
    } as const;

    const first = await callNodeSlideBudgetedJson(args, {
      ledger,
      provider: dispatch as never,
    });
    expect(first.accounting.disposition).toBe('settled');

    const second = await callNodeSlideBudgetedJson(args, {
      ledger,
      provider: dispatch as never,
    });
    expect(second.ok).toBe(false);
    if (second.ok !== false) return;
    expect(second.code).toBe('idempotent_replay');
    // One dispatch, one settlement — the ledger is not double-charged.
    expect(complete).toHaveBeenCalledTimes(1);
    expect(database.rows('nodeslide_billable_calls')).toHaveLength(1);
  });
});

describe('the chain from the live dispatch path down to reserve', () => {
  it('binds every ledger method to the mutation it names, reserve included', async () => {
    // `internal` is `anyApi`, so the reference a caller passes carries the
    // module and function name and nothing else; `getFunctionName` is Convex's
    // own accessor for it. Recording the resolved path is the only way to
    // observe, from outside, which mutation the binding actually chose.
    const { getFunctionName } = await import('convex/server');
    const { internal } = await import('./_generated/api');
    const calls: string[] = [];
    const ctx = {
      runMutation: async (reference: unknown) => {
        calls.push(getFunctionName(reference as Parameters<typeof getFunctionName>[0]));
        return null;
      },
      runQuery: async (reference: unknown) => {
        calls.push(getFunctionName(reference as Parameters<typeof getFunctionName>[0]));
        return null;
      },
    };
    const client = bindNodeSlideBudgetLedgerClient(
      ctx,
      // biome-ignore lint/suspicious/noExplicitAny: generated Convex reference boundary
      (internal as any).nodeslideBudgets,
    );

    await client.create({ budgetId: 'b', budget: {} });
    await client.reserve({
      budgetId: 'b',
      callId: 'c',
      model: 'moonshotai/kimi-k3',
      estimatedInputTokens: 1,
      requestedMaxOutputTokens: 1,
      expectedRevision: 0,
      expectedStateDigest: `sha256:${'0'.repeat(64)}`,
    });
    await client.settle({
      budgetId: 'b',
      callId: 'c',
      inputTokens: 1,
      outputTokens: 1,
      actualMicroUsd: 1,
      elapsedMs: 1,
      iterations: 1,
      toolCalls: 0,
      expectedRevision: 1,
      expectedStateDigest: `sha256:${'0'.repeat(64)}`,
    });
    await client.captureTimeout({
      budgetId: 'b',
      callId: 'c',
      expectedRevision: 1,
      expectedStateDigest: `sha256:${'0'.repeat(64)}`,
    });
    await client.release({
      budgetId: 'b',
      callId: 'c',
      expectedRevision: 1,
      expectedStateDigest: `sha256:${'0'.repeat(64)}`,
    });
    await client.replay({ budgetId: 'b' });

    expect(calls).toEqual([
      'nodeslideBudgets:create',
      'nodeslideBudgets:reserve',
      'nodeslideBudgets:settle',
      'nodeslideBudgets:captureTimeout',
      'nodeslideBudgets:release',
      'nodeslideBudgets:replay',
    ]);
  });

  it('reserves every metered planner dispatch, with a distinct call key per invocation', async () => {
    const database = new MemoryDatabase();
    const ledger = realLedgerClient(database);
    const complete = completionStub();
    const planner = createNodeSlideBudgetedEditDispatch({
      runId: 'run-seam-1',
      budget: {},
      metered: true,
      ledger,
      dispatch: async (request, dependencies) => {
        const { callNodeSlideFreeJson } = await import('./lib/nodeslideProvider');
        return await callNodeSlideFreeJson(request, {
          complete,
          ...(dependencies?.dispatchPolicy ? { dispatchPolicy: dependencies.dispatchPolicy } : {}),
        });
      },
    });

    // The router dispatches twice in a run that needs a repair pass. Both are
    // reserved, and neither collides with the other on the ledger.
    await planner(PROVIDER_REQUEST);
    await planner({ ...PROVIDER_REQUEST, userText: '{"instruction":"Repair the patch"}' });

    const calls = database.rows('nodeslide_billable_calls');
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.status === 'settled')).toBe(true);
    expect(new Set(calls.map((call) => call.callId)).size).toBe(2);
    expect((database.rows('nodeslide_run_budgets')[0]?.actualMicroUsd as number) > 0).toBe(true);
  });

  it('does not open a reservation for the deterministic route, which issues no request', async () => {
    const database = new MemoryDatabase();
    const ledger = realLedgerClient(database);
    const dispatch = vi.fn(async () => ({
      ok: true as const,
      value: { operations: [] },
      telemetry: {
        provider: 'deterministic',
        model: 'bounded-edit-planner/v1',
        costMicroUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      },
    }));
    const planner = createNodeSlideBudgetedEditDispatch({
      runId: 'run-seam-deterministic',
      budget: {},
      metered: false,
      ledger,
      dispatch,
    });

    await planner(PROVIDER_REQUEST);

    expect(dispatch).toHaveBeenCalledTimes(1);
    // No ledger row at all: a deterministic run has nothing to meter, and a
    // zero-usage reservation on it would be accounting theatre.
    expect(database.rows('nodeslide_run_budgets')).toEqual([]);
    expect(database.rows('nodeslide_billable_calls')).toEqual([]);
  });

  /**
   * The last link, and the only one this suite cannot drive: the Convex action
   * `proposeEdit` builds its planner inside a closure no in-process ctx can
   * reach. So this reads the module source — deliberately checking the SHAPE of
   * the assignment rather than merely that the adapter's name appears somewhere,
   * because a knockout proved the looser version passes when the dispatch is
   * reverted with the name left in place.
   */
  it('builds the live edit planner from the budgeted seam and nothing else', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./nodeslideAgent.ts', import.meta.url), 'utf8');
    const seam = source.slice(
      source.indexOf('const callStreamingPlanner'),
      source.indexOf('baseline = await planNodeSlideEditRouted'),
    );

    expect(seam.length).toBeGreaterThan(0);
    // The planner IS the budgeted seam, not something that merely mentions it.
    expect(seam).toContain(
      'const callStreamingPlanner: NodeSlideEditProvider = createNodeSlideBudgetedEditDispatch({',
    );
    expect(seam).toContain('ledger: nodeSlideBudgetLedgerClient(ctx)');
    // `metered` must be derived from the route, never pinned to a literal — a
    // hardcoded `false` here would silently unmeter every run.
    expect(seam).toContain("metered: providerChoice.providerMode !== 'deterministic'");
    expect(seam).not.toContain('metered: false');
    expect(seam).not.toContain('metered: true');
  });
});
