import { partitionDisabledNodeGymRuns } from './node-gym-config-core.mjs';
import { applyPairSafeLimit, selectNodeGymSubset } from './node-gym-runner-core.mjs';
import { filterNodeGymRunsForRuntime } from './node-gym-task-core.mjs';

/**
 * Which matrix runs a campaign executes. The order is load-bearing: explicit filters first, then the
 * disabled-model partition, and only THEN runtime filtering and subset selection, because
 * `selectNodeGymSubset` derives its model list from the runs it receives, so a disabled model that
 * is partitioned out first yields no pair and `--subset all` drops exactly its runs.
 */
export function selectNodeGymCampaignRuns({
  matrix,
  config,
  filters,
  subset,
  limit = Number.POSITIVE_INFINITY,
  includeDisabled = false,
  runtime = process.env,
}) {
  const explicitlyFilteredRuns = matrix.runs.filter(
    (run) =>
      (!filters.tasks.length || filters.tasks.includes(run.task.id)) &&
      (!filters.models.length || filters.models.includes(run.model.id)) &&
      (!filters.harnesses.length || filters.harnesses.includes(run.harness.id)) &&
      (!filters.repetitions.length || filters.repetitions.includes(run.repetition)),
  );
  const { runnable, skippedDisabled } = partitionDisabledNodeGymRuns({
    runs: explicitlyFilteredRuns,
    includeDisabled,
    requestedModels: filters.models,
  });
  const filteredRuns = filterNodeGymRunsForRuntime({
    runs: runnable,
    tasks: config.tasks,
    runtime,
    explicitTaskIds: filters.tasks,
  });
  if (!filteredRuns.length) throw new Error('Explicit NodeGym selection matched no matrix runs.');
  return {
    selectedRuns: applyPairSafeLimit(
      selectNodeGymSubset({ ...matrix, runs: filteredRuns }, subset),
      limit,
    ),
    skippedDisabled,
  };
}
