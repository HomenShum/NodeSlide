import { type AtlasUsageIntent, evaluateAtlasUsage } from './nodeslideAtlas';
import { findAtlasSourcePolicy } from './nodeslideAtlasRegistry';
import { nodeSlideDurableDigest } from './nodeslideDurableSession';

export const NODESLIDE_REFERENCE_OBSERVATION_VERSION =
  'nodeslide.reference-observation/v1' as const;
export const NODESLIDE_DESIGN_RULE_VERSION = 'nodeslide.design-rule/v1' as const;
export const NODESLIDE_REFERENCE_SCORE_RECEIPT_VERSION =
  'nodeslide.reference-score-receipt/v1' as const;
export const NODESLIDE_EXTERNAL_REFERENCE_RUN_VERSION =
  'nodeslide.external-reference-run/v1' as const;
export const NODESLIDE_REFERENCE_RENDER_RECEIPT_VERSION =
  'nodeslide.reference-render-receipt/v1' as const;
export const NODESLIDE_REFERENCE_HUMAN_REVIEW_VERSION =
  'nodeslide.reference-human-review/v1' as const;
export const NODESLIDE_REFERENCE_NOVELTY_ATTESTATION_VERSION =
  'nodeslide.reference-novelty-attestation/v1' as const;
export const NODESLIDE_REFERENCE_RELEASE_PROJECTION_VERSION =
  'nodeslide.reference-release-projection/v1' as const;
export const NODESLIDE_MOBBIN_REFERENCE_FORBIDDEN_INTENTS = Object.freeze([
  'download',
  'cache',
  'rag-index',
  'embedding-index',
] as const satisfies readonly AtlasUsageIntent[]);
export const NODESLIDE_MOBBIN_REFERENCE_WORKFLOW = Object.freeze({
  sourcePolicyId: 'mobbin',
  accessMode: 'remote-mcp',
  inspectionMethod: 'live-remote',
  durableRecordOwner: 'nodekit-owned-analysis',
  storesRemotePixels: false,
  storesRemoteCache: false,
  indexesRemoteContent: false,
  storesRemoteOcr: false,
  storesRemoteDom: false,
  usesRemoteContentForTraining: false,
} as const);

export const NODESLIDE_REFERENCE_FACT_KINDS = ['count', 'measurement', 'relationship'] as const;
export type NodeSlideReferenceFactKind = (typeof NODESLIDE_REFERENCE_FACT_KINDS)[number];

export interface NodeSlideReferenceAtomicFact {
  id: string;
  kind: NodeSlideReferenceFactKind;
  subject: string;
  property: string;
  value: number | string;
  unit: string;
  locatorDescription: string;
}

export interface NodeSlideReferenceObservation {
  schemaVersion: typeof NODESLIDE_REFERENCE_OBSERVATION_VERSION;
  id: string;
  sourcePolicyId: string;
  sourceUrl: `https://${string}`;
  sourceLabel: string;
  inspectionMethod:
    | 'live-remote'
    | 'owned-source-inspection'
    | 'workspace-private-inspection'
    | 'synthetic-contract-fixture';
  inspectedBy: string;
  inspectedAt: string;
  /**
   * The durable record is NodeSlide-owned analysis, not a copy of the remote
   * source. Both literals are rechecked at runtime before projection.
   */
  analysisOnly: true;
  storedSourceContent: false;
  facts: NodeSlideReferenceAtomicFact[];
  problemTags: string[];
  intentTags: string[];
  layoutTags: string[];
  interactionTags: string[];
  firstSeenAt: string;
  lastVerifiedAt: string;
}

export interface NodeSlideReferenceFactCitation {
  observationId: string;
  factIds: string[];
}

export interface NodeSlideDesignRule {
  schemaVersion: typeof NODESLIDE_DESIGN_RULE_VERSION;
  id: string;
  statement: string;
  basis: NodeSlideReferenceFactCitation[];
  mechanismHypothesis: string;
  confidence: number;
  appliesWhen: string[];
  doesNotApplyWhen: string[];
  problemTags: string[];
  intentTags: string[];
  layoutTags: string[];
  interactionTags: string[];
  proposedBy: string;
  proposedAt: string;
}

export interface NodeSlideReferenceCandidate {
  id: string;
  producerId: string;
  artifactDigest: string;
  harnessRevisionDigest: string;
  renderReceiptDigest: string;
  commitSha: string;
}

export interface NodeSlideReferenceRenderReceipt {
  schemaVersion: typeof NODESLIDE_REFERENCE_RENDER_RECEIPT_VERSION;
  id: string;
  candidateId: string;
  candidateArtifactDigest: string;
  renderArtifactDigest: string;
  commitSha: string;
  rendererId: string;
  renderedAt: string;
  receiptDigest: string;
}

export type NodeSlideReferenceEvaluationEvidenceKind =
  | 'dom-measurement'
  | 'runtime-instrumentation'
  | 'render'
  | 'trace'
  | 'artifact-inspection';

export interface NodeSlideReferenceEvaluationEvidence {
  id: string;
  kind: NodeSlideReferenceEvaluationEvidenceKind;
  locator: string;
  digest: string;
  generatedBy: string;
}

export interface NodeSlideReferenceEvaluation {
  id: string;
  candidateId: string;
  ruleId: string;
  evaluatorId: string;
  evaluatorRunId: string;
  methodVersion: string;
  observationId: string;
  factIds: string[];
  score: number;
  scale: { min: number; max: number };
  evidence: NodeSlideReferenceEvaluationEvidence[];
  evaluatedAt: string;
}

export interface NodeSlideReferenceHumanReview {
  schemaVersion: typeof NODESLIDE_REFERENCE_HUMAN_REVIEW_VERSION;
  candidateId: string;
  evaluationId: string;
  reviewerId: string;
  decision: 'uphold' | 'override';
  revisedScore?: number;
  reason: string;
  reviewedAt: string;
  attestationDigest: string;
}

export interface NodeSlideReferenceScoreReceipt {
  schemaVersion: typeof NODESLIDE_REFERENCE_SCORE_RECEIPT_VERSION;
  id: string;
  observationId: string;
  observationDigest: string;
  sourcePolicyId: string;
  sourceLastVerifiedAt: string;
  factIds: string[];
  ruleId: string;
  ruleDigest: string;
  candidateId: string;
  candidateProducerId: string;
  candidateArtifactDigest: string;
  harnessRevisionDigest: string;
  candidateRenderReceiptDigest: string;
  candidateCommitSha: string;
  evaluationId: string;
  evaluationDigest: string;
  evaluatorId: string;
  evaluatorRunId: string;
  evaluatorMethodVersion: string;
  evaluatorEvidenceIds: string[];
  evaluatorEvidenceDigests: string[];
  score: number;
  scale: { min: number; max: number };
  finalScore: number;
  humanReview: NodeSlideReferenceHumanReview | null;
  issuedAt: string;
  receiptDigest: string;
}

export type NodeSlideExternalReferenceRunStatus = 'NOT_RUN' | 'PASS';
export type NodeSlideExternalReferenceRunReason = 'AUTHENTICATED_LIVE_INSPECTION_ABSENT' | null;

