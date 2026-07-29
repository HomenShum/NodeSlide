import { describe, expect, it } from 'vitest';
import { nodeSlideDurableDigest } from './nodeslideDurableSession';
import {
  NODESLIDE_MOTION_DECEPTION_IDS,
  NODESLIDE_MOTION_EVIDENCE_VERSION,
  type NodeSlideMotionEvidenceReceipt,
  evaluateNodeSlideMotionEvidence,
} from './nodeslideMotionEvidence';

const BUILD = nodeSlideDurableDigest('build');

describe('NodeSlide motion evidence', () => {
  it('binds evidence requirements to all seven Motion Deception Corpus classes', () => {
    expect(NODESLIDE_MOTION_DECEPTION_IDS).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('keeps runtime, DOM/trace, video advice, and audience usefulness as separate verdicts', () => {
    const result = evaluateNodeSlideMotionEvidence(
      [
        receipt('dom', 'dom-trace', 'fail'),
        receipt('runtime', 'runtime-instrumentation', 'pass'),
        receipt('video', 'video-judge', 'fail'),
        receipt('audience', 'audience-study', 'pass'),
      ],
      BUILD,
    );

    expect(result).toMatchObject({
      tier: 'M3',
      technical: {
        verdict: 'pass',
        authority: 'runtime-instrumentation',
        receiptIds: ['motion:runtime'],
      },
      videoAdvisory: {
        verdict: 'fail',
        receiptIds: ['motion:video'],
      },
      usefulness: {
        verdict: 'pass',
        receiptIds: ['motion:audience'],
      },
    });
    expect(result).not.toHaveProperty('score');
  });

  it('never lets a showcase or video judge promote a motion claim to audience-proven', () => {
    const result = evaluateNodeSlideMotionEvidence(
      [receipt('showcase', 'showcase', 'pass'), receipt('video', 'video-judge', 'pass')],
      BUILD,
    );

    expect(result.tier).toBe('M0');
    expect(result.technical.verdict).toBe('not-run');
    expect(result.usefulness.verdict).toBe('not-run');
  });

  it('rejects self-evaluation and receipts for another build', () => {
    const selfReviewed = receipt('self', 'runtime-instrumentation', 'pass', {
      evaluatorId: 'agent:producer',
    });
    const stale = receipt('stale', 'runtime-instrumentation', 'pass', {
      sourceBuildDigest: nodeSlideDurableDigest('old-build'),
    });
    const result = evaluateNodeSlideMotionEvidence([selfReviewed, stale], BUILD);

    expect(result.tier).toBe('NOT_RUN');
    expect(result.rejected.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(['self_evaluation', 'stale_build_evidence']),
    );
  });

  it('requires a causal knockout that prevents construction for deception class 6', () => {
    const fastForward = receipt('fast-forward', 'runtime-instrumentation', 'pass', {
      deceptionClassId: 6,
      mechanism: 'gsap-fast-forward',
    });
    const causal = receipt('causal', 'runtime-instrumentation', 'pass', {
      deceptionClassId: 6,
      mechanism: 'causal-knockout-construction-blocked',
    });

    const rejected = evaluateNodeSlideMotionEvidence([fastForward], BUILD);
    expect(rejected.technical.verdict).toBe('not-run');
    expect(rejected.rejected.map((finding) => finding.code)).toContain('invalid_knockout');

    const accepted = evaluateNodeSlideMotionEvidence([causal], BUILD);
    expect(accepted.technical.verdict).toBe('pass');
    expect(accepted.tier).toBe('M2');
  });

  it('fails closed when evidence is a bare verdict without immutable evidence refs', () => {
    const result = evaluateNodeSlideMotionEvidence(
      [receipt('empty', 'runtime-instrumentation', 'pass', { evidenceRefs: [] })],
      BUILD,
    );

    expect(result.technical.verdict).toBe('not-run');
    expect(result.rejected.map((finding) => finding.code)).toContain('evidence_missing');
  });

  it('does not combine technical proof for one claim with audience approval for another', () => {
    const result = evaluateNodeSlideMotionEvidence(
      [
        receipt('runtime-a', 'runtime-instrumentation', 'pass'),
        receipt('audience-b', 'audience-study', 'pass', {
          claimId: 'motion:claim:another-surface',
        }),
      ],
      BUILD,
    );

    expect(result.tier).toBe('NOT_RUN');
    expect(result.rejected.map((finding) => finding.code)).toContain('mixed_claims');
  });
});

function receipt(
  id: string,
  layer: NodeSlideMotionEvidenceReceipt['layer'],
  verdict: NodeSlideMotionEvidenceReceipt['verdict'],
  overrides: Partial<NodeSlideMotionEvidenceReceipt> = {},
): NodeSlideMotionEvidenceReceipt {
  return {
    schemaVersion: NODESLIDE_MOTION_EVIDENCE_VERSION,
    id: `motion:${id}`,
    claimId: 'motion:claim:trust-surface',
    deceptionClassId: 4,
    layer,
    mechanism:
      layer === 'runtime-instrumentation'
        ? 'element-get-animations'
        : layer === 'dom-trace'
          ? 'dom-state-trace'
          : layer === 'video-judge'
            ? 'video-judge'
            : layer === 'audience-study'
              ? 'human-audience-study'
              : 'showcase-recording',
    producerId: 'agent:producer',
    evaluatorId: layer === 'showcase' ? 'agent:producer' : `evaluator:${id}`,
    sourceBuildDigest: BUILD,
    artifactDigest: nodeSlideDurableDigest(`artifact:${id}`),
    verdict,
    evidenceRefs: [
      {
        locator: `evidence/${id}.json`,
        digest: nodeSlideDurableDigest(`evidence:${id}`),
      },
    ],
    observedAt: '2026-07-28T12:00:00.000Z',
    ...overrides,
  };
}
