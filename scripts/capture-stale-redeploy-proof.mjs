#!/usr/bin/env node
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

const productionUrl = process.env.NODESLIDE_STALE_PROOF_URL ?? 'https://nodeslide.vercel.app/';
const signalPath = process.env.NODESLIDE_STALE_PROOF_SIGNAL;
const outputDirectory = path.resolve(
  process.env.NODESLIDE_STALE_PROOF_OUTPUT ?? 'artifacts/camera-proof-20260720/stale-redeploy',
);
const signalTimeoutMs = boundedInteger(
  process.env.NODESLIDE_STALE_PROOF_SIGNAL_TIMEOUT_MS,
  1_800_000,
);
const deploymentRun = process.env.NODESLIDE_STALE_PROOF_DEPLOY_RUN ?? null;
const deployedSha = process.env.NODESLIDE_STALE_PROOF_DEPLOY_SHA ?? null;
const convexActivatedAt = process.env.NODESLIDE_STALE_PROOF_CONVEX_ACTIVATED_AT ?? null;

if (!signalPath) fail('NODESLIDE_STALE_PROOF_SIGNAL is required');
await mkdir(outputDirectory, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(`console.error: ${message.text()}`);
});

let report;
let submittedAt = null;
try {
  const response = await page.goto(productionUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 45_000,
  });
  if (response?.status() !== 200) throw new Error(`production returned HTTP ${response?.status()}`);

  const explore = page.getByTestId('first-run-explore');
  const exploreCount = await explore.count();
  if (exploreCount === 1) await explore.click();
  else if (exploreCount !== 0)
    throw new Error(`expected at most one Explore sample control, got ${exploreCount}`);

  if (exploreCount === 0) {
    const landingSample = page.getByRole('button', {
      name: 'Explore the editable sample workspace',
      exact: true,
    });
    const landingSampleCount = await landingSample.count();
    if (landingSampleCount !== 1) {
      throw new Error(`expected one landing sample control, got ${landingSampleCount}`);
    }
    await landingSample.click();
  }

  await page.getByTestId('nodeslide-studio').waitFor({ state: 'visible', timeout: 45_000 });
  await page.getByTestId('ai-composer').waitFor({ state: 'visible', timeout: 30_000 });
  const instruction = page.getByLabel('AI instruction', { exact: true });
  const submit = page.getByTestId('ai-submit');
  if ((await instruction.count()) !== 1)
    throw new Error('AI instruction is not uniquely reachable');
  if ((await submit.count()) !== 1) throw new Error('AI submit is not uniquely reachable');

  await writeFile(
    path.join(outputDirectory, 'ready.json'),
    `${JSON.stringify({ readyAt: new Date().toISOString(), productionUrl, runnerPid: process.pid }, null, 2)}\n`,
  );
  await waitForSignal(signalPath, signalTimeoutMs);

  submittedAt = new Date().toISOString();
  await instruction.fill('Rewrite the headline and the body copy to be more direct.');
  await submit.click();

  const banner = page.getByTestId('deployment-update-banner');
  const proposal = page.getByTestId('proposal-card').first();
  const outcome = await Promise.race([
    banner.waitFor({ state: 'visible', timeout: 180_000 }).then(() => 'reload-banner'),
    proposal.waitFor({ state: 'visible', timeout: 180_000 }).then(() => 'proposal-ready'),
  ]);
  const threadErrors = await page.getByTestId('agent-thread-error').allTextContents();
  if (outcome === 'proposal-ready') {
    const screenshotPath = path.join(outputDirectory, 'stale-socket-not-reproduced.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });
    report = {
      schemaVersion: 'nodeslide.stale-redeploy-proof/v1',
      status: 'not_reproduced',
      productionUrl,
      submittedAt,
      observedAt: new Date().toISOString(),
      deploymentRun,
      deployedSha,
      convexActivatedAt,
      observation:
        'The pre-deploy client remained operational after Convex activation and produced a reviewable, unapplied proposal; the stale-action rejection was not reproduced.',
      threadErrors: threadErrors.map((value) => value.replace(/\s+/gu, ' ').trim()).slice(0, 3),
      consoleErrorCount: consoleErrors.length,
      consoleErrors: consoleErrors.slice(0, 5),
      screenshot: path.basename(screenshotPath),
    };
  } else {
    const bannerText = (await banner.innerText()).replace(/\s+/gu, ' ').trim();
    const screenshotPath = path.join(outputDirectory, 'stale-socket-reload-banner.png');
    await page.screenshot({ path: screenshotPath, fullPage: true });

    const passed =
      bannerText.includes('NodeSlide may have been updated.') &&
      bannerText.includes('Reload before retrying; no successful change is being claimed.') &&
      bannerText.includes('Reload NodeSlide');
    report = {
      schemaVersion: 'nodeslide.stale-redeploy-proof/v1',
      status: passed ? 'passed' : 'failed',
      productionUrl,
      submittedAt,
      observedAt: new Date().toISOString(),
      deploymentRun,
      deployedSha,
      convexActivatedAt,
      bannerText,
      threadErrors: threadErrors.map((value) => value.replace(/\s+/gu, ' ').trim()).slice(0, 3),
      consoleErrorCount: consoleErrors.length,
      consoleErrors: consoleErrors.slice(0, 5),
      screenshot: path.basename(screenshotPath),
    };
    if (!passed) throw new Error('deployment reload banner did not contain its fail-closed copy');
  }
} catch (error) {
  const screenshotPath = path.join(outputDirectory, 'stale-socket-proof-failed.png');
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);
  report ??= {
    schemaVersion: 'nodeslide.stale-redeploy-proof/v1',
    status: 'failed',
    productionUrl,
    submittedAt,
    observedAt: new Date().toISOString(),
    deploymentRun,
    deployedSha,
    convexActivatedAt,
    failure: error instanceof Error ? error.message : String(error),
    consoleErrorCount: consoleErrors.length,
    consoleErrors: consoleErrors.slice(0, 5),
    screenshot: path.basename(screenshotPath),
  };
} finally {
  await writeFile(
    path.join(outputDirectory, 'receipt.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  await context.close();
  await browser.close();
}

if (report.status === 'failed') process.exit(1);
if (report.status === 'not_reproduced') {
  console.error(
    `[stale-redeploy-proof] NOT_REPRODUCED ${path.join(outputDirectory, report.screenshot)}`,
  );
  process.exit(2);
}
console.log(`[stale-redeploy-proof] PASS ${path.join(outputDirectory, report.screenshot)}`);

async function waitForSignal(file, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(file);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`redeploy signal was not observed within ${timeoutMs}ms`);
}

function boundedInteger(value, fallback) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 10_000 || parsed > 3_600_000) {
    fail('NODESLIDE_STALE_PROOF_SIGNAL_TIMEOUT_MS must be 10000..3600000');
  }
  return parsed;
}

function fail(message) {
  console.error(`[stale-redeploy-proof] FAIL ${message}`);
  process.exit(1);
}
