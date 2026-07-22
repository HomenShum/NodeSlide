export const NODE_GYM_SCHEMA_VERSION = 'nodekit.gym/v1' as const;

export type NodeGymTaskPool =
  | 'public-development'
  | 'hidden-validation'
  | 'rotating-challenge'
  | 'live-shadow';
export type NodeGymHarnessWeight = 'light' | 'structured' | 'heavy' | 'repair';
export type NodeGymRunStatus = 'passed' | 'failed' | 'provider-error' | 'budget-exhausted';
export type NodeGymDiagnosisCode =
  | 'planning'
  | 'context'
  | 'tool-selection'
  | 'tool-schema'
  | 'semantic-reasoning'
  | 'visual-judgment'
  | 'repair'
  | 'provider'
  | 'budget'
  | 'model-ceiling';

export interface NodeGymTask {
  id: string;
  taskClass: string;
  curriculumLevel: number;
  pool: NodeGymTaskPool;
  taskDigest: string;
  evidenceDigest: string;
  referenceDigest: string;
}

export interface NodeGymModel {
  id: string;
  provider: string;
  route: string;
  returnedModelRequired: boolean;
  cohort:
    | 'frontier'
    | 'mid-tier'
    | 'small-legacy'
    | 'pinned-free'
    | 'random-router'
    | 'control'
    | 'checkpoint';
}

export interface NodeGymHarnessProfile {
  id: string;
  version: string;
  weight: NodeGymHarnessWeight;
  role: string;
  contextStrategy: string;
  toolIds: string[];
  repairPolicy: string;
}

export interface NodeGymBudget {
  maxTokens: number;
  maxLatencyMs: number;
  maxCostMicroUsd: number;
  maxRepairs: number;
}

export interface NodeGymRunPlan {
  schemaVersion: typeof NODE_GYM_SCHEMA_VERSION;
  runId: string;
  task: NodeGymTask;
  model: NodeGymModel;
  harness: NodeGymHarnessProfile;
  budget: NodeGymBudget;
  repetition: number;
  pairingKey: string;
}

export interface NodeGymScores {
  briefAdherence: number;
  storyQuality: number;
  visualPreference: number;
  factualAccuracy: number;
  toolReliability: number;
  exportFidelity: number;
  repairSuccess: number;
  editability: number;
}

export interface NodeGymRunReceipt {
  runId: string;
  pairingKey: string;
  repetition: number;
  status: NodeGymRunStatus;
  returnedModel?: string;
  scores: NodeGymScores;
  hardGatesPassed: boolean;
  semanticIssueCodes: string[];
  repairCount: number;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
  humanInterventions: number;
}

export interface NodeGymPromotionPolicy {
  minimumMatchedCases: number;
  minimumPreferenceWinRate: number;
  minimumMeanUtilityDelta: number;
  maximumDimensionRegression: number;
  minimumStableRepetitions: number;
  requiresHumanReview: boolean;
  autoApply: false;
}

export function buildNodeGymMatrix(input: {
  tasks: NodeGymTask[];
  models: NodeGymModel[];
  harnesses: NodeGymHarnessProfile[];
  budget: NodeGymBudget;
  repetitions: number;
}): NodeGymRunPlan[] {
  if (!Number.isInteger(input.repetitions) || input.repetitions < 1)
    throw new Error('NodeGym repetitions must be a positive integer.');
  const runs: NodeGymRunPlan[] = [];
  for (const task of input.tasks) {
    for (const model of input.models) {
      for (const harness of input.harnesses) {
        for (let repetition = 1; repetition <= input.repetitions; repetition += 1) {
          const pairingKey = [
            task.taskDigest,
            task.evidenceDigest,
            task.referenceDigest,
            model.id,
            repetition,
            budgetKey(input.budget),
          ].join('::');
          runs.push({
            schemaVersion: NODE_GYM_SCHEMA_VERSION,
            runId: [task.id, model.id, harness.id, repetition].map(slug).join('__'),
            task,
            model,
            harness,
            budget: input.budget,
            repetition,
            pairingKey,
          });
        }
      }
    }
  }
  return runs;
}

export function assertPairedHarnessRuns(left: NodeGymRunPlan, right: NodeGymRunPlan): void {
  if (left.pairingKey !== right.pairingKey)
    throw new Error(
      'Harness comparison requires identical task, evidence, references, model, budget, and repetition.',
    );
  if (left.harness.id === right.harness.id && left.harness.version === right.harness.version)
    throw new Error('Harness comparison requires distinct harness candidates.');
}

