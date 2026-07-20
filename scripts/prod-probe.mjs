#!/usr/bin/env node
/**
 * Fail-closed production journey probe.
 *
 * The probe deliberately uses deterministic generation: it exercises the real
 * production create action without external-model cost or provider flakiness.
 * It then persists a title edit, reloads the owned deck to prove the server
 * receipt, downloads a PPTX, and inspects the archive in memory. Capability
 * keys, deck ids, browser storage, screenshots, and the PPTX are never written
 * to the diagnostic artifact.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import { chromium } from 'playwright';

const DEFAULT_URL = 'https://nodeslide.vercel.app';
const DEFAULT_REPORT = 'artifacts/prod-probe/report.json';
const CREATE_TIMEOUT_MS = boundedInteger(process.env.PROD_PROBE_CREATE_TIMEOUT_MS, 180_000, {
  min: 10_000,
  max: 300_000,
});
const ACTION_TIMEOUT_MS = boundedInteger(process.env.PROD_PROBE_ACTION_TIMEOUT_MS, 45_000, {
  min: 5_000,
  max: 120_000,
});
const baseUrl = productionUrl(process.env.PROD_PROBE_URL ?? DEFAULT_URL);
const reportPath = path.resolve(process.env.PROD_PROBE_REPORT ?? DEFAULT_REPORT);
const startedAt = new Date();
const runLabel = safeRunLabel(process.env.GITHUB_RUN_ID, startedAt);
const editedTitle = `NodeSlide ops probe ${runLabel}`;

const report = {
  schemaVersion: 1,
  probe: 'create-edit-reload-export',
  status: 'running',
  origin: baseUrl.origin,
  startedAt: startedAt.toISOString(),
  completedAt: null,
  stage: 'startup',
  assertions: [],
  failure: null,
};

/** @type {import('playwright').Browser | null} */
let browser = null;
/** @type {string[]} */
const runtimeErrors = [];

try {
  browser = await chromium.launch();
  const context = await browser.newContext({
    acceptDownloads: true,
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(ACTION_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(ACTION_TIMEOUT_MS);
  page.on('pageerror', (error) => {
    runtimeErrors.push(`pageerror: ${redact(error.message)}`);
  });
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(`console.error: ${redact(message.text())}`);
  });

  await step('landing-live', async () => {
    const response = await page.goto(baseUrl.href, { waitUntil: 'domcontentloaded' });
    assert(response?.status() === 200, `landing returned HTTP ${response?.status() ?? 'none'}`);
    await page.getByTestId('nodeslide-landing').waitFor({ state: 'visible' });
    assert(
      (await page.getByTestId('deployment-configuration-error').count()) === 0,
      'deployment guard rendered',
    );
    await page.locator('.ns-landing-sample').waitFor({ state: 'visible' });
    assertNoRuntimeErrors(runtimeErrors);
  });

  await step('create-deterministic', async () => {
    await page.getByTestId('landing-model-select').selectOption('deterministic');
    await page
      .getByLabel('Presentation brief')
      .fill(
        'Create a concise six-slide operational readiness review with a clear decision, a small editable chart, and source-safe claims. This is an automated synthetic production probe.',
      );
    await page.getByLabel('Create presentation').click();
    try {
      await page.getByTestId('nodeslide-studio').waitFor({
        state: 'visible',
        timeout: CREATE_TIMEOUT_MS,
      });
    } catch (error) {
      const visibleAlert = await page
        .getByRole('alert')
        .last()
        .textContent()
        .catch(() => null);
      throw new Error(
        visibleAlert
          ? `creation did not reach the editor: ${redact(visibleAlert)}`
          : `creation did not reach the editor within ${CREATE_TIMEOUT_MS}ms`,
        { cause: error },
      );
    }
    const deckUrl = new URL(page.url());
    assert(deckUrl.origin === baseUrl.origin, 'creation navigated away from the production origin');
    assert(deckUrl.searchParams.has('deck'), 'editor URL did not receive a deck id');
    await page.getByTestId('slide-canvas').waitFor({ state: 'visible' });
    assertNoRuntimeErrors(runtimeErrors);
  });

  let committedVersion = 0;
  await step('edit-and-commit', async () => {
    const title = page.getByTestId('deck-title');
    const version = page.locator('.ns-version-label');
    const initialVersion = parseVersion(await version.textContent());
    await title.fill(editedTitle);
    await title.press('Enter');
    await page.waitForFunction(
      ({ expectedTitle, previousVersion }) => {
        const titleInput = document.querySelector('[data-testid="deck-title"]');
        const versionLabel = document.querySelector('.ns-version-label');
        const nextVersion = Number(versionLabel?.textContent?.match(/v(\d+)/)?.[1] ?? Number.NaN);
        return (
          titleInput instanceof HTMLInputElement &&
          titleInput.value === expectedTitle &&
          Number.isInteger(nextVersion) &&
          nextVersion === previousVersion + 1
        );
      },
      { expectedTitle: editedTitle, previousVersion: initialVersion },
      { timeout: ACTION_TIMEOUT_MS },
    );
    committedVersion = parseVersion(await version.textContent());
    assert(
      committedVersion === initialVersion + 1,
      'title edit did not advance exactly one version',
    );
    assertNoRuntimeErrors(runtimeErrors);
  });

  await step('reload-persisted-edit', async () => {
    const response = await page.reload({ waitUntil: 'domcontentloaded' });
    assert(
      response?.status() === 200,
      `editor reload returned HTTP ${response?.status() ?? 'none'}`,
    );
    await page.getByTestId('nodeslide-studio').waitFor({ state: 'visible' });
    await page.getByTestId('deck-title').waitFor({ state: 'visible' });
    assert(
      (await page.getByTestId('deck-title').inputValue()) === editedTitle,
      'title edit was not durable after reload',
    );
    assert(
      parseVersion(await page.locator('.ns-version-label').textContent()) === committedVersion,
      'reloaded version did not match the committed version',
    );
    assertNoRuntimeErrors(runtimeErrors);
  });

  await step('export-pptx', async () => {
    await page.getByLabel('Export deck').click();
    await page.getByTestId('export-pptx').waitFor({ state: 'visible' });
    const downloadPromise = page.waitForEvent('download', { timeout: ACTION_TIMEOUT_MS });
    await page.getByTestId('export-pptx').click();
    const download = await downloadPromise;
    const downloadFailure = await download.failure();
    assert(downloadFailure === null, `browser download failed: ${redact(downloadFailure ?? '')}`);
    assert(
      download.suggestedFilename().toLowerCase().endsWith('.pptx'),
      'export filename was not a PPTX',
    );
    const downloadPath = await download.path();
    assert(downloadPath, 'Playwright did not expose the downloaded PPTX');
    const archive = await JSZip.loadAsync(await readFile(downloadPath));
    assert(Boolean(archive.file('[Content_Types].xml')), 'PPTX is missing [Content_Types].xml');
    assert(Boolean(archive.file('ppt/presentation.xml')), 'PPTX is missing ppt/presentation.xml');
    const slideEntries = Object.keys(archive.files).filter((entry) =>
      /^ppt\/slides\/slide\d+\.xml$/.test(entry),
    );
    assert(slideEntries.length >= 1, 'PPTX contains no slide XML');
    await page.getByText('Validated PowerPoint export prepared.', { exact: true }).waitFor({
      state: 'visible',
      timeout: ACTION_TIMEOUT_MS,
    });
    await page.waitForTimeout(750);
    assertNoRuntimeErrors(runtimeErrors);
    return { slideCount: slideEntries.length };
  });

  report.status = 'passed';
  report.stage = 'complete';
  console.log('[prod-probe] PASS create -> edit -> reload -> PPTX export');
} catch (error) {
  report.status = 'failed';
  report.failure = {
    code: failureCode(error),
    message: redact(error instanceof Error ? error.message : String(error)),
  };
  console.error(
    `[prod-probe] FAIL at ${report.stage}: ${report.failure.code}: ${report.failure.message}`,
  );
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => undefined);
  report.completedAt = new Date().toISOString();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`[prod-probe] sanitized report: ${path.relative(process.cwd(), reportPath)}`);
}

