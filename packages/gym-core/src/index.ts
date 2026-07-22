/** Package release version. This is independent from the schema version. */
export * from './checkpoint.js';
export * from './routing.js';

export const NODE_GYM_CORE_PACKAGE_VERSION = '0.1.0' as const;

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
  /** Same task/evidence/reference/budget/repetition across distinct model candidates. */
  comparisonKey: string;
  /** Adds the model identity so harness candidates remain exactly paired. */
  harnessPairingKey: string;
  /** Backwards-compatible alias for harnessPairingKey. */
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
  taskId: string;
  taskClass: string;
  curriculumLevel: number;
  modelId: string;
  harnessId: string;
  harnessVersion: string;
  role: string;
  comparisonKey: string;
  harnessPairingKey: string;
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

export const NODE_GYM_RUNNER_RECEIPT_SCHEMA_VERSION = 'nodekit.gym-run-receipt/v2' as const;

/** Receipt emitted by the filesystem/live executor before domain scoring. */
export interface NodeGymRunnerReceiptV2 {
  schemaVersion: typeof NODE_GYM_RUNNER_RECEIPT_SCHEMA_VERSION;
  runId: string;
  comparisonKey?: string;
  harnessPairingKey?: string;
  pairingKey: string;
  repetition: number;
  status:
    | 'passed'
    | 'failed'
    | 'provider-error'
    | 'budget-exhausted'
    | 'degraded'
    | 'artifact-failure';
  returnedModel?: string | null;
  automatedHardGatesPassed: boolean;
  issueCodes: string[];
  usage: {
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    costMicroUsd: number;
    repairCount: number;
  };
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

export interface NodeGymTrainingSourceConsent {
  sourceId: string;
  sourceDigest: string;
  license: string;
  consentScope: 'training-approved';
  trainingUseAllowed: true;
}

export interface NodeGymTrainingGovernance {
  consentScope: 'training-approved';
  trainingEligible: true;
  containsPersonalData: false;
  humanReviewComplete: true;
  promotionReady: true;
  sources: NodeGymTrainingSourceConsent[];
  /** Exact secrets or private identifiers to redact before validation/export. */
  redactionTokens?: string[];
  /** Held-out task/evidence/reference/source digests that may never enter an episode. */
  holdoutDigests?: string[];
  /** Source digests removed through consent withdrawal or deletion requests. */
  deletedSourceDigests?: string[];
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
          const comparisonKey = [
            task.taskDigest,
            task.evidenceDigest,
            task.referenceDigest,
            repetition,
            budgetKey(input.budget),
          ].join('::');
          // Preserve the v0.0.1/nodekit.gym-v1 persisted pairing identity.
          // comparisonKey is the additive model-neutral key; changing the
          // historical field order would silently strand upgrade receipts.
          const harnessPairingKey = [
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
            comparisonKey,
            harnessPairingKey,
            pairingKey: harnessPairingKey,
          });
        }
      }
    }
  }
  return runs;
}

export function assertPairedHarnessRuns(left: NodeGymRunPlan, right: NodeGymRunPlan): void {
  if (left.harnessPairingKey !== right.harnessPairingKey)
    throw new Error(
      'Harness comparison requires identical task, evidence, references, model, budget, and repetition.',
    );
  if (left.harness.id === right.harness.id && left.harness.version === right.harness.version)
    throw new Error('Harness comparison requires distinct harness candidates.');
}

export function assertPairedModelRuns(left: NodeGymRunPlan, right: NodeGymRunPlan): void {
  if (left.comparisonKey !== right.comparisonKey)
    throw new Error(
      'Model comparison requires identical task, evidence, references, budget, and repetition.',
    );
  if (left.model.id === right.model.id)
    throw new Error('Model comparison requires distinct model candidates.');
  if (left.harness.id !== right.harness.id || left.harness.version !== right.harness.version)
    throw new Error('Model comparison requires the same harness profile and version.');
}

