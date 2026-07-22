import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { digest } from './lib/artifact-spec-core.mjs';
import {
  auditGeneratedClaims,
  buildNodeGymBlindReviewPacket,
  buildNodeGymCapabilityCards,
  buildNodeGymPairedDeltaReport,
  evaluateEvidenceBoundNodeGymRun,
  validateActualNodeGymRoute,
  validateNodeGymArtifactEvidence,
  validateNodeGymBlindPreference,
} from './lib/node-gym-evaluation-core.mjs';
import {
  compileExecutableNodeGymHarness,
  validateExecutableHarnessProfiles,
} from './lib/node-gym-harness-core.mjs';
import {
  NODE_GYM_TASK_FIXTURE_SCHEMA,
  assertNoProtectedFixtureLeakage,
  assertNoProtectedFixturePlaintext,
  bindNodeGymRunPlanToFixture,
  digestJson,
  filterNodeGymRunsForRuntime,
  loadNodeGymTaskFixture,
  projectNodeGymProtectedFixtureForEgress,
  validateNodeGymTaskFixture,
} from './lib/node-gym-task-core.mjs';
import {
  buildNodeGymTrainingExport,
  validateNodeGymTrainingExport,
} from './lib/node-gym-training-core.mjs';
import { sanitizeNodeGymArtifactShadowReceipt } from './lib/node-gym-ui-shadow-core.mjs';

const config = JSON.parse(
  await readFile(new URL('../benchmarks/deck-gym/v2/gym.json', import.meta.url), 'utf8'),
);
const publicTask = config.tasks.find((task) => task.id === 'public-dominant-visual');
const loadedPublic = loadNodeGymTaskFixture({ task: publicTask });
const publicFixture = loadedPublic.fixture;
const pinnedModel = config.models.find((model) => model.cohort === 'pinned-free');
const harness = config.harnesses.find((entry) => entry.id === 'bounded-executor');
const plan = {
  runId: 'semantic-run-1',
  comparisonKey: 'comparison-1',
  harnessPairingKey: 'harness-pair-1',
  pairingKey: 'harness-pair-1',
  repetition: 1,
  task: {
    id: publicTask.id,
    taskClass: publicTask.taskClass,
    curriculumLevel: publicTask.curriculumLevel,
    pool: publicTask.pool,
  },
  model: pinnedModel,
  harness,
  budget: config.budget,
};

function protectedFixture(task) {
  return {
    schemaVersion: NODE_GYM_TASK_FIXTURE_SCHEMA,
    taskId: task.id,
    taskClass: task.taskClass,
    pool: task.pool,
    brief: 'Use only the runtime-sealed held-out evidence.',
    evidence: {
      sources: [
        {
          id: 'held-out-source',
          title: 'Ephemeral held-out source',
          digest: `sha256:${'a'.repeat(64)}`,
          claimIds: ['held-out-claim'],
        },
      ],
      claims: [
        {
          id: 'held-out-claim',
          text: 'Held-out statement.',
          sourceIds: ['held-out-source'],
        },
      ],
    },
    reference: {
      artifactKind: 'waterfall',
      validator: 'held-out-waterfall-v1',
    },
    governance: {
      consentScope: 'evaluation-only',
      trainingEligible: false,
      retention: 'ephemeral',
      containsPersonalData: false,
    },
  };
}

function validSpec() {
  const spec = {
    schemaVersion: 'nodeslide.artifact-spec/v1',
    id: 'arr-chart',
    kind: 'chart',
    narrativeJob: 'Show the observed ARR result.',
    claimIds: ['arr-claim'],
    sourceIds: ['public-arr-source'],
    provenance: {
      status: 'observed',
      sourceDigest: publicFixture.evidence.sources[0].digest,
      rationale: 'The bounded public fixture supplies this observed value.',
      assumptions: [],
    },
    browserContract: 'semantic-and-visual',
    pptxContract: 'editable-or-declared-fallback',
    accessibility: { summary: 'ARR bar at 42 million dollars.' },
    payload: {
      unit: 'USDm',
      xAxis: { labels: ['ARR'] },
      yAxis: { min: 0, max: 50 },
      series: [{ id: 'arr', values: [42] }],
    },
  };
  return { ...spec, specDigest: digest(spec) };
}

