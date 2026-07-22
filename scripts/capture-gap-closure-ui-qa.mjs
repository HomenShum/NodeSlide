#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { ConvexHttpClient } from 'convex/browser';
import { chromium } from 'playwright';
import { api } from '../convex/_generated/api.js';
import { redactNodeGymDiagnostic } from './lib/node-gym-redaction-core.mjs';
import {
  captureNodeSlideConvexBuildIdentity,
  captureWebDeploymentIdentity,
  requiredExactMainSha,
  requiredNodeSlideProductionOrigin,
  requiredNodeSlideWorkflowRun,
  sha256,
  verifyNodeSlideDeploymentRun,
  verifyNodeSlideExactMainSource,
} from './lib/production-deployment-identity.mjs';

const baseUrl = requiredNodeSlideProductionOrigin(
  process.env.NODESLIDE_GAP_QA_URL ?? 'https://nodeslide.vercel.app/',
  'NODESLIDE_GAP_QA_URL',
);
const expectedMainSha = requiredExactMainSha(
  process.env.NODESLIDE_GAP_QA_COMMIT,
  'NODESLIDE_GAP_QA_COMMIT',
);
const workflowRun = requiredNodeSlideWorkflowRun(
  process.env.NODESLIDE_GAP_QA_WORKFLOW_RUN_URL,
  'NODESLIDE_GAP_QA_WORKFLOW_RUN_URL',
);
const outputDir = path.resolve(
  process.env.NODESLIDE_GAP_QA_OUTPUT ?? 'artifacts/close-all-gaps-20260722/acceptance/ui-qa',
);
const viewports = [
  { id: 'desktop', width: 1512, height: 982 },
  { id: 'tablet', width: 834, height: 1112 },
  { id: 'mobile', width: 390, height: 844 },
];

await mkdir(outputDir, { recursive: true });
const convexClient = new ConvexHttpClient('https://agile-stoat-411.convex.cloud');
const [verifiedWorkflowRun, exactMainSourceBefore, deploymentIdentity, convexDeploymentIdentity] =
  await Promise.all([
    verifyNodeSlideDeploymentRun(workflowRun, expectedMainSha),
    verifyNodeSlideExactMainSource(expectedMainSha, process.env.GITHUB_TOKEN),
    captureWebDeploymentIdentity(baseUrl, expectedMainSha),
    captureNodeSlideConvexBuildIdentity(
      () => convexClient.query(api.nodeslideBuildIdentity.get, {}),
      expectedMainSha,
    ),
  ]);
const browser = await chromium.launch({ headless: true });
const captures = [];

try {
  for (const viewport of viewports) {
    for (const theme of ['light', 'dark']) {
      captures.push(await captureWorkspace(viewport, theme));
    }
  }
} finally {
  await browser.close();
}
const exactMainSourceAfter = await verifyNodeSlideExactMainSource(
  expectedMainSha,
  process.env.GITHUB_TOKEN,
);

const failed = captures.filter((capture) => capture.status !== 'passed');
const receipt = {
  schemaVersion: 'nodeslide.gap-closure-ui-qa/v1',
  productionOrigin: baseUrl.origin,
  capturedAt: new Date().toISOString(),
  status: failed.length === 0 ? 'passed' : 'failed',
  mode: 'public-sample-read-only',
  exactMain: {
    commitSha: expectedMainSha,
    workflowRunId: verifiedWorkflowRun.id,
    workflowRunUrl: verifiedWorkflowRun.url,
    workflow: verifiedWorkflowRun.workflow,
    sourceBefore: exactMainSourceBefore,
    sourceAfter: exactMainSourceAfter,
  },
  deploymentIdentity,
  convexDeploymentIdentity,
  retention: {
    required: false,
    reason: 'The QA journey opens the public sample workspace and creates no persisted deck.',
  },
  checks: [
    'app-controlled light and dark themes',
    'desktop, tablet, and mobile viewports',
    'UTF-8 without mojibake',
    'zero horizontal overflow',
    'zero browser console/page errors',
    'mobile theme, share, present, export, and inspector reachability',
    'visible keyboard focus',
  ],
  captures,
};
await writeJson(path.join(outputDir, 'receipt.json'), receipt);
console.log(
  `[gap-ui-qa] ${receipt.status.toUpperCase()} ${captures.length - failed.length}/${captures.length} viewport/theme captures`,
);
console.log(
  `[gap-ui-qa] receipt: ${path.relative(process.cwd(), path.join(outputDir, 'receipt.json'))}`,
);
if (failed.length > 0) {
  for (const capture of failed) {
    console.error(`[gap-ui-qa] FAIL ${capture.id}: ${capture.failures.join('; ')}`);
  }
  process.exitCode = 1;
}

