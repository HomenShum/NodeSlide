#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { renderArtifactArenaCandidate } from './lib/artifact-arena-renderer.mjs';
import { createArtifactShowcaseReceipt } from './lib/artifact-atlas-core.mjs';

const root = process.cwd();
const matrixPath = path.resolve(
  option('matrix') ?? 'artifacts/deck-gym/artifact-atlas-v1/matrix.json',
);
const artifactRoot = path.resolve(
  option('artifact-root') ?? 'artifacts/deck-gym/artifact-atlas-v1',
);
const planDir = path.join(artifactRoot, 'plan-results');
const runsDir = path.join(artifactRoot, 'runs');
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
const planResults = await readPlanResults(planDir);
const plansByCandidate = new Map(planResults.map((result) => [result.candidateId, result]));
const fixtureFilter = new Set(csvOption('fixtures'));
const modelFilter = new Set(csvOption('models'));
const directionFilter = new Set(csvOption('directions'));
const limit = positiveInteger(option('limit'), Number.MAX_SAFE_INTEGER);
const concurrency = positiveInteger(option('concurrency'), 4);
const onlyFailed = process.argv.includes('--only-failed');
const existingStatuses = onlyFailed ? await readRunStatuses(runsDir) : new Map();
const partialRun =
  fixtureFilter.size > 0 ||
  modelFilter.size > 0 ||
  directionFilter.size > 0 ||
  onlyFailed ||
  limit !== Number.MAX_SAFE_INTEGER;
const candidates = matrix.candidates
  .filter(
    (candidate) =>
      plansByCandidate.get(candidate.candidateId)?.status === 'passed' &&
      (!fixtureFilter.size || fixtureFilter.has(candidate.fixtureId)) &&
      (!modelFilter.size || modelFilter.has(candidate.model)) &&
      (!directionFilter.size || directionFilter.has(candidate.directionId)) &&
      (!onlyFailed || existingStatuses.get(candidate.candidateId) !== 'eligible'),
  )
  .slice(0, limit);

await mkdir(runsDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const receipts = [];
let nextCandidateIndex = 0;
try {
  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, (_, workerIndex) =>
      renderWorker(workerIndex + 1),
    ),
  );
} finally {
  await browser.close();
}

async function renderWorker(workerId) {
  while (nextCandidateIndex < candidates.length) {
    const candidate = candidates[nextCandidateIndex];
    nextCandidateIndex += 1;
    const complete = await renderCandidate(candidate, workerId);
    receipts.push(complete);
  }
}

async function renderCandidate(candidate, workerId) {
  const result = plansByCandidate.get(candidate.candidateId);
  const outputDir = path.join(runsDir, candidate.candidateId);
  console.log(`[artifact-arena:w${workerId}] RENDER ${candidate.candidateId}`);
  const rendered = await renderArtifactArenaCandidate({ candidate, result, outputDir, browser });
  const renderedDir = path.join(outputDir, 'pptx-rendered');
  const pptxRender = path.join(renderedDir, 'slide-1.png');
  let exportPassed = false;
  let exportFailure = null;
  try {
    await renderAndTestPptx(rendered.pptxFile, renderedDir);
    exportPassed = true;
  } catch (error) {
    exportFailure = safeError(error);
  }
  const evaluation = evaluateCandidate({ candidate, result, rendered, exportPassed });
  const receipt = createArtifactShowcaseReceipt({
    candidate,
    evaluation: {
      ...evaluation,
      generationMs: result.durationMs,
      inputTokens: result.telemetry?.inputTokens,
      outputTokens: result.telemetry?.outputTokens,
      costMicroUsd: result.telemetry?.costMicroUsd,
    },
    outputs: {
      browserRender: relativeArtifactPath(rendered.browserRender),
      pptxRender: exportPassed ? relativeArtifactPath(pptxRender) : null,
      pptxFile: exportPassed ? relativeArtifactPath(rendered.pptxFile) : null,
      webPptxDifference: candidate.artifactContract.fallbackPolicy,
    },
    tools: ['nodeslide-artifact-builder-v1', 'pptxgenjs', 'playwright'],
  });
  const complete = {
    ...receipt,
    claimCoverage: evaluation.claimCoverage,
    forbiddenClaims: evaluation.forbiddenClaims,
    exportFailure,
    primitiveKinds: rendered.primitiveKinds,
  };
  await writeJson(path.join(outputDir, 'receipt.json'), complete);
  console.log(
    `[artifact-arena:w${workerId}] ${receipt.status.toUpperCase()} ${candidate.candidateId}`,
  );
  return complete;
}

const receiptPath = path.join(artifactRoot, 'receipts.json');
// Per-candidate receipts are authoritative. A killed full run may leave the
// aggregate file stale, so incremental repair must rebuild from the run dirs.
const previousReceipts = partialRun ? await readAllRunReceipts(runsDir) : [];
const combinedReceipts = [
  ...new Map(
    [...previousReceipts, ...receipts].map((receipt) => [receipt.candidateId, receipt]),
  ).values(),
].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
await writeJson(receiptPath, combinedReceipts);
const summary = {
  schemaVersion: 'nodeslide.artifact-arena-render-summary/v1',
  generatedAt: new Date().toISOString(),
  requestedCandidates: combinedReceipts.length,
  rerenderedCandidates: candidates.length,
  eligible: combinedReceipts.filter((receipt) => receipt.status === 'eligible').length,
  failed: combinedReceipts.filter((receipt) => receipt.status !== 'eligible').length,
  byArtifact: Object.values(
    combinedReceipts.reduce((groups, receipt) => {
      const entry = groups[receipt.artifactType] ?? {
        artifactType: receipt.artifactType,
        candidates: 0,
        eligible: 0,
      };
      entry.candidates += 1;
      if (receipt.status === 'eligible') entry.eligible += 1;
      groups[receipt.artifactType] = entry;
      return groups;
    }, {}),
  ),
};
await writeJson(path.join(artifactRoot, 'render-summary.json'), summary);
console.log(`[artifact-arena] ${summary.eligible}/${combinedReceipts.length} artifacts eligible`);
if (summary.failed) process.exitCode = 1;

