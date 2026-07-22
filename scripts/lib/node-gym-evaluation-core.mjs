import { createHash, createHmac } from 'node:crypto';
import { digest, validateArtifactSpec } from './artifact-spec-core.mjs';
import { digestJson } from './node-gym-task-core.mjs';

export const NODE_GYM_SEMANTIC_EVALUATION_SCHEMA = 'nodekit.gym-semantic-evaluation/v1';
export const NODE_GYM_CAPABILITY_CARD_SCHEMA = 'nodekit.gym-capability-card/v1';
export const NODE_GYM_BLIND_REVIEW_SCHEMA = 'nodekit.gym-blind-review/v1';

/**
 * Evaluates only observable output and signed/bound fixture facts. It never
 * accepts model-authored scores or hidden reasoning as evidence.
 */
export function evaluateEvidenceBoundNodeGymRun({ plan, fixture, result, artifacts }) {
  const issues = [];
  const route = validateActualNodeGymRoute(plan, result?.route);
  issues.push(...route.issueCodes);
  const spec = validateNormalizedArtifactSpec(
    fixture,
    result?.normalizedSpec,
    result?.specFactBindings,
  );
  issues.push(...spec.issueCodes);
  const claims = auditGeneratedClaims(fixture, result?.generatedClaims);
  issues.push(...claims.issueCodes);
  const artifactEvidence = validateNodeGymArtifactEvidence({
    artifacts,
    expectedSlideCount: result?.expectedSlideCount,
    sourceRunDigest: result?.sourceRunDigest,
    expectedSpecDigest: spec.normalizedSpecDigest,
    allowedClaimIds: fixture.evidence.claims.map((claim) => claim.id),
    allowedSourceIds: fixture.evidence.sources.map((source) => source.id),
  });
  issues.push(...artifactEvidence.issueCodes);
  const harnessExecution = validateHarnessExecution(plan, result);
  issues.push(...harnessExecution.issueCodes);

  const measured = measuredScores({
    plan,
    fixture,
    result,
    claims,
    artifactEvidence,
    spec,
  });
  const humanPreference = validateHumanPreference(result?.humanPreference);
  if (humanPreference.issueCode) issues.push(humanPreference.issueCode);
  const issueCodes = [...new Set(issues)].sort();
  const hardGatesPassed = issueCodes.length === 0;
  const promotionReady = hardGatesPassed && humanPreference.status === 'completed';
  const { briefCoverageEvidence, ...automatedScores } = measured;

  return {
    schemaVersion: NODE_GYM_SEMANTIC_EVALUATION_SCHEMA,
    runId: plan.runId,
    comparisonKey: plan.comparisonKey,
    harnessPairingKey: plan.harnessPairingKey ?? plan.pairingKey,
    taskClass: plan.task.taskClass,
    curriculumLevel: plan.task.curriculumLevel,
    requestedModel: plan.model.id,
    actualRoute: route.attribution,
    harness: `${plan.harness.id}@${plan.harness.version}`,
    fixtureDigest: digestJson(fixture),
    normalizedSpecDigest: spec.normalizedSpecDigest,
    sourceRunDigest: result?.sourceRunDigest ?? null,
    status: hardGatesPassed ? 'passed' : 'failed',
    hardGatesPassed,
    promotionReady,
    issueCodes,
    scores: {
      ...automatedScores,
      visualPreference: humanPreference.status === 'completed' ? humanPreference.score : null,
    },
    scoreEvidence: {
      briefCoverage: briefCoverageEvidence,
      claimAudit: claims.evidence,
      artifactValidation: artifactEvidence.evidence,
      specValidation: spec.evidence,
      humanPreference: humanPreference.receipt,
      harnessExecution: harnessExecution.evidence,
    },
    artifacts,
  };
}

