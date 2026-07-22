#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {
  buildBlindTournament,
  buildDeckGymMatrix,
  buildPromotionProposal,
  digest,
  evaluateDeckGymPptx,
  readDeckGymConfig,
  validateDeckGymConfig,
} from './lib/deck-gym-core.mjs';

const command = process.argv[2] ?? 'validate';
const root = process.cwd();
const { corpus, harness } = await readDeckGymConfig(root, {
  corpusPath: option('corpus'),
  harnessPath: option('harness'),
});
const artifactRoot = path.resolve(
  option('artifact-dir') ?? path.join('artifacts', 'deck-gym', harness.harnessVersion),
);

if (command === 'validate') {
  const validation = validateDeckGymConfig(corpus, harness);
  await writeJson(path.join(artifactRoot, 'configuration-validation.json'), {
    schemaVersion: 'nodeslide.deck-gym-configuration-validation/v1',
    generatedAt: new Date().toISOString(),
    ...validation,
  });
  console.log(
    `[deck-gym] ${validation.ok ? 'PASS' : 'FAIL'} ${validation.briefCount} briefs × ${validation.modelCount} models × ${validation.directionCount} directions = ${validation.matrixSize} runs`,
  );
  if (!validation.ok) {
    console.error(validation.failures.join('\n'));
    process.exitCode = 1;
  }
} else if (command === 'matrix') {
  const matrix = buildDeckGymMatrix(corpus, harness, {
    briefs: csvOption('briefs'),
    models: csvOption('models'),
    directions: csvOption('directions'),
  });
  const outputPath = path.resolve(option('out') ?? path.join(artifactRoot, 'matrix.json'));
  await writeJson(outputPath, matrix);
  console.log(`[deck-gym] planned ${matrix.runCount} controlled runs`);
  console.log(`[deck-gym] matrix: ${path.relative(root, outputPath)}`);
} else if (command === 'render') {
  const runsDir = path.resolve(option('runs-dir') ?? path.join(artifactRoot, 'runs'));
  const runDirs = await discoverRunDirs(runsDir);
  const limit = positiveInteger(option('limit'), runDirs.length);
  const concurrency = positiveInteger(option('concurrency'), 1);
  let passed = 0;
  let failed = 0;
  await mapConcurrent(runDirs.slice(0, limit), concurrency, async (runDir) => {
    const pptxPath = path.join(runDir, 'deck.pptx');
    const renderedDir = path.join(runDir, 'rendered');
    const receiptPath = path.join(runDir, 'render-receipt.json');
    try {
      const tools = presentationTools();
      await mkdir(renderedDir, { recursive: true });
      await runProcess(tools.python, [
        tools.render,
        pptxPath,
        '--output_dir',
        renderedDir,
        '--width',
        '1600',
        '--height',
        '900',
      ]);
      await runProcess(tools.python, [tools.test, pptxPath]);
      const renderedSlides = await countRenderedSlides(renderedDir);
      await writeJson(receiptPath, {
        schemaVersion: 'nodeslide.deck-gym-render/v1',
        status: 'passed',
        renderedSlides,
        overflowTest: 'passed',
        generatedAt: new Date().toISOString(),
      });
      passed += 1;
      console.log(`[deck-gym] RENDER PASS ${path.basename(runDir)} (${renderedSlides} slides)`);
    } catch (error) {
      failed += 1;
      await writeJson(receiptPath, {
        schemaVersion: 'nodeslide.deck-gym-render/v1',
        status: 'failed',
        failure: safeError(error),
        generatedAt: new Date().toISOString(),
      });
      console.error(`[deck-gym] RENDER FAIL ${path.basename(runDir)}: ${safeError(error)}`);
    }
  });
  console.log(`[deck-gym] rendered ${passed}/${passed + failed} decks`);
  if (failed) process.exitCode = 1;
} else if (command === 'evaluate') {
  const runsDir = path.resolve(option('runs-dir') ?? path.join(artifactRoot, 'runs'));
  const runDirs = await discoverRunDirs(runsDir);
  let passed = 0;
  let failed = 0;
  const evaluations = [];
  for (const runDir of runDirs) {
    const run = await readJson(path.join(runDir, 'run.json'));
    const pptx = await readFile(path.join(runDir, 'deck.pptx'));
    const renderedSlideCount = await countRenderedSlides(path.join(runDir, 'rendered'));
    const evaluation = await evaluateDeckGymPptx({
      bytes: pptx,
      run: {
        ...run,
        gates: { ...run.gates, ...harness.gates },
        evaluationGatesDigest: digest(harness.gates),
      },
      renderedSlideCount: renderedSlideCount || null,
    });
    await writeJson(path.join(runDir, 'evaluation.json'), evaluation);
    evaluations.push(evaluation);
    if (evaluation.status === 'passed') passed += 1;
    else failed += 1;
    console.log(
      `[deck-gym] ${evaluation.status.toUpperCase()} ${run.runId} score=${evaluation.score.toFixed(3)} claims=${evaluation.evidence.claimCoverage.toFixed(2)} layouts=${evaluation.evidence.distinctLayoutSignatures}`,
    );
  }
  const summary = summarizeEvaluations(evaluations);
  await writeJson(path.join(artifactRoot, 'evaluation-summary.json'), summary);
  console.log(`[deck-gym] evaluated ${passed + failed} decks: ${passed} pass, ${failed} fail`);
  if (failed) process.exitCode = 1;
} else if (command === 'tournament') {
  const runsDir = path.resolve(option('runs-dir') ?? path.join(artifactRoot, 'runs'));
  const evaluations = await readEvaluations(await discoverRunDirs(runsDir));
  const tournament = buildBlindTournament(evaluations);
  const outputPath = path.resolve(option('out') ?? path.join(artifactRoot, 'tournament.json'));
  await writeJson(outputPath, tournament);
  console.log(
    `[deck-gym] tournament: ${tournament.matchCount} blind matches (${tournament.eligibleMatchCount} eligible)`,
  );
} else if (command === 'propose-promotion') {
  const tournamentPath = path.resolve(
    option('tournament') ?? path.join(artifactRoot, 'tournament.json'),
  );
  const preferencePath = path.resolve(
    option('preferences') ?? path.join(artifactRoot, 'human-preferences.jsonl'),
  );
  const tournament = await readJson(tournamentPath);
  const preferences = await readJsonLines(preferencePath);
  const proposal = buildPromotionProposal({ tournament, preferences, harness });
  const outputPath = path.resolve(
    option('out') ?? path.join(artifactRoot, 'promotion-proposal.json'),
  );
  await writeJson(outputPath, proposal);
  console.log(`[deck-gym] promotion ${proposal.decision}; auto-apply=${proposal.autoApply}`);
  if (proposal.decision === 'blocked') process.exitCode = 1;
} else {
  console.error(
    'Usage: node scripts/deck-gym.mjs <validate|matrix|render|evaluate|tournament|propose-promotion> [options]',
  );
  process.exitCode = 1;
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

async function mapConcurrent(values, concurrency, operation) {
  const queue = [...values];
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      while (queue.length) {
        const value = queue.shift();
        if (value !== undefined) await operation(value);
      }
    }),
  );
}

