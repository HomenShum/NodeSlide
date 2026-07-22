import { describe, expect, it } from 'vitest';
import {
  buildAtlasV3BlindReviewManifest,
  buildAtlasV3EvidenceCandidate,
} from './lib/artifact-atlas-v3-core.mjs';
import { artifactSpecEnvelope } from './lib/artifact-spec-core.mjs';
import { digestJson } from './lib/node-gym-runner-core.mjs';

const artifact = {
  id: 'equation',
  narrativeJob: 'Show a bound equation.',
  evidence: [{ sourceId: 'source' }],
  accessibility: { altText: 'Equation' },
  allowedClaims: ['Q equals one'],
};
const spec = artifactSpecEnvelope(artifact, 'equation', {
  expression: { op: 'value', name: 'Q' },
  values: { Q: 1 },
  result: 1,
  tolerance: 0,
  rounding: 0,
});
const receipt = {
  status: 'hard-gates-passed',
  artifactId: artifact.id,
  artifactSpec: spec,
  specDigest: spec.specDigest,
  semanticValidation: {
    ok: true,
    specDigest: spec.specDigest,
    sourceRefs: spec.provenance.sourceRefs,
  },
  stages: Object.fromEntries(
    ['spec', 'semantic', 'evidence', 'browser', 'pptx', 'accessibility', 'visualInspection'].map(
      (stage) => [stage, { status: 'passed' }],
    ),
  ),
};
const digest = 'a'.repeat(64);
const activeConfigDigest = `sha256:${'b'.repeat(64)}`;
const activeMatrixDigest = `sha256:${'c'.repeat(64)}`;

function campaign(executor, status = 'passed') {
  const passed = status === 'passed' ? 2 : 0;
  const model =
    executor === 'ui'
      ? {
          id: 'model/free',
          provider: 'openrouter',
          route: 'model/free',
          returnedModelRequired: true,
          cohort: 'pinned-free',
        }
      : {
          id: 'nodeslide/deterministic-compiler',
          provider: 'local',
          route: 'nodeslide/deterministic-compiler',
          returnedModelRequired: false,
          cohort: 'control',
        };
  const runPlans = Array.from({ length: 2 }, (_, index) => {
    const task = {
      id: 'public-equation',
      taskClass: 'equation',
      curriculumLevel: 3,
      pool: 'public-development',
      taskDigest: `sha256:${'1'.repeat(64)}`,
      evidenceDigest: `sha256:${'2'.repeat(64)}`,
      referenceDigest: `sha256:${'3'.repeat(64)}`,
    };
    const budget = {
      maxTokens: 8_000,
      maxLatencyMs: 300_000,
      maxCostMicroUsd: 200_000,
      maxRepairs: 2,
    };
    const budgetKey = '8000:300000:200000:2';
    const comparisonKey = `${task.taskDigest}::${task.evidenceDigest}::${task.referenceDigest}::1::${budgetKey}`;
    const harnessPairingKey = `${task.taskDigest}::${task.evidenceDigest}::${task.referenceDigest}::${model.id}::1::${budgetKey}`;
    return {
      schemaVersion: 'nodekit.gym/v1',
      runId: `${executor}-${index}`,
      task,
      model,
      harness: { id: index ? 'structured-planner' : 'light-director', version: '2.0.0' },
      budget,
      repetition: 1,
      comparisonKey,
      harnessPairingKey,
      pairingKey: harnessPairingKey,
      runtimeFixtureDigest: `sha256:${String(index + 7)
        .repeat(64)
        .slice(0, 64)}`,
    };
  });
  const plan = {
    schemaVersion: 'nodekit.gym-campaign-plan/v1',
    campaignId: `${executor}-pair`,
    selection: 'bounded',
    executor,
    configDigest: activeConfigDigest,
    matrixDigest: activeMatrixDigest,
    selectedRunCount: 2,
    selectedRunIds: [`${executor}-0`, `${executor}-1`],
    fullMatrixExplicitlyConfirmed: false,
  };
  const receipts = runPlans.map((runPlan, index) => ({
    schemaVersion: 'nodekit.gym-run-receipt/v2',
    runId: runPlan.runId,
    comparisonKey: runPlan.comparisonKey,
    harnessPairingKey: runPlan.harnessPairingKey,
    pairingKey: runPlan.pairingKey,
    repetition: runPlan.repetition,
    status,
    automatedHardGatesPassed: status === 'passed',
    routeMode: executor === 'ui' ? 'live' : 'deterministic',
    returnedModel: model.route,
    actualRoute: {
      requestedProvider: model.provider,
      requestedRoute: model.route,
      actualProvider: model.provider,
      actualModel: model.route,
    },
    planDigest: digestJson(runPlan),
    semanticEvaluationDigest: `sha256:${String(index + 5)
      .repeat(64)
      .slice(0, 64)}`,
    executor,
    issueCodes: status === 'passed' ? [] : ['returned_model_attribution_missing'],
    artifacts: {
      browser: {
        path: `${executor}-${index}.png`,
        digest: `sha256:${String(index + 1)
          .repeat(64)
          .slice(0, 64)}`,
        validation: { status: 'passed' },
      },
    },
  }));
  const pairedDeltaReport = {
    schemaVersion: 'nodekit.gym-paired-delta-report/v1',
    ok: true,
    issueCodes: [],
    pairCount: 1,
    expectedPairCount: 1,
    complete: true,
  };
  return {
    plan,
    summary: {
      schemaVersion: 'nodekit.gym-campaign-summary/v1',
      campaignId: plan.campaignId,
      campaignPlanDigest: digestJson(plan),
      selectedRunCount: 2,
      attemptedOrResumed: 2,
      passed,
      failed: 2 - passed,
      unrun: [],
      spentCostMicroUsd: 0,
      stoppedBy: null,
      pairedCausalClaimReady: status === 'passed',
      pairedDeltaReport: {
        status: 'complete',
        reportDigest: digestJson(pairedDeltaReport),
        pairCount: 1,
        expectedPairCount: 1,
      },
      runs: receipts.map((entry) => ({
        runId: entry.runId,
        status: entry.status,
        semanticEvaluationDigest: entry.semanticEvaluationDigest,
        harnessBehaviorObserved: true,
      })),
    },
    receipts,
    runPlans,
    pairedDeltaReport,
    campaignPath: `artifacts/node-gym/test/campaigns/${plan.campaignId}`,
    runDirectories: Object.fromEntries(
      runPlans.map((runPlan) => [
        runPlan.runId,
        `artifacts/node-gym/test/campaigns/${plan.campaignId}/runs/${runPlan.runId}`,
      ]),
    ),
    matrixRuns: runPlans.map(({ runtimeFixtureDigest: _runtimeFixtureDigest, ...runPlan }) =>
      structuredClone(runPlan),
    ),
  };
}

