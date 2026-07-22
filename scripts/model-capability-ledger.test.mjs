import { describe, expect, it } from 'vitest';
import { classifyEvaluationFailures, summarizeModel } from './build-model-capability-ledger.mjs';

describe('model capability ledger', () => {
  it('maps failed deterministic gates to stable behavioral classes', () => {
    expect(
      classifyEvaluationFailures({
        checks: {
          claimCoverage: false,
          liveModelTrace: false,
          textAreaRatio: false,
          renderedPptx: true,
        },
      }),
    ).toEqual(['BRIEF_MISS', 'GENERIC_FALLBACK', 'TEXT_DENSITY']);
  });

  it('keeps cognitive and tool confidence low when only artifact evidence exists', () => {
    const evaluation = {
      routeClassification: 'live',
      checks: {
        claimCoverage: true,
        liveModelTrace: true,
        textAreaRatio: false,
      },
      evidence: { claimCoverage: 1, estimatedTextOverflowCount: 2 },
      score: 0.6,
      rawScore: 0.6,
    };
    const card = summarizeModel({
      model: 'fixture/model',
      policy: {
        label: 'Fixture',
        bestRoles: ['executor'],
        avoidRoles: ['judge'],
        scaffolding: ['density'],
      },
      attempted: [{ briefId: 'brief', directionId: 'direction' }],
      modelRuns: [{ execution: { status: 'completed' } }],
      evaluations: [evaluation],
      harnessVersion: 'fixture-harness',
    });
    expect(card.observedMetrics).toMatchObject({
      liveRoutes: 1,
      liveClaimPasses: 1,
      estimatedTextOverflows: 2,
    });
    expect(card.confidence.cognitiveBehavior).toMatch(/^low/u);
    expect(card.confidence.toolExecution).toMatch(/^low/u);
  });
});