export interface NodeSlideExternalReferenceRun {
  schemaVersion: typeof NODESLIDE_EXTERNAL_REFERENCE_RUN_VERSION;
  id: string;
  provider: string;
  sourcePolicyId: string;
  operation: 'authenticated-live-inspection';
  status: NodeSlideExternalReferenceRunStatus;
  reasonCode: NodeSlideExternalReferenceRunReason;
  inspectionMethod: 'authenticated-live-remote' | null;
  inspectorId: string | null;
  checkedAt: string | null;
  observationIds: string[];
  observationDigests: string[];
  analysisOnly: true;
  storedSourceContent: false;
  storedPixels: false;
  cachedSourcePayload: false;
  embeddingStored: false;
  ragIndexed: false;
  trainingUsed: false;
  runDigest: string;
}

export interface NodeSlideReferenceNoveltyAttestation {
  schemaVersion: typeof NODESLIDE_REFERENCE_NOVELTY_ATTESTATION_VERSION;
  novelByIntent: true;
  candidateId: string;
  candidateArtifactDigest: string;
  renderReceiptDigest: string;
  commitSha: string;
  attestedBy: string;
  attestedAt: string;
  reason: string;
  attestationDigest: string;
}

export interface NodeSlideReferenceReleaseChain {
  observation?: NodeSlideReferenceObservation;
  rule?: NodeSlideDesignRule;
  evaluation?: NodeSlideReferenceEvaluation;
  scoreReceipt?: NodeSlideReferenceScoreReceipt;
  humanReview?: NodeSlideReferenceHumanReview;
}

export type NodeSlideReferenceProjectionVerdict = 'PASS' | 'FAIL' | 'INCOMPLETE';

export type NodeSlideReferenceReleaseFindingCode =
  | 'candidate_binding_invalid'
  | 'render_receipt_missing'
  | 'render_receipt_invalid'
  | 'reference_provenance_missing'
  | 'reference_chain_incomplete'
  | 'reference_chain_invalid'
  | 'release_fixture_forbidden'
  | 'external_reference_run_invalid'
  | 'mobbin_inspection_not_run'
  | 'human_override_invalid'
  | 'novelty_attestation_invalid';

export interface NodeSlideReferenceReleaseFinding {
  code: NodeSlideReferenceReleaseFindingCode;
  message: string;
}

/**
 * Browser-safe explanation of NodeSlide's local reference checks.
 *
 * This object is deliberately non-authoritative. A release decision can only
 * come from the Node/server adapter backed by @homenshum/nodekit/reference-loop.
 */
