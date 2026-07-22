import { createHash } from 'node:crypto';
import { assertNoProtectedFixturePlaintext } from './node-gym-task-core.mjs';

const REQUIRED_POOLS = [
  'public-development',
  'hidden-validation',
  'rotating-challenge',
  'live-shadow',
];
const REQUIRED_COHORTS = [
  'frontier',
  'mid-tier',
  'small-legacy',
  'pinned-free',
  'random-router',
  'control',
];
const REQUIRED_HARNESSES = [
  'light-director',
  'structured-planner',
  'bounded-executor',
  'repair-specialist',
  'router-robustness',
];

export function validateNodeGymConfig(value) {
  const failures = [];
  if (value?.schemaVersion !== 'nodekit.gym-config/v1') failures.push('Unsupported gym schema.');
  if (typeof value?.gymVersion !== 'string' || !value.gymVersion.trim())
    failures.push('Gym version is required.');
  if (!Number.isInteger(value?.repetitions) || value.repetitions < 3)
    failures.push('At least three repetitions are required.');
  for (const [label, entries] of [
    ['task', value?.tasks],
    ['model', value?.models],
    ['harness', value?.harnesses],
  ]) {
    if (!Array.isArray(entries) || entries.length === 0)
      failures.push(`At least one ${label} is required.`);
    else if (new Set(entries.map((entry) => entry?.id)).size !== entries.length)
      failures.push(`NodeGym ${label} ids must be unique.`);
  }

  const tasks = Array.isArray(value?.tasks) ? value.tasks : [];
  const pools = new Set(tasks.map((task) => task.pool));
  for (const pool of REQUIRED_POOLS)
    if (!pools.has(pool)) failures.push(`Missing task pool: ${pool}.`);
  for (const task of tasks) {
    if (typeof task?.id !== 'string' || !task.id.trim()) failures.push('Task id is required.');
    for (const field of ['task', 'evidence', 'reference'])
      if (typeof task?.[field] !== 'string' || !task[field].trim())
        failures.push(`${task?.id ?? '<unknown>'} ${field} is required.`);
    if (task.pool !== 'public-development' && task.trainingEligible !== false)
      failures.push(`${task.id} must not be training eligible.`);
  }
  const protectedPolicy = assertNoProtectedFixturePlaintext(value);
  for (const issue of protectedPolicy.issueCodes)
    failures.push(`Protected fixture policy: ${issue}.`);

  const models = Array.isArray(value?.models) ? value.models : [];
  const cohorts = new Set(models.map((model) => model.cohort));
  for (const cohort of REQUIRED_COHORTS)
    if (!cohorts.has(cohort)) failures.push(`Missing model cohort: ${cohort}.`);
  for (const model of models) {
    if (typeof model?.id !== 'string' || !model.id.trim()) failures.push('Model id is required.');
    if (typeof model?.route !== 'string' || !model.route.trim())
      failures.push(`${model?.id ?? '<unknown>'} route is required.`);
    if (['pinned-free', 'random-router'].includes(model.cohort) && !model.returnedModelRequired)
      failures.push(`${model.id} must record the returned model.`);
    if (model.cohort === 'pinned-free' && !model.route.endsWith(':free'))
      failures.push(`${model.id} is not a pinned free route.`);
  }

  const harnesses = Array.isArray(value?.harnesses) ? value.harnesses : [];
  const profiles = new Set(harnesses.map((profile) => profile.id));
  for (const id of REQUIRED_HARNESSES)
    if (!profiles.has(id)) failures.push(`Missing harness profile: ${id}.`);
  if (value?.promotion?.autoApply !== false)
    failures.push('Promotion autoApply must remain false.');
  if (value?.promotion?.requiresHumanReview !== true)
    failures.push('Promotion must require human review.');

  for (const field of ['maxTokens', 'maxLatencyMs', 'maxCostMicroUsd', 'maxRepairs']) {
    const amount = value?.budget?.[field];
    const minimum = field === 'maxCostMicroUsd' || field === 'maxRepairs' ? 0 : 1;
    if (!Number.isSafeInteger(amount) || amount < minimum)
      failures.push(`Budget ${field} is invalid.`);
  }
  const matrixSize = tasks.length * models.length * harnesses.length * (value?.repetitions ?? 0);
  if (matrixSize !== value?.expectedMatrixSize)
    failures.push(`Expected matrix ${value?.expectedMatrixSize}, computed ${matrixSize}.`);
  return { failures: [...new Set(failures)], matrixSize };
}

export function buildNodeGymMatrixInput(config) {
  return {
    tasks: config.tasks.map((task) => ({
      id: task.id,
      taskClass: task.taskClass,
      curriculumLevel: task.curriculumLevel,
      pool: task.pool,
      taskDigest: sha256Text(task.task),
      evidenceDigest: sha256Text(task.evidence),
      referenceDigest: sha256Text(task.reference),
    })),
    models: config.models,
    harnesses: config.harnesses,
    budget: config.budget,
    repetitions: config.repetitions,
  };
}

function sha256Text(value) {
  if (typeof value !== 'string') throw new Error('NodeGym task identity fields must be strings.');
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
