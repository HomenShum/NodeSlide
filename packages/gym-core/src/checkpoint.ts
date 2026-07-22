export const NODE_GYM_TRAINING_PAIR_SCHEMA_VERSION = 'nodekit.gym-training-pair/v1' as const;
export const NODE_GYM_CHECKPOINT_REPLAY_SCHEMA_VERSION =
  'nodekit.gym-checkpoint-replay/v1' as const;

export interface NodeGymPairCandidate {
  runId: string;
  taskId: string;
  comparisonKey: string;
  harnessPairingKey: string;
  episodeDigest: string;
  artifactDigest: string;
  hardGatesPassed: boolean;
  issueCodes: string[];
  observableTrajectory: unknown;
}

export interface NodeGymTrainingPair {
  schemaVersion: typeof NODE_GYM_TRAINING_PAIR_SCHEMA_VERSION;
  pairId: string;
  taskId: string;
  comparisonKey: string;
  harnessPairingKey: string;
  accepted: NodeGymPairCandidate;
  rejected: NodeGymPairCandidate;
  correction: {
    issueCodes: string[];
    correctedToolCalls: unknown[];
    repairOperations: unknown[];
  };
  preference: {
    reviewerType: 'human';
    winner: 'accepted';
    reasonCodes: string[];
  };
  excludesHiddenReasoning: true;
}

export function buildNodeGymTrainingPair(input: {
  pairId: string;
  accepted: NodeGymPairCandidate;
  rejected: NodeGymPairCandidate;
  correctedToolCalls?: unknown[];
  repairOperations?: unknown[];
  humanPreference: {
    reviewerType: 'human';
    winner: 'accepted';
    reasonCodes: string[];
  };
}): NodeGymTrainingPair {
  const { accepted, rejected } = input;
  if (!input.pairId.trim()) throw new Error('Training pair ID is required.');
  for (const candidate of [accepted, rejected]) validatePairCandidate(candidate);
  if (
    accepted.taskId !== rejected.taskId ||
    accepted.comparisonKey !== rejected.comparisonKey ||
    accepted.harnessPairingKey !== rejected.harnessPairingKey
  )
    throw new Error('Training candidates must share the exact immutable task and harness state.');
  if (!accepted.hardGatesPassed)
    throw new Error('Accepted training candidate must pass every automated hard gate.');
  if (rejected.hardGatesPassed || rejected.issueCodes.length === 0)
    throw new Error('Rejected training candidate must retain concrete failing issue codes.');
  if (accepted.artifactDigest === rejected.artifactDigest)
    throw new Error('Accepted and rejected candidates must be materially distinct.');
  if (
    input.humanPreference.reviewerType !== 'human' ||
    input.humanPreference.winner !== 'accepted' ||
    input.humanPreference.reasonCodes.length === 0
  )
    throw new Error('Training pairs require an explicit human preference and reason code.');
  const correctedToolCalls = input.correctedToolCalls ?? [];
  const repairOperations = input.repairOperations ?? [];
  if (correctedToolCalls.length === 0 && repairOperations.length === 0)
    throw new Error('Training pairs require an observable correction or repair.');
  const observable = {
    accepted: accepted.observableTrajectory,
    rejected: rejected.observableTrajectory,
    correctedToolCalls,
    repairOperations,
  };
  if (forbiddenReasoningPaths(observable).length > 0)
    throw new Error('Training pairs may not contain hidden reasoning or scratchpad fields.');
  return {
    schemaVersion: NODE_GYM_TRAINING_PAIR_SCHEMA_VERSION,
    pairId: input.pairId,
    taskId: accepted.taskId,
    comparisonKey: accepted.comparisonKey,
    harnessPairingKey: accepted.harnessPairingKey,
    accepted,
    rejected,
    correction: {
      issueCodes: [...new Set(rejected.issueCodes)].sort(),
      correctedToolCalls,
      repairOperations,
    },
    preference: {
      reviewerType: 'human',
      winner: 'accepted',
      reasonCodes: [...new Set(input.humanPreference.reasonCodes)].sort(),
    },
    excludesHiddenReasoning: true,
  };
}

export interface NodeGymCheckpointAdapter<TCase, TOutput> {
  adapterId: string;
  provider: string;
  execution: 'local-fake' | 'external';
  train(input: {
    pairDigests: string[];
    datasetDigest: string;
    maxCostMicroUsd: number;
  }): Promise<{
    checkpointId: string;
    datasetDigest: string;
    costMicroUsd: number;
  }>;
  sample(input: {
    checkpointId: string;
    caseId: string;
    input: TCase;
  }): Promise<{
    checkpointId: string;
    output: TOutput;
    costMicroUsd: number;
  }>;
}

