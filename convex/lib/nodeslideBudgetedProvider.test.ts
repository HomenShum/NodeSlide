/**
 * Ported from parity's `convex/lib/nodeslideBudgetedProvider.test.ts`, minus the
 * eleven cases that drive `callNodeSlideBudgetedJson` — the withheld dispatch
 * engine. See the module header for why it is withheld (pricing).
 *
 * What is here covers the whole landed surface: the reservation predicate, the
 * deterministic durable IDs, and — since `NodeSlideDispatchPolicy` now has real
 * enforcement behind it — proof that a `NodeSlideBudgetedProviderCall` written
 * over `callNodeSlideFreeJson` actually delivers its ceiling to the wire.
 */
import { describe, expect, it, vi } from 'vitest';
import type { NodeSlideBudgetedProviderCall } from './nodeslideBudgetedProvider';
import {
  estimateNodeSlideProviderInputTokens,
  nodeSlideBudgetHasActiveReservation,
  nodeSlideProviderBudgetId,
  nodeSlideProviderCallId,
  nodeSlideStateRetryBackoffMs,
} from './nodeslideBudgetedProvider';
import type { NodeSlideCompletion } from './nodeslideProvider';
import { callNodeSlideFreeJson } from './nodeslideProvider';

const providerRequest = {
  systemPrompt: 'Return a bounded NodeSlide patch.',
  userText: '{"instruction":"Rewrite the headline"}',
  maxTokens: 500,
  jsonSchema: {
    name: 'nodeslide_budgeted_test_patch',
    schema: {
      type: 'object',
      required: ['operations'],
      properties: { operations: { type: 'array' } },
    },
  },
} as const;

describe('NodeSlide budgeted provider adapter', () => {
  it('blocks proposal persistence only while a paid dispatch is still active', () => {
    expect(nodeSlideBudgetHasActiveReservation(null)).toBe(false);
    expect(
      nodeSlideBudgetHasActiveReservation({
        budget: {
          id: 'budget',
          status: 'open',
          revision: 1,
          stateDigest: `sha256:${'1'.repeat(64)}`,
          actualMicroUsd: 0,
          reservedMicroUsd: 1,
          unreconciledMicroUsd: 0,
        },
      }),
    ).toBe(true);
    expect(
      nodeSlideBudgetHasActiveReservation({
        budget: {
          id: 'budget',
          status: 'open',
          revision: 1,
          stateDigest: `sha256:${'1'.repeat(64)}`,
          actualMicroUsd: 0,
          reservedMicroUsd: 0,
          unreconciledMicroUsd: 1,
        },
      }),
    ).toBe(false);
  });

  it('derives opaque deterministic IDs from canonical request content', () => {
    const reorderedRequest = {
      ...providerRequest,
      jsonSchema: {
        schema: {
          properties: { operations: { type: 'array' } },
          required: ['operations'],
          type: 'object',
        },
        name: 'nodeslide_budgeted_test_patch',
      },
    };
    const first = nodeSlideProviderCallId({
      runId: 'run-17',
      callKey: 'edit-planner',
      providerRequest,
    });
    const second = nodeSlideProviderCallId({
      runId: 'run-17',
      callKey: 'edit-planner',
      providerRequest: reorderedRequest,
    });

    expect(first).toBe(second);
    expect(first).not.toContain('run-17');
    expect(nodeSlideProviderBudgetId('run-17')).toBe(nodeSlideProviderBudgetId('run-17'));
    expect(estimateNodeSlideProviderInputTokens(providerRequest)).toBeGreaterThan(100_000);
  });

  it('separates call IDs that differ only in prompt, slot, or run', () => {
    const base = { runId: 'run-17', callKey: 'edit-planner', providerRequest };
    const changedPrompt = {
      ...base,
      providerRequest: { ...providerRequest, userText: '{"instruction":"Rewrite the subtitle"}' },
    };
    expect(nodeSlideProviderCallId(changedPrompt)).not.toBe(nodeSlideProviderCallId(base));
    expect(nodeSlideProviderCallId({ ...base, callKey: 'repair-2' })).not.toBe(
      nodeSlideProviderCallId(base),
    );
    expect(nodeSlideProviderCallId({ ...base, runId: 'run-18' })).not.toBe(
      nodeSlideProviderCallId(base),
    );
    expect(nodeSlideProviderBudgetId('run-18')).not.toBe(nodeSlideProviderBudgetId('run-17'));
  });

  it('rejects an unbounded durable key instead of hashing it', () => {
    expect(() => nodeSlideProviderBudgetId('')).toThrow('runId');
    expect(() => nodeSlideProviderBudgetId('r'.repeat(513))).toThrow('runId');
    expect(() =>
      nodeSlideProviderCallId({ runId: 'run-17', callKey: '', providerRequest }),
    ).toThrow('callKey');
  });

  it('estimates conservatively above the raw request size for both attempts', () => {
    const small = estimateNodeSlideProviderInputTokens({
      systemPrompt: 'a',
      userText: 'b',
      maxTokens: 1,
    });
    const large = estimateNodeSlideProviderInputTokens({
      ...providerRequest,
      userText: 'x'.repeat(10_000),
    });
    expect(large - small).toBeGreaterThanOrEqual(20_000);
    expect(small).toBeGreaterThan(providerRequest.systemPrompt.length * 2);
  });

  it('spaces stale-state retries with a growing, capped backoff schedule', () => {
    const schedule = Array.from({ length: 8 }, (_, attempt) =>
      nodeSlideStateRetryBackoffMs(attempt),
    );
    // 50ms base, doubling per attempt: 50, 100, 200, 400, 800, then capped.
    expect(schedule[0]).toBe(50);
    for (let i = 1; i < schedule.length; i += 1) {
      expect(schedule[i]).toBeGreaterThanOrEqual(schedule[i - 1]);
    }
    expect(schedule[1]).toBeGreaterThan(schedule[0]);
    expect(schedule[4]).toBe(800);
    // Cap holds no matter how many attempts, and hostile inputs stay sane.
    expect(schedule[7]).toBe(1_000);
    expect(nodeSlideStateRetryBackoffMs(1_000)).toBe(1_000);
    expect(nodeSlideStateRetryBackoffMs(-3)).toBe(50);
    expect(nodeSlideStateRetryBackoffMs(2.9)).toBe(200);
  });

  it('delivers a budget-derived ceiling to the wire through the provider-call seam', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () => ({
      text: '{"operations":[]}',
      stopReason: 'stop',
      costMicroUsd: 0,
      inputTokens: 10,
      outputTokens: 5,
    }));

    // Exactly the seam `callNodeSlideBudgetedJson` would use once pricing lands.
    const dispatch: NodeSlideBudgetedProviderCall = (request, dependencies) =>
      callNodeSlideFreeJson(request, { complete, dispatchPolicy: dependencies.dispatchPolicy });

    const result = await dispatch(
      { ...providerRequest, maxTokens: 500 },
      {
        dispatchPolicy: {
          maxOutputTokens: 120,
          timeoutMs: 5_000,
          maxInputMicroUsdPerMillionTokens: 900_000,
          maxOutputMicroUsdPerMillionTokens: 2_500_000,
        },
      },
    );

    expect(result.ok).toBe(true);
    // The ceiling is not merely typed — it reaches the completion request.
    expect(complete.mock.calls[0]?.[0].maxTokens).toBe(120);
    expect(complete.mock.calls[0]?.[0].providerMaxPrice).toEqual({
      prompt: 0.9,
      completion: 2.5,
    });
  });
});
