import { describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_FREE_ROUTER_CANDIDATES,
  NODESLIDE_OFFERED_AGENT_MODELS,
} from '../../shared/nodeslide';
import {
  runNodeSlideFreeRouterProbe,
  runNodeSlideModelFleetProbe,
} from './nodeslideModelFleetProbe';
import type { NodeSlideModelProbeReceipt } from './nodeslideProvider';
import { nodeslideAgentModelValidator } from './nodeslideValidators';

describe('NodeSlide fleet-wide bounded probe', () => {
  it('keeps the Convex action validator in sync with the shared model catalog', () => {
    const validatorJson = JSON.stringify(nodeslideAgentModelValidator.json);
    for (const route of [...NODESLIDE_OFFERED_AGENT_MODELS, ...NODESLIDE_FREE_ROUTER_CANDIDATES]) {
      expect(validatorJson).toContain(route.id);
    }
  });

  it('probes every catalog model once and emits a redacted machine-readable receipt', async () => {
    const probe = vi.fn(async (model: (typeof NODESLIDE_OFFERED_AGENT_MODELS)[number]['id']) => {
      const route = NODESLIDE_OFFERED_AGENT_MODELS.find((candidate) => candidate.id === model);
      if (!route) throw new Error('test route missing');
      return {
        model,
        provider: route.provider,
        upstreamModel: route.upstreamId,
        actualProvider: route.provider,
        actualModel: route.id === 'openrouter/free' ? 'resolved/free-model' : route.upstreamId,
        reasoningEffort: 'low',
        maxTokens: 64,
        status: 'passed',
        stopReason: 'length',
        latencyMs: 3,
        costMicroUsd: 1,
        inputTokens: 2,
        outputTokens: 1,
        response: { present: true, bytes: 1 },
      } satisfies NodeSlideModelProbeReceipt;
    });
    const times = [1_700_000_000_000, 1_700_000_000_025];
    const receipt = await runNodeSlideModelFleetProbe({
      probe,
      now: () => times.shift() ?? 1_700_000_000_025,
    });

    expect(receipt).toMatchObject({
      schemaVersion: 'nodeslide.model-fleet-probe/v1',
      durationMs: 25,
      catalogModelCount: NODESLIDE_OFFERED_AGENT_MODELS.length,
      probedModelCount: NODESLIDE_OFFERED_AGENT_MODELS.length,
      failedModelCount: 0,
      passed: true,
    });
    expect(probe.mock.calls.map(([model]) => model)).toEqual(
      NODESLIDE_OFFERED_AGENT_MODELS.map((route) => route.id),
    );
    expect(JSON.stringify(receipt)).not.toContain('text');
    expect(JSON.stringify(receipt)).not.toContain('errorMessage');
  });

  it('keeps zero-priced candidates in a separate bounded qualification cohort', async () => {
    const probe = vi.fn(async (model: (typeof NODESLIDE_FREE_ROUTER_CANDIDATES)[number]['id']) => {
      const route = NODESLIDE_FREE_ROUTER_CANDIDATES.find((candidate) => candidate.id === model);
      if (!route) throw new Error('test route missing');
      return {
        model,
        provider: route.provider,
        upstreamModel: route.upstreamId,
        actualProvider: route.provider,
        actualModel: route.id === 'openrouter/free' ? 'resolved/free-model' : route.upstreamId,
        reasoningEffort: 'low',
        maxTokens: 512,
        status: 'passed',
        stopReason: 'stop',
        latencyMs: 3,
        costMicroUsd: 0,
        inputTokens: 2,
        outputTokens: 1,
        response: { present: true, bytes: 1 },
      } satisfies NodeSlideModelProbeReceipt;
    });
    const receipt = await runNodeSlideFreeRouterProbe({ probe });

    expect(receipt).toMatchObject({
      schemaVersion: 'nodeslide.free-router-fleet-probe/v1',
      catalogModelCount: NODESLIDE_FREE_ROUTER_CANDIDATES.length,
      probedModelCount: NODESLIDE_FREE_ROUTER_CANDIDATES.length,
      failedModelCount: 0,
      passed: true,
    });
    expect(probe.mock.calls.map(([model]) => model)).toEqual(
      NODESLIDE_FREE_ROUTER_CANDIDATES.map((route) => route.id),
    );
    expect(receipt.receipts.every((entry) => entry.costMicroUsd === 0)).toBe(true);
  });

  it('keeps free qualification red when a candidate reports nonzero spend', async () => {
    const chargedModel = NODESLIDE_FREE_ROUTER_CANDIDATES[0]?.id;
    const receipt = await runNodeSlideFreeRouterProbe({
      probe: async (model) => {
        const route = NODESLIDE_FREE_ROUTER_CANDIDATES.find((candidate) => candidate.id === model);
        if (!route) throw new Error('test route missing');
        return {
          model,
          provider: route.provider,
          upstreamModel: route.upstreamId,
          actualProvider: route.provider,
          actualModel: route.id === 'openrouter/free' ? 'resolved/free-model' : route.upstreamId,
          reasoningEffort: 'low',
          maxTokens: 512,
          status: 'passed',
          stopReason: 'stop',
          latencyMs: 3,
          costMicroUsd: model === chargedModel ? 1 : 0,
          inputTokens: 2,
          outputTokens: 1,
          response: { present: true, bytes: 1 },
        } satisfies NodeSlideModelProbeReceipt;
      },
    });

    expect(receipt.passed).toBe(false);
    expect(receipt.failedModelCount).toBe(1);
    expect(receipt.receipts.find((entry) => entry.model === chargedModel)).toMatchObject({
      status: 'failed',
      failure: 'The candidate route did not return exact zero-cost telemetry.',
    });
  });

  it('keeps the aggregate red when a route returns text without provider identity', async () => {
    const receipt = await runNodeSlideModelFleetProbe({
      probe: async (model) => {
        const route = NODESLIDE_OFFERED_AGENT_MODELS.find((candidate) => candidate.id === model);
        if (!route) throw new Error('test route missing');
        return {
          model,
          provider: route.provider,
          upstreamModel: route.upstreamId,
          reasoningEffort: 'low',
          maxTokens: 64,
          status: 'failed',
          latencyMs: 1,
          costMicroUsd: 0,
          inputTokens: 1,
          outputTokens: 1,
          response: { present: true, bytes: 1 },
          failure: 'The route did not return verifiable provider/model attribution.',
        } satisfies NodeSlideModelProbeReceipt;
      },
    });
    expect(receipt.passed).toBe(false);
    expect(receipt.failedModelCount).toBe(NODESLIDE_OFFERED_AGENT_MODELS.length);
  });
});