export function diagnoseNodeGymRun(
  plan: NodeGymRunPlan,
  receipt: NodeGymRunReceipt,
): NodeGymDiagnosisCode[] {
  const codes = new Set<NodeGymDiagnosisCode>();
  if (plan.model.returnedModelRequired && !receipt.returnedModel) codes.add('provider');
  if (receipt.status === 'provider-error') codes.add('provider');
  if (receipt.status === 'budget-exhausted') codes.add('budget');
  if (receipt.scores.briefAdherence < 0.75 || receipt.scores.storyQuality < 0.65)
    codes.add('planning');
  if (receipt.scores.toolReliability < 0.8) {
    codes.add(
      receipt.semanticIssueCodes.some((code) => code.includes('schema'))
        ? 'tool-schema'
        : 'tool-selection',
    );
  }
  if (receipt.scores.factualAccuracy < 0.9 || receipt.semanticIssueCodes.length > 0)
    codes.add('semantic-reasoning');
  if (receipt.scores.visualPreference < 0.6) codes.add('visual-judgment');
  if (receipt.repairCount > plan.budget.maxRepairs || receipt.scores.repairSuccess < 0.7)
    codes.add('repair');
  if (
    receipt.status === 'failed' &&
    plan.harness.weight === 'heavy' &&
    receipt.scores.toolReliability >= 0.8 &&
    receipt.semanticIssueCodes.length === 0
  )
    codes.add('model-ceiling');
  return [...codes];
}

export function buildCurriculumBoundary(
  plans: NodeGymRunPlan[],
  receipts: NodeGymRunReceipt[],
  minimumPassRate = 0.8,
) {
  const byRun = new Map(receipts.map((receipt) => [receipt.runId, receipt]));
  const levels = new Map<number, { passed: number; total: number }>();
  for (const plan of plans) {
    const receipt = byRun.get(plan.runId);
    if (!receipt) continue;
    const level = levels.get(plan.task.curriculumLevel) ?? { passed: 0, total: 0 };
    level.total += 1;
    if (receipt.status === 'passed' && receipt.hardGatesPassed) level.passed += 1;
    levels.set(plan.task.curriculumLevel, level);
  }
  const observations = [...levels.entries()]
    .sort(([left], [right]) => left - right)
    .map(([level, result]) => ({
      level,
      ...result,
      passRate: result.total ? result.passed / result.total : 0,
    }));
  return {
    observations,
    firstUnreliableLevel:
      observations.find((entry) => entry.passRate < minimumPassRate)?.level ?? null,
  };
}

export function nodeGymUtility(
  receipt: NodeGymRunReceipt,
  weights = { cost: 0.08, latency: 0.04, intervention: 0.1 },
): number {
  if (!receipt.hardGatesPassed) return Number.NEGATIVE_INFINITY;
  const score = receipt.scores;
  const quality =
    0.25 * score.briefAdherence +
    0.15 * score.storyQuality +
    0.2 * score.visualPreference +
    0.15 * score.factualAccuracy +
    0.1 * score.toolReliability +
    0.08 * score.exportFidelity +
    0.05 * score.repairSuccess +
    0.02 * score.editability;
  return (
    quality -
    (weights.cost * receipt.costMicroUsd) / 1_000_000 -
    (weights.latency * receipt.latencyMs) / 60_000 -
    weights.intervention * receipt.humanInterventions
  );
}

