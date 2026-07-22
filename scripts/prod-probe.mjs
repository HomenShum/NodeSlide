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
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ConvexHttpClient } from 'convex/browser';
import JSZip from 'jszip';
import { chromium } from 'playwright';
import { api } from '../convex/_generated/api.js';
import { redactNodeGymDiagnostic } from './lib/node-gym-redaction-core.mjs';
import {
  captureWebDeploymentIdentity,
  requiredExactMainSha,
  requiredNodeSlideProductionOrigin,
  requiredNodeSlideWorkflowRun,
  validateNodeSlideConvexBuildIdentity,
  verifyNodeSlideDeploymentRun,
  verifyNodeSlideExactMainSource,
} from './lib/production-deployment-identity.mjs';
import {
  assertProductionProbeCleanupDisposition,
  cleanupNodeSlideProductionProbe,
} from './lib/production-fixture-retention.mjs';

const DEFAULT_URL = 'https://nodeslide.vercel.app';
const DEFAULT_CONVEX_URL = 'https://agile-stoat-411.convex.cloud';
const DEFAULT_REPORT = 'artifacts/prod-probe/report.json';
const CREATE_TIMEOUT_MS = boundedInteger(process.env.PROD_PROBE_CREATE_TIMEOUT_MS, 180_000, {
  min: 10_000,
  max: 300_000,
});
const ACTION_TIMEOUT_MS = boundedInteger(process.env.PROD_PROBE_ACTION_TIMEOUT_MS, 45_000, {
  min: 5_000,
  max: 120_000,
});
const baseUrl = requiredNodeSlideProductionOrigin(
  process.env.PROD_PROBE_URL ?? DEFAULT_URL,
  'PROD_PROBE_URL',
);
const convexUrl = productionConvexUrl(process.env.PROD_PROBE_CONVEX_URL ?? DEFAULT_CONVEX_URL);
const expectedMainSha = requiredExactMainSha(
  process.env.PROD_PROBE_COMMIT_SHA,
  'PROD_PROBE_COMMIT_SHA',
);
const workflowRun = requiredNodeSlideWorkflowRun(
  process.env.PROD_PROBE_WORKFLOW_RUN_URL,
  'PROD_PROBE_WORKFLOW_RUN_URL',
);
const reportPath = path.resolve(process.env.PROD_PROBE_REPORT ?? DEFAULT_REPORT);
const startedAt = new Date();
const runLabel = safeRunLabel(process.env.GITHUB_RUN_ID, startedAt);
const editedTitle = `NodeSlide ops probe ${runLabel}`;
const probeCleanupToken = `probe_${randomBytes(32).toString('base64url')}`;

const report = {
  schemaVersion: 3,
  probe: 'create-edit-reload-artifact-shadow-export-delete',
  status: 'running',
  origin: baseUrl.origin,
  exactMain: {
    commitSha: expectedMainSha,
    workflowRunId: workflowRun.id,
    workflowRunUrl: workflowRun.url,
  },
  deploymentIdentity: null,
  convexDeploymentIdentity: null,
  startedAt: startedAt.toISOString(),
  completedAt: null,
  stage: 'startup',
  assertions: [],
  failure: null,
};

/** @type {import('playwright').Browser | null} */
let browser = null;
/** @type {import('playwright').BrowserContext | null} */
let context = null;
/** @type {import('playwright').Page | null} */
let page = null;
/** @type {string[]} */
const runtimeErrors = [];
const diagnosticTokens = new Set();
let createdDeckId = '';
let ownerAccessKey = '';
let creationSubmitted = false;
let probeClientSessionId = '';
diagnosticTokens.add(probeCleanupToken);

