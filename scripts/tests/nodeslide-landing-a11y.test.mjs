/**
 * The landing accessibility guard.
 *
 * The situation this exists for. Someone opens NodeSlide, cannot use a mouse, and tabs through the
 * composer to write a brief. Four separate defects were measured on that path on 2026-08-13 and
 * fixed in the same change; each one is a single character away from coming back, and none of them
 * fails a rendering test, because the page still renders perfectly. They fail a person.
 *
 *   1. `outline: 0` on the brief textarea and on the two model selects. The page has a global
 *      `:where(:focus-visible)` ring in `src/styles.css`, but `:where()` has zero specificity, so
 *      any element rule wins and the control loses its ring. The composer's `:focus-within` ring
 *      hid this: something WAS highlighted, just the whole 724px box, identically for all three
 *      controls — so tabbing between them changed nothing on screen. Measured in
 *      promotion/evidence/audit-2026-08-13/before-dev/report.json as three tab stops reporting
 *      `indicatorOn: "form.ns-landing-composer"`; after the fix all thirteen report `"self"`.
 *   2. The file input carried no accessible name. axe-core 4.13 scored that `label`, impact
 *      critical, and Lighthouse's accessibility category sat at 0.93 because of it alone.
 *   3. The brand link's visible text ("N NodeSlide", where the N is the logo tile) was not
 *      contained in its accessible name ("NodeSlide home"), so a voice-control user saying the
 *      words they can see does not activate the link. The mark is now drawn by CSS.
 *   4. The brief textarea dropped to 15px and the selects to 11px below 700px. iOS Safari zooms the
 *      viewport when a focused input is under 16px, which throws away the layout on the one
 *      control the landing exists for.
 *
 * This guard reads source rather than a rendered page on purpose: it has to run in `npm test` with
 * no browser and no backend. The rendered proof is `node promotion/run-web-audits.mjs`, which needs
 * both.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const read = (relative) => readFileSync(path.join(repoRoot, relative), 'utf8');

const CSS = 'src/domains/nodeslide/nodeslideV3.css';
const LANDING = 'src/domains/nodeslide/components/NodeSlideLanding.tsx';

/**
 * Comments are stripped first, or this guard reads its own explanation. The fix for defect 1 left
 * the words "No `outline: 0` here" in the stylesheet, and a naive scan flags that as the defect —
 * a guard that fails on prose is a guard nobody keeps.
 */
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Balanced block starting at the first `{` at or after `from`. */
function block(css, from) {
  const open = css.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: css.slice(open + 1, i), end: i };
    }
  }
  return null;
}

/** Declarations of every rule whose selector list contains `selector`. */
function ruleBodies(css, selector) {
  const bodies = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(selector, from);
    if (at === -1) return bodies;
    // `.ns-landing-composer textarea::placeholder` is a different rule; skip it.
    const tail = css.slice(at + selector.length, css.indexOf('{', at));
    const found = block(css, at);
    if (!found) return bodies;
    if (!tail.includes('::')) bodies.push(found.body);
    from = found.end;
  }
}

/** Every `@media (max-width: <= limit>)` block body, concatenated. */
function narrowMedia(css, limit) {
  const parts = [];
  const media = /@media\s*\(max-width:\s*(\d+)px\)/g;
  for (const match of css.matchAll(media)) {
    if (Number(match[1]) > limit) continue;
    const found = block(css, match.index);
    if (found) parts.push(found.body);
  }
  return parts.join('\n');
}

describe('landing composer keeps its focus rings', () => {
  const css = stripComments(read(CSS));

  for (const selector of ['.ns-landing-composer textarea', '.ns-landing-model select']) {
    it(`does not suppress the outline on ${selector}`, () => {
      const bodies = ruleBodies(css, selector);
      expect(bodies.length).toBeGreaterThan(0);
      const suppressing = bodies.filter((body) => /outline:\s*(0|none)\b/.test(body));
      expect(
        suppressing,
        `${selector} sets outline: 0. The global :where(:focus-visible) ring in src/styles.css has zero specificity, so this wins and the control has no focus indicator of its own. Verify with: node promotion/run-web-audits.mjs, then read wig.tabStops in the report.`,
      ).toEqual([]);
    });
  }
});

describe('landing controls are large enough not to trip iOS focus zoom', () => {
  const mobile = narrowMedia(stripComments(read(CSS)), 767);

  it('has a narrow breakpoint to check, so a silent zero cannot pass for a clean run', () => {
    expect(mobile.length).toBeGreaterThan(0);
  });

  for (const selector of ['.ns-landing-composer textarea', '.ns-landing-model select']) {
    it(`keeps ${selector} at 16px or larger under a narrow breakpoint`, () => {
      const sizes = ruleBodies(mobile, selector)
        .flatMap((body) => [...body.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)])
        .map((m) => Number(m[1]));
      for (const size of sizes) {
        expect(
          size,
          `${selector} is ${size}px on mobile. iOS Safari zooms the viewport on focus under 16px, and this is the control the landing exists for.`,
        ).toBeGreaterThanOrEqual(16);
      }
    });
  }
});

describe('landing controls carry accessible names', () => {
  const landing = read(LANDING);

  it('names the file input, which axe scored `label`/critical without one', () => {
    const input = landing.slice(landing.indexOf('data-testid="landing-file-input"') - 400);
    expect(input.slice(0, 500)).toMatch(/aria-label="[^"]+"/);
  });

  it('keeps the brand mark out of the link text, so the visible words match the name', () => {
    // <span aria-hidden="true">N</span> puts "N" in the link's visible text while the accessible
    // name stays "NodeSlide home" — the exact shape label-content-name-mismatch fails on.
    expect(landing).not.toMatch(/<span aria-hidden="true">\s*\w/);
  });
});
