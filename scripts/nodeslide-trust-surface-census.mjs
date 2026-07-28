#!/usr/bin/env node
/**
 * NodeSlide trust-surface census.
 *
 * Companion module to `nodeslide-agent-ui-linter.mjs`, which imports and merges these
 * checks into its own list so there is exactly ONE agent-UI gate. Running this file
 * directly prints the long-form census (annotated surfaces, allowlist, not-run findings);
 * the linter prints the same checks in its PASS/FAIL form.
 *
 * WHY THIS EXISTS
 * The trust-surfaces rule ("a surface where a human or an agent decides whether to
 * believe something must be inspectable, and must not be styled to imply an outcome")
 * was satisfied per-component by hand. A hand list cannot report `not-run`: it silently
 * omits the surface nobody remembered, and an omission is indistinguishable from a pass.
 * So the census is DERIVED TWICE and the two derivations must agree:
 *
 *   (a) SWEEP     — grep the source for decision-carrying patterns (Accept/Reject labels,
 *                   decision handler invocations, data-decision, data-agent-web-consent).
 *   (b) ANNOTATED — collect every `data-trust-surface="<kind>"` the components declare.
 *
 * A component the sweep finds that carries no annotation is `not-run`: not passed, not
 * failed-by-styling — simply never examined by the gate. It is reported by file and line
 * and it exits nonzero, unless it appears in REVIEWED_NON_SURFACES with a reason. An
 * allowlist entry that matches nothing ALSO fails, so a stale exemption cannot quietly
 * absorb a future finding (same convention as parity's STAYS / NOT_EQUIVALENT tables).
 *
 * WHAT THIS IS NOT
 * This is a SOURCE-STATIC gate. It reads .tsx and .css text. It does not compute styles,
 * does not resolve the cascade, and does not look at a rendered page. Clauses that need a
 * browser are reported `not-run` with the command that would run them — never `passed`.
 * See clauseRunMode() at the bottom for the per-clause declaration that gets printed.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');

/** Trust-surface kinds, from the trust-surfaces skill. An unknown kind fails the gate. */
const SURFACE_KINDS = new Set([
  'proposal',
  'conflict',
  'failed-state',
  'diff-review',
  'consent',
  'permission',
]);

/**
 * The attribute each kind must publish, and the values that attribute may carry.
 * Presence is asserted first and separately from value: the `data-agent-web-consent`
 * regression was a surface that kept working perfectly while its posture became
 * invisible, so "the attribute exists at all" is its own assertion.
 */
const KIND_CONTRACT = {
  proposal: { attribute: 'data-decision' },
  conflict: { attribute: 'data-decision' },
  'diff-review': { attribute: 'data-decision' },
  'failed-state': { attribute: 'data-state' },
  consent: { attribute: 'data-agent-web-consent' },
  // A permission surface (sign-off, grant, revoke) carries a grant DECISION, so it publishes
  // `data-decision`, not the web-egress consent posture. Two different questions: `consent`
  // answers "how was this authorized", `permission` answers "has it been granted yet".
  permission: { attribute: 'data-decision' },
};

/**
 * Literal `data-decision` values the gate accepts. `none` means "this surface carries no
 * decision right now"; it is NOT a synonym for accepted. Anything else is a typo or an
 * invented state and fails, because an agent reading an unknown value learns nothing.
 */
const DECISION_VALUES = new Set(['undecided', 'accepted', 'rejected', 'failed', 'none']);

/* ------------------------------------------------------------------ sweep patterns */

/**
 * A decision verb standing alone as JSX text — the label on the control that commits the
 * decision. Bounded on both sides so prose ("Accepted edits will appear here", "Rejected
 * substitutes") does not match: those are descriptions of a decision, not affordances.
 */
const DECISION_LABEL =
  /(?:^|>)\s*\{?\s*\b(Accept|Reject|Decline|Approve|Deny|Grant|Revoke)\b\s*\}?\s*(?:<|$)/;

/**
 * The decision verbs a handler prop is built from. Matched with an open suffix
 * (`onAcceptPatch`, `onAcceptVariation`, `onDeclineCandidate`, `onProposeJsonPatch`, …)
 * because a fixed list of exact names is the hand-maintained census this gate replaces:
 * the next feature invents `onApproveExport` and a name-list sweep goes quietly blind.
 */
