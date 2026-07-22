#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const matrixPath = path.resolve(
  option('matrix') ?? 'artifacts/deck-gym/artifact-atlas-v1/matrix.json',
);
const artifactRoot = path.resolve(
  option('artifact-root') ?? 'artifacts/deck-gym/artifact-atlas-v1',
);
const resultDir = path.join(artifactRoot, 'plan-results');
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
if (matrix?.schemaVersion !== 'nodeslide.artifact-arena-matrix/v1') {
  throw new Error('Artifact Arena matrix is invalid.');
}

const fixtureFilter = new Set(csvOption('fixtures'));
const modelFilter = new Set(csvOption('models'));
const directionFilter = new Set(csvOption('directions'));
const limit = positiveInteger(option('limit'), Number.MAX_SAFE_INTEGER);
const batchSize = Math.min(3, positiveInteger(option('batch-size'), 3));
const resume = !process.argv.includes('--no-resume');
const candidates = matrix.candidates
  .filter(
    (candidate) =>
      (!fixtureFilter.size || fixtureFilter.has(candidate.fixtureId)) &&
      (!modelFilter.size || modelFilter.has(candidate.model)) &&
      (!directionFilter.size || directionFilter.has(candidate.directionId)),
  )
  .slice(0, limit);

await mkdir(resultDir, { recursive: true });
const receipts = [];
const pendingModels = [];
for (const candidate of candidates) {
  const outputPath = path.join(resultDir, `${candidate.candidateId}.json`);
  if (resume) {
    const existing = await readJson(outputPath).catch(() => null);
    if (existing?.status === 'passed') {
      receipts.push(existing);
      console.log(`[artifact-arena] SKIP ${candidate.candidateId}`);
      continue;
    }
  }
  if (candidate.candidateKind === 'deterministic-baseline') {
    const result = deterministicResult(candidate);
    await writeJson(outputPath, result);
    receipts.push(result);
    console.log(`[artifact-arena] BASELINE ${candidate.candidateId}`);
  } else {
    pendingModels.push(candidate);
  }
}

for (let index = 0; index < pendingModels.length; index += batchSize) {
  const batch = pendingModels.slice(index, index + batchSize);
  console.log(
    `[artifact-arena] MODEL batch ${Math.floor(index / batchSize) + 1}/${Math.ceil(pendingModels.length / batchSize)} (${batch.map((candidate) => candidate.candidateId).join(', ')})`,
  );
  const results = await runConvexBatch(batch);
  for (const result of results) {
    await writeJson(path.join(resultDir, `${result.candidateId}.json`), result);
    receipts.push(result);
    console.log(`[artifact-arena] ${result.status.toUpperCase()} ${result.candidateId}`);
  }
}

receipts.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
const summary = {
  schemaVersion: 'nodeslide.artifact-arena-plan-summary/v1',
  matrixDigest: matrix.matrixDigest,
  generatedAt: new Date().toISOString(),
  requestedCandidates: candidates.length,
  passed: receipts.filter((receipt) => receipt.status === 'passed').length,
  failed: receipts.filter((receipt) => receipt.status !== 'passed').length,
  modelCandidates: receipts.filter((receipt) => receipt.candidateKind !== 'deterministic-baseline')
    .length,
  deterministicBaselines: receipts.filter(
    (receipt) => receipt.candidateKind === 'deterministic-baseline',
  ).length,
  receipts: receipts.map((receipt) => ({
    candidateId: receipt.candidateId,
    status: receipt.status,
    model: receipt.model,
    durationMs: receipt.durationMs,
    failure: receipt.failure,
  })),
};
await writeJson(path.join(artifactRoot, 'plan-summary.json'), summary);
console.log(`[artifact-arena] ${summary.passed}/${receipts.length} plans passed`);
if (summary.failed) process.exitCode = 1;

async function runConvexBatch(candidatesToRun) {
  const executable = process.execPath;
  const convexCli = path.join(root, 'node_modules', 'convex', 'bin', 'main.js');
  const args = [
    convexCli,
    'run',
    'nodeslideArtifactArena:runBatch',
    JSON.stringify({
      candidateJsons: candidatesToRun.map((candidate) => JSON.stringify(candidate)),
    }),
    '--prod',
  ];
  const child = spawn(executable, args, {
    cwd: root,
    env: { ...process.env, CONVEX_DEPLOYMENT: 'prod:agile-stoat-411' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-20_000);
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (exitCode !== 0) throw new Error(safeError(stderr || stdout));
  const parsed = JSON.parse(stdout.trim());
  if (!Array.isArray(parsed) || parsed.length !== candidatesToRun.length) {
    throw new Error('Artifact Arena batch returned an invalid result count.');
  }
  return parsed.map((result, index) => ({
    ...result,
    candidateKind: candidatesToRun[index].candidateKind,
  }));
}

function deterministicResult(candidate) {
  const plan = {
    artifactType: candidate.artifactType,
    title: candidate.allowedClaims[0] ?? candidate.artifactType,
    takeaway: candidate.narrativeJob,
    annotation: candidate.allowedClaims[1] ?? candidate.allowedClaims[0] ?? '',
    composition: baselineComposition(candidate.artifactType),
    emphasis: 'position',
    density: 'balanced',
    operations: candidate.artifactContract.requiredOperations.map((operationId, index) => ({
      operationId,
      label: humanize(operationId),
      value: candidate.allowedClaims[index % candidate.allowedClaims.length] ?? '',
      sourceId: candidate.sourceIds[index % candidate.sourceIds.length],
    })),
    sourceLabels: candidate.evidence.map((source) => ({
      sourceId: source.sourceId,
      label: source.label,
    })),
    pptxFallback: candidate.artifactContract.fallbackPolicy,
  };
  return {
    schemaVersion: 'nodeslide.artifact-arena-plan-result/v1',
    candidateId: candidate.candidateId,
    candidateDigest: candidate.candidateDigest,
    candidateKind: candidate.candidateKind,
    fixtureId: candidate.fixtureId,
    artifactType: candidate.artifactType,
    model: candidate.model,
    directionId: candidate.directionId,
    durationMs: 0,
    status: 'passed',
    plan,
    telemetry: {
      provider: 'deterministic',
      model: candidate.model,
      reasoningEffort: 'low',
      costMicroUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
    },
  };
}

function baselineComposition(artifactType) {
  if (artifactType.includes('timeline') || artifactType.includes('series')) return 'progressive';
  if (artifactType.includes('architecture') || artifactType.includes('sequence')) return 'split';
  if (artifactType.includes('lineage')) return 'diagonal';
  return 'focal';
}

function humanize(value) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join(' ');
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function csvOption(name) {
  return (option(name) ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function safeError(error) {
  return String(error)
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/\b(?:prod|dev|preview):[^|\s]+\|[^\s"']+/giu, '[REDACTED_DEPLOY_KEY]')
    .replace(/\b[A-Za-z0-9_-]{64,}\b/gu, '[REDACTED_LONG_VALUE]')
    .slice(0, 1000);
}
