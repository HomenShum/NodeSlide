/**
 * The executor probe's committed budget cap, checked against the REAL ledger.
 *
 * Situation: an operator runs `npx convex run nodeslideModelProbe:runExecutorSplit` with no
 * configuration. The probe sends a premium-planner edit turn (kimi-k3, 3 / 15 USD per million tokens)
 * through the reserve-before-dispatch provider, and the ledger reserves the WORST CASE of a call
 * before the call is made. That worst case is far above what the call costs, so a cap sized for the
 * cost refuses the planner before anything is dispatched, and the whole receipt is lost.
 *
 * This is what hid it: `scripts/tests/executor-split-probe.test.mjs` uses a fake ledger that quotes a
 * flat 50,000 micro-USD per call (0.10 USD for the two calls), so a 0.25 USD cap looked generous.
 * Here the reservation is computed by the real `nodeslideBudgets` mutations against an in-memory
 * database, from the real price table and the real request the probe builds. Codex's replay of the
 * same inputs (2026-10-16): kimi-k3 planner 114,252 input / 4,400 output tokens = 0.408756 USD,
 * gemini-3.8-flash executor 107,010 / 4,000 = 0.095258 USD, 0.504014 USD together; 0.25 USD refused
 * the planner, 0.55 USD admitted both (SPEC D3, Homen 2026-10-16: default 0.55 USD).
 *
 * Only the HTTP call is faked: no provider is contacted and nothing is spent.
 */
import { describe, expect, it, vi } from 'vitest';
import { executorSplitReceiptFailures } from '../scripts/lib/model-fleet-receipt-core.mjs';
import type { MutationCtx } from './_generated/server';
import type { NodeSlideBudgetLedgerClient } from './lib/nodeslideBudgetedProvider';
import {
  NODESLIDE_EXECUTOR_SPLIT_DEFAULT_BUDGET_USD,
  executorSplitProbeBudgetUsd,
  runNodeSlideExecutorSplitProbe,
} from './lib/nodeslideExecutorSplitProbe';
import { NODESLIDE_ROUTING_EXECUTOR_MODEL } from './lib/nodeslideRoutingPolicy';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import * as budgets from './nodeslideBudgets';

const state = vi.hoisted(() => ({
  calls: [] as string[],
  planner: undefined as unknown,
}));

vi.mock('./lib/nodeslideProvider', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/nodeslideProvider')>();
  const attempt = {
    attempt: 'initial',
    attempted: true,
    settled: true,
    ambiguous: false,
    unreconciled: false,
    elapsedMs: 1,
  };
  return {
    ...actual,
    callNodeSlideFreeJson: vi.fn(
      async (request: { model: string; jsonSchema?: { name: string } }) => {
        state.calls.push(request.model);
        const isExecutor = request.jsonSchema?.name === 'nodeslide_copy_execution';
        const plan = state.planner as { operations: { elementId: string }[] };
        return {
          ok: true,
          value: isExecutor
            ? {
                copy: plan.operations.map((op) => ({
                  elementId: op.elementId,
                  text: 'Executor copy',
                })),
              }
            : plan,
          telemetry: {
            provider: 'openrouter',
            requestedModel: request.model,
            model: request.model,
            actualProvider: 'openrouter',
            actualModel: request.model,
            costMicroUsd: 1_000,
            inputTokens: 120,
            outputTokens: 40,
            attempts: [attempt],
          },
        };
      },
    ),
  };
});

type Row = Record<string, unknown> & { _id: string; _creationTime: number };

/** The minimum of Convex's `ctx.db` that `nodeslideBudgets` uses, over plain arrays. */
class MemoryDatabase {
  private readonly tables = new Map<string, Row[]>();
  private sequence = 0;
  query(tableName: string) {
    const filters: { field: string; value: unknown }[] = [];
    const rows = () =>
      (this.tables.get(tableName) ?? []).filter((row) =>
        filters.every((filter) => row[filter.field] === filter.value),
      );
    const query = {
      withIndex: (_name: string, configure: (index: unknown) => unknown) => {
        const index = {
          eq(field: string, value: unknown) {
            filters.push({ field, value });
            return index;
          },
          gt: () => index,
        };
        configure(index);
        return query;
      },
      order: () => query,
      take: async (count: number) => rows().slice(0, count),
      collect: async () => rows(),
      first: async () => rows()[0] ?? null,
      unique: async () => {
        if (rows().length > 1) throw new Error('Memory query was not unique.');
        return rows()[0] ?? null;
      },
    };
    return query;
  }
  async insert(tableName: string, value: Record<string, unknown>) {
    this.sequence += 1;
    const row = {
      ...structuredClone(value),
      _id: `${tableName}:${this.sequence}`,
      _creationTime: this.sequence,
    };
    this.tables.set(tableName, [...(this.tables.get(tableName) ?? []), row]);
    return row._id;
  }
  async patch(rowId: string, value: Record<string, unknown>) {
    for (const rows of this.tables.values()) {
      const row = rows.find((candidate) => candidate._id === rowId);
      if (row) return void Object.assign(row, structuredClone(value));
    }
    throw new Error(`Memory row ${rowId} was not found.`);
  }
  async get(rowId: string) {
    for (const rows of this.tables.values()) {
      const row = rows.find((candidate) => candidate._id === rowId);
      if (row) return row;
    }
    return null;
  }
}