export interface NodeSlideReferenceReleaseProjection {
  schemaVersion: typeof NODESLIDE_REFERENCE_RELEASE_PROJECTION_VERSION;
  authoritative: false;
  releaseAuthority: '@homenshum/nodekit/reference-loop';
  candidateId: string;
  candidateArtifactDigest: string;
  renderReceiptDigest: string;
  commitSha: string;
  provenanceMode: 'REFERENCE_CHAIN' | 'NOVEL_BY_INTENT' | 'NONE';
  scoreReceiptDigest: string | null;
  externalReferenceRunDigests: string[];
  noveltyAttestationDigest: string | null;
  projectionVerdict: NodeSlideReferenceProjectionVerdict;
  findings: NodeSlideReferenceReleaseFinding[];
  issuedAt: string;
  projectionDigest: string;
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const COMMIT_SHA = /^[0-9a-f]{40}$/u;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const DAY_MS = 86_400_000;
const FORBIDDEN_REMOTE_CONTENT_FIELDS = [
  'pixels',
  'sourcePixels',
  'screenshot',
  'screenshots',
  'sourceHtml',
  'sourceDom',
  'dom',
  'sourceOcr',
  'ocr',
  'sourceContent',
  'sourcePayload',
  'cachedSource',
  'ragDocument',
  'embedding',
  'trainingData',
] as const;

/**
 * Honest pre-canary state retained as a contract fixture. It contains no
 * observation and can never support even a local Mobbin projection.
 */
export const NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_NOT_RUN: NodeSlideExternalReferenceRun =
  createNodeSlideExternalReferenceRun({
    id: 'external-reference-run:mobbin:authenticated-live-inspection-absent',
    provider: 'mobbin',
    sourcePolicyId: 'mobbin',
    operation: 'authenticated-live-inspection',
    status: 'NOT_RUN',
    reasonCode: 'AUTHENTICATED_LIVE_INSPECTION_ABSENT',
    inspectionMethod: null,
    inspectorId: null,
    checkedAt: null,
    observationIds: [],
    observationDigests: [],
    analysisOnly: true,
    storedSourceContent: false,
    storedPixels: false,
    cachedSourcePayload: false,
    embeddingStored: false,
    ragIndexed: false,
    trainingUsed: false,
  });

/**
 * Derived analysis from the authenticated Mobbin canary. This stores no
 * screenshot, pixels, DOM, OCR, response payload, cache, embedding, RAG
 * document, or training material.
 */
export const NODESLIDE_MOBBIN_REFERENCE_OBSERVATION: NodeSlideReferenceObservation = {
  schemaVersion: NODESLIDE_REFERENCE_OBSERVATION_VERSION,
  id: 'observation:mobbin:figma-slides:start-presentation:2026-07-29',
  sourcePolicyId: 'mobbin',
  sourceUrl: 'https://mobbin.com/flows/033bd9d8-9418-4c27-b9f5-9a2a072a0937',
  sourceLabel: 'Figma Slides — Starting a presentation (Figma Slides)',
  inspectionMethod: 'live-remote',
  inspectedBy: 'mobbin/search_flows',
  inspectedAt: '2026-07-29T01:04:17.055Z',
  analysisOnly: true,
  storedSourceContent: false,
  facts: [
    {
      id: 'fact:mobbin:figma-slides:screen-count',
      kind: 'count',
      subject: 'flow 033bd9d8-9418-4c27-b9f5-9a2a072a0937',
      property: 'screen_count',
      value: 3,
      unit: 'screens',
      locatorDescription: 'flow-level screen_count',
    },
    {
      id: 'fact:mobbin:figma-slides:screen-1-precedes-screen-2',
      kind: 'relationship',
      subject: 'screen bcdacfdb-c856-4dc9-979d-8eb351267f21 at position 1',
      property: 'precedes',
      value: 'screen ab34bc66-2b87-45f0-8a7d-ed8cb3120df7 at position 2',
      unit: 'ordered-flow-position',
      locatorDescription: 'flow choreography positions 1 → 2',
    },
    {
      id: 'fact:mobbin:figma-slides:screen-2-precedes-screen-3',
      kind: 'relationship',
      subject: 'screen ab34bc66-2b87-45f0-8a7d-ed8cb3120df7 at position 2',
      property: 'precedes',
      value: 'screen 471a4980-ccae-4212-9a65-b5ed4c01e480 at position 3',
      unit: 'ordered-flow-position',
      locatorDescription: 'flow choreography positions 2 → 3',
    },
    {
      id: 'fact:mobbin:figma-slides:flow-category',
      kind: 'relationship',
      subject: 'flow 033bd9d8-9418-4c27-b9f5-9a2a072a0937',
      property: 'categorized as',
      value: 'Starting & Completing',
      unit: 'category',
      locatorDescription: 'flow-level category',
    },
  ],
  problemTags: ['flow-sequence'],
  intentTags: ['starting-presentation'],
  layoutTags: ['three-screen-flow'],
  interactionTags: ['ordered-screen-progression'],
  firstSeenAt: '2026-07-29',
  lastVerifiedAt: '2026-07-29',
};

export const NODESLIDE_MOBBIN_EXTERNAL_REFERENCE_RUN: NodeSlideExternalReferenceRun =
  createNodeSlideExternalReferenceRun({
    id: 'external-reference-run:mobbin:2026-07-29T01:04:17.055Z',
    provider: 'mobbin',
    sourcePolicyId: 'mobbin',
    operation: 'authenticated-live-inspection',
    status: 'PASS',
    reasonCode: null,
    inspectionMethod: 'authenticated-live-remote',
    inspectorId: 'mobbin/search_flows',
    checkedAt: '2026-07-29T01:04:17.055Z',
    observationIds: [NODESLIDE_MOBBIN_REFERENCE_OBSERVATION.id],
    observationDigests: [nodeSlideDurableDigest(NODESLIDE_MOBBIN_REFERENCE_OBSERVATION)],
    analysisOnly: true,
    storedSourceContent: false,
    storedPixels: false,
    cachedSourcePayload: false,
    embeddingStored: false,
    ragIndexed: false,
    trainingUsed: false,
  });

export type NodeSlideReferenceFindingCode =
  | 'invalid_observation'
  | 'invalid_remote_source'
  | 'invalid_source_policy'
  | 'invalid_inspection_method'
  | 'source_content_retained'
  | 'invalid_observation_time'
  | 'duplicate_fact_id'
  | 'invalid_atomic_fact'
  | 'banned_retrieval_tag'
  | 'invalid_design_rule'
  | 'missing_fact_citation'
  | 'stale_observation'
  | 'invalid_external_reference_run'
  | 'external_run_digest_mismatch'
  | 'invalid_render_receipt'
  | 'render_receipt_digest_mismatch'
  | 'self_evaluation'
  | 'evidence_missing'
  | 'invalid_evaluation'
  | 'invalid_human_review'
  | 'receipt_digest_mismatch'
  | 'observation_digest_mismatch'
  | 'rule_digest_mismatch'
  | 'receipt_chain_mismatch';

export interface NodeSlideReferenceFinding {
  code: NodeSlideReferenceFindingCode;
  message: string;
}

export interface NodeSlideReferenceValidation {
  ok: boolean;
  findings: NodeSlideReferenceFinding[];
}

export type NodeSlideReferenceFreshness = 'current' | 'stale' | 'invalid';

export const NODESLIDE_BANNED_REFERENCE_TAGS = Object.freeze([
  'clean',
  'beautiful',
  'modern',
  'premium',
  'good ux',
] as const);

export function validateNodeSlideReferenceObservation(
  observation: NodeSlideReferenceObservation,
): NodeSlideReferenceValidation {
  const findings: NodeSlideReferenceFinding[] = [];
  if (
    observation.schemaVersion !== NODESLIDE_REFERENCE_OBSERVATION_VERSION ||
    !descriptor(observation.id) ||
    !descriptor(observation.sourcePolicyId) ||
    !descriptor(observation.sourceLabel) ||
    !descriptor(observation.inspectedBy) ||
    !validIsoInstant(observation.inspectedAt)
  ) {
    findings.push(
      finding('invalid_observation', 'The observation identity and attribution are incomplete.'),
    );
  }

  if (!isHttpsUrl(observation.sourceUrl)) {
    findings.push(
      finding('invalid_remote_source', 'A reference observation requires an attributed HTTPS URL.'),
    );
  }
  const sourcePolicy = findAtlasSourcePolicy(observation.sourcePolicyId);
  if (!sourcePolicy || sourcePolicy.status !== 'approved') {
    findings.push(
      finding(
        'invalid_source_policy',
        'A reference observation requires an approved Atlas source policy.',
      ),
    );
  }
  if (!validInspectionMethodForPolicy(observation)) {
    findings.push(
      finding(
        'invalid_inspection_method',
        'The inspection method is not authorized for the observation source policy.',
      ),
    );
  }
  if (
    observation.sourcePolicyId === NODESLIDE_MOBBIN_REFERENCE_WORKFLOW.sourcePolicyId &&
    (observation.inspectionMethod !== NODESLIDE_MOBBIN_REFERENCE_WORKFLOW.inspectionMethod ||
      !isMobbinUrl(observation.sourceUrl) ||
      observation.inspectedAt.slice(0, 10) !== observation.lastVerifiedAt)
  ) {
    findings.push(
      finding(
        'invalid_inspection_method',
        'A Mobbin observation must bind a live remote Mobbin inspection to its lastVerifiedAt date.',
      ),
    );
  }
  if (observation.analysisOnly !== true || observation.storedSourceContent !== false) {
    findings.push(
      finding(
        'source_content_retained',
        'The durable corpus may store derived analysis, not the remote source content.',
      ),
    );
  }
  const observationRecord = observation as unknown as Record<string, unknown>;
  const retainedFields = FORBIDDEN_REMOTE_CONTENT_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(observationRecord, field),
  );
  if (retainedFields.length > 0) {
    findings.push(
      finding(
        'source_content_retained',
        `Reference observations cannot retain remote content fields: ${retainedFields.join(', ')}.`,
      ),
    );
  }

  const firstSeen = parseIsoDay(observation.firstSeenAt);
  const lastVerified = parseIsoDay(observation.lastVerifiedAt);
  if (firstSeen === null || lastVerified === null || firstSeen > lastVerified) {
    findings.push(
      finding(
        'invalid_observation_time',
        'firstSeenAt and lastVerifiedAt must be ordered ISO-8601 calendar dates.',
      ),
    );
  }

  if (!Array.isArray(observation.facts) || observation.facts.length === 0) {
    findings.push(
      finding('invalid_atomic_fact', 'An observation requires at least one atomic fact.'),
    );
  } else {
    const factIds = observation.facts.map((fact) => fact.id);
    if (new Set(factIds).size !== factIds.length) {
      findings.push(finding('duplicate_fact_id', 'Atomic fact ids must be unique.'));
    }
    for (const fact of observation.facts) {
      if (!validAtomicFact(fact)) {
        findings.push(
          finding('invalid_atomic_fact', `Atomic fact ${fact.id || '(unnamed)'} is invalid.`),
        );
      }
    }
  }

  findings.push(...tagFindings(observation));
  return validation(findings);
}

/**
 * Verifies the repository policy that makes a Mobbin-derived corpus lawful and
 * durable: inspect remotely, keep attribution, and store only NodeKit-owned
 * analysis. The source content itself remains unavailable to download, cache,
 * RAG, or embedding indexes.
 */
export function validateNodeSlideMobbinReferenceWorkflow(): NodeSlideReferenceValidation {
  const findings: NodeSlideReferenceFinding[] = [];
  const policy = findAtlasSourcePolicy(NODESLIDE_MOBBIN_REFERENCE_WORKFLOW.sourcePolicyId);
  if (
    !policy ||
    policy.status !== 'approved' ||
    policy.accessMode !== NODESLIDE_MOBBIN_REFERENCE_WORKFLOW.accessMode ||
    policy.attributionRequired !== true
  ) {
    findings.push(
      finding(
        'invalid_source_policy',
        'The Mobbin reference workflow requires the approved, attributed remote-MCP policy.',
      ),
    );
    return validation(findings);
  }

  for (const intent of NODESLIDE_MOBBIN_REFERENCE_FORBIDDEN_INTENTS) {
    if (evaluateAtlasUsage(policy, [intent]).allowed) {
      findings.push(
        finding(
          'invalid_source_policy',
          `The Mobbin policy must continue to deny ${intent} for the analysis corpus.`,
        ),
      );
    }
  }
  return validation(findings);
}

