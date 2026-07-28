import { describe, expect, it } from 'vitest';
import { collectTrustSurfaceCensus } from '../nodeslide-trust-surface-census.mjs';
import {
  MOTION_FLOOR_SECONDS,
  REACH_PLAN,
  armSensors,
  clauseAnimations,
  clauseReducedMotion,
  clauseStateAgreement,
  clauseSuccessToken,
  evaluateSurface,
  oklabDistance,
  planForCensus,
  successPaints,
  summarize,
  transitionedProperties,
} from '../nodeslide-trust-surface-runtime-probe.mjs';

/*
 * The knockouts for the RUNTIME half of the trust-surfaces gate, made permanent.
 *
 * The persona is the one the whole gate exists for: a reviewer — human or agent — landing on
 * a surface that is asking them to accept, approve or grant something, who has to decide
 * whether to believe what they are looking at. Every scenario below is a way that surface can
 * lie to them, and the assertion is that the probe says so, by name, with the observed value
 * behind it.
 *
 * Three of these scenarios are not hypothetical bugs in the product. They are bugs the FIRST
 * LIVE RUN of this probe committed against production, each one a false accusation, each one
 * fixed and then pinned here so the fix cannot rot:
 *
 *   - `--ns-positive` is scoped to `.nodeslide-studio`, so a probe element appended to
 *     `document.body` resolved it to plain inherited black — and every SVG `fill` on the page
 *     defaults to that same black. The probe reported success styling on every surface it
 *     reached. (pinned by: "a sensor that cannot resolve the token reports not-run")
 *   - `prefers-reduced-motion` is implemented as `transition-duration: 0.01ms`, not `0s`.
 *     A strict `> 0` test read the CORRECT implementation as a violation.
 *     (pinned by: "the 0.01ms reduced-motion idiom is not motion")
 *   - the deck CI readout resolved from `loading` to `pass` DURING the observation window, and
 *     the probe reported the passage of time as a second design.
 *     (pinned by: "a surface still settling is not-run, never failed")
 *
 * A gate that makes false accusations stops being read, which is a slower version of not
 * having the gate at all.
 */

const POSITIVE = 'rgb(4, 120, 87)';
const NEUTRAL = 'rgb(75, 85, 99)';
const TOKENS = { '--ns-positive': POSITIVE };

const neutralPaint = (node) => ({
  node,
  color: NEUTRAL,
  backgroundColor: 'rgba(0, 0, 0, 0)',
  borderTopColor: NEUTRAL,
  borderLeftColor: NEUTRAL,
  outlineColor: NEUTRAL,
  fill: 'none',
});

const stillMotion = (node) => ({
  node,
  transitionProperty: 'none',
  transitionDuration: '0s',
  animationName: 'none',
  animationDuration: '0s',
  animationIterationCount: '1',
});

/**
 * A realistic observation of an honest pending proposal card: annotated, machine-readable,
 * neutral, motionless. Every scenario below is this, deformed in exactly one way.
 */
function observation(overrides = {}) {
  const base = {
    present: true,
    visible: true,
    node: 'article.ns-proposal-card[data-testid=proposal-card]',
    attributes: {
      'data-trust-surface': 'proposal',
      'data-decision': 'undecided',
      'data-testid': 'proposal-card',
    },
    classList: ['ns-proposal-card'],
    text: 'Ready to apply · 3 operations · Accept Reject',
    runningAnimations: [],
    motion: [stillMotion('article.ns-proposal-card'), stillMotion('button')],
    paint: [neutralPaint('article.ns-proposal-card'), neutralPaint('button')],
    successTokens: TOKENS,
  };
  return { ...base, ...overrides };
}

const PLAN = {
  key: 'src/domains/nodeslide/inspector/AiInspector.tsx::ProposalCard',
  selector: '[data-testid="proposal-card"]',
  kind: 'proposal',
  stateAttribute: 'data-decision',
  requires: 'a pending AI patch proposal',
};

const verdicts = (clauses) => Object.values(clauses).map((clause) => clause.verdict);

/* ------------------------------------------------------------------------ happy path */

