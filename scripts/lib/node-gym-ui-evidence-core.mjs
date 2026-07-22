export const NODE_GYM_UI_EVIDENCE_ENVELOPE_SCHEMA = 'nodekit.gym-ui-evidence-envelope/v1';

/**
 * Builds the content-free evidence envelope for a live UI run. The envelope
 * accepts only digests, bounded identifiers, file metadata, and observed
 * bindings; it never carries deck prose, source text, URLs, or capabilities.
 */
export function buildNodeGymUiEvidenceEnvelope(input) {
  const issueCodes = [];
  const sourceRunDigest = normalizeDigest(input.sourceRunDigest);
  if (!sourceRunDigest) issueCodes.push('source_run_digest_missing');

  const normalizedSpecSetDigest = normalizeDigest(input.normalizedSpecSetDigest);
  const normalizedSpecs = Array.isArray(input.normalizedSpecs) ? input.normalizedSpecs : [];
  if (!normalizedSpecSetDigest || normalizedSpecs.length === 0)
    issueCodes.push('normalized_artifact_spec_missing');
  if (
    normalizedSpecs.some(
      (spec) =>
        spec?.schemaVersion !== 'nodeslide.artifact-spec/v1' ||
        !nonEmpty(spec?.id) ||
        !nonEmpty(spec?.kind) ||
        !Array.isArray(spec?.claimIds) ||
        spec.claimIds.length === 0 ||
        !Array.isArray(spec?.sourceIds) ||
        spec.sourceIds.length === 0 ||
        normalizeDigest(spec?.specSetDigest) !== normalizedSpecSetDigest ||
        !isDigest(spec?.artifactHandle) ||
        !isDigest(spec?.bindingDigest),
    )
  )
    issueCodes.push('normalized_artifact_spec_invalid');
  if (
    nonEmpty(input.expectedArtifactKind) &&
    !normalizedSpecs.some((spec) => spec?.kind === input.expectedArtifactKind)
  )
    issueCodes.push('expected_artifact_kind_not_observed');

  const requiredClaims = uniqueStrings(input.requiredClaimIds);
  const resolvedClaims = uniqueStrings(input.resolvedClaimIds);
  if (requiredClaims.length === 0 || requiredClaims.some((id) => !resolvedClaims.includes(id)))
    issueCodes.push('required_claim_binding_missing');
  const requiredFacts = uniqueStrings(input.requiredFactIds);
  const resolvedFacts = uniqueStrings(input.resolvedFactIds);
  if (requiredFacts.some((id) => !resolvedFacts.includes(id)))
    issueCodes.push('required_fact_binding_missing');

  const slides = Array.isArray(input.slides) ? input.slides : [];
  if (slides.length === 0) issueCodes.push('per_slide_evidence_missing');
  const slideNumbers = new Set();
  for (const [index, slide] of slides.entries()) {
    if (
      !Number.isInteger(slide?.slideNumber) ||
      slide.slideNumber !== index + 1 ||
      slideNumbers.has(slide.slideNumber) ||
      normalizeDigest(slide?.specSetDigest) !== normalizedSpecSetDigest ||
      !Array.isArray(slide?.sourceIds) ||
      !Array.isArray(slide?.claimIds)
    )
      issueCodes.push('per_slide_evidence_incomplete');
    slideNumbers.add(slide?.slideNumber);
    validateFileEvidence(slide?.browser, sourceRunDigest, issueCodes, 'browser_slide');
    validateFileEvidence(slide?.pptxRender, sourceRunDigest, issueCodes, 'pptx_slide');
    validateFileEvidence(slide?.pdfPage, sourceRunDigest, issueCodes, 'pdf_page');
  }

  validateFileEvidence(input.montage, sourceRunDigest, issueCodes, 'montage');
  const sourceLineage = Array.isArray(input.sourceLineage) ? input.sourceLineage : [];
  if (
    sourceLineage.length === 0 ||
    sourceLineage.some(
      (entry) =>
        !nonEmpty(entry?.sourceId) ||
        !isDigest(entry?.digest) ||
        !Array.isArray(entry?.claimIds) ||
        entry.claimIds.length === 0 ||
        !Array.isArray(entry?.slideNumbers) ||
        entry.slideNumbers.length === 0 ||
        entry.slideNumbers.some(
          (slideNumber) => !Number.isInteger(slideNumber) || !slideNumbers.has(slideNumber),
        ),
    )
  )
    issueCodes.push('source_lineage_missing');

  const expectedEffects = uniqueStrings(input.harnessObservation?.expectedEffects);
  const observedEffects = uniqueStrings(input.harnessObservation?.observedEffects);
  const harnessDigest = normalizeDigest(input.harnessObservation?.harnessDigest);
  const traceDigest = normalizeDigest(input.harnessObservation?.traceDigest);
  if (
    !harnessDigest ||
    !traceDigest ||
    expectedEffects.length === 0 ||
    expectedEffects.some((effect) => !observedEffects.includes(effect))
  )
    issueCodes.push('harness_effect_not_observed');

  const retention = input.retention;
  if (
    retention?.status !== 'passed' ||
    retention?.retentionSafe !== true ||
    retention?.remainingDeckRows !== 0 ||
    retention?.remainingSourceRows !== 0 ||
    !isDigest(retention?.receiptDigest)
  )
    issueCodes.push('retention_cleanup_unverified');

  const uniqueIssueCodes = [...new Set(issueCodes)].sort();
  return {
    schemaVersion: NODE_GYM_UI_EVIDENCE_ENVELOPE_SCHEMA,
    status: uniqueIssueCodes.length ? 'failed' : 'passed',
    sourceRunDigest,
    expectedArtifactKind: nonEmpty(input.expectedArtifactKind) ? input.expectedArtifactKind : null,
    normalizedSpecSetDigest,
    normalizedSpecs: normalizedSpecs.map((spec) => ({
      schemaVersion: spec.schemaVersion,
      id: spec.id,
      kind: spec.kind,
      claimIds: uniqueStrings(spec.claimIds),
      sourceIds: uniqueStrings(spec.sourceIds),
      specSetDigest: normalizeDigest(spec.specSetDigest),
      artifactHandle: normalizeDigest(spec.artifactHandle),
      bindingDigest: normalizeDigest(spec.bindingDigest),
    })),
    claimBindings: { required: requiredClaims, resolved: resolvedClaims },
    factBindings: { required: requiredFacts, resolved: resolvedFacts },
    slides: slides.map((slide) => ({
      slideNumber: slide.slideNumber,
      browser: normalizeFileEvidence(slide.browser),
      pptxRender: normalizeFileEvidence(slide.pptxRender),
      pdfPage: normalizeFileEvidence(slide.pdfPage),
      claimIds: uniqueStrings(slide.claimIds),
      sourceIds: uniqueStrings(slide.sourceIds),
      specSetDigest: normalizeDigest(slide.specSetDigest),
    })),
    montage: normalizeFileEvidence(input.montage),
    sourceLineage: sourceLineage.map((entry) => ({
      sourceId: entry.sourceId,
      digest: normalizeDigest(entry.digest),
      claimIds: uniqueStrings(entry.claimIds),
      slideNumbers: uniqueIntegers(entry.slideNumbers),
    })),
    harnessObservation: {
      harnessDigest,
      traceDigest,
      expectedEffects,
      observedEffects,
      observed:
        Boolean(harnessDigest && traceDigest) &&
        expectedEffects.length > 0 &&
        expectedEffects.every((entry) => observedEffects.includes(entry)),
    },
    retention: retention
      ? {
          status: retention.status,
          retentionSafe: retention.retentionSafe,
          remainingDeckRows: retention.remainingDeckRows,
          remainingSourceRows: retention.remainingSourceRows,
          receiptDigest: normalizeDigest(retention.receiptDigest),
        }
      : null,
    issueCodes: uniqueIssueCodes,
  };
}

