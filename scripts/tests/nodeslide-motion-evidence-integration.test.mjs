import { describe, expect, it } from 'vitest';
import { nodeSlideDurableDigest } from '../../shared/nodeslideDurableSession.ts';
import {
  NODESLIDE_MOTION_DECEPTION_IDS,
  NODESLIDE_MOTION_EVIDENCE_VERSION,
  evaluateNodeSlideMotionEvidence,
} from '../../shared/nodeslideMotionEvidence.ts';
import {
  MOTION_DECEPTION_CORPUS,
  motionDeceptionCoverage,
} from '../nodeslide-trust-surface-census.mjs';

describe('Motion Deception Corpus -> evidence contract integration', () => {
  it('uses the same seven ids as the executable static corpus', () => {
    expect(MOTION_DECEPTION_CORPUS.map((entry) => entry.id)).toEqual(
      NODESLIDE_MOTION_DECEPTION_IDS,
    );
  });

  it('does not promote the static corpus declaration into runtime proof', async () => {
    const coverage = (await motionDeceptionCoverage()).join('\n');
    const result = evaluateNodeSlideMotionEvidence([], nodeSlideDurableDigest('current-build'));

    expect(coverage).toContain('1 of 7 known deception classes');
    expect(result.tier).toBe('NOT_RUN');
    expect(result.deceptionCoverage.every((entry) => entry.status === 'not-run')).toBe(true);
  });

  it('keeps a build-bound runtime canary synthetic and scoped to its one deception class', () => {
    const buildDigest = nodeSlideDurableDigest('current-build');
    const result = evaluateNodeSlideMotionEvidence(
      [
        {
          schemaVersion: NODESLIDE_MOTION_EVIDENCE_VERSION,
          id: 'motion:synthetic-class-4-canary',
          claimId: 'motion:synthetic-canary',
          deceptionClassId: 4,
          layer: 'runtime-instrumentation',
          mechanism: 'element-get-animations',
          producerId: 'fixture:producer',
          evaluatorId: 'fixture:independent-evaluator',
          sourceBuildDigest: buildDigest,
          artifactDigest: nodeSlideDurableDigest('synthetic-artifact'),
          verdict: 'fail',
          evidenceRefs: [
            {
              locator: 'synthetic://class-4/runtime-animation',
              digest: nodeSlideDurableDigest('synthetic-runtime-evidence'),
            },
          ],
          observedAt: '2026-07-28T12:00:00.000Z',
        },
      ],
      buildDigest,
    );

    expect(result.tier).toBe('M2');
    expect(result.technical.verdict).toBe('fail');
    expect(
      result.deceptionCoverage
        .filter((entry) => entry.status === 'covered')
        .map((entry) => entry.deceptionClassId),
    ).toEqual([4]);
  });
});