export function parseNodeSlideTraceAttribution({ attribution, traceId, requestedRoute }) {
  const parts = String(attribution ?? '')
    .split(/(?:Â·|·)/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const fallback = /fallback/iu.test(String(attribution ?? ''));
  const actualProvider = fallback ? null : cleanString(parts[0]);
  const actualModel = fallback ? null : cleanString(parts[1]);
  return {
    requestedRoute,
    actualProvider,
    actualModel,
    traceId: cleanString(traceId),
    fallback,
  };
}

export function validateActualNodeGymRoute(plan, route) {
  const issues = [];
  const requestedRoute = cleanString(route?.requestedRoute);
  const actualProvider = cleanString(route?.actualProvider);
  const actualModel = cleanString(route?.actualModel);
  const attributionId = cleanString(route?.responseId) ?? cleanString(route?.traceId);
  const attributionIdKind = route?.responseId
    ? 'provider-response'
    : route?.traceId
      ? 'nodeslide-trace'
      : null;
  if (requestedRoute !== plan?.model?.route) issues.push('requested_route_mismatch');
  if (plan?.model?.provider !== 'local') {
    if (!actualProvider) issues.push('actual_upstream_provider_missing');
    if (!actualModel) issues.push('actual_upstream_model_missing');
    if (!attributionId) issues.push('route_attribution_id_missing');
  }
  if (plan?.model?.returnedModelRequired && !actualModel)
    issues.push('returned_model_attribution_missing');
  if (
    plan?.model?.cohort === 'random-router' &&
    (!actualModel || actualModel === plan.model.route || actualModel === plan.model.id)
  )
    issues.push('random_router_upstream_unresolved');
  if (
    actualModel &&
    plan?.model?.cohort !== 'random-router' &&
    plan?.model?.provider !== 'local' &&
    actualModel !== plan.model.route
  )
    issues.push('returned_model_route_mismatch');
  return {
    ok: issues.length === 0,
    issueCodes: issues,
    attribution: {
      requestedProvider: plan?.model?.provider ?? null,
      requestedRoute: plan?.model?.route ?? null,
      actualProvider,
      actualModel,
      attributionId,
      attributionIdKind,
    },
  };
}

export function validateNormalizedArtifactSpec(fixture, spec, factBindings = []) {
  const issues = [];
  const validation = validateArtifactSpec(spec);
  issues.push(
    ...validation.issues.filter((entry) => entry.severity === 'error').map((entry) => entry.code),
  );
  if (spec?.kind !== fixture?.reference?.artifactKind) issues.push('normalized_spec_kind_mismatch');
  const allowedClaimIds = new Set(fixture?.evidence?.claims?.map((claim) => claim.id));
  const allowedSourceIds = new Set(fixture?.evidence?.sources?.map((source) => source.id));
  if (!(spec?.claimIds ?? []).every((id) => allowedClaimIds.has(id)))
    issues.push('normalized_spec_claim_binding_invalid');
  if (!(spec?.sourceIds ?? []).every((id) => allowedSourceIds.has(id)))
    issues.push('normalized_spec_source_binding_invalid');
  if (!Array.isArray(spec?.claimIds) || spec.claimIds.length === 0)
    issues.push('normalized_spec_claim_binding_missing');
  const calculatedSpecDigest = spec ? digest(stripSpecDigest(spec)) : null;
  if (spec?.specDigest && spec.specDigest !== calculatedSpecDigest)
    issues.push('normalized_spec_digest_mismatch');

  const facts = fixtureFactMap(fixture);
  const boundPaths = new Set();
  for (const binding of factBindings ?? []) {
    const fact = facts.get(binding?.factId);
    if (!fact) {
      issues.push('spec_fact_binding_unknown');
      continue;
    }
    const observed = readJsonPointer(spec, binding.path);
    if (!numericEquivalent(observed, fact.value, fact.tolerance))
      issues.push('spec_numeric_fact_mismatch');
    if (binding.unit !== fact.unit) issues.push('spec_numeric_unit_mismatch');
    boundPaths.add(binding.path);
  }
  for (const path of fixture?.reference?.requiredFactPaths ?? []) {
    if (!boundPaths.has(path)) issues.push('spec_required_fact_unbound');
  }
  return {
    ok: issues.length === 0,
    issueCodes: [...new Set(issues)].sort(),
    normalizedSpecDigest: calculatedSpecDigest ? `sha256:${calculatedSpecDigest}` : null,
    evidence: {
      validator: fixture?.reference?.validator ?? null,
      validatorStatus: validation.ok ? 'passed' : 'failed',
      boundFactCount: boundPaths.size,
      requiredFactPathCount: fixture?.reference?.requiredFactPaths?.length ?? 0,
    },
  };
}

export function auditGeneratedClaims(fixture, generatedClaims) {
  const issues = [];
  const allowed = new Map((fixture?.evidence?.claims ?? []).map((claim) => [claim.id, claim]));
  const observed = Array.isArray(generatedClaims) ? generatedClaims : [];
  if (observed.length === 0) issues.push('generated_claims_missing');
  const observedClaimIds = new Set();
  let supportedClaims = 0;
  let supportedFacts = 0;
  const totalFacts = [...allowed.values()].reduce(
    (sum, claim) => sum + (claim.numericFacts?.length ?? 0),
    0,
  );
  for (const claim of observed) {
    if (observedClaimIds.has(claim?.claimId)) issues.push('generated_claim_duplicate');
    else if (typeof claim?.claimId === 'string') observedClaimIds.add(claim.claimId);
    const reference = allowed.get(claim?.claimId);
    if (!reference) {
      issues.push('unsupported_claim');
      continue;
    }
    const sourcesMatch =
      Array.isArray(claim.sourceIds) &&
      claim.sourceIds.length > 0 &&
      claim.sourceIds.every((sourceId) => reference.sourceIds.includes(sourceId));
    if (!sourcesMatch) issues.push('claim_source_binding_invalid');
    const acceptedRenderings = [reference.text, ...(reference.acceptedRenderings ?? [])].map(
      normalizeText,
    );
    if (!acceptedRenderings.includes(normalizeText(claim.text)))
      issues.push('claim_rendering_not_approved');
    if (sourcesMatch && acceptedRenderings.includes(normalizeText(claim.text)))
      supportedClaims += 1;

    const factMap = new Map((reference.numericFacts ?? []).map((fact) => [fact.id, fact]));
    const observedFacts = Array.isArray(claim.numericFacts) ? claim.numericFacts : [];
    for (const fact of observedFacts) {
      const expected = factMap.get(fact?.factId);
      if (!expected) {
        issues.push('unbound_numeric_claim');
        continue;
      }
      if (!numericEquivalent(fact.value, expected.value, expected.tolerance))
        issues.push('numeric_claim_value_mismatch');
      else if (fact.unit !== expected.unit) issues.push('numeric_claim_unit_mismatch');
      else supportedFacts += 1;
    }
    for (const factId of factMap.keys()) {
      if (!observedFacts.some((entry) => entry.factId === factId))
        issues.push('required_numeric_claim_missing');
    }
    const accountedValues = observedFacts.map((fact) => Number(fact.value));
    for (const number of extractNumbers(claim.text)) {
      if (!accountedValues.some((value) => numericEquivalent(number, value, 0.000_001)))
        issues.push('rendered_number_unbound');
    }
  }
  for (const claimId of allowed.keys()) {
    if (!observedClaimIds.has(claimId)) issues.push('required_fixture_claim_missing');
  }
  return {
    ok: issues.length === 0,
    issueCodes: [...new Set(issues)].sort(),
    evidence: {
      generatedClaimCount: observed.length,
      supportedClaimCount: supportedClaims,
      allowedClaimCount: allowed.size,
      supportedNumericFactCount: supportedFacts,
      requiredNumericFactCount: totalFacts,
    },
  };
}

function validateHarnessExecution(plan, result) {
  const execution = result?.harnessExecution;
  const issues = [];
  if (execution?.observed !== true) issues.push('harness_behavior_not_observed');
  if (execution?.profileId !== plan?.harness?.id) issues.push('harness_execution_profile_mismatch');
  if (execution?.profileVersion !== plan?.harness?.version)
    issues.push('harness_execution_version_mismatch');
  if (!isSha256(execution?.traceDigest)) issues.push('harness_execution_trace_digest_missing');
  return {
    ok: issues.length === 0,
    issueCodes: issues,
    evidence: {
      observed: execution?.observed === true,
      profileId: execution?.profileId ?? null,
      profileVersion: execution?.profileVersion ?? null,
      traceDigest: isSha256(execution?.traceDigest) ? execution.traceDigest : null,
    },
  };
}

export function validateNodeGymArtifactEvidence({
  artifacts,
  expectedSlideCount,
  sourceRunDigest,
  expectedSpecDigest,
  allowedClaimIds = [],
  allowedSourceIds = [],
}) {
  const issues = [];
  if (!isSha256(sourceRunDigest)) issues.push('source_run_digest_invalid');
  for (const kind of ['browser', 'pptx', 'pdf', 'montage']) {
    const artifact = artifacts?.[kind];
    validateArtifactFile(kind, artifact, sourceRunDigest, issues);
  }
  const slides = Array.isArray(artifacts?.slides) ? artifacts.slides : [];
  if (slides.length === 0) issues.push('per_slide_evidence_missing');
  if (Number.isInteger(expectedSlideCount) && slides.length !== expectedSlideCount)
    issues.push('per_slide_evidence_count_mismatch');
  for (const [index, slide] of slides.entries()) {
    if (slide?.slideIndex !== index + 1) issues.push('per_slide_evidence_order_invalid');
    validateArtifactFile('slide', slide, sourceRunDigest, issues);
    if (slide?.specDigest !== expectedSpecDigest) issues.push('per_slide_spec_lineage_mismatch');
  }
  const counts = [
    artifacts?.browser?.slideCount,
    artifacts?.pptx?.slideCount,
    artifacts?.pdf?.pageCount,
    artifacts?.montage?.slideCount,
    slides.length,
  ].filter(Number.isInteger);
  if (counts.length < 5 || new Set(counts).size !== 1)
    issues.push('cross_format_page_count_mismatch');

  const lineage = Array.isArray(artifacts?.sourceLineage) ? artifacts.sourceLineage : [];
  if (lineage.length === 0) issues.push('source_lineage_missing');
  const claimIds = new Set(allowedClaimIds);
  const sourceIds = new Set(allowedSourceIds);
  for (const entry of lineage) {
    if (!claimIds.has(entry?.claimId)) issues.push('source_lineage_claim_unknown');
    if (!sourceIds.has(entry?.sourceId)) issues.push('source_lineage_source_unknown');
    if (
      !Number.isInteger(entry?.slideIndex) ||
      entry.slideIndex < 1 ||
      entry.slideIndex > slides.length
    )
      issues.push('source_lineage_slide_invalid');
    if (entry?.specDigest !== expectedSpecDigest) issues.push('source_lineage_spec_mismatch');
    if (entry?.sourceRunDigest !== sourceRunDigest) issues.push('source_lineage_run_mismatch');
  }
  const exportFidelityPassed = issues.every(
    (code) =>
      !code.includes('artifact') &&
      !code.includes('slide') &&
      !code.includes('format') &&
      !code.includes('lineage'),
  );
  return {
    ok: issues.length === 0,
    issueCodes: [...new Set(issues)].sort(),
    evidence: {
      sourceRunDigest: sourceRunDigest ?? null,
      slideCount: slides.length,
      crossFormatCounts: counts,
      lineageEntryCount: lineage.length,
      exportFidelityPassed,
    },
  };
}

export function buildNodeGymPairedDeltaReport({ pairs, dimensions }) {
  const issues = [];
  const accepted = [];
  const pairIds = new Set();
  for (const pair of pairs ?? []) {
    if (!pair?.champion || !pair?.challenger) {
      issues.push('pair_receipt_missing');
      continue;
    }
    if (!cleanString(pair.pairId) || pairIds.has(pair.pairId)) issues.push('pair_identity_invalid');
    else pairIds.add(pair.pairId);
    if (
      pair.champion.status !== 'passed' ||
      pair.challenger.status !== 'passed' ||
      pair.champion.hardGatesPassed !== true ||
      pair.challenger.hardGatesPassed !== true
    )
      issues.push('pair_hard_gate_failure');
    if (!isSha256(pair.champion.fixtureDigest) || !isSha256(pair.challenger.fixtureDigest))
      issues.push('pair_fixture_lineage_invalid');
    if (
      pair.champion.taskClass !== pair.challenger.taskClass ||
      pair.champion.curriculumLevel !== pair.challenger.curriculumLevel
    )
      issues.push('pair_task_identity_mismatch');
    if (pair.kind === 'model') {
      if (pair.champion.comparisonKey !== pair.challenger.comparisonKey)
        issues.push('model_pair_comparison_key_mismatch');
      if (pair.champion.harness !== pair.challenger.harness)
        issues.push('model_pair_harness_mismatch');
      if (
        !cleanString(pair.champion.actualRoute?.actualModel) ||
        !cleanString(pair.challenger.actualRoute?.actualModel) ||
        pair.champion.actualRoute.actualModel === pair.challenger.actualRoute.actualModel
      )
        issues.push('model_pair_identity_not_distinct');
    } else if (pair.kind === 'harness') {
      if (pair.champion.harnessPairingKey !== pair.challenger.harnessPairingKey)
        issues.push('harness_pairing_key_mismatch');
      if (pair.champion.actualRoute?.actualModel !== pair.challenger.actualRoute?.actualModel)
        issues.push('harness_pair_model_mismatch');
      if (!cleanString(pair.champion.actualRoute?.actualModel))
        issues.push('harness_pair_model_identity_missing');
      if (
        !cleanString(pair.champion.harness) ||
        !cleanString(pair.challenger.harness) ||
        pair.champion.harness === pair.challenger.harness
      )
        issues.push('harness_pair_identity_not_distinct');
      if (
        pair.champion.scoreEvidence?.harnessExecution?.observed !== true ||
        pair.challenger.scoreEvidence?.harnessExecution?.observed !== true
      )
        issues.push('harness_pair_behavior_not_observed');
    } else {
      issues.push('pair_kind_invalid');
    }
    if (pair.champion.fixtureDigest !== pair.challenger.fixtureDigest)
      issues.push('pair_evidence_lineage_mismatch');
    accepted.push(pair);
  }
  if (issues.length)
    return {
      ok: false,
      issueCodes: [...new Set(issues)].sort(),
      dimensions: {},
    };
  const selectedDimensions = dimensions ?? [
    'briefAdherence',
    'storyQuality',
    'factualAccuracy',
    'toolReliability',
    'exportFidelity',
    'repairSuccess',
    'editability',
    'visualStructuralQuality',
  ];
  const report = {};
  for (const dimension of selectedDimensions) {
    const deltas = accepted
      .map((pair) => [pair.champion.scores?.[dimension], pair.challenger.scores?.[dimension]])
      .filter(([left, right]) => Number.isFinite(left) && Number.isFinite(right))
      .map(([left, right]) => right - left);
    if (deltas.length !== accepted.length) issues.push(`pair_score_missing:${dimension}`);
    report[dimension] = summarizeDeltas(deltas);
  }
  return {
    ok: issues.length === 0,
    issueCodes: [...new Set(issues)].sort(),
    pairCount: accepted.length,
    dimensions: report,
  };
}

export function buildNodeGymCapabilityCards(evaluations) {
  const groups = new Map();
  for (const evaluation of evaluations ?? []) {
    const actualModel = evaluation?.actualRoute?.actualModel;
    if (!actualModel) continue;
    const key = [actualModel, evaluation.harness, evaluation.taskClass].join('::');
    const group = groups.get(key) ?? [];
    group.push(evaluation);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([key, runs]) => {
    const [actualModel, harness, taskClass] = key.split('::');
    const dimensions = {};
    for (const dimension of scoreDimensions()) {
      const values = runs.map((run) => run.scores?.[dimension]).filter(Number.isFinite);
      dimensions[dimension] = summarizeValues(values);
    }
    const issueCounts = {};
    for (const run of runs)
      for (const code of run.issueCodes ?? []) issueCounts[code] = (issueCounts[code] ?? 0) + 1;
    const passed = runs.filter((run) => run.hardGatesPassed).length;
    const passRate = passed / runs.length;
    const passConfidence95 = wilsonInterval(passed, runs.length);
    const recurringFailures = Object.entries(issueCounts)
      .map(([issueCode, count]) => ({
        issueCode,
        count,
        rate: count / runs.length,
      }))
      .filter((entry) => entry.rate >= 0.25)
      .sort(
        (left, right) => right.rate - left.rate || left.issueCode.localeCompare(right.issueCode),
      );
    const requiredScaffolding = scaffoldingFromFailures(recurringFailures);
    const roleEligible =
      runs.length >= 12 &&
      passRate >= 0.8 &&
      passConfidence95.low >= 0.5 &&
      recurringFailures.length === 0;
    return {
      schemaVersion: NODE_GYM_CAPABILITY_CARD_SCHEMA,
      actualModel,
      harness,
      taskClass,
      sampleSize: runs.length,
      passRate,
      promotionReadyRate: runs.filter((run) => run.promotionReady).length / runs.length,
      confidence: {
        method: 'wilson-score',
        level: 0.95,
        passRate: passConfidence95,
        status: runs.length < 12 ? 'provisional-low-sample' : 'measured',
      },
      dimensions,
      issueCounts,
      recurringFailures,
      eligibleRoles: roleEligible ? [taskClass] : [],
      avoidRoles: roleEligible ? [] : [taskClass],
      requiredScaffolding,
      roleEvidence: {
        policy: 'observed-task-performance-only',
        minimumSamples: 12,
        minimumPassRate: 0.8,
        minimumConfidenceLowerBound: 0.5,
        personalityClaimsAllowed: false,
      },
      evidenceDigests: [...new Set(runs.map((run) => run.fixtureDigest))].sort(),
    };
  });
}

/** Returns public review assets plus a separate path/identity key for access-controlled storage. */
export function buildNodeGymBlindReviewPacket({ pairs, blindingSalt, reviewSessionId }) {
  if (!cleanString(blindingSalt) || blindingSalt.length < 16)
    throw new Error('Blind review requires a runtime-only salt of at least 16 characters.');
  if (!cleanString(reviewSessionId) || reviewSessionId.length < 8)
    throw new Error('Blind review requires an opaque review session identity.');
  const confidentialKey = [];
  const confidentialAssets = [];
  const assetManifestEntries = [];
  const cases = (pairs ?? []).map((pair, caseIndex) => {
    if (pair?.champion?.hardGatesPassed !== true || pair?.challenger?.hardGatesPassed !== true)
      throw new Error('Blind review accepts only hard-gate-passing candidates.');
    const candidates = [pair.champion, pair.challenger].map((evaluation) => {
      const opaque = createHmac('sha256', blindingSalt)
        .update(`${reviewSessionId}:${pair.pairId ?? caseIndex}:${evaluation.runId}`)
        .digest('hex');
      const candidateId = `candidate-${opaque.slice(0, 16)}`;
      confidentialKey.push({
        candidateId,
        runId: evaluation.runId,
      });
      const reviewArtifact = registerBlindAsset({
        artifact: evaluation.artifacts?.montage,
        candidateId,
        role: 'montage',
        seed: opaque,
        publicEntries: assetManifestEntries,
        confidentialAssets,
      });
      const slideArtifacts = (evaluation.artifacts?.slides ?? []).map((slide) =>
        registerBlindAsset({
          artifact: slide,
          candidateId,
          role: 'slide',
          seed: `${opaque}:${slide.slideIndex}`,
          publicEntries: assetManifestEntries,
          confidentialAssets,
        }),
      );
      return {
        candidateId,
        reviewAssetId: reviewArtifact.assetId,
        slideAssetIds: slideArtifacts.map((artifact) => artifact.assetId),
      };
    });
    candidates.sort((left, right) =>
      createHmac('sha256', blindingSalt)
        .update(left.candidateId)
        .digest('hex')
        .localeCompare(createHmac('sha256', blindingSalt).update(right.candidateId).digest('hex')),
    );
    return {
      caseId: `case-${caseIndex + 1}`,
      taskClass: pair.champion.taskClass,
      fixtureDigest: pair.champion.fixtureDigest,
      rubric: [
        'story clarity',
        'visual hierarchy',
        'information density',
        'artifact legibility',
        'overall preference',
      ],
      candidates,
    };
  });
  const assetManifest = {
    schemaVersion: 'nodekit.gym-blind-asset-manifest/v1',
    reviewSessionId,
    assets: assetManifestEntries.sort((left, right) => left.assetId.localeCompare(right.assetId)),
  };
  const assetManifestDigest = digestJson(assetManifest);
  const packet = {
    schemaVersion: NODE_GYM_BLIND_REVIEW_SCHEMA,
    reviewSessionId,
    status: 'awaiting-human-review',
    assetManifestDigest,
    cases,
    identityFieldsExcluded: ['model', 'provider', 'route', 'harness', 'cost', 'latency', 'path'],
  };
  const packetDigest = digestJson(packet);
  return {
    packet,
    packetDigest,
    assetManifest,
    assetManifestDigest,
    confidentialKey: {
      schemaVersion: 'nodekit.gym-blind-review-key/v1',
      reviewSessionId,
      access: 'restricted-do-not-co-locate-with-review-packet',
      mappings: confidentialKey,
      assets: confidentialAssets,
    },
  };
}

export function validateNodeGymBlindPreference({
  packet,
  packetDigest,
  assetManifest,
  assetManifestDigest,
  response,
}) {
  const issues = [];
  if (digestJson(packet) !== packetDigest) issues.push('blind_packet_digest_mismatch');
  if (digestJson(assetManifest) !== assetManifestDigest)
    issues.push('blind_asset_manifest_digest_mismatch');
  if (packet?.assetManifestDigest !== assetManifestDigest)
    issues.push('blind_packet_manifest_binding_mismatch');
  if (
    response?.schemaVersion !== 'nodekit.gym-blind-preference/v1' ||
    response?.reviewSessionId !== packet?.reviewSessionId
  )
    issues.push('blind_preference_session_mismatch');
  if (response?.packetDigest !== packetDigest)
    issues.push('blind_preference_packet_digest_mismatch');
  if (response?.assetManifestDigest !== assetManifestDigest)
    issues.push('blind_preference_manifest_digest_mismatch');
  if (!isSha256(response?.reviewerIdentityDigest)) issues.push('blind_reviewer_identity_invalid');
  const reviews = Array.isArray(response?.reviews) ? response.reviews : [];
  const cases = new Map((packet?.cases ?? []).map((entry) => [entry.caseId, entry]));
  if (reviews.length !== cases.size) issues.push('blind_preference_case_count_mismatch');
  const observedCases = new Set();
  for (const review of reviews) {
    const reviewCase = cases.get(review?.caseId);
    if (!reviewCase || observedCases.has(review?.caseId)) {
      issues.push('blind_preference_case_invalid');
      continue;
    }
    observedCases.add(review.caseId);
    const candidates = new Set(reviewCase.candidates.map((entry) => entry.candidateId));
    if (!candidates.has(review?.winnerCandidateId))
      issues.push('blind_preference_candidate_invalid');
    if (!cleanString(review?.rubricVersion)) issues.push('blind_preference_rubric_missing');
  }
  const normalized = {
    schemaVersion: 'nodekit.gym-blind-preference-receipt/v1',
    reviewSessionId: packet?.reviewSessionId ?? null,
    reviewerIdentityDigest: response?.reviewerIdentityDigest ?? null,
    packetDigest,
    assetManifestDigest,
    reviews: reviews.map((review) => ({
      caseId: review.caseId,
      winnerCandidateId: review.winnerCandidateId,
      rubricVersion: review.rubricVersion,
    })),
  };
  return {
    ok: issues.length === 0,
    issueCodes: [...new Set(issues)].sort(),
    receipt: issues.length === 0 ? { ...normalized, receiptDigest: digestJson(normalized) } : null,
  };
}

function measuredScores({ plan, fixture, result, claims, artifactEvidence, spec }) {
  const requiredTopics = fixture?.constraints?.requiredTopics ?? [];
  const coveredTopics = new Set(result?.briefCoverage ?? []);
  const briefAdherence = ratio(
    requiredTopics.filter((topic) => coveredTopics.has(topic)).length,
    requiredTopics.length,
  );
  const requiredBeats = fixture?.constraints?.requiredStoryBeats ?? [];
  const observedBeats = new Set((result?.story?.beats ?? []).map((beat) => beat.id));
  const storyQuality = ratio(
    requiredBeats.filter((beat) => observedBeats.has(beat)).length,
    requiredBeats.length,
  );
  const claimEvidence = claims.evidence;
  const factualAccuracy = ratio(
    claimEvidence.supportedClaimCount + claimEvidence.supportedNumericFactCount,
    claimEvidence.allowedClaimCount + claimEvidence.requiredNumericFactCount,
  );
  const allowedTools = new Set(result?.compiledHarness?.enabledTools?.map((tool) => tool.id) ?? []);
  const toolCalls = result?.toolTrace?.calls ?? [];
  const validToolCalls = toolCalls.filter(
    (call) => allowedTools.has(call.toolId) && call.validation?.status === 'passed',
  ).length;
  const toolReliability = ratio(validToolCalls, toolCalls.length);
  const exportFidelity = artifactEvidence.ok ? 1 : 0;
  const repairAttempts = result?.repairTrace?.attempts ?? [];
  const repairSuccess = repairAttempts.length
    ? ratio(
        repairAttempts.filter((attempt) => attempt.validation?.status === 'passed').length,
        repairAttempts.length,
      )
    : spec.ok
      ? 1
      : 0;
  const editability = clamp01(result?.renderDiagnostics?.pptxEditableObjectRatio ?? 0);
  const diagnostics = result?.renderDiagnostics ?? {};
  const visualChecks = [
    diagnostics.overflowCount === 0,
    diagnostics.overlapCount === 0,
    diagnostics.placeholderCount === 0,
    diagnostics.minimumContrastPassed === true,
    (diagnostics.distinctVisualKinds ?? 0) >=
      (fixture?.constraints?.minimumDistinctVisualKinds ?? 1),
  ];
  const visualStructuralQuality = ratio(visualChecks.filter(Boolean).length, visualChecks.length);
  return {
    briefAdherence,
    storyQuality,
    factualAccuracy,
    toolReliability,
    exportFidelity,
    repairSuccess,
    editability,
    visualStructuralQuality,
    briefCoverageEvidence: {
      requiredTopics,
      coveredTopics: [...coveredTopics],
      requiredStoryBeats: requiredBeats,
      observedStoryBeats: [...observedBeats],
      harnessProfile: plan.harness.id,
    },
  };
}

function validateHumanPreference(value) {
  if (!value) return { status: 'not_run', score: null, receipt: { status: 'not_run' } };
  if (
    value.status !== 'completed' ||
    !Number.isFinite(value.score) ||
    value.score < 0 ||
    value.score > 1 ||
    !isSha256(value.packetDigest) ||
    !isSha256(value.responseDigest)
  )
    return {
      status: 'invalid',
      score: null,
      issueCode: 'human_preference_receipt_invalid',
      receipt: { status: 'invalid' },
    };
  return { status: 'completed', score: value.score, receipt: value };
}

function validateArtifactFile(kind, artifact, sourceRunDigest, issues) {
  if (!artifact) {
    issues.push(`${kind}_artifact_missing`);
    return;
  }
  if (!isSha256(artifact.digest)) issues.push(`${kind}_artifact_digest_invalid`);
  if (!(Number.isInteger(artifact.bytes) && artifact.bytes > 0))
    issues.push(`${kind}_artifact_empty`);
  if (artifact.validation?.status !== 'passed')
    issues.push(`${kind}_${artifact.validation?.issueCode ?? 'validation_failed'}`);
  if (artifact.sourceRunDigest !== sourceRunDigest)
    issues.push(`${kind}_artifact_run_lineage_mismatch`);
}

function fixtureFactMap(fixture) {
  const map = new Map();
  for (const claim of fixture?.evidence?.claims ?? [])
    for (const fact of claim.numericFacts ?? []) map.set(fact.id, fact);
  return map;
}

function readJsonPointer(value, pointer) {
  if (pointer === '') return value;
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) return undefined;
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => segment.replaceAll('~1', '/').replaceAll('~0', '~'))
    .reduce((current, segment) => current?.[segment], value);
}

