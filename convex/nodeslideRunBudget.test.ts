/**
 * Ported from parity's `convex/nodeslideRunBudget.test.ts`, minus every case that
 * exercised the withheld price table. Three describe blocks did not come across:
 * 'NodeSlide model pricing metadata', 'NodeSlide run budget preflight', and
 * 'NodeSlide deterministic/private route caps' — all three assert on
 * `nodeSlideModelPricing` / `scoreNodeSlideWorstCaseCost` /
 * `preflightNodeSlideRunBudget`, which do not exist here yet.
 *
 * Two parity cases were split rather than dropped, because their portable half
 * tested something real and their price-bound half only rode along:
 *   - 'marks the run terminal at actual cumulative cost and denies the next call'
 *     kept its accumulation half; the preflight-denial tail is gone, so the name
 *     no longer claims it.
 *   - 'produces stable preflight decisions and fails closed on state digest
 *     tampering' kept only the postflight tampering half, renamed accordingly.
 *
 * The fixture model is asserted against THIS repo's catalog, not parity's.
 */
import { describe, expect, it } from 'vitest';
import { NODESLIDE_AGENT_MODELS } from '../shared/nodeslide';
import {
  NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
  NODESLIDE_RUN_BUDGET_BOUNDS,
  NODESLIDE_RUN_BUDGET_RECEIPT_VERSION,
  type NodeSlideRunBudgetInput,
  type NodeSlideRunBudgetReceipt,
  type NodeSlideRunBudgetState,
  accountNodeSlideRunBudgetReceipt,
  createNodeSlideRunBudgetState,
  nodeSlideRunBudgetReceiptDigest,
  nodeSlideRunBudgetRemaining,
  nodeSlideRunBudgetTerminalReason,
  normalizeNodeSlideRunBudget,
  parseNodeSlideSpendConstraint,
  parseUsdDecimalToMicroUsd,
} from './lib/nodeslideRunBudget';

const FIXTURE_MODEL = 'nebius/zai-org/GLM-5.2';

describe('NodeSlide run budget fixtures', () => {
  it('targets a model this repository actually sells', () => {
    expect(NODESLIDE_AGENT_MODELS.map((model) => model.id)).toContain(FIXTURE_MODEL);
  });
});

describe('NodeSlide run budget normalization', () => {
  it('A05: parses the exact standalone run ceiling with decimal-safe micro-USD', () => {
    expect(parseNodeSlideSpendConstraint('Spend no more than $1 on this run')).toEqual({
      source: 'instruction',
      matchedText: 'Spend no more than $1 on this run',
      maxCostMicroUsd: 1_000_000,
    });
    expect(parseUsdDecimalToMicroUsd('0.1234569')).toBe(123_456);
  });

  it('uses the most restrictive repeated ceiling and ignores unrelated dollar copy', () => {
    expect(
      parseNodeSlideSpendConstraint(
        'The market is worth $10B. Spend no more than $2 on this run, then spend not more than $0.75 for the run.',
      ),
    ).toMatchObject({ maxCostMicroUsd: 750_000 });
    expect(parseNodeSlideSpendConstraint('Show a $1 price point on the market slide.')).toBeNull();
  });

  it('rejects an instruction ceiling above the hard maximum', () => {
    expect(() => parseNodeSlideSpendConstraint('Spend no more than $101 on this run')).toThrow(
      'instruction ceiling exceeds 100 USD',
    );
  });

  it('applies finite defaults and is canonically idempotent', () => {
    const normalized = normalizeNodeSlideRunBudget({});

    expect(normalized).toEqual({
      version: 'nodeslide.run-budget/v1',
      enforcement: 'hard',
      maxCostUsd: NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.default,
      maxCostMicroUsd: NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.default * 1_000_000,
      maxInputTokens: NODESLIDE_RUN_BUDGET_BOUNDS.maxInputTokens.default,
      maxOutputTokens: NODESLIDE_RUN_BUDGET_BOUNDS.maxOutputTokens.default,
      maxDurationMs: NODESLIDE_RUN_BUDGET_BOUNDS.maxDurationMs.default,
      maxIterations: NODESLIDE_RUN_BUDGET_BOUNDS.maxIterations.default,
      maxToolCalls: NODESLIDE_RUN_BUDGET_BOUNDS.maxToolCalls.default,
    });
    expect(normalizeNodeSlideRunBudget(normalized)).toEqual(normalized);
  });

  it('accepts every declared endpoint and rejects out-of-range or non-integral input', () => {
    const boundedFields = [
      'maxInputTokens',
      'maxOutputTokens',
      'maxDurationMs',
      'maxIterations',
      'maxToolCalls',
    ] as const;
    for (const field of boundedFields) {
      const bounds = NODESLIDE_RUN_BUDGET_BOUNDS[field];
      expect(() => normalizeNodeSlideRunBudget({ [field]: bounds.min })).not.toThrow();
      expect(() => normalizeNodeSlideRunBudget({ [field]: bounds.max })).not.toThrow();
      expect(() => normalizeNodeSlideRunBudget({ [field]: bounds.min - 1 })).toThrow(field);
      expect(() => normalizeNodeSlideRunBudget({ [field]: bounds.max + 1 })).toThrow(field);
      expect(() => normalizeNodeSlideRunBudget({ [field]: bounds.min + 0.5 })).toThrow(field);
    }
    expect(() =>
      normalizeNodeSlideRunBudget({ maxCostUsd: NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.min }),
    ).not.toThrow();
    expect(() => normalizeNodeSlideRunBudget({ maxCostUsd: -0.000001 })).toThrow('maxCostUsd');
    expect(() => normalizeNodeSlideRunBudget({ maxCostUsd: Number.NaN })).toThrow('maxCostUsd');
    expect(() => normalizeNodeSlideRunBudget({ unexpected: 1 })).toThrow('unexpected');
  });

  it('canonicalizes USD down to integer micro-USD without increasing a hard cap', () => {
    const normalized = normalizeNodeSlideRunBudget({ maxCostUsd: 0.1234569 });
    expect(normalized.maxCostMicroUsd).toBe(123_456);
    expect(normalized.maxCostUsd).toBe(0.123456);
  });
});

