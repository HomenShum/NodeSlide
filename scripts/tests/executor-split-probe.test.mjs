/**
 * Candidate-bound executor receipt (SPEC Part A section A.2.8, Codex N1).
 *
 * Situation: an operator wants proof that, after Google retired Gemini 3.5 Flash, NodeSlide's routed
 * copy executor really runs Gemini 3.8 Flash. The probe runs one premium-planner edit turn through
 * the real planner, router and reserve-before-dispatch provider. Only the HTTP call is faked here
 * (no provider is contacted, nothing is spent), so these tests prove the plumbing and the
 * acceptance rule; the paid run itself is the operator's.
 */
import { nodeSlideBudgetLedgerStubResponse } from '@nodeslide/testing';
import { describe, expect, it, vi } from 'vitest';
import { bindNodeSlideBudgetLedgerClient } from '../../convex/lib/nodeslideBudgetedProvider.ts';
import {
  executorSplitProbeBudgetUsd,
  runNodeSlideExecutorSplitProbe,
} from '../../convex/lib/nodeslideExecutorSplitProbe.ts';
import { buildGoldenNodeSlide } from '../../convex/lib/nodeslideSeed.ts';
import { executorSplitReceiptFailures } from '../lib/model-fleet-receipt-core.mjs';

const COMMIT = 'a'.repeat(40);
const attempts = [
  {
    attempt: 'initial',
    attempted: true,
    settled: true,
    ambiguous: false,
    unreconciled: false,
    elapsedMs: 1,
  },
];
const calls = [];
let executorEchoes = 'google/gemini-3.8-flash';
let plannerValue;

vi.mock('../../convex/lib/nodeslideProvider.ts', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    callNodeSlideFreeJson: vi.fn(async (request) => {
      calls.push(request.model);
      const isExecutor = request.jsonSchema?.name === 'nodeslide_copy_execution';
      return {
        ok: true,
        value: isExecutor
          ? {
              copy: plannerValue.operations.map((operation) => ({
                elementId: operation.elementId,
                text: 'Executor copy',
              })),
            }
          : plannerValue,
        telemetry: {
          provider: 'openrouter',
          requestedModel: request.model,
          model: request.model,
          actualProvider: 'openrouter',
          actualModel: isExecutor ? executorEchoes : 'moonshotai/kimi-k3',
          costMicroUsd: isExecutor ? 1_000 : 20_000,
          inputTokens: 120,
          outputTokens: 40,
          attempts,
        },
      };
    }),
  };
});

function fakeLedger() {
  const ctx = {
    runMutation: async (_reference, args) => nodeSlideBudgetLedgerStubResponse(args),
    // replay: a fresh call id has no prior record
    runQuery: async () => null,
  };
  const names = ['create', 'reserve', 'settle', 'captureTimeout', 'release', 'replay'];
  return bindNodeSlideBudgetLedgerClient(
    ctx,
    Object.fromEntries(names.map((name) => [name, name])),
  );
}

async function run() {
  calls.length = 0;
  // The planner reply must name real element ids of the probe deck; the probe builds the same deck.
  const snapshot = buildGoldenNodeSlide('executor-split-probe', 1_700_000_000_000).snapshot;
  const bySlide = new Map();
  for (const element of snapshot.elements) {
    if (element.kind !== 'text' || element.locked) continue;
    bySlide.set(element.slideId, [...(bySlide.get(element.slideId) ?? []), element]);
  }
  const [a, b] = [...bySlide.values()].find((elements) => elements.length >= 2);
  plannerValue = {
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
    ledger: fakeLedger(),
    buildIdentity: { schemaVersion: 'nodeslide.convex-build-identity/v1', commitSha: COMMIT },
    budgetUsd: 0.25,
  });
}

describe('runNodeSlideExecutorSplitProbe', () => {
  it('splits a kimi-k3 plan to gemini-3.8-flash and records what each provider echoed', async () => {
    executorEchoes = 'google/gemini-3.8-flash';
    const receipt = await run();
    expect(calls).toEqual(['moonshotai/kimi-k3', 'google/gemini-3.8-flash']);
    expect(receipt.routing).toMatchObject({
      plannerModel: 'moonshotai/kimi-k3',
      executorModel: 'google/gemini-3.8-flash',
      reason: 'split_premium_planner_bulk_copy',
      executorOutcome: 'applied',
    });
    expect(receipt.spans.map((span) => [span.toolName, span.responseModel])).toEqual([
      ['planner', 'moonshotai/kimi-k3'],
      ['executor', 'google/gemini-3.8-flash'],
    ]);
    expect(receipt.budget.refusals).toEqual([]);
    expect(executorSplitReceiptFailures(receipt, COMMIT)).toEqual([]);
  });

  it('is rejected when the provider echoed a different executor than the one requested', async () => {
    executorEchoes = 'google/gemini-3.6-flash';
    const receipt = await run();
    expect(executorSplitReceiptFailures(receipt, COMMIT)).toEqual([
      'executor responseModel is google/gemini-3.6-flash',
    ]);
  });

  it('is rejected when the deployment is not the tested commit', async () => {
    executorEchoes = 'google/gemini-3.8-flash';
    const receipt = await run();
    expect(executorSplitReceiptFailures(receipt, 'b'.repeat(40))).toEqual([
      `buildIdentity.commitSha is ${COMMIT}`,
    ]);
    expect(executorSplitReceiptFailures({ ...receipt, buildIdentity: null }, COMMIT)).toEqual([
      'buildIdentity.commitSha is null',
    ]);
  });

  it('is rejected when the turn did not split (a single-model turn is not executor evidence)', () => {
    const failures = executorSplitReceiptFailures(
      {
        schemaVersion: 'nodeslide.executor-split-probe/v1',
        routing: {
          plannerModel: 'moonshotai/kimi-k3',
          executorModel: null,
          reason: 'single_model',
          executorOutcome: null,
        },
        spans: [],
        budget: { refusals: [] },
        buildIdentity: { commitSha: COMMIT },
      },
      COMMIT,
    );
    expect(failures).toEqual(
      expect.arrayContaining(['routing.reason is single_model', 'no executor span']),
    );
  });
});

describe('executorSplitProbeBudgetUsd', () => {
  it('defaults to 0.25 USD and honours NODESLIDE_PROBE_BUDGET_USD', () => {
    expect(executorSplitProbeBudgetUsd({})).toBe(0.25);
    expect(executorSplitProbeBudgetUsd({ NODESLIDE_PROBE_BUDGET_USD: '0.1' })).toBe(0.1);
  });
  it('refuses an unreadable or non-positive ceiling instead of substituting a larger one', () => {
    expect(() => executorSplitProbeBudgetUsd({ NODESLIDE_PROBE_BUDGET_USD: 'abc' })).toThrow();
    expect(() => executorSplitProbeBudgetUsd({ NODESLIDE_PROBE_BUDGET_USD: '0' })).toThrow();
  });
});
