import { describe, expect, it } from 'vitest';
import mobbinExternalEvidence from '../evidence/complete-discussions-2026-07-28/after/mobbin-external-reference-run.json';
import { nodeSlideDurableDigest } from './nodeslideDurableSession';
import {
  NODESLIDE_DESIGN_RULE_VERSION,
  NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_NOT_RUN,
  NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_RUN,
  NODESLIDE_MOBBIN_REFERENCE_FORBIDDEN_INTENTS,
  NODESLIDE_MOBBIN_REFERENCE_OBSERVATION,
  NODESLIDE_REFERENCE_OBSERVATION_VERSION,
  type NodeSlideDesignRule,
  type NodeSlideReferenceCandidate,
  type NodeSlideReferenceEvaluation,
  type NodeSlideReferenceHumanReview,
  type NodeSlideReferenceObservation,
  type NodeSlideReferenceReleaseChain,
  attestNodeSlideReferenceHumanReview,
  attestNodeSlideReferenceNovelty,
  createNodeSlideReferenceRenderReceipt,
  projectNodeSlideReferenceReleaseUx,
  projectNodeSlideReferenceScore,
  referenceObservationFreshness,
  validateNodeSlideExternalReferenceRun,
  validateNodeSlideMobbinReferenceObservation,
  validateNodeSlideMobbinReferenceWorkflow,
  validateNodeSlideReferenceObservation,
  verifyNodeSlideReferenceScoreReceipt,
} from './nodeslideReferenceKnowledge';

const DIGEST_A = nodeSlideDurableDigest('artifact-a');
const DIGEST_B = nodeSlideDurableDigest('artifact-b');
const DIGEST_RENDER = nodeSlideDurableDigest('render-a');
const COMMIT_SHA = 'a'.repeat(40);
const ISSUED_AT = '2026-07-29T02:00:00.000Z';

