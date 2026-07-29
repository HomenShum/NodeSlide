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

/* -------------------------------------------------- authorship: who wrote the proposal */

/**
 * A proposal surface must publish WHO AUTHORED IT, not only whether it has been decided.
 *
 * `data-decision` says a decision is outstanding. It does not say whether accepting is safe,
 * and for an agent-authored change the fact that answers that is authorship: a plan the model
 * actually produced and a plan the deterministic fallback produced after the provider timed out
 * are different offers with identical-looking operations. Both surfaces DISCLOSED this already,
 * in visible copy that is correct and is not being changed — the variation card renders
 * "Deterministic fallback" plus a "Fallback reason:" line, the agent thread renders the
 * planner's own `Planner · deterministic fallback: …` step. Neither published an attribute, so
 * the disclosure was legible to a person and invisible to a reader.
 *
 * Presence is asserted separately from value, for the same reason clause 2 does it: the
 * `data-agent-web-consent` regression was a surface that kept working perfectly while its
 * posture stopped being published, and a value-only check passes when the attribute is gone.
 */
export const PROPOSAL_ORIGIN_ATTRIBUTE = 'data-proposal-origin';

/**
 * The kinds that present authored operations for accept/reject. `consent` answers how egress
 * was authorized and `failed-state` is a readout — neither carries somebody's draft — and
 * `permission` is a grant, where the question is who may act, not who wrote what.
 */
export const PROPOSAL_ORIGIN_KINDS = new Set(['proposal', 'diff-review']);

/**
 * Values the attribute may carry. `unattributed` is the honest answer for a record written
 * before authorship provenance existed; it is NOT a synonym for either real origin, and it is
 * emphatically not the same as the attribute being absent — see the vocabulary check below.
 */
export const PROPOSAL_ORIGIN_VALUES = new Set([
  'free_route',
  'deterministic_fallback',
  'unattributed',
]);

/**
 * The one function allowed to compute the value (`shared/nodeslideProposalOrigin.ts`).
 *
 * This is the "one writer per attribute" rule made checkable. The mapping function is the only
 * place that refuses a value outside the vocabulary, so a surface that computes its own — via
 * `String(patch.origin)`, a template literal, a `??` chain — routes around the one guard that
 * exists and can stamp the literal text "undefined" onto a trust surface. That is strictly
 * worse than an absent attribute: absent is a hole a gate can see, "undefined" is a hole
 * wearing the costume of an answer, and an agent that trusts it learns something false.
 */
export const PROPOSAL_ORIGIN_WRITER = 'nodeSlideProposalOriginAttribute';

/**
 * Surfaces that present a decision but have no authorship to publish, each with the reason.
 *
 * `unattributed` would be the wrong answer on both of these, and wrong in a specific way: it
 * means "this record predates authorship provenance and does not know". Here we DO know — a
 * person typed the JSON, a local generator built the spec — and answering "unknown" to a
 * question we can answer is its own small dishonesty. So they are exempted by name, with a
 * reason, and the staleness check below makes the exemption expire the moment it stops
 * describing something real.
 */
export const PROPOSAL_ORIGIN_AUTHORLESS = [
  {
    file: 'src/domains/nodeslide/inspector/JsonInspector.tsx',
    component: 'ElementJsonEditor',
    reason:
      'The operations are the text a person typed into the textarea on this very card. No planner ran, no provider was called, and there is no receipt to carry an origin — the author is the reviewer. `free_route` and `deterministic_fallback` both describe a machine that was never involved.',
  },
  {
    file: 'src/domains/nodeslide/openui/OpenUiMaterialWorkbench.tsx',
    component: 'OpenUiMaterialWorkbench',
    reason:
      'Deterministic OpenUI Phase 0. The material spec is built locally from axes the user set and never passes through the edit planner, so there is no route that could have failed and nothing to have fallen back from. The surface already carries `data-verification`, which is the provenance question that DOES apply to it.',
  },
];

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

