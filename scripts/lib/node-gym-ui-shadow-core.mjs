export const NODE_GYM_ARTIFACT_SHADOW_BINDING_SCHEMA = 'nodekit.gym-artifact-shadow-binding/v1';

/** Whitelists only anonymized, non-mutating receipt fields safe for a Gym run. */
export function sanitizeNodeGymArtifactShadowReceipt(receipt) {
  const authoredFieldsPresent =
    receipt?.authoredBindingCount !== undefined ||
    receipt?.canonicalArtifactCount !== undefined ||
    receipt?.canonicalKindCounts !== undefined ||
    receipt?.canonicalArtifacts !== undefined ||
    receipt?.preservedIntentDigest !== undefined;
  const canonicalArtifacts = Array.isArray(receipt?.canonicalArtifacts)
    ? receipt.canonicalArtifacts
    : [];
  const validAuthoredFields =
    !authoredFieldsPresent ||
    (Number.isInteger(receipt?.authoredBindingCount) &&
      receipt.authoredBindingCount >= 0 &&
      Number.isInteger(receipt?.canonicalArtifactCount) &&
      receipt.canonicalArtifactCount >= 0 &&
      receipt.canonicalArtifactCount <= receipt.authoredBindingCount &&
      Array.isArray(receipt?.canonicalKindCounts) &&
      receipt.canonicalKindCounts.every(
        (entry) =>
          typeof entry?.kind === 'string' && Number.isInteger(entry?.count) && entry.count > 0,
      ) &&
      canonicalArtifacts.length === receipt.canonicalArtifactCount &&
      canonicalArtifacts.every(
        (entry, index) =>
          typeof entry?.kind === 'string' &&
          isDigest(entry?.specDigest) &&
          isDigest(entry?.bindingDigest) &&
          (index === 0 ||
            `${canonicalArtifacts[index - 1].kind}\u001f${canonicalArtifacts[index - 1].specDigest}` <
              `${entry.kind}\u001f${entry.specDigest}`),
      ) &&
      canonicalKindCountsMatch(receipt.canonicalKindCounts, canonicalArtifacts) &&
      isDigest(receipt?.preservedIntentDigest));
  const valid =
    receipt?.schemaVersion === 'nodeslide.artifact-shadow-receipt/v1' &&
    receipt?.status === 'passed' &&
    receipt?.userVisible === false &&
    receipt?.mutationApplied === false &&
    receipt?.anonymized === true &&
    isDigest(receipt?.deckBindingDigest) &&
    isDigest(receipt?.compilationReceiptDigest) &&
    isDigest(receipt?.specSetDigest) &&
    isDigest(receipt?.receiptDigest) &&
    Number.isInteger(receipt?.artifactCount) &&
    receipt.artifactCount > 0 &&
    Number.isInteger(receipt?.coveredElementCount) &&
    receipt.coveredElementCount > 0 &&
    Array.isArray(receipt?.issueCodes) &&
    receipt.issueCodes.length === 0 &&
    validAuthoredFields;
  if (!valid)
    return {
      schemaVersion: NODE_GYM_ARTIFACT_SHADOW_BINDING_SCHEMA,
      status: 'failed',
      issueCode: 'typed_artifact_spec_not_observed',
      userVisible: false,
      mutationApplied: false,
    };
  return {
    schemaVersion: NODE_GYM_ARTIFACT_SHADOW_BINDING_SCHEMA,
    status: 'passed',
    artifactCount: receipt.artifactCount,
    coveredElementCount: receipt.coveredElementCount,
    deckBindingDigest: normalizeDigest(receipt.deckBindingDigest),
    compilationReceiptDigest: normalizeDigest(receipt.compilationReceiptDigest),
    specSetDigest: normalizeDigest(receipt.specSetDigest),
    receiptDigest: normalizeDigest(receipt.receiptDigest),
    authoredBindingCount: receipt.authoredBindingCount ?? 0,
    canonicalArtifactCount: receipt.canonicalArtifactCount ?? 0,
    canonicalKindCounts: receipt.canonicalKindCounts ?? [],
    canonicalArtifacts: canonicalArtifacts.map((entry) => ({
      kind: entry.kind,
      specDigest: normalizeDigest(entry.specDigest),
      bindingDigest: normalizeDigest(entry.bindingDigest),
    })),
    ...(receipt.preservedIntentDigest
      ? { preservedIntentDigest: normalizeDigest(receipt.preservedIntentDigest) }
      : {}),
    userVisible: false,
    mutationApplied: false,
    anonymized: true,
  };
}

function canonicalKindCountsMatch(declared, artifacts) {
  const actual = new Map();
  for (const artifact of artifacts) actual.set(artifact.kind, (actual.get(artifact.kind) ?? 0) + 1);
  return (
    declared.length === actual.size &&
    declared.every((entry) => actual.get(entry.kind) === entry.count)
  );
}

function isDigest(value) {
  return typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/u.test(value);
}

function normalizeDigest(value) {
  return value.startsWith('sha256:') ? value : `sha256:${value}`;
}