describe('the reviewer lands on an honest pending proposal', () => {
  it('passes all four clauses, and every pass cites what was actually inspected', () => {
    const clauses = evaluateSurface({
      plan: PLAN,
      normal: observation(),
      reduced: observation(),
      motionAfter: observation(),
    });
    expect(verdicts(clauses)).toEqual(['passed', 'passed', 'passed', 'passed']);
    // A verdict without the observed value behind it is not evidence. Every reason has to
    // carry something a reader can check, not the word "ok".
    for (const clause of Object.values(clauses)) {
      expect(clause.reason.length).toBeGreaterThan(20);
    }
    expect(clauses.B_noSuccessTokenOnPending.reason).toContain(POSITIVE);
    expect(clauses.B_noSuccessTokenOnPending.observed.paint).toHaveLength(2);
  });
});

/* -------------------------------------------------------- the historical product bugs */

describe('the surface is painted as decided when it is not', () => {
  it('catches the .ns-candidate-status cascade bug: pending resolves to the success token', () => {
    /*
     * The real one. The BASE rule was `--ns-positive` with an override for every status
     * except `ready` — the single state meaning "validated, waiting for you to press Accept".
     * No selector anywhere says "paint pending green"; the cascade arranges it, and a source
     * grep sees nothing. Only a computed read sees this.
     */
    const painted = observation({
      paint: [
        { ...neutralPaint('span.ns-candidate-status'), color: POSITIVE },
        neutralPaint('button'),
      ],
    });
    const b = clauseSuccessToken(painted, PLAN);
    expect(b.verdict).toBe('failed');
    expect(b.reason).toContain('span.ns-candidate-status');
    expect(b.reason).toContain('--ns-positive');
    expect(b.reason).toContain(POSITIVE);

    // Clause C sees the same thing from the other direction: declared vs rendered.
    expect(clauseStateAgreement(painted, PLAN).verdict).toBe('failed');
  });

  it('catches copy as a styling channel: "Applied" over an undecided thing', () => {
    const c = clauseStateAgreement(
      observation({ text: 'Applied to slide 3. Accept Reject' }),
      PLAN,
    );
    expect(c.verdict).toBe('failed');
    expect(c.reason).toContain('Applied');
  });

  it('does NOT flag the word "Accept" on a button — a label is not a claim of outcome', () => {
    // The bound on SETTLED_SUCCESS_COPY. An affordance reading "Accept" is the whole point of
    // the surface; only the past participle asserts that something already happened.
    expect(clauseStateAgreement(observation({ text: 'Accept Reject Preview' }), PLAN).verdict).toBe(
      'passed',
    );
  });

  it('catches a status attribute that disagrees with the class the element renders', () => {
    const c = clauseStateAgreement(
      observation({
        attributes: {
          'data-trust-surface': 'diff-review',
          'data-decision': 'undecided',
          'data-candidate-status': 'ready',
        },
        classList: ['ns-candidate-receipt', 'is-invalid'],
      }),
      { ...PLAN, kind: 'diff-review', statusAttribute: 'data-candidate-status' },
    );
    expect(c.verdict).toBe('failed');
    expect(c.reason).toContain('is-invalid');
    expect(c.reason).toContain('disagree');
  });
});

describe('motion the source sweep cannot see', () => {
  it('catches a Framer Motion / raw WAAPI animation with no CSS name at all', () => {
    /*
     * The council's named primary instrument, and the case that justifies it: a WAAPI
     * animation has no stylesheet rule, no class token and no `transition:` declaration.
     * `transition-property` reads `none` and the computed cascade is spotless. Nothing but
     * getAnimations() knows it is moving.
     */
    const a = clauseAnimations(
      observation({
        runningAnimations: [
          {
            node: 'article.ns-proposal-card',
            playState: 'running',
            type: 'Animation',
            name: '(unnamed WAAPI animation)',
            duration: 300,
            iterations: 1,
          },
        ],
      }),
      PLAN,
    );
    expect(a.verdict).toBe('failed');
    expect(a.reason).toContain('(unnamed WAAPI animation)');
    expect(a.reason).toContain('article.ns-proposal-card');
  });

  it('still bans a named keyframe animation outright — the narrowing is about transitions only', () => {
    const a = clauseAnimations(
      observation({
        motion: [
          {
            ...stillMotion('article.ns-proposal-card'),
            animationName: 'ns-pulse',
            animationDuration: '900ms',
            animationIterationCount: 'infinite',
          },
        ],
      }),
      PLAN,
    );
    expect(a.verdict).toBe('failed');
    expect(a.reason).toContain('ns-pulse');
  });
});