export function validateNodeSlideMobbinReferenceObservation(
  observation: NodeSlideReferenceObservation,
  run?: NodeSlideExternalReferenceRun,
): NodeSlideReferenceValidation {
  const findings = [
    ...validateNodeSlideReferenceObservation(observation).findings,
    ...validateNodeSlideMobbinReferenceWorkflow().findings,
  ];
  if (observation.sourcePolicyId !== NODESLIDE_MOBBIN_REFERENCE_WORKFLOW.sourcePolicyId) {
    findings.push(
      finding(
        'invalid_source_policy',
        'The Mobbin reference validator only accepts the registered Mobbin source policy.',
      ),
    );
  }
  const observationDigest = nodeSlideDurableDigest(observation);
  const boundToAuthenticatedRun =
    run?.status === 'PASS' &&
    run.provider === 'mobbin' &&
    run.sourcePolicyId === NODESLIDE_MOBBIN_REFERENCE_WORKFLOW.sourcePolicyId &&
    validateNodeSlideExternalReferenceRun(run).ok &&
    run.observationIds.some(
      (observationId, index) =>
        observationId === observation.id && run.observationDigests[index] === observationDigest,
    );
  if (!boundToAuthenticatedRun) {
    findings.push(
      finding(
        'invalid_external_reference_run',
        'A Mobbin observation is not valid without a PASS authenticated live run bound to its exact digest.',
      ),
    );
  }
  return validation(uniqueFindings(findings));
}

export function createNodeSlideExternalReferenceRun(
  input: Omit<NodeSlideExternalReferenceRun, 'schemaVersion' | 'runDigest'>,
): NodeSlideExternalReferenceRun {
  const body: Omit<NodeSlideExternalReferenceRun, 'runDigest'> = {
    schemaVersion: NODESLIDE_EXTERNAL_REFERENCE_RUN_VERSION,
    ...structuredClone(input),
  };
  const run: NodeSlideExternalReferenceRun = {
    ...body,
    runDigest: nodeSlideDurableDigest(body),
  };
  const result = validateNodeSlideExternalReferenceRun(run);
  refuseFindings('external reference run', result.findings);
  return run;
}

export function validateNodeSlideExternalReferenceRun(
  run: NodeSlideExternalReferenceRun,
): NodeSlideReferenceValidation {
  const findings: NodeSlideReferenceFinding[] = [];
  const { runDigest, ...body } = run;
  const sourcePolicy = findAtlasSourcePolicy(run.sourcePolicyId);
  const record = run as unknown as Record<string, unknown>;
  const retainedFields = FORBIDDEN_REMOTE_CONTENT_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(record, field),
  );
  const commonValid =
    run.schemaVersion === NODESLIDE_EXTERNAL_REFERENCE_RUN_VERSION &&
    descriptor(run.id) &&
    descriptor(run.provider) &&
    run.provider === run.sourcePolicyId &&
    run.operation === 'authenticated-live-inspection' &&
    sourcePolicy?.status === 'approved' &&
    sourcePolicy.accessMode === 'remote-mcp' &&
    run.analysisOnly === true &&
    run.storedSourceContent === false &&
    run.storedPixels === false &&
    run.cachedSourcePayload === false &&
    run.embeddingStored === false &&
    run.ragIndexed === false &&
    run.trainingUsed === false &&
    retainedFields.length === 0 &&
    run.observationIds.length === run.observationDigests.length &&
    new Set(run.observationIds).size === run.observationIds.length &&
    run.observationIds.every(descriptor) &&
    run.observationDigests.every((digest) => SHA256.test(digest));

  const honestNotRun =
    run.status === 'NOT_RUN' &&
    run.reasonCode === 'AUTHENTICATED_LIVE_INSPECTION_ABSENT' &&
    run.inspectionMethod === null &&
    run.inspectorId === null &&
    run.checkedAt === null &&
    run.observationIds.length === 0 &&
    run.observationDigests.length === 0;
  const honestPass =
    run.status === 'PASS' &&
    run.reasonCode === null &&
    run.inspectionMethod === 'authenticated-live-remote' &&
    run.inspectorId !== null &&
    descriptor(run.inspectorId) &&
    run.checkedAt !== null &&
    validIsoInstant(run.checkedAt) &&
    run.observationIds.length > 0;

  if (!commonValid || (!honestNotRun && !honestPass)) {
    findings.push(
      finding(
        'invalid_external_reference_run',
        'An external reference run must be an honest NOT_RUN or an authenticated, observation-bound PASS with every no-retention boolean false.',
      ),
    );
  }
  if (runDigest !== nodeSlideDurableDigest(body)) {
    findings.push(
      finding(
        'external_run_digest_mismatch',
        'The external reference run digest does not bind its exact state.',
      ),
    );
  }
  return validation(findings);
}

export function createNodeSlideReferenceRenderReceipt(
  input: Omit<NodeSlideReferenceRenderReceipt, 'schemaVersion' | 'receiptDigest'>,
): NodeSlideReferenceRenderReceipt {
  const body: Omit<NodeSlideReferenceRenderReceipt, 'receiptDigest'> = {
    schemaVersion: NODESLIDE_REFERENCE_RENDER_RECEIPT_VERSION,
    ...structuredClone(input),
  };
  return { ...body, receiptDigest: nodeSlideDurableDigest(body) };
}

export function validateNodeSlideReferenceRenderReceipt(
  receipt: NodeSlideReferenceRenderReceipt,
  candidate: NodeSlideReferenceCandidate,
): NodeSlideReferenceValidation {
  const findings: NodeSlideReferenceFinding[] = [];
  const { receiptDigest, ...body } = receipt;
  if (
    receipt.schemaVersion !== NODESLIDE_REFERENCE_RENDER_RECEIPT_VERSION ||
    !descriptor(receipt.id) ||
    receipt.candidateId !== candidate.id ||
    receipt.candidateArtifactDigest !== candidate.artifactDigest ||
    !SHA256.test(receipt.renderArtifactDigest) ||
    receipt.commitSha !== candidate.commitSha ||
    !COMMIT_SHA.test(receipt.commitSha) ||
    !descriptor(receipt.rendererId) ||
    receipt.rendererId === candidate.producerId ||
    !validIsoInstant(receipt.renderedAt) ||
    receipt.receiptDigest !== candidate.renderReceiptDigest
  ) {
    findings.push(
      finding(
        'invalid_render_receipt',
        'The render receipt must independently bind the exact candidate artifact and commit.',
      ),
    );
  }
  if (receiptDigest !== nodeSlideDurableDigest(body)) {
    findings.push(
      finding(
        'render_receipt_digest_mismatch',
        'The render receipt digest does not bind its exact contents.',
      ),
    );
  }
  return validation(findings);
}

