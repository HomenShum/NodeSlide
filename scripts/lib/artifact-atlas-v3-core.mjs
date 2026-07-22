import { validateArtifactSpec } from './artifact-spec-core.mjs';
import { digestJson } from './node-gym-runner-core.mjs';

export function buildAtlasV3EvidenceCandidate(input) {
  const issues = [];
  const definitions = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]));
  const catalogEntries = new Map(input.catalog.entries.map((entry) => [entry.id, entry]));
  const lineage = input.artifacts.map((artifact) => {
    const validation = validateArtifactSpec(artifact.artifactSpec);
    const catalogEntry = catalogEntries.get(artifact.id);
    const catalogSpecDigest = catalogEntry?.artifactSpec?.specDigest ?? null;
    const definitionSpecDigest = artifact.artifactSpec.specDigest;
    const specDigestMatches = catalogSpecDigest === definitionSpecDigest;
    const receipt = catalogEntry?.receipt;
    const receiptBindingPassed = receiptBindsArtifact(receipt, artifact, catalogEntry);
    const automatedHardGatesPassed = receiptHardGatesPassed(receipt);
    if (!validation.ok) issues.push(`artifact_spec_invalid:${artifact.id}`);
    if (!catalogEntry) issues.push(`catalog_entry_missing:${artifact.id}`);
    if (!specDigestMatches) issues.push(`catalog_spec_digest_mismatch:${artifact.id}`);
    if (!receiptBindingPassed) issues.push(`catalog_receipt_binding_mismatch:${artifact.id}`);
    if (!automatedHardGatesPassed) issues.push(`catalog_hard_gate_incomplete:${artifact.id}`);
    return {
      artifactId: artifact.id,
      kind: artifact.artifactSpec.kind,
      specDigest: definitionSpecDigest,
      catalogSpecDigest,
      specDigestMatches,
      semanticStatus: validation.ok ? 'passed' : 'failed',
      semanticIssueCodes: validation.issues.map((issue) => issue.code),
      receiptDigest: receipt ? digestJson(receipt) : null,
      receiptBindingPassed,
      automatedHardGatesPassed,
      browserPreview: catalogEntry?.preview ?? null,
    };
  });
  for (const entry of input.catalog.entries)
    if (!definitions.has(entry.id)) issues.push(`unknown_catalog_entry:${entry.id}`);

  const activeMatrixRuns = indexRunPlans(input.activeMatrixRuns);
  const campaigns = input.campaigns.map((campaign) =>
    summarizeCampaign(
      campaign,
      input.activeConfigDigest,
      input.activeMatrixDigest,
      activeMatrixRuns,
    ),
  );
  const activeCampaigns = campaigns.filter((campaign) => campaign.configurationCompatible);
  const deterministicCampaigns = activeCampaigns.filter(
    (campaign) => campaign.executor === 'deterministic',
  );
  const liveCampaigns = activeCampaigns.filter((campaign) => campaign.executor === 'ui');
  const deterministicPairedPassed = deterministicCampaigns.some(
    (campaign) =>
      campaign.evidenceComplete &&
      campaign.pairedEvidenceComplete &&
      campaign.selectedRunCount >= 2 &&
      campaign.passed === campaign.selectedRunCount,
  );
  const livePairedPassed = liveCampaigns.some(
    (campaign) =>
      campaign.evidenceComplete &&
      campaign.pairedEvidenceComplete &&
      campaign.selectedRunCount >= 2 &&
      campaign.passed === campaign.selectedRunCount &&
      campaign.attributedLiveRuns === campaign.selectedRunCount,
  );
  const activeFullMatrixCampaigns = activeCampaigns.filter(
    (campaign) =>
      campaign.selection === 'all' &&
      campaign.fullMatrixExplicitlyConfirmed &&
      campaign.selectedRunCount === input.expectedMatrixSize,
  );
  const fullMatrixComplete = activeFullMatrixCampaigns.some(
    (campaign) =>
      campaign.evidenceComplete &&
      campaign.pairedEvidenceComplete &&
      campaign.passed === input.expectedMatrixSize,
  );
  const humanPreferencePassed = input.humanPreference?.status === 'passed';
  const sourceVisualInspectionPassed =
    input.visualInspection?.status === 'passed' &&
    normalizeSha(input.visualInspection.atlasPptxSha256) ===
      normalizeSha(input.sourceAtlasPptxDigest);
  const gates = {
    typedArtifactSpecs: gate(lineage.every((entry) => entry.semanticStatus === 'passed')),
    specReceiptLineage: gate(
      lineage.every(
        (entry) => entry.specDigestMatches && entry.receiptBindingPassed && entry.receiptDigest,
      ),
    ),
    atlasV2AutomatedHardGates: gate(lineage.every((entry) => entry.automatedHardGatesPassed)),
    sourceAtlasVisualInspection: gate(sourceVisualInspectionPassed),
    deterministicPairedReplay: gate(deterministicPairedPassed),
    boundedLivePairedEvidence: gate(livePairedPassed, liveCampaigns.length ? 'failed' : 'not_run'),
    fullMatrix: gate(fullMatrixComplete, activeFullMatrixCampaigns.length ? 'failed' : 'not_run'),
    blindHumanPreference: gate(humanPreferencePassed, 'not_run'),
  };
  if (!livePairedPassed) issues.push('bounded_live_paired_evidence_incomplete');
  if (!fullMatrixComplete) issues.push('full_matrix_not_run');
  if (!humanPreferencePassed) issues.push('blind_human_preference_not_run');

  const candidate = {
    schemaVersion: 'nodeslide.artifact-atlas-v3-evidence-candidate/v1',
    atlasVersion: 'artifact-atlas-v3',
    sourceAtlas: {
      version: input.catalog.atlasVersion,
      path: input.sourceAtlasPptxPath,
      digest: normalizeSha(input.sourceAtlasPptxDigest),
      visualInspectionDigest: digestJson(input.visualInspection),
      reuseDisposition:
        'Audited V2 museum remains the typed visual baseline; V3 release evidence is layered by immutable run digest, not patched into the deck.',
    },
    canonicalArtifactCount: lineage.length,
    lineageDigest: digestJson(lineage),
    campaignCount: campaigns.length,
    campaigns,
    campaignLedgerDigest: digestJson(campaigns),
    expectedMatrixSize: input.expectedMatrixSize,
    activeConfigDigest: input.activeConfigDigest,
    activeMatrixDigest: input.activeMatrixDigest,
    gates,
    publicReleaseApproved: Object.values(gates).every((entry) => entry.status === 'passed'),
    promotionEligible: false,
    issues: [...new Set(issues)].sort(),
  };
  return { candidate, lineage };
}