/**
 * Validated conversion from executor receipt v2 into the single scored receipt
 * consumed by curriculum, diagnosis, promotion, and training export.
 */
export function adaptNodeGymRunnerReceipt(input: {
  plan: NodeGymRunPlan;
  runnerReceipt: NodeGymRunnerReceiptV2;
  scores: NodeGymScores;
  humanInterventions?: number;
}): NodeGymRunReceipt {
  const { plan, runnerReceipt } = input;
  if (runnerReceipt.schemaVersion !== NODE_GYM_RUNNER_RECEIPT_SCHEMA_VERSION)
    throw new Error('Unsupported NodeGym runner receipt schema.');
  if (runnerReceipt.runId !== plan.runId || runnerReceipt.repetition !== plan.repetition)
    throw new Error('Runner receipt does not match the immutable run identity.');
  if (runnerReceipt.pairingKey !== plan.harnessPairingKey)
    throw new Error('Runner receipt does not match the harness pairing key.');
  if (
    runnerReceipt.comparisonKey !== undefined &&
    runnerReceipt.comparisonKey !== plan.comparisonKey
  )
    throw new Error('Runner receipt does not match the model comparison key.');
  if (
    runnerReceipt.harnessPairingKey !== undefined &&
    runnerReceipt.harnessPairingKey !== plan.harnessPairingKey
  )
    throw new Error('Runner receipt carries a conflicting harness pairing key.');
  const usage = runnerReceipt.usage;
  for (const [name, value] of Object.entries(usage))
    if (!Number.isFinite(value) || value < 0) throw new Error(`Runner receipt ${name} is invalid.`);
  const status = canonicalRunStatus(runnerReceipt.status);
  const hardGatesPassed = runnerReceipt.automatedHardGatesPassed && status === 'passed';
  if (runnerReceipt.automatedHardGatesPassed && status !== 'passed')
    throw new Error('A non-passing runner receipt cannot pass automated hard gates.');
  return {
    runId: plan.runId,
    taskId: plan.task.id,
    taskClass: plan.task.taskClass,
    curriculumLevel: plan.task.curriculumLevel,
    modelId: plan.model.id,
    harnessId: plan.harness.id,
    harnessVersion: plan.harness.version,
    role: plan.harness.role,
    comparisonKey: plan.comparisonKey,
    harnessPairingKey: plan.harnessPairingKey,
    pairingKey: plan.harnessPairingKey,
    repetition: plan.repetition,
    status,
    ...(runnerReceipt.returnedModel ? { returnedModel: runnerReceipt.returnedModel } : {}),
    scores: input.scores,
    hardGatesPassed,
    semanticIssueCodes: [...runnerReceipt.issueCodes],
    repairCount: usage.repairCount,
    latencyMs: usage.latencyMs,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    costMicroUsd: usage.costMicroUsd,
    humanInterventions: input.humanInterventions ?? 0,
  };
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
  minimumRepeats = 3,
) {
  const byRun = new Map(receipts.map((receipt) => [receipt.runId, receipt]));
  const levels = new Map<number, { passed: number; total: number }>();
  const cohortRuns = new Map<
    string,
    {
      plan: NodeGymRunPlan;
      receipts: NodeGymRunReceipt[];
      repetitions: Set<number>;
    }
  >();
  for (const plan of plans) {
    const receipt = byRun.get(plan.runId);
    if (!receipt) continue;
    assertReceiptPlanIdentity(plan, receipt);
    const cohortKey = [
      plan.model.id,
      plan.harness.id,
      plan.harness.version,
      plan.harness.role,
      plan.task.id,
    ].join('::');
    const cohort = cohortRuns.get(cohortKey) ?? {
      plan,
      receipts: [],
      repetitions: new Set<number>(),
    };
    cohort.receipts.push(receipt);
    cohort.repetitions.add(plan.repetition);
    cohortRuns.set(cohortKey, cohort);
    const level = levels.get(plan.task.curriculumLevel) ?? {
      passed: 0,
      total: 0,
    };
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
  const cohorts = [...cohortRuns.values()]
    .map(({ plan, receipts: cohortReceipts, repetitions }) => {
      const passed = cohortReceipts.filter(
        (receipt) => receipt.status === 'passed' && receipt.hardGatesPassed,
      ).length;
      const passRate = cohortReceipts.length ? passed / cohortReceipts.length : 0;
      return {
        modelId: plan.model.id,
        harnessId: plan.harness.id,
        harnessVersion: plan.harness.version,
        role: plan.harness.role,
        taskId: plan.task.id,
        taskClass: plan.task.taskClass,
        curriculumLevel: plan.task.curriculumLevel,
        repetitions: repetitions.size,
        passed,
        total: cohortReceipts.length,
        passRate,
        repeatGatePassed: repetitions.size >= minimumRepeats,
        eligible: repetitions.size >= minimumRepeats && passRate >= minimumPassRate,
      };
    })
    .sort(
      (left, right) =>
        left.curriculumLevel - right.curriculumLevel ||
        left.modelId.localeCompare(right.modelId) ||
        left.harnessId.localeCompare(right.harnessId) ||
        left.taskId.localeCompare(right.taskId),
    );
  return {
    observations,
    cohorts,
    minimumRepeats,
    firstUnreliableLevel: cohorts.find((entry) => !entry.eligible)?.curriculumLevel ?? null,
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
  comparisonMode?: 'model' | 'harness';
  humanPreferencesComplete: boolean;
  challengerPreferenceWins: number;
  policy: NodeGymPromotionPolicy;
}) {
  const comparisonMode = input.comparisonMode ?? 'model';
  const pairing = pairReceipts(input.champion, input.challenger, comparisonMode);
  const matched = pairing.pairs;
  const blockers: string[] = [...pairing.issueCodes];
  if (matched.length < input.policy.minimumMatchedCases)
    blockers.push('insufficient_matched_cases');
  const repetitionCohorts = new Map<string, Set<number>>();
  for (const pair of matched) {
    const identity = promotionCohortIdentity(pair.champion, pair.challenger, comparisonMode);
    const repetitions = repetitionCohorts.get(identity) ?? new Set<number>();
    repetitions.add(pair.challenger.repetition);
    repetitionCohorts.set(identity, repetitions);
  }
  const stableRepetitions = repetitionCohorts.size
    ? Math.min(...[...repetitionCohorts.values()].map((values) => values.size))
    : 0;
  if (stableRepetitions < input.policy.minimumStableRepetitions)
    blockers.push('insufficient_stable_repetitions');
  if (matched.some(({ champion }) => !champion.hardGatesPassed || champion.status !== 'passed'))
    blockers.push('champion_hard_gate_failure');
  if (
    matched.some(({ challenger }) => !challenger.hardGatesPassed || challenger.status !== 'passed')
  )
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
    comparisonMode,
    matchedIdentityCohorts: repetitionCohorts.size,
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
  governance: NodeGymTrainingGovernance;
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
    input.receipt.harnessPairingKey !== input.plan.harnessPairingKey ||
    input.receipt.comparisonKey !== input.plan.comparisonKey ||
    input.receipt.repetition !== input.plan.repetition
  )
    throw new Error('Training receipt must match the immutable run plan.');
  assertReceiptPlanIdentity(input.plan, input.receipt);
  if (
    input.governance.trainingEligible !== true ||
    input.governance.consentScope !== 'training-approved' ||
    input.governance.containsPersonalData !== false ||
    input.governance.humanReviewComplete !== true ||
    input.governance.promotionReady !== true
  )
    throw new Error('Training export requires explicit consent, privacy, and human-review gates.');
  if (!input.governance.sources.length)
    throw new Error('Training export requires source-level provenance and consent.');
  if ((input.governance.redactionTokens ?? []).some((token) => !token.trim()))
    throw new Error('Training redaction tokens must be non-empty strings.');
  const sourceDigests = new Set<string>();
  for (const source of input.governance.sources) {
    if (
      !source.sourceId.trim() ||
      !isPortableDigest(source.sourceDigest) ||
      !source.license.trim() ||
      source.consentScope !== 'training-approved' ||
      source.trainingUseAllowed !== true
    )
      throw new Error('Training source provenance or consent is invalid.');
    sourceDigests.add(normalizePortableDigest(source.sourceDigest));
  }
  const holdouts = new Set((input.governance.holdoutDigests ?? []).map(normalizePortableDigest));
  if ((input.governance.holdoutDigests ?? []).some((value) => !isPortableDigest(value)))
    throw new Error('Training holdout digest is invalid.');
  const immutableDigests = [
    input.plan.task.taskDigest,
    input.plan.task.evidenceDigest,
    input.plan.task.referenceDigest,
    ...sourceDigests,
  ].map(normalizePortableDigest);
  if (immutableDigests.some((value) => holdouts.has(value)))
    throw new Error('Training export is contaminated by a held-out digest.');
  const deleted = new Set(
    (input.governance.deletedSourceDigests ?? []).map(normalizePortableDigest),
  );
  if ((input.governance.deletedSourceDigests ?? []).some((value) => !isPortableDigest(value)))
    throw new Error('Training deletion digest is invalid.');
  if ([...sourceDigests].some((value) => deleted.has(value)))
    throw new Error('Training export references a deleted or withdrawn source.');

  const rawEpisode = {
    taskState: input.taskState,
    boundedContext: input.boundedContext,
    selectedSkill: input.selectedSkill,
    toolCalls: input.toolCalls,
    validationFeedback: input.validationFeedback,
    repairs: input.repairs,
    acceptedArtifact: input.acceptedArtifact,
  };
  if (portableForbiddenReasoningPaths(rawEpisode).length)
    throw new Error('Training export may not contain hidden reasoning or scratchpad fields.');
  const redacted = portableRedact(rawEpisode, input.governance.redactionTokens ?? []);
  const serialized = JSON.stringify(redacted.value);
  if (portableSensitiveText(serialized))
    throw new Error('Training export still contains sensitive or personal data after redaction.');
  if (
    [...holdouts].some((value) => serialized.toLowerCase().includes(value.replace(/^sha256:/u, '')))
  )
    throw new Error('Training export leaks a held-out digest.');
  return {
    schemaVersion: 'nodekit.gym-training-episode/v1',
    taskId: input.plan.task.id,
    taskClass: input.plan.task.taskClass,
    model: input.receipt.returnedModel ?? input.plan.model.id,
    requestedModel: input.plan.model.id,
    harness: `${input.plan.harness.id}@${input.plan.harness.version}`,
    harnessId: input.plan.harness.id,
    harnessVersion: input.plan.harness.version,
    role: input.plan.harness.role,
    ...redacted.value,
    provenance: input.governance.sources.map((source) => ({ ...source })),
    sourceLineage: [...sourceDigests].sort(),
    governance: {
      consentScope: input.governance.consentScope,
      humanReviewComplete: input.governance.humanReviewComplete,
      promotionReady: input.governance.promotionReady,
      redactionCount: redacted.count,
      deletionLineage: [...sourceDigests].sort().map((sourceDigest) => ({
        sourceDigest,
        status: 'active' as const,
        deletionRequestId: null,
      })),
      holdoutDigestCount: holdouts.size,
    },
    excludesHiddenReasoning: true,
  };
}