/** The binding `convex/nodeslideAgent.ts` builds, with every mutation body being production code. */
function realLedgerClient(database: MemoryDatabase): NodeSlideBudgetLedgerClient {
  const ctx = { db: database } as unknown as MutationCtx;
  const call = (fn: unknown) => (args: Record<string, unknown>) => {
    const handler = (fn as { _handler?: (ctx: unknown, args: unknown) => Promise<unknown> })
      ._handler;
    if (typeof handler !== 'function') throw new Error('Expected a Convex function handler.');
    return handler(ctx, args);
  };
  return {
    create: call(budgets.create),
    reserve: call(budgets.reserve),
    settle: call(budgets.settle),
    captureTimeout: call(budgets.captureTimeout),
    release: call(budgets.release),
    replay: call(budgets.replay),
  } as unknown as NodeSlideBudgetLedgerClient;
}

const COMMIT = 'a'.repeat(40);

async function probe(budgetUsd: number) {
  state.calls.length = 0;
  // The planner's reply must name real element ids of the probe's own fixture deck.
  const snapshot = buildGoldenNodeSlide('executor-split-probe', 1_700_000_000_000).snapshot;
  const bySlide = new Map<string, (typeof snapshot.elements)[number][]>();
  for (const element of snapshot.elements) {
    if (element.kind !== 'text' || element.locked) continue;
    bySlide.set(element.slideId, [...(bySlide.get(element.slideId) ?? []), element]);
  }
  const [a, b] = [...bySlide.values()].find((elements) => elements.length >= 2) ?? [];
  if (!a || !b) throw new Error('The probe fixture needs a slide with two text blocks.');
  state.planner = {
    summary: 'Rewrite two blocks.',
    operations: [
      { op: 'replace_text', slideId: a.slideId, elementId: a.id, text: 'Planner one' },
      { op: 'replace_text', slideId: b.slideId, elementId: b.id, text: 'Planner two' },
    ],
    copyBriefs: [
      { slideId: a.slideId, elementId: a.id, brief: 'Opening statement.' },
      { slideId: b.slideId, elementId: b.id, brief: 'Proof point.' },
    ],
  };
  return await runNodeSlideExecutorSplitProbe({
    ledger: realLedgerClient(new MemoryDatabase()),
    buildIdentity: { schemaVersion: 'nodeslide.convex-build-identity/v1', commitSha: COMMIT },
    budgetUsd,
  });
}

describe('the executor probe cap against the real ledger (SPEC D3)', () => {
  it('commits 0.55 USD as the default on dev and on the nightly probe', () => {
    expect(NODESLIDE_EXECUTOR_SPLIT_DEFAULT_BUDGET_USD).toBe(0.55);
    // The nightly workflow and a bare `npx convex run` both read this: no env var is set for either.
    expect(executorSplitProbeBudgetUsd({})).toBe(0.55);
  });

  it('refuses the planner at the old 0.25 USD cap before any request is dispatched', async () => {
    const receipt = await probe(0.25);
    expect(state.calls).toEqual([]);
    expect(receipt.budget.requests).toBe(0);
    expect(receipt.budget.stoppedBy).not.toBeNull();
    expect(receipt.routing.reason).toBe('planner_failed');
  });

  it('admits planner plus the priced executor under the default cap (0.504014 USD in the Codex replay)', async () => {
    const receipt = await probe(executorSplitProbeBudgetUsd({}));
    // The planner goes first; the ledger then admits the executor too (a priced route, unlike a :free one).
    expect(state.calls).toEqual(['moonshotai/kimi-k3', NODESLIDE_ROUTING_EXECUTOR_MODEL]);
    expect(receipt.budget.refusals).toEqual([]);
    expect(receipt.budget.stoppedBy).toBeNull();
    // 0.408756 planner (114,252 input / 4,400 output estimated tokens at 3 / 15 USD per million) plus
    // 0.095258 executor (107,010 / 4,000 at gemini-3.8-flash's price), the real-ledger figures Codex replayed.
    expect(receipt.budget.estimateUsd).toBeCloseTo(0.504014, 6);
    expect(receipt.budget.estimateUsd).toBeGreaterThan(0.25);
    expect(receipt.budget.estimateUsd).toBeLessThanOrEqual(
      NODESLIDE_EXECUTOR_SPLIT_DEFAULT_BUDGET_USD,
    );
  });
});

describe('what the real ledger does with the committed executor', () => {
  it('reserves, sends and records the executor, and the receipt passes the acceptance gate', async () => {
    const receipt = await probe(executorSplitProbeBudgetUsd({}));
    expect(receipt.routing).toMatchObject({
      executorModel: NODESLIDE_ROUTING_EXECUTOR_MODEL,
      executorOutcome: 'applied',
    });
    expect(executorSplitReceiptFailures(receipt, COMMIT)).toEqual([]);
  });
});