export function attestNodeSlideReferenceHumanReview(
  input: Omit<NodeSlideReferenceHumanReview, 'schemaVersion' | 'attestationDigest'>,
): NodeSlideReferenceHumanReview {
  const body: Omit<NodeSlideReferenceHumanReview, 'attestationDigest'> = {
    schemaVersion: NODESLIDE_REFERENCE_HUMAN_REVIEW_VERSION,
    ...structuredClone(input),
  };
  return { ...body, attestationDigest: nodeSlideDurableDigest(body) };
}

export function attestNodeSlideReferenceNovelty(
  input: Omit<
    NodeSlideReferenceNoveltyAttestation,
    'schemaVersion' | 'novelByIntent' | 'attestationDigest'
  >,
): NodeSlideReferenceNoveltyAttestation {
  const body: Omit<NodeSlideReferenceNoveltyAttestation, 'attestationDigest'> = {
    schemaVersion: NODESLIDE_REFERENCE_NOVELTY_ATTESTATION_VERSION,
    novelByIntent: true,
    ...structuredClone(input),
  };
  return { ...body, attestationDigest: nodeSlideDurableDigest(body) };
}

/**
 * Projects local reference evidence for the browser UX. This function cannot
 * authorize a release even when projectionVerdict is PASS. The Node/server
 * adapter must independently score and verify the exact candidate through
 * @homenshum/nodekit/reference-loop.
 */
