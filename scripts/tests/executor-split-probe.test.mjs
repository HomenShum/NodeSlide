/**
 * Candidate-bound executor receipt (SPEC Part A section A.2.8, Codex N1; rule 3 after round 1).
 *
 * Situation: an operator wants proof that, after Google retired Gemini 3.5 Flash, NodeSlide's routed
 * copy executor really runs Gemini 3.8 Flash. The probe runs one premium-planner edit turn through
 * the real planner, router and reserve-before-dispatch provider. Only the HTTP call is faked here
 * (no provider is contacted, nothing is spent), so these tests prove the plumbing and the
 * acceptance rule; the paid run itself is the operator's.
 *
 * Round 1 found the acceptance rule admitted a receipt with no planner span, a wrong executor
 * identity, a wrong planner and no spend evidence. Each of those is a rejection case below.
 */
import { nodeSlideBudgetLedgerStubResponse } from '@nodeslide/testing';
import { describe, expect, it, vi } from 'vitest';
import { bindNodeSlideBudgetLedgerClient } from '../../convex/lib/nodeslideBudgetedProvider.ts';
import {
  NODESLIDE_EXECUTOR_SPLIT_PROBE_COMMAND,
  executorSplitProbeBudgetUsd,
  runNodeSlideExecutorSplitProbe,
} from '../../convex/lib/nodeslideExecutorSplitProbe.ts';
import { NODESLIDE_ROUTING_EXECUTOR_MODEL } from '../../convex/lib/nodeslideRoutingPolicy.ts';
import { buildGoldenNodeSlide } from '../../convex/lib/nodeslideSeed.ts';
import { executorSplitReceiptFailures } from '../lib/model-fleet-receipt-core.mjs';

const COMMIT = 'a'.repeat(40);
const attempt = (name) => ({
  attempt: name,
  attempted: true,
  settled: true,
  ambiguous: false,
  unreconciled: false,
  elapsedMs: 1,
});
const calls = [];
const dispatchPolicies = [];
let plannerFails = false;
let executorEchoes = 'google/gemini-3.8-flash';
let executorAttempts = [attempt('initial')];
let plannerValue;

vi.mock('../../convex/lib/nodeslideProvider.ts', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    callNodeSlideFreeJson: vi.fn(async (request, dependencies) => {
      calls.push(request.model);
      dispatchPolicies.push(dependencies?.dispatchPolicy);
      const isExecutor = request.jsonSchema?.name === 'nodeslide_copy_execution';
      // A planner that made two HTTP calls (initial + repair) and still failed.
      if (plannerFails && !isExecutor)
        return {
          ok: false,
          reason: 'The planner returned invalid JSON.',
          telemetry: {
            provider: 'openrouter',
            requestedModel: request.model,
            model: request.model,
            costMicroUsd: 30_000,
            inputTokens: 200,
            outputTokens: 80,
            attempts: [attempt('initial'), attempt('repair')],
          },
        };
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
          attempts: isExecutor ? executorAttempts : [attempt('initial')],
        },
      };
    }),
  };
});

/**
 * A ledger that keeps books: settle adds the call's actual cost, replay reports the total, as the
 * real one does. The shared stub always answers zero spend, which would make `budget.spentUsd`
 * unprovable here.
 */
function fakeLedger() {
  const actualMicroUsd = new Map();
  // The shared stub quotes 1 USD per call, which no 0.25 USD probe could ever authorize; a real
  // worst-case quote for these two calls is a few cents, so the books here use 50,000 micro-USD.
  const withActual = (response, budgetId) => ({
    ...response,
    ...(response.call ? { call: { ...response.call, quoteMicroUsd: 50_000 } } : {}),
    budget: {
      ...response.budget,
      actualMicroUsd: actualMicroUsd.get(budgetId) ?? 0,
    },
  });
  const ctx = {
    runMutation: async (_reference, args) => {
      if ('actualMicroUsd' in args)
        actualMicroUsd.set(
          args.budgetId,
          (actualMicroUsd.get(args.budgetId) ?? 0) + args.actualMicroUsd,
        );
      return withActual(nodeSlideBudgetLedgerStubResponse(args), args.budgetId);
    },
    // A replay of one call id finds no prior record (a fresh call); a replay of the budget reports its books.
    runQuery: async (_reference, args) =>
      'callId' in args ? null : withActual(nodeSlideBudgetLedgerStubResponse(args), args.budgetId),
  };
  const names = ['create', 'reserve', 'settle', 'captureTimeout', 'release', 'replay'];
  return bindNodeSlideBudgetLedgerClient(
    ctx,
    Object.fromEntries(names.map((name) => [name, name])),
  );
}

