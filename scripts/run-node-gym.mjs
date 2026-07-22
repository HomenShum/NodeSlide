#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { buildNodeGymMatrixInput } from './lib/node-gym-config-core.mjs';
import {
  buildNodeGymPairedDeltaReport,
  evaluateEvidenceBoundNodeGymRun,
} from './lib/node-gym-evaluation-core.mjs';
import { buildNodeGymMatrix } from './lib/node-gym-matrix-core.mjs';
import { redactNodeGymDiagnostic } from './lib/node-gym-redaction-core.mjs';
import {
  NODE_GYM_EXECUTOR_RESULT_SCHEMA,
  applyPairSafeLimit,
  assertNodeGymAttemptEvidence,
  assertNodeGymContainedPath,
  assertNodeGymLatestReceipt,
  assertNodeGymMatrixBoundToConfig,
  assertNodeGymPassedSemanticEvaluation,
  assertNodeGymRealPathContained,
  assertNodeGymSafePathSyntax,
  digestJson,
  nodeGymReceiptArtifactBindings,
  selectNodeGymSubset,
  shouldStopCampaign,
  summarizeNodeGymAttemptHistory,
  validateNodeGymExecutorResult,
  writeNodeGymFileAtomic,
} from './lib/node-gym-runner-core.mjs';
import {
  assertNoProtectedFixtureLeakage,
  bindNodeGymRunPlanToFixture,
  digestJson as digestTaskJson,
  filterNodeGymRunsForRuntime,
  isProtectedNodeGymTask,
  loadNodeGymTaskFixture,
  projectNodeGymProtectedFixtureForEgress,
} from './lib/node-gym-task-core.mjs';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Usage: node scripts/run-node-gym.mjs [options]

Selection (default: paired 12-run bounded subset):
  --subset bounded|deterministic|live-smoke|all
  --task <id[,id]>       Exact task ids
  --model <id[,id]>      Exact model ids/routes
  --harness <id[,id]>    Exact harness ids (at least two for paired execution)
  --repetition <n[,n]>   Exact repetition numbers
  --limit <n>            Final run cap; do not split a pair

Execution:
  --executor deterministic|ui|recovery|<script>
  --allow-live           Required by the production UI executor
  --campaign-id <id>
  --max-total-cost-micro-usd <n>
  --max-failures <n>
  --max-attempts <n>
  --source-campaign <path>  Required by recovery executor