function validateFileEvidence(value, sourceRunDigest, issueCodes, family) {
  if (
    !value ||
    !safeRelativePath(value.path) ||
    !isDigest(value.digest) ||
    !(Number.isSafeInteger(value.bytes) && value.bytes > 0) ||
    normalizeDigest(value.sourceRunDigest) !== sourceRunDigest ||
    value.validation?.status !== 'passed'
  )
    issueCodes.push(`${family}_evidence_invalid`);
}

function normalizeFileEvidence(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    path: safeRelativePath(value.path) ? value.path.replaceAll('\\', '/') : null,
    digest: normalizeDigest(value.digest),
    bytes: Number.isSafeInteger(value.bytes) && value.bytes > 0 ? value.bytes : 0,
    sourceRunDigest: normalizeDigest(value.sourceRunDigest),
    validation: {
      status: value.validation?.status === 'passed' ? 'passed' : 'failed',
      ...(nonEmpty(value.validation?.issueCode) ? { issueCode: value.validation.issueCode } : {}),
    },
  };
}

function safeRelativePath(value) {
  return (
    nonEmpty(value) &&
    !/^(?:[A-Za-z]:|[\\/])/u.test(value) &&
    !value.split(/[\\/]+/u).some((segment) => segment === '..')
  );
}

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(nonEmpty))].sort();
}

function uniqueIntegers(value) {
  return [...new Set((Array.isArray(value) ? value : []).filter(Number.isInteger))].sort(
    (left, right) => left - right,
  );
}

function normalizeDigest(value) {
  if (!isDigest(value)) return null;
  const normalized = value.toLowerCase();
  return normalized.startsWith('sha256:') ? normalized : `sha256:${normalized}`;
}

function isDigest(value) {
  return typeof value === 'string' && /^(?:sha256:)?[a-f0-9]{64}$/u.test(value);
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}