describe('NodeSlide postflight accounting', () => {
  it('accumulates provider usage and cost exactly once for an idempotency key', () => {
    const initial = createNodeSlideRunBudgetState({ maxCostUsd: 1 });
    const providerReceipt = receipt({
      idempotencyKey: 'provider-receipt-42',
      inputTokens: 123,
      outputTokens: 45,
      costMicroUsd: 67_890,
      elapsedMs: 750,
      iterations: 2,
      toolCalls: 3,
    });
    const first = accountNodeSlideRunBudgetReceipt({ state: initial, receipt: providerReceipt });
    expect(first).toMatchObject({
      ok: true,
      applied: true,
      state: {
        accumulated: {
          inputTokens: 123,
          outputTokens: 45,
          costMicroUsd: 67_890,
          elapsedMs: 750,
          iterations: 2,
          toolCalls: 3,
        },
      },
      remaining: { costMicroUsd: 932_110 },
      terminalReason: null,
    });
    if (!first.ok) throw new Error(first.reason.code);

    const replay = accountNodeSlideRunBudgetReceipt({
      state: first.state,
      receipt: { ...providerReceipt },
    });
    expect(replay).toMatchObject({ ok: true, applied: false });
    if (!replay.ok) throw new Error(replay.reason.code);
    expect(replay.state).toBe(first.state);
    expect(replay.state.accumulated).toEqual(first.state.accumulated);
  });

  it('rejects a mismatched replay without mutating accounting', () => {
    const providerReceipt = receipt({
      idempotencyKey: 'provider-replay-key',
      costMicroUsd: 10_000,
    });
    const applied = accountNodeSlideRunBudgetReceipt({
      state: createNodeSlideRunBudgetState(),
      receipt: providerReceipt,
    });
    if (!applied.ok) throw new Error(applied.reason.code);

    const mismatch = accountNodeSlideRunBudgetReceipt({
      state: applied.state,
      receipt: { ...providerReceipt, costMicroUsd: 10_001 },
    });
    expect(mismatch).toMatchObject({
      ok: false,
      reason: { code: 'receipt_replay_mismatch', idempotencyKey: 'provider-replay-key' },
    });
    if (mismatch.ok) throw new Error('Expected mismatched replay rejection');
    expect(mismatch.state).toBe(applied.state);
    expect(mismatch.state.accumulated.costMicroUsd).toBe(10_000);
  });

  it('marks the run terminal at actual cumulative cost', () => {
    let state = createNodeSlideRunBudgetState({ maxCostUsd: 1 });
    state = applyReceipt(state, receipt({ idempotencyKey: 'cost-part-1', costMicroUsd: 600_000 }));
    expect(nodeSlideRunBudgetTerminalReason(state)).toBeNull();

    const final = accountNodeSlideRunBudgetReceipt({
      state,
      receipt: receipt({ idempotencyKey: 'cost-part-2', costMicroUsd: 400_000 }),
    });
    expect(final).toMatchObject({
      ok: true,
      remaining: { costMicroUsd: 0, costUsd: 0 },
      terminalReason: { code: 'max_cost_reached', used: 1_000_000, limit: 1_000_000 },
    });
    if (!final.ok) throw new Error(final.reason.code);
    expect(nodeSlideRunBudgetTerminalReason(final.state)).toEqual({
      code: 'max_cost_reached',
      used: 1_000_000,
      limit: 1_000_000,
    });
    expect(nodeSlideRunBudgetRemaining(final.state).costMicroUsd).toBe(0);
  });

  it('rejects nonzero cost on the deterministic/private route', () => {
    const result = accountNodeSlideRunBudgetReceipt({
      state: createNodeSlideRunBudgetState(),
      receipt: receipt({
        model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
        costMicroUsd: 1,
      }),
    });
    expect(result).toMatchObject({
      ok: false,
      reason: { code: 'invalid_receipt', field: 'costMicroUsd' },
    });
  });

  it('reports each non-cost limit as its own terminal reason', () => {
    const budget = {
      maxCostUsd: 1,
      maxInputTokens: 10,
      maxOutputTokens: 10,
      maxDurationMs: 1_000,
      maxIterations: 2,
      maxToolCalls: 2,
    } as const;
    const cases = [
      ['max_input_tokens_reached', { inputTokens: 10 }],
      ['max_output_tokens_reached', { outputTokens: 10 }],
      ['max_duration_reached', { elapsedMs: 1_000 }],
      ['max_tool_calls_reached', { toolCalls: 2 }],
    ] as const;
    for (const [code, usage] of cases) {
      const state = applyReceipt(
        createNodeSlideRunBudgetState(budget),
        receipt({ idempotencyKey: `terminal-${code}`, ...usage }),
      );
      expect(nodeSlideRunBudgetTerminalReason(state)).toMatchObject({ code });
    }
    const iterated = applyReceipt(
      applyReceipt(createNodeSlideRunBudgetState(budget), receipt({ idempotencyKey: 'iter-1' })),
      receipt({ idempotencyKey: 'iter-2' }),
    );
    expect(nodeSlideRunBudgetTerminalReason(iterated)).toMatchObject({
      code: 'max_iterations_reached',
    });
  });
});