function evaluateCandidate({ candidate, result, rendered, exportPassed }) {
  const artifactTypeMatched = result.plan?.artifactType === candidate.artifactType;
  const requiredOperations = new Set(candidate.artifactContract.requiredOperations);
  const observedOperations = new Set(
    (result.plan?.operations ?? []).map((operation) => operation.operationId),
  );
  const operationCoverage = [...requiredOperations].filter((operation) =>
    observedOperations.has(operation),
  ).length;
  const sourceBound = (result.plan?.operations ?? []).every((operation) =>
    candidate.sourceIds.includes(operation.sourceId),
  );
  const visible = normalize(rendered.visibleText.join(' '));
  const matchedClaims = candidate.allowedClaims.filter((claim) => claimMatches(visible, claim));
  const claimCoverage = candidate.allowedClaims.length
    ? matchedClaims.length / candidate.allowedClaims.length
    : 1;
  const forbiddenClaims = candidate.forbiddenClaims.filter((claim) =>
    forbiddenClaimMatches(visible, claim),
  );
  const evidencePassed =
    sourceBound && forbiddenClaims.length === 0 && result.plan?.sourceLabels?.length > 0;
  const briefAdherence =
    operationCoverage === requiredOperations.size && claimCoverage >= 0.6 && evidencePassed;
  return {
    briefAdherence,
    visualPassed: rendered.primitiveKinds.length >= 3,
    evidencePassed,
    exportPassed,
    artifactTypeMatched,
    editabilityPassed: exportPassed,
    repairCount: 0,
    claimCoverage,
    forbiddenClaims,
  };
}

async function renderAndTestPptx(pptxFile, renderedDir) {
  const tools = presentationTools();
  await mkdir(renderedDir, { recursive: true });
  await runProcess(tools.python, [
    tools.render,
    pptxFile,
    '--output_dir',
    renderedDir,
    '--width',
    '1600',
    '--height',
    '900',
  ]);
  await runProcess(tools.python, [tools.test, pptxFile]);
}

function presentationTools() {
  const python = process.env.DECK_GYM_PYTHON;
  const render = process.env.DECK_GYM_RENDER_SLIDES;
  const test = process.env.DECK_GYM_SLIDES_TEST;
  if (!python || !render || !test) {
    throw new Error(
      'Set DECK_GYM_PYTHON, DECK_GYM_RENDER_SLIDES, and DECK_GYM_SLIDES_TEST before rendering.',
    );
  }
  return { python, render, test };
}

async function runProcess(executable, args) {
  const child = spawn(executable, args, {
    cwd: root,
    env: { ...process.env, HOME: process.env.USERPROFILE },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-20_000);
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  if (exitCode !== 0) throw new Error(stderr.trim() || `${path.basename(executable)} failed`);
}

async function readPlanResults(directory) {
  const entries = await readdir(directory).catch(() => []);
  const values = [];
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue;
    values.push(JSON.parse(await readFile(path.join(directory, entry), 'utf8')));
  }
  return values;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readRunStatuses(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const statuses = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const receipt = await readJson(path.join(directory, entry.name, 'receipt.json')).catch(
      () => null,
    );
    if (receipt?.candidateId) statuses.set(receipt.candidateId, receipt.status);
  }
  return statuses;
}

async function readAllRunReceipts(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const receipts = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const receipt = await readJson(path.join(directory, entry.name, 'receipt.json')).catch(
      () => null,
    );
    if (receipt?.candidateId) receipts.push(receipt);
  }
  return receipts;
}

function claimMatches(deckText, claim) {
  const deckTokens = new Set(deckText.split(' ').filter(Boolean));
  const tokens = normalize(claim)
    .split(' ')
    .filter(
      (token) =>
        token.length >= 3 &&
        !['the', 'and', 'is', 'to', 'at', 'by', 'with', 'reached'].includes(token),
    );
  if (!tokens.length) return true;
  return tokens.every((token) => deckTokens.has(token));
}

function forbiddenClaimMatches(deckText, claim) {
  const normalizedClaim = normalize(claim);
  if (!normalizedClaim) return false;
  const haystack = ` ${deckText} `;
  const needle = ` ${normalizedClaim} `;
  let offset = haystack.indexOf(needle);
  while (offset >= 0) {
    const context = haystack.slice(
      Math.max(0, offset - 96),
      Math.min(haystack.length, offset + needle.length + 96),
    );
    const explicitlyRejected =
      /unsupported|rejected|lack of evidence|no supporting evidence|missing evidence/gu.test(
        context,
      );
    if (!explicitlyRejected) return true;
    offset = haystack.indexOf(needle, offset + needle.length);
  }
  return false;
}

function normalize(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function relativeArtifactPath(value) {
  return path.relative(artifactRoot, value).replaceAll('\\', '/');
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

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error).slice(0, 1000);
}