/* ------------------------------------------------- clause A, narrowed: direction not presence */

/*
 * THE NARROWING, pinned.
 *
 * Clause A used to fail on the mere presence of a `transition:` declaration anywhere inside a
 * trust surface. On production that fired exactly once — on the AI composer's web-research
 * CONSENT toggle, for `transition: all 0.15s` inherited from the shadcn `buttonVariants` base
 * three components above the annotated tag.
 *
 * That verdict was wrong, and the reason it was wrong is measurable rather than aesthetic. The
 * toggle renders `variant="ghost"` (transparent) while web egress is OFF and `variant="default"`
 * (`bg-primary`) while it is ON. The only paint it can reach WITHOUT its declared state changing
 * is `:hover` -> `--color-surface-hover`, a near-achromatic near-white that sits 0.372 from
 * `--primary` and 0.431 from `--color-success` in OKLab. It does not move toward looking
 * granted; it moves toward looking hovered.
 *
 * So the clause now grades DIRECTION. The scenarios below are the boundary in both directions,
 * and the first one is the one that matters: a background moving toward the accept hue on an
 * undecided element is still RED, which is what stops this narrowing from being an allowlist
 * with extra steps.
 */
describe('a transition is a lie only when it moves toward the accepted appearance', () => {
  // Real production values. `--primary` is `--color-accent`, oklch(0.62 0.16 35); the ghost
  // hover lands on `--color-surface-hover`, oklch(0.96 0.015 75).
  const GRANTED = 'rgb(212, 91, 61)';
  const HOVER_NEUTRAL = 'rgb(248, 241, 231)';
  const ACCEPT = { '--ns-positive': POSITIVE, '--primary': GRANTED };

  const endpoint = (property, value, pseudo = 'hover', restValue = 'rgba(0, 0, 0, 0)') => ({
    pseudo,
    property,
    declared: 'var(--token)',
    value,
    restValue,
    resolved: value !== null,
  });

  const transitioning = (
    node,
    { properties = 'all', duration = '0.15s', endpoints = [] } = {},
  ) => ({
    ...stillMotion(node),
    transitionProperty: properties,
    transitionDuration: duration,
    sameStateEndpoints: endpoints,
    sheetsRead: 4,
    unreadableSheets: 0,
  });

  const withMotion = (motion, extra = {}) =>
    observation({ motion, acceptAppearances: ACCEPT, ...extra });

  it('STAYS RED: a background transitioning toward the accept hue on an undecided element', () => {
    // The deception the rule was written for, and the fixture that proves the narrowed clause
    // did not simply stop looking. Hovering an undecided thing shades it into the fill that
    // means "committed" — it looks granted before anyone granted anything.
    const a = clauseAnimations(
      withMotion([
        transitioning('button[data-testid=ai-web-research-toggle]', {
          endpoints: [endpoint('background-color', GRANTED)],
        }),
      ]),
      PLAN,
    );
    expect(a.verdict).toBe('failed');
    expect(a.reason).toContain('--primary');
    expect(a.reason).toContain('accepted appearance');
    expect(a.observed.directional).toHaveLength(1);
  });

  it('STAYS RED on a near miss, not merely on an exact token match', () => {
    // A slightly lighter shade of the accept hue is 0.032 away in OKLab — inside the 0.10
    // threshold. A clause that only caught string equality would be trivial to slip past.
    const a = clauseAnimations(
      withMotion([
        transitioning('button', { endpoints: [endpoint('background-color', 'rgb(223, 111, 79)')] }),
      ]),
      PLAN,
    );
    expect(a.verdict).toBe('failed');
    expect(a.reason).toContain('--primary');
  });

  it('CLEARS the live finding: transition:all whose only same-state endpoint is a neutral', () => {
    /*
     * The actual production case. `transition: all 0.15s` DOES cover background-color, so a
     * property-name test alone would still condemn it. Only the endpoint measurement clears
     * it — and the verdict carries the distance that cleared it.
     */
    const a = clauseAnimations(
      withMotion([
        transitioning('button[data-testid=ai-web-research-toggle]', {
          endpoints: [endpoint('background-color', HOVER_NEUTRAL)],
        }),
      ]),
      PLAN,
    );
    expect(a.verdict).toBe('passed');
    expect(a.reason).toContain(HOVER_NEUTRAL);
    expect(a.reason).toContain('--primary');
  });

  it('catches opacity filling in toward settled on an undecided surface', () => {
    const a = clauseAnimations(
      withMotion([
        transitioning('article.ns-proposal-card', {
          properties: 'opacity',
          endpoints: [endpoint('opacity', '1', 'hover', '0.6')],
        }),
      ]),
      PLAN,
    );
    expect(a.verdict).toBe('failed');
    expect(a.reason).toContain('toward fully settled');
  });

  it('ignores a transition that only moves neutral affordance properties', () => {
    // A focus ring and a hover elevation carry no claim about the decision. This is the whole
    // class the old clause was collapsing together with the deception above.
    const a = clauseAnimations(
      withMotion([
        transitioning('button', { properties: 'box-shadow, outline-color, border-color' }),
      ]),
      PLAN,
    );
    expect(a.verdict).toBe('passed');
    expect(a.reason).toContain('box-shadow');
  });

  it('reports not-run — never passed — when the endpoints were never measured', () => {
    // The old fixture, rehomed. An observation with no endpoint measurement cannot support
    // "this transition is neutral"; the absence of evidence is not evidence of neutrality.
    const a = clauseAnimations(
      observation({
        motion: [
          {
            ...stillMotion('button[data-testid=ai-web-research-toggle]'),
            transitionProperty: 'all',
            transitionDuration: '0.15s',
          },
        ],
      }),
      PLAN,
    );
    expect(a.verdict).toBe('not-run');
    expect(a.reason).toContain('unmeasured endpoint is not a neutral one');
  });

  it('reports not-run when a cross-origin stylesheet hid part of the endpoint set', () => {
    const a = clauseAnimations(
      withMotion([
        {
          ...transitioning('button', { endpoints: [endpoint('background-color', HOVER_NEUTRAL)] }),
          unreadableSheets: 2,
        },
      ]),
      PLAN,
    );
    expect(a.verdict).toBe('not-run');
    expect(a.reason).toContain('cross-origin');
  });

  it('reports not-run when no accept appearance resolved — "toward accepted" needs a reference', () => {
    const a = clauseAnimations(
      observation({
        acceptAppearances: {},
        motion: [
          transitioning('button', { endpoints: [endpoint('background-color', HOVER_NEUTRAL)] }),
        ],
      }),
      PLAN,
    );
    expect(a.verdict).toBe('not-run');
    expect(a.reason).toContain('no accept-appearance token resolved');
  });

  it('pairs transition-property with its own duration, not merely the first one', () => {
    // `transition: opacity 0s, background-color 150ms` computes to a two-item property list
    // with a two-item duration list. Reading the properties alone would invent a transition on
    // `opacity` that does not run.
    expect(
      transitionedProperties({
        transitionProperty: 'opacity, background-color',
        transitionDuration: '0s, 0.15s',
      }),
    ).toEqual(['background-color']);
    expect(transitionedProperties({ transitionProperty: 'all', transitionDuration: '0s' })).toEqual(
      [],
    );
  });

  it('compares oklch() endpoints, which is the form Chromium actually returns [probe regression]', () => {
    /*
     * The bug the FIRST live run of the narrowed clause committed against production.
     * Chromium does not serialize a wide-gamut computed colour down to `rgb()` — `--primary`
     * came back as the literal string `oklch(0.62 0.16 35)`. An rgb-only parser returned null
     * for every comparison, so every distance was null, so nothing was ever "near" an accept
     * hue, so the surface passed. The verdict was right by accident and its stated reason was
     * false, which is worse than a red.
     */
    expect(oklabDistance('oklch(0.96 0.015 75)', 'oklch(0.62 0.16 35)')).toBeCloseTo(0.372, 2);
    // The same two colours written in the two different syntaxes must measure the same.
    expect(oklabDistance('oklch(0.62 0.16 35)', GRANTED)).toBeLessThan(0.02);

    const a = clauseAnimations(
      withMotion(
        [
          transitioning('button', {
            endpoints: [endpoint('background-color', 'oklch(0.96 0.015 75)')],
          }),
        ],
        { acceptAppearances: { '--primary': 'oklch(0.62 0.16 35)' } },
      ),
      PLAN,
    );
    expect(a.verdict).toBe('passed');
    // And the mirror: an oklch endpoint that IS the accept hue still goes red.
    const red = clauseAnimations(
      withMotion(
        [
          transitioning('button', {
            endpoints: [endpoint('background-color', 'oklch(0.63 0.155 36)')],
          }),
        ],
        { acceptAppearances: { '--primary': 'oklch(0.62 0.16 35)' } },
      ),
      PLAN,
    );
    expect(red.verdict).toBe('failed');
  });

  it('reports not-run — never passed — for an endpoint it cannot place in OKLab', () => {
    // The structural half of the same fix. An uncomparable colour must not be counted as a
    // neutral one; "I could not read it" and "it was harmless" are different readings.
    const a = clauseAnimations(
      withMotion([
        transitioning('button', {
          endpoints: [endpoint('background-color', 'color(display-p3 0.8 0.2 0.1)')],
        }),
      ]),
      PLAN,
    );
    expect(a.verdict).toBe('not-run');
    expect(a.reason).toContain('not a colour this probe can place in OKLab');
  });

  it('measures perceptual distance, so the threshold means the same thing in every hue', () => {
    expect(oklabDistance(HOVER_NEUTRAL, GRANTED)).toBeGreaterThan(0.3);
    expect(oklabDistance(GRANTED, GRANTED)).toBe(0);
    // Alpha-0 paint is not paint: a transparent rest value has no hue to move away from.
    expect(oklabDistance('rgba(0, 0, 0, 0)', GRANTED)).toBeNull();
    expect(oklabDistance('none', GRANTED)).toBeNull();
  });
});