/*
 * ---------------------------------------------------------------------------------------
 * THE THREE ROUTES A CSS-ONLY SCAN CANNOT SEE
 *
 * Clause 3 above reads stylesheets and className strings. Graded against the Motion
 * Deception Corpus, that catches an approval animation declared in CSS or as a utility
 * class — and nothing else. The same animation, on the same card, expressed any of the
 * three ways below sailed through a 35/35 green run. All three are plain source text; the
 * only reason they were invisible is that nobody looked at them.
 * ---------------------------------------------------------------------------------------
 */

/**
 * Motion in a React inline `style` prop. Matched on the CAMELCASE property names React
 * requires (`transitionProperty`), plus the shorthands, because `style={{ transition: ... }}`
 * and a stylesheet's `transition:` are the same instruction routed around the same check.
 */
const INLINE_STYLE_MOTION =
  /\b(transition|transitionProperty|transitionDuration|transitionDelay|transitionTimingFunction|animation|animationName|animationDuration|animationDelay|WebkitTransition|WebkitAnimation)\s*:/;

/**
 * Framer Motion's declarative props. `animate` and `whileHover` are the two that matter for
 * this rule — a card that animates toward an approval colour, or that grows under the cursor
 * as if inviting the click — but the whole family is matched because they compose: `initial`
 * plus `animate` IS the approach-to-approval, and neither half is motion on its own.
 *
 * `<motion.` is matched separately: a motion component with no props today is a motion
 * component someone adds `animate` to tomorrow, on a surface where that is forbidden.
 */
