/**
 * Ported from parity's `convex/lib/nodeslideBudgetedProvider.test.ts`, minus the
 * eleven cases that drive `callNodeSlideBudgetedJson` — the withheld dispatch
 * engine. See the module header for why it is withheld (pricing, plus a diverged
 * `nodeslideProvider` dispatch contract).
 *
 * What is here covers the whole landed surface: the reservation predicate and
 * the deterministic durable IDs, which are what callers outside the dispatch
 * loop actually consume.
 */
import { describe, expect, it } from 'vitest';
import {
  estimateNodeSlideProviderInputTokens,
  nodeSlideBudgetHasActiveReservation,
  nodeSlideProviderBudgetId,
  nodeSlideProviderCallId,
} from './nodeslideBudgetedProvider';

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
});