try {
  await step('deployment-identity', async () => {
    const [verifiedWorkflowRun, exactMainSource] = await Promise.all([
      verifyNodeSlideDeploymentRun(workflowRun, expectedMainSha),
      verifyNodeSlideExactMainSource(expectedMainSha, process.env.GITHUB_TOKEN),
    ]);
    report.exactMain = { ...report.exactMain, ...exactMainSource };
    report.deploymentIdentity = await captureWebDeploymentIdentity(baseUrl, expectedMainSha);
    const convex = new ConvexHttpClient(convexUrl.href);
    report.convexDeploymentIdentity = validateNodeSlideConvexBuildIdentity(
      await convex.query(api.nodeslideBuildIdentity.get, {}),
      expectedMainSha,
    );
    return {
      workflowRun: verifiedWorkflowRun,
      exactMainSource,
      live: report.deploymentIdentity,
      convex: report.convexDeploymentIdentity,
    };
  });
  browser = await chromium.launch();
  context = await browser.newContext({
    acceptDownloads: true,
    serviceWorkers: 'block',
  });
  await context.addInitScript(
    ({ storageKey, cleanupToken }) => {
      window.sessionStorage.setItem(storageKey, cleanupToken);
    },
    {
      storageKey: 'nodeslide.productionProbeCleanupToken.v1',
      cleanupToken: probeCleanupToken,
    },
  );
  page = await context.newPage();
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
    probeClientSessionId = await page.evaluate(
      () =>
        window.localStorage.getItem('parity.studio.sessionId') ??
        window.sessionStorage.getItem('parity.studio.sessionId') ??
        '',
    );
    assert(
      probeClientSessionId.length > 0 && probeClientSessionId.length <= 256,
      'production probe client session was not initialized',
    );
    diagnosticTokens.add(probeClientSessionId);
    assertNoRuntimeErrors(runtimeErrors);
  });

  await step('create-deterministic', async () => {
    await page.getByTestId('landing-model-select').selectOption('deterministic');
    await page
      .getByLabel('Presentation brief')
      .fill(
        'Create a concise six-slide operational readiness review with a clear decision, a small editable chart, and source-safe claims. This is an automated synthetic production probe.',
      );
    creationSubmitted = true;
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
    createdDeckId = deckUrl.searchParams.get('deck') ?? '';
    if (createdDeckId) diagnosticTokens.add(createdDeckId);
    ownerAccessKey = await page.evaluate((deckId) => {
      try {
        const raw = window.localStorage.getItem('nodeslide.deckAccess.v1');
        const parsed = raw ? JSON.parse(raw) : null;
        return parsed && typeof parsed === 'object' && typeof parsed[deckId] === 'string'
          ? parsed[deckId]
          : '';
      } catch {
        return '';
      }
    }, createdDeckId);
    if (ownerAccessKey) diagnosticTokens.add(ownerAccessKey);
    assert(ownerAccessKey.length > 0, 'editor did not retain the owner capability in-session');
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

  await step('artifact-and-routing-shadow', async () => {
    assert(
      createdDeckId && ownerAccessKey,
      'owned deck capability is unavailable for shadow proof',
    );
    const convex = new ConvexHttpClient(convexUrl.href);
    const [artifactReceipt, routeReceipt] = await Promise.all([
      convex.query(api.nodeslideArtifactSpec.shadowCompile, {
        deckId: createdDeckId,
        ownerAccessKey,
      }),
      convex.query(api.nodeslideGymShadow.route, {
        deckId: createdDeckId,
        ownerAccessKey,
        taskClass: 'artifact-spec',
      }),
    ]);
    assert(
      artifactReceipt.schemaVersion === 'nodeslide.artifact-shadow-receipt/v1' &&
        artifactReceipt.status === 'passed' &&
        artifactReceipt.userVisible === false &&
        artifactReceipt.mutationApplied === false &&
        artifactReceipt.anonymized === true,
      'ArtifactSpec production shadow receipt was not a passing non-mutating receipt',
    );
    assert(
      Number.isSafeInteger(artifactReceipt.canonicalArtifactCount) &&
        artifactReceipt.canonicalArtifactCount > 0 &&
        Number.isSafeInteger(artifactReceipt.authoredBindingCount) &&
        artifactReceipt.authoredBindingCount > 0,
      'ArtifactSpec shadow did not observe an authored canonical artifact and persisted binding',
    );
    assert(
      Array.isArray(artifactReceipt.canonicalKindCounts) &&
        artifactReceipt.canonicalKindCounts.some(
          (entry) =>
            entry?.kind === 'chart' && Number.isSafeInteger(entry.count) && entry.count > 0,
        ),
      'Deterministic production fixture did not retain its required canonical chart',
    );
    assert(
      routeReceipt.schemaVersion === 'nodeslide.node-gym-shadow-route-receipt/v1' &&
        routeReceipt.userVisible === false &&
        routeReceipt.mutationApplied === false &&
        routeReceipt.autoApply === false &&
        routeReceipt.anonymized === true &&
        routeReceipt.eligibleInput === true &&
        routeReceipt.route?.mode === 'fallback',
      'NodeGym production shadow route did not remain advisory and fail closed',
    );
    const serialized = JSON.stringify({ artifactReceipt, routeReceipt });
    assert(!serialized.includes(createdDeckId), 'shadow receipt exposed the stable deck id');
    assert(!serialized.includes(ownerAccessKey), 'shadow receipt exposed the owner capability');
    return {
      artifactStatus: artifactReceipt.status,
      artifactCount: artifactReceipt.artifactCount,
      authoredBindingCount: artifactReceipt.authoredBindingCount,
      canonicalArtifactCount: artifactReceipt.canonicalArtifactCount,
      canonicalKindCounts: artifactReceipt.canonicalKindCounts,
      preservedIntentDigest: artifactReceipt.preservedIntentDigest,
      artifactReceiptDigest: artifactReceipt.receiptDigest,
      routeMode: routeReceipt.route.mode,
      routeModel: routeReceipt.route.model,
      routeReceiptDigest: routeReceipt.receiptDigest,
      userVisible: false,
      mutationApplied: false,
      autoApply: false,
    };
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
    const chartEntries = Object.keys(archive.files).filter((entry) =>
      /^ppt\/charts\/chart\d+\.xml$/.test(entry),
    );
    assert(chartEntries.length >= 1, 'PPTX contains no editable chart XML for the canonical chart');
    await page.getByText('Validated PowerPoint export prepared.', { exact: true }).waitFor({
      state: 'visible',
      timeout: ACTION_TIMEOUT_MS,
    });
    await page.waitForTimeout(750);
    assertNoRuntimeErrors(runtimeErrors);
    return { slideCount: slideEntries.length, editableChartCount: chartEntries.length };
  });

  await step('exact-main-final', async () => {
    const exactMainSource = await verifyNodeSlideExactMainSource(
      expectedMainSha,
      process.env.GITHUB_TOKEN,
    );
    report.exactMain = { ...report.exactMain, ...exactMainSource };
    return exactMainSource;
  });

  report.status = 'passed';
  report.stage = 'complete';
  console.log(
    '[prod-probe] PASS create -> edit -> reload -> ArtifactSpec/NodeGym shadow -> PPTX export; cleanup pending',
  );
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
  await retainNoOwnedFixture();
  ownerAccessKey = '';
  await context?.close().catch(() => undefined);
  await browser?.close().catch(() => undefined);
  report.completedAt = new Date().toISOString();
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`[prod-probe] sanitized report: ${path.relative(process.cwd(), reportPath)}`);
}