async function discoverRunDirs(runsDir) {
  const entries = await readdir(runsDir, { withFileTypes: true }).catch(() => []);
  const runDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runDir = path.join(runsDir, entry.name);
    if (
      (await exists(path.join(runDir, 'run.json'))) &&
      (await exists(path.join(runDir, 'deck.pptx')))
    ) {
      runDirs.push(runDir);
    }
  }
  return runDirs.sort();
}

async function readEvaluations(runDirs) {
  const values = [];
  for (const runDir of runDirs) {
    const evaluationPath = path.join(runDir, 'evaluation.json');
    if (await exists(evaluationPath)) values.push(await readJson(evaluationPath));
  }
  return values;
}

async function countRenderedSlides(renderedDir) {
  const entries = await readdir(renderedDir).catch(() => []);
  return entries.filter((entry) => /^slide-\d+\.png$/u.test(entry)).length;
}

function summarizeEvaluations(evaluations) {
  const byModel = Object.values(
    evaluations.reduce((groups, evaluation) => {
      const current = groups[evaluation.model] ?? {
        model: evaluation.model,
        runs: 0,
        passed: 0,
        scores: [],
        claimCoverage: [],
        textOverflows: 0,
        routes: {},
      };
      current.runs += 1;
      if (evaluation.status === 'passed') current.passed += 1;
      current.scores.push(evaluation.score);
      current.claimCoverage.push(evaluation.evidence.claimCoverage);
      current.textOverflows += evaluation.evidence.estimatedTextOverflowCount ?? 0;
      const route = evaluation.routeClassification ?? 'unknown';
      current.routes[route] = (current.routes[route] ?? 0) + 1;
      groups[evaluation.model] = current;
      return groups;
    }, {}),
  ).map((entry) => ({
    model: entry.model,
    runs: entry.runs,
    passed: entry.passed,
    passRate: entry.runs ? entry.passed / entry.runs : 0,
    meanScore: entry.scores.length
      ? entry.scores.reduce((sum, value) => sum + value, 0) / entry.scores.length
      : 0,
    meanClaimCoverage: entry.claimCoverage.length
      ? entry.claimCoverage.reduce((sum, value) => sum + value, 0) / entry.claimCoverage.length
      : 0,
    estimatedTextOverflows: entry.textOverflows,
    routes: entry.routes,
  }));
  const failureChecks = {};
  const routeClassifications = {};
  const digestGroups = new Map();
  for (const evaluation of evaluations) {
    for (const [name, passed] of Object.entries(evaluation.checks)) {
      if (!passed) failureChecks[name] = (failureChecks[name] ?? 0) + 1;
    }
    const route = evaluation.routeClassification ?? 'unknown';
    routeClassifications[route] = (routeClassifications[route] ?? 0) + 1;
    const deckDigest = evaluation.evidence.deckDigest;
    const group = digestGroups.get(deckDigest) ?? [];
    group.push(evaluation.runId);
    digestGroups.set(deckDigest, group);
  }
  const duplicateDeckGroups = [...digestGroups.entries()]
    .filter(([, runIds]) => runIds.length > 1)
    .map(([deckDigest, runIds]) => ({ deckDigest, count: runIds.length, runIds }))
    .sort((left, right) => right.count - left.count);
  const partial = {
    schemaVersion: 'nodeslide.deck-gym-evaluation-summary/v1',
    generatedAt: new Date().toISOString(),
    runCount: evaluations.length,
    passed: evaluations.filter((entry) => entry.status === 'passed').length,
    failed: evaluations.filter((entry) => entry.status !== 'passed').length,
    routeClassifications,
    failureChecks,
    duplicateDeckGroups,
    byModel,
  };
  return partial;
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
    env: { ...process.env, HOME: process.env.HOME ?? process.env.USERPROFILE },
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

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readJsonLines(filePath) {
  const content = await readFile(filePath, 'utf8').catch(() => '');
  return content
    .split(/\r?\n/u)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function exists(filePath) {
  return stat(filePath).then(
    () => true,
    () => false,
  );
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/\b[A-Za-z0-9_-]{64,}\b/gu, '[REDACTED_LONG_VALUE]')
    .slice(0, 500);
}