export async function runNodeGymCheckpointReplay<TCase, TOutput>(input: {
  adapter: NodeGymCheckpointAdapter<TCase, TOutput>;
  pairDigests: string[];
  datasetDigest: string;
  holdoutCases: Array<{ id: string; digest: string; input: TCase }>;
  maxCostMicroUsd: number;
  externalTrainingAuthorized: boolean;
  evaluate: (value: {
    caseId: string;
    caseDigest: string;
    output: TOutput;
  }) => { hardGatesPassed: boolean; issueCodes: string[] };
}) {
  if (!input.adapter.adapterId.trim() || !input.adapter.provider.trim())
    throw new Error('Checkpoint adapter identity is required.');
  if (input.adapter.execution === 'external' && !input.externalTrainingAuthorized)
    throw new Error('External checkpoint training requires separate explicit authorization.');
  if (!Number.isInteger(input.maxCostMicroUsd) || input.maxCostMicroUsd < 0)
    throw new Error('Checkpoint replay cost cap must be a non-negative integer.');
  if (!isDigest(input.datasetDigest) || input.pairDigests.length === 0)
    throw new Error('Checkpoint replay requires a digest-bound non-empty training dataset.');
  if (input.pairDigests.some((value) => !isDigest(value)))
    throw new Error('Checkpoint replay training-pair digest is invalid.');
  if (input.holdoutCases.length === 0)
    throw new Error('Checkpoint replay requires at least one held-out case.');
  if (input.holdoutCases.some((entry) => !entry.id.trim() || !isDigest(entry.digest)))
    throw new Error('Checkpoint replay held-out identity is invalid.');
  const trainingDigests = new Set(input.pairDigests.map(normalizeDigest));
  if (input.holdoutCases.some((entry) => trainingDigests.has(normalizeDigest(entry.digest))))
    throw new Error('Checkpoint replay cannot train on a held-out digest.');

  const trained = await input.adapter.train({
    pairDigests: [...input.pairDigests],
    datasetDigest: input.datasetDigest,
    maxCostMicroUsd: input.maxCostMicroUsd,
  });
  if (
    !trained.checkpointId.trim() ||
    normalizeDigest(trained.datasetDigest) !== normalizeDigest(input.datasetDigest)
  )
    throw new Error('Checkpoint adapter returned unbound training lineage.');
  validateCost(trained.costMicroUsd, input.maxCostMicroUsd);
  let totalCostMicroUsd = trained.costMicroUsd;
  const cases = [];
  for (const heldOut of input.holdoutCases) {
    const sampled = await input.adapter.sample({
      checkpointId: trained.checkpointId,
      caseId: heldOut.id,
      input: heldOut.input,
    });
    if (sampled.checkpointId !== trained.checkpointId)
      throw new Error('Checkpoint sample returned a different checkpoint identity.');
    validateCost(sampled.costMicroUsd, input.maxCostMicroUsd);
    totalCostMicroUsd += sampled.costMicroUsd;
    if (totalCostMicroUsd > input.maxCostMicroUsd)
      throw new Error('Checkpoint replay exceeded its explicit cost cap.');
    const evaluation = input.evaluate({
      caseId: heldOut.id,
      caseDigest: heldOut.digest,
      output: sampled.output,
    });
    cases.push({
      caseId: heldOut.id,
      caseDigest: normalizeDigest(heldOut.digest),
      checkpointId: trained.checkpointId,
      hardGatesPassed: evaluation.hardGatesPassed,
      issueCodes: [...new Set(evaluation.issueCodes)].sort(),
      costMicroUsd: sampled.costMicroUsd,
    });
  }
  const hardGatesPassed = cases.every(
    (entry) => entry.hardGatesPassed && entry.issueCodes.length === 0,
  );
  return {
    schemaVersion: NODE_GYM_CHECKPOINT_REPLAY_SCHEMA_VERSION,
    adapterId: input.adapter.adapterId,
    provider: input.adapter.provider,
    execution: input.adapter.execution,
    checkpointId: trained.checkpointId,
    datasetDigest: normalizeDigest(input.datasetDigest),
    pairDigests: input.pairDigests.map(normalizeDigest).sort(),
    cases,
    hardGatesPassed,
    status: hardGatesPassed ? ('passed' as const) : ('failed' as const),
    totalCostMicroUsd,
    autoApply: false as const,
    routingMutationApplied: false as const,
  };
}

function validatePairCandidate(candidate: NodeGymPairCandidate) {
  if (
    !candidate.runId.trim() ||
    !candidate.taskId.trim() ||
    !candidate.comparisonKey.trim() ||
    !candidate.harnessPairingKey.trim() ||
    !isDigest(candidate.episodeDigest) ||
    !isDigest(candidate.artifactDigest)
  )
    throw new Error('Training candidate identity or digest is invalid.');
  if (forbiddenReasoningPaths(candidate.observableTrajectory).length > 0)
    throw new Error('Training candidate may not contain hidden reasoning or scratchpad fields.');
}

function validateCost(value: number, cap: number) {
  if (!Number.isInteger(value) || value < 0 || value > cap)
    throw new Error('Checkpoint adapter returned invalid or over-cap cost.');
}

function isDigest(value: string) {
  return /^(?:sha256:)?[a-f0-9]{64}$/u.test(String(value).trim().toLowerCase());
}

function normalizeDigest(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized.startsWith('sha256:') ? normalized : `sha256:${normalized}`;
}

function forbiddenReasoningPaths(value: unknown, path = ''): string[] {
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
    return [...(forbidden.has(normalized) ? [next] : []), ...forbiddenReasoningPaths(entry, next)];
  });
}