Full matrix safety:
  --subset all --confirm-full-matrix nodeslide-deck-gym-v2
  Full execution also requires an explicit aggregate cost cap.`);
  process.exit(0);
}

const root = process.cwd();
const matrixInput = option('matrix') ?? 'artifacts/node-gym/nodeslide-deck-gym-v2/matrix.json';
const configInput = option('config') ?? 'benchmarks/deck-gym/v2/gym.json';
assertNodeGymSafePathSyntax(matrixInput, 'matrix path');
assertNodeGymSafePathSyntax(configInput, 'config path');
const matrixPath = path.resolve(matrixInput);
const configPath = path.resolve(configInput);
const subset = option('subset') ?? 'bounded';
const executor = option('executor') ?? 'deterministic';
const fullConfirmed = option('confirm-full-matrix') === 'nodeslide-deck-gym-v2';
if (subset === 'all' && !fullConfirmed) {
  throw new Error(
    'Full execution is disabled by default. Pass --confirm-full-matrix nodeslide-deck-gym-v2 with an explicit aggregate cost cap.',
  );
}
if (executor === 'ui' && !process.argv.includes('--allow-live'))
  throw new Error('The UI executor requires --allow-live.');

const [matrixBytes, configBytes] = await Promise.all([readFile(matrixPath), readFile(configPath)]);
const matrix = JSON.parse(matrixBytes.toString('utf8'));
const config = JSON.parse(configBytes.toString('utf8'));
const regeneratedRuns = buildNodeGymMatrix(buildNodeGymMatrixInput(config));
assertNodeGymMatrixBoundToConfig({ configBytes, config, matrix, regeneratedRuns });
const filters = {
  tasks: csvOption('task'),
  models: csvOption('model').length ? csvOption('model') : csvOption('models'),
  harnesses: csvOption('harness'),
  repetitions: csvOption('repetition').map(Number),
};
const explicitlyFilteredRuns = matrix.runs.filter(
  (run) =>
    (!filters.tasks.length || filters.tasks.includes(run.task.id)) &&
    (!filters.models.length || filters.models.includes(run.model.id)) &&
    (!filters.harnesses.length || filters.harnesses.includes(run.harness.id)) &&
    (!filters.repetitions.length || filters.repetitions.includes(run.repetition)),
);
const filteredRuns = filterNodeGymRunsForRuntime({
  runs: explicitlyFilteredRuns,
  tasks: config.tasks,
  runtime: process.env,
  explicitTaskIds: filters.tasks,
});
if (!filteredRuns.length) throw new Error('Explicit NodeGym selection matched no matrix runs.');
const selectedEntries = applyPairSafeLimit(
  selectNodeGymSubset({ ...matrix, runs: filteredRuns }, subset),
  positiveInteger(option('limit'), Number.POSITIVE_INFINITY),
).map((run) => {
  const task = config.tasks.find((entry) => entry.id === run.task.id);
  if (!task) throw new Error(`Matrix task ${run.task.id} is absent from the gym config.`);
  const loadedFixture = loadNodeGymTaskFixture({ task });
  const egressFixture =
    loadedFixture.protected && executor === 'ui'
      ? projectNodeGymProtectedFixtureForEgress(loadedFixture)
      : null;
  const boundPlan = bindNodeGymRunPlanToFixture(run, loadedFixture);
  const plan = egressFixture
    ? { ...boundPlan, egressProjectionDigest: digestTaskJson(egressFixture) }
    : boundPlan;
  assertProtectedOutput(plan, loadedFixture);
  return {
    plan,
    task,
    loadedFixture,
    evaluationFixture: egressFixture ?? loadedFixture.fixture,
  };
});
const selected = selectedEntries.map((entry) => entry.plan);
if (!selected.length) throw new Error('NodeGym selection is empty.');
const campaignId = safeSegment(option('campaign-id') ?? `${subset}-${executor}-v1`);
const artifactRoot = path.resolve('artifacts', 'node-gym');
const campaignRootInput =
  option('artifact-dir') ??
  path.join('artifacts', 'node-gym', config.gymVersion, 'campaigns', campaignId);
assertNodeGymSafePathSyntax(campaignRootInput, 'campaign artifact directory');
const campaignRoot = path.resolve(campaignRootInput);
assertNodeGymContainedPath(artifactRoot, campaignRoot, 'campaign artifact directory');
const maxTotalCostMicroUsd = nonNegativeInteger(
  option('max-total-cost-micro-usd'),
  subset === 'all' ? null : 200_000,
);
if (maxTotalCostMicroUsd === null)
  throw new Error('An explicit --max-total-cost-micro-usd is required for full execution.');
const maxFailures = positiveInteger(option('max-failures'), subset === 'all' ? 6 : 2);
const maxAttempts = positiveInteger(option('max-attempts'), 2);
await assertNodeGymRealPathContained(root, artifactRoot, 'NodeGym artifact root');
await assertNodeGymRealPathContained(artifactRoot, campaignRoot, 'campaign artifact directory');
await mkdir(campaignRoot, { recursive: true });
await assertNodeGymRealPathContained(artifactRoot, campaignRoot, 'campaign artifact directory');

const campaignPlan = {
  schemaVersion: 'nodekit.gym-campaign-plan/v1',
  campaignId,
  gymVersion: config.gymVersion,
  configDigest: matrix.configDigest,
  matrixDigest: digestJson(matrix),
  selection: subset,
  executor,
  selectedRunCount: selected.length,
  selectedRunIds: selected.map((run) => run.runId),
  filters,
  maxTotalCostMicroUsd,
  maxFailures,
  maxAttempts,
  fullMatrixExplicitlyConfirmed: subset === 'all' && fullConfirmed,
  promotionAutoApply: false,
  ...(option('source-campaign')
    ? {
        sourceCampaign: path
          .relative(root, path.resolve(option('source-campaign')))
          .replaceAll('\\', '/'),
      }
    : {}),
};
for (const entry of selectedEntries) assertProtectedOutput(campaignPlan, entry.loadedFixture);
await writeImmutableJson(path.join(campaignRoot, 'campaign-plan.json'), campaignPlan);

let spentCostMicroUsd = 0;
let failures = 0;
const summaryRuns = [];
const semanticEvaluations = new Map();
const selectedEntryByRunId = new Map(selectedEntries.map((entry) => [entry.plan.runId, entry]));
const runStateByRunId = new Map();
let stoppedBy = null;

// Resume is deliberately two-phase. Every immutable receipt is validated and
// accounted across the selected campaign before any executor can be scheduled.
for (const entry of selectedEntries) {
  const { plan } = entry;
  const runDir = path.join(campaignRoot, 'runs', safeSegment(plan.runId));
  const attemptsDir = path.join(runDir, 'attempts');
  assertNodeGymContainedPath(campaignRoot, runDir, 'run artifact directory');
  await assertNodeGymRealPathContained(campaignRoot, attemptsDir, 'run artifact directory');
  await mkdir(attemptsDir, { recursive: true });
  await assertNodeGymRealPathContained(campaignRoot, attemptsDir, 'run artifact directory');
  assertProtectedOutput(plan, entry.loadedFixture);
  await writeImmutableJson(path.join(runDir, 'plan.json'), plan);
  const history = await loadNodeGymAttemptHistory({ plan, runDir, attemptsDir, executor });
  spentCostMicroUsd += history.spentCostMicroUsd;
  failures += history.failures;
  if (!Number.isSafeInteger(spentCostMicroUsd))
    throw new Error('NodeGym campaign cumulative cost exceeds the safe integer range.');
  let priorSemantic = null;
  if (history.passedReceipt) {
    const immutableEvidence = history.evidenceByAttempt.get(history.passedReceipt.attempt);
    if (!immutableEvidence)
      throw new Error(`Immutable passed evidence is missing for ${plan.runId}.`);
    priorSemantic = immutableEvidence.semanticEvaluation;
    const semanticAlias = await readOptionalJson(path.join(runDir, 'semantic-evaluation.json'));
    if (!semanticAlias || digestJson(semanticAlias) !== digestJson(priorSemantic))
      throw new Error(`NodeGym semantic latest alias is stale for ${plan.runId}.`);
    assertNodeGymPassedSemanticEvaluation(plan, history.passedReceipt, priorSemantic);
    assertProtectedOutput(priorSemantic, entry.loadedFixture);
    semanticEvaluations.set(plan.runId, priorSemantic);
  }
  runStateByRunId.set(plan.runId, { runDir, attemptsDir, history, priorSemantic });
}

const historicSpentCostMicroUsd = spentCostMicroUsd;
const historicFailureAttempts = failures;
let attemptReceiptCount = [...runStateByRunId.values()].reduce(
  (total, state) => total + state.history.receipts.length,
  0,
);

for (const plan of selected) {
  const entry = selectedEntryByRunId.get(plan.runId);
  const state = runStateByRunId.get(plan.runId);
  if (!entry || !state) throw new Error(`Runtime fixture binding missing for ${plan.runId}.`);
  const { runDir, attemptsDir, history, priorSemantic } = state;
  if (history.passedReceipt) {
    summaryRuns.push({
      runId: plan.runId,
      status: 'skipped-passed',
      receipt: 'latest.json',
      attempt: history.passedReceipt.attempt,
      semanticEvaluationDigest: history.passedReceipt.semanticEvaluationDigest,
      harnessBehaviorObserved: priorSemantic.scoreEvidence?.harnessExecution?.observed === true,
    });
    console.log(`[node-gym] RESUME ${plan.runId} already passed`);
    continue;
  }
  if (history.latestAttempt >= maxAttempts) {
    summaryRuns.push({
      runId: plan.runId,
      status: 'attempt-limit-reached',
      attempt: history.latestAttempt,
    });
    continue;
  }
  const circuit = shouldStopCampaign({
    spentCostMicroUsd,
    maxTotalCostMicroUsd,
    failures,
    maxFailures,
    nextRunMaxCostMicroUsd: projectedRunCostMicroUsd(plan),
  });
  if (circuit.stop) {
    stoppedBy = circuit.issueCode;
    break;
  }
  const attempt = history.latestAttempt + 1;
  const attemptStem = `attempt-${String(attempt).padStart(3, '0')}`;
  const attemptRoot = path.join(attemptsDir, attemptStem);
  const attemptWorkspace = path.join(attemptRoot, 'work');
  await assertNodeGymRealPathContained(runDir, attemptWorkspace, 'attempt workspace');
  await mkdir(attemptWorkspace, { recursive: true });
  await assertNodeGymRealPathContained(runDir, attemptWorkspace, 'attempt workspace');
  const attemptPlanPath = path.join(attemptRoot, 'plan.json');
  await writeImmutableJson(attemptPlanPath, plan);
  const rawResultPath = path.join(attemptWorkspace, 'executor-result.raw.json');
  const resultPath = path.join(attemptRoot, 'executor-result.json');
  const rawResult = await execute(
    plan,
    attemptPlanPath,
    attemptWorkspace,
    rawResultPath,
    executor,
    configPath,
    executorEnvironment(config, entry.evaluationFixture, Boolean(plan.egressProjectionDigest)),
  ).catch((error) => ({
    schemaVersion: NODE_GYM_EXECUTOR_RESULT_SCHEMA,
    runId: plan.runId,
    pairingKey: plan.pairingKey,
    status: 'failed',
    route: {
      mode: plan.model.provider === 'local' ? 'deterministic' : 'degraded',
    },
    usage: {
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costMicroUsd: 0,
      repairCount: 0,
    },
    artifacts: {},
    diagnostics: {
      claimAudit: { status: 'not_run' },
      executorFailure: safeIssue(error),
    },
    issueCodes: ['executor_process_failed'],
  }));
  const result = await bindArtifacts(rawResult, attemptWorkspace);
  assertProtectedOutput(result, entry.loadedFixture);
  await writeImmutableJson(resultPath, result);
  const semanticEvaluation = evaluateEvidenceBoundNodeGymRun({
    plan,
    fixture: entry.evaluationFixture,
    result,
    artifacts: result.artifacts,
  });
  assertProtectedOutput(semanticEvaluation, entry.loadedFixture);
  semanticEvaluations.set(plan.runId, semanticEvaluation);
  const semanticPath = path.join(attemptRoot, 'semantic-evaluation.json');
  await writeImmutableJson(semanticPath, semanticEvaluation);
  await writeJson(path.join(runDir, 'semantic-evaluation.json'), semanticEvaluation);
  const actualArtifacts = await loadNodeGymArtifactBindings(result.artifacts, attemptWorkspace);
  const declaredArtifacts = nodeGymReceiptArtifactBindings(result.artifacts);
  if (digestJson(actualArtifacts) !== digestJson(declaredArtifacts))
    throw new Error(`NodeGym artifact bytes changed before receipt publication for ${plan.runId}.`);
  const attemptFiles = {
    plan: await nodeGymFileBinding(attemptPlanPath, runDir),
    executorResult: await nodeGymFileBinding(resultPath, runDir),
    semanticEvaluation: await nodeGymFileBinding(semanticPath, runDir),
  };
  const receipt = {
    ...validateNodeGymExecutorResult(plan, result, {
      executor,
      requireSemanticEvidence: true,
      semanticEvaluation,
    }),
    attempt,
    attemptEvidence: {
      schemaVersion: 'nodekit.gym-attempt-evidence/v1',
      artifactRoot: path.relative(runDir, attemptWorkspace).replaceAll('\\', '/'),
      files: attemptFiles,
      artifactSetDigest: digestJson(actualArtifacts),
    },
    recordedAt: new Date().toISOString(),
  };
  assertNodeGymAttemptEvidence({
    plan,
    receipt,
    parsedPlan: plan,
    executorResult: result,
    semanticEvaluation,
    files: attemptFiles,
    artifacts: actualArtifacts,
  });
  assertProtectedOutput(receipt, entry.loadedFixture);
  const attemptPath = path.join(attemptsDir, `attempt-${String(attempt).padStart(3, '0')}.json`);
  await writeImmutableJson(attemptPath, receipt);
  await writeJson(path.join(runDir, 'latest.json'), receipt);
  attemptReceiptCount += 1;
  spentCostMicroUsd += receipt.usage.costMicroUsd;
  if (receipt.status !== 'passed') failures += 1;
  summaryRuns.push({
    runId: plan.runId,
    status: receipt.status,
    attempt,
    issueCodes: receipt.issueCodes,
    semanticEvaluationDigest: receipt.semanticEvaluationDigest,
    harnessBehaviorObserved: semanticEvaluation.scoreEvidence?.harnessExecution?.observed === true,
  });
  console.log(`[node-gym] ${receipt.status.toUpperCase()} ${plan.runId}`);
}

const completedRunIds = new Set(summaryRuns.map((entry) => entry.runId));
const pairedGroups = groupBy(selected, (run) => run.pairingKey);
const comparisonPairs = [];
let expectedPairCount = 0;
for (const [pairingKey, plans] of pairedGroups) {
  if (plans.length < 2) continue;
  expectedPairCount += plans.length - 1;
  const champion = semanticEvaluations.get(plans[0].runId);
  for (const challengerPlan of plans.slice(1)) {
    comparisonPairs.push({
      pairId: `${pairingKey}::${challengerPlan.harness.id}`,
      kind: 'harness',
      champion,
      challenger: semanticEvaluations.get(challengerPlan.runId),
    });
  }
}
const pairedDeltaCore = buildNodeGymPairedDeltaReport({
  pairs: comparisonPairs,
});
const pairedDeltaReport = {
  schemaVersion: 'nodekit.gym-paired-delta-report/v1',
  ...pairedDeltaCore,
  expectedPairCount,
  complete:
    pairedDeltaCore.ok === true &&
    pairedDeltaCore.pairCount === expectedPairCount &&
    expectedPairCount > 0,
};
for (const entry of selectedEntries) assertProtectedOutput(pairedDeltaReport, entry.loadedFixture);
await writeJson(path.join(campaignRoot, 'paired-delta-report.json'), pairedDeltaReport);
const allSemanticHardGatesPassed = selected.every(
  (run) => semanticEvaluations.get(run.runId)?.hardGatesPassed === true,
);
const allHarnessBehaviorObserved = selected.every(
  (run) => semanticEvaluations.get(run.runId)?.scoreEvidence?.harnessExecution?.observed === true,
);
const summary = {
  schemaVersion: 'nodekit.gym-campaign-summary/v1',
  campaignId,
  campaignPlanDigest: digestJson(campaignPlan),
  generatedAt: new Date().toISOString(),
  selectedRunCount: selected.length,
  attemptedOrResumed: summaryRuns.length,
  passed: summaryRuns.filter((entry) => ['passed', 'skipped-passed'].includes(entry.status)).length,
  failed: summaryRuns.filter((entry) => !['passed', 'skipped-passed'].includes(entry.status))
    .length,
  unrun: selected.filter((run) => !completedRunIds.has(run.runId)).map((run) => run.runId),
  spentCostMicroUsd,
  failureAttempts: failures,
  attemptReceiptCount,
  historicSpentCostMicroUsd,
  historicFailureAttempts,
  stoppedBy,
  pairedCausalClaimReady:
    !stoppedBy &&
    selected.every((run) => completedRunIds.has(run.runId)) &&
    summaryRuns.every((entry) => ['passed', 'skipped-passed'].includes(entry.status)) &&
    allSemanticHardGatesPassed &&
    allHarnessBehaviorObserved &&
    pairedDeltaReport.complete,
  pairedDeltaReport: {
    status: pairedDeltaReport.complete ? 'complete' : 'incomplete',
    reportDigest: digestJson(pairedDeltaReport),
    pairCount: pairedDeltaReport.pairCount ?? 0,
    expectedPairCount,
  },
  promotionEligible: false,
  humanPreference: { status: 'not_run' },
  runs: summaryRuns,
};
for (const entry of selectedEntries) assertProtectedOutput(summary, entry.loadedFixture);
await writeJson(path.join(campaignRoot, 'summary.json'), summary);
console.log(
  `[node-gym] campaign ${campaignId}: ${summary.passed}/${summary.selectedRunCount} passed; cost=${summary.spentCostMicroUsd} microUSD${stoppedBy ? `; stopped=${stoppedBy}` : ''}`,
);
if (summary.failed || summary.unrun.length) process.exitCode = 1;

async function execute(
  plan,
  planPath,
  runDir,
  resultPath,
  selectedExecutor,
  selectedConfigPath,
  childEnvironment,
) {
  const script =
    selectedExecutor === 'ui'
      ? 'scripts/node-gym-ui-executor.mjs'
      : selectedExecutor === 'deterministic'
        ? 'scripts/node-gym-deterministic-executor.mjs'
        : selectedExecutor === 'recovery'
          ? 'scripts/node-gym-recovery-executor.mjs'
          : selectedExecutor;
  assertNodeGymSafePathSyntax(script, 'executor script');
  const scriptPath = path.resolve(script);
  assertNodeGymContainedPath(root, scriptPath, 'executor script');
  await assertNodeGymRealPathContained(root, scriptPath, 'executor script');
  const args = [
    scriptPath,
    '--plan',
    planPath,
    '--config',
    selectedConfigPath,
    '--run-dir',
    runDir,
    '--out',
    resultPath,
  ];
  if (selectedExecutor === 'ui') args.push('--allow-live');
  if (selectedExecutor === 'recovery') {
    const sourceCampaign = option('source-campaign');
    if (!sourceCampaign) throw new Error('Recovery executor requires --source-campaign.');
    assertNodeGymSafePathSyntax(sourceCampaign, 'source campaign');
    const resolvedSourceCampaign = path.resolve(sourceCampaign);
    assertNodeGymContainedPath(artifactRoot, resolvedSourceCampaign, 'source campaign');
    await assertNodeGymRealPathContained(artifactRoot, resolvedSourceCampaign, 'source campaign');
    args.push('--source-campaign', resolvedSourceCampaign);
  }
  await assertNodeGymRealPathContained(runDir, resultPath, 'executor result');
  if (await lstat(resultPath).catch(() => null))
    throw new Error('Executor result path already exists; refusing to overwrite it.');
  await runProcess(
    process.execPath,
    args,
    Math.max(30_000, plan.budget.maxLatencyMs + 120_000),
    childEnvironment,
  );
  return await readJson(resultPath);
}

async function bindArtifacts(result, runDir) {
  const artifacts = await bindArtifactNode(result?.artifacts ?? {}, runDir, 'artifact');
  return { ...result, artifacts };
}

async function bindArtifactNode(value, runDir, kind) {
  if (Array.isArray(value))
    return await Promise.all(
      value.map((entry, index) => bindArtifactNode(entry, runDir, `${kind}_${index + 1}`)),
    );
  if (!value || typeof value !== 'object') return value;
  if (typeof value.path !== 'string') {
    return Object.fromEntries(
      await Promise.all(
        Object.entries(value).map(async ([key, entry]) => [
          key,
          await bindArtifactNode(entry, runDir, key),
        ]),
      ),
    );
  }
  assertNodeGymSafePathSyntax(value.path, `${kind} artifact`);
  const filePath = path.resolve(runDir, value.path);
  assertNodeGymContainedPath(runDir, filePath, `${kind} artifact`);
  await assertNodeGymRealPathContained(runDir, filePath, `${kind} artifact`);
  const details = await stat(filePath).catch(() => null);
  return details?.isFile()
    ? {
        ...value,
        path: path.relative(runDir, filePath).replaceAll('\\', '/'),
        digest: await sha256File(filePath),
        bytes: details.size,
      }
    : {
        ...value,
        validation: { status: 'failed', issueCode: `${kind}_file_missing` },
      };
}

async function runProcess(executable, args, timeoutMs, childEnvironment) {
  const child = spawn(executable, args, {
    cwd: root,
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-20_000);
  });
  const timeout = setTimeout(() => child.kill(), timeoutMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  clearTimeout(timeout);
  if (exitCode !== 0) throw new Error(redact(stderr) || `Executor exited ${exitCode}.`);
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
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nonNegativeInteger(value, fallback) {
  if (value === undefined) return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : fallback;
}

function safeSegment(value) {
  const safe = String(value)
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-|-$/gu, '');
  if (!safe || safe === '.' || safe === '..') throw new Error('Filesystem segment is invalid.');
  return safe.slice(0, 180);
}

function safeIssue(error) {
  return redact(error instanceof Error ? error.message : String(error)).slice(0, 240);
}

function redact(value) {
  return redactNodeGymDiagnostic(value, { maxLength: 1_500 });
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function loadNodeGymAttemptHistory({
  plan,
  runDir,
  attemptsDir,
  executor: selectedExecutor,
}) {
  const entries = await readdir(attemptsDir, { withFileTypes: true });
  const receipts = [];
  const evidenceByAttempt = new Map();
  const workspaceAttempts = new Set();
  for (const entry of entries) {
    const match = /^attempt-(\d{3,})\.json$/u.exec(entry.name);
    const workspaceMatch = /^attempt-(\d{3,})$/u.exec(entry.name);
    if (entry.name.startsWith('attempt-') && !match && !workspaceMatch)
      throw new Error(`Invalid immutable attempt filename for ${plan.runId}: ${entry.name}.`);
    if (workspaceMatch) {
      if (!entry.isDirectory())
        throw new Error(`Immutable attempt workspace is not a directory: ${entry.name}.`);
      workspaceAttempts.add(Number(workspaceMatch[1]));
      continue;
    }
    if (!match) continue;
    if (!entry.isFile())
      throw new Error(`Immutable attempt receipt is not a regular file: ${entry.name}.`);
    const receiptPath = path.join(attemptsDir, entry.name);
    assertNodeGymContainedPath(runDir, receiptPath, 'immutable attempt receipt');
    await assertNodeGymRealPathContained(runDir, receiptPath, 'immutable attempt receipt');
    const receipt = await readJson(receiptPath);
    if (receipt?.attempt !== Number(match[1]))
      throw new Error(`Immutable attempt filename does not match its receipt: ${entry.name}.`);
    const evidence = await loadNodeGymAttemptEvidence({ plan, receipt, runDir, attemptsDir });
    evidenceByAttempt.set(receipt.attempt, evidence);
    receipts.push(receipt);
  }
  const receiptAttempts = new Set(receipts.map((receipt) => receipt.attempt));
  if (
    workspaceAttempts.size !== receiptAttempts.size ||
    [...workspaceAttempts].some((attempt) => !receiptAttempts.has(attempt))
  )
    throw new Error(
      `NodeGym immutable attempt workspaces do not match receipts for ${plan.runId}.`,
    );
  const history = summarizeNodeGymAttemptHistory({
    plan,
    receipts,
    executor: selectedExecutor,
  });
  const latest = await readOptionalJson(path.join(runDir, 'latest.json'));
  assertNodeGymLatestReceipt(history, latest);
  return { ...history, evidenceByAttempt };
}

async function loadNodeGymAttemptEvidence({ plan, receipt, runDir, attemptsDir }) {
  const stem = `attempt-${String(receipt.attempt).padStart(3, '0')}`;
  const attemptRoot = path.join(attemptsDir, stem);
  const workspace = path.join(attemptRoot, 'work');
  await assertNodeGymRealPathContained(runDir, attemptRoot, 'immutable attempt evidence');
  await assertNodeGymRealPathContained(runDir, workspace, 'immutable attempt workspace');
  const paths = {
    plan: path.join(attemptRoot, 'plan.json'),
    executorResult: path.join(attemptRoot, 'executor-result.json'),
    semanticEvaluation: path.join(attemptRoot, 'semantic-evaluation.json'),
  };
  const [parsedPlan, executorResult, semanticEvaluation] = await Promise.all(
    Object.values(paths).map((filePath) => readJson(filePath)),
  );
  const files = Object.fromEntries(
    await Promise.all(
      Object.entries(paths).map(async ([key, filePath]) => [
        key,
        await nodeGymFileBinding(filePath, runDir),
      ]),
    ),
  );
  const artifacts = await loadNodeGymArtifactBindings(receipt.artifacts, workspace);
  assertNodeGymAttemptEvidence({
    plan,
    receipt,
    parsedPlan,
    executorResult,
    semanticEvaluation,
    files,
    artifacts,
  });
  return { parsedPlan, executorResult, semanticEvaluation, files, artifacts };
}

async function loadNodeGymArtifactBindings(artifacts, workspace) {
  const declared = nodeGymReceiptArtifactBindings(artifacts ?? {});
  return await Promise.all(
    declared.map(async (binding) => {
      assertNodeGymSafePathSyntax(binding.path, 'immutable attempt artifact');
      const filePath = path.resolve(workspace, binding.path);
      assertNodeGymContainedPath(workspace, filePath, 'immutable attempt artifact');
      await assertNodeGymRealPathContained(workspace, filePath, 'immutable attempt artifact');
      const details = await stat(filePath);
      if (!details.isFile()) throw new Error(`NodeGym artifact is not a file: ${binding.path}.`);
      return {
        path: binding.path,
        digest: await sha256File(filePath),
        bytes: details.size,
      };
    }),
  );
}

async function nodeGymFileBinding(filePath, runDir) {
  await assertNodeGymRealPathContained(runDir, filePath, 'immutable attempt evidence file');
  const details = await stat(filePath);
  if (!details.isFile()) throw new Error(`NodeGym attempt evidence is not a file: ${filePath}.`);
  return {
    path: path.relative(runDir, filePath).replaceAll('\\', '/'),
    digest: await sha256File(filePath),
    bytes: details.size,
  };
}

async function writeJson(filePath, value) {
  assertNodeGymContainedPath(campaignRoot, path.resolve(filePath), 'campaign output file');
  await writeNodeGymFileAtomic(campaignRoot, filePath, `${JSON.stringify(value, null, 2)}\n`, {
    label: 'campaign output file',
  });
}

async function writeImmutableJson(filePath, value) {
  assertNodeGymContainedPath(
    campaignRoot,
    path.resolve(filePath),
    'immutable campaign output file',
  );
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await assertNodeGymRealPathContained(campaignRoot, filePath, 'immutable campaign output file');
  const existing = await readFile(filePath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return null;
    throw error;
  });
  if (existing !== null && existing !== content)
    throw new Error(`Immutable campaign artifact changed: ${path.relative(root, filePath)}.`);
  if (existing === null)
    await writeNodeGymFileAtomic(campaignRoot, filePath, content, {
      exclusive: true,
      label: 'immutable campaign output file',
    });
}

async function sha256File(filePath) {
  return `sha256:${createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex')}`;
}