const DECISION_VERB = '(?:Accept|Reject|Decline|Approve|Deny|Propose|Grant|Revoke)';

/** A decision handler being INVOKED (not merely forwarded as a prop by a parent). */
// `?.(` is included: the publication sign-off calls `onApproveWithToken?.(token, version)`,
// and an optional-call sweep that misses optional chaining misses the whole ceremony.
const DECISION_HANDLER = new RegExp(
  `\\bon${DECISION_VERB}[A-Za-z]*(\\?\\.)?\\s*\\(|onClick=\\{on${DECISION_VERB}[A-Za-z]*\\}`,
);

/** Attributes that by their existence declare a decision or consent posture. */
const DECISION_ATTRIBUTE = /data-decision[=\s]|data-agent-web-consent[=\s]/;

/**
 * A decision handler passed DOWN as a JSX prop. Deliberately included even though most hits
 * are plumbing: the question "does this component render the affordance, or only route it?"
 * is exactly the judgement the allowlist exists to record. Sweeping only the components that
 * invoke a handler would mean a host that grows its own inline Accept button never lights up
 * until someone remembers to look.
 */
// `={` only. The `: (` form is a TypeScript prop-type declaration — a description of a
// callback's shape, not a rendered affordance — and sweeping it flagged every props
// interface in the tree, which is noise that would have to be allowlisted to nothing.
const DECISION_PLUMBING = new RegExp(`\\bon${DECISION_VERB}[A-Za-z]*=\\{`);

const SWEEP_SIGNALS = [
  ['decision-label', DECISION_LABEL],
  ['decision-handler', DECISION_HANDLER],
  ['decision-attribute', DECISION_ATTRIBUTE],
  ['decision-plumbing', DECISION_PLUMBING],
];

/* ------------------------------------------------------------- styling vocabularies */

/** Tokens that mean "this succeeded". Painting one on a pending thing is clause-2's bug. */
const SUCCESS_TOKENS = ['--ns-positive', '--ns-success', '--ns-good'];

/** Class tokens that mean success in JSX className strings. */
const SUCCESS_CLASSES = [
  'is-valid',
  'is-positive',
  'is-accepted',
  'is-success',
  'is-pass',
  'text-success',
  'bg-success',
];

/**
 * CSS selector fragments that name a NOT-YET-DECIDED state. A rule matching one of these
 * may not resolve to a success token: "Ready to review" is the state of a thing awaiting a
 * human, and it wore the same green as "Accepted" until this check was written.
 */
const PENDING_SELECTOR_MARKERS = [
  '[data-decision="undecided"]',
  '[data-decision="pending"]',
  '.is-ready',
  '--ready',
  '.is-pending',
  '.is-proposed',
  '.is-undecided',
  '.is-validating',
  '.is-checking',
];

