export const NODESLIDE_MOTION_EVIDENCE_VERSION = 'nodeslide.motion-evidence/v1' as const;
export const NODESLIDE_MOTION_DECEPTION_IDS = Object.freeze([1, 2, 3, 4, 5, 6, 7] as const);

export type NodeSlideMotionDeceptionId = (typeof NODESLIDE_MOTION_DECEPTION_IDS)[number];
export type NodeSlideMotionEvidenceLayer =
  | 'showcase'
  | 'video-judge'
  | 'dom-trace'
  | 'runtime-instrumentation'
  | 'audience-study';
export type NodeSlideMotionVerdict = 'pass' | 'fail';
export type NodeSlideMotionProofVerdict = NodeSlideMotionVerdict | 'conflicted' | 'not-run';
export type NodeSlideMotionEvidenceTier = 'M0' | 'M1' | 'M2' | 'M3' | 'NOT_RUN';

export type NodeSlideMotionEvidenceMechanism =
  | 'showcase-recording'
  | 'video-judge'
  | 'dom-state-trace'
  | 'element-get-animations'
  | 'mount-observer'
  | 'geometry-decoy-reconciliation'
  | 'capture-clock-control'
  | 'paired-reduced-motion'
  | 'causal-knockout-construction-blocked'
  | 'gsap-fast-forward'
  | 'live-video-build-reconciliation'
  | 'human-audience-study';

export interface NodeSlideMotionEvidenceRef {
  locator: string;
  digest: string;
}

export interface NodeSlideMotionEvidenceReceipt {
  schemaVersion: typeof NODESLIDE_MOTION_EVIDENCE_VERSION;
  id: string;
  claimId: string;
  deceptionClassId: NodeSlideMotionDeceptionId;
  layer: NodeSlideMotionEvidenceLayer;
  mechanism: NodeSlideMotionEvidenceMechanism;
  producerId: string;
  evaluatorId: string;
  sourceBuildDigest: string;
  artifactDigest: string;
  verdict: NodeSlideMotionVerdict;
  evidenceRefs: NodeSlideMotionEvidenceRef[];
  observedAt: string;
}

export type NodeSlideMotionEvidenceFindingCode =
  | 'invalid_receipt'
  | 'self_evaluation'
  | 'stale_build_evidence'
  | 'evidence_missing'
  | 'invalid_layer_mechanism'
  | 'invalid_knockout'
  | 'mixed_claims';

export interface NodeSlideMotionEvidenceFinding {
  receiptId: string;
  code: NodeSlideMotionEvidenceFindingCode;
  message: string;
}

export interface NodeSlideMotionLayerVerdict {
  verdict: NodeSlideMotionProofVerdict;
  receiptIds: string[];
}

export interface NodeSlideMotionTechnicalVerdict extends NodeSlideMotionLayerVerdict {
  authority: 'runtime-instrumentation' | 'dom-trace' | null;
}

export interface NodeSlideMotionDeceptionCoverage {
  deceptionClassId: NodeSlideMotionDeceptionId;
  status: 'covered' | 'not-run';
  receiptIds: string[];
}