function artifactEvidence(spec, sourceRunDigest = `sha256:${'9'.repeat(64)}`) {
  const specDigest = `sha256:${spec.specDigest}`;
  const file = (kind, extra = {}) => ({
    path: `${kind}.png`,
    digest: `sha256:${kind.charCodeAt(0).toString(16).padStart(2, '0').repeat(32)}`,
    bytes: 128,
    validation: { status: 'passed' },
    sourceRunDigest,
    ...extra,
  });
  return {
    browser: file('browser', { slideCount: 1 }),
    pptx: file('pptx', { slideCount: 1 }),
    pdf: file('pdf', { pageCount: 1 }),
    montage: file('montage', { slideCount: 1 }),
    slides: [file('slide', { slideIndex: 1, specDigest })],
    sourceLineage: [
      {
        claimId: 'arr-claim',
        sourceId: 'public-arr-source',
        slideIndex: 1,
        specDigest,
        sourceRunDigest,
      },
    ],
  };
}

function validResult(spec, compiledHarness) {
  return {
    route: {
      requestedRoute: pinnedModel.route,
      actualProvider: 'openrouter',
      actualModel: pinnedModel.route,
      responseId: 'response-123',
    },
    normalizedSpec: spec,
    specFactBindings: [{ factId: 'arr-value', path: '/payload/series/0/values/0', unit: 'USDm' }],
    generatedClaims: [
      {
        claimId: 'arr-claim',
        text: 'ARR reached $42M.',
        sourceIds: ['public-arr-source'],
        numericFacts: [{ factId: 'arr-value', value: 42, unit: 'USDm' }],
      },
    ],
    sourceRunDigest: `sha256:${'9'.repeat(64)}`,
    expectedSlideCount: 1,
    briefCoverage: ['arr', 'unit'],
    story: { beats: [{ id: 'result' }, { id: 'implication' }] },
    compiledHarness,
    harnessExecution: {
      observed: true,
      profileId: plan.harness.id,
      profileVersion: plan.harness.version,
      traceDigest: digestJson({ runId: plan.runId, profile: plan.harness.id }),
    },
    toolTrace: {
      calls: [
        { toolId: 'compile_artifact', validation: { status: 'passed' } },
        { toolId: 'validate_artifact_spec', validation: { status: 'passed' } },
      ],
    },
    repairTrace: { attempts: [] },
    renderDiagnostics: {
      overflowCount: 0,
      overlapCount: 0,
      placeholderCount: 0,
      minimumContrastPassed: true,
      distinctVisualKinds: 1,
      pptxEditableObjectRatio: 1,
    },
  };
}