/** Motion declarations forbidden on a decision affordance (motion-ladder, inherited whole). */
const MOTION_DECLARATION =
  /(^|[\s;{])(transition|transition-[a-z-]+|animation|animation-[a-z-]+)\s*:/;

/** Tailwind motion utilities, for surfaces styled by class rather than by stylesheet. */
const MOTION_UTILITY = /\b(transition(-[a-z]+)?|animate-[a-z-]+|duration-\d+)\b/;

/* ------------------------------------------------------------------- the allowlist */

/**
 * Surfaces the sweep flags that were examined and judged NOT trust-carrying.
 * Every entry needs a reason a reader can check. An entry whose file+component the sweep
 * does not currently flag FAILS the run — a stale exemption is how a real finding hides.
 */
const REVIEWED_NON_SURFACES = [
  {
    file: 'src/domains/nodeslide/components/EditorCanvasModes.tsx',
    component: 'EditorCanvasModes',
    reason:
      'Canvas mode shell. Lines 407 and 436 hand onAcceptCandidate/onDeclineCandidate to CandidateReceipt, which is enumerated as the diff-review surface and renders the actual buttons. The shell chooses a layout; it never asks anyone to decide.',
  },
  {
    file: 'src/domains/nodeslide/inspector/AgentThread.tsx',
    component: 'AgentThread',
    reason:
      'Turn list. Line 126 forwards onAcceptPatch/onRejectPatch to ThreadTurn, whose inline patch card is enumerated. The list itself renders no patch affordance.',
  },
  {
    file: 'src/domains/nodeslide/inspector/InspectorPanel.tsx',
    component: 'InspectorPanel',
    reason:
      'Tab router. Routes every decision callback in the app (patch, variation, JSON, OpenUI) to whichever inspector is mounted, and at line 591 wraps onProposeJsonPatch in the OpenUI adapter. All six signals are wiring; the affordances live in the enumerated children.',
  },
  {
    file: 'src/domains/nodeslide/inspector/JsonInspector.tsx',
    component: 'JsonInspector',
    reason:
      'JSON tab shell. Decides whether the element editor is mountable (line 364) and passes onProposePatch to it; ElementJsonEditor is the enumerated proposal surface. The shell renders view-mode chips, Copy and Download — none of which commit anything.',
  },
];

/* --------------------------------------------------------------------- file walking */

async function walk(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__snapshots__') continue;
      out.push(...(await walk(full)));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Split a module into its top-level declarations. This is the unit the gate binds an
 * annotation to: a signal inside `VariationCard` must be answered by an annotation inside
 * `VariationCard`, not by an unrelated annotation elsewhere in the same 2400-line file.
 * File-level matching would let AiInspector.tsx annotate one of its three surfaces and
 * silently drop the other two.
 */
function splitComponents(source) {
  const lines = source.split('\n');
  const starts = [];
  const declaration =
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|class)\s+([A-Za-z0-9_$]+)/;
  lines.forEach((line, index) => {
    const match = declaration.exec(line);
    if (match) starts.push({ name: match[1], line: index });
  });
  if (starts.length === 0 || starts[0].line > 0) {
    starts.unshift({ name: '<module>', line: 0 });
  }
  return starts.map((start, index) => ({
    name: start.name,
    startLine: start.line,
    endLine: index + 1 < starts.length ? starts[index + 1].line - 1 : lines.length - 1,
  }));
}

const componentAt = (components, lineIndex) =>
  components.find((c) => lineIndex >= c.startLine && lineIndex <= c.endLine) ?? {
    name: '<module>',
    startLine: 0,
    endLine: 0,
  };

/**
 * Recover the opening tag that carries an annotation, so the gate can read the sibling
 * attributes and the className off the same element rather than off the file.
 */
function openingTagAround(source, index) {
  let start = index;
  while (start > 0 && source[start] !== '<') start -= 1;
  let depthBrace = 0;
  let depthTemplate = 0;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '`') depthTemplate = depthTemplate === 0 ? 1 : 0;
    if (depthTemplate) continue;
    if (ch === '{') depthBrace += 1;
    else if (ch === '}') depthBrace -= 1;
    else if (ch === '>' && depthBrace === 0) return source.slice(start, i + 1);
  }
  return source.slice(start, Math.min(source.length, start + 4000));
}

/** Class tokens on the annotated element, static parts only (template holes are skipped). */
function classTokens(tagText) {
  const match = /className=(?:"([^"]*)"|\{([\s\S]*?)\}(?=\s|$))/.exec(tagText);
  if (!match) return [];
  const raw = match[1] ?? match[2] ?? '';
  return [...new Set(raw.match(/[a-z][a-z0-9-]{2,}/g) ?? [])];
}

/* ------------------------------------------------------------------------ the census */

/**
 * @param options.srcDir  tree to sweep. Overridable ONLY so the test suite can point the
 *   census at a fixture and prove each clause goes red on a deliberately broken surface —
 *   a check that has never been red is not a check, and a knockout run by hand once is a
 *   knockout the next reader has to take on faith. Production callers pass nothing.
 * @param options.relativeTo  base for the reported paths, so fixture output is readable.
 */