export function proposeNodeGymPromotion(input: {
  champion: NodeGymRunReceipt[];
  challenger: NodeGymRunReceipt[];
  humanPreferencesComplete: boolean;
  challengerPreferenceWins: number;
  policy: NodeGymPromotionPolicy;
}) {
  const matched = pairReceipts(input.champion, input.challenger);
  const blockers: string[] = [];
  if (matched.length < input.policy.minimumMatchedCases)
    blockers.push('insufficient_matched_cases');
  const stableRepetitions = new Set(matched.map(({ challenger }) => challenger.repetition)).size;
  if (stableRepetitions < input.policy.minimumStableRepetitions)
    blockers.push('insufficient_stable_repetitions');
  if (matched.some(({ challenger }) => !challenger.hardGatesPassed))
    blockers.push('challenger_hard_gate_failure');
  if (input.policy.requiresHumanReview && !input.humanPreferencesComplete)
    blockers.push('human_review_incomplete');
  const winRate = matched.length ? input.challengerPreferenceWins / matched.length : 0;
  if (input.challengerPreferenceWins > matched.length) blockers.push('invalid_preference_count');
  if (winRate < input.policy.minimumPreferenceWinRate)
    blockers.push('preference_win_rate_below_gate');
  const utilityDelta = mean(
    matched.map(
      ({ champion, challenger }) => nodeGymUtility(challenger) - nodeGymUtility(champion),
    ),
  );
  if (!(utilityDelta >= input.policy.minimumMeanUtilityDelta))
    blockers.push('utility_delta_below_gate');
  const dimensionRegressions = scoreDimensions().flatMap((dimension) => {
    const championMean = mean(matched.map(({ champion }) => champion.scores[dimension]));
    const challengerMean = mean(matched.map(({ challenger }) => challenger.scores[dimension]));
    const delta = challengerMean - championMean;
    return delta < -input.policy.maximumDimensionRegression ? [{ dimension, delta }] : [];
  });
  if (dimensionRegressions.length > 0) blockers.push('protected_dimension_regression');
  if (input.policy.autoApply !== false) blockers.push('auto_apply_must_remain_false');
  return {
    decision: blockers.length ? 'hold' : 'recommend-promotion',
    blockers,
    matchedCases: matched.length,
    preferenceWinRate: winRate,
    meanUtilityDelta: utilityDelta,
    stableRepetitions,
    dimensionRegressions,
    autoApply: false as const,
  };
}

export function exportNodeGymTrainingEpisode(input: {
  plan: NodeGymRunPlan;
  receipt: NodeGymRunReceipt;
  taskState: unknown;
  boundedContext: unknown;
  selectedSkill?: string;
  toolCalls: unknown[];
  validationFeedback: unknown[];
  repairs: unknown[];
  acceptedArtifact?: unknown;
}) {
  if (!input.receipt.hardGatesPassed || input.receipt.status !== 'passed')
    throw new Error('Only accepted hard-gate-passing episodes may enter training export.');
  if (input.plan.task.pool !== 'public-development')
    throw new Error('Training export is restricted to the public development pool.');
  if (
    input.receipt.pairingKey !== input.plan.pairingKey ||
    input.receipt.repetition !== input.plan.repetition
  )
    throw new Error('Training receipt must match the immutable run plan.');
  return {
    schemaVersion: 'nodekit.gym-training-episode/v1',
    taskId: input.plan.task.id,
    taskClass: input.plan.task.taskClass,
    model: input.plan.model.id,
    harness: `${input.plan.harness.id}@${input.plan.harness.version}`,
    taskState: input.taskState,
    boundedContext: input.boundedContext,
    selectedSkill: input.selectedSkill,
    toolCalls: input.toolCalls,
    validationFeedback: input.validationFeedback,
    repairs: input.repairs,
    acceptedArtifact: input.acceptedArtifact,
    excludesHiddenReasoning: true,
  };
}

export function selectNodeGymShadowRoute(input: {
  taskClass: string;
  champions: Array<{ taskClass: string; model: string; harness: string; eligible: boolean }>;
  fallback: { model: string; harness: string };
}) {
  const champion = input.champions.find(
    (entry) => entry.taskClass === input.taskClass && entry.eligible,
  );
  return champion
    ? { mode: 'shadow', model: champion.model, harness: champion.harness, userVisible: false }
    : { mode: 'fallback', ...input.fallback, userVisible: false };
}

function pairReceipts(champion: NodeGymRunReceipt[], challenger: NodeGymRunReceipt[]) {
  const challengerByPair = new Map(challenger.map((receipt) => [receipt.pairingKey, receipt]));
  return champion.flatMap((left) => {
    const right = challengerByPair.get(left.pairingKey);
    return right ? [{ champion: left, challenger: right }] : [];
  });
}

function scoreDimensions(): Array<keyof NodeGymScores> {
  return [
    'briefAdherence',
    'storyQuality',
    'visualPreference',
    'factualAccuracy',
    'toolReliability',
    'exportFidelity',
    'repairSuccess',
    'editability',
  ];
}

function budgetKey(budget: NodeGymBudget) {
  return [budget.maxTokens, budget.maxLatencyMs, budget.maxCostMicroUsd, budget.maxRepairs].join(
    ':',
  );
}

function slug(value: string | number) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
}