describe('NodeSlide reference knowledge', () => {
  it('binds the real Mobbin analysis to the authenticated run and retains no source payload', () => {
    expect(validateNodeSlideMobbinReferenceWorkflow()).toEqual({ ok: true, findings: [] });
    expect(validateNodeSlideExternalReferenceRun(NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_RUN)).toEqual({
      ok: true,
      findings: [],
    });
    expect(
      validateNodeSlideMobbinReferenceObservation(
        NODESLIDE_MOBBIN_REFERENCE_OBSERVATION,
        NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_RUN,
      ),
    ).toEqual({ ok: true, findings: [] });
    expect(NODESLIDE_MOBBIN_REFERENCE_FORBIDDEN_INTENTS).toEqual([
      'download',
      'cache',
      'rag-index',
      'embedding-index',
    ]);
    expect(NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_RUN).toMatchObject({
      provider: 'mobbin',
      operation: 'authenticated-live-inspection',
      status: 'PASS',
      checkedAt: '2026-07-29T01:04:17.055Z',
      storedPixels: false,
      cachedSourcePayload: false,
      embeddingStored: false,
      ragIndexed: false,
      trainingUsed: false,
    });
    expect(NODESLIDE_MOBBIN_REFERENCE_OBSERVATION).toMatchObject({
      sourceUrl: 'https://mobbin.com/flows/033bd9d8-9418-4c27-b9f5-9a2a072a0937',
      sourceLabel: 'Figma Slides — Starting a presentation (Figma Slides)',
      inspectedBy: 'mobbin/search_flows',
      facts: [
        { property: 'screen_count', value: 3, locatorDescription: 'flow-level screen_count' },
        { property: 'precedes', locatorDescription: 'flow choreography positions 1 → 2' },
        { property: 'precedes', locatorDescription: 'flow choreography positions 2 → 3' },
        { property: 'categorized as', value: 'Starting & Completing' },
      ],
    });
    expect(Object.keys(NODESLIDE_MOBBIN_REFERENCE_OBSERVATION)).not.toEqual(
      expect.arrayContaining([
        'pixels',
        'screenshot',
        'sourcePayload',
        'sourceDom',
        'sourceOcr',
        'embedding',
        'ragDocument',
        'trainingData',
      ]),
    );
    expect(mobbinExternalEvidence).toMatchObject({
      authenticationResult: 'PASS',
      observationDigest: nodeSlideDurableDigest(NODESLIDE_MOBBIN_REFERENCE_OBSERVATION),
      externalReferenceRunDigest: NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_RUN.runDigest,
      rawSourcePayloadIncluded: false,
      retention: {
        storedPixels: false,
        cachedSourcePayload: false,
        embeddingStored: false,
        ragIndexed: false,
        trainingUsed: false,
        storedDom: false,
        storedOcr: false,
      },
    });
  });

  it('keeps NOT_RUN honest and refuses a synthetic Mobbin live envelope', () => {
    expect(
      validateNodeSlideExternalReferenceRun(NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_NOT_RUN),
    ).toEqual({ ok: true, findings: [] });
    expect(NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_NOT_RUN).toMatchObject({
      status: 'NOT_RUN',
      reasonCode: 'AUTHENTICATED_LIVE_INSPECTION_ABSENT',
      observationIds: [],
      observationDigests: [],
    });

    const syntheticEnvelope = observation({
      id: 'fixture:mobbin-live-envelope:not-an-observation',
      sourcePolicyId: 'mobbin',
      sourceUrl: 'https://mobbin.com/',
      sourceLabel: 'Synthetic envelope with no authenticated inspection.',
      inspectionMethod: 'live-remote',
      inspectedBy: 'fixture:not-an-inspector',
      inspectedAt: '2026-07-29T01:04:17.055Z',
      firstSeenAt: '2026-07-29',
      lastVerifiedAt: '2026-07-29',
    });
    const result = validateNodeSlideMobbinReferenceObservation(
      syntheticEnvelope,
      NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_RUN,
    );
    expect(result.ok).toBe(false);
    expect(result.findings.map((entry) => entry.code)).toContain('invalid_external_reference_run');
  });

  it('stores citable atomic analysis without retaining remote source content', () => {
    const result = validateNodeSlideReferenceObservation(observation());

    expect(result).toEqual({ ok: true, findings: [] });
    expect(observation()).toMatchObject({
      analysisOnly: true,
      storedSourceContent: false,
      facts: [
        {
          kind: 'count',
          subject: 'owned artifact',
          property: 'atomic fact entries',
          value: 1,
          unit: 'items',
          locatorDescription: 'NodeSlide-owned artifact inspection receipt.',
        },
      ],
    });
  });

  it('rejects appearance adjectives as retrieval tags and non-atomic facts', () => {
    const vague = observation({
      problemTags: ['clean'],
      facts: [
        {
          id: 'fact:vague',
          kind: 'measurement',
          subject: 'hierarchy',
          property: 'quality',
          value: 'good',
          unit: 'vibes',
          locatorDescription: '',
        },
      ],
    });

    const result = validateNodeSlideReferenceObservation(vague);
    expect(result.ok).toBe(false);
    expect(result.findings.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['banned_retrieval_tag', 'invalid_atomic_fact']),
    );
  });

  it('makes observations stale instead of silently carrying an old inspection forward', () => {
    expect(referenceObservationFreshness(observation(), '2026-07-29', 30)).toBe('current');
    expect(referenceObservationFreshness(observation(), '2026-09-01', 30)).toBe('stale');
  });

  it.each([
    ['NodeSlide-owned', 'nodeslide-owned', 'owned-source-inspection'],
    ['workspace-private', 'workspace-private', 'workspace-private-inspection'],
  ] as const)(
    'projects a full %s chain as browser-safe PASS evidence',
    (_label, sourcePolicyId, method) => {
      const bundle = candidateBundle();
      const source = observation({
        id: `observation:${sourcePolicyId}:release`,
        sourcePolicyId,
        sourceUrl:
          sourcePolicyId === 'workspace-private'
            ? 'https://nodeslide.vercel.app/atlas/private'
            : 'https://nodeslide.vercel.app/atlas',
        inspectionMethod: method,
      });
      const chain = completeChain(source, bundle.candidate);

      const receipt = projectNodeSlideReferenceReleaseUx({
        candidate: bundle.candidate,
        renderReceipt: bundle.renderReceipt,
        referenceChain: chain,
        asOf: '2026-07-29',
        issuedAt: ISSUED_AT,
      });

      expect(receipt).toMatchObject({
        authoritative: false,
        releaseAuthority: '@homenshum/nodekit/reference-loop',
        projectionVerdict: 'PASS',
        provenanceMode: 'REFERENCE_CHAIN',
        candidateId: bundle.candidate.id,
        candidateArtifactDigest: bundle.candidate.artifactDigest,
        renderReceiptDigest: bundle.renderReceipt.receiptDigest,
        commitSha: COMMIT_SHA,
        findings: [],
      });
      expect(receipt.projectionDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    },
  );

  it('passes the exact authenticated Mobbin chain and fails the same provenance under NOT_RUN', () => {
    const bundle = candidateBundle();
    const chain = completeChain(NODESLIDE_MOBBIN_REFERENCE_OBSERVATION, bundle.candidate);

    const passed = projectNodeSlideReferenceReleaseUx({
      candidate: bundle.candidate,
      renderReceipt: bundle.renderReceipt,
      referenceChain: chain,
      externalReferenceRuns: [NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_RUN],
      asOf: '2026-07-29',
      issuedAt: ISSUED_AT,
    });
    expect(passed.projectionVerdict).toBe('PASS');
    expect(passed.authoritative).toBe(false);

    const blocked = projectNodeSlideReferenceReleaseUx({
      candidate: bundle.candidate,
      renderReceipt: bundle.renderReceipt,
      referenceChain: chain,
      externalReferenceRuns: [NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_NOT_RUN],
      asOf: '2026-07-29',
      issuedAt: ISSUED_AT,
    });
    expect(blocked.projectionVerdict).toBe('FAIL');
    expect(blocked.findings.map((entry) => entry.code)).toContain('mobbin_inspection_not_run');
  });

  it('fails zero provenance unless novelByIntent has an exact independent attestation', () => {
    const bundle = candidateBundle();
    const bare = projectNodeSlideReferenceReleaseUx({
      candidate: bundle.candidate,
      renderReceipt: bundle.renderReceipt,
      asOf: '2026-07-29',
      issuedAt: ISSUED_AT,
    });
    expect(bare.projectionVerdict).toBe('FAIL');
    expect(bare.findings.map((entry) => entry.code)).toContain('reference_provenance_missing');

    const unattested = projectNodeSlideReferenceReleaseUx({
      candidate: bundle.candidate,
      renderReceipt: bundle.renderReceipt,
      novelByIntent: true,
      asOf: '2026-07-29',
      issuedAt: ISSUED_AT,
    });
    expect(unattested.projectionVerdict).toBe('FAIL');

    const attestation = attestNodeSlideReferenceNovelty({
      candidateId: bundle.candidate.id,
      candidateArtifactDigest: bundle.candidate.artifactDigest,
      renderReceiptDigest: bundle.candidate.renderReceiptDigest,
      commitSha: bundle.candidate.commitSha,
      attestedBy: 'human:design-reviewer',
      attestedAt: '2026-07-29T01:30:00.000Z',
      reason: 'This candidate intentionally uses no reference corpus.',
    });
    const novel = projectNodeSlideReferenceReleaseUx({
      candidate: bundle.candidate,
      renderReceipt: bundle.renderReceipt,
      novelByIntent: true,
      noveltyAttestation: attestation,
      asOf: '2026-07-29',
      issuedAt: ISSUED_AT,
    });
    expect(novel).toMatchObject({
      projectionVerdict: 'PASS',
      provenanceMode: 'NOVEL_BY_INTENT',
      noveltyAttestationDigest: attestation.attestationDigest,
      findings: [],
    });
  });

  it('returns INCOMPLETE when declared reference or render evidence is missing', () => {
    const bundle = candidateBundle();
    const source = observation();
    const incompleteChain: NodeSlideReferenceReleaseChain = {
      observation: source,
      rule: rule(source),
    };
    const missingChainEvidence = projectNodeSlideReferenceReleaseUx({
      candidate: bundle.candidate,
      renderReceipt: bundle.renderReceipt,
      referenceChain: incompleteChain,
      asOf: '2026-07-29',
      issuedAt: ISSUED_AT,
    });
    expect(missingChainEvidence.projectionVerdict).toBe('INCOMPLETE');
    expect(missingChainEvidence.findings.map((entry) => entry.code)).toContain(
      'reference_chain_incomplete',
    );

    const missingRender = projectNodeSlideReferenceReleaseUx({
      candidate: bundle.candidate,
      referenceChain: completeChain(source, bundle.candidate),
      asOf: '2026-07-29',
      issuedAt: ISSUED_AT,
    });
    expect(missingRender.projectionVerdict).toBe('INCOMPLETE');
    expect(missingRender.findings.map((entry) => entry.code)).toContain('render_receipt_missing');
  });

  it('fails a plain human override and accepts only a bound review attestation', () => {
    const bundle = candidateBundle();
    const source = observation();
    const base = completeChain(source, bundle.candidate);
    const plainReview = {
      reviewerId: 'human:design-reviewer',
      decision: 'override',
      revisedScore: 4,
      reason: 'Plain text is not a binding attestation.',
      reviewedAt: '2026-07-29T01:30:00.000Z',
    } as unknown as NodeSlideReferenceHumanReview;
    const rejected = projectNodeSlideReferenceReleaseUx({
      candidate: bundle.candidate,
      renderReceipt: bundle.renderReceipt,
      referenceChain: { ...base, humanReview: plainReview },
      asOf: '2026-07-29',
      issuedAt: ISSUED_AT,
    });
    expect(rejected.projectionVerdict).toBe('FAIL');
    expect(rejected.findings.map((entry) => entry.code)).toContain('human_override_invalid');

    const sourceRule = rule(source);
    const sourceEvaluation = evaluation(source, sourceRule);
    const review = attestNodeSlideReferenceHumanReview({
      candidateId: bundle.candidate.id,
      evaluationId: sourceEvaluation.id,
      reviewerId: 'human:design-reviewer',
      decision: 'override',
      revisedScore: 4,
      reason: 'The cited criterion supports the higher score.',
      reviewedAt: '2026-07-29T01:30:00.000Z',
    });
    const acceptedChain = completeChain(source, bundle.candidate, review);
    const accepted = projectNodeSlideReferenceReleaseUx({
      candidate: bundle.candidate,
      renderReceipt: bundle.renderReceipt,
      referenceChain: acceptedChain,
      asOf: '2026-07-29',
      issuedAt: ISSUED_AT,
    });
    expect(accepted.projectionVerdict).toBe('PASS');
    expect(acceptedChain.scoreReceipt?.finalScore).toBe(4);
  });

  it('binds score receipts to the exact candidate, render receipt, and commit', () => {
    const bundle = candidateBundle();
    const source = observation();
    const sourceRule = rule(source);
    const sourceEvaluation = evaluation(source, sourceRule);
    const receipt = projectNodeSlideReferenceScore({
      observation: source,
      rule: sourceRule,
      candidate: bundle.candidate,
      evaluation: sourceEvaluation,
      asOf: '2026-07-29',
    });

    expect(receipt).toMatchObject({
      candidateId: bundle.candidate.id,
      candidateArtifactDigest: bundle.candidate.artifactDigest,
      candidateRenderReceiptDigest: bundle.renderReceipt.receiptDigest,
      candidateCommitSha: COMMIT_SHA,
    });
    expect(
      verifyNodeSlideReferenceScoreReceipt(receipt, {
        observation: source,
        rule: sourceRule,
        candidate: bundle.candidate,
        evaluation: sourceEvaluation,
      }),
    ).toEqual({ ok: true, findings: [] });

    const tamperedCandidate = { ...bundle.candidate, commitSha: 'b'.repeat(40) };
    const tampered = projectNodeSlideReferenceReleaseUx({
      candidate: tamperedCandidate,
      renderReceipt: bundle.renderReceipt,
      referenceChain: {
        observation: source,
        rule: sourceRule,
        evaluation: sourceEvaluation,
        scoreReceipt: receipt,
      },
      asOf: '2026-07-29',
      issuedAt: ISSUED_AT,
    });
    expect(tampered.projectionVerdict).toBe('FAIL');
    expect(tampered.findings.map((entry) => entry.code)).toEqual(
      expect.arrayContaining(['render_receipt_invalid', 'reference_chain_invalid']),
    );
  });

  it('refuses self-evaluation and evaluator assertions without generated evidence', () => {
    const bundle = candidateBundle('agent:independent-evaluator');
    const source = observation();
    const sourceRule = rule(source);
    expect(() =>
      projectNodeSlideReferenceScore({
        observation: source,
        rule: sourceRule,
        candidate: bundle.candidate,
        evaluation: evaluation(source, sourceRule),
        asOf: '2026-07-29',
      }),
    ).toThrow(/cannot evaluate its own candidate/iu);

    const independentBundle = candidateBundle();
    expect(() =>
      projectNodeSlideReferenceScore({
        observation: source,
        rule: sourceRule,
        candidate: independentBundle.candidate,
        evaluation: { ...evaluation(source, sourceRule), evidence: [] },
        asOf: '2026-07-29',
      }),
    ).toThrow(/generated evidence/iu);
  });

  it('detects a score changed after its receipt was issued', () => {
    const bundle = candidateBundle();
    const source = observation();
    const sourceRule = rule(source);
    const sourceEvaluation = evaluation(source, sourceRule);
    const receipt = projectNodeSlideReferenceScore({
      observation: source,
      rule: sourceRule,
      candidate: bundle.candidate,
      evaluation: sourceEvaluation,
      asOf: '2026-07-29',
    });
    receipt.finalScore = 4;

    const result = verifyNodeSlideReferenceScoreReceipt(receipt, {
      observation: source,
      rule: sourceRule,
      candidate: bundle.candidate,
      evaluation: sourceEvaluation,
    });
    expect(result.ok).toBe(false);
    expect(result.findings.map((entry) => entry.code)).toContain('receipt_digest_mismatch');
  });
});

