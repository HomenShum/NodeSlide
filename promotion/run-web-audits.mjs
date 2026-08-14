/**
 * Web-quality audit + Web Interface Guidelines measurement pass.
 *
 * Two different things live here on purpose, because the gate scores them as
 * two different conditions and they measure different properties:
 *
 *   - Condition 8 (web-quality audit) is decided by TOOLS: Lighthouse for
 *     performance / accessibility / best-practices / Core Web Vitals, and
 *     @axe-core/cli for accessibility violations. Phases C and D.
 *   - Condition 7 (Web Interface Guidelines) is decided by a HUMAN REVIEW.
 *     This script cannot perform that review. What it does is take the DOM
 *     measurements the review needs so that each finding cites a number rather
 *     than an impression — hit-target sizes, focus rings, input font sizes,
 *     head metadata, `transition: all`, reduced-motion coverage. Phase B.
 *     The review itself is promotion/WIG_REVIEW.md and cites this JSON.
 *
 * A Lighthouse score is NOT a WIG review. If Phase C passes and Phase B was
 * never read by a person, condition 7 stays UNVERIFIED.
 *
 * It records; it does not assert. A run that finds a defect is the finding.
 *
 *   npx convex dev                       # backend (anonymous local is fine)
 *   npx vite --port 4906 --strictPort --host 127.0.0.1
 *   node promotion/run-web-audits.mjs
 *
 * Env: NODESLIDE_BASE_URL (default http://127.0.0.1:4906)
 *      NODESLIDE_SKIP_TOOLS=1 to run phases A/B only.
 */
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.NODESLIDE_BASE_URL ?? 'http://127.0.0.1:4906';
const OUT_REL = process.env.NODESLIDE_AUDIT_OUT ?? 'promotion/evidence/audit';
const OUT = path.resolve(process.env.NODESLIDE_AUDIT_OUT ?? OUT_REL);
const WIDTHS = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

const report = {
  base: BASE,
  startedAt: new Date().toISOString(),
  commands: [],
  widths: [],
  wig: {},
  states: {},
  interaction: {},
  console: [],
  network: [],
};

const run = (label, cmd) => {
  console.log(`\n$ ${cmd}`);
  const started = Date.now();
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', timeout: 600_000 });
  const entry = { label, command: cmd, exit: r.status, ms: Date.now() - started };
  report.commands.push(entry);
  console.log(`[${label}] exit=${r.status} (${entry.ms} ms)`);
  return entry;
};

const overflow = (page) =>
  page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
    overflows: document.documentElement.scrollWidth > window.innerWidth + 1,
  }));