async function step(name, run) {
  report.stage = name;
  const stepStartedAt = Date.now();
  try {
    const detail = await run();
    report.assertions.push({
      name,
      status: 'passed',
      durationMs: Date.now() - stepStartedAt,
      ...(detail && typeof detail === 'object' ? { detail } : {}),
    });
    console.log(`[prod-probe] PASS ${name}`);
    return detail;
  } catch (error) {
    report.assertions.push({
      name,
      status: 'failed',
      durationMs: Date.now() - stepStartedAt,
      code: failureCode(error),
    });
    throw error;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertNoRuntimeErrors(errors) {
  if (errors.length === 0) return;
  throw new Error(
    `browser reported ${errors.length} runtime error(s): ${errors.slice(0, 3).join(' | ')}`,
  );
}

function parseVersion(text) {
  const match = text?.match(/v(\d+)/);
  const version = Number(match?.[1]);
  assert(Number.isInteger(version) && version >= 1, 'editor did not expose a valid deck version');
  return version;
}

function productionUrl(value) {
  const url = new URL(value);
  const allowHttp = process.env.PROD_PROBE_ALLOW_HTTP === '1';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new Error('PROD_PROBE_URL must use HTTPS');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('PROD_PROBE_URL must not contain credentials, query parameters, or a fragment');
  }
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url;
}

function safeRunLabel(value, date) {
  if (value && /^\d{1,30}$/.test(value)) return value;
  return date.toISOString().replace(/[:.]/g, '-');
}

function boundedInteger(value, fallback, { min, max }) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`timeout must be an integer between ${min} and ${max}`);
  }
  return parsed;
}

function failureCode(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/timeout|within \d+ms/i.test(message)) return 'timeout';
  if (/HTTP \d+/i.test(message)) return 'http';
  if (/runtime error|console\.error|pageerror/i.test(message)) return 'browser-runtime';
  if (/PPTX|download|archive|slide XML/i.test(message)) return 'export';
  if (/version|durable|persist/i.test(message)) return 'edit-persistence';
  return 'assertion';
}

function redact(value) {
  return String(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/\b(?:prod|dev|preview):[^|\s]+\|[^\s"']+/gi, '[REDACTED_DEPLOY_KEY]')
    .replace(/([?&](?:token|key|secret|authorization|ownerAccessKey)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(
      /("?(?:ownerAccessKey|accessToken|apiKey|secret|authorization)"?\s*[:=]\s*)["']?[^\s,"'}]+/gi,
      '$1[REDACTED]',
    )
    .replace(/\b[A-Za-z0-9_-]{64,}\b/g, '[REDACTED_LONG_VALUE]')
    .slice(0, 1_500);
}