/* ------------------------------------------------- welded sensors: the adversarial half */

describe('the sensor refuses to report a green it did not earn', () => {
  it('reports not-run — never passed — when the surface never rendered', () => {
    const clauses = evaluateSurface({
      plan: PLAN,
      normal: { present: false },
      reduced: { present: false },
    });
    expect(verdicts(clauses)).toEqual(['not-run', 'not-run', 'not-run', 'not-run']);
    for (const clause of Object.values(clauses)) {
      expect(clause.reason).toContain('a pending AI patch proposal');
    }
  });

  it('reports not-run when the matched node is not the surface the census enumerated', () => {
    /*
     * The welded-sensor failure in its exact historical shape: an assertion matched an
     * unconditionally-rendered chip and filed the screenshot as proof the state was reached.
     * A selector that resolves to SOMETHING is not a selector that resolved to the surface.
     */
    const wrong = observation({
      attributes: { 'data-trust-surface': 'consent', 'data-decision': 'undecided' },
    });
    for (const clause of Object.values(
      evaluateSurface({ plan: PLAN, normal: wrong, reduced: wrong }),
    )) {
      expect(clause.verdict).toBe('not-run');
      expect(clause.reason).toContain('refuses to grade a node it cannot prove is the surface');
    }
  });

  it('reports not-run for a surface with no client rects rather than reading its paint', () => {
    const hidden = observation({ visible: false });
    expect(armSensors(hidden, PLAN).verdict).toBe('not-run');
    expect(clauseSuccessToken(hidden, PLAN).verdict).toBe('not-run');
  });

  it('reports not-run — never passed — when no success token resolved in the document', () => {
    // If the left-hand side of the comparison is missing, a green means "I compared nothing".
    const b = clauseSuccessToken(observation({ successTokens: {} }), PLAN);
    expect(b.verdict).toBe('not-run');
    expect(b.reason).toContain('no success token resolved');
  });

  it('reports not-applicable WITH the observed state for a surface reached already settled', () => {
    const settled = observation({
      attributes: { 'data-trust-surface': 'proposal', 'data-decision': 'accepted' },
    });
    const b = clauseSuccessToken(settled, PLAN);
    expect(b.verdict).toBe('not-applicable');
    expect(b.reason).toContain('data-decision="accepted"');
    expect(b.observed.state).toBe('accepted');
  });

  it('FAILS — not not-run — when the source declares the attribute and the DOM has lost it', () => {
    /*
     * The `data-agent-web-consent` regression class: a wrapper component that does not spread
     * data-* props erases the posture while everything still renders and every other check
     * still passes. The census proves the attribute is in the SOURCE. Only a runtime read can
     * prove it survived to the DOM, so its absence here is a finding, not an abstention.
     */
    const stripped = observation({ attributes: { 'data-trust-surface': 'proposal' } });
    const armed = armSensors(stripped, PLAN);
    expect(armed.verdict).toBe('failed');
    expect(armed.reason).toContain('runtime attribute loss');
  });
});

