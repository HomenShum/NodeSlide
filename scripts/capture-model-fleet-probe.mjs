#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const outputPath = path.resolve(
  process.env.MODEL_FLEET_PROBE_OUTPUT ?? 'artifacts/model-fleet/model-fleet-probe.json',
);
const convexBin = path.join(process.cwd(), 'node_modules', 'convex', 'bin', 'main.js');
const child = spawn(
  process.execPath,
  [
    convexBin,
    'run',
    'nodeslideModelProbe:runFleet',
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
validateReceipt(receipt);
const artifact = {
  ...receipt,
  sourceCommit: process.env.GITHUB_SHA ?? null,
  productionDeployment: 'prod:agile-stoat-411',
  verification: {
    workflowRun: process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : null,
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

function validateReceipt(receipt) {
  if (
    !receipt ||
    receipt.schemaVersion !== 'nodeslide.model-fleet-probe/v1' ||
    !Number.isInteger(receipt.catalogModelCount) ||
    !Number.isInteger(receipt.probedModelCount) ||
    !Number.isInteger(receipt.failedModelCount) ||
    !Array.isArray(receipt.receipts) ||
    receipt.catalogModelCount !== receipt.probedModelCount ||
    receipt.receipts.length !== receipt.probedModelCount
  ) {
    fail('Convex fleet action returned an invalid receipt shape');
  }
  const serialized = JSON.stringify(receipt);
  if (/"(?:text|errorMessage|accumulatedText)"\s*:/.test(serialized)) {
    fail('Convex fleet receipt contained a forbidden provider-content field');
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

function fail(message) {
  console.error(`[model-fleet] FAIL ${message}`);
  process.exit(1);
}