function portableRedact(
  value: unknown,
  tokens: string[],
): { value: Record<string, unknown>; count: number } {
  let count = 0;
  const exact = tokens
    .filter((token) => token.trim())
    .sort((left, right) => right.length - left.length);
  const visit = (entry: unknown): unknown => {
    if (typeof entry === 'string') {
      let next = entry;
      for (const token of exact) {
        if (!next.includes(token)) continue;
        next = next.replaceAll(token, '[REDACTED_SECRET]');
        count += 1;
      }
      for (const [pattern, replacement] of portableRedactionPatterns()) {
        pattern.lastIndex = 0;
        if (!pattern.test(next)) continue;
        pattern.lastIndex = 0;
        next = next.replace(pattern, replacement);
        count += 1;
      }
      return next;
    }
    if (Array.isArray(entry)) return entry.map(visit);
    if (!entry || typeof entry !== 'object') return entry;
    return Object.fromEntries(
      Object.entries(entry).map(([key, item]) => {
        if (isPortableCredentialKey(key)) {
          count += 1;
          return [key, '[REDACTED_SECRET]'];
        }
        return [key, visit(item)];
      }),
    );
  };
  return { value: visit(value) as Record<string, unknown>, count };
}

function portableRedactionPatterns(): Array<[RegExp, string]> {
  return [
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[REDACTED_PII]'],
    [/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/gu, '[REDACTED_PII]'],
    [/\b\d{3}-\d{2}-\d{4}\b/gu, '[REDACTED_PII]'],
    [/\b(?:sk-|xox[baprs]-|gh[pousr]_)[a-z0-9_-]{16,}\b/giu, '[REDACTED_SECRET]'],
    [/\b(?:api[_-]?key|authorization|bearer)\s*[:=]\s*[^\s,;]{12,}/giu, '[REDACTED_SECRET]'],
    [/(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/gu, '[REDACTED_SECRET]'],
  ];
}

const PORTABLE_SENSITIVE_CREDENTIAL_KEYS = new Set([
  'accesskey',
  'accesstoken',
  'apikey',
  'authorization',
  'bearertoken',
  'capabilitykey',
  'clientsecret',
  'credential',
  'credentials',
  'owneraccesskey',
  'ownercapability',
  'password',
  'refreshtoken',
  'secret',
  'sessiontoken',
  'token',
]);

function isPortableCredentialKey(value: string): boolean {
  return PORTABLE_SENSITIVE_CREDENTIAL_KEYS.has(value.toLowerCase().replace(/[^a-z0-9]/gu, ''));
}

function portableSensitiveText(value: string): boolean {
  return portableRedactionPatterns().some(([pattern]) => {
    pattern.lastIndex = 0;
    return pattern.test(value);
  });
}

function portableForbiddenReasoningPaths(value: unknown, path = ''): string[] {
  if (!value || typeof value !== 'object') return [];
  const forbidden = new Set([
    'chainofthought',
    'hiddenreasoning',
    'scratchpad',
    'internalmonologue',
    'reasoningtokens',
  ]);
  return Object.entries(value).flatMap(([key, entry]) => {
    const normalized = key.toLowerCase().replace(/[-_]/gu, '');
    const next = `${path}/${key}`;
    return [
      ...(forbidden.has(normalized) ? [next] : []),
      ...portableForbiddenReasoningPaths(entry, next),
    ];
  });
}

function normalizePortableDigest(value: string): string {
  const normalized = String(value).trim().toLowerCase();
  return normalized.startsWith('sha256:') ? normalized : `sha256:${normalized}`;
}

function isPortableDigest(value: string): boolean {
  return /^(?:sha256:)?[a-f0-9]{64}$/u.test(String(value).trim().toLowerCase());
}

export function selectNodeGymShadowRoute(input: {
  taskClass: string;
  champions: Array<{
    taskClass: string;
    model: string;
    harness: string;
    eligible: boolean;
  }>;
  fallback: { model: string; harness: string };
}) {
  const champion = input.champions.find(
    (entry) => entry.taskClass === input.taskClass && entry.eligible,
  );
  return champion
    ? {
        mode: 'shadow' as const,
        model: champion.model,
        harness: champion.harness,
        userVisible: false as const,
      }
    : {
        mode: 'fallback' as const,
        ...input.fallback,
        userVisible: false as const,
      };
}

function pairReceipts(
  champion: NodeGymRunReceipt[],
  challenger: NodeGymRunReceipt[],
  comparisonMode: 'model' | 'harness',
) {
  const issues: string[] = [];
  const championByPair = uniquePromotionReceiptMap(champion, comparisonMode, 'champion', issues);
  const challengerByPair = uniquePromotionReceiptMap(
    challenger,
    comparisonMode,
    'challenger',
    issues,
  );
  const pairs: Array<{
    champion: NodeGymRunReceipt;
    challenger: NodeGymRunReceipt;
  }> = [];
  for (const [key, left] of championByPair) {
    const right = challengerByPair.get(key);
    if (!right) continue;
    if (comparisonMode === 'model') {
      if (effectiveModelIdentity(left) === effectiveModelIdentity(right))
        issues.push('model_pair_identity_not_distinct');
      if (harnessIdentity(left) !== harnessIdentity(right))
        issues.push('model_pair_harness_mismatch');
    } else {
      if (effectiveModelIdentity(left) !== effectiveModelIdentity(right))
        issues.push('harness_pair_model_mismatch');
      if (harnessIdentity(left) === harnessIdentity(right))
        issues.push('harness_pair_identity_not_distinct');
    }
    pairs.push({ champion: left, challenger: right });
  }
  return { pairs, issueCodes: [...new Set(issues)] };
}

function uniquePromotionReceiptMap(
  receipts: NodeGymRunReceipt[],
  mode: 'model' | 'harness',
  side: 'champion' | 'challenger',
  issues: string[],
) {
  const entries = new Map<string, NodeGymRunReceipt>();
  for (const receipt of receipts) {
    const key = promotionPairIdentity(receipt, mode);
    if (entries.has(key)) issues.push(`duplicate_${side}_pair_identity`);
    else entries.set(key, receipt);
  }
  return entries;
}

function promotionPairIdentity(receipt: NodeGymRunReceipt, mode: 'model' | 'harness') {
  const common = [receipt.taskId, receipt.taskClass, receipt.role, receipt.repetition];
  return mode === 'model'
    ? [...common, receipt.comparisonKey, harnessIdentity(receipt)].join('::')
    : [...common, receipt.harnessPairingKey, effectiveModelIdentity(receipt)].join('::');
}

function promotionCohortIdentity(
  champion: NodeGymRunReceipt,
  challenger: NodeGymRunReceipt,
  mode: 'model' | 'harness',
) {
  const common = [champion.taskId, champion.taskClass, champion.role];
  return mode === 'model'
    ? [
        ...common,
        harnessIdentity(champion),
        effectiveModelIdentity(champion),
        effectiveModelIdentity(challenger),
      ].join('::')
    : [
        ...common,
        effectiveModelIdentity(champion),
        harnessIdentity(champion),
        harnessIdentity(challenger),
      ].join('::');
}

function effectiveModelIdentity(receipt: NodeGymRunReceipt) {
  return receipt.returnedModel ?? receipt.modelId;
}

function harnessIdentity(receipt: NodeGymRunReceipt) {
  return `${receipt.harnessId}@${receipt.harnessVersion}`;
}

function canonicalRunStatus(status: NodeGymRunnerReceiptV2['status']): NodeGymRunStatus {
  if (status === 'provider-error') return 'provider-error';
  if (status === 'budget-exhausted') return 'budget-exhausted';
  return status === 'passed' ? 'passed' : 'failed';
}

function assertReceiptPlanIdentity(plan: NodeGymRunPlan, receipt: NodeGymRunReceipt) {
  if (
    receipt.runId !== plan.runId ||
    receipt.taskId !== plan.task.id ||
    receipt.taskClass !== plan.task.taskClass ||
    receipt.curriculumLevel !== plan.task.curriculumLevel ||
    receipt.modelId !== plan.model.id ||
    receipt.harnessId !== plan.harness.id ||
    receipt.harnessVersion !== plan.harness.version ||
    receipt.role !== plan.harness.role ||
    receipt.repetition !== plan.repetition ||
    receipt.comparisonKey !== plan.comparisonKey ||
    receipt.harnessPairingKey !== plan.harnessPairingKey
  )
    throw new Error('NodeGym receipt identity does not match its immutable run plan.');
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
