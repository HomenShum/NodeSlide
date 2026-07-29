#!/usr/bin/env node
/**
 * NodeSlide trust-surface RUNTIME probe.
 *
 * Companion to `nodeslide-trust-surface-census.mjs`, which is the SOURCE-STATIC half of the
 * same gate. That file says so itself:
 *
 *     "This is a SOURCE-STATIC gate. It reads .tsx and .css text. It does not compute styles,
 *      does not resolve the cascade, and does not look at a rendered page. Clauses that need a
 *      browser are reported `not-run` with the command that would run them — never `passed`."
 *
 * This is the browser. It consumes the census's enumeration — it does not re-derive it — so
 * there remains exactly one list of trust surfaces and the two halves cannot disagree about
 * what exists. `collectTrustSurfaceCensus()` is imported, never edited.
 *
 * WHY A RUNTIME PROBE AT ALL
 * The worst violation this gate has caught to date was `.ns-candidate-status`: its BASE rule
 * was the success token, with per-status overrides for every state EXCEPT `ready` — the one
 * state that means "validated, waiting for you to press Accept". No selector anywhere said
 * "paint pending green". The cascade arranged it. A grep of the source cannot see that; only
 * `getComputedStyle` on a rendered node can. The same blindness applies to motion: Framer
 * Motion, the Web Animations API and inline-style transitions are all invisible to a text
 * sweep and all perfectly visible to `Element.getAnimations()`.
 *
 * THE FOUR CLAUSES THIS RUNS
 *   A. getAnimations()      — no animation running on a decision affordance, and no transition
 *                             that can move it toward the ACCEPTED appearance while its
 *                             declared state stays the same. See "THE NARROWING" below for
 *                             why the second half is stated by direction rather than by the
 *                             mere presence of a `transition:` declaration.
 *   B. computed success     — no element whose declared state is pending resolves to a
 *                             success token. This is the clause the static gate reports
 *                             not-run by name.
 *   C. declared vs rendered — data-decision agrees with what the pixels and the copy imply.
 *   D. reduced motion       — with prefers-reduced-motion: reduce, a decision affordance
 *                             collapses to its FINAL state, never to a second design.
 *
 * HONESTY RULES, which outrank coverage
 *  1. A surface the probe cannot REACH reports `not-run` with the precondition it needs.
 *     Never `passed`. Several surfaces need a live model call to exist at all.
 *  2. EVERY SENSOR IS ARMED BEFORE IT IS TRUSTED. Before asserting the ABSENCE of an
 *     animation or of a success token, the probe asserts the node is present, that it
 *     declares the kind the census says it declares, and that it carries its state
 *     attribute. Otherwise "no violation found" and "nothing was there" are the same
 *     reading — which is how an assertion once matched an unconditional chip label and
 *     filed a screenshot reading "Unsourced 0" as proof a state had been reached.
 *  3. Pending-only clauses report `not-applicable` WITH THE OBSERVED STATE when the surface
 *     is reached in a settled state. Not `passed`: nothing pending was examined.
 *  4. Every verdict carries the observed value behind it into the receipt. A verdict
 *     without its evidence is not evidence.
 *
 * SCOPE
 * Web surfaces only. This proves nothing about PPTX export playback — a browser cannot
 * observe whether a PowerPoint timing tree is active, and claiming otherwise would be the
 * same species of overclaim this gate exists to catch.
 *
 * USAGE
 *   node scripts/nodeslide-trust-surface-runtime-probe.mjs [--base-url URL] [--out PATH]
 *   node scripts/nodeslide-trust-surface-runtime-probe.mjs --selftest   # knockout proof
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROPOSAL_ORIGIN_ATTRIBUTE,
  PROPOSAL_ORIGIN_AUTHORLESS,
  PROPOSAL_ORIGIN_KINDS,
  PROPOSAL_ORIGIN_VALUES,
  collectTrustSurfaceCensus,
} from './nodeslide-trust-surface-census.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_BASE_URL = 'https://nodeslide.vercel.app';
export const DEFAULT_RECEIPT = 'artifacts/trust-surfaces/runtime-probe.json';

/** Decision values that mean "nobody has decided yet". The pending-only clauses key off this. */
export const PENDING_DECISIONS = new Set(['undecided', 'pending']);

/**
 * States in which a success token is LEGITIMATE. Everything else that a surface can declare
 * is a state where painting green is a claim the state does not support.
 *
 * `pass` is here because a `failed-state` surface is a READOUT, and a deck CI run that passed
 * is entitled to say so in green. The first draft of this probe banned success paint on every
 * failed-state surface regardless of value and duly reported `data-state="pass"` painting
 * `--ns-positive` as a violation — which is the gate misreading "failure never looks like
 * loading" as "nothing may ever look like success". The rule is about the states that are NOT
 * success: `loading`, `unavailable`, `warn` and `fail` may not wear the pass colour.
 */
export const SUCCESS_STATES = new Set(['accepted', 'pass', 'passed']);

/** Custom properties that mean "this succeeded", resolved to real colours in the page. */
export const SUCCESS_TOKENS = ['--ns-positive', '--ns-success', '--ns-good'];

/**
 * Copy that asserts a settled, successful outcome. Clause 2 of the skill is explicit that
 * "copy is a styling channel too" — "Done!" on a surface awaiting confirmation is the same
 * bug as the success colour. Bounded to whole words so "Accept" (the LABEL ON THE BUTTON
 * THAT HAS NOT BEEN PRESSED) does not match; only the past participle claims an outcome.
 */
export const SETTLED_SUCCESS_COPY =
  /\b(accepted|approved|applied|granted|published|done|succeeded|complete|completed)\b/i;

/* ------------------------------------------------------- clause A: which motion is a lie */

/**
 * THE NARROWING, and why it exists.
 *
 * The first version of clause A banned every transition on every node inside a trust surface.
 * On production that fired exactly once, on the AI composer's web-research consent toggle,
 * for `transition: all 0.15s` inherited from the shadcn `buttonVariants` base three components
 * up. Reading the rule that produced that verdict against the thing it actually caught is what
 * this section is:
 *
 *   motion-ladder bans motion on `proposal`, `conflict`, `failed_safe` and diff surfaces, and
 *   it gives three reasons — motion can hide what changed by moving it while the eye is
 *   elsewhere, imply a commit that has not happened because arrival reads as acceptance, or
 *   make a failure look like a loading state. All three are about CONTENT ARRIVING on a review
 *   surface. None of them is about a button shading on hover. The same skill's rung 2 is
 *   literally "CSS — hover, focus, open/close, opacity, simple transforms", so the ladder
 *   blesses the exact treatment its forbidden-surface clause was being read to ban.
 *
 * So the ban is kept, and its target is stated precisely instead of by proxy:
 *
 *   **A transition is a lie iff it can move the element's paint toward the ACCEPTED
 *   appearance while the element's DECLARED STATE stays the same.**
 *
 * That sentence is the whole clause, and every part of it is load-bearing:
 *
 *  - "toward the accepted appearance" — direction, not presence. A hover that shades a
 *    not-yet-granted control toward the granted hue makes it look granted before it is; a
 *    hover that shades it toward a neutral surface colour makes no claim about the decision
 *    at all. Only the first is the bug the rule was written for.
 *  - "while the declared state stays the same" — the deception is PAINT RUNNING AHEAD OF
 *    STATE. Endpoints reachable only by a state change are the opposite case: `aria-pressed`
 *    and `data-*` flip synchronously on click and the paint then catches up over 150ms, so
 *    the paint LAGS a decision that was already committed. Feedback that lags a committed
 *    decision is not a claim about an uncommitted one. This is why the probe measures only
 *    the endpoints reachable through `:hover`, `:focus`, `:focus-visible` and `:active` —
 *    precisely the paint an element can reach while the DOM still says nothing has changed.
 *
 * Keyframe and WAAPI animations are NOT narrowed and stay banned outright: a running
 * animation is not affordance feedback, it is the arrival/pulse class the ladder names.
 */

/**
 * Properties whose transition can carry a claim about the DECISION. Colour moves toward the
 * accept hue; `opacity` moves an unsettled thing toward settled; `transform` moves a thing
 * toward dismissal or into a resting position it has not earned.
 */
export const DECISION_IMPLYING_PROPERTIES = new Set([
  'background',
  'background-color',
  'color',
  'fill',
  'opacity',
  'transform',
]);

/**
 * Tokens that resolve to "this is the decided/accepted look".
 *
 * The success tokens are the accepted look for a proposal or a readout. `--primary` is added
 * because for a two-state control the granted appearance IS the primary fill — the consent
 * toggle renders `variant="default"` (`bg-primary`) when web egress is on and `variant="ghost"`
 * (transparent) when it is off, so `--primary` is literally the colour that means "granted"
 * on the surface this clause was rewritten for.
 */
export const ACCEPT_APPEARANCE_TOKENS = [...SUCCESS_TOKENS, '--primary', '--color-accent'];

/** Pseudo-classes an element can enter WITHOUT its declared state changing. */
export const SAME_STATE_PSEUDOS = ['hover', 'focus', 'focus-visible', 'active'];

/**
 * How close, in OKLab, an endpoint has to be to an accept appearance before the transition is
 * reading as "toward accepted".
 *
 * OKLab is used rather than raw RGB because the question is perceptual — does this look like
 * the accept colour to a human deciding something — and RGB distance answers a different
 * question. 0.10 is comfortably inside "the same colour, slightly different shade" and
 * comfortably outside the measured live case: the consent toggle's hover endpoint
 * (`--color-surface-hover`, oklch(0.96 0.015 75), a near-achromatic near-white) sits 0.37 from
 * `--primary` (oklch(0.62 0.16 35)) and 0.44 from `--color-success`. It is not a near miss.
 */
