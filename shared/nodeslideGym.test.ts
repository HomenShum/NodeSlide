import { describe, expect, it } from 'vitest';
import {
  type NodeGymRunPlan,
  type NodeGymRunReceipt,
  assertPairedHarnessRuns,
  buildCurriculumBoundary,
  buildNodeGymMatrix,
  diagnoseNodeGymRun,
  exportNodeGymTrainingEpisode,
  proposeNodeGymPromotion,
  selectNodeGymShadowRoute,
} from './nodeslideGym';

const task = {
  id: 'typed-waterfall',
  taskClass: 'artifact-spec',
  curriculumLevel: 3,
  pool: 'public-development' as const,
  taskDigest: 'task',
  evidenceDigest: 'evidence',
  referenceDigest: 'reference',
};
const model = {
  id: 'small/model:free',
  provider: 'openrouter',
  route: 'small/model:free',
  returnedModelRequired: true,
  cohort: 'pinned-free' as const,
};
const light = {
  id: 'light',
  version: '1',
  weight: 'light' as const,
  role: 'director',
  contextStrategy: 'brief',
  toolIds: [],
  repairPolicy: 'none',
};
const heavy = {
  id: 'heavy',
  version: '1',
  weight: 'heavy' as const,
  role: 'executor',
  contextStrategy: 'bounded',
  toolIds: ['build_waterfall'],
  repairPolicy: 'typed',
};
const budget = { maxTokens: 1000, maxLatencyMs: 60000, maxCostMicroUsd: 0, maxRepairs: 1 };

function requirePlan(plans: NodeGymRunPlan[], index = 0): NodeGymRunPlan {
  const plan = plans[index];
  if (!plan) {
    throw new Error(`Expected NodeGym plan at index ${index}.`);
  }
  return plan;
}

function receipt(
  plan: { runId: string; pairingKey: string; repetition: number },
  overrides: Partial<NodeGymRunReceipt> = {},
): NodeGymRunReceipt {
  return {
    runId: plan.runId,
    pairingKey: plan.pairingKey,
    repetition: plan.repetition,
    status: 'passed',
    returnedModel: 'small/model:free',
    scores: {
      briefAdherence: 1,
      storyQuality: 0.9,
      visualPreference: 0.8,
      factualAccuracy: 1,
      toolReliability: 1,
      exportFidelity: 1,
      repairSuccess: 1,
      editability: 1,
    },
    hardGatesPassed: true,
    semanticIssueCodes: [],
    repairCount: 0,
    latencyMs: 1000,
    inputTokens: 100,
    outputTokens: 100,
    costMicroUsd: 0,
    humanInterventions: 0,
    ...overrides,
  };
}

describe('portable NodeGym core', () => {
  it('builds exact matched harness pairs with repeated trials', () => {
    const plans = buildNodeGymMatrix({
      tasks: [task],
      models: [model],
      harnesses: [light, heavy],
      budget,
      repetitions: 3,
    });
    expect(plans).toHaveLength(6);
    const first = requirePlan(plans);
    const fourth = requirePlan(plans, 3);
    assertPairedHarnessRuns(first, fourth);
    expect(first.pairingKey).toBe(fourth.pairingKey);
  });

  it('diagnoses failures and finds a curriculum boundary', () => {
    const plan = requirePlan(
      buildNodeGymMatrix({
        tasks: [task],
        models: [model],
        harnesses: [heavy],
        budget,
        repetitions: 1,
      }),
    );
    const failed = receipt(plan, {
      status: 'failed',
      hardGatesPassed: false,
      semanticIssueCodes: ['equation_evaluation_mismatch'],
      scores: { ...receipt(plan).scores, factualAccuracy: 0.2, visualPreference: 0.4 },
    });
    expect(diagnoseNodeGymRun(plan, failed)).toEqual(
      expect.arrayContaining(['semantic-reasoning', 'visual-judgment']),
    );
    expect(buildCurriculumBoundary([plan], [failed]).firstUnreliableLevel).toBe(3);
  });

  it('keeps promotion advisory and training/shadow outputs bounded', () => {
    const plan = requirePlan(
      buildNodeGymMatrix({
        tasks: [task],
        models: [model],
        harnesses: [heavy],
        budget,
        repetitions: 1,
      }),
    );
    const accepted = receipt(plan);
    const proposal = proposeNodeGymPromotion({
      champion: [receipt(plan, { runId: 'champion', latencyMs: 10000 })],
      challenger: [accepted],
      humanPreferencesComplete: true,
      challengerPreferenceWins: 1,
      policy: {
        minimumMatchedCases: 1,
        minimumPreferenceWinRate: 0.6,
        minimumMeanUtilityDelta: 0,
        maximumDimensionRegression: 0.02,
        minimumStableRepetitions: 1,
        requiresHumanReview: true,
        autoApply: false,
      },
    });
    expect(proposal).toMatchObject({ decision: 'recommend-promotion', autoApply: false });
    expect(
      exportNodeGymTrainingEpisode({
        plan,
        receipt: accepted,
        taskState: {},
        boundedContext: {},
        toolCalls: [],
        validationFeedback: [],
        repairs: [],
        acceptedArtifact: {},
      }).excludesHiddenReasoning,
    ).toBe(true);
    expect(
      selectNodeGymShadowRoute({
        taskClass: 'artifact-spec',
        champions: [
          { taskClass: 'artifact-spec', model: 'small', harness: 'heavy', eligible: true },
        ],
        fallback: { model: 'frontier', harness: 'light' },
      }),
    ).toMatchObject({ mode: 'shadow', userVisible: false });
  });

  it('blocks unstable or regressing promotion evidence and non-public training exports', () => {
    const plan = requirePlan(
      buildNodeGymMatrix({
        tasks: [task],
        models: [model],
        harnesses: [heavy],
        budget,
        repetitions: 1,
      }),
    );
    const champion = receipt(plan);
    const challenger = receipt(plan, { scores: { ...champion.scores, factualAccuracy: 0.7 } });
    const proposal = proposeNodeGymPromotion({
      champion: [champion],
      challenger: [challenger],
      humanPreferencesComplete: true,
      challengerPreferenceWins: 1,
      policy: {
        minimumMatchedCases: 1,
        minimumPreferenceWinRate: 0.6,
        minimumMeanUtilityDelta: -1,
        maximumDimensionRegression: 0.02,
        minimumStableRepetitions: 3,
        requiresHumanReview: true,
        autoApply: false,
      },
    });
    expect(proposal.blockers).toEqual(
      expect.arrayContaining(['insufficient_stable_repetitions', 'protected_dimension_regression']),
    );

    const hiddenPlan = { ...plan, task: { ...plan.task, pool: 'hidden-validation' as const } };
    expect(() =>
      exportNodeGymTrainingEpisode({
        plan: hiddenPlan,
        receipt: champion,
        taskState: {},
        boundedContext: {},
        toolCalls: [],
        validationFeedback: [],
        repairs: [],
      }),
    ).toThrow('public development pool');
  });
});
