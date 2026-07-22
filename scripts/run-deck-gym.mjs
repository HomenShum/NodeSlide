#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const matrixPath = path.resolve(option('matrix') ?? 'artifacts/deck-gym/deck-gym-v1/matrix.json');
const runsDir = path.resolve(option('runs-dir') ?? path.join(path.dirname(matrixPath), 'runs'));
const baseUrl = productionUrl(option('url') ?? 'https://nodeslide.vercel.app/');
const requestedConcurrency = positiveInteger(option('concurrency'), 2);
const limit = positiveInteger(option('limit'), Number.MAX_SAFE_INTEGER);
const resume = !process.argv.includes('--no-resume');
const matrix = JSON.parse(await readFile(matrixPath, 'utf8'));
if (matrix?.schemaVersion !== 'nodeslide.deck-gym-matrix/v1' || !Array.isArray(matrix.runs)) {
  throw new Error('Deck Gym matrix is invalid.');
}
const maxConcurrency = Math.max(
  1,
  Math.min(requestedConcurrency, Number(matrix.runs[0]?.budgets?.maxConcurrency ?? 1)),
);
const runs = matrix.runs.slice(0, limit);
await mkdir(runsDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const queue = [...runs];
const receipts = [];
try {
  await Promise.all(
    Array.from({ length: Math.min(maxConcurrency, queue.length) }, (_, index) => worker(index + 1)),
  );
} finally {
  await browser.close();
}

receipts.sort((left, right) => left.runId.localeCompare(right.runId));
const summary = {
  schemaVersion: 'nodeslide.deck-gym-generation-summary/v1',
  matrixDigest: matrix.matrixDigest,
  generatedAt: new Date().toISOString(),
  requestedRuns: runs.length,
  completed: receipts.filter((entry) => entry.status === 'completed').length,
  failed: receipts.filter((entry) => entry.status === 'failed').length,
  skipped: receipts.filter((entry) => entry.status === 'skipped').length,
  concurrency: maxConcurrency,
  productionOrigin: baseUrl.origin,
  receipts,
};
await writeJson(path.join(path.dirname(runsDir), 'generation-summary.json'), summary);
console.log(
  `[deck-gym] generation complete: ${summary.completed} completed, ${summary.failed} failed, ${summary.skipped} skipped`,
);
if (summary.failed) process.exitCode = 1;

async function worker(workerId) {
  while (queue.length) {
    const run = queue.shift();
    if (!run) return;
    const runDir = path.join(runsDir, run.runId);
    const pptxPath = path.join(runDir, 'deck.pptx');
    const existing = await readJson(path.join(runDir, 'run.json')).catch(() => null);
    if (resume && (await exists(pptxPath)) && existing?.execution?.status === 'completed') {
      receipts.push({ runId: run.runId, status: 'skipped', reason: 'resume_artifact_exists' });
      console.log(`[deck-gym:${workerId}] SKIP ${run.runId}`);
      continue;
    }
    const receipt = await executeRun(workerId, run, runDir);
    receipts.push(receipt);
  }
}

async function executeRun(workerId, run, runDir) {
  await mkdir(runDir, { recursive: true });
  const pptxPath = path.join(runDir, 'deck.pptx');
  const evidenceDir = path.join(runDir, 'evidence-input');
  await mkdir(evidenceDir, { recursive: true });
  const evidencePaths = [];
  for (const attachment of run.attachments ?? []) {
    const filePath = path.join(evidenceDir, safeFileName(attachment.fileName));
    await writeFile(filePath, attachment.content, { mode: 0o600 });
    evidencePaths.push(filePath);
  }
  const startedAt = Date.now();
  const runtimeErrors = [];
  const context = await browser.newContext({
    viewport: { width: 1512, height: 982 },
    acceptDownloads: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${safeError(error.message)}`));
  page.on('console', (message) => {
    if (message.type() === 'error')
      runtimeErrors.push(`console.error: ${safeError(message.text())}`);
  });
  try {
    await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.getByTestId('nodeslide-landing').waitFor({ timeout: 45_000 });
    await page.getByLabel('Presentation brief').fill(run.prompt);
    await page.getByTestId('landing-model-select').selectOption(run.model);
    await page.getByTestId('landing-effort-select').selectOption(run.reasoningEffort);
    if (evidencePaths.length) {
      await page.getByTestId('landing-file-input').setInputFiles(evidencePaths);
      await page.locator('[aria-label="Attached data files"]').waitFor({ timeout: 30_000 });
      for (const attachment of run.attachments ?? []) {
        await page.getByText(attachment.fileName, { exact: true }).waitFor({ timeout: 30_000 });
      }
    }
    await page.getByLabel('Create presentation').click();
    try {
      await page.getByTestId('nodeslide-studio').waitFor({
        timeout: Math.min(300_000, Number(run.budgets?.maxCreateMs ?? 300_000)),
      });
    } catch (error) {
      const alert = await page
        .getByRole('alert')
        .textContent()
        .catch(() => null);
      throw new Error(alert?.trim() || 'Creation did not reach the editor.', { cause: error });
    }
    await page.getByTestId('slide-canvas').waitFor({ timeout: 45_000 });
    await page.screenshot({ path: path.join(runDir, 'editor.png'), fullPage: true });
    const trace = await captureTrace(page);

    await page.getByLabel('Export deck').click();
    await page.getByTestId('export-pptx').waitFor({ timeout: 30_000 });
    const downloadPromise = page.waitForEvent('download', {
      timeout: Math.min(90_000, Number(run.budgets?.maxExportMs ?? 90_000)),
    });
    await page.getByTestId('export-pptx').click();
    const download = await downloadPromise;
    await download.saveAs(pptxPath);
    await page.getByText('Validated PowerPoint export prepared.', { exact: true }).waitFor({
      timeout: Math.min(90_000, Number(run.budgets?.maxExportMs ?? 90_000)),
    });
    const pptx = await stat(pptxPath);
    const execution = {
      status: 'completed',
      productionOrigin: baseUrl.origin,
      editorUrl: page.url(),
      durationMs: Date.now() - startedAt,
      completedAt: new Date().toISOString(),
      trace,
      runtimeErrors: runtimeErrors.slice(0, 20),
      pptx: { file: 'deck.pptx', bytes: pptx.size },
      editorScreenshot: 'editor.png',
    };
    await writeJson(path.join(runDir, 'run.json'), { ...run, execution });
    console.log(
      `[deck-gym:${workerId}] PASS ${run.runId} (${Math.round(execution.durationMs / 1000)}s; ${trace.classification})`,
    );
    return { runId: run.runId, status: 'completed', durationMs: execution.durationMs };
  } catch (error) {
    const failure = safeError(error);
    await page
      .screenshot({ path: path.join(runDir, 'failure.png'), fullPage: true })
      .catch(() => undefined);
    await writeJson(path.join(runDir, 'run.json'), {
      ...run,
      execution: {
        status: 'failed',
        productionOrigin: baseUrl.origin,
        durationMs: Date.now() - startedAt,
        completedAt: new Date().toISOString(),
        failure,
        runtimeErrors: runtimeErrors.slice(0, 20),
      },
    });
    console.error(`[deck-gym:${workerId}] FAIL ${run.runId}: ${failure}`);
    return { runId: run.runId, status: 'failed', failure };
  } finally {
    await context.close();
  }
}

async function captureTrace(page) {
  const openInspector = page.getByLabel('Open inspector');
  if ((await openInspector.count()) === 1 && (await openInspector.isVisible())) {
    await openInspector.click();
  }
  const traceTab = page.getByRole('tab', { name: 'Trace', exact: true });
  if ((await traceTab.count()) !== 1) {
    return { classification: 'unknown', reason: 'trace_tab_unavailable' };
  }
  await traceTab.click();
  const title = page.locator('.ns-trace-run-title');
  if ((await title.count()) !== 1) {
    return { classification: 'unknown', reason: 'trace_receipt_unavailable' };
  }
  await title.waitFor({ timeout: 30_000 });
  const attribution = await page
    .locator('.ns-trace-attrib')
    .innerText()
    .catch(() => '');
  const summary = await title.innerText();
  const metrics = await page
    .locator('.ns-trace-kpis')
    .innerText()
    .catch(() => '');
  const fallback = /fallback/iu.test(`${attribution} ${summary}`);
  const live = !fallback && /openrouter|nebius|kimi|claude|gemini|glm|gpt/iu.test(attribution);
  return {
    classification: fallback ? 'degraded' : live ? 'live' : 'unknown',
    attribution: safeText(attribution, 300),
    summary: safeText(summary, 800),
    metrics: safeText(metrics, 500),
  };
}

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function productionUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new Error('Deck Gym production URL must be a clean HTTPS URL.');
  }
  return url;
}

function safeFileName(value) {
  const name = path.basename(String(value)).replace(/[^A-Za-z0-9._-]/gu, '_');
  if (!name || name === '.' || name === '..') throw new Error('Attachment filename is invalid.');
  return name.slice(0, 120);
}

function safeText(value, maxLength) {
  return String(value).replace(/\s+/gu, ' ').trim().slice(0, maxLength);
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error)
    .replace(/\bBearer\s+\S+/giu, 'Bearer [REDACTED]')
    .replace(/\b(?:prod|dev|preview):[^|\s]+\|[^\s"']+/giu, '[REDACTED_DEPLOY_KEY]')
    .replace(/\b[A-Za-z0-9_-]{64,}\b/gu, '[REDACTED_LONG_VALUE]')
    .slice(0, 600);
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
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