export async function collectTrustSurfaceCensus({ srcDir = SRC, relativeTo = root } = {}) {
  const rel = (absolute) => path.relative(relativeTo, absolute).split(path.sep).join('/');
  const files = (await walk(srcDir)).filter((f) => /\.(tsx|ts|css)$/.test(f));
  const tsxFiles = files.filter((f) => f.endsWith('.tsx') && !/\.test\.tsx$/.test(f));
  const cssFiles = files.filter((f) => f.endsWith('.css'));

  const annotated = [];
  const sweepHits = [];

  for (const file of tsxFiles) {
    const source = await fs.readFile(file, 'utf8');
    if (
      !/data-trust-surface|data-decision|data-agent-web-consent/.test(source) &&
      !DECISION_LABEL.test(source) &&
      !DECISION_HANDLER.test(source)
    ) {
      continue;
    }
    const lines = source.split('\n');
    const components = splitComponents(source);

    // (b) annotated set
    const annotationPattern = /data-trust-surface="([^"]*)"/g;
    for (const match of source.matchAll(annotationPattern)) {
      const lineIndex = source.slice(0, match.index).split('\n').length - 1;
      const tagText = openingTagAround(source, match.index);
      annotated.push({
        file: rel(file),
        line: lineIndex + 1,
        component: componentAt(components, lineIndex).name,
        kind: match[1],
        tagText,
        classes: classTokens(tagText),
      });
    }

    // (a) pattern sweep
    lines.forEach((line, index) => {
      for (const [signal, pattern] of SWEEP_SIGNALS) {
        if (!pattern.test(line)) continue;
        sweepHits.push({
          file: rel(file),
          line: index + 1,
          component: componentAt(components, index).name,
          signal,
          text: line.trim().slice(0, 120),
        });
      }
    });
  }

  const cssRules = [];
  for (const file of cssFiles) {
    const raw = await fs.readFile(file, 'utf8');
    // Blank comments out (newlines preserved so reported line numbers stay true). Without
    // this the selector captured for a failure message begins at the previous `}` and drags
    // the whole explanatory comment in front of the selector, which buries the name of the
    // surface the message exists to report.
    const source = raw.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ' '));
    const pattern = /([^{}]+)\{([^{}]*)\}/g;
    for (const match of source.matchAll(pattern)) {
      const selector = match[1].trim();
      if (!selector || selector.startsWith('@')) continue;
      // The capture starts at the previous rule's closing brace, so its own start offset is
      // the line of whatever came BEFORE this selector. Seek to where the selector text
      // actually begins, or the failure message sends the reader to the wrong rule — which
      // is worse than no line number, because it looks authoritative.
      const selectorStart = match.index + match[1].indexOf(selector.split('\n')[0]);
      cssRules.push({
        file: rel(file),
        line: source.slice(0, selectorStart).split('\n').length,
        selector,
        body: match[2],
      });
    }
  }

  // Group the sweep by component; that is the unit an annotation answers.
  const byComponent = new Map();
  for (const hit of sweepHits) {
    const key = `${hit.file}::${hit.component}`;
    if (!byComponent.has(key)) byComponent.set(key, { ...hit, hits: [] });
    byComponent.get(key).hits.push(hit);
  }
  const annotatedKeys = new Set(annotated.map((a) => `${a.file}::${a.component}`));
  const allowKeys = new Set(REVIEWED_NON_SURFACES.map((a) => `${a.file}::${a.component}`));

  const notRun = [...byComponent.values()].filter(
    (entry) =>
      !annotatedKeys.has(`${entry.file}::${entry.component}`) &&
      !allowKeys.has(`${entry.file}::${entry.component}`),
  );
  const staleAllowlist = REVIEWED_NON_SURFACES.filter(
    (entry) => !byComponent.has(`${entry.file}::${entry.component}`),
  );

  return { annotated, sweepHits, byComponent, notRun, staleAllowlist, cssRules };
}

/* ------------------------------------------------------------------------ the checks */