export function buildAtlasV3BlindReviewManifest(campaigns) {
  const receipts = campaigns
    .filter(
      (campaign) =>
        campaign.configurationCompatible === true &&
        campaign.evidenceComplete === true &&
        campaign.pairedEvidenceComplete === true,
    )
    .flatMap((campaign) => campaign.validatedRuns ?? []);
  const grouped = new Map();
  for (const receipt of receipts) {
    if (!receipt.campaignId || !receipt.pairingKey) continue;
    const groupKey = digestJson({
      campaignId: receipt.campaignId,
      pairingKey: receipt.pairingKey,
    });
    const group = grouped.get(groupKey) ?? [];
    group.push(receipt);
    grouped.set(groupKey, group);
  }
  const eligiblePairs = [];
  const calibrationControls = [];
  const exclusions = [];
  for (const group of grouped.values()) {
    const pairingKey = group[0].pairingKey;
    const liveEligible = group.filter(
      (receipt) =>
        receipt.status === 'passed' &&
        receipt.automatedHardGatesPassed === true &&
        receipt.routeMode === 'live' &&
        receipt.returnedModel &&
        receipt.screenshot?.validationStatus === 'passed' &&
        receipt.screenshot?.digest &&
        receipt.screenshot?.path,
    );
    if (hasDistinctHarnessPair(liveEligible)) {
      eligiblePairs.push({
        pairId: digestJson({ pairingKey, receipts: liveEligible.map((entry) => entry.runId) }),
        candidates: liveEligible.slice(0, 2).map((receipt, index) => ({
          blindId: index === 0 ? 'A' : 'B',
          screenshot: receipt.screenshot.path,
          screenshotRelativeToRun: receipt.screenshot.relativeToRun,
          campaignPath: receipt.screenshot.campaignPath,
          runPath: receipt.screenshot.runPath,
          screenshotDigest: receipt.screenshot.digest,
        })),
      });
      continue;
    }
    const deterministic = group.filter(
      (receipt) =>
        receipt.status === 'passed' &&
        receipt.automatedHardGatesPassed === true &&
        receipt.routeMode === 'deterministic',
    );
    if (hasDistinctHarnessPair(deterministic)) {
      calibrationControls.push({
        calibrationId: digestJson({
          pairingKey,
          receipts: deterministic.map((entry) => entry.runId),
        }),
        disposition: 'deterministic_control_calibration_only',
        screenshots: deterministic.slice(0, 2).map((receipt) => ({
          path: receipt.screenshot?.path ?? null,
          relativeToRun: receipt.screenshot?.relativeToRun ?? null,
          campaignPath: receipt.screenshot?.campaignPath ?? null,
          runPath: receipt.screenshot?.runPath ?? null,
          digest: receipt.screenshot?.digest ?? null,
        })),
      });
      continue;
    }
    exclusions.push({
      pairDigest: digestJson(pairingKey),
      reasons: [
        ...new Set(group.flatMap((receipt) => receipt.issueCodes ?? []).filter(stableIssueCode)),
      ].sort(),
    });
  }
  return {
    schemaVersion: 'nodeslide.artifact-atlas-v3-blind-review/v1',
    status: eligiblePairs.length ? 'ready_for_blind_review' : 'insufficient_eligible_pairs',
    eligiblePairCount: eligiblePairs.length,
    pairs: eligiblePairs,
    calibrationControls,
    exclusions,
    anonymized: true,
    humanReview: { status: 'not_run' },
    promotionEligible: false,
  };
}