describe('NodeGym bounded task fixtures', () => {
  it('covers curriculum levels 1 through 8 without committed protected payloads', () => {
    expect(config.tasks.map((task) => task.curriculumLevel).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(config.expectedMatrixSize).toBe(720);
    expect(assertNoProtectedFixturePlaintext(config)).toEqual({
      ok: true,
      issueCodes: [],
    });
  });

  it('loads a bounded public fixture and freezes the result', () => {
    expect(validateNodeGymTaskFixture(publicTask, publicFixture).ok).toBe(true);
    expect(loadedPublic.fixtureDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(Object.isFrozen(loadedPublic.fixture)).toBe(true);
  });

  it('defaults to public-only runs when protected runtime fixtures are absent', () => {
    const candidateRuns = config.tasks.map((task) => ({
      task: { id: task.id },
    }));
    const available = filterNodeGymRunsForRuntime({
      runs: candidateRuns,
      tasks: config.tasks,
      runtime: {},
    });
    expect(available.map((run) => run.task.id)).toEqual(
      config.tasks.filter((task) => task.pool === 'public-development').map((task) => task.id),
    );
    expect(
      filterNodeGymRunsForRuntime({
        runs: candidateRuns,
        tasks: config.tasks,
        runtime: {},
        explicitTaskIds: ['hidden-waterfall'],
      }),
    ).toHaveLength(candidateRuns.length);
  });

  it('requires both runtime content and a matching digest for held-out pools', () => {
    const task = config.tasks.find((entry) => entry.id === 'hidden-waterfall');
    const fixture = protectedFixture(task);
    const serialized = JSON.stringify(fixture);
    const runtime = {
      [task.fixture.payloadEnv]: serialized,
      [task.fixture.digestEnv]: digestJson(fixture),
    };
    expect(loadNodeGymTaskFixture({ task, runtime })).toMatchObject({
      protected: true,
      evidenceDigest: expect.stringMatching(/^sha256:/u),
    });
    expect(() =>
      loadNodeGymTaskFixture({
        task,
        runtime: {
          ...runtime,
          [task.fixture.digestEnv]: `sha256:${'0'.repeat(64)}`,
        },
      }),
    ).toThrow(/digest check/u);
    const hiddenPlan = {
      ...plan,
      task: {
        ...plan.task,
        id: task.id,
        taskClass: task.taskClass,
        curriculumLevel: task.curriculumLevel,
        pool: task.pool,
      },
    };
    const bound = bindNodeGymRunPlanToFixture(
      hiddenPlan,
      loadNodeGymTaskFixture({ task, runtime }),
    );
    expect(bound.task.evidenceDigest).toBe(digestJson(fixture.evidence));
    expect(bound.comparisonKey).toContain(bound.task.evidenceDigest);
    expect(bound.harnessPairingKey).toBe(
      [
        bound.task.taskDigest,
        bound.task.evidenceDigest,
        bound.task.referenceDigest,
        hiddenPlan.model.id,
        hiddenPlan.repetition,
        [
          hiddenPlan.budget.maxTokens,
          hiddenPlan.budget.maxLatencyMs,
          hiddenPlan.budget.maxCostMicroUsd,
          hiddenPlan.budget.maxRepairs,
        ].join(':'),
      ].join('::'),
    );
  });

  it('recursively rejects protected plaintext and permits only digest-bound sanitized egress', () => {
    const task = config.tasks.find((entry) => entry.id === 'hidden-waterfall');
    const unsafeConfig = {
      tasks: [
        {
          ...task,
          fixture: {
            ...task.fixture,
            metadata: { brief: 'committed protected content' },
          },
        },
      ],
    };
    expect(assertNoProtectedFixturePlaintext(unsafeConfig).ok).toBe(false);

    const fixture = protectedFixture(task);
    fixture.governance = {
      ...fixture.governance,
      uiEgressAllowed: true,
      egressPolicy: 'sanitized-projection-only',
    };
    fixture.sanitizedEgress = {
      schemaVersion: 'nodekit.gym-sanitized-egress/v1',
      brief: 'Build the approved evaluation summary.',
      sources: [
        {
          id: 'approved-source-alias',
          title: 'Approved source alias',
          digest: `sha256:${'c'.repeat(64)}`,
          claimIds: ['approved-claim-alias'],
        },
      ],
      claims: [
        {
          id: 'approved-claim-alias',
          text: 'Approved summary statement.',
          sourceIds: ['approved-source-alias'],
        },
      ],
      reference: {
        artifactKind: 'waterfall',
        validator: 'approved-projection-v1',
      },
    };
    fixture.governance.sanitizedEgressDigest = digestJson(fixture.sanitizedEgress);
    const runtime = {
      [task.fixture.payloadEnv]: JSON.stringify(fixture),
      [task.fixture.digestEnv]: digestJson(fixture),
    };
    const loaded = loadNodeGymTaskFixture({ task, runtime });
    const projection = projectNodeGymProtectedFixtureForEgress(loaded);
    expect(JSON.stringify(projection)).not.toContain('Held-out statement.');
    expect(assertNoProtectedFixtureLeakage(projection, loaded)).toMatchObject({
      ok: true,
    });
    expect(assertNoProtectedFixtureLeakage({ nested: fixture.brief }, loaded).ok).toBe(false);

    const overlapping = structuredClone(fixture);
    overlapping.sanitizedEgress.claims[0].text = fixture.evidence.claims[0].text;
    overlapping.governance.sanitizedEgressDigest = digestJson(overlapping.sanitizedEgress);
    const overlappingRuntime = {
      [task.fixture.payloadEnv]: JSON.stringify(overlapping),
      [task.fixture.digestEnv]: digestJson(overlapping),
    };
    expect(() =>
      projectNodeGymProtectedFixtureForEgress(
        loadNodeGymTaskFixture({ task, runtime: overlappingRuntime }),
      ),
    ).toThrow(/overlaps raw protected context/u);
  });
});

describe('NodeGym executable harness profiles', () => {
  it('compiles all five profiles into distinct tool, schema, context, and repair behavior', () => {
    expect(validateExecutableHarnessProfiles(config)).toEqual({
      ok: true,
      issueCodes: [],
    });
    const compiled = config.harnesses.map((profile) =>
      compileExecutableNodeGymHarness({
        plan: { ...plan, harness: profile },
        fixture: publicFixture,
      }),
    );
    expect(new Set(compiled.map((entry) => entry.harnessDigest))).toHaveLength(5);
    expect(new Set(compiled.map((entry) => entry.responseKind))).toHaveLength(5);
    expect(compiled.find((entry) => entry.profileId === 'repair-specialist')).toMatchObject({
      repairWorkflow: {
        maxAttempts: 1,
        onFailure: 'fail-closed-no-regeneration',
      },
    });
    expect(compiled.find((entry) => entry.profileId === 'router-robustness')).toMatchObject({
      routeContract: { actualModelRequired: true },
    });
  });
});

describe('NodeGym evidence-bound evaluation', () => {
  it('whitelists only a passing anonymized, non-mutating ArtifactSpec shadow receipt', () => {
    const sensitiveDeckId = 'deck-sensitive-id';
    const sensitiveOwnerKey = 'owner-sensitive-key';
    const sanitized = sanitizeNodeGymArtifactShadowReceipt({
      schemaVersion: 'nodeslide.artifact-shadow-receipt/v1',
      status: 'passed',
      userVisible: false,
      mutationApplied: false,
      anonymized: true,
      artifactCount: 3,
      coveredElementCount: 8,
      authoredBindingCount: 4,
      canonicalArtifactCount: 2,
      canonicalKindCounts: [
        { kind: 'chart', count: 1 },
        { kind: 'graph', count: 1 },
      ],
      canonicalArtifacts: [
        { kind: 'chart', specDigest: '6'.repeat(64), bindingDigest: '7'.repeat(64) },
        { kind: 'graph', specDigest: '8'.repeat(64), bindingDigest: '9'.repeat(64) },
      ],
      preservedIntentDigest: '5'.repeat(64),
      issueCodes: [],
      deckBindingDigest: '1'.repeat(64),
      compilationReceiptDigest: '2'.repeat(64),
      specSetDigest: '3'.repeat(64),
      receiptDigest: '4'.repeat(64),
      deckId: sensitiveDeckId,
      ownerAccessKey: sensitiveOwnerKey,
    });
    expect(sanitized).toMatchObject({
      status: 'passed',
      artifactCount: 3,
      authoredBindingCount: 4,
      canonicalArtifactCount: 2,
      userVisible: false,
      mutationApplied: false,
    });
    expect(JSON.stringify(sanitized)).not.toContain(sensitiveDeckId);
    expect(JSON.stringify(sanitized)).not.toContain(sensitiveOwnerKey);
    expect(
      sanitizeNodeGymArtifactShadowReceipt({
        ...sanitized,
        schemaVersion: 'nodeslide.artifact-shadow-receipt/v1',
        mutationApplied: true,
      }),
    ).toMatchObject({
      status: 'failed',
      issueCode: 'typed_artifact_spec_not_observed',
    });
    expect(
      sanitizeNodeGymArtifactShadowReceipt({
        ...sanitized,
        schemaVersion: 'nodeslide.artifact-shadow-receipt/v1',
        canonicalArtifacts: [...sanitized.canonicalArtifacts].reverse(),
      }),
    ).toMatchObject({
      status: 'failed',
      issueCode: 'typed_artifact_spec_not_observed',
    });
  });

  it('fails a random-router alias that does not identify its actual upstream model', () => {
    const random = config.models.find((model) => model.cohort === 'random-router');
    expect(
      validateActualNodeGymRoute(
        { ...plan, model: random },
        {
          requestedRoute: random.route,
          actualProvider: 'openrouter',
          actualModel: random.route,
          responseId: 'response-random',
        },
      ).issueCodes,
    ).toContain('random_router_upstream_unresolved');
  });

  it('rejects an invented number even when the claim ID and source are valid', () => {
    expect(
      auditGeneratedClaims(publicFixture, [
        {
          claimId: 'arr-claim',
          text: 'ARR reached $43M.',
          sourceIds: ['public-arr-source'],
          numericFacts: [{ factId: 'arr-value', value: 43, unit: 'USDm' }],
        },
      ]).issueCodes,
    ).toEqual(
      expect.arrayContaining(['claim_rendering_not_approved', 'numeric_claim_value_mismatch']),
    );
  });

  it('requires every fixture claim instead of accepting a supported subset', () => {
    const fixture = structuredClone(publicFixture);
    fixture.evidence.claims.push({
      id: 'second-required-claim',
      text: 'A second approved statement.',
      sourceIds: ['public-arr-source'],
    });
    expect(
      auditGeneratedClaims(fixture, [
        {
          claimId: 'arr-claim',
          text: 'ARR reached $42M.',
          sourceIds: ['public-arr-source'],
          numericFacts: [{ factId: 'arr-value', value: 42, unit: 'USDm' }],
        },
      ]).issueCodes,
    ).toContain('required_fixture_claim_missing');
  });

  it('binds browser, per-slide, montage, PPTX, PDF, spec, and source lineage to one run', () => {
    const spec = validSpec();
    const artifacts = artifactEvidence(spec);
    expect(
      validateNodeGymArtifactEvidence({
        artifacts,
        expectedSlideCount: 1,
        sourceRunDigest: `sha256:${'9'.repeat(64)}`,
        expectedSpecDigest: `sha256:${spec.specDigest}`,
        allowedClaimIds: ['arr-claim'],
        allowedSourceIds: ['public-arr-source'],
      }),
    ).toMatchObject({ ok: true, issueCodes: [] });
    expect(
      validateNodeGymArtifactEvidence({
        artifacts: { ...artifacts, pdf: { ...artifacts.pdf, pageCount: 2 } },
        expectedSlideCount: 1,
        sourceRunDigest: `sha256:${'9'.repeat(64)}`,
        expectedSpecDigest: `sha256:${spec.specDigest}`,
        allowedClaimIds: ['arr-claim'],
        allowedSourceIds: ['public-arr-source'],
      }).issueCodes,
    ).toContain('cross_format_page_count_mismatch');
  });

  it('produces measured scores but leaves visual preference unscored until blind review', () => {
    const spec = validSpec();
    const compiledHarness = compileExecutableNodeGymHarness({
      plan,
      fixture: publicFixture,
    });
    const evaluation = evaluateEvidenceBoundNodeGymRun({
      plan,
      fixture: publicFixture,
      result: validResult(spec, compiledHarness),
      artifacts: artifactEvidence(spec),
    });
    expect(evaluation).toMatchObject({
      status: 'passed',
      hardGatesPassed: true,
      promotionReady: false,
      scores: {
        factualAccuracy: 1,
        exportFidelity: 1,
        visualStructuralQuality: 1,
        visualPreference: null,
      },
    });
    expect(evaluation.scores).not.toHaveProperty('briefCoverageEvidence');
  });

  it('does not treat deterministic prompt-only output as observed harness behavior', () => {
    const spec = validSpec();
    const compiledHarness = compileExecutableNodeGymHarness({
      plan,
      fixture: publicFixture,
    });
    const evaluation = evaluateEvidenceBoundNodeGymRun({
      plan,
      fixture: publicFixture,
      result: {
        ...validResult(spec, compiledHarness),
        harnessExecution: {
          observed: false,
          profileId: plan.harness.id,
          profileVersion: plan.harness.version,
          traceDigest: digestJson({ deterministicControl: true }),
        },
      },
      artifacts: artifactEvidence(spec),
    });
    expect(evaluation).toMatchObject({
      status: 'failed',
      hardGatesPassed: false,
    });
    expect(evaluation.issueCodes).toContain('harness_behavior_not_observed');
  });
});

describe('NodeGym comparison and review artifacts', () => {
  function evaluations() {
    const spec = validSpec();
    const compiledHarness = compileExecutableNodeGymHarness({
      plan,
      fixture: publicFixture,
    });
    const champion = evaluateEvidenceBoundNodeGymRun({
      plan,
      fixture: publicFixture,
      result: validResult(spec, compiledHarness),
      artifacts: artifactEvidence(spec),
    });
    const challenger = {
      ...champion,
      runId: 'semantic-run-2',
      requestedModel: 'challenger/model',
      actualRoute: { ...champion.actualRoute, actualModel: 'challenger/model' },
      sourceRunDigest: `sha256:${'8'.repeat(64)}`,
      scores: {
        ...champion.scores,
        storyQuality: 0.8,
        visualStructuralQuality: 0.8,
      },
      artifacts: artifactEvidence(spec, `sha256:${'8'.repeat(64)}`),
    };
    return { champion, challenger };
  }

  it('computes matched deltas and confidence without mixing fixture lineages', () => {
    const first = evaluations();
    const second = evaluations();
    second.champion = { ...second.champion, runId: 'semantic-run-3' };
    second.challenger = { ...second.challenger, runId: 'semantic-run-4' };
    const report = buildNodeGymPairedDeltaReport({
      pairs: [first, second].map((pair, index) => ({
        ...pair,
        pairId: `pair-${index}`,
        kind: 'model',
      })),
      dimensions: ['storyQuality'],
    });
    expect(report).toMatchObject({ ok: true, pairCount: 2 });
    expect(report.dimensions.storyQuality).toMatchObject({ sampleSize: 2 });
    expect(report.dimensions.storyQuality.mean).toBeCloseTo(-0.2);
    expect(report.dimensions.storyQuality.confidence95).not.toBeNull();
  });

  it('builds capability cards and a model-blind review packet with a separate key', () => {
    const pair = evaluations();
    const cards = buildNodeGymCapabilityCards([pair.champion, pair.challenger]);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      confidence: {
        method: 'wilson-score',
        level: 0.95,
        status: 'provisional-low-sample',
      },
      eligibleRoles: [],
      avoidRoles: [publicTask.taskClass],
      roleEvidence: { personalityClaimsAllowed: false },
    });
    const { packet, packetDigest, assetManifest, assetManifestDigest, confidentialKey } =
      buildNodeGymBlindReviewPacket({
        pairs: [{ ...pair, pairId: 'blind-pair' }],
        blindingSalt: 'runtime-only-blinding-salt',
        reviewSessionId: 'review-session-opaque-1',
      });
    const publicJson = JSON.stringify(packet);
    expect(publicJson).not.toContain(pinnedModel.route);
    expect(publicJson).not.toContain('bounded-executor');
    expect(publicJson).not.toContain('semantic-run-1');
    expect(JSON.stringify(assetManifest)).not.toContain('.png');
    expect(assetManifest.assets).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'montage' })]),
    );
    expect(confidentialKey.mappings).toEqual(
      expect.arrayContaining([expect.objectContaining({ runId: 'semantic-run-1' })]),
    );
    const reviews = packet.cases.map((reviewCase) => ({
      caseId: reviewCase.caseId,
      winnerCandidateId: reviewCase.candidates[0].candidateId,
      rubricVersion: 'node-gym-visual-rubric/v1',
    }));
    const response = {
      schemaVersion: 'nodekit.gym-blind-preference/v1',
      reviewSessionId: packet.reviewSessionId,
      packetDigest,
      assetManifestDigest,
      reviewerIdentityDigest: `sha256:${'d'.repeat(64)}`,
      reviews,
    };
    expect(
      validateNodeGymBlindPreference({
        packet,
        packetDigest,
        assetManifest,
        assetManifestDigest,
        response,
      }),
    ).toMatchObject({
      ok: true,
      receipt: { reviewerIdentityDigest: response.reviewerIdentityDigest },
    });
    expect(
      validateNodeGymBlindPreference({
        packet,
        packetDigest,
        assetManifest,
        assetManifestDigest,
        response: { ...response, reviewerIdentityDigest: 'anonymous' },
      }).issueCodes,
    ).toContain('blind_reviewer_identity_invalid');
  });
});