/** Everything the WIG review needs to cite a number instead of an impression. */
const wigProbe = (page) =>
  page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
    };
    // Accessible name, in the order the AccName spec resolves it. A probe that
    // stops at aria-label reports every `<label for>`-associated control as
    // unnamed, which is a false finding — this repo's brief textarea is named
    // by a visually-hidden <label for>, and axe agrees it is named.
    const name = (el) => {
      const byId = el.getAttribute('aria-labelledby');
      const labelFor = el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null;
      return (
        (el.getAttribute('aria-label') ?? '').trim() ||
        (byId ? (document.getElementById(byId)?.textContent ?? '').trim() : '') ||
        (labelFor?.textContent ?? '').trim() ||
        (el.closest('label')?.textContent ?? '').trim() ||
        (el.textContent ?? '').trim() ||
        (el.getAttribute('title') ?? '').trim()
      );
    };

    const controls = [
      ...document.querySelectorAll('button,a[href],input,select,textarea,[tabindex]'),
    ]
      .filter(visible)
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          tag: el.tagName.toLowerCase(),
          testid: el.getAttribute('data-testid') ?? null,
          name: name(el).slice(0, 60),
          w: Math.round(r.width * 10) / 10,
          h: Math.round(r.height * 10) / 10,
          fontSize: Number.parseFloat(cs.fontSize),
          touchAction: cs.touchAction,
          type: el.getAttribute('type'),
          autocomplete: el.getAttribute('autocomplete'),
          // "Windows <select> background": an unset background-color renders
          // the OS grey popup and can put grey text on grey.
          background: el.tagName === 'SELECT' ? cs.backgroundColor : undefined,
          placeholder: el.getAttribute('placeholder'),
        };
      });

    // Every stylesheet rule the page actually applies, scanned once.
    let transitionAll = 0;
    let reducedMotionBlocks = 0;
    let rulesSeen = 0;
    const walk = (rules) => {
      for (const rule of rules) {
        rulesSeen += 1;
        if (rule.media?.mediaText?.includes('prefers-reduced-motion')) reducedMotionBlocks += 1;
        if (rule.cssRules) walk(rule.cssRules);
        const t = rule.style?.transitionProperty ?? rule.style?.getPropertyValue?.('transition');
        if (typeof t === 'string' && /\ball\b/.test(t)) transitionAll += 1;
      }
    };
    for (const sheet of document.styleSheets) {
      try {
        walk(sheet.cssRules);
      } catch {
        /* cross-origin sheet */
      }
    }

    const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => ({
      level: Number(h.tagName[1]),
      text: (h.textContent ?? '').trim().slice(0, 60),
    }));

    const meta = (n) =>
      document.querySelector(`meta[name="${n}"]`)?.getAttribute('content') ?? null;

    return {
      title: document.title,
      lang: document.documentElement.lang,
      meta: {
        viewport: meta('viewport'),
        colorScheme: meta('color-scheme'),
        themeColor: meta('theme-color'),
        description: meta('description')?.slice(0, 80) ?? null,
      },
      htmlColorScheme: getComputedStyle(document.documentElement).colorScheme,
      preconnect: [...document.querySelectorAll('link[rel="preconnect"],link[rel="preload"]')].map(
        (l) => `${l.getAttribute('rel')}:${l.getAttribute('as') ?? ''}`,
      ),
      skipLink: [...document.querySelectorAll('a[href^="#"]')]
        .map((a) => (a.textContent ?? '').trim())
        .filter((t) => /skip/i.test(t)),
      headings,
      controls,
      controlsUnder24: controls.filter((c) => c.w < 24 || c.h < 24),
      controlsUnder44: controls.filter((c) => c.w < 44 || c.h < 44),
      unnamedControls: controls.filter((c) => !c.name),
      textInputsUnder16px: controls.filter(
        (c) => (c.tag === 'input' || c.tag === 'textarea' || c.tag === 'select') && c.fontSize < 16,
      ),
      css: { rulesSeen, transitionAll, reducedMotionBlocks },
      straightEllipsis: document.body.innerText.split('...').length - 1,
      typographicEllipsis: document.body.innerText.split('…').length - 1,
      scrollers: [...document.querySelectorAll('*')]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
        .slice(0, 10)
        .map((el) => `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 80)),
    };
  });

/**
 * Focus visibility, measured the way a keyboard user experiences it.
 *
 * Reading only the focused element's own computed style is not enough and
 * produces false findings in both directions: WIG explicitly allows a grouped
 * control to show its focus on the GROUP (`:focus-within`), so `outline: none`
 * on a textarea inside a composer that rings itself is fine — and conversely,
 * a group ring that lights up identically for five different children tells the
 * user something is focused but not WHICH thing.
 *
 * So: snapshot every element's style with nothing focused, then tab through and
 * report, for each stop, exactly which node in its ancestor chain changed and
 * how. `indicatorOn: 'self'` is an element ring; `indicatorOn: '<ancestor>'` is
 * a group ring; `null` is invisible focus.
 */
const focusWalk = (page, n) =>
  (async () => {
    await page.evaluate(() => {
      document.activeElement instanceof HTMLElement && document.activeElement.blur();
      const tuple = (el) => {
        const cs = getComputedStyle(el);
        return [cs.outlineStyle, cs.outlineWidth, cs.boxShadow, cs.borderColor, cs.backgroundColor]
          .join('|')
          .slice(0, 240);
      };
      window.__wigBase = [];
      let i = 0;
      for (const el of document.querySelectorAll('*')) {
        el.setAttribute('data-wig-idx', String(i));
        window.__wigBase[i] = tuple(el);
        i += 1;
      }
    });

    const stops = [];
    for (let i = 0; i < n; i += 1) {
      await page.keyboard.press('Tab');
      stops.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          if (!el || el === document.body) return { tag: 'BODY', indicatorOn: 'n/a' };
          const tuple = (node) => {
            const cs = getComputedStyle(node);
            return [
              cs.outlineStyle,
              cs.outlineWidth,
              cs.boxShadow,
              cs.borderColor,
              cs.backgroundColor,
            ]
              .join('|')
              .slice(0, 240);
          };
          const desc = (node) =>
            `${node.tagName.toLowerCase()}${node.className && typeof node.className === 'string' ? `.${node.className.split(' ')[0]}` : ''}`;

          let indicatorOn = null;
          let change = null;
          let depth = 0;
          for (let node = el; node && depth < 5; node = node.parentElement, depth += 1) {
            const idx = Number(node.getAttribute('data-wig-idx'));
            const before = window.__wigBase[idx];
            const after = tuple(node);
            if (before !== undefined && before !== after) {
              indicatorOn = depth === 0 ? 'self' : desc(node);
              change = { depth, before: before.slice(0, 110), after: after.slice(0, 110) };
              break;
            }
          }
          return {
            tag: el.tagName,
            testid: el.getAttribute('data-testid'),
            label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 40),
            indicatorOn,
            change,
          };
        }),
      );
    }
    await page.evaluate(() => {
      for (const el of document.querySelectorAll('[data-wig-idx]'))
        el.removeAttribute('data-wig-idx');
    });
    return stops;
  })();

async function main() {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  // Every page, not just the main one: condition 9 asks about the journey, and
  // half the journey happens on the width pages and the error page.
  context.on('page', (p) => {
    p.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({
          page: p.url().slice(-40),
          type: m.type(),
          text: m.text().slice(0, 300),
        });
    });
    p.on('requestfailed', (r) =>
      report.network.push({ url: r.url().slice(0, 160), failure: r.failure()?.errorText }),
    );
    p.on('response', (r) => {
      if (r.status() >= 400)
        report.network.push({ url: r.url().slice(0, 160), status: r.status() });
    });
  });
  const page = await context.newPage();

  // ---- Phase A: responsive coverage, one page per supported width ----------
  for (const w of WIDTHS) {
    const p = await context.newPage();
    await p.setViewportSize({ width: w.width, height: w.height });
    await p.goto(BASE, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('[data-testid="nodeslide-landing"]', { timeout: 60_000 });
    await p.waitForTimeout(600);
    const shot = path.join(OUT, `landing-${w.name}.png`);
    await p.screenshot({ path: shot });
    const entry = { ...w, ...(await overflow(p)), shot: path.basename(shot) };
    if (w.width === 390) report.wig.mobile = await wigProbe(p);
    report.widths.push(entry);
    console.log(`[width ${w.name}] ${JSON.stringify(entry)}`);
    await p.close();
  }

  // ---- Phase B: WIG measurements at desktop -------------------------------
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="nodeslide-landing"]', { timeout: 60_000 });
  await page.waitForTimeout(800);
  report.wig.desktop = await wigProbe(page);
  report.wig.tabStops = await focusWalk(page, 14);

  // A crop of the composer at each of its four stops. The JSON says the ring
  // moved (or did not); the crops are what a reviewer can actually look at.
  for (const [i, stop] of [
    [5, 'textarea'],
    [8, 'model-select'],
    [9, 'effort-select'],
  ]) {
    await page.evaluate(() => document.activeElement?.blur?.());
    for (let k = 0; k < i; k += 1) await page.keyboard.press('Tab');
    await page.locator('.ns-landing-composer').screenshot({
      path: path.join(OUT, `focus-composer-${stop}.png`),
    });
  }
  await page.screenshot({ path: path.join(OUT, 'wig-landing-focus.png') });

  // ---- Phase B2: designed states (empty -> loading -> success/error) -------
  report.states.empty = {
    shot: 'landing-desktop-1440.png',
    starters: await page.locator('.ns-landing-starters button').count(),
    privacyCue: (await page.textContent('[data-testid="landing-privacy-cue"]'))?.trim(),
  };

  // Error state, on its own page so the success path below starts clean.
  // Attaching a file type the composer cannot read is the error a stranger can
  // actually reach with no key and no network, so it is reproducible evidence
  // rather than a screenshot of an outage.
  {
    const err = await context.newPage();
    await err.goto(BASE, { waitUntil: 'domcontentloaded' });
    await err.waitForSelector('[data-testid="nodeslide-landing"]', { timeout: 60_000 });
    await err.fill('#nodeslide-landing-prompt', 'Three slides on our Q3 pilot results.');
    await err.setInputFiles('[data-testid="landing-file-input"]', {
      name: 'pilot-metrics.png',
      mimeType: 'image/png',
      buffer: Buffer.from('89504e470d0a1a0a', 'hex'),
    });
    const box = err.locator('.ns-landing-create-error, [role="alert"]').first();
    const shown = await box
      .waitFor({ timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    report.states.error = {
      trigger: 'attach pilot-metrics.png (unsupported type)',
      shown,
      text: shown ? (await box.textContent())?.trim().slice(0, 240) : null,
      role: shown ? await box.getAttribute('role') : null,
      // Recovery: is the typed brief still there after the failure?
      briefPreserved: await err
        .inputValue('#nodeslide-landing-prompt')
        .then((v) => v.length > 0)
        .catch(() => null),
      shot: 'state-error.png',
    };
    await err.screenshot({ path: path.join(OUT, 'state-error.png') });
    await err.close();
  }

  await page.fill(
    '#nodeslide-landing-prompt',
    'Four slides on why a seed-stage diligence memo should stay editable: the problem, one chart of review cycles, the mechanism, and what we ask for.',
  );
  // Keystroke cost — WIG "Performance / keystroke cost", gate condition 10.
  const keystroke = await page.evaluate(async () => {
    const el = document.querySelector('#nodeslide-landing-prompt');
    el.focus();
    const samples = [];
    for (let i = 0; i < 20; i += 1) {
      const t0 = performance.now();
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      el.value += 'a';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    return { p50: samples[10], p95: samples[18], max: samples[19] };
  });
  report.interaction.keystrokeMs = keystroke;

  await page.selectOption('[data-testid="landing-model-select"]', 'deterministic');
  const clickedAt = Date.now();
  await page.click('button[aria-label="Create presentation"]');

  try {
    await page.waitForSelector('[data-testid="landing-create-status"]', { timeout: 15_000 });
    report.states.loading = {
      firstFeedbackMs: Date.now() - clickedAt,
      stage: (await page.textContent('[data-testid="landing-create-stage"]'))?.trim(),
      shot: 'state-loading.png',
    };
    await page.screenshot({ path: path.join(OUT, 'state-loading.png') });
  } catch {
    report.states.loading = { firstFeedbackMs: null, note: 'no create-status element appeared' };
  }

  let outcome = 'unknown';
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
  report.states.afterCreate = { outcome, elapsedMs: Date.now() - clickedAt };
  await page.screenshot({ path: path.join(OUT, 'state-after-create.png') });
  report.states.afterCreate.shot = 'state-after-create.png';

  // The editor is the surface that carries the product. Only measurable if the
  // create actually landed — recording "not reached" is the honest alternative.
  if (outcome === 'studio') {
    await page.waitForTimeout(1500);
    report.states.success = { ...(await overflow(page)), shot: 'state-success-editor.png' };
    await page.screenshot({ path: path.join(OUT, 'state-success-editor.png') });
    report.wig.editor = await wigProbe(page);
    report.wig.editorTabStops = await focusWalk(page, 12);

    // Condition 10: does an interaction respond, or does the app stall?
    // Measured at desktop, before the width sweep collapses the navigator.
    const nav = page.locator('[data-testid="slide-navigator"] button:visible').first();
    if (await nav.count()) {
      const t0 = Date.now();
      await nav.click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(50);
      report.interaction.slideSwitchMs = Date.now() - t0;
    }

    // Overflow is not the only way a layout goes wrong. The canvas overlays are
    // position:absolute inside .ns-canvas-panel, whose bottom edge is BELOW the
    // canvas viewport because the presenter-notes strip is the panel's last row
    // — so `bottom: 14px` lands them on top of the notes textarea. Screenshots
    // show it; this turns it into a number.
    const overlayCollision = (p) =>
      p.evaluate(() => {
        const r = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
        const notes = r('.ns-notes-strip textarea');
        const hit = (sel) => {
          const a = r(sel);
          if (!a || !notes) return null;
          const x = Math.min(a.right, notes.right) - Math.max(a.left, notes.left);
          const y = Math.min(a.bottom, notes.bottom) - Math.max(a.top, notes.top);
          return x > 0 && y > 0
            ? {
                sel,
                overlapPx: [Math.round(x), Math.round(y)],
                control: [a.left, a.top, a.right, a.bottom].map(Math.round),
              }
            : null;
        };
        return {
          notes: notes ? [notes.left, notes.top, notes.right, notes.bottom].map(Math.round) : null,
          collisions: [hit('.ns-slide-stepper'), hit('.ns-zoom-controls')].filter(Boolean),
        };
      });

    // The success toast is transient and would sit over the width captures.
    await page.waitForTimeout(6000);
    for (const w of WIDTHS) {
      await page.setViewportSize({ width: w.width, height: w.height });
      await page.waitForTimeout(700);
      const shot = `editor-${w.name}.png`;
      await page.screenshot({ path: path.join(OUT, shot) });
      await page
        .locator('.ns-notes-strip')
        .screenshot({ path: path.join(OUT, `editor-notes-${w.name}.png`) })
        .catch(() => {});
      report.widths.push({
        surface: 'editor',
        ...w,
        ...(await overflow(page)),
        overlay: await overlayCollision(page),
        shot,
        notesShot: `editor-notes-${w.name}.png`,
      });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  report.finishedAt = new Date().toISOString();
  await browser.close();

  // ---- Phase C + D: the two audit tools ------------------------------------
  if (process.env.NODESLIDE_SKIP_TOOLS !== '1') {
    const lh = path.join(OUT, 'lighthouse.json');
    run(
      'lighthouse',
      `npx --yes lighthouse@13.4.1 ${BASE} --output=json --output-path="${lh}" --chrome-flags="--headless"`,
    );
    // `--save` is resolved against cwd, not taken as an absolute path: an
    // absolute Windows path gets concatenated onto cwd and the write ENOENTs
    // after the audit has already run, which reads like a passing audit.
    run('axe', `npx --yes @axe-core/cli@4.13.0 ${BASE} --save ${OUT_REL}/axe.json`);
  }

  await writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `\nconsole errors/warnings: ${report.console.length}, failed requests: ${report.network.length}`,
  );
  console.log(`wrote ${path.join(OUT, 'report.json')}`);
}

main().catch(async (error) => {
  report.fatal = String(error).slice(0, 600);
  await mkdir(OUT, { recursive: true });
  await writeFile(path.join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