export function projectNodeSlideReferenceReleaseUx(input: {
  candidate: NodeSlideReferenceCandidate;
  renderReceipt?: NodeSlideReferenceRenderReceipt;
  referenceChain?: NodeSlideReferenceReleaseChain;
  externalReferenceRuns?: readonly NodeSlideExternalReferenceRun[];
  novelByIntent?: boolean;
  noveltyAttestation?: NodeSlideReferenceNoveltyAttestation;
  asOf: string;
  maxReferenceAgeDays?: number;
  issuedAt: string;
}): NodeSlideReferenceReleaseProjection {
  const failures: NodeSlideReferenceReleaseFinding[] = [];
  const incomplete: NodeSlideReferenceReleaseFinding[] = [];
  const externalRuns = input.externalReferenceRuns ?? [];

  if (!validIsoInstant(input.issuedAt)) {
    failures.push(
      releaseFinding(
        'candidate_binding_invalid',
        'The reference projection requires an exact ISO-8601 issuance instant.',
      ),
    );
  }

  try {
    validateCandidate(input.candidate);
  } catch (error) {
    failures.push(
      releaseFinding(
        'candidate_binding_invalid',
        error instanceof Error ? error.message : 'The candidate binding is invalid.',
      ),
    );
  }

  if (!input.renderReceipt) {
    incomplete.push(
      releaseFinding(
        'render_receipt_missing',
        'No independent render receipt was supplied for the exact candidate commit.',
      ),
    );
  } else {
    const renderResult = validateNodeSlideReferenceRenderReceipt(
      input.renderReceipt,
      input.candidate,
    );
    if (!renderResult.ok) {
      failures.push(
        releaseFinding(
          'render_receipt_invalid',
          renderResult.findings.map((entry) => entry.message).join(' '),
        ),
      );
    }
  }

  for (const run of externalRuns) {
    const runResult = validateNodeSlideExternalReferenceRun(run);
    if (!runResult.ok) {
      failures.push(
        releaseFinding(
          'external_reference_run_invalid',
          runResult.findings.map((entry) => entry.message).join(' '),
        ),
      );
    }
  }

  let provenanceMode: NodeSlideReferenceReleaseProjection['provenanceMode'] = 'NONE';
  let scoreReceiptDigest: string | null = null;
  let noveltyAttestationDigest: string | null = null;
  const chain = input.referenceChain;

  if (chain) {
    provenanceMode = 'REFERENCE_CHAIN';
    if (input.novelByIntent || input.noveltyAttestation) {
      failures.push(
        releaseFinding(
          'novelty_attestation_invalid',
          'A candidate cannot claim novel-by-intent while also presenting reference provenance.',
        ),
      );
    }
    const missing = (['observation', 'rule', 'evaluation', 'scoreReceipt'] as const).filter(
      (key) => !chain[key],
    );
    if (missing.length > 0) {
      incomplete.push(
        releaseFinding(
          'reference_chain_incomplete',
          `The reference chain is missing ${missing.join(', ')}.`,
        ),
      );
    } else {
      const observation = chain.observation as NodeSlideReferenceObservation;
      const rule = chain.rule as NodeSlideDesignRule;
      const evaluation = chain.evaluation as NodeSlideReferenceEvaluation;
      const scoreReceipt = chain.scoreReceipt as NodeSlideReferenceScoreReceipt;
      scoreReceiptDigest = scoreReceipt.receiptDigest;

      if (evaluation.evidence.length === 0) {
        incomplete.push(
          releaseFinding(
            'reference_chain_incomplete',
            'The reference evaluation has no generated evidence.',
          ),
        );
      }
      if (observation.inspectionMethod === 'synthetic-contract-fixture') {
        failures.push(
          releaseFinding(
            'release_fixture_forbidden',
            'A synthetic contract fixture can test the schema but cannot release a candidate.',
          ),
        );
      }

      try {
        const freshness = referenceObservationFreshness(
          observation,
          input.asOf,
          input.maxReferenceAgeDays ?? 90,
        );
        if (freshness !== 'current') {
          throw new Error(`The reference observation freshness is ${freshness}.`);
        }
        validateHumanReview({
          rule,
          candidate: input.candidate,
          evaluation,
          ...(chain.humanReview ? { humanReview: chain.humanReview } : {}),
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'The human override or reference is invalid.';
        failures.push(
          releaseFinding(
            message.toLowerCase().includes('human score review')
              ? 'human_override_invalid'
              : 'reference_chain_invalid',
            message,
          ),
        );
      }

      const scoreResult = verifyNodeSlideReferenceScoreReceipt(scoreReceipt, {
        observation,
        rule,
        candidate: input.candidate,
        evaluation,
        ...(chain.humanReview ? { humanReview: chain.humanReview } : {}),
      });
      if (!scoreResult.ok) {
        failures.push(
          releaseFinding(
            chain.humanReview ? 'human_override_invalid' : 'reference_chain_invalid',
            scoreResult.findings.map((entry) => entry.message).join(' '),
          ),
        );
      }

      if (observation.sourcePolicyId === NODESLIDE_MOBBIN_REFERENCE_WORKFLOW.sourcePolicyId) {
        const observationDigest = nodeSlideDurableDigest(observation);
        const mobbinRun = externalRuns.find(
          (run) =>
            run.provider === 'mobbin' &&
            run.sourcePolicyId === observation.sourcePolicyId &&
            run.status === 'PASS' &&
            run.inspectionMethod === 'authenticated-live-remote' &&
            run.observationIds.some(
              (observationId, index) =>
                observationId === observation.id &&
                run.observationDigests[index] === observationDigest,
            ),
        );
        if (!mobbinRun) {
          failures.push(
            releaseFinding(
              'mobbin_inspection_not_run',
              'Mobbin provenance cannot release while its authenticated external run is NOT_RUN, absent, or bound to another observation.',
            ),
          );
        }
      }
    }
  } else if (input.novelByIntent === true) {
    provenanceMode = 'NOVEL_BY_INTENT';
    if (
      !input.noveltyAttestation ||
      !validNoveltyAttestation(input.noveltyAttestation, input.candidate)
    ) {
      failures.push(
        releaseFinding(
          'novelty_attestation_invalid',
          'Zero-reference release requires an independent, digest-bound novel-by-intent attestation.',
        ),
      );
    } else {
      noveltyAttestationDigest = input.noveltyAttestation.attestationDigest;
    }
  } else {
    failures.push(
      releaseFinding(
        'reference_provenance_missing',
        'Zero reference provenance fails unless novelByIntent is true with a valid attestation.',
      ),
    );
  }

  const findings = [...failures, ...incomplete];
  const projectionVerdict: NodeSlideReferenceProjectionVerdict =
    failures.length > 0 ? 'FAIL' : incomplete.length > 0 ? 'INCOMPLETE' : 'PASS';
  const body: Omit<NodeSlideReferenceReleaseProjection, 'projectionDigest'> = {
    schemaVersion: NODESLIDE_REFERENCE_RELEASE_PROJECTION_VERSION,
    authoritative: false,
    releaseAuthority: '@homenshum/nodekit/reference-loop',
    candidateId: input.candidate.id,
    candidateArtifactDigest: input.candidate.artifactDigest,
    renderReceiptDigest: input.candidate.renderReceiptDigest,
    commitSha: input.candidate.commitSha,
    provenanceMode,
    scoreReceiptDigest,
    externalReferenceRunDigests: externalRuns.map((run) => run.runDigest),
    noveltyAttestationDigest,
    projectionVerdict,
    findings,
    issuedAt: input.issuedAt,
  };
  return { ...body, projectionDigest: nodeSlideDurableDigest(body) };
}

export function validateNodeSlideDesignRule(
  rule: NodeSlideDesignRule,
  observations: readonly NodeSlideReferenceObservation[],
): NodeSlideReferenceValidation {
  const findings: NodeSlideReferenceFinding[] = [];
  if (
    rule.schemaVersion !== NODESLIDE_DESIGN_RULE_VERSION ||
    !descriptor(rule.id) ||
    !descriptor(rule.statement) ||
    !descriptor(rule.mechanismHypothesis) ||
    !descriptor(rule.proposedBy) ||
    !validIsoInstant(rule.proposedAt) ||
    !Number.isFinite(rule.confidence) ||
    rule.confidence < 0 ||
    rule.confidence > 1 ||
    rule.appliesWhen.length === 0 ||
    rule.doesNotApplyWhen.length === 0 ||
    rule.appliesWhen.some((condition) => !descriptor(condition)) ||
    rule.doesNotApplyWhen.some((condition) => !descriptor(condition))
  ) {
    findings.push(
      finding(
        'invalid_design_rule',
        'A design rule needs a statement, hypothesis, bounded confidence, applicability, and proposer.',
      ),
    );
  }

  if (rule.basis.length === 0) {
    findings.push(
      finding('missing_fact_citation', 'A design rule must cite at least one atomic fact.'),
    );
  }
  const observationsById = new Map(
    observations.map((observation) => [observation.id, observation]),
  );
  for (const citation of rule.basis) {
    const observation = observationsById.get(citation.observationId);
    const knownFactIds = new Set(observation?.facts.map((fact) => fact.id) ?? []);
    if (
      !observation ||
      citation.factIds.length === 0 ||
      citation.factIds.some((factId) => !knownFactIds.has(factId))
    ) {
      findings.push(
        finding(
          'missing_fact_citation',
          `Rule ${rule.id} cites an observation or atomic fact that is not present.`,
        ),
      );
    }
  }

  findings.push(...tagFindings(rule));
  return validation(findings);
}

export function referenceObservationFreshness(
  observation: NodeSlideReferenceObservation,
  asOf: string,
  maxAgeDays: number,
): NodeSlideReferenceFreshness {
  const verified = parseIsoDay(observation.lastVerifiedAt);
  const measuredAt = parseIsoDay(asOf);
  if (
    verified === null ||
    measuredAt === null ||
    !Number.isSafeInteger(maxAgeDays) ||
    maxAgeDays < 0 ||
    measuredAt < verified
  ) {
    return 'invalid';
  }
  return (measuredAt - verified) / DAY_MS > maxAgeDays ? 'stale' : 'current';
}

export function projectNodeSlideReferenceScore(input: {
  observation: NodeSlideReferenceObservation;
  rule: NodeSlideDesignRule;
  candidate: NodeSlideReferenceCandidate;
  evaluation: NodeSlideReferenceEvaluation;
  humanReview?: NodeSlideReferenceHumanReview;
  asOf: string;
  maxReferenceAgeDays?: number;
}): NodeSlideReferenceScoreReceipt {
  const observationResult = validateNodeSlideReferenceObservation(input.observation);
  refuseFindings('observation', observationResult.findings);

  const ruleResult = validateNodeSlideDesignRule(input.rule, [input.observation]);
  refuseFindings('design rule', ruleResult.findings);

  const freshness = referenceObservationFreshness(
    input.observation,
    input.asOf,
    input.maxReferenceAgeDays ?? 90,
  );
  if (freshness !== 'current') {
    throw new Error(
      freshness === 'stale'
        ? 'Cannot project a score from a stale reference observation.'
        : 'Cannot project a score with invalid reference freshness inputs.',
    );
  }

  validateCandidate(input.candidate);
  validateEvaluation(input);
  const humanReview = validateHumanReview(input);
  const finalScore =
    humanReview?.decision === 'override'
      ? (humanReview.revisedScore as number)
      : input.evaluation.score;
  const issuedAt = humanReview?.reviewedAt ?? input.evaluation.evaluatedAt;

  const body: Omit<NodeSlideReferenceScoreReceipt, 'receiptDigest'> = {
    schemaVersion: NODESLIDE_REFERENCE_SCORE_RECEIPT_VERSION,
    id: `score-receipt:${input.evaluation.id}`,
    observationId: input.observation.id,
    observationDigest: nodeSlideDurableDigest(input.observation),
    sourcePolicyId: input.observation.sourcePolicyId,
    sourceLastVerifiedAt: input.observation.lastVerifiedAt,
    factIds: unique(input.evaluation.factIds),
    ruleId: input.rule.id,
    ruleDigest: nodeSlideDurableDigest(input.rule),
    candidateId: input.candidate.id,
    candidateProducerId: input.candidate.producerId,
    candidateArtifactDigest: input.candidate.artifactDigest,
    harnessRevisionDigest: input.candidate.harnessRevisionDigest,
    candidateRenderReceiptDigest: input.candidate.renderReceiptDigest,
    candidateCommitSha: input.candidate.commitSha,
    evaluationId: input.evaluation.id,
    evaluationDigest: nodeSlideDurableDigest(input.evaluation),
    evaluatorId: input.evaluation.evaluatorId,
    evaluatorRunId: input.evaluation.evaluatorRunId,
    evaluatorMethodVersion: input.evaluation.methodVersion,
    evaluatorEvidenceIds: input.evaluation.evidence.map((evidence) => evidence.id),
    evaluatorEvidenceDigests: input.evaluation.evidence.map((evidence) => evidence.digest),
    score: input.evaluation.score,
    scale: { ...input.evaluation.scale },
    finalScore,
    humanReview,
    issuedAt,
  };
  return { ...body, receiptDigest: nodeSlideDurableDigest(body) };
}

export function verifyNodeSlideReferenceScoreReceipt(
  receipt: NodeSlideReferenceScoreReceipt,
  context: {
    observation: NodeSlideReferenceObservation;
    rule: NodeSlideDesignRule;
    candidate: NodeSlideReferenceCandidate;
    evaluation: NodeSlideReferenceEvaluation;
    humanReview?: NodeSlideReferenceHumanReview;
  },
): NodeSlideReferenceValidation {
  const findings: NodeSlideReferenceFinding[] = [];
  const { receiptDigest, ...body } = receipt;
  if (receiptDigest !== nodeSlideDurableDigest(body)) {
    findings.push(finding('receipt_digest_mismatch', 'The score receipt digest is invalid.'));
  }

  const observationResult = validateNodeSlideReferenceObservation(context.observation);
  findings.push(...observationResult.findings);
  const ruleResult = validateNodeSlideDesignRule(context.rule, [context.observation]);
  findings.push(...ruleResult.findings);

  if (receipt.observationDigest !== nodeSlideDurableDigest(context.observation)) {
    findings.push(
      finding('observation_digest_mismatch', 'The cited reference observation has changed.'),
    );
  }
  if (receipt.ruleDigest !== nodeSlideDurableDigest(context.rule)) {
    findings.push(finding('rule_digest_mismatch', 'The cited design rule has changed.'));
  }

  try {
    validateCandidate(context.candidate);
    validateEvaluation(context);
    validateHumanReview(context);
  } catch (error) {
    findings.push(
      finding(
        'receipt_chain_mismatch',
        error instanceof Error ? error.message : 'The evaluation context is invalid.',
      ),
    );
  }

  const citedByRule = new Set(
    context.rule.basis
      .filter((basis) => basis.observationId === context.observation.id)
      .flatMap((basis) => basis.factIds),
  );
  const expectedFinalScore =
    context.humanReview?.decision === 'override'
      ? (context.humanReview.revisedScore ?? Number.NaN)
      : context.evaluation.score;
  const expectedIssuedAt = context.humanReview?.reviewedAt ?? context.evaluation.evaluatedAt;
  if (
    receipt.schemaVersion !== NODESLIDE_REFERENCE_SCORE_RECEIPT_VERSION ||
    receipt.observationId !== context.observation.id ||
    receipt.ruleId !== context.rule.id ||
    receipt.candidateId !== context.candidate.id ||
    receipt.candidateProducerId !== context.candidate.producerId ||
    receipt.candidateArtifactDigest !== context.candidate.artifactDigest ||
    receipt.harnessRevisionDigest !== context.candidate.harnessRevisionDigest ||
    receipt.candidateRenderReceiptDigest !== context.candidate.renderReceiptDigest ||
    receipt.candidateCommitSha !== context.candidate.commitSha ||
    receipt.evaluationId !== context.evaluation.id ||
    receipt.evaluationDigest !== nodeSlideDurableDigest(context.evaluation) ||
    receipt.evaluatorId !== context.evaluation.evaluatorId ||
    receipt.evaluatorRunId !== context.evaluation.evaluatorRunId ||
    receipt.evaluatorMethodVersion !== context.evaluation.methodVersion ||
    receipt.sourcePolicyId !== context.observation.sourcePolicyId ||
    receipt.sourceLastVerifiedAt !== context.observation.lastVerifiedAt ||
    receipt.factIds.length === 0 ||
    receipt.factIds.some((factId) => !citedByRule.has(factId)) ||
    nodeSlideDurableDigest(receipt.factIds) !==
      nodeSlideDurableDigest(unique(context.evaluation.factIds)) ||
    receipt.candidateProducerId === receipt.evaluatorId ||
    !SHA256.test(receipt.candidateArtifactDigest) ||
    !SHA256.test(receipt.harnessRevisionDigest) ||
    !SHA256.test(receipt.candidateRenderReceiptDigest) ||
    !COMMIT_SHA.test(receipt.candidateCommitSha) ||
    !SHA256.test(receipt.evaluationDigest) ||
    receipt.evaluatorEvidenceIds.length === 0 ||
    receipt.evaluatorEvidenceIds.length !== receipt.evaluatorEvidenceDigests.length ||
    nodeSlideDurableDigest(receipt.evaluatorEvidenceIds) !==
      nodeSlideDurableDigest(context.evaluation.evidence.map((evidence) => evidence.id)) ||
    nodeSlideDurableDigest(receipt.evaluatorEvidenceDigests) !==
      nodeSlideDurableDigest(context.evaluation.evidence.map((evidence) => evidence.digest)) ||
    receipt.evaluatorEvidenceDigests.some((digest) => !SHA256.test(digest)) ||
    nodeSlideDurableDigest(receipt.humanReview) !==
      nodeSlideDurableDigest(context.humanReview ?? null) ||
    receipt.score !== context.evaluation.score ||
    nodeSlideDurableDigest(receipt.scale) !== nodeSlideDurableDigest(context.evaluation.scale) ||
    receipt.finalScore !== expectedFinalScore ||
    receipt.issuedAt !== expectedIssuedAt ||
    !scoreWithin(receipt.finalScore, receipt.scale)
  ) {
    findings.push(
      finding(
        'receipt_chain_mismatch',
        'The score receipt is not bound to a valid independent observation-rule-evidence chain.',
      ),
    );
  }

  return validation(findings);
}

function validateCandidate(candidate: NodeSlideReferenceCandidate): void {
  if (
    !descriptor(candidate.id) ||
    !descriptor(candidate.producerId) ||
    !SHA256.test(candidate.artifactDigest) ||
    !SHA256.test(candidate.harnessRevisionDigest) ||
    !SHA256.test(candidate.renderReceiptDigest) ||
    !COMMIT_SHA.test(candidate.commitSha)
  ) {
    throw new Error('Cannot project a score for an invalid candidate binding.');
  }
}

function validateEvaluation(input: {
  observation: NodeSlideReferenceObservation;
  rule: NodeSlideDesignRule;
  candidate: NodeSlideReferenceCandidate;
  evaluation: NodeSlideReferenceEvaluation;
}): void {
  const { candidate, evaluation, observation, rule } = input;
  if (evaluation.evaluatorId === candidate.producerId) {
    throw new Error('An evaluator cannot evaluate its own candidate.');
  }
  if (evaluation.evaluatorId === rule.proposedBy) {
    throw new Error('A rule proposer cannot approve its own proposed evaluation rule.');
  }
  if (evaluation.evidence.length === 0) {
    throw new Error('An evaluator must provide generated evidence; a bare score is not a receipt.');
  }

  const ruleFacts = new Set(
    rule.basis
      .filter((basis) => basis.observationId === observation.id)
      .flatMap((basis) => basis.factIds),
  );
  const evidenceIds = evaluation.evidence.map((evidence) => evidence.id);
  const validEvidence =
    new Set(evidenceIds).size === evidenceIds.length &&
    evaluation.evidence.every(
      (evidence) =>
        descriptor(evidence.id) &&
        descriptor(evidence.locator) &&
        SHA256.test(evidence.digest) &&
        evidence.generatedBy === evaluation.evaluatorId,
    );

  if (
    !descriptor(evaluation.id) ||
    !descriptor(evaluation.evaluatorId) ||
    !descriptor(evaluation.evaluatorRunId) ||
    !descriptor(evaluation.methodVersion) ||
    evaluation.candidateId !== candidate.id ||
    evaluation.ruleId !== rule.id ||
    evaluation.observationId !== observation.id ||
    evaluation.factIds.length === 0 ||
    evaluation.factIds.some((factId) => !ruleFacts.has(factId)) ||
    !scoreWithin(evaluation.score, evaluation.scale) ||
    !validIsoInstant(evaluation.evaluatedAt) ||
    !validEvidence
  ) {
    throw new Error(
      'The independent evaluator result is invalid or is not bound to generated evidence.',
    );
  }
}

function validateHumanReview(input: {
  rule: NodeSlideDesignRule;
  candidate: NodeSlideReferenceCandidate;
  evaluation: NodeSlideReferenceEvaluation;
  humanReview?: NodeSlideReferenceHumanReview;
}): NodeSlideReferenceHumanReview | null {
  const review = input.humanReview;
  if (!review) return null;

  const { attestationDigest, ...attestationBody } = review;
  const independent = ![
    input.rule.proposedBy,
    input.candidate.producerId,
    input.evaluation.evaluatorId,
  ].includes(review.reviewerId);
  const scoreIsValid =
    review.decision === 'override'
      ? review.revisedScore !== undefined &&
        scoreWithin(review.revisedScore, input.evaluation.scale)
      : review.revisedScore === undefined;
  if (
    review.schemaVersion !== NODESLIDE_REFERENCE_HUMAN_REVIEW_VERSION ||
    review.candidateId !== input.candidate.id ||
    review.evaluationId !== input.evaluation.id ||
    !independent ||
    !descriptor(review.reviewerId) ||
    !review.reviewerId.startsWith('human:') ||
    !descriptor(review.reason) ||
    !validIsoInstant(review.reviewedAt) ||
    !scoreIsValid ||
    attestationDigest !== nodeSlideDurableDigest(attestationBody)
  ) {
    throw new Error(
      'A human score review must be independent, reasoned, timestamped, digest-attested, bound to the candidate and evaluation, and within the score scale.',
    );
  }
  return structuredClone(review);
}

function validInspectionMethodForPolicy(observation: NodeSlideReferenceObservation): boolean {
  if (observation.sourcePolicyId === 'nodeslide-owned') {
    return ['owned-source-inspection', 'synthetic-contract-fixture'].includes(
      observation.inspectionMethod,
    );
  }
  if (observation.sourcePolicyId === 'workspace-private') {
    return observation.inspectionMethod === 'workspace-private-inspection';
  }
  return observation.inspectionMethod === 'live-remote';
}

function validNoveltyAttestation(
  attestation: NodeSlideReferenceNoveltyAttestation,
  candidate: NodeSlideReferenceCandidate,
): boolean {
  const { attestationDigest, ...body } = attestation;
  return (
    attestation.schemaVersion === NODESLIDE_REFERENCE_NOVELTY_ATTESTATION_VERSION &&
    attestation.novelByIntent === true &&
    attestation.candidateId === candidate.id &&
    attestation.candidateArtifactDigest === candidate.artifactDigest &&
    attestation.renderReceiptDigest === candidate.renderReceiptDigest &&
    attestation.commitSha === candidate.commitSha &&
    descriptor(attestation.attestedBy) &&
    attestation.attestedBy.startsWith('human:') &&
    attestation.attestedBy !== candidate.producerId &&
    descriptor(attestation.reason) &&
    validIsoInstant(attestation.attestedAt) &&
    attestationDigest === nodeSlideDurableDigest(body)
  );
}

function validAtomicFact(fact: NodeSlideReferenceAtomicFact): boolean {
  if (
    !descriptor(fact.id) ||
    !NODESLIDE_REFERENCE_FACT_KINDS.includes(fact.kind) ||
    !descriptor(fact.subject) ||
    !descriptor(fact.property) ||
    !descriptor(fact.unit) ||
    !descriptor(fact.locatorDescription)
  ) {
    return false;
  }
  if (fact.kind === 'count') {
    return typeof fact.value === 'number' && Number.isSafeInteger(fact.value) && fact.value >= 0;
  }
  if (fact.kind === 'measurement') {
    return typeof fact.value === 'number' && Number.isFinite(fact.value);
  }
  return typeof fact.value === 'string' && descriptor(fact.value);
}

function tagFindings(value: {
  problemTags: string[];
  intentTags: string[];
  layoutTags: string[];
  interactionTags: string[];
}): NodeSlideReferenceFinding[] {
  const groups = [value.problemTags, value.intentTags, value.layoutTags, value.interactionTags];
  const tags = groups.flat();
  if (
    groups.some(
      (group) =>
        !Array.isArray(group) ||
        group.length === 0 ||
        group.some((tag) => !descriptor(tag)) ||
        new Set(group.map(normalizeTag)).size !== group.length,
    )
  ) {
    return [
      finding(
        'invalid_observation',
        'Every retrieval axis requires unique, non-empty problem/intent/layout/interaction tags.',
      ),
    ];
  }
  const banned = tags.filter((tag) =>
    NODESLIDE_BANNED_REFERENCE_TAGS.includes(
      normalizeTag(tag) as (typeof NODESLIDE_BANNED_REFERENCE_TAGS)[number],
    ),
  );
  return banned.length > 0
    ? [
        finding(
          'banned_retrieval_tag',
          `Appearance-only retrieval tags are not citable: ${banned.join(', ')}.`,
        ),
      ]
    : [];
}

function normalizeTag(value: string): string {
  return value.trim().toLowerCase().replace(/[-_]+/gu, ' ').replace(/\s+/gu, ' ');
}

function scoreWithin(score: number, scale: { min: number; max: number }): boolean {
  return (
    Number.isFinite(scale.min) &&
    Number.isFinite(scale.max) &&
    scale.min < scale.max &&
    Number.isFinite(score) &&
    score >= scale.min &&
    score <= scale.max
  );
}

function refuseFindings(label: string, findings: readonly NodeSlideReferenceFinding[]): void {
  if (findings.length > 0) {
    throw new Error(
      `Cannot project a score from an invalid ${label}: ${findings
        .map((entry) => entry.message)
        .join(' ')}`,
    );
  }
}

function parseIsoDay(value: string): number | null {
  if (!ISO_DATE.test(value)) return null;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().startsWith(value)
    ? parsed
    : null;
}

function validIsoInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function isMobbinUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === 'mobbin.com' || parsed.hostname.endsWith('.mobbin.com'))
    );
  } catch {
    return false;
  }
}

function descriptor(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 500;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueFindings(
  findings: readonly NodeSlideReferenceFinding[],
): NodeSlideReferenceFinding[] {
  return [...new Map(findings.map((entry) => [`${entry.code}:${entry.message}`, entry])).values()];
}

function finding(code: NodeSlideReferenceFindingCode, message: string): NodeSlideReferenceFinding {
  return { code, message };
}

function releaseFinding(
  code: NodeSlideReferenceReleaseFindingCode,
  message: string,
): NodeSlideReferenceReleaseFinding {
  return { code, message };
}

function validation(findings: NodeSlideReferenceFinding[]): NodeSlideReferenceValidation {
  return { ok: findings.length === 0, findings };
}
