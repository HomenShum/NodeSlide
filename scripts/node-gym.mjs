#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildNodeGymMatrix } from '../shared/nodeslideGym.ts';

const command = process.argv[2] ?? 'validate';
const root = process.cwd();
const configPath = path.resolve(option('config') ?? 'benchmarks/deck-gym/v2/gym.json');
const outputRoot = path.resolve(
  option('artifact-dir') ?? 'artifacts/node-gym/nodeslide-deck-gym-v2',
);
const rawConfig = await readFile(configPath, 'utf8');
const config = JSON.parse(rawConfig);
const validation = validateConfig(config);
await mkdir(outputRoot, { recursive: true });

if (command === 'validate') {
  const receipt = {
    schemaVersion: 'nodekit.gym-config-validation/v1',
    gymVersion: config.gymVersion,
    configDigest: sha256(rawConfig),
    status: validation.failures.length ? 'failed' : 'passed',
    matrixSize: validation.matrixSize,
    failures: validation.failures,
  };
  await writeJson(path.join(outputRoot, 'configuration-validation.json'), receipt);
  console.log(`[node-gym] ${receipt.status.toUpperCase()} matrix=${receipt.matrixSize}`);
  if (receipt.failures.length) {
    console.error(receipt.failures.join('\n'));
    process.exitCode = 1;
  }
} else if (command === 'matrix') {
  if (validation.failures.length) throw new Error(validation.failures.join('\n'));
  const tasks = config.tasks.map((task) => ({
    id: task.id,
    taskClass: task.taskClass,
    curriculumLevel: task.curriculumLevel,
    pool: task.pool,
    taskDigest: sha256(task.task),
    evidenceDigest: sha256(task.evidence),
    referenceDigest: sha256(task.reference),
  }));
  const runs = buildNodeGymMatrix({
    tasks,
    models: config.models,
    harnesses: config.harnesses,
    budget: config.budget,
    repetitions: config.repetitions,
  });
  const matrix = {
    schemaVersion: 'nodekit.gym-matrix/v1',
    gymVersion: config.gymVersion,
    configDigest: sha256(rawConfig),
    runCount: runs.length,
    pairedComparisonReady: true,
    promotionAutoApply: false,
    runs,
  };
  const outputPath = path.resolve(option('out') ?? path.join(outputRoot, 'matrix.json'));
  await writeJson(outputPath, matrix);
  console.log(`[node-gym] planned ${runs.length} paired repeated runs`);
  console.log(`[node-gym] matrix: ${path.relative(root, outputPath)}`);
} else {
  console.error('Usage: node scripts/node-gym.mjs <validate|matrix> [--config path] [--out path]');
  process.exitCode = 1;
}

function validateConfig(value) {
  const failures = [];
  if (value.schemaVersion !== 'nodekit.gym-config/v1') failures.push('Unsupported gym schema.');
  if (!Number.isInteger(value.repetitions) || value.repetitions < 3)
    failures.push('At least three repetitions are required.');
  const pools = new Set(value.tasks?.map((task) => task.pool));
  for (const pool of [
    'public-development',
    'hidden-validation',
    'rotating-challenge',
    'live-shadow',
  ])
    if (!pools.has(pool)) failures.push(`Missing task pool: ${pool}.`);
  for (const task of value.tasks ?? []) {
    if (task.pool !== 'public-development' && task.trainingEligible !== false)
      failures.push(`${task.id} must not be training eligible.`);
  }
  const cohorts = new Set(value.models?.map((model) => model.cohort));
  for (const cohort of [
    'frontier',
    'mid-tier',
    'small-legacy',
    'pinned-free',
    'random-router',
    'control',
  ])
    if (!cohorts.has(cohort)) failures.push(`Missing model cohort: ${cohort}.`);
  for (const model of value.models ?? []) {
    if (['pinned-free', 'random-router'].includes(model.cohort) && !model.returnedModelRequired)
      failures.push(`${model.id} must record the returned model.`);
    if (model.cohort === 'pinned-free' && !model.route.endsWith(':free'))
      failures.push(`${model.id} is not a pinned free route.`);
  }
  const profiles = new Set(value.harnesses?.map((profile) => profile.id));
  for (const id of [
    'light-director',
    'structured-planner',
    'bounded-executor',
    'repair-specialist',
    'router-robustness',
  ])
    if (!profiles.has(id)) failures.push(`Missing harness profile: ${id}.`);
  if (value.promotion?.autoApply !== false) failures.push('Promotion autoApply must remain false.');
  if (value.promotion?.requiresHumanReview !== true)
    failures.push('Promotion must require human review.');
  const matrixSize =
    (value.tasks?.length ?? 0) *
    (value.models?.length ?? 0) *
    (value.harnesses?.length ?? 0) *
    (value.repetitions ?? 0);
  if (matrixSize !== value.expectedMatrixSize)
    failures.push(`Expected matrix ${value.expectedMatrixSize}, computed ${matrixSize}.`);
  return { failures, matrixSize };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sha256(value) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${compactShortStringArrays(JSON.stringify(value, null, 2))}\n`);
}

function compactShortStringArrays(json) {
  return json.replace(
    /(\s+"[^"]+": )\[\n((?:\s+"(?:[^"\\]|\\.)*"(?:,\n)?)+)\s+\]/g,
    (match, prefix, body) => {
      const values = body
        .trim()
        .split(/\r?\n/)
        .map((line) => line.trim().replace(/,$/, ''));
      const compact = `${prefix}[${values.join(', ')}]`;
      return compact.length <= 100 ? compact : match;
    },
  );
}