/* --------------------------------------------------------------- reduced motion, clause D */

describe('reduced motion collapses to the final state, never to a second design', () => {
  it('catches a surface that renders different colours under reduce', () => {
    const d = clauseReducedMotion(
      observation(),
      observation({
        paint: [
          { ...neutralPaint('article.ns-proposal-card'), color: POSITIVE },
          neutralPaint('button'),
        ],
      }),
      PLAN,
      observation(),
    );
    expect(d.verdict).toBe('failed');
    expect(d.reason).toContain('second design');
    expect(d.reason).toContain(`${NEUTRAL} → ${POSITIVE}`);
  });

  it('catches a surface that vanishes under reduce instead of settling', () => {
    const d = clauseReducedMotion(observation(), { present: false }, PLAN);
    expect(d.verdict).toBe('failed');
    expect(d.reason).toContain('disappears');
  });

  it('catches an animation that keeps running under reduce', () => {
    const d = clauseReducedMotion(
      observation(),
      observation({
        runningAnimations: [
          { node: 'span.ns-status-dot', playState: 'running', type: 'CSSAnimation', name: 'pulse' },
        ],
      }),
      PLAN,
      observation(),
    );
    expect(d.verdict).toBe('failed');
    expect(d.reason).toContain('still animating under reduce');
  });

  it('accepts the 0.01ms reduced-motion idiom as no motion [probe regression]', () => {
    /*
     * FALSE ACCUSATION #1, pinned. `transition-duration: 0.01ms !important` is how this
     * codebase — and the web — implements the preference; a true `0s` cancels `transitionend`
     * and breaks listeners waiting on it. Chromium reports it back as 1e-06s. The first live
     * run read the CORRECT implementation as a violation on two surfaces.
     */
    expect(MOTION_FLOOR_SECONDS).toBe(0.001);
    const reduced = observation({
      motion: [{ ...stillMotion('article.ns-proposal-card'), transitionDuration: '1e-06s' }],
    });
    expect(clauseReducedMotion(observation(), reduced, PLAN, observation()).verdict).toBe('passed');
    expect(clauseAnimations(reduced, PLAN).verdict).toBe('passed');
  });

  it('reports not-run — not failed — when the surface was still settling [probe regression]', () => {
    /*
     * FALSE ACCUSATION #2, pinned. The deck CI readout went `loading` → `pass` during the
     * observation window and the probe reported the passage of time as a second design. The
     * bracket makes the race detectable: two motion-allowed reads around the reduced one.
     */
    const before = observation({
      attributes: { 'data-trust-surface': 'failed-state', 'data-state': 'loading' },
    });
    const after = observation({
      attributes: { 'data-trust-surface': 'failed-state', 'data-state': 'pass' },
    });
    const plan = { ...PLAN, kind: 'failed-state', stateAttribute: 'data-state' };
    const d = clauseReducedMotion(before, after, plan, after);
    expect(d.verdict).toBe('not-run');
    expect(d.reason).toContain('still settling');
    expect(d.reason).toContain('the passage of time, not the preference');
  });
});

