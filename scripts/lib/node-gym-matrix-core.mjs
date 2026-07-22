export const NODE_GYM_SCHEMA_VERSION = 'nodekit.gym/v1';

/**
 * Committed Node-runtime matrix compiler for the repository CLIs. Keep this
 * byte-for-byte behavior aligned with @nodekit/gym-core; the cross-contract
 * test prevents either side from changing persisted identities unnoticed.
 */
export function buildNodeGymMatrix(input) {
  if (!Number.isInteger(input?.repetitions) || input.repetitions < 1)
    throw new Error('NodeGym repetitions must be a positive integer.');
  if (
    !Array.isArray(input.tasks) ||
    !Array.isArray(input.models) ||
    !Array.isArray(input.harnesses)
  )
    throw new Error('NodeGym tasks, models, and harnesses must be arrays.');
  const runs = [];
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
          // Preserve the v0.0.1/nodekit.gym-v1 identity: model precedes
          // repetition and budget for harness-paired comparisons.
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

function budgetKey(budget) {
  if (!budget || typeof budget !== 'object') throw new Error('NodeGym budget is required.');
  return [budget.maxTokens, budget.maxLatencyMs, budget.maxCostMicroUsd, budget.maxRepairs].join(
    ':',
  );
}

function slug(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
}