async function retainNoOwnedFixture() {
  const cleanupStartedAt = Date.now();
  report.stage = 'retention-cleanup';
  try {
    if (!probeClientSessionId && !creationSubmitted) {
      report.assertions.push({
        name: 'retention-cleanup',
        status: 'passed',
        durationMs: Date.now() - cleanupStartedAt,
        detail: { cleanupRequired: false, retentionSafe: true, creationSubmitted: false },
      });
      if (report.status === 'passed') report.stage = 'complete';
      return;
    }
    assert(probeClientSessionId.length > 0, 'production probe cleanup session is unavailable');
    const convex = new ConvexHttpClient(convexUrl.href);
    const receipt = await cleanupNodeSlideProductionProbe({
      client: convex,
      mutation: api.nodeslideRetention.deleteProductionProbeWorkspace,
      clientSessionId: probeClientSessionId,
      cleanupToken: probeCleanupToken,
    });
    assertProductionProbeCleanupDisposition(receipt, creationSubmitted);
    report.assertions.push({
      name: 'retention-cleanup',
      status: 'passed',
      durationMs: Date.now() - cleanupStartedAt,
      detail: {
        cleanupRequired: true,
        retentionSafe: receipt.retentionSafe,
        remainingDeckRows: receipt.remainingDeckRows,
        remainingSourceRows: receipt.remainingSourceRows,
        deletedRowCount: receipt.deletedRowCount,
        receiptDigest: receipt.receiptDigest,
        cleanupLeaseBoundBeforeSubmit: true,
        expiryBackstopConfigured: true,
      },
    });
    if (report.status === 'passed') report.stage = 'complete';
    console.log('[prod-probe] PASS retention-cleanup');
  } catch (error) {
    report.assertions.push({
      name: 'retention-cleanup',
      status: 'failed',
      durationMs: Date.now() - cleanupStartedAt,
      code: 'retention-cleanup',
    });
    report.status = 'failed';
    report.failure = {
      code: 'retention-cleanup',
      message: redact(error instanceof Error ? error.message : String(error)),
    };
    console.error(`[prod-probe] FAIL retention-cleanup: ${report.failure.message}`);
    process.exitCode = 1;
  }
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

function productionConvexUrl(value) {
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.hostname.endsWith('.convex.cloud')
  ) {
    throw new Error('PROD_PROBE_CONVEX_URL must be a clean HTTPS convex.cloud URL');
  }
  url.pathname = '/';
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
  return redactNodeGymDiagnostic(value, {
    tokens: [...diagnosticTokens],
    maxLength: 1_500,
  });
}