export async function trustSurfaceChecks() {
  const census = await collectTrustSurfaceCensus();
  const { annotated, notRun, staleAllowlist, cssRules, byComponent } = census;
  const checks = [];
  const add = (label, passed, detail) => checks.push([label, passed, detail]);

  /* --- CLAUSE 1: enumeration by annotation + sweep, agreeing ------------------- */

  // GATE. Went red on purpose during development with every annotation removed:
  // 8 components reported not-run by file and line.
  add(
    'trust-surfaces clause 1: every swept decision surface is enumerated (annotated or reviewed)',
    notRun.length === 0,
    notRun.length === 0
      ? `${byComponent.size} components swept, all enumerated`
      : `not-run: ${notRun.map((n) => `${n.file}:${n.line} ${n.component}`).join(', ')}`,
  );

  // GATE. An exemption that no longer matches anything is a hole with a story attached.
  add(
    'trust-surfaces clause 1: no stale entry in the reviewed-non-surface allowlist',
    staleAllowlist.length === 0,
    staleAllowlist.length === 0
      ? `${REVIEWED_NON_SURFACES.length} reviewed non-surfaces, all still matched by the sweep`
      : `stale: ${staleAllowlist.map((e) => `${e.file}::${e.component}`).join(', ')}`,
  );

  // GATE. A typo'd kind would otherwise annotate a surface into a contract that does not exist.
  const badKinds = annotated.filter((a) => !SURFACE_KINDS.has(a.kind));
  add(
    'trust-surfaces clause 1: every annotation declares a known surface kind',
    badKinds.length === 0,
    badKinds.length === 0
      ? `kinds in use: ${[...new Set(annotated.map((a) => a.kind))].sort().join(', ')}`
      : `unknown: ${badKinds.map((a) => `${a.file}:${a.line} "${a.kind}"`).join(', ')}`,
  );

  add(
    'trust-surfaces clause 1: at least one surface is enumerated (the census is not empty)',
    annotated.length > 0,
    `${annotated.length} annotated surfaces`,
  );

  /* --- CLAUSE 2: required attributes PRESENT, then valued --------------------- */

  // GATE. Presence, asserted by name. This is the data-agent-web-consent regression in
  // gate form: the surface kept working while the posture stopped being published.
  const missingAttribute = annotated.filter((a) => {
    const contract = KIND_CONTRACT[a.kind];
    return contract && !a.tagText.includes(contract.attribute);
  });
  add(
    'trust-surfaces clause 2: every surface publishes its kind-required attribute',
    missingAttribute.length === 0,
    missingAttribute.length === 0
      ? annotated
          .map((a) => `${a.component}(${a.kind}→${KIND_CONTRACT[a.kind]?.attribute ?? '—'})`)
          .join(' ')
      : `missing: ${missingAttribute
          .map((a) => `${a.file}:${a.line} ${a.component} needs ${KIND_CONTRACT[a.kind].attribute}`)
          .join(', ')}`,
  );

  // GATE. Value, checked only after presence. An unknown value teaches an agent nothing.
  const literalDecision = /data-decision="([^"{]*)"/g;
  const badValues = [];
  for (const surface of annotated) {
    for (const m of surface.tagText.matchAll(literalDecision)) {
      if (!DECISION_VALUES.has(m[1])) badValues.push(`${surface.file}:${surface.line} "${m[1]}"`);
    }
  }
  add(
    'trust-surfaces clause 2: literal data-decision values are from the declared vocabulary',
    badValues.length === 0,
    badValues.length === 0
      ? `vocabulary: ${[...DECISION_VALUES].join('|')}`
      : `unknown values: ${badValues.join(', ')}`,
  );

  /* --- CLAUSE 3: not styled to imply an outcome (static approximation) -------- */

  // GATE. Was red when written: `.ns-variation-card` carried
  // `transition: border-color 120ms ease, box-shadow 120ms ease` — motion on the card that
  // holds Accept/Reject. Derived, not listed: the class tokens come off the annotated tags.
  //
  // Scoped to the kinds that carry a decision. A `failed-state` surface is a readout, not an
  // affordance, and the motion rule that applies to it is a different one — "failure never
  // looks like loading" — so a loading pulse on a status line is legitimate there and is
  // policed by the dedicated failed-state tripwire below, not by this blanket ban.
  const decisionKinds = new Set(['proposal', 'conflict', 'diff-review', 'consent', 'permission']);
  const surfaceClasses = new Set(
    annotated
      .filter((a) => decisionKinds.has(a.kind))
      .flatMap((a) => a.classes)
      .filter((c) => c.startsWith('ns-')),
  );
  const motionOnSurface = cssRules.filter(
    (rule) =>
      MOTION_DECLARATION.test(rule.body) &&
      ([...surfaceClasses].some((cls) => rule.selector.includes(`.${cls}`)) ||
        rule.selector.includes('[data-decision')),
  );
  add(
    'trust-surfaces clause 3: no CSS transition/animation on an enumerated decision surface',
    motionOnSurface.length === 0,
    motionOnSurface.length === 0
      ? `${surfaceClasses.size} surface classes checked across ${cssRules.length} rules`
      : `motion: ${motionOnSurface.map((r) => `${r.file}:${r.line} ${r.selector}`).join(' | ')}`,
  );

  // GATE. Same rule for surfaces styled by utility class instead of by stylesheet —
  // the Tailwind-styled agent thread card would otherwise never be reached by the CSS scan.
  const motionInline = annotated.filter((a) => {
    const match = /className=(?:"([^"]*)"|\{`([^`]*)`\})/.exec(a.tagText);
    return match ? MOTION_UTILITY.test(match[1] ?? match[2] ?? '') : false;
  });
  add(
    'trust-surfaces clause 3: no motion utility class on an enumerated decision surface',
    motionInline.length === 0,
    motionInline.length === 0
      ? 'no transition-/animate-/duration- utility on any annotated tag'
      : `motion: ${motionInline.map((a) => `${a.file}:${a.line}`).join(', ')}`,
  );

  // GATE. Was red when written, twice: `.ns-status-dot--ready` and the `is-ready` candidate
  // receipt both resolved to `--ns-positive`, so a direction merely READY TO REVIEW wore the
  // exact green of one that had been ACCEPTED.
  const successOnPending = cssRules.filter(
    (rule) =>
      PENDING_SELECTOR_MARKERS.some((marker) => rule.selector.includes(marker)) &&
      SUCCESS_TOKENS.some((token) => rule.body.includes(token)),
  );
  add(
    'trust-surfaces clause 3: no success token on a CSS rule for a pending state',
    successOnPending.length === 0,
    successOnPending.length === 0
      ? `${PENDING_SELECTOR_MARKERS.length} pending markers checked across ${cssRules.length} rules`
      : `success-on-pending: ${successOnPending
          .map((r) => `${r.file}:${r.line} ${r.selector}`)
          .join(' | ')}`,
  );

  // TRIPWIRE — cannot fail today and is meant to stay that way. No annotated tag currently
  // carries both an undecided decision and a success class. Do not delete this as dead: it
  // is what stops the next redesign from re-adding the Accept-coloured pending card by hand.
  const successClassOnUndecided = annotated.filter(
    (a) =>
      /data-decision="undecided"/.test(a.tagText) &&
      SUCCESS_CLASSES.some((cls) => a.tagText.includes(cls)),
  );
  add(
    'trust-surfaces clause 3 [TRIPWIRE]: no success class on a tag declaring data-decision="undecided"',
    successClassOnUndecided.length === 0,
    successClassOnUndecided.length === 0
      ? `${SUCCESS_CLASSES.length} success classes checked on ${annotated.length} surfaces`
      : `success-on-undecided: ${successClassOnUndecided.map((a) => `${a.file}:${a.line}`).join(', ')}`,
  );

  // TRIPWIRE — "failure never looks like loading". No enumerated failed-state surface today
  // animates on its failed or unavailable state; this holds that line for the next one.
  const failedStateClasses = new Set(
    annotated
      .filter((a) => a.kind === 'failed-state')
      .flatMap((a) => a.classes)
      .filter((c) => c.startsWith('ns-')),
  );
  const spinningFailure = cssRules.filter(
    (rule) =>
      [...failedStateClasses].some((cls) => rule.selector.includes(`.${cls}`)) &&
      /\.is-(fail|failed|error|unavailable|invalid)/.test(rule.selector) &&
      MOTION_DECLARATION.test(rule.body),
  );
  add(
    'trust-surfaces clause 3 [TRIPWIRE]: no motion on the failed state of a failed-state surface',
    spinningFailure.length === 0,
    spinningFailure.length === 0
      ? `${failedStateClasses.size} failed-state classes checked`
      : `failure animates: ${spinningFailure.map((r) => `${r.file}:${r.line} ${r.selector}`).join(' | ')}`,
  );

  return { checks, census };
}