const FRAMER_MOTION_PROP =
  /\s(animate|initial|exit|whileHover|whileTap|whileFocus|whileInView|whileDrag|layoutId|drag)\s*=\s*[{"]|\slayout(\s|=|>)/;
const FRAMER_MOTION_TAG = /<(motion|m)\.[a-zA-Z]/;

/**
 * The Web Animations API, applied imperatively. Scoped to the component that owns the
 * annotated surface rather than to the tag, because the call site is an effect and the
 * target is a ref. Deliberately NOT scoped to a particular ref name: `cardRef.current.animate`,
 * `node.animate`, and `e.currentTarget.animate` are the same act, and a name list here is the
 * hand-maintained census this whole gate exists to replace.
 */
const WAAPI_ANIMATE = /\.animate\s*\(/;

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

/* ------------------------------------------------------ the motion deception corpus */

/**
 * THE MOTION DECEPTION CORPUS — seven ways motion lies while passing a naive motion check,
 * and this gate's HONEST verdict on each.
 *
 * Why this table is in the source and not in a document: a README saying "we catch 4 of 7"
 * drifts the moment someone adds a check, and drifts silently in the direction of claiming
 * more than is true. This table is READ BY THE GATE. It prints the coverage line from it,
 * and `corpusChecks()` fails the run if an entry carries no verdict, carries a verdict from
 * outside the vocabulary, or claims a detector whose check does not exist. Adding an eighth
 * fixture to the corpus therefore FORCES a verdict — a new entry with no `verdict` is a red
 * gate, the same shape as `not-run` beating `passed`.
 *
 * Every verdict below was produced by building the deception as a NodeSlide-shaped trust
 * surface (an annotated proposal card with Accept/Reject) and running these checks against
 * it. The fixture named by each entry is in scripts/tests/nodeslide-trust-surface-census.test.mjs
 * and asserts that verdict, so a `detected` that stops detecting turns the suite red.
 *
 * `verdict`   'detected'      this gate's static checks go red on the fixture.
 *             'not-detected'  this gate passes the fixture. The deception survives.
 * `mode`      'STATIC'        decided from source text.
 *             'NOT-RUN'       needs a rendered page; the probed command is printed with it.
 */
export const CORPUS_VERDICTS = new Set(['detected', 'not-detected']);
export const CORPUS_MODES = new Set(['STATIC', 'NOT-RUN']);

export const MOTION_DECEPTION_CORPUS = [
  {
    id: 1,
    deception: 'exists but never mounts',
    verdict: 'not-detected',
    mode: 'NOT-RUN',
    fixture: 'corpus 1 — annotated surface behind a false guard',
    why: 'The annotation is in the source, so the census enumerates the surface and every clause passes. Whether the element was ever put on the page is not a property of the text. A surface that never mounts is indistinguishable from a compliant one until something renders it.',
  },
  {
    id: 2,
    deception: 'animation targets an off-screen decoy',
    verdict: 'not-detected',
    mode: 'NOT-RUN',
    fixture: 'corpus 2 — motion on a decoy class, real surface untouched',
    why: 'Clause 3 derives the classes it polices off the annotated tags, so a sibling element that is not annotated is never checked — which is correct for a real sibling and useless against a deliberate clone. A decoy sharing a class PREFIX with a real surface (.ns-ship-card-ghost vs .ns-ship-card) trips the selector substring match by accident, so the catch cannot be relied on: rename the decoy and it is gone. Deciding what is a decoy needs geometry — same rendered box, different element.',
  },
  {
    id: 3,
    deception: 'screenshots differ only because of a clock',
    verdict: 'not-detected',
    mode: 'NOT-RUN',
    fixture: 'corpus 3 — live timestamp inside the trust surface',
    why: 'This is clause 4 (screenshot state vs DOM state), which is already not-run. Detecting a clock IN the surface from source would be cheap and was deliberately NOT added: the timestamp that moves the pixels can sit anywhere in the captured frame — a status bar, a log line, a cursor — so a source check would refuse some honest surfaces while still passing the dishonest capture. A check that cannot see the artifact it is judging should say so rather than approximate.',
  },
  {
    id: 4,
    deception: 'trust surface animates toward apparent approval',
    verdict: 'detected',
    mode: 'STATIC',
    fixture: 'corpus 4a-4e — approval motion via five declaration routes',
    detectors: [
      'clause 3: no CSS transition/animation on an enumerated decision surface',
      'clause 3: no motion utility class on an enumerated decision surface',
      'clause 3 [TRIPWIRE]: no inline style motion on an enumerated decision surface',
      'clause 3 [TRIPWIRE]: no Framer Motion animation prop on an enumerated decision surface',
      'clause 3 [TRIPWIRE]: no Web Animations API call in a component owning a decision surface',
    ],
    why: 'Detected at the DECLARATION SITE, in all five routes source can express. Not proof of absence: motion injected at runtime (a class added by script, a stylesheet fetched at runtime, a third-party widget) is still invisible here, and the cascade half of clause 3 stays not-run.',
    /*
     * This static deception fixture has no external-reference provenance. A
     * previously reported Mobbin screen description was removed because no
     * authenticated run bound that description to an observation digest. The
     * current authenticated Figma Slides flow facts live in
     * shared/nodeslideReferenceKnowledge.ts and do not support this unrelated
     * pending-card rule.
     */
  },
  {
    id: 5,
    deception: 'reduced-motion renders a different design',
    verdict: 'not-detected',
    mode: 'NOT-RUN',
    fixture: 'corpus 5 — prefers-reduced-motion block repaints the card',
    why: 'The CSS reader flattens at-rules: rules inside @media (prefers-reduced-motion: reduce) are parsed with their at-rule context dropped, so the gate cannot tell "this applies only under reduced motion" from "this always applies". It therefore cannot compare the two designs, which is the whole deception. The same flattening makes `transition: none` inside a reduced-motion block read as motion — a false positive the corpus fixture pins so the next reader meets it as a known limit, not a mystery.',
  },
  {
    id: 6,
    deception: 'GSAP knockout jumps to the end and falsely passes',
    verdict: 'not-detected',
    mode: 'NOT-RUN',
    fixture: 'corpus 6 — GSAP tween with a zero-duration knockout path',
    why: 'This is a defect in a KNOCKOUT PROCEDURE, not a property of source text. A tween knocked out with timeScale(0) or duration:0 still APPLIES ITS END STATE, and the end state is exactly what the un-knocked-out run produces — so the before/after comparison still differs and the knockout reports success while proving nothing. The correct knockout is causal: prevent the timeline from being CONSTRUCTED at all, then assert the end state never arrives. Fast-forwarding is not a knockout, it is the same run with the middle deleted. This gate runs no knockout of rendered motion, so it has nothing to be fooled by and nothing to offer; the rule is recorded here so that whoever writes the browser spec does not rediscover it the expensive way.',
  },
  {
    id: 7,
    deception: 'video shows motion the live application does not contain',
    verdict: 'not-detected',
    mode: 'NOT-RUN',
    fixture: 'corpus 7 — clean source, motion present only in the recording',
    why: 'The deception lives entirely in an artifact this gate never opens. Source can be perfectly clean — the fixture is a compliant surface and passes, correctly — while the recording shows an animation that was staged, sped up, or recorded from a branch that never shipped. Reconciling a video against a live page is the far side of clause 4.',
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
 * @param options.allowlist  the reviewed-non-surface table. Overridable with the srcDir for
 *   one reason: the shipped allowlist names real repository paths, so against a fixture tree
 *   EVERY entry is stale and the stale-allowlist check goes red on all of them. That red
 *   drowns the finding a fixture exists to produce — the corpus grading first ran with a
 *   hardcoded allowlist and reported all seven deceptions "CAUGHT", every one of them by the
 *   same irrelevant staleness error. A fixture must be able to fail for its own reason.
 */
export async function collectTrustSurfaceCensus({
  srcDir = SRC,
  relativeTo = root,
  allowlist = REVIEWED_NON_SURFACES,
} = {}) {
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
      const owner = componentAt(components, lineIndex);
      annotated.push({
        file: rel(file),
        line: lineIndex + 1,
        component: owner.name,
        kind: match[1],
        tagText,
        classes: classTokens(tagText),
        // The whole declaration body, not just the opening tag. Imperative motion is applied
        // from a ref in an effect — `cardRef.current.animate(...)` — which is nowhere near the
        // tag it animates. A tag-only scan cannot see it, and that is exactly the blind spot
        // the WAAPI check below exists to close.
        componentText: lines.slice(owner.startLine, owner.endLine + 1).join('\n'),
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
  const allowKeys = new Set(allowlist.map((a) => `${a.file}::${a.component}`));

  const notRun = [...byComponent.values()].filter(
    (entry) =>
      !annotatedKeys.has(`${entry.file}::${entry.component}`) &&
      !allowKeys.has(`${entry.file}::${entry.component}`),
  );
  const staleAllowlist = allowlist.filter(
    (entry) => !byComponent.has(`${entry.file}::${entry.component}`),
  );

  return { annotated, sweepHits, byComponent, notRun, staleAllowlist, cssRules, allowlist };
}

/* ------------------------------------------------------------------------ the checks */

/**
 * @param options  forwarded verbatim to collectTrustSurfaceCensus. Overridable ONLY so the
 *   test suite can run the REAL checks against a fixture tree. Asserting on the collector's
 *   raw findings proves the sweep sees a thing; it does not prove the check built on top of
 *   that finding goes red. Those are different claims, and the corpus grading needs the
 *   second one. Production callers pass nothing.
 */
export async function trustSurfaceChecks({
  corpus = MOTION_DECEPTION_CORPUS,
  /*
   * Overridable for exactly the reason `allowlist` is: the shipped authorless table names two
   * real repository components, so against a fixture tree BOTH entries are stale and the
   * staleness check goes red on both. That red would drown the finding the fixture exists to
   * produce, and a fixture must be able to fail for its own reason. Production callers pass
   * nothing and get the real table.
   */
  proposalOriginAllowlist = PROPOSAL_ORIGIN_AUTHORLESS,
  ...options
} = {}) {
  const census = await collectTrustSurfaceCensus(options);
  const { annotated, notRun, staleAllowlist, cssRules, byComponent, allowlist } = census;
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
      ? `${allowlist.length} reviewed non-surfaces, all still matched by the sweep`
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

  /* --- CLAUSE 1, second fact: authorship is published, not only narrated ------ */

  const originSurfaces = annotated.filter((a) => PROPOSAL_ORIGIN_KINDS.has(a.kind));
  const originAuthorlessKeys = new Set(
    proposalOriginAllowlist.map((entry) => `${entry.file}::${entry.component}`),
  );
  const originCarrying = originSurfaces.filter((a) =>
    a.tagText.includes(PROPOSAL_ORIGIN_ATTRIBUTE),
  );
  const originMissing = originSurfaces.filter(
    (a) =>
      !a.tagText.includes(PROPOSAL_ORIGIN_ATTRIBUTE) &&
      !originAuthorlessKeys.has(`${a.file}::${a.component}`),
  );

  // GATE. EXISTENCE, not value. Proven red by deleting the attribute from ThreadTurn: the run
  // named `AgentThread.tsx:292 ThreadTurn` and exited nonzero, which is the whole point — a
  // redesign that drops the attribute must not be able to leave the value check passing
  // vacuously over an element that no longer has one.
  add(
    `trust-surfaces clause 1: every proposal surface publishes ${PROPOSAL_ORIGIN_ATTRIBUTE}`,
    originMissing.length === 0,
    originMissing.length === 0
      ? `${originCarrying.length} of ${originSurfaces.length} proposal/diff-review surfaces carry it; ${proposalOriginAllowlist.length} reviewed as authorless: ${originCarrying
          .map((a) => a.component)
          .join(' ')}`
      : `missing ${PROPOSAL_ORIGIN_ATTRIBUTE}: ${originMissing
          .map((a) => `${a.file}:${a.line} ${a.component} (${a.kind})`)
          .join(', ')}`,
  );

  // GATE. An exemption is only honest while it still describes something. Two ways it rots:
  // the component disappears, or it grows an origin and the exemption becomes a lie that would
  // hide the NEXT surface to lose the attribute behind a stale name.
  const staleAuthorless = proposalOriginAllowlist.filter((entry) => {
    const matches = originSurfaces.filter(
      (a) => a.file === entry.file && a.component === entry.component,
    );
    return (
      matches.length === 0 || matches.some((a) => a.tagText.includes(PROPOSAL_ORIGIN_ATTRIBUTE))
    );
  });
  add(
    'trust-surfaces clause 1: no stale entry in the authorless-proposal allowlist',
    staleAuthorless.length === 0,
    staleAuthorless.length === 0
      ? `${proposalOriginAllowlist.length} authorless surfaces, all still enumerated and still without an origin`
      : `stale: ${staleAuthorless.map((e) => `${e.file}::${e.component}`).join(', ')}`,
  );

  // GATE. Every exemption states a reason. An allowlist of bare paths is a list of holes.
  const unreasonedAuthorless = proposalOriginAllowlist.filter(
    (entry) => (entry.reason ?? '').trim().length < 40,
  );
  add(
    'trust-surfaces clause 1: every authorless exemption states why it has no origin',
    unreasonedAuthorless.length === 0,
    unreasonedAuthorless.length === 0
      ? `${proposalOriginAllowlist.length} exemptions, all reasoned`
      : `unreasoned: ${unreasonedAuthorless.map((e) => `${e.file}::${e.component}`).join(', ')}`,
  );

  // GATE. The census cannot be emptied by allowlisting everything. Without this, the cheapest
  // way to silence the presence check above is to move every surface into the exemption table
  // one honest-looking entry at a time, and each individual move looks locally reasonable.
  add(
    `trust-surfaces clause 1: at least one surface actually carries ${PROPOSAL_ORIGIN_ATTRIBUTE}`,
    originCarrying.length > 0,
    `${originCarrying.length} surface(s) publishing authorship`,
  );

  // GATE. Value, checked only after presence, and checked at the WRITER rather than at the
  // rendered string: these are JSX expressions, so there is no literal in source to read. What
  // source CAN prove is that the value comes from the one function that refuses anything
  // outside the vocabulary. A literal is allowed too, and must be in the vocabulary.
  const originAttributeValue = new RegExp(
    `${PROPOSAL_ORIGIN_ATTRIBUTE}=(?:"([^"]*)"|\\{([\\s\\S]*?)\\}(?=\\s|/?>))`,
  );
  const badOriginValues = [];
  for (const surface of originCarrying) {
    const match = originAttributeValue.exec(surface.tagText);
    if (!match) {
      badOriginValues.push(`${surface.file}:${surface.line} value could not be read off the tag`);
      continue;
    }
    const literal = match[1];
    const expression = match[2];
    if (literal !== undefined) {
      if (!PROPOSAL_ORIGIN_VALUES.has(literal)) {
        badOriginValues.push(`${surface.file}:${surface.line} literal "${literal}"`);
      }
      continue;
    }
    if (!(expression ?? '').includes(`${PROPOSAL_ORIGIN_WRITER}(`)) {
      badOriginValues.push(
        `${surface.file}:${surface.line} expression \`${(expression ?? '').trim().slice(0, 80)}\` does not go through ${PROPOSAL_ORIGIN_WRITER}()`,
      );
    }
  }
  add(
    `trust-surfaces clause 2: every ${PROPOSAL_ORIGIN_ATTRIBUTE} is written by ${PROPOSAL_ORIGIN_WRITER}() or a declared literal`,
    badOriginValues.length === 0,
    badOriginValues.length === 0
      ? `vocabulary: ${[...PROPOSAL_ORIGIN_VALUES].join('|')}; ${originCarrying.length} surface(s) route through ${PROPOSAL_ORIGIN_WRITER}()`
      : `unguarded: ${badOriginValues.join(', ')}`,
  );

  // GATE. Named separately from the vocabulary check even though it is a subset of it, because
  // it is the specific failure this whole area exists to prevent and a reader scanning the
  // check list should be able to see that it is covered. `String(undefined)` renders as the
  // four-letter word "undefined" and React will happily set it as an attribute value.
  const stringifiedUndefined = originSurfaces.filter((a) =>
    new RegExp(`${PROPOSAL_ORIGIN_ATTRIBUTE}=(?:"undefined"|\\{\\s*String\\()`).test(a.tagText),
  );
  add(
    `trust-surfaces clause 2: no ${PROPOSAL_ORIGIN_ATTRIBUTE} is stringified into the literal "undefined"`,
    stringifiedUndefined.length === 0,
    stringifiedUndefined.length === 0
      ? `${originSurfaces.length} proposal/diff-review surfaces checked for "undefined" and String( coercion`
      : `stringified: ${stringifiedUndefined.map((a) => `${a.file}:${a.line}`).join(', ')}`,
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

  /* --- CLAUSE 3, the three routes a CSS-only scan cannot see ------------------
   *
   * All three are TRIPWIREs by the declared doctrine: they cannot fail on this codebase
   * today, because src/ contains no framer-motion dependency, no `.animate(` call, and no
   * inline style carrying a transition. That is precisely why they are worth their lines —
   * each one guards a specific FUTURE change, named in its own comment. Each was proven red
   * against a corpus fixture before being committed; do not delete them as dead.
   */

  const decisionSurfaces = annotated.filter((a) => decisionKinds.has(a.kind));

  // TRIPWIRE — guards the day someone reaches for `style={{ transition: ... }}` to make a
  // proposal card settle, having read the CSS rule and correctly concluded that the
  // stylesheet is watched. The inline prop is the first place that instinct goes.
  const inlineStyleMotion = decisionSurfaces.filter((a) => {
    const style = /style=\{\{([\s\S]*?)\}\}/.exec(a.tagText);
    return style ? INLINE_STYLE_MOTION.test(style[1]) : false;
  });
  add(
    'trust-surfaces clause 3 [TRIPWIRE]: no inline style motion on an enumerated decision surface',
    inlineStyleMotion.length === 0,
    inlineStyleMotion.length === 0
      ? `${decisionSurfaces.length} decision surfaces checked for style={{ transition|animation }}`
      : `inline motion: ${inlineStyleMotion.map((a) => `${a.file}:${a.line} ${a.component}`).join(', ')}`,
  );

  // TRIPWIRE — guards the arrival of Framer Motion. It is not a dependency today; the day it
  // is, `<motion.div animate={...}>` on a proposal card is one import and one prop away, and
  // no stylesheet ever mentions it. Matching the tag as well as the props means a bare
  // `<motion.div>` on a decision surface is refused before the props get added.
  const framerMotion = decisionSurfaces.filter(
    (a) => FRAMER_MOTION_PROP.test(a.tagText) || FRAMER_MOTION_TAG.test(a.tagText),
  );
  add(
    'trust-surfaces clause 3 [TRIPWIRE]: no Framer Motion animation prop on an enumerated decision surface',
    framerMotion.length === 0,
    framerMotion.length === 0
      ? `${decisionSurfaces.length} decision surfaces checked for animate/initial/whileHover/<motion.>`
      : `framer motion: ${framerMotion.map((a) => `${a.file}:${a.line} ${a.component}`).join(', ')}`,
  );

  // TRIPWIRE — guards imperative motion from an effect. This is the route that survives every
  // style-based check by construction: the animation exists only as a JS call at runtime, the
  // stylesheet is clean, and the tag is clean. Scoped to the whole component body because the
  // call site is never the tag.
  const waapiMotion = decisionSurfaces.filter((a) => WAAPI_ANIMATE.test(a.componentText ?? ''));
  add(
    'trust-surfaces clause 3 [TRIPWIRE]: no Web Animations API call in a component owning a decision surface',
    waapiMotion.length === 0,
    waapiMotion.length === 0
      ? `${decisionSurfaces.length} decision-surface components checked for .animate(`
      : `waapi: ${waapiMotion.map((a) => `${a.file}:${a.line} ${a.component}`).join(', ')}`,
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

  /* --- CORPUS INTEGRITY: the graded table cannot quietly overstate coverage --- */

  // GATE. This is what makes the corpus table a gate rather than a comment. Add an eighth
  // deception with no verdict and the run goes red — an ungraded fixture is treated exactly
  // like a not-run clause reported as passed, because it is the same error wearing a table.
  const ungraded = corpus.filter(
    (entry) =>
      !CORPUS_VERDICTS.has(entry.verdict) ||
      !CORPUS_MODES.has(entry.mode) ||
      !entry.deception ||
      !entry.fixture ||
      !entry.why,
  );
  add(
    'motion-deception corpus: every fixture carries a verdict, a mode, a fixture name and a reason',
    ungraded.length === 0,
    ungraded.length === 0
      ? `${corpus.length} corpus fixtures, all graded`
      : `ungraded: ${ungraded.map((e) => `#${e.id} ${e.deception ?? '(unnamed)'} verdict=${e.verdict ?? 'MISSING'}`).join(', ')}`,
  );

  // GATE. A `detected` claim must point at a check that exists. This is the anti-drift bond:
  // delete or rename a detector check and the table's claim to catch #4 fails immediately,
  // rather than the coverage line going on advertising a check that no longer runs.
  const checkLabels = checks.map(([label]) => label);
  const brokenClaims = [];
  for (const entry of corpus) {
    if (entry.verdict !== 'detected') continue;
    if (entry.mode !== 'STATIC') {
      brokenClaims.push(`#${entry.id} claims detected but mode is ${entry.mode}`);
      continue;
    }
    for (const detector of entry.detectors ?? []) {
      if (!checkLabels.some((label) => label.includes(detector))) {
        brokenClaims.push(`#${entry.id} names a detector with no matching check: "${detector}"`);
      }
    }
    if ((entry.detectors ?? []).length === 0) {
      brokenClaims.push(`#${entry.id} claims detected but names no detector`);
    }
  }
  add(
    'motion-deception corpus: every "detected" verdict names a check that actually exists',
    brokenClaims.length === 0,
    brokenClaims.length === 0
      ? `${corpus.filter((e) => e.verdict === 'detected').length} detected class(es), all bound to live checks`
      : brokenClaims.join(' | '),
  );

  // GATE. Two entries claiming the same id would let one silently shadow the other in the
  // coverage line, which is how a table starts lying while still looking complete.
  const ids = corpus.map((entry) => entry.id);
  const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
  add(
    'motion-deception corpus: fixture ids are unique',
    duplicateIds.length === 0,
    duplicateIds.length === 0
      ? `ids ${ids.join(',')}`
      : `duplicate ids: ${[...new Set(duplicateIds)].join(', ')}`,
  );

  return { checks, census };
}

/**
 * The coverage declaration, derived from MOTION_DECEPTION_CORPUS. Printed by the census and
 * by the linter so that a green run states its own limits in the same breath as its score.
 *
 * The reason this exists: `35/35 PASS` reads as "no deceptive motion exists". It does not
 * mean that and never could — it means the static checks found nothing, on the one deception
 * class of seven that source text can decide. A gate that prints a score without printing
 * its denominator is inviting the reader to supply the wrong one.
 */
export async function motionDeceptionCoverage() {
  const command = await probedBrowserCommand();
  const detected = MOTION_DECEPTION_CORPUS.filter((entry) => entry.verdict === 'detected');
  const lines = [];
  lines.push(
    `Motion-deception coverage: ${detected.length} of ${MOTION_DECEPTION_CORPUS.length} known deception classes are detected by this gate.`,
  );
  lines.push(
    'A green run means THESE CHECKS FOUND NOTHING. It is not evidence that no deceptive motion exists.',
  );
  for (const entry of MOTION_DECEPTION_CORPUS) {
    const tag = entry.verdict === 'detected' ? 'DETECTED    ' : 'NOT-DETECTED';
    lines.push(`  [${tag}] #${entry.id} ${entry.deception}  (${entry.mode})`);
    for (const detector of entry.detectors ?? []) lines.push(`       via ${detector}`);
    lines.push(`       ${entry.why}`);
    if (entry.reference) {
      // Printed WITH its verification status. A reference quoted without saying whether this
      // run confirmed it is how a borrowed observation hardens into a claimed measurement.
      lines.push(
        `       ref [${entry.reference.verified ? 'verified' : 'UNVERIFIED HERE'}] ${entry.reference.url}`,
      );
      lines.push(`           ${entry.reference.observation}`);
      lines.push(`           ${entry.reference.note}`);
    }
    if (entry.mode === 'NOT-RUN') lines.push(`       would be run by: ${command}`);
  }
  return lines;
}

/**
 * Which clauses actually ran, and how. Printed by the linter so a green run never implies
 * more coverage than it has. Clause 4 and the cascade half of clause 3 need a real browser;
 * they report not-run rather than passed.
 */
const BROWSER_SPEC = 'tests/e2e/nodeslide-trust-surfaces.spec.ts';

/*
 * The command is PROBED, not asserted. Printing "run `npm run test:e2e`" when no such spec
 * exists would make a not-run look one command away from being run, which is its own quiet
 * lie — the same species as a success colour on a pending state. The message changes by
 * itself the day someone writes the file.
 *
 * Shared by clauseRunMode() and motionDeceptionCoverage() so the two can never cite different
 * runners for the same missing capability — five of the seven corpus classes and both not-run
 * clauses are waiting on this one spec.
 */
export async function probedBrowserCommand() {
  let specExists = false;
  try {
    await fs.access(path.join(root, BROWSER_SPEC));
    specExists = true;
  } catch {
    specExists = false;
  }
  return specExists
    ? `npx playwright test ${BROWSER_SPEC}`
    : `NO RUNNER YET — ${BROWSER_SPEC} does not exist; writing it is what would make this runnable`;
}

export async function clauseRunMode() {
  const command = await probedBrowserCommand();

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
  console.log(`\n=== PROPOSAL AUTHORSHIP (${PROPOSAL_ORIGIN_ATTRIBUTE}) ===`);
  for (const surface of census.annotated.filter((a) => PROPOSAL_ORIGIN_KINDS.has(a.kind))) {
    const carries = surface.tagText.includes(PROPOSAL_ORIGIN_ATTRIBUTE);
    const exempt = PROPOSAL_ORIGIN_AUTHORLESS.some(
      (entry) => entry.file === surface.file && entry.component === surface.component,
    );
    console.log(
      `  ${carries ? 'PUBLISHES ' : exempt ? 'AUTHORLESS' : 'MISSING   '} ${surface.file}:${surface.line} ${surface.component} (${surface.kind})`,
    );
  }
  console.log('\n  reviewed as authorless, with reason:');
  for (const entry of PROPOSAL_ORIGIN_AUTHORLESS) {
    console.log(`    ${entry.file} :: ${entry.component}\n        ${entry.reason}`);
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
  console.log('\n=== MOTION-DECEPTION COVERAGE ===');
  for (const line of await motionDeceptionCoverage()) console.log(`  ${line}`);
  console.log('\n=== CHECKS ===');
  for (const [label, passed, detail] of checks) {
    console.log(`${passed ? 'PASS' : 'FAIL'} ${label}\n      ${detail}`);
  }
  const failed = checks.filter(([, passed]) => !passed).length;
  console.log(`\nTrust-surface census: ${checks.length - failed}/${checks.length}`);
  if (failed > 0) process.exit(1);
}