describe('NodeSlide run budget digests', () => {
  it('is stable across input key and receipt application order', () => {
    const leftBudget: NodeSlideRunBudgetInput = {
      maxCostUsd: 2,
      maxInputTokens: 1_000,
      maxOutputTokens: 500,
      maxDurationMs: 10_000,
      maxIterations: 10,
      maxToolCalls: 10,
    };
    const rightBudget = {
      maxToolCalls: 10,
      maxIterations: 10,
      maxDurationMs: 10_000,
      maxOutputTokens: 500,
      maxInputTokens: 1_000,
      maxCostUsd: 2,
    };
    const receiptA = receipt({ idempotencyKey: 'digest-a', inputTokens: 10 });
    const receiptB = receipt({ idempotencyKey: 'digest-b', outputTokens: 20 });
    let left = createNodeSlideRunBudgetState(leftBudget);
    let right = createNodeSlideRunBudgetState(rightBudget);
    expect(left.digest).toBe(right.digest);

    left = applyReceipt(applyReceipt(left, receiptA), receiptB);
    right = applyReceipt(applyReceipt(right, receiptB), receiptA);
    expect(left.accumulated).toEqual(right.accumulated);
    expect(left.receiptDigests).toEqual(right.receiptDigests);
    expect(left.digest).toBe(right.digest);
    expect(left.digest).toMatch(/^sha256:[0-9a-f]{64}$/);

    const reorderedReceipt = {
      toolCalls: receiptA.toolCalls,
      iterations: receiptA.iterations,
      elapsedMs: receiptA.elapsedMs,
      costMicroUsd: receiptA.costMicroUsd,
      outputTokens: receiptA.outputTokens,
      inputTokens: receiptA.inputTokens,
      model: receiptA.model,
      idempotencyKey: receiptA.idempotencyKey,
      version: receiptA.version,
    };
    expect(nodeSlideRunBudgetReceiptDigest(reorderedReceipt)).toBe(
      nodeSlideRunBudgetReceiptDigest(receiptA),
    );
  });

  it('fails postflight closed on state digest tampering', () => {
    const state = createNodeSlideRunBudgetState({ maxCostUsd: 1 });
    const tampered: NodeSlideRunBudgetState = {
      ...state,
      accumulated: { ...state.accumulated, costMicroUsd: 0 },
      budget: { ...state.budget, maxCostMicroUsd: 5_000_000, maxCostUsd: 5 },
    };
    const result = accountNodeSlideRunBudgetReceipt({ state: tampered, receipt: receipt() });
    expect(result).toMatchObject({ ok: false, reason: { code: 'state_digest_mismatch' } });
    if (result.ok) throw new Error('Expected the tampered state to be rejected');
    expect(result.reason.code).toBe('state_digest_mismatch');
  });
});

function receipt(overrides: Partial<NodeSlideRunBudgetReceipt> = {}): NodeSlideRunBudgetReceipt {
  return {
    version: NODESLIDE_RUN_BUDGET_RECEIPT_VERSION,
    idempotencyKey: 'provider-receipt-1',
    model: FIXTURE_MODEL,
    inputTokens: 0,
    outputTokens: 0,
    costMicroUsd: 0,
    elapsedMs: 0,
    iterations: 1,
    toolCalls: 0,
    ...overrides,
  };
}

function applyReceipt(
  state: NodeSlideRunBudgetState,
  providerReceipt: NodeSlideRunBudgetReceipt,
): NodeSlideRunBudgetState {
  const result = accountNodeSlideRunBudgetReceipt({ state, receipt: providerReceipt });
  if (!result.ok) throw new Error(`${result.reason.code}: receipt was not applied`);
  if (!result.applied) throw new Error('Expected a newly applied receipt');
  return result.state;
}