/* ---------------------------------------------------- per-kind vocabularies, clause A & C */

describe('the rules are per kind, not one blanket ban', () => {
  const failedStatePlan = { ...PLAN, kind: 'failed-state', stateAttribute: 'data-state' };

  it('lets a passing readout wear the success colour [probe regression]', () => {
    /*
     * FALSE ACCUSATION #3, pinned. The first draft banned success paint on every failed-state
     * surface regardless of value, and reported `data-state="pass"` painting `--ns-positive`
     * as a violation — misreading "failure never looks like loading" as "nothing may ever
     * look like success". A deck CI run that passed is entitled to say so, in green.
     */
    const passing = observation({
      attributes: { 'data-trust-surface': 'failed-state', 'data-state': 'pass' },
      classList: ['ns-deck-ci-status', 'is-pass'],
      paint: [{ ...neutralPaint('output.ns-deck-ci-status'), color: POSITIVE }],
      text: 'Deck CI Passed 0 blockers · 0 warnings',
    });
    expect(clauseStateAgreement(passing, failedStatePlan).verdict).toBe('passed');
  });

  it('still bans the success colour on a readout that has NOT passed', () => {
    for (const state of ['fail', 'warn', 'loading', 'unavailable']) {
      const c = clauseStateAgreement(
        observation({
          attributes: { 'data-trust-surface': 'failed-state', 'data-state': state },
          paint: [{ ...neutralPaint('output.ns-deck-ci-status'), color: POSITIVE }],
        }),
        failedStatePlan,
      );
      expect(c.verdict, `state=${state}`).toBe('failed');
    }
  });

  it('allows a loading pulse on a readout but not on a failed one', () => {
    const pulsing = (state) =>
      observation({
        attributes: { 'data-trust-surface': 'failed-state', 'data-state': state },
        motion: [
          {
            ...stillMotion('span.dot'),
            animationName: 'ns-deck-ci-pulse',
            animationDuration: '1.2s',
          },
        ],
      });
    // "failure never looks like loading" — the ban is on the failure states, not on loading.
    expect(clauseAnimations(pulsing('loading'), failedStatePlan).verdict).toBe('not-applicable');
    expect(clauseAnimations(pulsing('fail'), failedStatePlan).verdict).toBe('failed');
  });
});

