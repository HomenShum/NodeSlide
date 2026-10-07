/**
 * Baseline capture for the PROMOTION gate.
 *
 * Drives the journeys in PRODUCT_JOURNEYS.md against a locally running NodeSlide
 * (vite on :5180 + `npx convex dev` anonymous local backend on :3210) and writes
 * screenshots plus one machine-readable report to promotion/evidence/baseline/.
 *
 * It records what happened; it does not assert. A baseline that fails a journey
 * is the finding, not an error.
 *
 *   node promotion/capture-baseline.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.NODESLIDE_BASE_URL ?? 'http://localhost:5180';
const OUT = path.resolve('promotion/evidence/baseline');
const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  steps: [],
  console: [],
  network: [],
};

const note = (step, detail) => {
  report.steps.push({ step, at: new Date().toISOString(), ...detail });
  console.log(`[${step}] ${JSON.stringify(detail)}`);
};

const overflow = (page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflows: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  return `promotion/evidence/baseline/${name}.png`;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning')
      report.console.push({ type: m.type(), text: m.text().slice(0, 400) });
  });
  page.on('requestfailed', (r) =>
    report.network.push({ url: r.url().slice(0, 200), failure: r.failure()?.errorText }),
  );
  page.on('response', (r) => {
    if (r.status() >= 400) report.network.push({ url: r.url().slice(0, 200), status: r.status() });
  });

  // ---- J1 landing, desktop -------------------------------------------------
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="nodeslide-landing"]', { timeout: 60_000 });
  note('landing-desktop', {
    ...(await overflow(page)),
    shot: await shoot(page, 'j1-landing-desktop'),
  });

  // Keyboard: first six tab stops, and whether each shows a focus ring.
  const stops = [];
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName,
          label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
          outline: cs.outlineStyle === 'none' ? cs.boxShadow.slice(0, 40) : cs.outlineStyle,
          hiddenPanel: !!el.closest('[data-testid="artifact-gallery"]'),
        };
      }),
    );
  }
  note('keyboard-tab-order', { stops, shot: await shoot(page, 'j1-landing-keyboard') });

  // ---- J1 landing, mobile --------------------------------------------------
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(BASE, { waitUntil: 'domcontentloaded' });
  await mobile.waitForSelector('[data-testid="nodeslide-landing"]', { timeout: 60_000 });
  note('landing-mobile-390', {
    ...(await overflow(mobile)),
    shot: await shoot(mobile, 'j1-landing-mobile-390'),
  });
  await mobile.close();

  // ---- J1 create a deck on the deterministic route -------------------------
  await page.fill(
    '#nodeslide-landing-prompt',
    'Four slides on why a seed-stage diligence memo should stay editable: the problem, one chart of review cycles, the mechanism, and what we ask for.',
  );
  await page.selectOption('[data-testid="landing-model-select"]', 'deterministic');
  const cue = await page.textContent('[data-testid="landing-privacy-cue"]');
  await page.click('button[aria-label="Create presentation"]');

  let creating = null;
  try {
    await page.waitForSelector('[data-testid="landing-create-status"]', { timeout: 10_000 });
    creating = await page.textContent('[data-testid="landing-create-stage"]');
    await shoot(page, 'j1-creating');
  } catch {
    creating = null;
  }

  let outcome = 'unknown';
  const started = Date.now();
  try {
    await page.waitForSelector('[data-testid="nodeslide-studio"]', { timeout: 240_000 });
    outcome = 'studio';
  } catch {
    const err = await page
      .locator('.ns-landing-create-error')
      .first()
      .textContent()
      .catch(() => null);
    outcome = err ? `error: ${err.trim().slice(0, 200)}` : 'timeout without studio or error';
  }
  note('j1-create-deck', {
    privacyCue: cue?.trim(),
    creatingStage: creating?.trim(),
    outcome,
    elapsedMs: Date.now() - started,
    ...(await overflow(page)),
    shot: await shoot(page, 'j1-after-create'),
  });

  // ---- J3 export, only if a deck exists ------------------------------------
  if (outcome === 'studio') {
    const exportBtn = page.locator('[data-testid="export-pptx"]').first();
    const exportVisible = await exportBtn.isVisible().catch(() => false);
    note('j3-export-control', { exportVisible, shot: await shoot(page, 'j3-editor') });
  }

  // ---- J4 Artifact Atlas ---------------------------------------------------
  const atlas = await context.newPage();
  await atlas.goto(`${BASE}/?domain=atlas`, { waitUntil: 'domcontentloaded' });
  const atlasOk = await atlas
    .waitForSelector('[data-testid="atlas-gallery"]', { timeout: 60_000 })
    .then(() => true)
    .catch(() => false);
  note('j4-atlas', { atlasOk, ...(await overflow(atlas)), shot: await shoot(atlas, 'j4-atlas') });
  await atlas.close();

  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  console.log(
    `\nconsole errors/warnings: ${report.console.length}, failed requests: ${report.network.length}`,
  );
}

main().catch(async (error) => {
  report.fatal = String(error).slice(0, 500);
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