function extractNumbers(text) {
  if (typeof text !== 'string') return [];
  return [...text.matchAll(/(?<![\w])[-+]?(?:\d+(?:\.\d+)?|\.\d+)(?![\w])/gu)].map((match) =>
    Number(match[0]),
  );
}

function numericEquivalent(left, right, tolerance = 0) {
  return (
    Number.isFinite(Number(left)) && Math.abs(Number(left) - Number(right)) <= (tolerance ?? 0)
  );
}

function stripSpecDigest(spec) {
  const { specDigest: _specDigest, ...rest } = spec;
  return rest;
}

function summarizeDeltas(values) {
  const summary = summarizeValues(values);
  return {
    ...summary,
    probabilityPositive: values.length
      ? values.filter((value) => value > 0).length / values.length
      : null,
  };
}

function summarizeValues(values) {
  if (!values.length) return { sampleSize: 0, mean: null, confidence95: null };
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  if (values.length === 1) return { sampleSize: 1, mean, confidence95: null };
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const margin = tCritical95(values.length - 1) * Math.sqrt(variance / values.length);
  return {
    sampleSize: values.length,
    mean,
    confidence95: { low: mean - margin, high: mean + margin },
  };
}

function tCritical95(degreesOfFreedom) {
  const table = [
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16,
    2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052,
    2.048, 2.045, 2.042,
  ];
  return degreesOfFreedom <= table.length ? table[degreesOfFreedom - 1] : 1.96;
}