/* ------------------------------------------------------- enumeration, reconciled with the census */

describe('the probe consumes the census enumeration and cannot silently drift from it', () => {
  it('resolves every reach plan entry against the live census — no stale exemptions', async () => {
    /*
     * Asserted in ONE direction on purpose.
     *
     * A plan entry that matches nothing must fail: it is a surface this probe claims to
     * cover and does not, and a stale exemption is how a real finding hides. That direction
     * is entirely under this file's control.
     *
     * The other direction — "the census has a surface with no plan" — is deliberately NOT a
     * test failure. It is already reported, by name, as `not-run` in the probe's own output
     * and receipt, which is the honesty requirement met. Making it a red unit test as well
     * would mean any branch that annotates a new trust surface breaks this suite before its
     * author has any way to know the runtime probe exists. A gate that punishes the correct
     * behaviour (annotating a new surface) teaches people to stop doing it.
     */
    const census = await collectTrustSurfaceCensus();
    const { planned, unplanned, stalePlan } = planForCensus(census.annotated);
    expect(
      stalePlan,
      'a plan entry matching no census surface is a hole with a story attached',
    ).toEqual([]);
    expect(planned.length).toBe(REACH_PLAN.length);
    // Informational, and asserted only to be NAMED rather than to be absent.
    for (const entry of unplanned) expect(entry.key).toMatch(/^src\/.+::.+/);
  });

  it('gives every reach plan entry a precondition a reader can check, not "could not reach it"', () => {
    for (const entry of REACH_PLAN) {
      expect(entry.requires.length, entry.key).toBeGreaterThan(25);
      expect(entry.requires).not.toMatch(/^(unknown|n\/a|todo|could not)/i);
      expect(entry.stateAttribute).toMatch(/^data-/);
    }
  });

  it('names an enumerated surface nobody planned, rather than omitting it', () => {
    const { unplanned, stalePlan } = planForCensus([
      { file: 'src/nowhere/Invented.tsx', component: 'Invented', kind: 'consent', line: 1 },
    ]);
    expect(unplanned).toHaveLength(1);
    expect(unplanned[0].key).toBe('src/nowhere/Invented.tsx::Invented');
    // Every real plan entry is stale against this synthetic census — proving the stale check
    // is live rather than vacuously empty on the happy path.
    expect(stalePlan).toHaveLength(REACH_PLAN.length);
  });
});