async function captureWorkspace(viewport, theme) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${redact(error.message, 200)}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console.error: ${redact(message.text(), 200)}`);
  });
  const id = `workspace-${viewport.id}-${theme}`;
  const screenshotPath = path.join(outputDir, `${id}.png`);
  const failures = [];

  try {
    const response = await page.goto(baseUrl.href, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    });
    if (response?.status() !== 200) failures.push(`HTTP ${response?.status() ?? 'none'}`);
    await page.getByTestId('nodeslide-landing').waitFor({ timeout: 45_000 });
    await page.getByText('Explore the editable sample workspace', { exact: true }).click();
    await page.getByTestId('nodeslide-studio').waitFor({ timeout: 60_000 });
    await page.getByTestId('slide-canvas').waitFor({ timeout: 45_000 });
    await page.waitForTimeout(500);

    if (theme === 'dark') {
      const toggle = page.getByLabel('Switch to dark theme', { exact: true });
      if (!(await toggle.isVisible())) failures.push('desktop dark-theme toggle is not visible');
      else await toggle.click();
      await page.getByTestId('nodeslide-studio').waitFor({ state: 'visible' });
      if (viewport.id !== 'desktop') {
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.waitForTimeout(350);
      }
    }

    const inspection = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const studio = document.querySelector('[data-testid="nodeslide-studio"]');
      const visible = (label) => {
        const node = document.querySelector(`[aria-label="${label}"]`);
        return Boolean(
          node &&
            (node.getClientRects().length > 0 ||
              /** @type {HTMLElement} */ (node).offsetWidth ||
              /** @type {HTMLElement} */ (node).offsetHeight),
        );
      };
      return {
        charset: document.characterSet,
        mojibakeCount: (bodyText.match(/Ã‚Â·|Ã¢|Ãƒ[-Â¿]/g) ?? []).length,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        theme: studio?.getAttribute('data-ns-theme') ?? 'missing',
        viewport: { width: window.innerWidth, height: window.innerHeight },
        visibleControls: {
          themeDark: visible('Switch to dark theme'),
          themeLight: visible('Switch to light theme'),
          share: visible('Share deck'),
          present: visible('Present deck'),
          export: visible('Export deck'),
          inspector:
            visible('Open inspector') ||
            Boolean(
              document.querySelector('.ns-inspector:not(.is-collapsed)')?.getClientRects().length,
            ),
        },
      };
    });

    if (inspection.charset !== 'UTF-8') failures.push(`charset=${inspection.charset}`);
    if (inspection.mojibakeCount > 0) failures.push(`mojibake=${inspection.mojibakeCount}`);
    if (inspection.horizontalOverflow) failures.push('horizontal overflow');
    if (inspection.theme !== theme) failures.push(`theme=${inspection.theme}`);
    if (
      inspection.viewport.width !== viewport.width ||
      inspection.viewport.height !== viewport.height
    ) {
      failures.push(
        `viewport=${inspection.viewport.width}x${inspection.viewport.height}, expected=${viewport.width}x${viewport.height}`,
      );
    }
    if (errors.length > 0) failures.push(`${errors.length} browser error(s)`);
    if (!inspection.visibleControls.share) failures.push('share control unreachable');
    if (!inspection.visibleControls.present) failures.push('present control unreachable');
    if (!inspection.visibleControls.export) failures.push('export control unreachable');
    if (!inspection.visibleControls.inspector) failures.push('inspector control unreachable');
    const expectedThemeControl = theme === 'dark' ? 'themeLight' : 'themeDark';
    if (!inspection.visibleControls[expectedThemeControl]) {
      failures.push('theme control unreachable');
    }

    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const element = document.activeElement;
      if (!(element instanceof HTMLElement)) return null;
      const style = getComputedStyle(element);
      return {
        tag: element.tagName.toLowerCase(),
        label: element.getAttribute('aria-label') ?? element.innerText.trim().slice(0, 80),
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
      };
    });
    if (!focus || focus.tag === 'body' || /none 0px/u.test(focus.outline)) {
      failures.push('visible keyboard focus not observed');
    }

    await page.screenshot({ path: screenshotPath, fullPage: false });
    const screenshot = await fileEvidence(screenshotPath);
    return {
      id,
      status: failures.length === 0 ? 'passed' : 'failed',
      screenshot,
      inspection,
      focus,
      browserErrors: errors.slice(0, 10).map((error) => redact(error, 200)),
      failures: failures.map((failure) => redact(failure, 500)),
    };
  } catch (error) {
    failures.push(redact(error instanceof Error ? error.message : error, 500));
    await page.screenshot({ path: screenshotPath, fullPage: false }).catch(() => undefined);
    return {
      id,
      status: 'failed',
      screenshot: await fileEvidence(screenshotPath).catch(() => null),
      browserErrors: errors.slice(0, 10).map((entry) => redact(entry, 200)),
      failures: failures.map((failure) => redact(failure, 500)),
    };
  } finally {
    await context.close();
  }
}

async function fileEvidence(filePath) {
  const bytes = await readFile(filePath);
  return {
    path: path.relative(process.cwd(), filePath).replaceAll('\\', '/'),
    bytes: bytes.length,
    digest: sha256(bytes),
  };
}

function redact(value, maxLength) {
  return redactNodeGymDiagnostic(value, { maxLength });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}
