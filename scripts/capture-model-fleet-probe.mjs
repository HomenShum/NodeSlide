#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';
import { validateModelFleetReceipt } from './lib/model-fleet-receipt-core.mjs';
import {
  assertNodeSlideProductionDeployKey,
  captureNodeSlideConvexBuildIdentity,
  captureWebDeploymentIdentity,
  requiredExactMainSha,
  requiredNodeSlideProductionOrigin,
  requiredNodeSlideWorkflowRun,
  verifyNodeSlideDeploymentRun,
  verifyNodeSlideExactMainSource,
} from './lib/production-deployment-identity.mjs';

const outputPath = path.resolve(
  option('output') ??
    process.env.MODEL_FLEET_PROBE_OUTPUT ??
    'artifacts/model-fleet/model-fleet-probe.json',
);
const probeFunction = option('function') ?? process.env.MODEL_FLEET_PROBE_FUNCTION ?? 'runFleet';
const expectedSchema =
  option('schema') ?? process.env.MODEL_FLEET_PROBE_SCHEMA ?? 'nodeslide.model-fleet-probe/v1';
const allowedProbeFunctions = new Map([
  ['runFleet', 'nodeslide.model-fleet-probe/v1'],
  ['runFreeRouterFleet', 'nodeslide.free-router-fleet-probe/v1'],
  ['runFreeRouterStructured', 'nodeslide.free-router-structured-probe/v1'],
]);
if (allowedProbeFunctions.get(probeFunction) !== expectedSchema) {
  fail('Probe function and expected schema are not an allowed pair');
}
try {
  assertNodeSlideProductionDeployKey(process.env.CONVEX_DEPLOY_KEY);
} catch (error) {
  fail(error instanceof Error ? error.message : 'Production deployment key scope is invalid');
}
const sourceCommit = requiredExactMainSha(
  process.env.MODEL_FLEET_PROBE_COMMIT_SHA,
  'MODEL_FLEET_PROBE_COMMIT_SHA',
);
const workflowRun = requiredNodeSlideWorkflowRun(
  process.env.MODEL_FLEET_PROBE_WORKFLOW_RUN_URL,
  'MODEL_FLEET_PROBE_WORKFLOW_RUN_URL',
);
const productionUrl = requiredNodeSlideProductionOrigin(
  process.env.MODEL_FLEET_PROBE_URL ?? 'https://nodeslide.vercel.app/',
  'MODEL_FLEET_PROBE_URL',
);
const convexClient = new ConvexHttpClient('https://agile-stoat-411.convex.cloud');
const [verifiedWorkflowRun, exactMainSourceBefore, deploymentIdentity, convexDeploymentIdentity] =
  await Promise.all([
    verifyNodeSlideDeploymentRun(workflowRun, sourceCommit),
    verifyNodeSlideExactMainSource(sourceCommit, process.env.GITHUB_TOKEN),
    captureWebDeploymentIdentity(productionUrl, sourceCommit),
    captureNodeSlideConvexBuildIdentity(
      () => convexClient.query(api.nodeslideBuildIdentity.get, {}),
      sourceCommit,
    ),
  ]);
const convexBin = path.join(process.cwd(), 'node_modules', 'convex', 'bin', 'main.js');
const child = spawn(
  process.execPath,
  [
    convexBin,
    'run',
    `nodeslideModelProbe:${probeFunction}`,
    '{}',
    '--prod',
    '--typecheck',
    'disable',
    '--codegen',
    'disable',
  ],
  { cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
);

let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdout = `${stdout}${chunk}`.slice(-1_000_000);
});
child.stderr.on('data', (chunk) => {
  stderr = `${stderr}${chunk}`.slice(-20_000);
});
const exitCode = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('close', resolve);
});
if (exitCode !== 0) fail(`Convex fleet action failed (${safeDiagnostic(stderr)})`);

const receipt = parseReceipt(stdout);
try {
  validateModelFleetReceipt(receipt, expectedSchema);
} catch (error) {
  fail(error instanceof Error ? error.message : 'Convex fleet action returned an invalid receipt');
}
const exactMainSourceAfter = await verifyNodeSlideExactMainSource(
  sourceCommit,
  process.env.GITHUB_TOKEN,
);
const artifact = {
  ...receipt,
  sourceCommit,
  productionDeployment: 'prod:agile-stoat-411',
  deploymentIdentity,
  convexDeploymentIdentity,
  exactMainSource: {
    before: exactMainSourceBefore,
    after: exactMainSourceAfter,
  },
  verification: {
    workflowRun: verifiedWorkflowRun,
  },
};
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
console.log(
  `[model-fleet] ${receipt.passed ? 'PASS' : 'FAIL'} ${receipt.probedModelCount - receipt.failedModelCount}/${receipt.probedModelCount} offered routes returned assistant text`,
);
console.log(`[model-fleet] artifact: ${path.relative(process.cwd(), outputPath)}`);
if (!receipt.passed) process.exit(1);

export function parseReceipt(output) {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) fail('Convex fleet action returned no JSON receipt');
  try {
    return JSON.parse(output.slice(start, end + 1));
  } catch {
    fail('Convex fleet action returned malformed JSON');
  }
}

function safeDiagnostic(value) {
  return String(value)
    .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:prod|dev|preview):[^|\s]+\|[^\s"']+/gi, '[REDACTED_DEPLOY_KEY]')
    .replace(/\b[A-Za-z0-9_-]{64,}\b/g, '[REDACTED_LONG_VALUE]')
    .trim()
    .slice(0, 500);
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
  console.error(`[model-fleet] FAIL ${message}`);
  process.exit(1);
}