function executorEnvironment(gymConfig, evaluationFixture, protectedFixture) {
  const environment = {
    ...process.env,
    HOME: process.env.HOME ?? process.env.USERPROFILE,
  };
  for (const task of gymConfig.tasks ?? []) {
    if (!isProtectedNodeGymTask(task)) continue;
    if (task.fixture?.payloadEnv) delete environment[task.fixture.payloadEnv];
    if (task.fixture?.digestEnv) delete environment[task.fixture.digestEnv];
  }
  Reflect.deleteProperty(environment, 'NODE_GYM_SANITIZED_EGRESS_JSON');
  Reflect.deleteProperty(environment, 'NODE_GYM_SANITIZED_EGRESS_SHA256');
  if (protectedFixture && evaluationFixture) {
    environment.NODE_GYM_SANITIZED_EGRESS_JSON = JSON.stringify(evaluationFixture);
    environment.NODE_GYM_SANITIZED_EGRESS_SHA256 = digestTaskJson(evaluationFixture);
  }
  return environment;
}

function projectedRunCostMicroUsd(plan) {
  if (
    plan.model.provider === 'local' ||
    plan.model.route === 'openrouter/free' ||
    plan.model.route.endsWith(':free')
  )
    return 0;
  return plan.budget.maxCostMicroUsd;
}

function assertProtectedOutput(value, loadedFixture) {
  const leakage = assertNoProtectedFixtureLeakage(value, loadedFixture);
  if (!leakage.ok)
    throw new Error(`Protected fixture output leakage blocked: ${leakage.issueCodes.join(', ')}`);
}

function groupBy(values, key) {
  const groups = new Map();
  for (const value of values) {
    const id = key(value);
    const group = groups.get(id) ?? [];
    group.push(value);
    groups.set(id, group);
  }
  return groups;
}
