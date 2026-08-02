const REQUIRED_CHECKS = [
  'overlap',
  'clipping',
  'minimumType',
  'sourceLegibility',
  'visualHierarchy',
  'semanticVisualFit',
  'density',
  'exportParity',
];

function entries(manifest) {
  return [
    ...(manifest?.evidenceSources ?? []),
    ...(manifest?.visualStorytellingPrecedents ?? []),
    ...(manifest?.evaluationTargets ?? []),
    ...(manifest?.hiddenHindsight ?? []),
  ];
}

function countRange(start, end) {
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
}

function uniqueIndexes(items) {
  return new Set(items.map((item) => item?.slideIndex));
}

export function validateLongformBenchmarkDefinition({
  benchmark,
  sourceManifest,
  deckProgram,
  questions,
  criticalFacts,
  heldOutPlan,
}) {
  const failures = [];
  if (benchmark?.requiredOutputs?.longDeckSlides !== 72)
    failures.push('long deck must require exactly 72 slides');
  if (benchmark?.requiredOutputs?.shortDeckSlides !== 12)
    failures.push('short deck must require exactly 12 slides');
  if (deckProgram?.exactSlideCount !== 72) failures.push('DeckProgram exactSlideCount must be 72');

  const covered = new Set();
  for (const section of deckProgram?.sections ?? []) {
    for (const index of countRange(section.startSlideIndex, section.endSlideIndex)) {
      if (covered.has(index)) failures.push(`DeckProgram slide ${index} is covered more than once`);
      covered.add(index);
    }
  }
  for (const index of countRange(1, 72)) {
    if (!covered.has(index)) failures.push(`DeckProgram does not cover slide ${index}`);
  }

  const buckets = [
    ['evidenceSources', 'evidence-source'],
    ['visualStorytellingPrecedents', 'visual-storytelling-precedent'],
    ['evaluationTargets', 'evaluation-target'],
    ['hiddenHindsight', 'hidden-hindsight'],
  ];
  const sourceIds = new Set();
  for (const [bucket, role] of buckets) {
    for (const item of sourceManifest?.[bucket] ?? []) {
      if (item.role !== role)
        failures.push(`${item.sourceId} is in ${bucket} but has role ${item.role}`);
      if (sourceIds.has(item.sourceId)) failures.push(`duplicate source id ${item.sourceId}`);
      sourceIds.add(item.sourceId);
      if (role === 'hidden-hindsight' && item.generationVisible !== false) {
        failures.push(`${item.sourceId} leaks hidden hindsight to generation`);
      }
      if (role === 'evaluation-target' && item.generationVisible !== false) {
        failures.push(`${item.sourceId} leaks evaluation answers to generation`);
      }
      if (role === 'visual-storytelling-precedent' && item.authority === 'primary') {
        failures.push(
          `${item.sourceId} cannot be primary approval authority as a visual precedent`,
        );
      }
    }
  }

  if ((questions?.questions ?? []).length !== 20)
    failures.push('exactly 20 decision questions must be frozen');
  if (questions?.frozenBeforeGeneration !== true)
    failures.push('decision questions must be frozen before generation');
  const claimIds = new Set((criticalFacts?.claims ?? []).map((claim) => claim.claimId));
  for (const question of questions?.questions ?? []) {
    for (const claimId of question.expectedClaimIds ?? []) {
      if (!claimIds.has(claimId))
        failures.push(`${question.questionId} references unknown claim ${claimId}`);
    }
  }
  const heldOutCounts = heldOutPlan?.heldOutCaseCounts ?? {};
  const heldOutTotal = Object.values(heldOutCounts).reduce(
    (sum, count) => sum + Number(count ?? 0),
    0,
  );
  if (heldOutPlan?.totalCases !== 30 || heldOutTotal !== 30)
    failures.push('held-out suite must contain exactly 30 cases');
  return failures;
}