function summarizeCampaign(campaign, activeConfigDigest, activeMatrixDigest, activeMatrixRuns) {
  const plan = record(campaign?.plan);
  const summary = record(campaign?.summary);
  const receipts = Array.isArray(campaign?.receipts) ? campaign.receipts : [];
  const runPlans = Array.isArray(campaign?.runPlans) ? campaign.runPlans : [];
  const selectedRunIds = validRunIds(plan.selectedRunIds);
  const receiptRunIds = receipts.map((receipt) => validRunId(receipt?.runId));
  const runPlanIds = runPlans.map((runPlan) => validRunId(runPlan?.runId));
  const summaryRuns = Array.isArray(summary.runs) ? summary.runs : [];
  const summaryRunIds = summaryRuns.map((run) => validRunId(run?.runId));
  const plannedCount = integer(plan.selectedRunCount);
  const summarySelectedCount = integer(summary.selectedRunCount);
  const campaignPlanDigest = digestJson(plan);
  const evidenceIssueCodes = [];

  if (
    plan.schemaVersion !== 'nodekit.gym-campaign-plan/v1' ||
    summary.schemaVersion !== 'nodekit.gym-campaign-summary/v1'
  )
    evidenceIssueCodes.push('campaign_schema_invalid');
  if (!validRunId(plan.campaignId) || summary.campaignId !== plan.campaignId)
    evidenceIssueCodes.push('campaign_identity_mismatch');
  if (summary.campaignPlanDigest !== campaignPlanDigest)
    evidenceIssueCodes.push('campaign_plan_digest_mismatch');

  const planSelectionValid =
    plannedCount !== null &&
    plannedCount > 0 &&
    selectedRunIds !== null &&
    selectedRunIds.length === plannedCount &&
    allUnique(selectedRunIds);
  if (!planSelectionValid) evidenceIssueCodes.push('selected_run_plan_invalid');
  if (summarySelectedCount !== plannedCount)
    evidenceIssueCodes.push('summary_selected_run_mismatch');

  const receiptCoverageComplete =
    planSelectionValid && exactUniqueCoverage(selectedRunIds, receiptRunIds);
  if (!receiptCoverageComplete) evidenceIssueCodes.push('receipt_coverage_mismatch');
  const runPlanCoverageComplete =
    planSelectionValid && exactUniqueCoverage(selectedRunIds, runPlanIds);
  if (!runPlanCoverageComplete) evidenceIssueCodes.push('run_plan_coverage_mismatch');
  const runPlansById = indexRunPlans(runPlans);
  const runPlanMatrixBindingsPassed =
    runPlanCoverageComplete &&
    activeMatrixRuns.valid &&
    runPlans.every((runPlan) =>
      runPlanBindsMatrix(runPlan, activeMatrixRuns.byRunId.get(runPlan.runId)),
    );
  if (!runPlanMatrixBindingsPassed) evidenceIssueCodes.push('run_plan_matrix_binding_mismatch');
  const receiptBindingsPassed =
    runPlanCoverageComplete &&
    receipts.every((receipt) =>
      receiptBindsCampaign(receipt, plan, runPlansById.byRunId.get(receipt.runId)),
    );
  if (!receiptBindingsPassed || receipts.length === 0)
    evidenceIssueCodes.push('receipt_binding_invalid');

  const summaryRunCoverageComplete =
    planSelectionValid && exactUniqueCoverage(selectedRunIds, summaryRunIds);
  if (!summaryRunCoverageComplete) evidenceIssueCodes.push('summary_run_coverage_mismatch');
  const summaryReceiptStatusesMatch =
    receiptCoverageComplete &&
    summaryRunCoverageComplete &&
    receipts.every((receipt) =>
      summaryRunMatchesReceipt(
        summaryRuns.find((run) => run.runId === receipt.runId),
        receipt,
      ),
    );
  if (!summaryReceiptStatusesMatch) evidenceIssueCodes.push('summary_receipt_status_mismatch');

  const passed = receipts.filter((receipt) => receipt.status === 'passed').length;
  const failed = receipts.length - passed;
  if (integer(summary.passed) !== passed || integer(summary.failed) !== failed)
    evidenceIssueCodes.push('summary_count_mismatch');
  const missingReceiptIds = selectedRunIds?.filter((runId) => !receiptRunIds.includes(runId)) ?? [];
  const summaryUnrun = validRunIds(summary.unrun);
  if (
    summaryUnrun === null ||
    !allUnique(summaryUnrun) ||
    !sameStringSet(summaryUnrun, missingReceiptIds)
  )
    evidenceIssueCodes.push('summary_unrun_mismatch');
  if (integer(summary.attemptedOrResumed) !== receipts.length)
    evidenceIssueCodes.push('summary_attempt_count_mismatch');

  const evidenceComplete = evidenceIssueCodes.length === 0;
  const pairedEvidence = validatePairedEvidence({
    runPlans,
    summary,
    pairedDeltaReport: campaign?.pairedDeltaReport,
  });
  const configurationCompatible =
    plan.configDigest === activeConfigDigest && plan.matrixDigest === activeMatrixDigest;
  const validatedRuns =
    evidenceComplete && configurationCompatible && pairedEvidence.ok
      ? receipts.map((receipt) => {
          const runPlan = runPlansById.byRunId.get(receipt.runId);
          return {
            campaignId: plan.campaignId,
            runId: receipt.runId,
            harnessId: runPlan.harness.id,
            pairingKey: runPlan.pairingKey,
            status: receipt.status,
            automatedHardGatesPassed: receipt.automatedHardGatesPassed,
            routeMode: receipt.routeMode,
            returnedModel: receipt.returnedModel,
            issueCodes: receipt.issueCodes ?? [],
            runPlanDigest: digestJson(runPlan),
            receiptDigest: digestJson(receipt),
            screenshot: canonicalScreenshot(campaign, receipt),
          };
        })
      : [];
  return {
    campaignId: plan.campaignId ?? null,
    selection: plan.selection ?? null,
    executor: plan.executor ?? null,
    campaignPlanDigest,
    summaryDigest: digestJson(summary),
    configurationCompatible,
    evidenceComplete,
    evidenceIssueCodes,
    pairedEvidenceComplete: pairedEvidence.ok,
    pairedEvidenceIssueCodes: pairedEvidence.issueCodes,
    pairedDeltaReportDigest: pairedEvidence.reportDigest,
    expectedPairCount: pairedEvidence.expectedPairCount,
    fullMatrixExplicitlyConfirmed: plan.fullMatrixExplicitlyConfirmed === true,
    selectedRunCount: plannedCount ?? 0,
    summarySelectedRunCount: summarySelectedCount,
    passed,
    failed,
    unrun: missingReceiptIds.length,
    spentCostMicroUsd: summary.spentCostMicroUsd,
    stoppedBy: summary.stoppedBy,
    receiptCount: receipts.length,
    runPlanCount: runPlans.length,
    runPlanDigests: runPlans.map((runPlan) => ({
      runId: runPlan.runId,
      digest: digestJson(runPlan),
      matrixRunDigest: activeMatrixRuns.byRunId.has(runPlan.runId)
        ? digestJson(activeMatrixRuns.byRunId.get(runPlan.runId))
        : null,
      provider: runPlan.model?.provider ?? null,
      route: runPlan.model?.route ?? null,
      model: runPlan.model?.id ?? null,
    })),
    receiptDigests: receipts.map((receipt) => ({
      runId: receipt.runId,
      digest: digestJson(receipt),
      status: receipt.status,
      returnedModel: receipt.returnedModel,
    })),
    attributedLiveRuns: receipts.filter(
      (receipt) =>
        receiptBindsCampaign(receipt, plan, runPlansById.byRunId.get(receipt.runId)) &&
        receipt.status === 'passed' &&
        receipt.routeMode === 'live' &&
        receipt.returnedModel,
    ).length,
    validatedRuns,
    issueCodes: [
      ...new Set(
        receipts
          .flatMap((receipt) => receipt.issueCodes ?? [])
          .filter((code) => typeof code === 'string' && /^[a-z0-9][a-z0-9_:-]{0,119}$/u.test(code)),
      ),
    ].sort(),
  };
}

