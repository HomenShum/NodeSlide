#!/usr/bin/env node
/**
 * CI runtime smoke gate.
 *
 * Why this exists: a green `vite build` once shipped a blank page (a manualChunks
 * split broke React initialization — the failure only appears when the built
 * bundle actually runs in a browser). Static gates (tsc, vitest, build) cannot
 * catch that class. This script serves the already-built dist/ via
 * `vite preview`, loads it in headless Chromium, and fails on any runtime error.
 *
 * Success signal: with a real Convex URL the landing renders `.ns-landing-sample`;
 * with a CI placeholder Convex URL the app may instead render the deployment
 * guard screen (`[data-testid="deployment-configuration-error"]`, see
 * src/main.tsx). EITHER selector proves React mounted, executed the bundle, and
 * committed a render — which is exactly the blank-page class this gate exists to
 * catch. So we accept either, and separately require zero page errors.
 *
 * Assumes: `npm run build` (or `vite build`) has already produced dist/.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';

// Default 4319 (CI); overridable locally because dev machines may already have
// an unrelated service bound there (vite --strictPort would then fail honestly).
const PORT = Number(process.env.SMOKE_PORT ?? 4319);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const SELECTOR = '.ns-landing-sample, [data-testid="deployment-configuration-error"]';
const SELECTOR_TIMEOUT_MS = 20_000;
const SERVER_READY_TIMEOUT_MS = 30_000;

if (!existsSync(path.join(process.cwd(), 'dist', 'index.html'))) {
  console.error(`smoke: dist/index.html not found in ${process.cwd()} — run the build first.`);
  process.exit(1);
}

let preview = null;
let exitCode = 1;

function killPreview() {
  if (!preview || preview.killed || preview.exitCode !== null) return;
  if (process.platform === 'win32') {
    // Kill the whole tree in case vite spawned helpers.
    spawn('taskkill', ['/pid', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    preview.kill('SIGTERM');
  }
}

async function waitForHttp200(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status === 200) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`preview server never returned 200 at ${url} (last: ${lastError})`);
}

async function main() {
  // Spawn vite's bin directly with the current node: no npx/shell wrapper, so
  // the child pid is vite itself and killPreview reliably terminates it.
  const viteBin = path.join(process.cwd(), 'node_modules', 'vite', 'bin', 'vite.js');
  preview = spawn(
    process.execPath,
    [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  preview.stdout.on('data', () => {});
  preview.stderr.on('data', (chunk) => {
    process.stderr.write(`[preview] ${chunk}`);
  });
  const previewExited = new Promise((_, reject) => {
    preview.on('exit', (code) => reject(new Error(`vite preview exited early with code ${code}`)));
  });
  // If vite dies after the race is decided, don't crash on an unhandled rejection.
  previewExited.catch(() => {});

  await Promise.race([waitForHttp200(BASE_URL, SERVER_READY_TIMEOUT_MS), previewExited]);
  // Guard against a foreign server already bound to the port: with --strictPort
  // vite exits, but the fetch above may have gotten a 200 from the *other* app
  // (observed locally — this smoke then tests a stranger's page). Verify the
  // server is actually serving OUR dist by matching its hashed entry script.
  const distHtml = readFileSync(path.join(process.cwd(), 'dist', 'index.html'), 'utf8');
  const entryMatch = distHtml.match(/\/assets\/index-[\w-]+\.js/);
  if (!entryMatch) {
    throw new Error('could not find a hashed /assets/index-*.js reference in dist/index.html');
  }
  const servedHtml = await (await fetch(BASE_URL)).text();
  if (!servedHtml.includes(entryMatch[0])) {
    throw new Error(
      `server on ${BASE_URL} is not serving this dist/ (expected entry ${entryMatch[0]} in its HTML). The port is likely held by another process — set SMOKE_PORT to a free port.`,
    );
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    /** @type {string[]} */
    const pageErrors = [];
    page.on('pageerror', (error) => {
      pageErrors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() === 'error') pageErrors.push(`console.error: ${msg.text()}`);
    });

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });

    let selectorFound = true;
    try {
      await page.waitForSelector(SELECTOR, { timeout: SELECTOR_TIMEOUT_MS });
    } catch {
      selectorFound = false;
    }
    // Let any late async errors (chunk loads, hydration) surface.
    await page.waitForTimeout(500);

    const failures = [];
    if (!selectorFound) {
      failures.push(
        `neither ".ns-landing-sample" nor "[data-testid=deployment-configuration-error]" appeared within ${SELECTOR_TIMEOUT_MS}ms — React did not mount (blank page).`,
      );
    }
    if (pageErrors.length > 0) {
      failures.push(
        `page reported ${pageErrors.length} runtime error(s):`,
        ...pageErrors.map((e) => `  - ${e}`),
      );
    }

    if (failures.length > 0) {
      console.error('smoke: FAIL');
      for (const line of failures) console.error(line);
      exitCode = 1;
    } else {
      console.log('smoke: PASS — bundle ran, React mounted, zero page errors.');
      exitCode = 0;
    }
  } finally {
    await browser.close();
  }
}

main()
  .catch((error) => {
    console.error(`smoke: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    exitCode = 1;
  })
  .finally(() => {
    killPreview();
    process.exit(exitCode);
  });