/**
 * Which clauses actually ran, and how. Printed by the linter so a green run never implies
 * more coverage than it has. Clause 4 and the cascade half of clause 3 need a real browser;
 * they report not-run rather than passed.
 */
const BROWSER_SPEC = 'tests/e2e/nodeslide-trust-surfaces.spec.ts';

export async function clauseRunMode() {
  /*
   * The command is PROBED, not asserted. Printing "run `npm run test:e2e`" when no such spec
   * exists would make a not-run look one command away from being run, which is its own quiet
   * lie — the same species as a success colour on a pending state. The message changes by
   * itself the day someone writes the file.
   */
  let specExists = false;
  try {
    await fs.access(path.join(root, BROWSER_SPEC));
    specExists = true;
  } catch {
    specExists = false;
  }
  const command = specExists
    ? `npx playwright test ${BROWSER_SPEC}`
    : `NO RUNNER YET — ${BROWSER_SPEC} does not exist; writing it is what would make this clause runnable`;

  return [
    [
      'clause 1 — enumeration by route + annotation',
      'STATIC',
      'source sweep vs annotated set, per component',
    ],
    [
      'clause 2 — required attributes present, then valued',
      'STATIC',
      'attributes read off the annotated opening tag',
    ],
    [
      'clause 3 — no motion on decision affordances',
      'STATIC',
      'CSS declarations + utility classes on surface classes',
    ],
    [
      'clause 3 — no success token on a pending element',
      'STATIC (explicit selectors only)',
      'a rule naming a pending state may not resolve to a success token',
    ],
    [
      'clause 3 — computed styles / cascade resolution',
      'NOT-RUN',
      `a base rule that paints success and is overridden per state cannot be resolved from source text; needs getComputedStyle on a rendered surface. ${command}`,
    ],
    [
      'clause 4 — screenshot-gate states match DOM-declared states',
      'NOT-RUN',
      `browser-only; needs a run that opens each enumerated surface, reads [data-trust-surface][data-decision] and diffs it against the frozen screenshot state. ${command}`,
    ],
  ];
}