function candidateBundle(producerId = 'agent:builder') {
  const identity = {
    id: 'candidate:salon-brief',
    producerId,
    artifactDigest: DIGEST_A,
    harnessRevisionDigest: DIGEST_B,
    commitSha: COMMIT_SHA,
  };
  const renderReceipt = createNodeSlideReferenceRenderReceipt({
    id: 'render-receipt:candidate-salon-brief',
    candidateId: identity.id,
    candidateArtifactDigest: identity.artifactDigest,
    renderArtifactDigest: DIGEST_RENDER,
    commitSha: identity.commitSha,
    rendererId: 'agent:independent-renderer',
    renderedAt: '2026-07-29T00:30:00.000Z',
  });
  const candidate: NodeSlideReferenceCandidate = {
    ...identity,
    renderReceiptDigest: renderReceipt.receiptDigest,
  };
  return { candidate, renderReceipt };
}

function observation(
  overrides: Partial<NodeSlideReferenceObservation> = {},
): NodeSlideReferenceObservation {
  return {
    schemaVersion: NODESLIDE_REFERENCE_OBSERVATION_VERSION,
    id: 'observation:nodeslide-owned:release',
    sourcePolicyId: 'nodeslide-owned',
    sourceUrl: 'https://nodeslide.vercel.app/atlas',
    sourceLabel: 'NodeSlide-owned artifact inspection.',
    inspectionMethod: 'owned-source-inspection',
    inspectedBy: 'agent:researcher',
    inspectedAt: '2026-07-28T12:00:00.000Z',
    analysisOnly: true,
    storedSourceContent: false,
    facts: [
      {
        id: 'fact:owned-count',
        kind: 'count',
        subject: 'owned artifact',
        property: 'atomic fact entries',
        value: 1,
        unit: 'items',
        locatorDescription: 'NodeSlide-owned artifact inspection receipt.',
      },
    ],
    problemTags: ['uncitable-observation'],
    intentTags: ['bind-fact-citation'],
    layoutTags: ['single-record'],
    interactionTags: ['noninteractive-inspection'],
    firstSeenAt: '2026-07-28',
    lastVerifiedAt: '2026-07-28',
    ...overrides,
  };
}