function wilsonInterval(successes, total, z = 1.96) {
  if (!total) return { low: 0, high: 1 };
  const proportion = successes / total;
  const denominator = 1 + z ** 2 / total;
  const center = (proportion + z ** 2 / (2 * total)) / denominator;
  const margin =
    (z / denominator) *
    Math.sqrt((proportion * (1 - proportion)) / total + z ** 2 / (4 * total ** 2));
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

function scaffoldingFromFailures(failures) {
  const controls = new Map();
  for (const failure of failures) {
    const control = failureControl(failure.issueCode);
    const evidence = controls.get(control) ?? {
      control,
      issueCodes: [],
      observedCount: 0,
    };
    evidence.issueCodes.push(failure.issueCode);
    evidence.observedCount += failure.count;
    controls.set(control, evidence);
  }
  return [...controls.values()].sort((left, right) => left.control.localeCompare(right.control));
}

function failureControl(issueCode) {
  if (/route|provider|model_attribution/iu.test(issueCode)) return 'actual-route-attribution-gate';
  if (/claim|numeric|source_binding/iu.test(issueCode)) return 'evidence-bound-claim-validator';
  if (/spec|schema/iu.test(issueCode)) return 'typed-artifact-spec-validator';
  if (/artifact|slide|format|export|lineage/iu.test(issueCode))
    return 'cross-format-artifact-receipt-gate';
  if (/repair/iu.test(issueCode)) return 'bounded-typed-repair';
  return 'human-review-and-fail-closed';
}

function registerBlindAsset({
  artifact,
  candidateId,
  role,
  seed,
  publicEntries,
  confidentialAssets,
}) {
  if (!isSha256(artifact?.digest) || !Number.isSafeInteger(artifact?.bytes) || artifact.bytes <= 0)
    throw new Error(`Blind review ${role} asset is missing immutable evidence.`);
  if (!cleanString(artifact?.path))
    throw new Error(`Blind review ${role} asset has no restricted delivery path.`);
  const assetId = `review-${createHash('sha256').update(seed).digest('hex').slice(0, 20)}`;
  const entry = {
    assetId,
    digest: artifact.digest,
    bytes: artifact.bytes,
    mediaType: cleanString(artifact.mediaType) ?? inferBlindMediaType(artifact.path),
    role,
    ...(Number.isInteger(artifact.slideIndex) ? { slideIndex: artifact.slideIndex } : {}),
  };
  publicEntries.push(entry);
  confidentialAssets.push({ assetId, candidateId, path: artifact.path });
  return entry;
}

function inferBlindMediaType(filePath) {
  if (/\.png$/iu.test(filePath)) return 'image/png';
  if (/\.jpe?g$/iu.test(filePath)) return 'image/jpeg';
  if (/\.webp$/iu.test(filePath)) return 'image/webp';
  return 'application/octet-stream';
}

function scoreDimensions() {
  return [
    'briefAdherence',
    'storyQuality',
    'factualAccuracy',
    'toolReliability',
    'exportFidelity',
    'repairSuccess',
    'editability',
    'visualStructuralQuality',
    'visualPreference',
  ];
}

function ratio(numerator, denominator) {
  return denominator === 0 ? 1 : clamp01(numerator / denominator);
}

function clamp01(value) {
  return Number.isFinite(Number(value)) ? Math.max(0, Math.min(1, Number(value))) : 0;
}

function normalizeText(value) {
  return typeof value === 'string'
    ? value
        .toLowerCase()
        .replace(/[^a-z0-9.%$+-]+/gu, ' ')
        .trim()
        .replace(/\s+/gu, ' ')
    : '';
}

function cleanString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isSha256(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}