function input(campaigns) {
  const activeMatrixRuns = [
    ...new Map(
      campaigns
        .flatMap((campaignEntry) => campaignEntry.matrixRuns ?? [])
        .map((runPlan) => [runPlan.runId, runPlan]),
    ).values(),
  ];
  return {
    artifacts: [{ ...artifact, artifactSpec: spec }],
    catalog: {
      atlasVersion: 'artifact-atlas-v2',
      entries: [{ id: artifact.id, artifactSpec: spec, receipt, preview: 'equation.png' }],
    },
    visualInspection: { status: 'passed', atlasPptxSha256: digest },
    sourceAtlasPptxPath: 'atlas-v2.pptx',
    sourceAtlasPptxDigest: `sha256:${digest}`,
    expectedMatrixSize: 360,
    activeMatrixRuns,
    activeConfigDigest,
    activeMatrixDigest,
    campaigns,
    humanPreference: { status: 'not_run' },
  };
}

describe('Artifact Atlas V3 evidence candidate', () => {
  it('binds typed specs, receipts, source deck, and campaign digests', () => {
    const { candidate, lineage } = buildAtlasV3EvidenceCandidate(
      input([campaign('deterministic'), campaign('ui')]),
    );
    expect(lineage[0]).toMatchObject({ specDigestMatches: true, semanticStatus: 'passed' });
    expect(candidate.gates).toMatchObject({
      typedArtifactSpecs: { status: 'passed' },
      deterministicPairedReplay: { status: 'passed' },
      boundedLivePairedEvidence: { status: 'passed' },
      fullMatrix: { status: 'not_run' },
      blindHumanPreference: { status: 'not_run' },
    });
    expect(candidate.publicReleaseApproved).toBe(false);
  });

  it('keeps failed live evidence and human review red', () => {
    const { candidate } = buildAtlasV3EvidenceCandidate(
      input([campaign('deterministic'), campaign('ui', 'provider-error')]),
    );
    expect(candidate.gates.boundedLivePairedEvidence.status).toBe('failed');
    expect(candidate.issues).toEqual(
      expect.arrayContaining([
        'bounded_live_paired_evidence_incomplete',
        'full_matrix_not_run',
        'blind_human_preference_not_run',
      ]),
    );
    expect(candidate.promotionEligible).toBe(false);
  });

  it('emits no fake blind pair when live evidence is degraded', () => {
    const { candidate } = buildAtlasV3EvidenceCandidate(
      input([campaign('deterministic'), campaign('ui', 'provider-error')]),
    );
    const manifest = buildAtlasV3BlindReviewManifest(candidate.campaigns);
    expect(manifest).toMatchObject({
      status: 'insufficient_eligible_pairs',
      eligiblePairCount: 0,
      pairs: [],
      humanReview: { status: 'not_run' },
      promotionEligible: false,
    });
    expect(manifest.calibrationControls[0]?.disposition).toBe(
      'deterministic_control_calibration_only',
    );
  });

  it('does not let a passing campaign from a superseded matrix make the active gate green', () => {
    const stale = campaign('deterministic');
    stale.plan.configDigest = `sha256:${'d'.repeat(64)}`;
    stale.plan.matrixDigest = `sha256:${'e'.repeat(64)}`;
    const current = campaign('deterministic', 'artifact-failure');
    const { candidate } = buildAtlasV3EvidenceCandidate(input([stale, current]));
    expect(candidate.gates.deterministicPairedReplay.status).toBe('failed');
    expect(candidate.campaigns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          campaignId: 'deterministic-pair',
          configurationCompatible: true,
        }),
      ]),
    );
  });

  it('does not let a superseded full-matrix campaign make the active matrix gate green', () => {
    const stale = campaign('ui');
    stale.plan.selection = 'all';
    stale.plan.configDigest = `sha256:${'d'.repeat(64)}`;
    stale.plan.matrixDigest = `sha256:${'e'.repeat(64)}`;
    stale.summary.selectedRunCount = 360;
    stale.summary.passed = 360;
    stale.summary.failed = 0;
    const { candidate } = buildAtlasV3EvidenceCandidate(input([stale]));
    expect(candidate.gates.fullMatrix.status).toBe('not_run');
    expect(candidate.publicReleaseApproved).toBe(false);
  });

  it('rejects an active full-matrix summary with no underlying receipts', () => {
    const forged = campaign('ui');
    forged.plan.selection = 'all';
    forged.plan.fullMatrixExplicitlyConfirmed = true;
    forged.summary.campaignPlanDigest = digestJson(forged.plan);
    forged.receipts = [];
    const forgedInput = input([forged]);
    forgedInput.expectedMatrixSize = 2;
    const { candidate } = buildAtlasV3EvidenceCandidate(forgedInput);
    expect(candidate.gates.fullMatrix.status).toBe('failed');
    expect(candidate.campaigns[0]).toMatchObject({
      evidenceComplete: false,
      passed: 0,
      receiptCount: 0,
      evidenceIssueCodes: expect.arrayContaining([
        'receipt_coverage_mismatch',
        'receipt_binding_invalid',
        'summary_count_mismatch',
      ]),
    });
  });

  it('rejects duplicate receipts even when the summary claims every selected run passed', () => {
    const forged = campaign('deterministic');
    forged.receipts[1] = structuredClone(forged.receipts[0]);
    const { candidate } = buildAtlasV3EvidenceCandidate(input([forged]));
    expect(candidate.gates.deterministicPairedReplay.status).toBe('failed');
    expect(candidate.campaigns[0]).toMatchObject({
      evidenceComplete: false,
      evidenceIssueCodes: expect.arrayContaining(['receipt_coverage_mismatch']),
    });
  });

  it('derives pass counts from receipts and rejects forged summary counts', () => {
    const forged = campaign('deterministic');
    forged.receipts[1].status = 'provider-error';
    forged.receipts[1].automatedHardGatesPassed = false;
    forged.summary.runs[1].status = 'provider-error';
    const { candidate } = buildAtlasV3EvidenceCandidate(input([forged]));
    expect(candidate.gates.deterministicPairedReplay.status).toBe('failed');
    expect(candidate.campaigns[0]).toMatchObject({
      passed: 1,
      failed: 1,
      evidenceComplete: false,
      evidenceIssueCodes: expect.arrayContaining(['summary_count_mismatch']),
    });
  });

  it.each([
    [
      'plan digest',
      (forged) => {
        forged.receipts[0].planDigest = `sha256:${'f'.repeat(64)}`;
      },
    ],
    [
      'returned model',
      (forged) => {
        forged.receipts[0].returnedModel = 'attacker/model';
        forged.receipts[0].actualRoute.actualModel = 'attacker/model';
      },
    ],
    [
      'requested route',
      (forged) => {
        forged.receipts[0].actualRoute.requestedRoute = 'attacker/route';
      },
    ],
    [
      'requested provider',
      (forged) => {
        forged.receipts[0].actualRoute.requestedProvider = 'attacker-provider';
      },
    ],
  ])('rejects substituted receipt %s attribution', (_label, substitute) => {
    const forged = campaign('deterministic');
    substitute(forged);
    const { candidate } = buildAtlasV3EvidenceCandidate(input([forged]));
    expect(candidate.gates.deterministicPairedReplay.status).toBe('failed');
    expect(candidate.campaigns[0]).toMatchObject({
      evidenceComplete: false,
      evidenceIssueCodes: expect.arrayContaining(['receipt_binding_invalid']),
    });
  });

  it('rejects a coordinated run-plan and receipt model substitution against the active matrix', () => {
    const forged = campaign('deterministic');
    const runPlan = forged.runPlans[0];
    runPlan.model = { ...runPlan.model, id: 'attacker/model', route: 'attacker/model' };
    runPlan.harnessPairingKey = runPlan.harnessPairingKey.replace(
      'nodeslide/deterministic-compiler',
      'attacker/model',
    );
    runPlan.pairingKey = runPlan.harnessPairingKey;
    forged.receipts[0] = {
      ...forged.receipts[0],
      planDigest: digestJson(runPlan),
      harnessPairingKey: runPlan.harnessPairingKey,
      pairingKey: runPlan.pairingKey,
      returnedModel: 'attacker/model',
      actualRoute: {
        ...forged.receipts[0].actualRoute,
        requestedRoute: 'attacker/model',
        actualModel: 'attacker/model',
      },
    };
    const { candidate } = buildAtlasV3EvidenceCandidate(input([forged]));
    expect(candidate.gates.deterministicPairedReplay.status).toBe('failed');
    expect(candidate.campaigns[0]).toMatchObject({
      evidenceComplete: false,
      evidenceIssueCodes: expect.arrayContaining(['run_plan_matrix_binding_mismatch']),
    });
  });

  it('accepts an explicitly confirmed full matrix only with exact bound receipt coverage', () => {
    const complete = campaign('ui');
    complete.plan.selection = 'all';
    complete.plan.fullMatrixExplicitlyConfirmed = true;
    complete.summary.campaignPlanDigest = digestJson(complete.plan);
    const completeInput = input([complete]);
    completeInput.expectedMatrixSize = 2;
    const { candidate } = buildAtlasV3EvidenceCandidate(completeInput);
    expect(candidate.gates.fullMatrix.status).toBe('passed');
    expect(candidate.campaigns[0]).toMatchObject({
      evidenceComplete: true,
      selectedRunCount: 2,
      passed: 2,
      receiptCount: 2,
    });
  });

  it('rejects two passing runs that do not share the same immutable pairing identity', () => {
    const unrelated = campaign('deterministic');
    const runPlan = unrelated.runPlans[1];
    runPlan.task = { ...runPlan.task, taskDigest: `sha256:${'9'.repeat(64)}` };
    const budgetKey = '8000:300000:200000:2';
    runPlan.comparisonKey = `${runPlan.task.taskDigest}::${runPlan.task.evidenceDigest}::${runPlan.task.referenceDigest}::1::${budgetKey}`;
    runPlan.harnessPairingKey = `${runPlan.task.taskDigest}::${runPlan.task.evidenceDigest}::${runPlan.task.referenceDigest}::${runPlan.model.id}::1::${budgetKey}`;
    runPlan.pairingKey = runPlan.harnessPairingKey;
    unrelated.receipts[1] = {
      ...unrelated.receipts[1],
      comparisonKey: runPlan.comparisonKey,
      harnessPairingKey: runPlan.harnessPairingKey,
      pairingKey: runPlan.pairingKey,
      planDigest: digestJson(runPlan),
    };
    const { candidate } = buildAtlasV3EvidenceCandidate(input([unrelated]));
    expect(candidate.gates.deterministicPairedReplay.status).toBe('failed');
    expect(candidate.campaigns[0]).toMatchObject({
      evidenceComplete: true,
      pairedEvidenceComplete: false,
      pairedEvidenceIssueCodes: expect.arrayContaining(['distinct_harness_pair_missing']),
    });
  });

  it('rejects duplicate harnesses even when both receipts pass', () => {
    const duplicateHarness = campaign('deterministic');
    duplicateHarness.runPlans[1].harness = structuredClone(duplicateHarness.runPlans[0].harness);
    duplicateHarness.matrixRuns[1].harness = structuredClone(duplicateHarness.runPlans[0].harness);
    duplicateHarness.receipts[1].planDigest = digestJson(duplicateHarness.runPlans[1]);
    const { candidate } = buildAtlasV3EvidenceCandidate(input([duplicateHarness]));
    expect(candidate.gates.deterministicPairedReplay.status).toBe('failed');
    expect(candidate.campaigns[0]).toMatchObject({
      evidenceComplete: true,
      pairedEvidenceComplete: false,
      pairedEvidenceIssueCodes: expect.arrayContaining(['distinct_harness_pair_missing']),
    });
  });

  it.each([
    [
      'missing',
      (forged) => {
        forged.pairedDeltaReport = null;
      },
    ],
    [
      'changed',
      (forged) => {
        forged.pairedDeltaReport.pairCount = 2;
      },
    ],
  ])('rejects a %s paired-delta report', (_label, mutate) => {
    const forged = campaign('deterministic');
    mutate(forged);
    const { candidate } = buildAtlasV3EvidenceCandidate(input([forged]));
    expect(candidate.gates.deterministicPairedReplay.status).toBe('failed');
    expect(candidate.campaigns[0]).toMatchObject({
      pairedEvidenceComplete: false,
      pairedEvidenceIssueCodes: expect.arrayContaining(['paired_delta_report_binding_mismatch']),
    });
  });

  it('does not create blind-review pairs from forged raw receipts', () => {
    const manifest = buildAtlasV3BlindReviewManifest([campaign('ui')]);
    expect(manifest).toMatchObject({
      status: 'insufficient_eligible_pairs',
      eligiblePairCount: 0,
      pairs: [],
    });
  });

  it('uses unambiguous campaign/run-relative paths for validated blind pairs', () => {
    const { candidate } = buildAtlasV3EvidenceCandidate(input([campaign('ui')]));
    const manifest = buildAtlasV3BlindReviewManifest(candidate.campaigns);
    expect(manifest).toMatchObject({ status: 'ready_for_blind_review', eligiblePairCount: 1 });
    expect(manifest.pairs[0].candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          screenshotRelativeToRun: 'ui-0.png',
          screenshot: expect.stringMatching(/\/runs\/ui-0\/ui-0\.png$/u),
          runPath: expect.stringMatching(/\/runs\/ui-0$/u),
        }),
      ]),
    );
  });

  it('rejects ambiguous screenshot traversal from blind review', () => {
    const ambiguous = campaign('ui');
    ambiguous.receipts[0].artifacts.browser.path = '../other-run.png';
    const { candidate } = buildAtlasV3EvidenceCandidate(input([ambiguous]));
    const manifest = buildAtlasV3BlindReviewManifest(candidate.campaigns);
    expect(candidate.gates.boundedLivePairedEvidence.status).toBe('passed');
    expect(manifest).toMatchObject({
      status: 'insufficient_eligible_pairs',
      eligiblePairCount: 0,
      pairs: [],
    });
  });

  it('rejects a receipt that is not exactly bound to the catalog artifact and spec', () => {
    const forged = input([campaign('deterministic')]);
    forged.catalog.entries[0].receipt = structuredClone(receipt);
    forged.catalog.entries[0].receipt.artifactId = 'other-artifact';
    forged.catalog.entries[0].receipt.artifactSpec.payload = { label: 'forged payload' };
    const { candidate, lineage } = buildAtlasV3EvidenceCandidate(forged);
    expect(lineage[0].receiptBindingPassed).toBe(false);
    expect(candidate.gates.specReceiptLineage.status).toBe('failed');
    expect(candidate.issues).toContain('catalog_receipt_binding_mismatch:equation');
  });
});
