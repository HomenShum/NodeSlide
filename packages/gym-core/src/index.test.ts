import { describe, expect, it } from 'vitest';
import {
  NODE_GYM_CORE_PACKAGE_VERSION,
  NODE_GYM_RUNNER_RECEIPT_SCHEMA_VERSION,
  NODE_GYM_SCHEMA_VERSION,
  adaptNodeGymRunnerReceipt,
  assertPairedModelRuns,
  buildNodeGymMatrix,
  exportNodeGymTrainingEpisode,
  proposeNodeGymPromotion,
  selectNodeGymShadowRoute,
} from './index';

describe('@nodekit/gym-core package boundary', () => {
  it('exports versioned, dependency-free experiment and shadow-routing contracts', () => {
    expect(NODE_GYM_CORE_PACKAGE_VERSION).toBe('0.1.0');
    expect(NODE_GYM_SCHEMA_VERSION).toBe('nodekit.gym/v1');

    const plans = buildNodeGymMatrix({
      tasks: [
        {
          id: 'frame-evidence',
          taskClass: 'nodeagent-frame-verification',
          curriculumLevel: 2,
          pool: 'public-development',
          taskDigest: 'task',
          evidenceDigest: 'evidence',
          referenceDigest: 'reference',
        },
      ],
      models: [
        {
          id: 'control',
          provider: 'local',
          route: 'deterministic',
          returnedModelRequired: false,
          cohort: 'control',
        },
      ],
      harnesses: [
        {
          id: 'verified-frame',
          version: '1',
          weight: 'structured',
          role: 'frame-verifier',
          contextStrategy: 'bounded-frame',
          toolIds: ['verify-frame'],
          repairPolicy: 'review-required',
        },
      ],
      budget: {
        maxTokens: 1_000,
        maxLatencyMs: 10_000,
        maxCostMicroUsd: 0,
        maxRepairs: 1,
      },
      repetitions: 2,
    });

    expect(plans).toHaveLength(2);
    expect(plans[0]?.comparisonKey).toBe('task::evidence::reference::1::1000:10000:0:1');
    expect(plans[0]?.harnessPairingKey).toBe(
      'task::evidence::reference::control::1::1000:10000:0:1',
    );
    expect(plans[0]?.pairingKey).toBe(plans[0]?.harnessPairingKey);
    expect(
      selectNodeGymShadowRoute({
        taskClass: 'nodeagent-frame-verification',
        champions: [],
        fallback: { model: 'control', harness: 'verified-frame' },
      }),
    ).toEqual({
      mode: 'fallback',
      model: 'control',
      harness: 'verified-frame',
      userVisible: false,
    });
  });

  it('redacts bare NodeSlide capabilities and nested credential-named fields from training rows', () => {
    const digest = (character: string) => `sha256:${character.repeat(64)}`;
    const [plan] = buildNodeGymMatrix({
      tasks: [
        {
          id: 'training-redaction',
          taskClass: 'artifact-spec',
          curriculumLevel: 2,
          pool: 'public-development',
          taskDigest: digest('a'),
          evidenceDigest: digest('b'),
          referenceDigest: digest('c'),
        },
      ],
      models: [
        {
          id: 'control',
          provider: 'local',
          route: 'deterministic',
          returnedModelRequired: false,
          cohort: 'control',
        },
      ],
      harnesses: [
        {
          id: 'structured',
          version: '1',
          weight: 'structured',
          role: 'executor',
          contextStrategy: 'bounded',
          toolIds: [],
          repairPolicy: 'typed',
        },
      ],
      budget: {
        maxTokens: 100,
        maxLatencyMs: 1_000,
        maxCostMicroUsd: 0,
        maxRepairs: 1,
      },
      repetitions: 1,
    });
    if (!plan) throw new Error('Expected a training plan.');
    const scores = {
      briefAdherence: 1,
      storyQuality: 1,
      visualPreference: 1,
      factualAccuracy: 1,
      toolReliability: 1,
      exportFidelity: 1,
      repairSuccess: 1,
      editability: 1,
    };
    const receipt = adaptNodeGymRunnerReceipt({
      plan,
      scores,
      runnerReceipt: {
        schemaVersion: NODE_GYM_RUNNER_RECEIPT_SCHEMA_VERSION,
        runId: plan.runId,
        comparisonKey: plan.comparisonKey,
        harnessPairingKey: plan.harnessPairingKey,
        pairingKey: plan.pairingKey,
        repetition: plan.repetition,
        status: 'passed',
        automatedHardGatesPassed: true,
        issueCodes: [],
        usage: {
          latencyMs: 10,
          inputTokens: 1,
          outputTokens: 1,
          costMicroUsd: 0,
          repairCount: 0,
        },
      },
    });
    const capability = 'A'.repeat(43);
    const exported = exportNodeGymTrainingEpisode({
      plan,
      receipt,
      governance: {
        consentScope: 'training-approved',
        trainingEligible: true,
        containsPersonalData: false,
        humanReviewComplete: true,
        promotionReady: true,
        sources: [
          {
            sourceId: 'public-source',
            sourceDigest: digest('d'),
            license: 'CC0-1.0',
            consentScope: 'training-approved',
            trainingUseAllowed: true,
          },
        ],
      },
      taskState: `owner capability ${capability}`,
      boundedContext: {},
      toolCalls: [],
      validationFeedback: [],
      repairs: [],
      acceptedArtifact: {
        metadata: {
          ownerAccessKey: capability,
          credentials: { password: 'nested-password-value' },
        },
      },
    });
    const serialized = JSON.stringify(exported);
    expect(serialized).not.toContain(capability);
    expect(serialized).not.toContain('nested-password-value');
    expect(exported.governance.redactionCount).toBeGreaterThanOrEqual(3);
  });

  it('separates model comparison from exact harness pairing', () => {
    const [championPlan, challengerPlan] = buildNodeGymMatrix({
      tasks: [
        {
          id: 'equation',
          taskClass: 'equation',
          curriculumLevel: 3,
          pool: 'public-development',
          taskDigest: 'task',
          evidenceDigest: 'evidence',
          referenceDigest: 'reference',
        },
      ],
      models: [
        {
          id: 'champion',
          provider: 'local',
          route: 'champion',
          returnedModelRequired: false,
          cohort: 'control',
        },
        {
          id: 'challenger',
          provider: 'local',
          route: 'challenger',
          returnedModelRequired: false,
          cohort: 'control',
        },
      ],
      harnesses: [
        {
          id: 'same-harness',
          version: '1',
          weight: 'structured',
          role: 'executor',
          contextStrategy: 'bounded',
          toolIds: [],
          repairPolicy: 'none',
        },
      ],
      budget: {
        maxTokens: 1000,
        maxLatencyMs: 10000,
        maxCostMicroUsd: 0,
        maxRepairs: 0,
      },
      repetitions: 1,
    });
    if (!championPlan || !challengerPlan) throw new Error('Expected two model plans.');
    expect(championPlan.comparisonKey).toBe(challengerPlan.comparisonKey);
    expect(championPlan.harnessPairingKey).not.toBe(challengerPlan.harnessPairingKey);
    assertPairedModelRuns(championPlan, challengerPlan);

    const scores = {
      briefAdherence: 1,
      storyQuality: 1,
      visualPreference: 1,
      factualAccuracy: 1,
      toolReliability: 1,
      exportFidelity: 1,
      repairSuccess: 1,
      editability: 1,
    };
    const receipt = (plan: typeof championPlan, latencyMs: number) =>
      adaptNodeGymRunnerReceipt({
        plan,
        scores,
        runnerReceipt: {
          schemaVersion: NODE_GYM_RUNNER_RECEIPT_SCHEMA_VERSION,
          runId: plan.runId,
          comparisonKey: plan.comparisonKey,
          harnessPairingKey: plan.harnessPairingKey,
          pairingKey: plan.harnessPairingKey,
          repetition: plan.repetition,
          status: 'passed',
          automatedHardGatesPassed: true,
          issueCodes: [],
          usage: {
            latencyMs,
            inputTokens: 10,
            outputTokens: 10,
            costMicroUsd: 0,
            repairCount: 0,
          },
        },
      });
    const champion = receipt(championPlan, 2000);
    const challenger = receipt(challengerPlan, 1000);
    expect(champion.pairingKey).not.toBe(challenger.pairingKey);
    expect(
      proposeNodeGymPromotion({
        champion: [champion],
        challenger: [challenger],
        humanPreferencesComplete: true,
        challengerPreferenceWins: 1,
        policy: {
          minimumMatchedCases: 1,
          minimumPreferenceWinRate: 0.5,
          minimumMeanUtilityDelta: 0,
          maximumDimensionRegression: 0,
          minimumStableRepetitions: 1,
          requiresHumanReview: true,
          autoApply: false,
        },
      }),
    ).toMatchObject({ matchedCases: 1, decision: 'recommend-promotion' });
  });

  it('rejects a runner receipt that conflicts with its immutable plan', () => {
    const plan = buildNodeGymMatrix({
      tasks: [
        {
          id: 't',
          taskClass: 'equation',
          curriculumLevel: 1,
          pool: 'public-development',
          taskDigest: 't',
          evidenceDigest: 'e',
          referenceDigest: 'r',
        },
      ],
      models: [
        {
          id: 'm',
          provider: 'local',
          route: 'm',
          returnedModelRequired: false,
          cohort: 'control',
        },
      ],
      harnesses: [
        {
          id: 'h',
          version: '1',
          weight: 'light',
          role: 'r',
          contextStrategy: 'c',
          toolIds: [],
          repairPolicy: 'none',
        },
      ],
      budget: {
        maxTokens: 1,
        maxLatencyMs: 1,
        maxCostMicroUsd: 0,
        maxRepairs: 0,
      },
      repetitions: 1,
    })[0];
    if (!plan) throw new Error('Expected plan.');
    expect(() =>
      adaptNodeGymRunnerReceipt({
        plan,
        scores: {
          briefAdherence: 1,
          storyQuality: 1,
          visualPreference: 1,
          factualAccuracy: 1,
          toolReliability: 1,
          exportFidelity: 1,
          repairSuccess: 1,
          editability: 1,
        },
        runnerReceipt: {
          schemaVersion: NODE_GYM_RUNNER_RECEIPT_SCHEMA_VERSION,
          runId: plan.runId,
          pairingKey: 'wrong',
          repetition: 1,
          status: 'passed',
          automatedHardGatesPassed: true,
          issueCodes: [],
          usage: {
            latencyMs: 1,
            inputTokens: 0,
            outputTokens: 0,
            costMicroUsd: 0,
            repairCount: 0,
          },
        },
      }),
    ).toThrow('harness pairing key');
  });

  it('matches every harness independently and requires passing champion cohorts', () => {
    const plans = buildNodeGymMatrix({
      tasks: [
        {
          id: 'multi-harness',
          taskClass: 'artifact',
          curriculumLevel: 4,
          pool: 'public-development',
          taskDigest: 'task',
          evidenceDigest: 'evidence',
          referenceDigest: 'reference',
        },
      ],
      models: [
        {
          id: 'champion',
          provider: 'local',
          route: 'champion',
          returnedModelRequired: false,
          cohort: 'control',
        },
        {
          id: 'challenger',
          provider: 'local',
          route: 'challenger',
          returnedModelRequired: false,
          cohort: 'control',
        },
      ],
      harnesses: [
        {
          id: 'light',
          version: '1',
          weight: 'light',
          role: 'executor',
          contextStrategy: 'bounded',
          toolIds: [],
          repairPolicy: 'none',
        },
        {
          id: 'heavy',
          version: '1',
          weight: 'heavy',
          role: 'executor',
          contextStrategy: 'bounded',
          toolIds: [],
          repairPolicy: 'typed',
        },
      ],
      budget: {
        maxTokens: 100,
        maxLatencyMs: 1000,
        maxCostMicroUsd: 0,
        maxRepairs: 1,
      },
      repetitions: 2,
    });
    const scores = {
      briefAdherence: 1,
      storyQuality: 1,
      visualPreference: 1,
      factualAccuracy: 1,
      toolReliability: 1,
      exportFidelity: 1,
      repairSuccess: 1,
      editability: 1,
    };
    const receipt = (plan: (typeof plans)[number]) =>
      adaptNodeGymRunnerReceipt({
        plan,
        scores,
        runnerReceipt: {
          schemaVersion: NODE_GYM_RUNNER_RECEIPT_SCHEMA_VERSION,
          runId: plan.runId,
          comparisonKey: plan.comparisonKey,
          harnessPairingKey: plan.harnessPairingKey,
          pairingKey: plan.pairingKey,
          repetition: plan.repetition,
          status: 'passed',
          automatedHardGatesPassed: true,
          issueCodes: [],
          usage: {
            latencyMs: 10,
            inputTokens: 1,
            outputTokens: 1,
            costMicroUsd: 0,
            repairCount: 0,
          },
        },
      });
    const champion = plans.filter((plan) => plan.model.id === 'champion').map(receipt);
    const challenger = plans.filter((plan) => plan.model.id === 'challenger').map(receipt);
    const policy = {
      minimumMatchedCases: 4,
      minimumPreferenceWinRate: 0.5,
      minimumMeanUtilityDelta: 0,
      maximumDimensionRegression: 0,
      minimumStableRepetitions: 2,
      requiresHumanReview: true,
      autoApply: false as const,
    };
    const failedChampion = champion[0];
    if (!failedChampion) throw new Error('Expected a champion receipt.');
    expect(
      proposeNodeGymPromotion({
        champion,
        challenger,
        humanPreferencesComplete: true,
        challengerPreferenceWins: 4,
        policy,
      }),
    ).toMatchObject({
      decision: 'recommend-promotion',
      matchedCases: 4,
      matchedIdentityCohorts: 2,
      stableRepetitions: 2,
    });
    expect(
      proposeNodeGymPromotion({
        champion: [
          { ...failedChampion, status: 'failed', hardGatesPassed: false },
          ...champion.slice(1),
        ],
        challenger,
        humanPreferencesComplete: true,
        challengerPreferenceWins: 4,
        policy,
      }).blockers,
    ).toContain('champion_hard_gate_failure');
  });
});