function validatePairedEvidence({ runPlans, summary, pairedDeltaReport }) {
  const issueCodes = [];
  const groups = new Map();
  for (const runPlan of runPlans) {
    const pairingKey = validOpaqueId(runPlan?.pairingKey) ? runPlan.pairingKey : null;
    if (!pairingKey) {
      issueCodes.push('paired_run_identity_invalid');
      continue;
    }
    const group = groups.get(pairingKey) ?? [];
    group.push(runPlan);
    groups.set(pairingKey, group);
  }
  let expectedPairCount = 0;
  for (const group of groups.values()) {
    const harnessIds = group.map((runPlan) => runPlan?.harness?.id);
    if (
      group.length < 2 ||
      harnessIds.some((harnessId) => !validOpaqueId(harnessId)) ||
      !allUnique(harnessIds)
    ) {
      issueCodes.push('distinct_harness_pair_missing');
      continue;
    }
    expectedPairCount += group.length - 1;
  }
  if (expectedPairCount < 1) issueCodes.push('paired_run_identity_invalid');

  const report = record(pairedDeltaReport);
  const summaryReport = record(summary.pairedDeltaReport);
  const reportDigest = digestJson(report);
  if (
    report.schemaVersion !== 'nodekit.gym-paired-delta-report/v1' ||
    report.ok !== true ||
    report.complete !== true ||
    (Array.isArray(report.issueCodes) ? report.issueCodes.length : 1) !== 0
  )
    issueCodes.push('paired_delta_report_incomplete');
  if (
    integer(report.pairCount) !== expectedPairCount ||
    integer(report.expectedPairCount) !== expectedPairCount ||
    summaryReport.status !== 'complete' ||
    summaryReport.reportDigest !== reportDigest ||
    integer(summaryReport.pairCount) !== expectedPairCount ||
    integer(summaryReport.expectedPairCount) !== expectedPairCount
  )
    issueCodes.push('paired_delta_report_binding_mismatch');
  if (
    summary.pairedCausalClaimReady !== true ||
    !Array.isArray(summary.runs) ||
    summary.runs.some((run) => run.harnessBehaviorObserved !== true)
  )
    issueCodes.push('paired_causal_claim_not_ready');
  return {
    ok: issueCodes.length === 0,
    issueCodes: [...new Set(issueCodes)].sort(),
    reportDigest: report.schemaVersion ? reportDigest : null,
    expectedPairCount,
  };
}