describe('NodeGym training export governance', () => {
  it('redacts configured secrets and personal data while retaining provenance/deletion lineage', () => {
    const spec = validSpec();
    const receipt = {
      runId: plan.runId,
      comparisonKey: plan.comparisonKey,
      harnessPairingKey: plan.harnessPairingKey,
      status: 'passed',
      hardGatesPassed: true,
      promotionReady: true,
      actualRoute: { actualModel: plan.model.id },
    };
    const ownerCapability = 'N'.repeat(43);
    const exported = buildNodeGymTrainingExport({
      plan,
      fixture: publicFixture,
      receipt,
      redactionTokens: ['private-token-value'],
      episode: {
        taskState: `Contact owner@example.com with private-token-value or ${ownerCapability}.`,
        boundedContext: { claimIds: ['arr-claim'] },
        toolCalls: [],
        validationFeedback: [],
        repairs: [],
        acceptedArtifact: {
          ...spec,
          metadata: {
            ownerAccessKey: ownerCapability,
            credentials: { password: 'nested-password-value' },
          },
        },
      },
    });
    expect(JSON.stringify(exported)).not.toContain('owner@example.com');
    expect(JSON.stringify(exported)).not.toContain('private-token-value');
    expect(JSON.stringify(exported)).not.toContain(ownerCapability);
    expect(JSON.stringify(exported)).not.toContain('nested-password-value');
    expect(exported.sourceLineage).toEqual([publicFixture.evidence.sources[0].digest]);
    expect(exported.governance.deletionLineage).toEqual([
      {
        sourceDigest: publicFixture.evidence.sources[0].digest,
        status: 'active',
        deletionRequestId: null,
      },
    ]);
    expect(exported.validation.redactions.length).toBeGreaterThanOrEqual(5);
    expect(exported.validation.redactions).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'credential-key' })]),
    );
  });

  it('refuses hidden reasoning, holdout contamination, deleted sources, and protected pools', () => {
    const receipt = {
      runId: plan.runId,
      comparisonKey: plan.comparisonKey,
      harnessPairingKey: plan.harnessPairingKey,
      status: 'passed',
      hardGatesPassed: true,
      promotionReady: true,
    };
    const candidate = {
      provenance: [
        {
          sourceDigest: publicFixture.evidence.sources[0].digest,
          license: 'CC0-1.0',
          consentScope: 'training-approved',
          trainingUseAllowed: true,
        },
      ],
      chainOfThought: 'must never be exported',
      governance: {
        deletionLineage: [publicFixture.evidence.sources[0].digest],
        excludesHiddenReasoning: true,
      },
    };
    expect(
      validateNodeGymTrainingExport({
        plan,
        fixture: publicFixture,
        receipt,
        candidate,
        holdoutDigests: [publicFixture.evidence.sources[0].digest],
        deletedSourceDigests: [publicFixture.evidence.sources[0].digest],
      }).issueCodes,
    ).toEqual(
      expect.arrayContaining([
        'hidden_reasoning_present',
        'training_holdout_source_contamination',
        'training_deleted_source_present',
      ]),
    );
    expect(
      validateNodeGymTrainingExport({
        plan,
        fixture: publicFixture,
        receipt,
        candidate,
        holdoutDigests: ['not-a-digest'],
        existingTrainingDigests: ['also-invalid'],
        deletedSourceDigests: ['still-invalid'],
      }).issueCodes,
    ).toEqual(
      expect.arrayContaining([
        'training_holdout_digest_invalid',
        'training_existing_digest_invalid',
        'training_deleted_digest_invalid',
        'training_candidate_schema_invalid',
        'training_candidate_identity_mismatch',
        'training_deletion_lineage_invalid',
      ]),
    );
    expect(
      validateNodeGymTrainingExport({
        plan,
        fixture: publicFixture,
        receipt: { ...receipt, promotionReady: undefined },
        candidate,
      }).issueCodes,
    ).toContain('training_human_review_incomplete');

    const hiddenTask = config.tasks.find((task) => task.id === 'hidden-waterfall');
    expect(
      validateNodeGymTrainingExport({
        plan: {
          ...plan,
          task: { ...plan.task, id: hiddenTask.id, pool: hiddenTask.pool },
        },
        fixture: protectedFixture(hiddenTask),
        receipt,
        candidate,
      }).issueCodes,
    ).toContain('training_pool_not_public');
  });
});