export interface NodeSlideMotionEvidenceResult {
  tier: NodeSlideMotionEvidenceTier;
  technical: NodeSlideMotionTechnicalVerdict;
  videoAdvisory: NodeSlideMotionLayerVerdict;
  usefulness: NodeSlideMotionLayerVerdict;
  deceptionCoverage: NodeSlideMotionDeceptionCoverage[];
  acceptedReceiptIds: string[];
  rejected: NodeSlideMotionEvidenceFinding[];
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;

/**
 * Motion proof has three independent outputs. Runtime/DOM evidence answers
 * whether the mechanism occurred, video is advisory, and a human study answers
 * whether the motion was useful. The outputs are never averaged into a score.
 */
export function evaluateNodeSlideMotionEvidence(
  receipts: readonly NodeSlideMotionEvidenceReceipt[],
  currentBuildDigest: string,
): NodeSlideMotionEvidenceResult {
  const accepted: NodeSlideMotionEvidenceReceipt[] = [];
  const rejected: NodeSlideMotionEvidenceFinding[] = [];

  for (const receipt of receipts) {
    const findings = validateReceipt(receipt, currentBuildDigest);
    if (findings.length > 0) rejected.push(...findings);
    else accepted.push(receipt);
  }

  const claimIds = new Set(accepted.map((receipt) => receipt.claimId));
  if (claimIds.size > 1) {
    for (const receipt of accepted) {
      rejected.push(
        finding(
          receipt.id,
          'mixed_claims',
          'Evidence for different motion claims cannot be combined into one proof result.',
        ),
      );
    }
    accepted.length = 0;
  }

  const runtime = accepted.filter((receipt) => receipt.layer === 'runtime-instrumentation');
  const dom = accepted.filter((receipt) => receipt.layer === 'dom-trace');
  const video = accepted.filter((receipt) => receipt.layer === 'video-judge');
  const audience = accepted.filter((receipt) => receipt.layer === 'audience-study');
  const showcase = accepted.filter((receipt) => receipt.layer === 'showcase');
  const technicalSource = runtime.length > 0 ? runtime : dom;
  const authority =
    runtime.length > 0 ? 'runtime-instrumentation' : dom.length > 0 ? 'dom-trace' : null;
  const technical = layerVerdict(technicalSource);
  const videoAdvisory = layerVerdict(video);
  const usefulness = layerVerdict(audience);

  const tier: NodeSlideMotionEvidenceTier =
    runtime.length > 0 && audience.length > 0
      ? 'M3'
      : runtime.length > 0
        ? 'M2'
        : dom.length > 0
          ? 'M1'
          : showcase.length > 0 || video.length > 0
            ? 'M0'
            : 'NOT_RUN';

  return {
    tier,
    technical: { ...technical, authority },
    videoAdvisory,
    usefulness,
    deceptionCoverage: NODESLIDE_MOTION_DECEPTION_IDS.map((deceptionClassId) => {
      const covering = accepted.filter(
        (receipt) =>
          receipt.deceptionClassId === deceptionClassId &&
          (receipt.layer === 'runtime-instrumentation' || receipt.layer === 'dom-trace'),
      );
      return {
        deceptionClassId,
        status: covering.length > 0 ? 'covered' : 'not-run',
        receiptIds: covering.map((receipt) => receipt.id),
      };
    }),
    acceptedReceiptIds: accepted.map((receipt) => receipt.id),
    rejected,
  };
}

function validateReceipt(
  receipt: NodeSlideMotionEvidenceReceipt,
  currentBuildDigest: string,
): NodeSlideMotionEvidenceFinding[] {
  const findings: NodeSlideMotionEvidenceFinding[] = [];
  if (
    receipt.schemaVersion !== NODESLIDE_MOTION_EVIDENCE_VERSION ||
    !descriptor(receipt.id) ||
    !descriptor(receipt.claimId) ||
    !NODESLIDE_MOTION_DECEPTION_IDS.includes(receipt.deceptionClassId) ||
    !descriptor(receipt.producerId) ||
    !descriptor(receipt.evaluatorId) ||
    !SHA256.test(receipt.sourceBuildDigest) ||
    !SHA256.test(receipt.artifactDigest) ||
    !validIsoInstant(receipt.observedAt)
  ) {
    findings.push(
      finding(receipt.id, 'invalid_receipt', 'The motion evidence receipt is malformed.'),
    );
  }

  if (receipt.sourceBuildDigest !== currentBuildDigest) {
    findings.push(
      finding(
        receipt.id,
        'stale_build_evidence',
        'The evidence was captured from a different build.',
      ),
    );
  }

  if (receipt.layer !== 'showcase' && receipt.evaluatorId === receipt.producerId) {
    findings.push(
      finding(
        receipt.id,
        'self_evaluation',
        'The producer cannot approve its own motion evidence.',
      ),
    );
  }

  if (
    receipt.evidenceRefs.length === 0 ||
    receipt.evidenceRefs.some(
      (evidence) => !descriptor(evidence.locator) || !SHA256.test(evidence.digest),
    )
  ) {
    findings.push(
      finding(
        receipt.id,
        'evidence_missing',
        'A motion verdict requires immutable evidence refs; a bare verdict is not evidence.',
      ),
    );
  }

  if (!mechanismMatchesLayer(receipt.layer, receipt.mechanism)) {
    findings.push(
      finding(
        receipt.id,
        'invalid_layer_mechanism',
        `${receipt.mechanism} cannot establish the ${receipt.layer} layer.`,
      ),
    );
  }

  if (
    receipt.deceptionClassId === 6 &&
    receipt.layer === 'runtime-instrumentation' &&
    receipt.mechanism !== 'causal-knockout-construction-blocked'
  ) {
    findings.push(
      finding(
        receipt.id,
        'invalid_knockout',
        'Deception class 6 requires preventing timeline construction; fast-forwarding is not a knockout.',
      ),
    );
  }
  return findings;
}

function mechanismMatchesLayer(
  layer: NodeSlideMotionEvidenceLayer,
  mechanism: NodeSlideMotionEvidenceMechanism,
): boolean {
  if (layer === 'showcase') return mechanism === 'showcase-recording';
  if (layer === 'video-judge') return mechanism === 'video-judge';
  if (layer === 'dom-trace') return mechanism === 'dom-state-trace';
  if (layer === 'audience-study') return mechanism === 'human-audience-study';
  return [
    'element-get-animations',
    'mount-observer',
    'geometry-decoy-reconciliation',
    'capture-clock-control',
    'paired-reduced-motion',
    'causal-knockout-construction-blocked',
    'gsap-fast-forward',
    'live-video-build-reconciliation',
  ].includes(mechanism);
}

function layerVerdict(
  receipts: readonly NodeSlideMotionEvidenceReceipt[],
): NodeSlideMotionLayerVerdict {
  if (receipts.length === 0) return { verdict: 'not-run', receiptIds: [] };
  const verdicts = new Set(receipts.map((receipt) => receipt.verdict));
  return {
    verdict: verdicts.size === 1 ? (receipts[0]?.verdict ?? 'not-run') : 'conflicted',
    receiptIds: receipts.map((receipt) => receipt.id),
  };
}

function validIsoInstant(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function descriptor(value: string): boolean {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 500;
}

function finding(
  receiptId: string,
  code: NodeSlideMotionEvidenceFindingCode,
  message: string,
): NodeSlideMotionEvidenceFinding {
  return { receiptId, code, message };
}