export function validateLongformBenchmarkRun({ benchmark, sourceManifest, criticalFacts, run }) {
  const failures = [];
  const requiredCounts = { long: 72, short: 12, executive: run?.executiveDeck?.slideCount ?? 0 };
  if (run?.longDeck?.slideCount !== requiredCounts.long)
    failures.push('long deck output must contain exactly 72 slides');
  if (run?.shortDeck?.slideCount !== requiredCounts.short)
    failures.push('short deck output must contain exactly 12 slides');
  if (requiredCounts.executive < 3 || requiredCounts.executive > 5)
    failures.push('executive readout must contain 3-5 slides');
  const graphDigest = run?.canonicalEvidenceGraphDigest;
  if (!graphDigest) failures.push('canonical evidence graph digest is required');
  for (const deck of [run?.longDeck, run?.shortDeck, run?.executiveDeck]) {
    if (deck?.canonicalEvidenceGraphDigest !== graphDigest)
      failures.push(`${deck?.kind ?? 'deck'} does not derive from the canonical evidence graph`);
  }

  const visibleSourceIds = new Set(
    entries(sourceManifest)
      .filter((item) => item.generationVisible)
      .map((item) => item.sourceId),
  );
  const forbiddenSourceIds = new Set(
    entries(sourceManifest)
      .filter((item) => !item.generationVisible)
      .map((item) => item.sourceId),
  );
  for (const sourceId of run?.generationSourceIds ?? []) {
    if (forbiddenSourceIds.has(sourceId))
      failures.push(`generation leaked forbidden source ${sourceId}`);
    if (!visibleSourceIds.has(sourceId))
      failures.push(`generation used undeclared source ${sourceId}`);
  }
  const manifestById = new Map(entries(sourceManifest).map((item) => [item.sourceId, item]));
  for (const authorityId of run?.approvalAuthoritySourceIds ?? []) {
    const source = manifestById.get(authorityId);
    if (!source || source.role !== 'evidence-source' || source.authority !== 'primary') {
      failures.push(`${authorityId} is not an independent primary approval authority`);
    }
  }

  const eligibility = run?.artifactEligibility ?? [];
  const eligibilityIndexes = uniqueIndexes(eligibility);
  for (const index of countRange(1, 72)) {
    if (!eligibilityIndexes.has(index))
      failures.push(`slide ${index} is missing artifact eligibility`);
  }
  const eligible = eligibility.filter((item) => (item.eligibleArtifacts ?? []).length > 0);
  const nativeUsed = eligible.filter(
    (item) => item.selectedArtifact && item.selectedArtifact !== 'generic-card-grid',
  );
  const utilization = nativeUsed.length / Math.max(1, eligible.length);
  if (utilization < (benchmark?.gates?.minimumEligibleAtlasUtilization ?? 0.85)) {
    failures.push(
      `Atlas eligible utilization ${utilization.toFixed(3)} is below the required threshold`,
    );
  }
  const missingRequired = eligibility.filter(
    (item) => item.requiredArtifact && item.selectedArtifact !== item.requiredArtifact,
  );
  for (const item of missingRequired)
    failures.push(`slide ${item.slideIndex} is missing required artifact ${item.requiredArtifact}`);
  const genericFallbacks = eligible.filter(
    (item) => item.selectedArtifact === 'generic-card-grid' && !item.fallbackReasonCode,
  );
  const genericRate = genericFallbacks.length / Math.max(1, eligible.length);
  if (genericRate > (benchmark?.gates?.maximumUnjustifiedGenericFallbackRate ?? 0.1)) {
    failures.push(
      `unjustified generic fallback rate ${genericRate.toFixed(3)} exceeds the threshold`,
    );
  }

  const expectedInspectionKeys = [];
  for (const [kind, count] of Object.entries(requiredCounts)) {
    for (const slideIndex of countRange(1, count))
      expectedInspectionKeys.push(`${kind}:${slideIndex}`);
  }
  const inspectionByKey = new Map(
    (run?.visualInspectionReceipts ?? []).map((receipt) => [
      `${receipt.deckKind}:${receipt.slideIndex}`,
      receipt,
    ]),
  );
  for (const key of expectedInspectionKeys) {
    const receipt = inspectionByKey.get(key);
    if (!receipt) {
      failures.push(`${key} was not opened and inspected`);
      continue;
    }
    if (!receipt.browserImageDigest || !receipt.pptxImageDigest)
      failures.push(`${key} is missing a browser or PPTX image digest`);
    if (!receipt.inspectedBy || !receipt.inspectedAt)
      failures.push(`${key} has no inspection observation identity`);
    for (const check of REQUIRED_CHECKS) {
      if (receipt.checks?.[check] !== 'pass') failures.push(`${key} failed visual check ${check}`);
    }
  }
  if (inspectionByKey.size !== expectedInspectionKeys.length)
    failures.push('visual inspection receipt count does not match every required rendered page');
  if ((run?.sectionMontageReceipts ?? []).length !== 14)
    failures.push('all 14 long-deck section montages must be inspected');
  if (
    !run?.longContactSheetInspection ||
    !run?.shortContactSheetInspection ||
    !run?.executiveContactSheetInspection
  ) {
    failures.push('long, short, and executive full-deck contact sheets must be inspected');
  }

  const ledgerByClaim = new Map(
    (run?.compressionLedger ?? []).map((entry) => [entry.sourceClaimId, entry]),
  );
  const longValues = run?.reconciledClaimValues?.long ?? {};
  const shortValues = run?.reconciledClaimValues?.short ?? {};
  for (const claim of criticalFacts?.claims ?? []) {
    const entry = ledgerByClaim.get(claim.claimId);
    if (!entry) failures.push(`compression decision missing for claim ${claim.claimId}`);
    if (claim.criticality === 'decision-critical') {
      if (!entry?.preservedEvidenceRefs?.length)
        failures.push(`decision-critical claim ${claim.claimId} lost source coverage`);
      if (
        entry?.disposition === 'omitted_noncritical' ||
        entry?.disposition === 'omitted_redundant'
      )
        failures.push(`decision-critical claim ${claim.claimId} was omitted`);
      if (
        claim.value !== undefined &&
        (longValues[claim.claimId] !== claim.value || shortValues[claim.claimId] !== claim.value)
      ) {
        failures.push(`critical figure mismatch for ${claim.claimId}`);
      }
    }
  }
  if (ledgerByClaim.size !== (criticalFacts?.claims ?? []).length)
    failures.push('compression ledger does not account for every canonical claim exactly once');
  if ((run?.unsupportedDecisionCriticalClaims ?? []).length > 0)
    failures.push('unsupported decision-critical claims are present');
  if ((run?.materialContradictions ?? []).length > 0)
    failures.push('material contradictions are present');
  if (
    (run?.weightedCompressionRetention ?? 0) <
    (benchmark?.gates?.minimumWeightedCompressionRetention ?? 0.95)
  )
    failures.push('weighted compression retention is below 95%');
  const correctQuestions = (run?.decisionQuestionResults ?? []).filter(
    (result) => result.longCorrect && result.shortCorrect,
  ).length;
  if ((run?.decisionQuestionResults ?? []).length !== 20 || correctQuestions < 19)
    failures.push('short deck must preserve at least 19 of 20 frozen decision answers');
  return failures;
}