export const ACCEPT_PROXIMITY_OKLAB = 0.1;

/** Parse a computed `rgb()`/`rgba()` string. Returns null for `none`, `transparent`, alpha-0. */
export function parseColor(value) {
  const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)$/i.exec(
    String(value ?? '').trim(),
  );
  if (!match) return null;
  const alpha = match[4] === undefined ? 1 : Number.parseFloat(match[4]);
  if (!Number.isFinite(alpha) || alpha === 0) return null;
  return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]), a: alpha };
}

/** sRGB (0-255) to OKLab. */
export function srgbToOklab({ r, g, b }) {
  const lin = (channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/**
 * Any computed colour string to OKLab, or null if it is not comparable paint.
 *
 * `oklch()` and `oklab()` are handled natively rather than through an sRGB round trip, and
 * that is not a nicety — it is the fix for a bug this probe committed on its FIRST live run
 * after the narrowing. Chromium does not serialize a wide-gamut computed colour down to
 * `rgb()`: `--primary` came back as the literal string `oklch(0.62 0.16 35)` and the ghost
 * hover endpoint as `oklch(0.96 0.015 75)`. An rgb-only parser returned null for both, every
 * distance was therefore null, and the clause concluded "no accept hue nearby" when what it
 * had actually established was "I could not read either colour". The consent surface passed
 * for a reason that was not the reason printed next to it.
 *
 * That is the probe's own honesty rule 2 turned on itself: an absence assertion from a sensor
 * that never fired. The parser below is half the fix; the other half is that an uncomparable
 * endpoint is now reported as UNMEASURABLE rather than silently counted as neutral.
 */
export function toOklab(value) {
  const text = String(value ?? '').trim();
  const rgb = parseColor(text);
  if (rgb) return srgbToOklab(rgb);

  const lab = /^okl(ch|ab)\(\s*([^)]+)\)$/i.exec(text);
  if (!lab) return null;
  const parts = lab[2].split('/');
  if (parts[1] !== undefined && Number.parseFloat(parts[1]) === 0) return null; // alpha 0
  const numbers = parts[0]
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((part) => (part.endsWith('%') ? Number.parseFloat(part) / 100 : Number.parseFloat(part)));
  if (numbers.length < 3 || numbers.some((n) => !Number.isFinite(n))) return null;
  const [first, second, third] = numbers;
  if (lab[1].toLowerCase() === 'ab') return { L: first, a: second, b: third };
  const hue = (third * Math.PI) / 180;
  return { L: first, a: second * Math.cos(hue), b: second * Math.sin(hue) };
}

/** Perceptual distance between two computed colour strings, or null if either is not paint. */
export function oklabDistance(left, right) {
  const x = toOklab(left);
  const y = toOklab(right);
  if (!x || !y) return null;
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
}

/**
 * Given one same-state endpoint, decide whether it is directional — i.e. whether it moves the
 * element toward looking accepted. Returns a describing object, or null when the endpoint is
 * neutral affordance feedback.
 *
 * Every branch reports the NUMBER it decided on. "This hover is neutral" is only evidence if
 * the distance that made it neutral travels with it.
 */
export function classifyEndpoint(endpoint, acceptAppearances) {
  const { property, value, pseudo, restValue } = endpoint;
  if (!DECISION_IMPLYING_PROPERTIES.has(property)) return null;

  if (property === 'opacity') {
    const to = Number.parseFloat(value);
    const from = Number.parseFloat(restValue ?? '1');
    // "Toward settled" is toward fully opaque. A pending thing rendered at 0.6 that fills in
    // to 1.0 on hover is being shown at rest as unresolved and on hover as resolved.
    if (Number.isFinite(to) && Number.isFinite(from) && from < 1 && to > from) {
      return {
        ...endpoint,
        why: `opacity moves ${from} -> ${to}, toward fully settled`,
        delta: to - from,
      };
    }
    return null;
  }

  if (property === 'transform') {
    const to = String(value ?? '').trim();
    if (to && to !== 'none' && /translate|scale\s*\(\s*0|matrix/i.test(to)) {
      return {
        ...endpoint,
        why: `transform reaches "${to}", a displacement toward dismissal or a resting position`,
        delta: null,
      };
    }
    return null;
  }

  // An endpoint that cannot be compared is UNMEASURABLE, not neutral. Silently returning null
  // here is precisely how the first live run of the narrowed clause cleared the consent surface
  // while every distance it claimed to have measured was null.
  if (toOklab(value) === null) {
    return {
      ...endpoint,
      unmeasurable: true,
      why: `:${pseudo} sets ${property} to "${value}", which is not a colour this probe can place in OKLab`,
    };
  }
  const comparable = Object.entries(acceptAppearances ?? {}).filter(
    ([, resolved]) => toOklab(resolved) !== null,
  );
  if (comparable.length === 0) {
    return {
      ...endpoint,
      unmeasurable: true,
      why: `no accept appearance resolved to a colour comparable with ${property}="${value}"`,
    };
  }

  let nearest = null;
  for (const [token, resolved] of comparable) {
    const distance = oklabDistance(value, resolved);
    if (distance === null) continue;
    if (!nearest || distance < nearest.distance) nearest = { token, resolved, distance };
  }
  if (!nearest || nearest.distance > ACCEPT_PROXIMITY_OKLAB) return null;
  return {
    ...endpoint,
    why: [
      `:${pseudo} moves ${property} to ${value}, which is ${nearest.distance.toFixed(3)} in OKLab`,
      `from ${nearest.token}=${nearest.resolved} (threshold ${ACCEPT_PROXIMITY_OKLAB}) — the`,
      'accepted appearance, reached without the declared state changing',
    ].join(' '),
    delta: nearest.distance,
    token: nearest.token,
  };
}

/* ------------------------------------------------------------------------- reach plan */

/**
 * How to reach each enumerated surface, and what it needs in order to exist.
 *
 * Keyed by `file::component` — the same key the census groups by — so a surface that moves
 * line numbers does not silently fall out of the plan. A census surface with NO plan entry
 * is reported `not-run` by name, and a plan entry matching NO census surface FAILS the run:
 * a stale reach plan is how a real surface stops being probed while the report stays green.
 * That is the census's own STAYS/NOT_EQUIVALENT convention, applied to reachability.
 *
 * `requires` is the not-run REASON, written out. "Could not reach it" is not a reason; "needs
 * a completed model run to have produced a proposal, which this probe does not spend tokens
 * on" is.
 */
export const REACH_PLAN = [
  {
    // The census binds this annotation to `AiInspector`, not to the composer sub-component
    // it visually belongs to. The plan's key is the CENSUS's key on purpose: the stale-plan
    // check caught this exact guess on the first live run and named it, which is what a
    // two-sided enumeration is for.
    key: 'src/domains/nodeslide/inspector/AiInspector.tsx::AiInspector',
    selector: '[data-testid="ai-web-research-toggle"]',
    kind: 'consent',
    stateAttribute: 'data-agent-web-consent',
    stage: 'ai-tab',
    requires: 'the AI inspector tab on an open deck',
  },
  {
    key: 'src/domains/nodeslide/inspector/DeckCiStatus.tsx::DeckCiStatus',
    selector: '[data-trust-surface="failed-state"]',
    kind: 'failed-state',
    stateAttribute: 'data-state',
    stage: 'ai-tab',
    requires:
      'a deck CI result (or an in-flight check) on the AI tab; the readout is not mounted at all until `deckCiResult !== undefined || deckCiLoading`',
  },
  {
    key: 'src/domains/nodeslide/openui/OpenUiMaterialWorkbench.tsx::OpenUiMaterialWorkbench',
    selector: '[data-testid="openui-visual-workbench"]',
    kind: 'proposal',
    stateAttribute: 'data-decision',
    stage: 'openui-workbench',
    requires:
      'the visual material tool opened from the AI composer, which is lazy-loaded and only mounts when the host supplies onProposeOpenUiMaterial',
  },
  {
    key: 'src/domains/nodeslide/inspector/JsonInspector.tsx::ElementJsonEditor',
    selector: '[data-testid="json-element-editor"]',
    kind: 'proposal',
    stateAttribute: 'data-decision',
    stage: 'json-tab',
    requires: 'the JSON tab with a single element selected on the canvas',
  },
  {
    key: 'src/domains/nodeslide/components/EditorCanvasModes.tsx::CandidateReceipt',
    selector: '[data-testid="candidate-receipt"]',
    kind: 'diff-review',
    stateAttribute: 'data-decision',
    statusAttribute: 'data-candidate-status',
    stage: 'compare-mode',
    requires:
      'Compare mode holding a candidate deck — which only exists after an AI edit produced one. The probe does not spend a model call to manufacture it.',
  },
  {
    key: 'src/domains/nodeslide/inspector/AiInspector.tsx::VariationCard',
    selector: '[data-testid="variation-card"]',
    kind: 'diff-review',
    stateAttribute: 'data-decision',
    stage: 'ai-tab',
    requires:
      'a completed three-direction variation run. Generating one costs a live model call against production; the probe refuses to bill the owner to produce its own fixture.',
  },
  {
    key: 'src/domains/nodeslide/inspector/AiInspector.tsx::ProposalCard',
    selector: '[data-testid="proposal-card"]',
    kind: 'proposal',
    stateAttribute: 'data-decision',
    stage: 'ai-tab',
    requires:
      'a pending AI patch proposal, i.e. a completed model run on production. Same refusal as VariationCard.',
  },
  {
    key: 'src/domains/nodeslide/inspector/AgentThread.tsx::ThreadTurn',
    selector: '[data-testid="agent-thread-patch"]',
    kind: 'proposal',
    stateAttribute: 'data-decision',
    stage: 'ai-tab',
    // ThreadTurn owns BOTH annotated tags (the undecided patch card at :285 and the settled
    // readout at :324). The census keys by component, so one plan entry answers both; the
    // second selector is probed under `alsoSelectors` and reported as its own surface row.
    alsoSelectors: ['[data-testid="agent-thread-patch-settled"]'],
    requires:
      'an agent thread turn carrying a patch. Requires a live agent run; the thread is empty on a freshly opened sample deck.',
  },
  {
    key: 'src/domains/nodeslide/components/PublicationDialog.tsx::PublicationDialog',
    selector: '[data-testid="publish-approval-section"]',
    kind: 'permission',
    stateAttribute: 'data-decision',
    stage: 'publish-dialog',
    requires: 'the Share/Publish dialog opened from the studio toolbar',
  },
];

/**
 * Pair the census enumeration against the reach plan. Neither side is allowed to be the
 * silent one: an enumerated surface with no plan is `not-run` by name, and a plan entry that
 * matches nothing in the census is a hard failure, not a shrug.
 */
export function planForCensus(annotated) {
  const byKey = new Map();
  for (const surface of annotated) {
    const key = `${surface.file}::${surface.component}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(surface);
  }
  const planKeys = new Set(REACH_PLAN.map((entry) => entry.key));

  // Authorship expectation is DERIVED from the census's own authorless table, never restated
  // here. A second hand-maintained list is how the probe would eventually excuse a surface the
  // census still requires — the two-list disagreement this whole file is arranged to prevent.
  const authorlessKeys = new Set(
    PROPOSAL_ORIGIN_AUTHORLESS.map((entry) => `${entry.file}::${entry.component}`),
  );
  const planned = REACH_PLAN.filter((entry) => byKey.has(entry.key)).map((entry) => ({
    ...entry,
    proposalOrigin: authorlessKeys.has(entry.key) ? 'authorless' : 'required',
    census: byKey.get(entry.key),
  }));
  const unplanned = [...byKey.entries()]
    .filter(([key]) => !planKeys.has(key))
    .map(([key, surfaces]) => ({ key, census: surfaces }));
  const stalePlan = REACH_PLAN.filter((entry) => !byKey.has(entry.key)).map((entry) => entry.key);

  return { planned, unplanned, stalePlan };
}

/* ------------------------------------------------------------- the in-page observation */

/**
 * Runs INSIDE the page. Everything here has to be self-contained and JSON-serializable.
 *
 * The success tokens are resolved by PAINTING them, not by reading the custom property
 * text: `--ns-positive` may be a `color-mix()`, an `oklch()`, or a reference to another
 * property, and only the browser knows what any of those actually become. A probe element
 * with `color: var(--ns-positive)` reads back as the canonical `rgb(...)` the compositor
 * would use — which is the only form comparable to an element's computed `color`.
 */
/* c8 ignore start -- executes in the browser, not under the node test runner */
export function observeSurfacesInPage(selectors) {
  const CAP = 60;
  const PSEUDOS = ['hover', 'focus', 'focus-visible', 'active'];
  const WATCHED = ['background', 'background-color', 'color', 'fill', 'opacity', 'transform'];

  /*
   * Collect, ONCE per document, every style rule that fires on a same-state pseudo-class.
   *
   * These are the endpoints an element can reach while the DOM still declares the same
   * decision — which is exactly the set clause A now asks about. A rule reachable only by a
   * class change (the `ghost` -> `default` variant flip when a toggle is actually pressed) is
   * deliberately NOT here: by the time that class lands, `aria-pressed` and the state
   * attribute have already flipped, so the paint is lagging a committed decision rather than
   * running ahead of an uncommitted one.
   *
   * Cross-origin sheets throw on `.cssRules`. They are COUNTED, not swallowed: a clause that
   * concluded "no directional endpoint" while blind to half the stylesheets would be asserting
   * an absence it never looked for, which is the one thing this probe is built not to do.
   */
  const collectPseudoRules = () => {
    const rules = [];
    let unreadableSheets = 0;
    let sheetsRead = 0;
    const walk = (list) => {
      for (const rule of list) {
        if (rule.cssRules && !rule.selectorText) {
          walk(rule.cssRules); // @media / @supports / @layer
          continue;
        }
        const selectorText = rule.selectorText;
        if (!selectorText || !rule.style) continue;
        for (const part of selectorText.split(',')) {
          const selector = part.trim();
          const hit = PSEUDOS.find((pseudo) => new RegExp(`:${pseudo}(?![\\w-])`).test(selector));
          if (!hit) continue;
          const declarations = [];
          for (const property of WATCHED) {
            const value = rule.style.getPropertyValue(property);
            if (value) declarations.push([property, value.trim()]);
          }
          if (declarations.length === 0) continue;
          // Strip the same-state pseudo-classes so the remainder can be matched against a
          // real element. `.dark .btn:hover` -> `.dark .btn`; `.group:hover .btn` ->
          // `.group .btn`, which is still an endpoint reachable with no state change.
          let base = selector;
          for (const pseudo of PSEUDOS) {
            base = base.replace(new RegExp(`:${pseudo}(?![\\w-])`, 'g'), '');
          }
          base = base.trim();
          if (!base || base.includes('::')) continue;
          rules.push({ pseudo: hit, base, declarations });
        }
      }
    };
    for (const sheet of document.styleSheets) {
      let list = null;
      try {
        list = sheet.cssRules;
      } catch {
        unreadableSheets += 1;
        continue;
      }
      if (!list) {
        unreadableSheets += 1;
        continue;
      }
      sheetsRead += 1;
      walk(list);
    }
    return { rules, unreadableSheets, sheetsRead };
  };

  const sheetScan = collectPseudoRules();

  /**
   * Resolve a DECLARED value (`var(--accent)`, `oklch(...)`, a keyword) to the canonical
   * `rgb(...)` the compositor would paint, in the cascade scope of the node that would wear
   * it. Same two-fallback sentinel as `resolveTokens`, generalized: the value is painted
   * inside two wrappers with different inherited colours, so "resolved" and "fell back to
   * inherit" stop being the same reading.
   */
  const resolveDeclared = (value, scope) => {
    const read = (fallback) => {
      const wrap = document.createElement('span');
      wrap.style.position = 'absolute';
      wrap.style.opacity = '0';
      wrap.style.pointerEvents = 'none';
      wrap.style.color = fallback;
      const probe = document.createElement('span');
      wrap.appendChild(probe);
      scope.appendChild(wrap);
      probe.style.color = value;
      const out = getComputedStyle(probe).color;
      wrap.remove();
      return out;
    };
    const a = read('rgb(1, 2, 3)');
    const b = read('rgb(4, 5, 6)');
    if (a !== b || a === 'rgb(1, 2, 3)' || a === 'rgb(4, 5, 6)') return null;
    return a;
  };

  /*
   * Resolve the success tokens IN THE SCOPE OF THE SURFACE, with a two-fallback sentinel.
   *
   * Both halves were bugs the first live run found in this probe itself:
   *
   *  - Scope. `--ns-positive` is declared on `.nodeslide-studio`, not on `:root`. A probe
   *    element appended to `document.body` sits outside that scope, `var(--ns-positive)`
   *    is then invalid at computed-value time, `color` falls back to INHERITED — and the
   *    probe recorded the body's plain black as "the success token". Every SVG `fill`
   *    on the page defaults to that same black, so the probe reported success styling on
   *    every surface it reached. A sensor that reads black as green is worse than no sensor.
   *    Resolving inside the surface itself gets the exact cascade the surface is painted in.
   *
   *  - Detection. `var(--x)` with `--x` undefined does not leave the property alone, so
   *    "did it change?" cannot distinguish "resolved" from "fell back to inherit". Two
   *    probes with DIFFERENT explicit fallbacks can: if each returns its own fallback the
   *    property is undefined; if both return the same third value, that value IS the token.
   */
  const resolveTokens = (tokens, scope) => {
    const probe = document.createElement('span');
    probe.style.position = 'absolute';
    probe.style.opacity = '0';
    probe.style.pointerEvents = 'none';
    scope.appendChild(probe);
    const resolved = {};
    for (const token of tokens) {
      probe.style.color = `var(${token}, rgb(1, 2, 3))`;
      const a = getComputedStyle(probe).color;
      probe.style.color = `var(${token}, rgb(4, 5, 6))`;
      const b = getComputedStyle(probe).color;
      if (a === b && a !== 'rgb(1, 2, 3)' && a !== 'rgb(4, 5, 6)') resolved[token] = a;
    }
    probe.remove();
    return resolved;
  };

  const describe = (el) => {
    const cls =
      typeof el.className === 'string' && el.className
        ? `.${el.className.trim().split(/\s+/).slice(0, 3).join('.')}`
        : '';
    const testid = el.getAttribute('data-testid');
    return `${el.tagName.toLowerCase()}${cls}${testid ? `[data-testid=${testid}]` : ''}`;
  };

  const paintOf = (el) => {
    const s = getComputedStyle(el);
    return {
      node: describe(el),
      color: s.color,
      backgroundColor: s.backgroundColor,
      borderTopColor: s.borderTopColor,
      borderLeftColor: s.borderLeftColor,
      outlineColor: s.outlineColor,
      fill: s.fill,
    };
  };

  const motionOf = (el) => {
    const s = getComputedStyle(el);

    // The endpoints THIS node can reach with no state change, each resolved to real paint and
    // paired with the rest value it would animate away from.
    const endpoints = [];
    for (const rule of sheetScan.rules) {
      let matches = false;
      try {
        matches = el.matches(rule.base);
      } catch {
        matches = false;
      }
      if (!matches) continue;
      for (const [property, declared] of rule.declarations) {
        const restValue = s.getPropertyValue(property);
        const value =
          property === 'opacity' || property === 'transform'
            ? declared
            : resolveDeclared(declared, el);
        endpoints.push({
          pseudo: rule.pseudo,
          property,
          declared,
          value,
          restValue,
          resolved: value !== null,
        });
      }
    }

    return {
      node: describe(el),
      transitionProperty: s.transitionProperty,
      transitionDuration: s.transitionDuration,
      animationName: s.animationName,
      animationDuration: s.animationDuration,
      animationIterationCount: s.animationIterationCount,
      sameStateEndpoints: endpoints.slice(0, 24),
      sheetsRead: sheetScan.sheetsRead,
      unreadableSheets: sheetScan.unreadableSheets,
    };
  };

  const results = {};

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (!el) {
      results[selector] = { present: false };
      continue;
    }
    const tokens = resolveTokens(['--ns-positive', '--ns-success', '--ns-good'], el);
    // The accepted LOOK, which is a superset of the success tokens: for a two-state control
    // the granted appearance is the primary fill, not a green.
    const acceptAppearances = resolveTokens(
      ['--ns-positive', '--ns-success', '--ns-good', '--primary', '--color-accent'],
      el,
    );

    // The nodes a decision is actually carried by: the surface itself, its status readouts,
    // and every affordance inside it. Not the whole subtree — a proposal card can contain a
    // rendered slide preview, and a transition on a thumbnail is not a trust-surface bug.
    const affordances = [...el.querySelectorAll('button, [role="button"], a, input, select')];
    const statusNodes = [
      ...el.querySelectorAll('[class*="status"], [class*="badge"], [data-decision], [data-state]'),
    ];
    const nodes = [el, ...new Set([...affordances, ...statusNodes])].slice(0, CAP);

    const running = [];
    for (const node of nodes) {
      for (const animation of node.getAnimations({ subtree: false })) {
        const effect = animation.effect;
        const timing =
          effect && typeof effect.getComputedTiming === 'function'
            ? effect.getComputedTiming()
            : {};
        running.push({
          node: describe(node),
          playState: animation.playState,
          // CSSTransition / CSSAnimation expose the property or keyframe name; a raw
          // WAAPI animation (what Framer Motion drives) exposes neither, so it is reported
          // by constructor name. All three have to be nameable or a violation is unactionable.
          type: animation.constructor?.name ?? 'Animation',
          name:
            animation.transitionProperty ??
            animation.animationName ??
            animation.id ??
            '(unnamed WAAPI animation)',
          duration: typeof timing.duration === 'number' ? timing.duration : null,
          iterations: typeof timing.iterations === 'number' ? timing.iterations : null,
        });
      }
    }

    const attributes = {};
    for (const attr of el.attributes) attributes[attr.name] = attr.value;

    results[selector] = {
      present: true,
      node: describe(el),
      attributes,
      classList: [...el.classList],
      text: (el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
      visible: el.getClientRects().length > 0,
      runningAnimations: running,
      motion: nodes.map(motionOf),
      paint: nodes.map(paintOf),
      successTokens: tokens,
      acceptAppearances,
    };
  }
  return results;
}
/* c8 ignore stop */

/* --------------------------------------------------------------- clause evaluation (pure) */

const PASS = 'passed';
const FAIL = 'failed';
const NOT_RUN = 'not-run';
const NOT_APPLICABLE = 'not-applicable';

/**
 * The floor below which a duration is not motion.
 *
 * `prefers-reduced-motion: reduce` is implemented across this codebase (and across the web)
 * as `transition-duration: 0.01ms !important`, not as `0s` — the near-zero value is used
 * because a true `0s` cancels `transitionend` and breaks listeners that wait for it. Chromium
 * reports that back as `1e-06s`. A strict `> 0` test therefore reads the CORRECT reduced-motion
 * implementation as a reduced-motion violation, which the first live run of this probe duly
 * did on two surfaces. 1ms is well under a display frame; nothing at or below it animates.
 */
export const MOTION_FLOOR_SECONDS = 0.001;

const nonZero = (duration) =>
  String(duration ?? '')
    .split(',')
    .some((part) => {
      const value = Number.parseFloat(part);
      return Number.isFinite(value) && value > MOTION_FLOOR_SECONDS;
    });

const namedAnimation = (name) =>
  String(name ?? 'none')
    .split(',')
    .some((part) => part.trim() && part.trim() !== 'none');

/**
 * The properties a node ACTUALLY transitions: `transition-property` paired with its matching
 * `transition-duration`, dropping any pair whose duration is at or below the motion floor.
 *
 * The pairing matters. `transition: opacity 0s, background-color 150ms` computes to
 * `transition-property: opacity, background-color` — reading the property list alone would
 * report a transition on `opacity` that does not exist. CSS cycles the shorter list, which is
 * why the duration index wraps.
 */
export function transitionedProperties(entry) {
  const properties = String(entry?.transitionProperty ?? 'none')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part && part !== 'none');
  if (properties.length === 0) return [];
  const durations = String(entry?.transitionDuration ?? '0s')
    .split(',')
    .map((part) => part.trim());
  return properties.filter((_, index) => {
    const duration = durations[index % durations.length];
    const value = Number.parseFloat(duration);
    return Number.isFinite(value) && value > MOTION_FLOOR_SECONDS;
  });
}

/** Every paint value on the surface that exactly equals a resolved success token. */
export function successPaints(observation) {
  const tokens = Object.entries(observation.successTokens ?? {});
  if (tokens.length === 0) return [];
  const hits = [];
  for (const entry of observation.paint ?? []) {
    for (const [property, value] of Object.entries(entry)) {
      if (property === 'node') continue;
      for (const [token, resolved] of tokens) {
        if (value === resolved) hits.push({ node: entry.node, property, value, token });
      }
    }
  }
  return hits;
}

/**
 * Arm the sensors. Returns a not-run/failed reason if this observation cannot support an
 * absence assertion, or null if it can.
 *
 * This is the whole difference between a check and a decoration. An assertion that "no
 * success token was found" is worthless unless the thing it looked at was provably the right
 * node in the right state — the alternative reading is that the selector matched nothing, or
 * matched an unrelated element that happens to render unconditionally.
 */
export function armSensors(observation, plan) {
  if (!observation || observation.present !== true) {
    return { verdict: NOT_RUN, reason: `surface never rendered; requires ${plan.requires}` };
  }
  const declaredKind = observation.attributes?.['data-trust-surface'];
  if (declaredKind !== plan.kind) {
    return {
      verdict: NOT_RUN,
      reason:
        `matched node declares data-trust-surface="${declaredKind ?? '(absent)'}" but the census ` +
        `enumerates it as "${plan.kind}"; the probe refuses to grade a node it cannot prove is the surface`,
    };
  }
  if (!(plan.stateAttribute in (observation.attributes ?? {}))) {
    return {
      verdict: FAIL,
      reason: [
        `runtime attribute loss: the source declares ${plan.stateAttribute} on this element and`,
        'the rendered DOM does not carry it. A wrapper component that does not spread data-*',
        'props erases the posture without failing anything else.',
      ].join(' '),
    };
  }
  if (observation.visible !== true) {
    return {
      verdict: NOT_RUN,
      reason: 'surface is in the DOM but has no client rects; computed paint would be meaningless',
    };
  }
  return null;
}

/** CLAUSE A — no animation running on a decision affordance. */
export function clauseAnimations(observation, plan) {
  const blocked = armSensors(observation, plan);
  if (blocked) return { ...blocked, clause: 'A' };

  const state = observation.attributes[plan.stateAttribute];

  // `failed-state` is a readout, not an affordance. Its motion rule is the narrower one —
  // "failure never looks like loading" — so a pulse while a check is genuinely in flight is
  // legitimate and only the failed/unavailable states are policed.
  if (plan.kind === 'failed-state' && !/fail|error|unavailable|invalid/i.test(state ?? '')) {
    return {
      clause: 'A',
      verdict: NOT_APPLICABLE,
      reason: `failed-state surface observed in data-state="${state}"; the motion ban applies to its failure states`,
      observed: { state },
    };
  }

  // -- the unnarrowed half. A keyframe or WAAPI animation is never affordance feedback.
  const running = observation.runningAnimations.filter(
    (entry) => entry.playState === 'running' || entry.playState === 'paused',
  );
  const animated = observation.motion.filter((entry) => namedAnimation(entry.animationName));
  if (running.length > 0 || animated.length > 0) {
    return {
      clause: 'A',
      verdict: FAIL,
      reason: [
        running.length
          ? `running: ${running.map((r) => `${r.node} ${r.type}(${r.name}) ${r.playState}`).join(' | ')}`
          : '',
        animated.length
          ? `named animation in the computed cascade: ${animated
              .map((d) => `${d.node} animation:${d.animationName}/${d.animationDuration}`)
              .join(' | ')}`
          : '',
        `(declared state ${plan.stateAttribute}="${state}")`,
      ]
        .filter(Boolean)
        .join(' ;; '),
      observed: { state, running, animated },
    };
  }

  // -- the narrowed half. A transition is graded on WHICH property it moves and WHERE to.
  const decisionTransitions = [];
  const neutralTransitions = [];
  for (const entry of observation.motion) {
    const live = transitionedProperties(entry);
    if (live.length === 0) continue;
    const covers = live.includes('all')
      ? [...DECISION_IMPLYING_PROPERTIES]
      : live.filter((property) => DECISION_IMPLYING_PROPERTIES.has(property));
    if (covers.length === 0) {
      neutralTransitions.push({ node: entry.node, properties: live });
      continue;
    }
    decisionTransitions.push({ entry, covers });
  }

  if (decisionTransitions.length === 0) {
    return {
      clause: 'A',
      verdict: PASS,
      reason:
        `${observation.motion.length} node(s) inspected: no animation, and no transition on a ` +
        `decision-implying property${
          neutralTransitions.length
            ? `. Neutral affordance transitions only: ${neutralTransitions
                .map((n) => `${n.node} [${n.properties.join(' ')}]`)
                .join(' | ')}`
            : ''
        }`,
      observed: { state, nodesInspected: observation.motion.length, neutralTransitions },
    };
  }

  const accept = observation.acceptAppearances ?? {};
  const directional = [];
  const neutralEndpoints = [];
  const unmeasurable = [];

  for (const { entry, covers } of decisionTransitions) {
    if (!Array.isArray(entry.sameStateEndpoints)) {
      unmeasurable.push(
        `${entry.node}: transitions ${covers.join('/')} but this observation carries no same-state endpoint measurement`,
      );
      continue;
    }
    if ((entry.unreadableSheets ?? 0) > 0) {
      unmeasurable.push(
        `${entry.node}: ${entry.unreadableSheets} stylesheet(s) could not be read (cross-origin), so the endpoint set is incomplete`,
      );
      continue;
    }
    const colourish = covers.some((property) => property !== 'opacity' && property !== 'transform');
    if (colourish && Object.keys(accept).length === 0) {
      unmeasurable.push(
        `${entry.node}: transitions a colour property but no accept-appearance token resolved in this document, so "toward accepted" has no reference point`,
      );
      continue;
    }
    for (const endpoint of entry.sameStateEndpoints) {
      if (!covers.includes(endpoint.property)) continue;
      const literal = endpoint.property === 'opacity' || endpoint.property === 'transform';
      if (!literal && endpoint.resolved !== true) {
        unmeasurable.push(
          `${entry.node}: :${endpoint.pseudo} sets ${endpoint.property}: ${endpoint.declared}, which did not resolve to paint in this document`,
        );
        continue;
      }
      const hit = classifyEndpoint(endpoint, accept);
      if (hit?.unmeasurable) unmeasurable.push(`${entry.node}: ${hit.why}`);
      else if (hit) directional.push({ node: entry.node, ...hit });
      else
        neutralEndpoints.push({
          node: entry.node,
          pseudo: endpoint.pseudo,
          property: endpoint.property,
          value: endpoint.value,
        });
    }
  }

  if (directional.length > 0) {
    return {
      clause: 'A',
      verdict: FAIL,
      reason: `transition moves this surface toward the ACCEPTED appearance with no state change: ${directional
        .map((d) => `${d.node} ${d.why}`)
        .join(' | ')} ;; (declared state ${plan.stateAttribute}="${state}")`,
      observed: { state, directional, acceptAppearances: accept },
    };
  }
  if (unmeasurable.length > 0) {
    return {
      clause: 'A',
      verdict: NOT_RUN,
      reason: [
        'a decision-implying transition was found but its endpoints could not be measured, and',
        `an unmeasured endpoint is not a neutral one: ${unmeasurable.join(' | ')}`,
      ].join(' '),
      observed: { state, unmeasurable, acceptAppearances: accept },
    };
  }
  return {
    clause: 'A',
    verdict: PASS,
    reason:
      `${observation.motion.length} node(s) inspected; ${decisionTransitions.length} carry a transition on a ` +
      `decision-implying property, and every endpoint reachable without a state change is neutral: ${
        neutralEndpoints.length
          ? neutralEndpoints
              .map((n) => `${n.node} :${n.pseudo} ${n.property}=${n.value}`)
              .join(' | ')
          : 'no :hover/:focus/:active rule reaches these nodes at all, so the transition has no same-state endpoint to animate toward'
      }. Accept appearances compared against: ${Object.entries(accept)
        .map(([token, value]) => `${token}=${value}`)
        .join(' ')}`,
    observed: {
      state,
      neutralEndpoints,
      acceptAppearances: accept,
      // Serialized as text, not as an array of one word per line. `JSON.stringify(_, null, 2)`
      // always expands an array while the repo formatter collapses a short one, so an array
      // here makes every regenerated receipt fail `biome check` — a gate whose own artifact
      // breaks the lint gate is a gate people start skipping.
      decisionTransitions: decisionTransitions.map(({ entry, covers }) => ({
        node: entry.node,
        transitions: covers.join(' '),
      })),
    },
  };
}

/** CLAUSE B — computed colour on a PENDING element is never a success token. */
export function clauseSuccessToken(observation, plan) {
  const blocked = armSensors(observation, plan);
  if (blocked) return { ...blocked, clause: 'B' };

  const state = observation.attributes[plan.stateAttribute];
  const tokens = observation.successTokens ?? {};
  if (Object.keys(tokens).length === 0) {
    return {
      clause: 'B',
      verdict: NOT_RUN,
      reason:
        'no success token resolved to a colour in this document; without a resolved token the ' +
        'comparison has no left-hand side and a green would mean nothing',
      observed: { state },
    };
  }
  // Honesty rule 3. A surface reached in `accepted` teaches nothing about whether PENDING is
  // painted green, and reporting `passed` here would inflate the census with a state that
  // was never examined.
  if (!PENDING_DECISIONS.has(state ?? '')) {
    return {
      clause: 'B',
      verdict: NOT_APPLICABLE,
      reason: `surface reached in ${plan.stateAttribute}="${state}", not a pending state; the pending-paint clause had nothing pending to read`,
      observed: { state, resolvedTokens: tokens },
    };
  }

  const hits = successPaints(observation);
  if (hits.length === 0) {
    return {
      clause: 'B',
      verdict: PASS,
      reason: `pending surface: ${observation.paint.length} node(s) × 6 colour properties, none equal to ${Object.entries(
        tokens,
      )
        .map(([token, value]) => `${token}=${value}`)
        .join(' ')}`,
      observed: { state, resolvedTokens: tokens, paint: observation.paint },
    };
  }
  return {
    clause: 'B',
    verdict: FAIL,
    reason: `success token painted on a pending surface: ${hits
      .map((h) => `${h.node} ${h.property}=${h.value} (${h.token})`)
      .join(' | ')}`,
    observed: { state, resolvedTokens: tokens, hits },
  };
}

/** CLAUSE C — the DOM-declared state and the rendered state agree. */
export function clauseStateAgreement(observation, plan) {
  const blocked = armSensors(observation, plan);
  if (blocked) return { ...blocked, clause: 'C' };

  const state = observation.attributes[plan.stateAttribute];
  const disagreements = [];

  // (i) paint must not claim an outcome the declared state denies. A state that IS success
  // is entitled to the success colour; every other state painting it is the disagreement.
  if (!SUCCESS_STATES.has(state ?? '')) {
    for (const hit of successPaints(observation)) {
      disagreements.push(
        `declared "${state}" but ${hit.node} paints ${hit.property}=${hit.value} (${hit.token})`,
      );
    }
  }

  // (ii) copy is a styling channel. "Done!" over an undecided thing is the success colour
  // written in words, and is graded the same way.
  if (PENDING_DECISIONS.has(state ?? '')) {
    const copy = SETTLED_SUCCESS_COPY.exec(observation.text ?? '');
    if (copy) {
      disagreements.push(
        `declared "${state}" but the visible copy asserts a settled outcome: "${copy[0]}" in "${observation.text.slice(0, 120)}"`,
      );
    }
  }

  // (iii) one writer, one owning node. Where the surface publishes a status attribute, the
  // class it renders itself with must be the class for that status — the `data-ns-theme`
  // collision in gate form, scoped to a single element.
  let statusChecked = null;
  if (plan.statusAttribute) {
    const status = observation.attributes[plan.statusAttribute];
    statusChecked = { attribute: plan.statusAttribute, value: status };
    if (status === undefined) {
      disagreements.push(`${plan.statusAttribute} declared in source but absent at runtime`);
    } else if (!observation.classList.includes(`is-${status}`)) {
      disagreements.push(
        `${plan.statusAttribute}="${status}" but the element renders classes [${observation.classList.join(' ')}] — the status attribute and the styling hook disagree`,
      );
    }
  }

  if (disagreements.length === 0) {
    return {
      clause: 'C',
      verdict: PASS,
      reason: `declared ${plan.stateAttribute}="${state}"; paint, copy${
        statusChecked ? ` and ${statusChecked.attribute}="${statusChecked.value}"` : ''
      } all agree`,
      observed: { state, statusChecked, text: observation.text },
    };
  }
  return {
    clause: 'C',
    verdict: FAIL,
    reason: disagreements.join(' | '),
    observed: { state, statusChecked, text: observation.text },
  };
}

/**
 * CLAUSE D — under prefers-reduced-motion: reduce, the surface collapses to its FINAL state
 * and never to a second design.
 *
 * "Never to a second design" is the half that is usually skipped, and it is the half that
 * needs two observations to check at all: a reduced-motion build that quietly swaps the
 * colour, the copy or the declared state is not honouring the preference, it is shipping a
 * different product to the users who asked for less motion.
 */
export function clauseReducedMotion(observation, reduced, plan, motionAfter = null) {
  const blocked = armSensors(observation, plan);
  if (blocked) return { ...blocked, clause: 'D' };

  // Stability gate — the closing half of the observation bracket. A surface that changed on
  // its own while the preference was being toggled cannot be compared across the toggle.
  if (motionAfter && motionAfter.present === true) {
    const before = observation.attributes[plan.stateAttribute];
    const afterState = motionAfter.attributes?.[plan.stateAttribute];
    if (before !== afterState) {
      return {
        clause: 'D',
        verdict: NOT_RUN,
        reason: [
          `surface was still settling: ${plan.stateAttribute} read "${before}" before the`,
          `reduced-motion window and "${afterState}" after it, with motion allowed both times.`,
          'Any difference observed under reduce would be the passage of time, not the preference.',
        ].join(' '),
        observed: { before, afterState },
      };
    }
  }

  if (!reduced || reduced.present !== true) {
    return {
      clause: 'D',
      verdict: FAIL,
      reason:
        'surface is reachable with motion allowed but absent under prefers-reduced-motion: reduce — ' +
        'the affordance disappears rather than collapsing to its final state',
    };
  }

  const problems = [];
  const state = observation.attributes[plan.stateAttribute];
  const reducedState = reduced.attributes?.[plan.stateAttribute];
  if (state !== reducedState) {
    problems.push(
      `declared state differs: ${plan.stateAttribute}="${state}" vs "${reducedState}" under reduce`,
    );
  }

  const stillRunning = reduced.runningAnimations.filter((a) => a.playState === 'running');
  if (stillRunning.length > 0) {
    problems.push(
      `still animating under reduce: ${stillRunning.map((a) => `${a.node} ${a.type}(${a.name})`).join(' | ')}`,
    );
  }
  const stillDeclared = reduced.motion.filter(
    (entry) => nonZero(entry.transitionDuration) || namedAnimation(entry.animationName),
  );
  if (stillDeclared.length > 0) {
    problems.push(
      `computed motion survives reduce: ${stillDeclared
        .map((d) => `${d.node} ${d.transitionDuration}/${d.animationName}`)
        .join(' | ')}`,
    );
  }

  // The second-design check. Compared node by node so the message names the element that
  // changed, not merely that "something" did.
  const byNode = new Map(reduced.paint.map((entry) => [entry.node, entry]));
  const repaints = [];
  for (const entry of observation.paint) {
    const other = byNode.get(entry.node);
    if (!other) continue;
    for (const [property, value] of Object.entries(entry)) {
      if (property === 'node') continue;
      if (other[property] !== value) {
        repaints.push(`${entry.node} ${property}: ${value} → ${other[property]}`);
      }
    }
  }
  if (repaints.length > 0) {
    problems.push(`reduced-motion renders a second design: ${repaints.join(' | ')}`);
  }
  if ((observation.text ?? '') !== (reduced.text ?? '')) {
    problems.push(
      `copy differs under reduce: "${(observation.text ?? '').slice(0, 80)}" vs "${(reduced.text ?? '').slice(0, 80)}"`,
    );
  }

  if (problems.length === 0) {
    return {
      clause: 'D',
      verdict: PASS,
      reason: `identical declared state, paint and copy under reduce; no animation running or declared (${reduced.motion.length} nodes compared)`,
      observed: { state, reducedState },
    };
  }
  return {
    clause: 'D',
    verdict: FAIL,
    reason: problems.join(' | '),
    observed: { state, reducedState },
  };
}

/**
 * CLAUSE E — a proposal surface publishes WHO AUTHORED IT, in the rendered DOM.
 *
 * The census proves the attribute is in the SOURCE. That is not the same claim: the
 * `data-agent-web-consent` regression was a component that still declared its posture in source
 * while a wrapper that did not spread `data-*` erased it from the page. So this clause asks the
 * browser, and it asks about EXISTENCE first — a value-only check reads a missing attribute as
 * `undefined`, compares it against nothing, and passes, which is exactly the silent-capability-
 * loss shape the attribute exists to make impossible.
 *
 * Honesty rules preserved:
 *  - a surface the probe could not reach is `not-run` via armSensors, never `passed`;
 *  - a surface the census reviewed as AUTHORLESS is `not-applicable` WITH the reason, never
 *    `passed`: nothing about authorship was examined there, because there is none to examine.
 */
export function clauseProposalOrigin(observation, plan) {
  const blocked = armSensors(observation, plan);
  if (blocked) return { ...blocked, clause: 'E' };

  if (!PROPOSAL_ORIGIN_KINDS.has(plan.kind)) {
    return {
      clause: 'E',
      verdict: NOT_APPLICABLE,
      reason: `kind "${plan.kind}" carries no authored operations, so it has no proposal author to publish`,
    };
  }
  if (plan.proposalOrigin === 'authorless') {
    return {
      clause: 'E',
      verdict: NOT_APPLICABLE,
      reason: [
        `the census reviews ${plan.key} as authorless (a person or a local generator wrote`,
        'these operations, so neither free_route nor deterministic_fallback is true of them);',
        'nothing about authorship was examined here',
      ].join(' '),
    };
  }

  const value = observation.attributes?.[PROPOSAL_ORIGIN_ATTRIBUTE];
  if (value === undefined) {
    return {
      clause: 'E',
      verdict: FAIL,
      reason: [
        `runtime attribute loss: the census enumerates ${plan.key} as a proposal surface that`,
        `publishes ${PROPOSAL_ORIGIN_ATTRIBUTE}, and the rendered DOM does not carry it. Whoever`,
        'reads this page can see that a decision is outstanding and cannot see who authored the',
        'thing being decided on.',
      ].join(' '),
      observed: { attributes: Object.keys(observation.attributes ?? {}) },
    };
  }
  // Named on its own because it is the specific failure this attribute exists to prevent: a
  // stringified missing value is a hole wearing the costume of an answer.
  if (value === 'undefined' || value === 'null' || value.trim() === '') {
    return {
      clause: 'E',
      verdict: FAIL,
      reason: [
        `${PROPOSAL_ORIGIN_ATTRIBUTE}="${value}" is a stringified absence, not an authorship`,
        'claim. An absent attribute is a hole a gate can see; this one reads as an answer and',
        'is worse than absent.',
      ].join(' '),
      observed: { value },
    };
  }
  if (!PROPOSAL_ORIGIN_VALUES.has(value)) {
    return {
      clause: 'E',
      verdict: FAIL,
      reason: `${PROPOSAL_ORIGIN_ATTRIBUTE}="${value}" is outside the declared vocabulary (${[...PROPOSAL_ORIGIN_VALUES].join('|')}); a reader learns nothing from a value nobody declared`,
      observed: { value },
    };
  }
  return {
    clause: 'E',
    verdict: PASS,
    reason: `authorship published as ${PROPOSAL_ORIGIN_ATTRIBUTE}="${value}" alongside ${plan.stateAttribute}="${observation.attributes[plan.stateAttribute]}"`,
    observed: { value },
  };
}

/** All five clauses for one surface. */
export function evaluateSurface({ plan, normal, reduced, motionAfter = null }) {
  return {
    A_noAnimationOnDecisionAffordance: clauseAnimations(normal, plan),
    B_noSuccessTokenOnPending: clauseSuccessToken(normal, plan),
    C_declaredStateMatchesRendered: clauseStateAgreement(normal, plan),
    D_reducedMotionCollapsesToFinalState: clauseReducedMotion(normal, reduced, plan, motionAfter),
    E_proposalPublishesItsAuthor: clauseProposalOrigin(normal, plan),
  };
}

/** A run is red iff some clause is `failed`. `not-run` never turns a run red — it is the point. */
export function summarize(surfaces) {
  const tally = { passed: 0, failed: 0, 'not-run': 0, 'not-applicable': 0 };
  const failures = [];
  for (const surface of surfaces) {
    for (const [clause, verdict] of Object.entries(surface.clauses)) {
      tally[verdict.verdict] = (tally[verdict.verdict] ?? 0) + 1;
      if (verdict.verdict === FAIL) {
        failures.push(`${surface.selector} ${clause}: ${verdict.reason}`);
      }
    }
  }
  return { tally, failures, red: failures.length > 0 };
}

/* ------------------------------------------------------------------------ page driving */

const STAGES = [
  'landing',
  'sample-deck',
  'element-selected',
  'ai-tab',
  'openui-workbench',
  'json-tab',
  'compare-mode',
  'publish-dialog',
];

const softClick = async (page, selector, timeout = 12_000) => {
  const locator = page.locator(selector).first();
  try {
    await locator.waitFor({ state: 'visible', timeout });
    await locator.click({ timeout });
    return true;
  } catch {
    return false;
  }
};

/**
 * Drive as far into the product as a probe can go without spending a model call, harvesting
 * every enumerated surface the moment it appears. Each stage records whether it succeeded,
 * so a surface that was never seen can say WHICH stage failed rather than "not found".
 */
export async function driveAndHarvest(page, { baseUrl, selectors, knockout }) {
  const stages = [];
  const seen = {};

  /*
   * Observe the SAME page twice: once with motion allowed, once with
   * `prefers-reduced-motion: reduce` emulated in place.
   *
   * The first version of this probe used two independent browser contexts and two page
   * loads. That made clause D a race: the deck CI readout finished loading in one run and
   * not in the other, and the probe reported `data-state="pass"` vs `"loading"` as a
   * reduced-motion violation — a real difference between two moments in time, dressed up as
   * a difference between two designs. Emulating the media feature on a live page holds the
   * application state fixed so the ONLY variable is the preference, which is the comparison
   * "collapses to the final state, never to a second design" actually asks for.
   */
  // The knockout's DOM half is re-applied before every observation: React owns these
  // attributes and re-renders them back the moment anything upstream changes, so an
  // injection applied once would silently evaporate and the knockout would "prove" the
  // probe cannot detect a violation it was never actually shown.
  const applyMutation = async () => {
    if (knockout?.mutate) await page.evaluate(knockout.mutate).catch(() => {});
  };

  const record = async (stage) => {
    await applyMutation();
    const before = await page.evaluate(observeSurfacesInPage, selectors);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(250);
    await applyMutation();
    const reduced = await page.evaluate(observeSurfacesInPage, selectors);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForTimeout(250);
    await applyMutation();
    // The CLOSING half of the bracket. Emulating the preference in place removed the
    // two-page-load race, but not the one inside a single page: the deck CI readout resolved
    // from `loading` to `pass` DURING the 250ms window, and the probe read a surface that had
    // simply finished loading as a surface that renders a second design under reduce. A
    // second motion-allowed observation after the window turns that into something the probe
    // can detect: if the state moved between the two brackets, the comparison is unsound and
    // clause D is not-run — a race reported as a violation is a false accusation, and a gate
    // that makes them stops being read.
    const after = await page.evaluate(observeSurfacesInPage, selectors);
    for (const [selector, value] of Object.entries(before)) {
      // First sighting wins, EXCEPT that a visible sighting always beats a hidden one. The
      // OpenUI workbench is lazy-imported: it is still resolving its Suspense boundary while
      // its own stage runs, then turns up in the DOM one stage later with the AI tab no
      // longer on screen — present, but with no client rects, so every computed value read
      // off it would be meaningless. Grading the hidden copy would have been a verdict about
      // a surface nobody can see.
      const better =
        !seen[selector] || (seen[selector].motion.visible !== true && value.visible === true);
      if (value.present && better) {
        seen[selector] = {
          stage,
          motion: value,
          reduced: reduced[selector] ?? { present: false },
          motionAfter: after[selector] ?? { present: false },
        };
      }
    }
  };
  const stage = async (name, fn) => {
    try {
      const ok = await fn();
      stages.push({ stage: name, reached: ok !== false });
      await record(name);
      return ok !== false;
    } catch (error) {
      stages.push({ stage: name, reached: false, error: String(error).slice(0, 300) });
      return false;
    }
  };

  await stage('landing', async () => {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
      window.history.replaceState(null, '', window.location.pathname);
    });
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page
      .locator('[data-testid="nodeslide-landing"]')
      .waitFor({ state: 'visible', timeout: 60_000 });
    return true;
  });

  const buildSha = await page
    .evaluate(
      () =>
        document.querySelector('meta[name="nodeslide-build-sha"]')?.getAttribute('content') ?? null,
    )
    .catch(() => null);

  const deckOpened = await stage('sample-deck', async () => {
    const sample = page.getByRole('button', { name: 'Explore the editable sample workspace' });
    await sample.waitFor({ state: 'visible', timeout: 30_000 });
    await sample.click();
    await page.locator('[data-testid="deck-title"]').waitFor({ state: 'visible', timeout: 90_000 });
    return true;
  });

  if (deckOpened) {
    // The knockout is injected AFTER the deck is open so it lands on the real stylesheet
    // cascade, not on the landing page. See `--knockout` in the CLI: this is how the probe
    // proves it can go red.
    if (knockout?.css) {
      await page.addStyleTag({ content: knockout.css });
    }

    // Selection by focus + Enter, and VERIFIED by aria-pressed, rather than by a bare click.
    // A click on a canvas element does not necessarily commit a selection, and an unverified
    // selection would make the JSON element editor report not-run for a reason that is simply
    // untrue — the surface would be one keystroke away, and the receipt would say it needed a
    // precondition it already had. This mirrors the benchmark producer's proven path.
    await stage('element-selected', async () => {
      // Scoped to the EDIT CANVAS. An unscoped `slide-element-*` also matches the read-only
      // renders in the thumbnail rail — plain divs with no role, no tabindex and no
      // aria-pressed. Focusing one of those and pressing Enter selects nothing, and the
      // verification below duly refused to claim it had: the first run of this stage reported
      // BLOCKED and the JSON editor stayed not-run, which is the sensor working.
      const element = page
        .locator('[data-testid="editor-edit-canvas"] [data-testid^="slide-element-"]')
        .first();
      await element.waitFor({ state: 'visible', timeout: 30_000 });
      await element.focus();
      await element.press('Enter');
      return (await element.getAttribute('aria-pressed')) === 'true';
    });
    await stage('ai-tab', () => softClick(page, '[data-testid="inspector-tab-ai"]'));
    await stage('openui-workbench', async () => {
      if (!(await softClick(page, '[data-testid="ai-open-material-workbench"]'))) return false;
      // Lazy import behind Suspense. Waiting for the surface itself, not for the click, is
      // what makes this stage's success mean "the surface is on screen".
      try {
        await page
          .locator('[data-testid="openui-visual-workbench"]')
          .waitFor({ state: 'visible', timeout: 20_000 });
      } catch {
        return false;
      }
      return true;
    });
    await stage('json-tab', async () => {
      const opened = await softClick(page, '[data-testid="inspector-tab-json"]');
      if (!opened) return false;
      await page.waitForTimeout(600);
      // The element editor mounts only in `selection` view with exactly one element picked
      // (JsonInspector: `mode === 'selection' && onProposePatch !== undefined && selectedOne`).
      // The Deck view is the default, so without this chip the surface is never rendered and
      // the probe would report not-run for a reason that is one click away from being wrong.
      const selection = page.getByRole('tab', { name: 'Selection', exact: true }).first();
      try {
        await selection.click({ timeout: 8_000 });
        await page.waitForTimeout(500);
      } catch {
        return false;
      }
      return true;
    });
    await stage('compare-mode', async () => {
      const tab = page.getByRole('tab', { name: 'Compare', exact: true }).first();
      try {
        await tab.click({ timeout: 8_000 });
        await page.waitForTimeout(800);
      } catch {
        return false;
      }
      return true;
    });
    await stage('publish-dialog', async () => {
      const opened = await softClick(page, '[data-testid="share"]');
      if (!opened) return false;
      await page.waitForTimeout(800);
      return true;
    });
  } else {
    for (const name of STAGES.slice(2))
      stages.push({ stage: name, reached: false, error: 'deck never opened' });
  }

  return { stages, seen, buildSha };
}

/* ------------------------------------------------------------------------- the probe run */

export async function runTrustSurfaceProbe({
  browser,
  baseUrl = DEFAULT_BASE_URL,
  knockout = null,
  censusOptions = {},
}) {
  const census = await collectTrustSurfaceCensus(censusOptions);
  const { planned, unplanned, stalePlan } = planForCensus(census.annotated);

  // Every selector the plan knows about, including the secondary tags a component owns.
  const selectors = planned.flatMap((entry) => [entry.selector, ...(entry.alsoSelectors ?? [])]);

  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  let pass;
  try {
    pass = await driveAndHarvest(page, { baseUrl, selectors, knockout });
  } finally {
    await context.close();
  }

  const surfaces = [];
  for (const entry of planned) {
    for (const selector of [entry.selector, ...(entry.alsoSelectors ?? [])]) {
      const plan = { ...entry, selector };
      const harvested = pass.seen[selector];
      const normal = harvested?.motion ?? { present: false };
      const reduced = harvested?.reduced ?? { present: false };
      surfaces.push({
        key: entry.key,
        selector,
        kind: entry.kind,
        requires: entry.requires,
        reached: normal.present === true,
        reachedAtStage: harvested?.stage ?? null,
        declaredState: normal.attributes?.[entry.stateAttribute] ?? null,
        clauses: evaluateSurface({
          plan,
          normal,
          reduced,
          motionAfter: harvested?.motionAfter ?? null,
        }),
      });
    }
  }

  // An enumerated surface with no reach plan is not-run BY NAME. Silence here would be the
  // exact failure the census was built to end, reintroduced one layer up.
  for (const entry of unplanned) {
    surfaces.push({
      key: entry.key,
      selector: null,
      kind: entry.census[0]?.kind ?? null,
      requires: 'no reach plan entry exists for this surface',
      reached: false,
      reachedAtStage: null,
      declaredState: null,
      clauses: Object.fromEntries(
        [
          'A_noAnimationOnDecisionAffordance',
          'B_noSuccessTokenOnPending',
          'C_declaredStateMatchesRendered',
          'D_reducedMotionCollapsesToFinalState',
          'E_proposalPublishesItsAuthor',
        ].map((clause) => [
          clause,
          {
            verdict: NOT_RUN,
            reason: `the census enumerates ${entry.key} but REACH_PLAN has no entry for it; add one (with its precondition) to make this clause runnable`,
          },
        ]),
      ),
    });
  }

  const summary = summarize(surfaces);
  return {
    schema: 'nodeslide.trust-surface-runtime-probe/v1',
    generatedAt: new Date().toISOString(),
    baseUrl,
    buildSha: pass.buildSha,
    knockout: knockout ? { injected: true, css: knockout } : { injected: false },
    censusSurfaces: census.annotated.length,
    stalePlan,
    stages: pass.stages,
    surfaces,
    summary,
    // A stale plan entry is a hole with a story attached — the same reasoning the census
    // applies to its allowlist. It turns the run red on its own.
    red: summary.red || stalePlan.length > 0,
    scope:
      'Web surfaces only. This probe observes a browser; it proves nothing about whether a PPTX export carries an active timing structure.',
  };
}

/* --------------------------------------------------------------------------------- CLI */

/**
 * THE KNOCKOUT. A check that has never been red is not a check.
 *
 * Targets the OpenUI visual workbench because every clause currently passes or is
 * not-applicable on it, so a flip is unambiguous — knocking out a surface that is already
 * failing proves nothing.
 *
 * Two halves, because the four clauses need two different lies:
 *  - CSS gives it a transition, an infinite animation, and the success colour.
 *  - the DOM mutation relabels it `data-decision="undecided"`, which is the ONLY way to
 *    exercise clause B on this deployment: no reachable surface is naturally pending, so
 *    without the relabel the pending-paint clause would report not-applicable and its
 *    machinery would go untested. Making the page lie on purpose is how the sensor gets
 *    armed against a state production will not hand over for free.
 */
export const KNOCKOUT_TARGET = '[data-testid="openui-visual-workbench"]';

const KNOCKOUT = {
  css: `
@keyframes ns-knockout-pulse { from { opacity: 1 } to { opacity: 0.55 } }
${KNOCKOUT_TARGET} {
  transition: background-color 400ms ease, color 400ms ease !important;
  animation: ns-knockout-pulse 900ms ease-in-out infinite !important;
  color: var(--ns-positive) !important;
}
`,
  mutate: `(() => {
    const el = document.querySelector('${KNOCKOUT_TARGET}');
    if (el) el.setAttribute('data-decision', 'undecided');
    return Boolean(el);
  })()`,
};

/**
 * THE SECOND KNOCKOUT — the one that guards the narrowing itself.
 *
 * `KNOCKOUT` above proves the probe can still see motion at all. It does NOT prove the
 * narrowed clause A can still tell a deception from an affordance, because it fails clause A
 * on an infinite keyframe animation, which the narrowing never touched.
 *
 * This one is aimed at the exact surface the narrowing cleared, and it changes exactly one
 * thing: the hover endpoint of the UNGRANTED consent toggle becomes the granted fill. Nothing
 * else moves — same duration, same property, same element, same declared state. The only
 * difference between the production styling (which now passes) and this (which must fail) is
 * the DIRECTION the colour travels. If clause A cannot separate those two, the narrowing was
 * an allowlist wearing a lab coat and this run says so.
 */
export const DIRECTIONAL_KNOCKOUT_TARGET = '[data-testid="ai-web-research-toggle"]';

const DIRECTIONAL_KNOCKOUT = {
  css: `
${DIRECTIONAL_KNOCKOUT_TARGET}:hover {
  background-color: var(--primary) !important;
}
`,
};

function parseArgs(argv) {
  const args = {
    baseUrl: process.env['NODESLIDE_PROBE_BASE_URL'] ?? DEFAULT_BASE_URL,
    out: DEFAULT_RECEIPT,
    selftest: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--base-url') args.baseUrl = argv[++i] ?? args.baseUrl;
    else if (arg === '--out') args.out = argv[++i] ?? args.out;
    else if (arg === '--selftest') args.selftest = true;
  }
  return args;
}

const printReport = (report) => {
  console.log(`\n=== TRUST-SURFACE RUNTIME PROBE — ${report.baseUrl} ===`);
  console.log(`build sha: ${report.buildSha ?? '(not published by the deployed build)'}`);
  console.log(`census surfaces: ${report.censusSurfaces}   probe rows: ${report.surfaces.length}`);
  if (report.knockout.injected)
    console.log('KNOCKOUT CSS INJECTED — this run is expected to be RED');
  console.log('\n--- reach stages (each harvested with motion allowed, then under reduce) ---');
  for (const stage of report.stages) {
    console.log(
      `  ${stage.reached ? 'reached ' : 'BLOCKED '} ${stage.stage}${stage.error ? ` — ${stage.error}` : ''}`,
    );
  }
  console.log('\n--- per surface ---');
  for (const surface of report.surfaces) {
    console.log(
      `\n  ${surface.reached ? 'REACHED ' : 'NOT-RUN '} ${surface.kind ?? '?'} ${surface.selector ?? surface.key}${
        surface.reached ? ` @${surface.reachedAtStage} state="${surface.declaredState}"` : ''
      }`,
    );
    if (!surface.reached) console.log(`      requires: ${surface.requires}`);
    for (const [clause, verdict] of Object.entries(surface.clauses)) {
      console.log(
        `      [${verdict.verdict.toUpperCase()}] ${clause}\n          ${verdict.reason}`,
      );
    }
  }
  console.log('\n--- summary ---');
  console.log(`  ${JSON.stringify(report.summary.tally)}`);
  for (const failure of report.summary.failures) console.log(`  FAIL ${failure}`);
  if (report.stalePlan.length)
    console.log(`  FAIL stale REACH_PLAN entries: ${report.stalePlan.join(', ')}`);
};

/* c8 ignore start -- CLI entry point; the logic above is what the test suite drives */
if (process.argv[1]?.endsWith('nodeslide-trust-surface-runtime-probe.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  const { chromium } = await import('playwright');
  const browser = await chromium.launch();
  try {
    if (args.selftest) {
      /*
       * Runs the probe twice against the same deployment, clean then poisoned, and compares.
       *
       * The proof is the DELTA, not the absolute verdict. Requiring "clean is green" would
       * have been the obvious formulation and it is the wrong one: this deployment already
       * carries a real clause-A violation, so a green-clean precondition would fail for a
       * reason that has nothing to do with whether the probe can detect anything. What must
       * be true is that the poisoned run produces failures the clean run did not, on the
       * injected surface, on the clauses that were passing before.
       */
      const clean = await runTrustSurfaceProbe({ browser, baseUrl: args.baseUrl });
      const poisoned = await runTrustSurfaceProbe({
        browser,
        baseUrl: args.baseUrl,
        knockout: KNOCKOUT,
      });
      printReport(poisoned);

      const cleanRow = clean.surfaces.find((s) => s.selector === KNOCKOUT_TARGET);
      const poisonedRow = poisoned.surfaces.find((s) => s.selector === KNOCKOUT_TARGET);
      const flipped = [];
      for (const clause of Object.keys(cleanRow?.clauses ?? {})) {
        const before = cleanRow.clauses[clause].verdict;
        const after = poisonedRow?.clauses?.[clause]?.verdict;
        if (before !== 'failed' && after === 'failed') {
          flipped.push({ clause, before, after, reason: poisonedRow.clauses[clause].reason });
        }
      }
      // The surface must have been REACHED in both runs, or the "flip" is just a surface
      // that stopped rendering. Arm the sensor before trusting its red, exactly as the
      // clauses themselves do.
      const reachedBoth = cleanRow?.reached === true && poisonedRow?.reached === true;

      /*
       * The narrowing's own knockout. Clause A on the CONSENT toggle must be `passed` clean —
       * that is the whole verdict this change rests on — and must flip to `failed` when the
       * one thing that changes is the direction its hover colour travels.
       */
      const directional = await runTrustSurfaceProbe({
        browser,
        baseUrl: args.baseUrl,
        knockout: DIRECTIONAL_KNOCKOUT,
      });
      const consentClean = clean.surfaces.find((s) => s.selector === DIRECTIONAL_KNOCKOUT_TARGET)
        ?.clauses?.A_noAnimationOnDecisionAffordance;
      const consentPoisoned = directional.surfaces.find(
        (s) => s.selector === DIRECTIONAL_KNOCKOUT_TARGET,
      )?.clauses?.A_noAnimationOnDecisionAffordance;
      const directionProved =
        consentClean?.verdict === 'passed' && consentPoisoned?.verdict === 'failed';

      const ok = reachedBoth && flipped.length >= 3 && directionProved;

      console.log('\n=== KNOCKOUT SELFTEST ===');
      console.log(`  target: ${KNOCKOUT_TARGET}`);
      console.log(`  reached in both runs? ${reachedBoth}`);
      console.log(`  clauses that flipped to FAILED under the knockout: ${flipped.length}`);
      for (const entry of flipped) {
        console.log(
          `    ${entry.clause}: ${entry.before} -> ${entry.after}\n        ${entry.reason}`,
        );
      }
      console.log('\n=== DIRECTIONAL KNOCKOUT (guards the clause-A narrowing) ===');
      console.log(`  target: ${DIRECTIONAL_KNOCKOUT_TARGET}`);
      console.log(`  clause A clean    : ${consentClean?.verdict}`);
      console.log(`  clause A poisoned : ${consentPoisoned?.verdict}`);
      console.log(`  ${consentPoisoned?.reason ?? '(no reason)'}`);
      console.log(`  DIRECTION PROVED: ${directionProved}`);
      await fs.mkdir(path.join(root, path.dirname(args.out)), { recursive: true });
      await fs.writeFile(
        path.join(root, args.out.replace(/\.json$/, '.knockout.json')),
        `${JSON.stringify(
          {
            schema: 'nodeslide.trust-surface-runtime-probe.knockout/v1',
            generatedAt: new Date().toISOString(),
            baseUrl: args.baseUrl,
            buildSha: clean.buildSha,
            target: KNOCKOUT_TARGET,
            reachedBoth,
            flipped,
            knockoutProved: ok,
            cleanRow,
            poisonedRow,
            directionalKnockout: {
              target: DIRECTIONAL_KNOCKOUT_TARGET,
              css: DIRECTIONAL_KNOCKOUT.css,
              clean: consentClean,
              poisoned: consentPoisoned,
              directionProved,
            },
          },
          null,
          2,
        )}\n`,
      );
      console.log(ok ? '  KNOCKOUT PROVED' : '  KNOCKOUT NOT PROVED');
      process.exit(ok ? 0 : 1);
    }

    const report = await runTrustSurfaceProbe({ browser, baseUrl: args.baseUrl });
    printReport(report);
    await fs.mkdir(path.join(root, path.dirname(args.out)), { recursive: true });
    await fs.writeFile(path.join(root, args.out), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nreceipt: ${args.out}`);
    process.exit(report.red ? 1 : 0);
  } finally {
    await browser.close();
  }
}
/* c8 ignore stop */

export { KNOCKOUT };