function rule(source: NodeSlideReferenceObservation): NodeSlideDesignRule {
  return {
    schemaVersion: NODESLIDE_DESIGN_RULE_VERSION,
    id: `rule:require-atomic-citation:${source.id}`,
    statement: 'Require an atomic fact citation before a reference can affect a score.',
    basis: [{ observationId: source.id, factIds: [source.facts[0]?.id ?? 'missing'] }],
    mechanismHypothesis:
      'Atomic citations make a score independently traceable to the observed input.',
    confidence: 0.72,
    appliesWhen: ['A reference-derived score is proposed.'],
    doesNotApplyWhen: ['No reference influences the score.'],
    problemTags: ['uncitable-observation'],
    intentTags: ['bind-fact-citation'],
    layoutTags: ['single-record'],
    interactionTags: ['noninteractive-inspection'],
    proposedBy: 'agent:rule-proposer',
    proposedAt: '2026-07-29T00:40:00.000Z',
  };
}

function evaluation(
  source: NodeSlideReferenceObservation,
  sourceRule: NodeSlideDesignRule,
): NodeSlideReferenceEvaluation {
  const factId = source.facts[0]?.id ?? 'missing';
  return {
    id: `evaluation:${source.id}`,
    candidateId: 'candidate:salon-brief',
    ruleId: sourceRule.id,
    evaluatorId: 'agent:independent-evaluator',
    evaluatorRunId: `run:evaluator:${source.id}`,
    methodVersion: 'nodeslide.reference-atomic-citation/v1',
    observationId: source.id,
    factIds: [factId],
    score: 3,
    scale: { min: 0, max: 4 },
    evidence: [
      {
        id: `evidence:${factId}`,
        kind: 'artifact-inspection',
        locator: `observation://${source.id}/${factId}`,
        digest: nodeSlideDurableDigest({
          observationDigest: nodeSlideDurableDigest(source),
          factId,
        }),
        generatedBy: 'agent:independent-evaluator',
      },
    ],
    evaluatedAt: '2026-07-29T01:15:00.000Z',
  };
}

function completeChain(
  source: NodeSlideReferenceObservation,
  candidate: NodeSlideReferenceCandidate,
  humanReview?: NodeSlideReferenceHumanReview,
): NodeSlideReferenceReleaseChain {
  const sourceRule = rule(source);
  const sourceEvaluation = evaluation(source, sourceRule);
  const scoreReceipt = projectNodeSlideReferenceScore({
    observation: source,
    rule: sourceRule,
    candidate,
    evaluation: sourceEvaluation,
    ...(humanReview ? { humanReview } : {}),
    asOf: '2026-07-29',
  });
  return {
    observation: source,
    rule: sourceRule,
    evaluation: sourceEvaluation,
    scoreReceipt,
    ...(humanReview ? { humanReview } : {}),
  };
}