/* -------------------------------------------------------------- standalone reporting */

// Long-form report only when this file IS the entry point. The linter imports the checks
// instead, so the two can never drift into being two gates with two verdicts.
if (process.argv[1]?.endsWith('nodeslide-trust-surface-census.mjs')) {
  const { checks, census } = await trustSurfaceChecks();
  console.log('=== ENUMERATED TRUST SURFACES ===');
  for (const surface of census.annotated) {
    console.log(
      `  ${surface.kind.padEnd(13)} ${surface.file}:${surface.line} ${surface.component}`,
    );
  }
  console.log('\n=== REVIEWED NON-SURFACES (allowlisted, with reason) ===');
  for (const entry of REVIEWED_NON_SURFACES) {
    console.log(`  ${entry.file} :: ${entry.component}\n      ${entry.reason}`);
  }
  console.log('\n=== NOT-RUN (swept, never enumerated) ===');
  if (census.notRun.length === 0) console.log('  (none)');
  for (const entry of census.notRun) {
    console.log(
      `  ${entry.file}:${entry.line} ${entry.component} — ${entry.hits.length} signal(s)`,
    );
  }
  console.log('\n=== CLAUSE RUN MODE ===');
  for (const [clause, mode, note] of await clauseRunMode()) {
    console.log(`  [${mode}] ${clause}\n      ${note}`);
  }
  console.log('\n=== CHECKS ===');
  for (const [label, passed, detail] of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'} ${label}\n      ${detail}`);
  }
  const failed = checks.filter(([, passed]) => !passed).length;
  console.log(`\nTrust-surface census: ${checks.length - failed}/${checks.length}`);
  if (failed > 0) process.exit(1);
}