function canonicalScreenshot(campaign, receipt) {
  const campaignPath = portableRelativePath(campaign?.campaignPath);
  const runDirectories = record(campaign?.runDirectories);
  const runPath = portableRelativePath(runDirectories[receipt.runId]);
  const rawPath = portableRelativePath(receipt.artifacts?.browser?.path);
  if (!campaignPath || !runPath || !rawPath) return null;
  if (!(runPath === `${campaignPath}/runs/${receipt.runId}`)) return null;
  const path = rawPath.startsWith(`${runPath}/`) ? rawPath : `${runPath}/${rawPath}`;
  if (!path.startsWith(`${runPath}/`)) return null;
  return {
    campaignPath,
    runPath,
    relativeToRun: path.slice(runPath.length + 1),
    path,
    digest: normalizeSha(receipt.artifacts?.browser?.digest),
    validationStatus: receipt.artifacts?.browser?.validation?.status ?? null,
  };
}

function portableRelativePath(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/u.test(normalized)) return null;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) return null;
  return normalized;
}

function hasDistinctHarnessPair(runs) {
  return runs.length >= 2 && new Set(runs.map((run) => run.harnessId)).size >= 2;
}

function receiptBindsCampaign(receipt, campaignPlan, runPlan) {
  if (!receipt || receipt.schemaVersion !== 'nodekit.gym-run-receipt/v2') return false;
  if (!runPlan || runPlan.schemaVersion !== 'nodekit.gym/v1') return false;
  if (receipt.runId !== runPlan.runId || receipt.planDigest !== digestJson(runPlan)) return false;
  if (
    receipt.comparisonKey !== runPlan.comparisonKey ||
    receipt.harnessPairingKey !== runPlan.harnessPairingKey ||
    receipt.pairingKey !== runPlan.pairingKey ||
    receipt.repetition !== runPlan.repetition ||
    receipt.executor !== campaignPlan.executor
  )
    return false;
  if (!receiptRouteBindsPlan(receipt, runPlan)) return false;
  if (receipt.status === 'passed') {
    return (
      receipt.automatedHardGatesPassed === true &&
      normalizeSha(receipt.semanticEvaluationDigest) !== null
    );
  }
  return receipt.automatedHardGatesPassed !== true;
}