async function run() {
  calls.length = 0;
  dispatchPolicies.length = 0;
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

async function acceptedReceipt() {
  plannerFails = false;
  executorEchoes = 'google/gemini-3.8-flash';
  executorAttempts = [attempt('initial')];
  return await run();
}

describe('runNodeSlideExecutorSplitProbe', () => {
  it('splits a kimi-k3 plan to gemini-3.8-flash and records what each provider echoed', async () => {
    const receipt = await acceptedReceipt();
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

  it('carries the Part A rule 3 fields: candidate, rows, revision, constant hash, ledger books, policy', async () => {
    const receipt = await acceptedReceipt();
    expect(receipt.command).toBe(NODESLIDE_EXECUTOR_SPLIT_PROBE_COMMAND);
    expect(receipt.candidateIds).toEqual([NODESLIDE_ROUTING_EXECUTOR_MODEL]);
    expect(receipt.echoedModels.sort()).toEqual(['google/gemini-3.8-flash', 'moonshotai/kimi-k3']);
    expect(receipt.rows).toEqual([
      {
        toolName: 'planner',
        requestedModel: 'moonshotai/kimi-k3',
        resolvedModel: 'moonshotai/kimi-k3',
        echoedModel: 'moonshotai/kimi-k3',
        usage: { inputTokens: 120, outputTokens: 40 },
        costUsd: 0.02,
        fallbackUsed: false,
        dispatches: 1,
      },
      {
        toolName: 'executor',
        requestedModel: 'google/gemini-3.8-flash',
        resolvedModel: 'google/gemini-3.8-flash',
        echoedModel: 'google/gemini-3.8-flash',
        usage: { inputTokens: 120, outputTokens: 40 },
        costUsd: 0.001,
        fallbackUsed: false,
        dispatches: 1,
      },
    ]);
    expect(receipt.testedCommit).toBe(COMMIT);
    expect(receipt.constantSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(receipt.dispatchPolicy).toEqual({ maxRetries: 0, crossModelFallback: false });
    expect(receipt.budget).toMatchObject({
      maxUsd: 0.25,
      requests: 2,
      stoppedBy: null,
      refusals: [],
    });
    // Ledger books, not the rows: settled actual cost, at least what the provider reported.
    expect(receipt.budget.spentUsd).toBeGreaterThanOrEqual(0.021);
    expect(receipt.budget.estimateUsd).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(receipt.startedAt))).toBe(false);
    expect(receipt.environment.runtime).toBe('convex-node-action');
  });

  it('turns the provider retry off for every paid dispatch and records the enforced policy', async () => {
    const receipt = await acceptedReceipt();
    // The policy reaches the provider call; it is not inferred afterwards from what happened.
    expect(dispatchPolicies).toHaveLength(2);
    for (const policy of dispatchPolicies) expect(policy?.maxRetries).toBe(0);
    expect(receipt.dispatchPolicy).toEqual({
      maxRetries: 0,
      crossModelFallback: false,
    });
  });

  it('rejects a span that nevertheless dispatched twice, and still reports the enforced policy', async () => {
    executorEchoes = 'google/gemini-3.8-flash';
    plannerFails = false;
    executorAttempts = [attempt('initial'), attempt('repair')];
    const receipt = await run();
    expect(receipt.rows.find((row) => row.toolName === 'executor')?.dispatches).toBe(2);
    expect(receipt.budget.requests).toBe(3);
    // Round 1 derived maxRetries from the observed count; it is the policy that was enforced.
    expect(receipt.dispatchPolicy).toEqual({
      maxRetries: 0,
      crossModelFallback: false,
    });
    expect(executorSplitReceiptFailures(receipt, COMMIT)).toEqual(
      expect.arrayContaining([
        'executor row dispatched 2 times, not exactly once',
        'budget.requests is 3, not the 2 one planner and one executor request make',
        'budget.requests is 3, above the pre-flight ceiling of 2',
      ]),
    );
  });

  it('reports the requests a failed planner made instead of zero', async () => {
    plannerFails = true;
    executorAttempts = [attempt('initial')];
    const receipt = await run();
    expect(receipt.routing.reason).toBe('planner_failed');
    expect(receipt.rows.map((row) => [row.toolName, row.dispatches])).toEqual([['planner', 2]]);
    expect(receipt.budget.requests).toBe(2);
    expect(receipt.budget.stoppedBy).toBe('The planner returned invalid JSON.');
    expect(executorSplitReceiptFailures(receipt, COMMIT).length).toBeGreaterThan(0);
  });

  it('is rejected when the provider echoed a different executor than the one requested', async () => {
    plannerFails = false;
    executorEchoes = 'google/gemini-3.6-flash';
    executorAttempts = [attempt('initial')];
    const receipt = await run();
    expect(receipt.rows.find((row) => row.toolName === 'executor')?.fallbackUsed).toBe(true);
    // The policy is what was enforced (no code path re-dispatches to another model); the echo
    // mismatch itself is what the row and the validator catch.
    expect(receipt.dispatchPolicy.crossModelFallback).toBe(false);
    const failures = executorSplitReceiptFailures(receipt, COMMIT);
    expect(failures).toEqual(
      expect.arrayContaining([
        'executor responseModel is google/gemini-3.6-flash',
        'executor row used a fallback',
        'echoedModels does not include the executor',
      ]),
    );
  });

  it('is rejected when the deployment is not the tested commit', async () => {
    const receipt = await acceptedReceipt();
    expect(executorSplitReceiptFailures(receipt, 'b'.repeat(40))).toEqual([
      `testedCommit is ${COMMIT}`,
      `buildIdentity.commitSha is ${COMMIT}`,
    ]);
    const unstamped = { ...receipt, testedCommit: null, buildIdentity: null };
    expect(executorSplitReceiptFailures(unstamped, COMMIT)).toEqual([
      'testedCommit is null',
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

/**
 * Round 1 (Codex): a receipt with no planner span, a wrong requested executor spanModel, plannerModel
 * 'not-the-planner' and no spend evidence returned `[]`. Each mutation below starts from an accepted
 * receipt and must change the verdict.
 */
describe('executorSplitReceiptFailures rejects incomplete or inconsistent evidence', () => {
  const mutate = (receipt, change) => change(structuredClone(receipt));
  const cases = [
    [
      'no planner span',
      (r) => {
        r.spans = r.spans.filter((span) => span.toolName !== 'planner');
        return r;
      },
      'no planner span',
    ],
    [
      'no planner row',
      (r) => {
        r.rows = r.rows.filter((row) => row.toolName !== 'planner');
        return r;
      },
      'no planner row',
    ],
    [
      'a wrong requested executor spanModel',
      (r) => {
        r.spans.find((span) => span.toolName === 'executor').spanModel = 'google/gemini-3.5-flash';
        return r;
      },
      'executor spanModel is google/gemini-3.5-flash',
    ],
    [
      'a wrong requested executor on the row',
      (r) => {
        r.rows.find((row) => row.toolName === 'executor').requestedModel =
          'google/gemini-3.5-flash';
        return r;
      },
      'executor row requestedModel is google/gemini-3.5-flash',
    ],
    [
      'a resolver that chose another model than was requested',
      (r) => {
        r.rows.find((row) => row.toolName === 'executor').resolvedModel = 'z-ai/glm-5.2';
        return r;
      },
      'executor row resolvedModel z-ai/glm-5.2 differs from requestedModel',
    ],
    [
      "plannerModel 'not-the-planner'",
      (r) => {
        r.routing.plannerModel = 'not-the-planner';
        return r;
      },
      'routing.plannerModel is not-the-planner',
    ],
    [
      'a planner span on another model',
      (r) => {
        r.spans.find((span) => span.toolName === 'planner').spanModel = 'not-the-planner';
        return r;
      },
      'planner spanModel is not-the-planner',
    ],
    [
      'no spend evidence (zero ledger spend)',
      (r) => {
        r.budget.spentUsd = 0;
        return r;
      },
      'budget.spentUsd shows no spend',
    ],
    [
      'a ledger that spent less than the rows report',
      (r) => {
        r.budget.spentUsd = 0.000001;
        return r;
      },
      'budget.spentUsd is below the cost the rows report',
    ],
    [
      'spend above the ceiling',
      (r) => {
        r.budget.spentUsd = r.budget.maxUsd + 1;
        return r;
      },
      'budget.spentUsd exceeds budget.maxUsd',
    ],
    [
      'no reservation recorded',
      (r) => {
        r.budget.estimateUsd = 0;
        return r;
      },
      'budget.estimateUsd shows no reservation',
    ],
    [
      'a budget stop',
      (r) => {
        r.budget.stoppedBy = 'The hard run budget could not authorize this provider call.';
        return r;
      },
      'budget.stoppedBy is The hard run budget could not authorize this provider call.',
    ],
    [
      'a missing budget',
      (r) => {
        r.budget = undefined;
        return r;
      },
      'budget is missing',
    ],
    [
      'a missing dispatch policy',
      (r) => {
        r.dispatchPolicy = undefined;
        return r;
      },
      'dispatchPolicy is null, not maxRetries 0 and no cross-model fallback',
    ],
    [
      'retries enabled',
      (r) => {
        r.dispatchPolicy = { maxRetries: 1, crossModelFallback: false };
        return r;
      },
      'dispatchPolicy is {"maxRetries":1,"crossModelFallback":false}, not maxRetries 0 and no cross-model fallback',
    ],
    [
      'a request count that disagrees with the rows',
      (r) => {
        r.budget.requests = 1;
        return r;
      },
      'budget.requests is 1, rows dispatched 2',
    ],
    [
      'rows stripped of usage, cost and dispatches with requests 0',
      (r) => {
        for (const row of r.rows) {
          row.usage = undefined;
          row.costUsd = undefined;
          row.dispatches = undefined;
        }
        r.budget.requests = 0;
        return r;
      },
      'planner row usage is missing',
    ],
    [
      'row dispatches missing (counted as zero before)',
      (r) => {
        for (const row of r.rows) row.dispatches = undefined;
        r.budget.requests = 0;
        return r;
      },
      'executor row dispatched null times, not exactly once',
    ],
    [
      'rows costed at 10 USD each against a ledger that settled 0.021',
      (r) => {
        for (const row of r.rows) row.costUsd = 10;
        return r;
      },
      'budget.spentUsd is below the cost the rows report',
    ],
    [
      'rows whose cost disagrees with their spans',
      (r) => {
        r.rows.find((row) => row.toolName === 'executor').costUsd = 0.5;
        return r;
      },
      'executor row costUsd and span costMicroUsd disagree',
    ],
    [
      'rows whose usage disagrees with their spans',
      (r) => {
        r.rows.find((row) => row.toolName === 'planner').usage = {
          inputTokens: 1,
          outputTokens: 1,
        };
        return r;
      },
      'planner row usage and span usage disagree',
    ],
    [
      'every row at zero dispatches and zero requests',
      (r) => {
        for (const row of r.rows) row.dispatches = 0;
        r.budget.requests = 0;
        return r;
      },
      'budget.requests is 0, not the 2 one planner and one executor request make',
    ],
    [
      'a reservation estimate above the ceiling',
      (r) => {
        r.budget.estimateUsd = r.budget.maxUsd + 0.01;
        return r;
      },
      'budget.estimateUsd exceeds budget.maxUsd',
    ],
    [
      'settled spend above the summed reservation quotes',
      (r) => {
        r.budget.estimateUsd = 0.005;
        return r;
      },
      'budget.spentUsd exceeds budget.estimateUsd',
    ],
    [
      'two planner spans and no executor span',
      (r) => {
        r.spans.find((span) => span.toolName === 'executor').toolName = 'planner';
        return r;
      },
      'spans and rows are not exactly one planner and one executor',
    ],
    [
      'the wrong candidate',
      (r) => {
        r.candidateIds = ['google/gemini-3.5-flash'];
        return r;
      },
      'candidateIds does not name the executor under test',
    ],
    [
      'a constant hash of another executor',
      (r) => {
        r.constantSha256 = `sha256:${'0'.repeat(64)}`;
        return r;
      },
      'constantSha256 does not match the executor constant',
    ],
    [
      'another command',
      (r) => {
        r.command = 'npx convex run nodeslideModelProbe:runFleet';
        return r;
      },
      'command is npx convex run nodeslideModelProbe:runFleet',
    ],
    [
      'a row that no longer matches its span',
      (r) => {
        r.rows.find((row) => row.toolName === 'executor').echoedModel = 'google/gemini-3.6-flash';
        return r;
      },
      'executor row echoedModel is google/gemini-3.6-flash',
    ],
  ];

  it('accepts the unmutated receipt (so each rejection below is caused by its mutation)', async () => {
    expect(executorSplitReceiptFailures(await acceptedReceipt(), COMMIT)).toEqual([]);
  });

  it.each(cases)('rejects %s', async (_label, change, expectedFailure) => {
    const receipt = mutate(await acceptedReceipt(), change);
    expect(executorSplitReceiptFailures(receipt, COMMIT)).toContain(expectedFailure);
  });

  it('never throws on a malformed receipt', () => {
    for (const bad of [null, undefined, {}, [], 'x', { schemaVersion: 'other' }]) {
      expect(() => executorSplitReceiptFailures(bad, COMMIT)).not.toThrow();
      expect(executorSplitReceiptFailures(bad, COMMIT).length).toBeGreaterThan(0);
    }
    expect(
      executorSplitReceiptFailures({ schemaVersion: 'nodeslide.executor-split-probe/v1' }, COMMIT)
        .length,
    ).toBeGreaterThan(0);
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
