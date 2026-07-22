export const NODE_GYM_CORE_PACKAGE_VERSION = '0.0.1';
export const NODE_GYM_SCHEMA_VERSION = 'nodekit.gym/v1';

export function buildNodeGymMatrix(input) {
  if (!Number.isInteger(input.repetitions) || input.repetitions < 1) {
    throw new Error('NodeGym repetitions must be a positive integer.');
  }
  const runs = [];
  for (const task of input.tasks) {
    for (const model of input.models) {
      for (const harness of input.harnesses) {
        for (let repetition = 1; repetition <= input.repetitions; repetition += 1) {
          const budgetKey = [
            input.budget.maxTokens,
            input.budget.maxLatencyMs,
            input.budget.maxCostMicroUsd,
            input.budget.maxRepairs,
          ].join(':');
          const pairingKey = [
            task.taskDigest,
            task.evidenceDigest,
            task.referenceDigest,
            model.id,
            repetition,
            budgetKey,
          ].join('::');
          runs.push({
            schemaVersion: NODE_GYM_SCHEMA_VERSION,
            runId: `${task.id}__${model.id}__${harness.id}__${repetition}`,
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
