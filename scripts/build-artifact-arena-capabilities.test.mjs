import { describe, expect, it } from 'vitest';
import {
  buildArtifactCapabilityCards,
  buildArtifactRoutingRecommendations,
} from './build-artifact-arena-capabilities.mjs';

const receipt = (model, artifactType, status = 'eligible', duration = 100) => ({
  model,
  artifactType,
  directionId: duration === 100 ? 'editorial' : 'technical',
  harnessVersion: 'artifact-atlas-v1',
  status,
  claimCoverage: status === 'eligible' ? 1 : 0.5,
  evaluation: {
    generationMs: duration,
    inputTokens: 10,
    outputTokens: 20,
    costMicroUsd: 0,
    briefAdherence: status === 'eligible',
    visualPassed: true,
    evidencePassed: true,
    exportPassed: true,
    editabilityPassed: true,
  },
});

describe('artifact capability cards', () => {
  it('requires repeat evidence before preferring an artifact type', () => {
    const cards = buildArtifactCapabilityCards([
      receipt('model/a', 'risk-matrix', 'eligible', 100),
      receipt('model/a', 'risk-matrix', 'eligible', 200),
      receipt('model/a', 'timeline', 'eligible', 100),
    ]);
    expect(cards[0].preferredArtifactTypes).toEqual(['risk-matrix']);
    expect(cards[0].autoApply).toBe(false);
  });

  it('keeps routing recommendations provisional and non-mutating', () => {
    const cards = buildArtifactCapabilityCards([
      receipt('model/a', 'risk-matrix', 'eligible', 100),
      receipt('model/a', 'risk-matrix', 'eligible', 200),
      receipt('model/b', 'risk-matrix', 'failed', 100),
      receipt('model/b', 'risk-matrix', 'eligible', 200),
    ]);
    expect(buildArtifactRoutingRecommendations(cards)[0]).toMatchObject({
      artifactType: 'risk-matrix',
      recommendedModel: 'model/a',
      autoApply: false,
    });
  });
});