function receiptRouteBindsPlan(receipt, runPlan) {
  const model = record(runPlan.model);
  const actualRoute = record(receipt.actualRoute);
  if (
    !validOpaqueId(model.id) ||
    !validOpaqueId(model.provider) ||
    !validOpaqueId(model.route) ||
    actualRoute.requestedProvider !== model.provider ||
    actualRoute.requestedRoute !== model.route
  )
    return false;
  if (receipt.returnedModel !== actualRoute.actualModel) return false;
  if (model.provider === 'local') {
    if (
      receipt.routeMode !== 'deterministic' ||
      actualRoute.actualProvider !== model.provider ||
      receipt.returnedModel !== model.route
    )
      return false;
  } else {
    if (receipt.status === 'passed' && receipt.routeMode !== 'live') return false;
    if (!validOpaqueId(actualRoute.actualProvider)) return false;
    if (model.returnedModelRequired === true && !validOpaqueId(receipt.returnedModel)) return false;
    if (model.cohort === 'random-router') {
      if (receipt.returnedModel === model.route) return false;
    } else if (receipt.returnedModel !== model.route) return false;
  }
  return true;
}

function runPlanBindsMatrix(runPlan, matrixRun) {
  if (
    !runPlan ||
    !matrixRun ||
    runPlan.schemaVersion !== 'nodekit.gym/v1' ||
    matrixRun.schemaVersion !== 'nodekit.gym/v1' ||
    runPlan.runId !== matrixRun.runId ||
    runPlan.repetition !== matrixRun.repetition ||
    digestJson(runPlan.model) !== digestJson(matrixRun.model) ||
    digestJson(runPlan.harness) !== digestJson(matrixRun.harness) ||
    digestJson(runPlan.budget) !== digestJson(matrixRun.budget)
  )
    return false;
  const runTask = record(runPlan.task);
  const matrixTask = record(matrixRun.task);
  for (const field of ['id', 'taskClass', 'curriculumLevel', 'pool'])
    if (runTask[field] !== matrixTask[field]) return false;
  for (const field of ['taskDigest', 'evidenceDigest', 'referenceDigest'])
    if (!normalizeSha(runTask[field])) return false;
  if (!normalizeSha(runPlan.runtimeFixtureDigest)) return false;
  if (runPlan.egressProjectionDigest !== undefined && !normalizeSha(runPlan.egressProjectionDigest))
    return false;
  const budgetKey = [
    runPlan.budget.maxTokens,
    runPlan.budget.maxLatencyMs,
    runPlan.budget.maxCostMicroUsd,
    runPlan.budget.maxRepairs,
  ].join(':');
  const comparisonKey = [
    runTask.taskDigest,
    runTask.evidenceDigest,
    runTask.referenceDigest,
    runPlan.repetition,
    budgetKey,
  ].join('::');
  const harnessPairingKey = [
    runTask.taskDigest,
    runTask.evidenceDigest,
    runTask.referenceDigest,
    runPlan.model.id,
    runPlan.repetition,
    budgetKey,
  ].join('::');
  return (
    runPlan.comparisonKey === comparisonKey &&
    runPlan.harnessPairingKey === harnessPairingKey &&
    runPlan.pairingKey === harnessPairingKey
  );
}

