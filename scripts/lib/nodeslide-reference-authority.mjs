import {
  referenceContentDigest,
  scoreReferenceCandidate,
  verifyReferenceScoreReceipt,
} from '@homenshum/nodekit/reference-loop';

export const NODESLIDE_NODEKIT_REFERENCE_AUTHORITY = Object.freeze({
  packageName: '@homenshum/nodekit',
  exportPath: '@homenshum/nodekit/reference-loop',
  sourceCommit: 'ab7c9e69e53e2eb1838f0d854dafb490f960537c',
  decisionSchemaVersion: 'nodeslide.nodekit-reference-release-decision/v1',
});

/**
 * Node/server-only release authority.
 *
 * Do not import this module from shared/ or the browser application. NodeKit's
 * verifier reads immutable records from Git and intentionally depends on Node
 * crypto, filesystem, and child-process APIs.
 */
export async function authorizeNodeSlideReferenceRelease(input) {
  try {
    const scored = await scoreReferenceCandidate(input.repoRoot, {
      candidateReceipt: input.candidateReceipt,
      ruleIds: input.ruleIds,
      profile: input.profile,
      ...(input.humanOverride ? { humanOverride: input.humanOverride } : {}),
    });
    const decision = await verifyNodeSlideReferenceRelease({
      repoRoot: input.repoRoot,
      candidateReceipt: input.candidateReceipt,
      scoreReceipt: scored.score,
      ...(input.projection ? { projection: input.projection } : {}),
    });
    return {
      ...decision,
      authorityReceiptPath: scored.output,
    };
  } catch (error) {
    return failedDecision({
      candidateReceipt: input.candidateReceipt,
      projection: input.projection,
      findings: [errorMessage(error)],
    });
  }
}

export async function verifyNodeSlideReferenceRelease(input) {
  try {
    const verification = await verifyReferenceScoreReceipt(input.repoRoot, input.scoreReceipt, {
      candidateReceipt: input.candidateReceipt,
    });
    return buildDecision({
      candidateReceipt: input.candidateReceipt,
      scoreReceipt: input.scoreReceipt,
      projection: input.projection,
      verification,
    });
  } catch (error) {
    return failedDecision({
      candidateReceipt: input.candidateReceipt,
      projection: input.projection,
      findings: [errorMessage(error)],
    });
  }
}

function buildDecision({ candidateReceipt, scoreReceipt, projection, verification }) {
  const verdict =
    verification.verdict === 'pass'
      ? 'PASS'
      : verification.verdict === 'incomplete'
        ? 'INCOMPLETE'
        : 'FAIL';
  const body = {
    schemaVersion: NODESLIDE_NODEKIT_REFERENCE_AUTHORITY.decisionSchemaVersion,
    authoritative: true,
    releaseAuthority: NODESLIDE_NODEKIT_REFERENCE_AUTHORITY.exportPath,
    authoritySourceCommit: NODESLIDE_NODEKIT_REFERENCE_AUTHORITY.sourceCommit,
    candidate: candidateIdentity(candidateReceipt),
    authorityReceipt: authorityReceiptIdentity(scoreReceipt),
    projection: projectionSummary(projection, candidateReceipt),
    verdict,
    findings: verification.findings.map(String),
  };
  return {
    ...body,
    decisionDigest: `sha256:${referenceContentDigest(body)}`,
    authorityReceiptPath: null,
  };
}

function failedDecision({ candidateReceipt, projection, findings }) {
  return buildDecision({
    candidateReceipt,
    scoreReceipt: null,
    projection,
    verification: {
      verdict: 'fail',
      findings,
    },
  });
}

function candidateIdentity(candidateReceipt) {
  return {
    candidateId: stringOrEmpty(candidateReceipt?.candidateId),
    renderReceiptId: stringOrEmpty(candidateReceipt?.renderReceiptId),
    candidateCommit: stringOrEmpty(candidateReceipt?.candidateCommit),
  };
}

function authorityReceiptIdentity(scoreReceipt) {
  if (!scoreReceipt || typeof scoreReceipt !== 'object') return null;
  return {
    receiptId: stringOrEmpty(scoreReceipt.receiptId),
    contentDigest: stringOrEmpty(scoreReceipt.contentDigest),
    profile: stringOrEmpty(scoreReceipt.profile),
  };
}

function projectionSummary(projection, candidateReceipt) {
  if (!projection || typeof projection !== 'object') return null;
  const candidate = candidateIdentity(candidateReceipt);
  const candidateId = stringOrEmpty(projection.candidateId);
  const commitSha = stringOrEmpty(projection.commitSha);
  return {
    authoritative: false,
    projectionVerdict: stringOrEmpty(projection.projectionVerdict),
    projectionDigest: stringOrEmpty(projection.projectionDigest),
    aligned: candidateId === candidate.candidateId && commitSha === candidate.candidateCommit,
  };
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value : '';
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
