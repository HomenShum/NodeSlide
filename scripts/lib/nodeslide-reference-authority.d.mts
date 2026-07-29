import type {
  ReferenceCandidateReceiptV1,
  ReferenceScoreReceiptV1,
} from '@homenshum/nodekit/reference-loop';

export interface NodeSlideReferenceProjectionLike {
  candidateId: string;
  commitSha: string;
  projectionVerdict: string;
  projectionDigest: string;
}

export interface NodeSlideNodeKitReleaseDecision {
  schemaVersion: 'nodeslide.nodekit-reference-release-decision/v1';
  authoritative: true;
  releaseAuthority: '@homenshum/nodekit/reference-loop';
  authoritySourceCommit: 'ab7c9e69e53e2eb1838f0d854dafb490f960537c';
  candidate: {
    candidateId: string;
    renderReceiptId: string;
    candidateCommit: string;
  };
  authorityReceipt: {
    receiptId: string;
    contentDigest: string;
    profile: string;
  } | null;
  authorityReceiptPath: string | null;
  projection: {
    authoritative: false;
    projectionVerdict: string;
    projectionDigest: string;
    aligned: boolean;
  } | null;
  verdict: 'PASS' | 'FAIL' | 'INCOMPLETE';
  findings: string[];
  decisionDigest: `sha256:${string}`;
}

export const NODESLIDE_NODEKIT_REFERENCE_AUTHORITY: Readonly<{
  packageName: '@homenshum/nodekit';
  exportPath: '@homenshum/nodekit/reference-loop';
  sourceCommit: 'ab7c9e69e53e2eb1838f0d854dafb490f960537c';
  decisionSchemaVersion: 'nodeslide.nodekit-reference-release-decision/v1';
}>;

export function authorizeNodeSlideReferenceRelease(input: {
  repoRoot: string;
  candidateReceipt: ReferenceCandidateReceiptV1;
  ruleIds: string[];
  profile: string;
  humanOverride?: NonNullable<ReferenceScoreReceiptV1['humanOverride']>;
  projection?: NodeSlideReferenceProjectionLike;
}): Promise<NodeSlideNodeKitReleaseDecision>;

export function verifyNodeSlideReferenceRelease(input: {
  repoRoot: string;
  candidateReceipt: ReferenceCandidateReceiptV1;
  scoreReceipt: ReferenceScoreReceiptV1;
  projection?: NodeSlideReferenceProjectionLike;
}): Promise<NodeSlideNodeKitReleaseDecision>;
