#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import {
  NODE_GYM_EXECUTOR_RESULT_SCHEMA,
  assertNodeGymRealPathContained,
  writeNodeGymFileAtomic,
} from './lib/node-gym-runner-core.mjs';

const plan = JSON.parse(await readFile(path.resolve(requiredOption('plan')), 'utf8'));
const runDir = path.resolve(requiredOption('run-dir'));
const outputPath = path.resolve(requiredOption('out'));
const sourceCampaign = path.resolve(requiredOption('source-campaign'));
const sourceRun = path.join(sourceCampaign, 'runs', safeSegment(plan.runId));
const sourceResult = await latestExecutorResult(sourceRun);
const startedAt = Date.now();
await mkdir(runDir, { recursive: true });
await assertNodeGymRealPathContained(path.dirname(runDir), runDir, 'recovery run directory');
await assertNodeGymRealPathContained(runDir, outputPath, 'recovery executor result');
const browserPath = await copyRequired('editor.png');
const pptxPath = await copyRequired('deck.pptx');
const renderedDir = path.join(runDir, 'pptx-rendered');
const sourceRendered = path.join(sourceRun, 'pptx-rendered');
await copyRendered(sourceRendered, renderedDir);
const tools = await presentationTools();
const overflow = await runProcess(tools.python, [tools.test, pptxPath], 120_000, true);
if ((await countSlides(renderedDir)) === 0) {
  await runProcess(
    tools.python,
    [tools.render, pptxPath, '--output_dir', renderedDir, '--width', '1600', '--height', '900'],
    300_000,
  );
}
const renderedSlides = await countSlides(renderedDir);
const pdfPath = path.join(runDir, 'deck.pdf');
await runProcess(
  tools.python,
  [path.resolve('scripts/rendered-slides-to-pdf.py'), '--input-dir', renderedDir, '--out', pdfPath],
  120_000,
);
const deckText = await extractPptxText(pptxPath);
const unsupportedClaims = [
  /\bfully autonomous\b/giu,
  /\bzero errors?\b/giu,
  /\bautomatic(?:ally)? promot(?:e|ed|ion)\b/giu,
  /\bfrontier[- ]equivalent\b/giu,
].flatMap((pattern) => deckText.match(pattern) ?? []);
const result = {
  schemaVersion: NODE_GYM_EXECUTOR_RESULT_SCHEMA,
  runId: plan.runId,
  pairingKey: plan.pairingKey,
  status: 'completed',
  // The browser session that held the exact trace is gone. Requested model is
  // not equivalent to returned route, so this recovery remains degraded.
  route: { mode: 'degraded' },
  usage: {
    latencyMs: Number(sourceResult?.usage?.latencyMs ?? Date.now() - startedAt),
    inputTokens: Number(sourceResult?.usage?.inputTokens ?? 0),
    outputTokens: Number(sourceResult?.usage?.outputTokens ?? 0),
    costMicroUsd: Number(sourceResult?.usage?.costMicroUsd ?? 0),
    repairCount: Number(sourceResult?.usage?.repairCount ?? 0),
  },
  artifacts: {
    browser: fileArtifact(browserPath, 'passed'),
    pptx: fileArtifact(pptxPath, overflow.ok ? 'passed' : 'failed', 'text_overflow'),
    pdf: {
      ...fileArtifact(pdfPath, 'passed'),
      fidelity: 'rasterized-static-fallback',
      validationMethod: 'source-render-identity-and-pypdf-page-count',
    },
  },
  diagnostics: {
    recoveredFromCampaign: path.basename(sourceCampaign),
    recoveredWithoutProviderCall: true,
    estimatedTextOverflowCount: overflow.ok ? 0 : 1,
    exportTimedOut: false,
    unsupportedClaimCount: unsupportedClaims.length,
    unsupportedClaims,
    freeModelClaimUnattributed: /\b(?:free model|free route|zero-cost)\b/iu.test(deckText),
    claimAudit: {
      status: unsupportedClaims.length ? 'failed' : 'passed',
      method: 'bounded-forbidden-claim-scan',
    },
    renderedSlides,
  },
  issueCodes: [
    'returned_model_attribution_missing',
    'metering_not_independently_recovered',
    'typed_artifact_spec_not_observed',
    ...(overflow.ok ? [] : ['pptx_text_overflow']),
    ...(unsupportedClaims.length ? ['unsupported_claim'] : []),
  ],
};
await writeNodeGymFileAtomic(runDir, outputPath, `${JSON.stringify(result, null, 2)}\n`, {
  exclusive: true,
  label: 'recovery executor result',
});