function indexRunPlans(runPlans) {
  if (!Array.isArray(runPlans)) return { valid: false, byRunId: new Map() };
  const byRunId = new Map();
  let valid = true;
  for (const runPlan of runPlans) {
    const runId = validRunId(runPlan?.runId);
    if (!runId || byRunId.has(runId)) valid = false;
    else byRunId.set(runId, runPlan);
  }
  return { valid, byRunId };
}

function summaryRunMatchesReceipt(summaryRun, receipt) {
  if (!summaryRun) return false;
  const statusMatches =
    receipt.status === 'passed'
      ? ['passed', 'skipped-passed'].includes(summaryRun.status)
      : summaryRun.status === receipt.status;
  return (
    statusMatches &&
    normalizeSha(summaryRun.semanticEvaluationDigest) ===
      normalizeSha(receipt.semanticEvaluationDigest)
  );
}

function exactUniqueCoverage(expected, actual) {
  return (
    Array.isArray(expected) &&
    Array.isArray(actual) &&
    expected.length > 0 &&
    expected.length === actual.length &&
    allUnique(expected) &&
    allUnique(actual) &&
    actual.every((runId) => runId !== null) &&
    sameStringSet(expected, actual)
  );
}

function sameStringSet(left, right) {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every((value) => expected.has(value));
}

function allUnique(values) {
  return new Set(values).size === values.length;
}

function validRunIds(value) {
  if (!Array.isArray(value)) return null;
  const values = value.map(validRunId);
  return values.every((entry) => entry !== null) ? values : null;
}

function validRunId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,511}$/u.test(value)
    ? value
    : null;
}

function validOpaqueId(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096) return false;
  for (const character of value) if (character.codePointAt(0) < 32) return false;
  return true;
}

function integer(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function record(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function gate(passed, incompleteStatus = 'failed') {
  return { status: passed ? 'passed' : incompleteStatus };
}

function normalizeSha(value) {
  const clean = String(value ?? '').replace(/^sha256:/u, '');
  return /^[a-f0-9]{64}$/u.test(clean) ? `sha256:${clean}` : null;
}

function uniqueReceipts(receipts) {
  const byRun = new Map();
  for (const receipt of receipts) byRun.set(receipt.runId, receipt);
  return [...byRun.values()];
}

function stableIssueCode(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9_:-]{0,119}$/u.test(value);
}

function receiptHardGatesPassed(receipt) {
  if (!receipt || receipt.status !== 'hard-gates-passed') return false;
  return [
    'spec',
    'semantic',
    'evidence',
    'browser',
    'pptx',
    'accessibility',
    'visualInspection',
  ].every((stage) => receipt.stages?.[stage]?.status === 'passed');
}

function receiptBindsArtifact(receipt, artifact, catalogEntry) {
  if (!receipt || !artifact?.artifactSpec || !catalogEntry?.artifactSpec) return false;
  const expectedSpec = artifact.artifactSpec;
  const receiptSpec = receipt.artifactSpec;
  if (!receiptSpec) return false;
  const expectedDigest = expectedSpec.specDigest;
  const expectedSourceRefs = [...(expectedSpec.provenance?.sourceRefs ?? [])].sort();
  const receiptSourceRefs = [...(receipt.semanticValidation?.sourceRefs ?? [])].sort();
  return (
    receipt.artifactId === artifact.id &&
    catalogEntry.id === artifact.id &&
    receipt.specDigest === expectedDigest &&
    receiptSpec.specDigest === expectedDigest &&
    receipt.semanticValidation?.specDigest === expectedDigest &&
    receipt.semanticValidation?.ok === true &&
    digestJson(receiptSpec) === digestJson(expectedSpec) &&
    digestJson(catalogEntry.artifactSpec) === digestJson(expectedSpec) &&
    digestJson(receiptSourceRefs) === digestJson(expectedSourceRefs)
  );
}
