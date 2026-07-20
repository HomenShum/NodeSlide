import { describe, expect, it, vi } from 'vitest';
import { NODESLIDE_AGENT_MODELS } from '../../shared/nodeslide';
import { runNodeSlideModelFleetProbe } from './nodeslideModelFleetProbe';
import type { NodeSlideModelProbeReceipt } from './nodeslideProvider';

describe('NodeSlide fleet-wide one-token probe', () => {
  it('probes every catalog model once and emits a redacted machine-readable receipt', async () => {
    const probe = vi.fn(async (model: (typeof NODESLIDE_AGENT_MODELS)[number]['id']) => {
      const route = NODESLIDE_AGENT_MODELS.find((candidate) => candidate.id === model);
      if (!route) throw new Error('test route missing');
      return {
        model,
        provider: route.provider,
        upstreamModel: route.upstreamId,
        maxTokens: 1,
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
      catalogModelCount: NODESLIDE_AGENT_MODELS.length,
      probedModelCount: NODESLIDE_AGENT_MODELS.length,
      failedModelCount: 0,
      passed: true,
    });
    expect(probe.mock.calls.map(([model]) => model)).toEqual(
      NODESLIDE_AGENT_MODELS.map((route) => route.id),
    );
    expect(JSON.stringify(receipt)).not.toContain('text');
    expect(JSON.stringify(receipt)).not.toContain('errorMessage');
  });
});