async function copyRequired(name) {
  const source = path.join(sourceRun, name);
  const destination = path.join(runDir, name);
  const details = await stat(source);
  if (!details.isFile() || details.size === 0) throw new Error(`Recovery source missing: ${name}.`);
  await copyFile(source, destination);
  return destination;
}

async function copyRendered(source, destination) {
  await mkdir(destination, { recursive: true });
  for (const name of await readdir(source).catch(() => []))
    if (/^slide-\d+\.png$/u.test(name))
      await copyFile(path.join(source, name), path.join(destination, name));
}

async function latestExecutorResult(source) {
  const names = (await readdir(source).catch(() => []))
    .filter((name) => /^executor-result-\d+\.json$/u.test(name))
    .sort()
    .reverse();
  return names[0] ? JSON.parse(await readFile(path.join(source, names[0]), 'utf8')) : null;
}

function fileArtifact(filePath, status, issueCode) {
  return {
    path: path.relative(runDir, filePath).replaceAll('\\', '/'),
    digest: null,
    bytes: 0,
    validation: { status, ...(status === 'passed' ? {} : { issueCode }) },
  };
}

async function extractPptxText(filePath) {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const names = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/u.test(name));
  const chunks = [];
  for (const name of names) {
    const xml = await zip.file(name)?.async('string');
    for (const match of xml?.matchAll(/<a:t>(.*?)<\/a:t>/gsu) ?? []) chunks.push(match[1]);
  }
  return chunks.join(' ');
}

async function presentationTools() {
  const versionsRoot = path.join(
    process.env.USERPROFILE ?? os.homedir(),
    '.codex',
    'plugins',
    'cache',
    'openai-primary-runtime',
    'presentations',
  );
  const versions = (await readdir(versionsRoot, { withFileTypes: true }).catch(() => []))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const version of versions) {
    const container = path.join(
      versionsRoot,
      version,
      'skills',
      'presentations',
      'container_tools',
    );
    const render = path.join(container, 'render_slides.py');
    const test = path.join(container, 'slides_test.py');
    if ((await exists(render)) && (await exists(test)))
      return { python: process.env.NODE_GYM_PYTHON ?? 'python', render, test };
  }
  throw new Error('Presentation tools unavailable.');
}

async function runProcess(executable, args, timeoutMs, allowFailure = false) {
  const child = spawn(executable, args, {
    cwd: process.cwd(),
    env: { ...process.env, HOME: process.env.HOME ?? process.env.USERPROFILE },
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
  if (exitCode !== 0 && !allowFailure)
    throw new Error(stderr.trim() || `${path.basename(executable)} failed.`);
  return { ok: exitCode === 0 };
}

async function countSlides(directory) {
  return (await readdir(directory).catch(() => [])).filter((name) => /^slide-\d+\.png$/u.test(name))
    .length;
}

async function exists(filePath) {
  return stat(filePath).then(
    () => true,
    () => false,
  );
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name) {
  const value = option(name);
  if (!value) throw new Error(`Missing --${name}.`);
  return value;
}

function safeSegment(value) {
  return String(value)
    .replace(/[^A-Za-z0-9._-]+/gu, '-')
    .replace(/^-|-$/gu, '')
    .slice(0, 180);
}