/* -------------------------------------------------------------------- summary semantics */

describe('a run is red for violations and only for violations', () => {
  const row = (clauses) => ({ selector: '[data-testid=x]', clauses });

  it('does not turn red on not-run — that is the entire point of reporting it', () => {
    const summary = summarize([
      row({ A: { verdict: 'not-run', reason: 'needs a live model call' } }),
      row({ B: { verdict: 'not-applicable', reason: 'reached settled' } }),
      row({ C: { verdict: 'passed', reason: 'checked' } }),
    ]);
    expect(summary.red).toBe(false);
    expect(summary.tally).toMatchObject({
      passed: 1,
      'not-run': 1,
      'not-applicable': 1,
      failed: 0,
    });
  });

  it('turns red on a single violation and carries its reason into the failure list', () => {
    const summary = summarize([row({ A: { verdict: 'failed', reason: 'transition:all/0.15s' } })]);
    expect(summary.red).toBe(true);
    expect(summary.failures[0]).toContain('transition:all/0.15s');
  });
});

/* ---------------------------------------------------- sustained load / invariants at scale */

describe('the clause invariants hold across every state combination, not just the ones I thought of', () => {
  it('never returns passed for an absent, mismatched or invisible surface, over the full matrix', () => {
    const states = [
      'undecided',
      'pending',
      'accepted',
      'rejected',
      'failed',
      'none',
      'per-send',
      '',
    ];
    const kinds = ['proposal', 'conflict', 'diff-review', 'consent', 'permission', 'failed-state'];
    const deformations = [
      { label: 'absent', build: () => ({ present: false }) },
      { label: 'invisible', build: (o) => ({ ...o, visible: false }) },
      {
        label: 'wrong-kind',
        build: (o) => ({
          ...o,
          attributes: { ...o.attributes, 'data-trust-surface': 'something-else' },
        }),
      },
    ];

    let checked = 0;
    for (const kind of kinds) {
      for (const state of states) {
        for (const deformation of deformations) {
          const plan = { ...PLAN, kind };
          const clean = observation({
            attributes: { 'data-trust-surface': kind, 'data-decision': state },
          });
          const broken = deformation.build(clean);
          for (const [name, clause] of Object.entries(
            evaluateSurface({ plan, normal: broken, reduced: broken, motionAfter: broken }),
          )) {
            expect(clause.verdict, `${kind}/${state}/${deformation.label}/${name}`).not.toBe(
              'passed',
            );
            expect(['failed', 'not-run', 'not-applicable']).toContain(clause.verdict);
            expect(clause.reason, `${kind}/${state}/${deformation.label}/${name}`).toBeTruthy();
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(kinds.length * states.length * deformations.length * 4);
  });

  it('always attaches a non-empty, value-bearing reason to every failed verdict', () => {
    const states = ['undecided', 'pending', 'rejected', 'failed', 'none'];
    for (const state of states) {
      const poisoned = observation({
        attributes: { 'data-trust-surface': 'proposal', 'data-decision': state },
        paint: [{ ...neutralPaint('span.status'), color: POSITIVE }],
        motion: [
          { ...stillMotion('button'), transitionProperty: 'all', transitionDuration: '0.2s' },
        ],
        runningAnimations: [
          { node: 'button', playState: 'running', type: 'CSSTransition', name: 'background-color' },
        ],
      });
      for (const clause of Object.values(
        evaluateSurface({ plan: PLAN, normal: poisoned, reduced: poisoned, motionAfter: poisoned }),
      )) {
        if (clause.verdict !== 'failed') continue;
        // The observed value, not an adjective. A failure a reader cannot check is a rumour.
        expect(clause.reason).toMatch(/rgb\(|0\.2s|all|CSSTransition/);
      }
    }
  });

  it('reports every success-token hit, not merely the first, so a fix is not whack-a-mole', () => {
    const hits = successPaints(
      observation({
        paint: [
          { ...neutralPaint('a'), color: POSITIVE, borderTopColor: POSITIVE },
          { ...neutralPaint('b'), backgroundColor: POSITIVE },
        ],
      }),
    );
    expect(hits).toHaveLength(3);
    expect(new Set(hits.map((hit) => hit.node))).toEqual(new Set(['a', 'b']));
  });
});
