import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  MOTION_DECEPTION_CORPUS,
  clauseRunMode,
  collectTrustSurfaceCensus,
  motionDeceptionCoverage,
  trustSurfaceChecks,
} from '../nodeslide-trust-surface-census.mjs';

/*
 * These are the knockouts, made permanent.
 *
 * Each clause of the trust-surfaces gate was broken by hand once — an annotation removed, a
 * pending element painted with a success token, a transition added to a decision affordance —
 * and each went red. A knockout run once and reported in a PR description is a knockout the
 * next reader has to take on faith, and the check quietly rots into a line that has never
 * failed. So every break is reproduced here against a fixture tree: the census is pointed at
 * a temporary directory containing a deliberately broken component, and the finding it must
 * report is asserted by file, by component, and by the reason.
 *
 * The persona throughout is the one the gate exists for: an engineer shipping a UI change
 * that happens to touch a surface where somebody decides whether to trust an agent, who has
 * no idea this rule exists and will never read the skill. The gate is the only thing between
 * that change and a proposal card that looks accepted before anyone accepted it.
 */

const directories = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);

async function fixture(files) {
  const dir = await mkdtemp(path.join(tmpdir(), 'trust-surface-'));
  directories.push(dir);
  for (const [name, contents] of Object.entries(files)) {
    const full = path.join(dir, name);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, contents, 'utf8');
  }
  return dir;
}

const census = (dir) => collectTrustSurfaceCensus({ srcDir: dir, relativeTo: dir });

/** A proposal card with Accept/Reject and no annotation — the surface nobody remembered. */
const UNANNOTATED_CARD = `
export function ShipItCard({ onAccept, onReject, proposal }) {
  return (
    <div className="ns-ship-card">
      <p>{proposal.summary}</p>
      <button type="button" onClick={() => onAccept(proposal)}>
        Accept
      </button>
      <button type="button" onClick={() => onReject(proposal)}>
        Reject
      </button>
    </div>
  );
}
`;

const ANNOTATED_CARD = `
export function ShipItCard({ onAccept, onReject, proposal }) {
  return (
    <div className="ns-ship-card" data-trust-surface="proposal" data-decision="undecided" data-proposal-origin="free_route">
      <p>{proposal.summary}</p>
      <button type="button" onClick={() => onAccept(proposal)}>
        Accept
      </button>
      <button type="button" onClick={() => onReject(proposal)}>
        Reject
      </button>
    </div>
  );
}
`;

describe('trust-surface census — clause 1, enumeration', () => {
  it('reports an unannotated decision surface as not-run, by file and component', async () => {
    const dir = await fixture({ 'ShipItCard.tsx': UNANNOTATED_CARD });
    const result = await census(dir);

    expect(result.annotated).toHaveLength(0);
    expect(result.notRun.map((entry) => entry.component)).toEqual(['ShipItCard']);
    expect(result.notRun[0].file).toBe('ShipItCard.tsx');
    // not-run is a POSITION, not an absence: the surface must be named so it can be examined.
    expect(result.notRun[0].line).toBeGreaterThan(0);
    expect(result.notRun[0].hits.length).toBeGreaterThan(0);
  });

  it('stops reporting it the moment the component declares itself', async () => {
    const dir = await fixture({ 'ShipItCard.tsx': ANNOTATED_CARD });
    const result = await census(dir);

    expect(result.notRun).toHaveLength(0);
    expect(result.annotated).toHaveLength(1);
    expect(result.annotated[0]).toMatchObject({ component: 'ShipItCard', kind: 'proposal' });
  });

  it('binds an annotation to its own component, not to the file', async () => {
    // The failure this prevents: a 2000-line inspector annotates one of its three surfaces
    // and a file-level gate calls the whole file covered.
    const dir = await fixture({
      'TwoSurfaces.tsx': `${ANNOTATED_CARD}\n${UNANNOTATED_CARD.replace('ShipItCard', 'SecondCard')}`,
    });
    const result = await census(dir);

    expect(result.annotated.map((entry) => entry.component)).toEqual(['ShipItCard']);
    expect(result.notRun.map((entry) => entry.component)).toEqual(['SecondCard']);
  });

  it('finds a surface that uses none of the accept/reject vocabulary', async () => {
    // The publication sign-off ceremony was invisible to the earlier hand census for exactly
    // this reason: it calls `onApproveWithToken?.()`, so a sweep looking for "Accept" and
    // "onAccept" saw nothing at all.
    const dir = await fixture({
      'SignOff.tsx': `
export function SignOff({ onApproveWithToken, token, version }) {
  return (
    <section className="ns-sign-off">
      <button type="button" onClick={() => onApproveWithToken?.(token, version)}>
        Sign off v{version}
      </button>
    </section>
  );
}
`,
    });
    const result = await census(dir);

    expect(result.notRun.map((entry) => entry.component)).toEqual(['SignOff']);
  });

  it('does not flag prose that merely describes a decision', async () => {
    // "Accepted edits will appear here" and "Rejected substitutes" are descriptions, not
    // affordances. A sweep that flags them buys its recall with an allowlist full of nothing.
    const dir = await fixture({
      'EmptyStates.tsx': `
export function EmptyStates() {
  return (
    <div>
      <p>Accepted edits will appear here.</p>
      <h3>Rejected substitutes</h3>
    </div>
  );
}
`,
    });
    const result = await census(dir);

    expect(result.notRun).toHaveLength(0);
    expect(result.byComponent.size).toBe(0);
  });
});

describe('trust-surface census — clause 3, not styled to imply an outcome', () => {
  it('catches a transition on a decision affordance', async () => {
    const dir = await fixture({
      'ShipItCard.tsx': ANNOTATED_CARD,
      'ship.css': '.ns-ship-card {\n  transition: border-color 120ms ease;\n}\n',
    });
    const result = await census(dir);
    const rule = result.cssRules.find((entry) => entry.selector === '.ns-ship-card');

    expect(rule).toBeDefined();
    expect(rule.body).toContain('transition');
    // The surface's own class is derived off its annotated tag; nothing is hand-listed.
    expect(result.annotated[0].classes).toContain('ns-ship-card');
  });

  it('reports a clean selector, not the comment that precedes it', async () => {
    // A failure message whose "selector" starts at the previous closing brace buries the name
    // of the surface it exists to report — the one thing the reader needs.
    const dir = await fixture({
      'ShipItCard.tsx': ANNOTATED_CARD,
      'ship.css':
        '.other {\n  color: red;\n}\n\n/*\n * A long explanation.\n */\n.ns-ship-card {\n  transition: opacity 1ms;\n}\n',
    });
    const result = await census(dir);
    const selectors = result.cssRules.map((entry) => entry.selector);

    expect(selectors).toContain('.ns-ship-card');
    expect(selectors.some((selector) => selector.includes('explanation'))).toBe(false);
  });

  it('keeps CSS line numbers true after comments are blanked', async () => {
    const dir = await fixture({
      'ShipItCard.tsx': ANNOTATED_CARD,
      'ship.css': '/*\n * three\n * line\n * comment\n */\n.ns-ship-card {\n  color: red;\n}\n',
    });
    const result = await census(dir);

    expect(result.cssRules.find((entry) => entry.selector === '.ns-ship-card').line).toBe(6);
  });
});

/*
 * ======================================================================================
 * THE MOTION DECEPTION CORPUS
 *
 * Seven ways motion lies while passing a naive motion check. Each one is built here as a
 * NodeSlide-shaped trust surface — an annotated proposal card with Accept and Reject, the
 * exact shape of the cards in AgentThread and JsonInspector — and the REAL checks are run
 * against it. The verdict recorded in MOTION_DECEPTION_CORPUS is then cross-checked against
 * what the gate actually did.
 *
 * That cross-check is the point. A graded table maintained by hand drifts toward flattery:
 * someone deletes a detector, the table still says "detected", and the coverage line goes on
 * advertising a check that no longer runs. Here the table is the EXPECTATION and the fixture
 * is the OBSERVATION, so the two cannot disagree without turning the suite red.
 *
 * The persona is the one who makes this deception real without meaning to: an engineer under
 * deadline who wants the proposal card to feel responsive, reaches for whichever motion tool
 * is nearest, and never learns that a card which drifts toward green is a card that answered
 * the question before the human did.
 * ======================================================================================
 */

/** The annotated proposal card every corpus fixture deceives. `extra` goes on the className. */
const proposalCard = ({ extra = '', styleProp = '', tag = 'div', body = '' } = {}) => `
export function ShipItCard({ onAccept, onReject, proposal }) {
  return (
    <${tag} className="ns-ship-card${extra}" data-trust-surface="proposal" data-decision="undecided" data-proposal-origin="free_route"${styleProp}>
      ${body}<p>{proposal.summary}</p>
      <button type="button" onClick={() => onAccept(proposal)}>
        Accept
      </button>
      <button type="button" onClick={() => onReject(proposal)}>
        Reject
      </button>
    </${tag}>
  );
}
`;

/**
 * Each corpus id maps to the fixtures that exhibit it. `red` is the assertion: true means
 * this gate must go red on it, false means the deception survives a green run.
 *
 * `check` names the label fragment that must be the one to fire, so a fixture cannot be
 * scored "caught" by an unrelated failure. The first grading run of this corpus reported all
 * seven deceptions CAUGHT — every one of them by the same irrelevant stale-allowlist error,
 * because the shipped allowlist names real repository paths and every entry is stale against
 * a fixture tree. `allowlist: []` below is why the verdicts mean anything.
 */
const CORPUS_FIXTURES = {
  1: [
    {
      name: 'annotated surface behind a false guard, never rendered',
      red: false,
      files: {
        'ShipItCard.tsx': proposalCard(),
        'Host.tsx': `
import { ShipItCard } from './ShipItCard';
export function Host({ proposal, onAccept, onReject }) {
  const SHOW_PROPOSALS = false;
  return <div>{SHOW_PROPOSALS && <ShipItCard proposal={proposal} onAccept={onAccept} onReject={onReject} />}</div>;
}
`,
      },
    },
  ],
  2: [
    {
      name: 'motion on an off-screen decoy, real surface untouched',
      red: false,
      files: {
        'ShipItCard.tsx': proposalCard(),
        'ship.css':
          '.ns-ship-card {\n  border: 1px solid var(--ns-line);\n}\n\n.ns-approval-echo {\n  position: absolute;\n  left: -9999px;\n  animation: settle-to-approved 600ms ease forwards;\n}\n',
      },
    },
  ],
  3: [
    {
      name: 'live timestamp inside the trust surface',
      red: false,
      files: {
        'ShipItCard.tsx': proposalCard({
          body: '<time>{new Date().toLocaleTimeString()}</time>\n      ',
        }),
      },
    },
  ],
  4: [
    {
      name: '4a approval motion declared in CSS',
      red: true,
      check: 'no CSS transition/animation on an enumerated decision surface',
      files: {
        'ShipItCard.tsx': proposalCard(),
        'ship.css':
          '.ns-ship-card {\n  animation: settle-to-approved 400ms ease forwards;\n  background: var(--ns-positive);\n}\n',
      },
    },
    {
      name: '4b approval motion as a utility class',
      red: true,
      check: 'no motion utility class on an enumerated decision surface',
      files: { 'ShipItCard.tsx': proposalCard({ extra: ' transition-colors duration-500' }) },
    },
    {
      name: '4c approval motion in an inline style prop',
      red: true,
      check: 'no inline style motion on an enumerated decision surface',
      files: {
        'ShipItCard.tsx': proposalCard({
          styleProp:
            " style={{ transition: 'background-color 400ms ease', background: 'var(--ns-positive)' }}",
        }),
      },
    },
    {
      name: '4d approval motion via Framer Motion props',
      red: true,
      check: 'no Framer Motion animation prop on an enumerated decision surface',
      files: {
        'ShipItCard.tsx': `
import { motion } from 'framer-motion';
export function ShipItCard({ onAccept, onReject, proposal }) {
  return (
    <motion.div
      className="ns-ship-card"
      data-trust-surface="proposal"
      data-decision="undecided"
      data-proposal-origin="free_route"
      initial={{ borderColor: 'var(--ns-line)' }}
      animate={{ borderColor: 'var(--ns-positive)' }}
      transition={{ duration: 0.4 }}
    >
      <p>{proposal.summary}</p>
      <button type="button" onClick={() => onAccept(proposal)}>
        Accept
      </button>
      <button type="button" onClick={() => onReject(proposal)}>
        Reject
      </button>
    </motion.div>
  );
}
`,
      },
    },
    {
      name: '4e approval motion via the Web Animations API',
      red: true,
      check: 'no Web Animations API call in a component owning a decision surface',
      files: {
        'ShipItCard.tsx': `
import { useEffect, useRef } from 'react';
export function ShipItCard({ onAccept, onReject, proposal }) {
  const cardRef = useRef(null);
  useEffect(() => {
    cardRef.current?.animate(
      [{ background: 'transparent' }, { background: 'var(--ns-positive)' }],
      { duration: 400, fill: 'forwards' },
    );
  }, []);
  return (
    <div ref={cardRef} className="ns-ship-card" data-trust-surface="proposal" data-decision="undecided" data-proposal-origin="free_route">
      <p>{proposal.summary}</p>
      <button type="button" onClick={() => onAccept(proposal)}>
        Accept
      </button>
      <button type="button" onClick={() => onReject(proposal)}>
        Reject
      </button>
    </div>
  );
}
`,
      },
    },
  ],
  5: [
    {
      name: 'prefers-reduced-motion repaints the card in the approval colour',
      red: false,
      files: {
        'ShipItCard.tsx': proposalCard(),
        'ship.css':
          '.ns-ship-card {\n  border: 1px solid var(--ns-line);\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .ns-ship-card {\n    border-color: var(--ns-positive);\n    background: var(--ns-positive);\n  }\n}\n',
      },
    },
  ],
  6: [
    {
      name: 'GSAP tween whose knockout path sets duration to zero',
      red: false,
      files: {
        'ShipItCard.tsx': `
import { useEffect } from 'react';
import gsap from 'gsap';
export function ShipItCard({ onAccept, onReject, proposal, prefersReduced }) {
  useEffect(() => {
    gsap.to('.ns-ship-card', {
      backgroundColor: 'var(--ns-positive)',
      duration: prefersReduced ? 0 : 0.6,
    });
  }, [prefersReduced]);
  return (
    <div className="ns-ship-card" data-trust-surface="proposal" data-decision="undecided" data-proposal-origin="free_route">
      <p>{proposal.summary}</p>
      <button type="button" onClick={() => onAccept(proposal)}>
        Accept
      </button>
      <button type="button" onClick={() => onReject(proposal)}>
        Reject
      </button>
    </div>
  );
}
`,
      },
    },
  ],
  7: [
    {
      name: 'compliant source; the motion exists only in the recording',
      red: false,
      files: {
        'ShipItCard.tsx': proposalCard(),
        'ship.css': '.ns-ship-card {\n  border: 1px solid var(--ns-line);\n}\n',
      },
    },
  ],
};

/**
 * Run the real checks against a fixture tree, with BOTH repo allowlists out of the way.
 *
 * The authorless table is emptied for the same reason the reviewed-non-surface one is: it names
 * two real repository components, so against a fixture tree both entries are stale and the
 * staleness check goes red on both. That red drowns the finding the fixture exists to produce.
 * A fixture must be able to fail for its own reason.
 */
async function gradeFixture(files) {
  const dir = await fixture(files);
  const { checks } = await trustSurfaceChecks({
    srcDir: dir,
    relativeTo: dir,
    allowlist: [],
    proposalOriginAllowlist: [],
  });
  return checks.filter(([, passed]) => !passed).map(([label, , detail]) => ({ label, detail }));
}

describe('motion deception corpus — graded, fixture by fixture', () => {
  for (const entry of MOTION_DECEPTION_CORPUS) {
    const fixtures = CORPUS_FIXTURES[entry.id] ?? [];

    // An entry with no fixture cannot have been graded, only asserted.
    it(`#${entry.id} ${entry.deception} — has at least one fixture`, () => {
      expect(fixtures.length).toBeGreaterThan(0);
    });

    for (const scenario of fixtures) {
      it(`#${entry.id} ${scenario.name} — is ${scenario.red ? 'CAUGHT' : 'MISSED'}`, async () => {
        const failures = await gradeFixture(scenario.files);

        if (scenario.red) {
          expect(failures.length).toBeGreaterThan(0);
          // Caught by the RIGHT check. A fixture that goes red for an unrelated reason is
          // not coverage, it is a coincidence that will evaporate on the next refactor.
          expect(failures.some((f) => f.label.includes(scenario.check))).toBe(true);
        } else {
          // The deception survives. This assertion is the honest half of the corpus: it
          // pins a KNOWN HOLE so that closing it is a deliberate act that updates the table,
          // rather than something that happens by accident and nobody notices.
          expect(failures).toEqual([]);
        }
      });
    }

    // The bond between the table and the fixtures. `detected` must mean every fixture for
    // that class goes red; `not-detected` must mean none of them do.
    it(`#${entry.id} — the recorded verdict "${entry.verdict}" matches what the gate does`, async () => {
      const results = await Promise.all(
        fixtures.map(async (scenario) => (await gradeFixture(scenario.files)).length > 0),
      );
      const everyFixtureRed = results.every(Boolean);
      const noFixtureRed = results.every((red) => !red);

      if (entry.verdict === 'detected') {
        expect(everyFixtureRed).toBe(true);
        expect(entry.mode).toBe('STATIC');
      } else {
        expect(noFixtureRed).toBe(true);
        // A miss must name the runner that would decide it, and that runner is PROBED.
        expect(entry.mode).toBe('NOT-RUN');
      }
    });
  }

  it('records a verdict for all seven corpus classes, with no gaps', () => {
    expect(MOTION_DECEPTION_CORPUS.map((entry) => entry.id).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('motion deception corpus — the three routes a CSS-only scan could not see', () => {
  /*
   * Knockouts for the checks added because of this corpus. All three are TRIPWIREs: src/ has
   * no framer-motion dependency, no `.animate(` call and no inline style motion, so none of
   * them can fail on the repository today. That is exactly why the knockout has to live here.
   * A tripwire that has never been observed firing is indistinguishable from a broken regex,
   * and the next reader is right to delete it.
   *
   * THESE KNOCKOUTS ARE CAUSAL, which is corpus fixture #6 applied to this file. Each pair is
   * a tree in which the offending construct DOES NOT EXIST versus one in which it does — the
   * cause is prevented from being constructed, and the check's verdict is observed to change.
   * The tempting cheap version — keep the construct and neutralise it (`duration: 0`,
   * `timeScale(0)`) — is exactly the deception #6 describes: the end state still arrives, so
   * the comparison still differs and the knockout passes while proving nothing.
   */
  const cases = [
    [
      'inline style prop',
      'no inline style motion on an enumerated decision surface',
      proposalCard({ styleProp: " style={{ transition: 'background-color 400ms ease' }}" }),
    ],
    [
      'Framer Motion animate prop',
      'no Framer Motion animation prop on an enumerated decision surface',
      proposalCard().replace(
        'data-decision="undecided"',
        'data-decision="undecided" animate={{ borderColor: green }}',
      ),
    ],
    [
      'bare <motion.div> with no props yet',
      'no Framer Motion animation prop on an enumerated decision surface',
      proposalCard({ tag: 'motion.div' }),
    ],
    [
      'WAAPI .animate() from an effect',
      'no Web Animations API call in a component owning a decision surface',
      proposalCard().replace(
        'return (',
        'useEffect(() => { ref.current.animate(frames, 400); }, []);\n  return (',
      ),
    ],
  ];

  for (const [name, label, source] of cases) {
    it(`goes red on ${name}`, async () => {
      const failures = await gradeFixture({ 'ShipItCard.tsx': source });
      expect(failures.map((f) => f.label).join(' | ')).toContain(label);
    });
  }

  it('stays green on a decision surface with no motion at all', async () => {
    // The other half of a knockout: the check must be silent on the compliant case, or it is
    // not a detector, it is a permanent failure that will be suppressed rather than fixed.
    expect(await gradeFixture({ 'ShipItCard.tsx': proposalCard() })).toEqual([]);
  });

  it('ignores motion on a failed-state surface, which is policed by a different rule', async () => {
    // Scope check. `failed-state` is a readout, not an affordance; a loading pulse there is
    // legitimate and is governed by "failure never looks like loading" instead.
    const failures = await gradeFixture({
      'Status.tsx': `
export function DeckCiStatus({ onAccept, state }) {
  return (
    <div className="ns-ci" data-trust-surface="failed-state" data-state={state} style={{ transition: 'opacity 200ms' }}>
      <button type="button" onClick={() => onAccept()}>Accept</button>
    </div>
  );
}
`,
    });
    expect(failures.map((f) => f.label).join(' | ')).not.toContain('inline style motion');
  });
});

/* ------------------------------------- authorship: the second fact a proposal must publish */

/*
 * Scenario: an engineer restyles the proposal card. The visible copy is untouched — the card
 * still says "Deterministic fallback" where it should — but a wrapper is introduced, or a prop
 * spread is tidied up, and the attribute that made authorship machine-readable goes with it.
 * Nothing else about the component changes and nothing else in the suite notices.
 *
 * That is the exact shape of the `data-agent-web-consent` regression: a surface that keeps
 * working perfectly while the fact a reader needs stops being published. The knockouts below
 * are the four ways it can happen, each pinned to the check that must name it.
 */
describe('a proposal that will not say who wrote it', () => {
  const KNOCKOUTS = [
    {
      name: 'the attribute is dropped entirely — presence, not value, is the assertion',
      source: proposalCard().replace(' data-proposal-origin="free_route"', ''),
      label: 'every proposal surface publishes data-proposal-origin',
      detail: 'ShipItCard',
    },
    {
      name: 'the value is stringified from a missing field into the word "undefined"',
      source: proposalCard().replace(
        'data-proposal-origin="free_route"',
        'data-proposal-origin="undefined"',
      ),
      label: 'stringified into the literal "undefined"',
      detail: 'ShipItCard',
    },
    {
      name: 'the value is coerced with String(), routing around the one guard that exists',
      source: proposalCard().replace(
        'data-proposal-origin="free_route"',
        'data-proposal-origin={String(proposal.origin)}',
      ),
      label: 'stringified into the literal "undefined"',
      detail: 'ShipItCard',
    },
    {
      name: 'a plausible-looking word nobody declared is invented',
      source: proposalCard().replace(
        'data-proposal-origin="free_route"',
        'data-proposal-origin="model"',
      ),
      label: 'written by nodeSlideProposalOriginAttribute',
      detail: 'literal "model"',
    },
    {
      name: 'the value is computed inline, bypassing the function that refuses bad values',
      source: proposalCard().replace(
        'data-proposal-origin="free_route"',
        'data-proposal-origin={proposal.origin ?? "unknown"}',
      ),
      label: 'written by nodeSlideProposalOriginAttribute',
      detail: 'does not go through',
    },
  ];

  for (const knockout of KNOCKOUTS) {
    it(`goes red when ${knockout.name}`, async () => {
      const failures = await gradeFixture({ 'ShipItCard.tsx': knockout.source });
      const matching = failures.filter((f) => f.label.includes(knockout.label));
      // Red by the RIGHT check, and naming the surface. A failure that does not say WHERE
      // sends the next reader to read the whole tree, which is how a gate stops being run.
      expect(matching, JSON.stringify(failures)).toHaveLength(1);
      expect(matching[0].detail).toContain(knockout.detail);
    });
  }

  it('stays green on a proposal that publishes a declared origin', async () => {
    // The other half of every knockout. A check that has never been silent is not a detector.
    expect(await gradeFixture({ 'ShipItCard.tsx': proposalCard() })).toEqual([]);
  });

  it('accepts `unattributed` — a legacy row saying so is an answer, not a hole', async () => {
    const source = proposalCard().replace(
      'data-proposal-origin="free_route"',
      'data-proposal-origin="unattributed"',
    );
    expect(await gradeFixture({ 'ShipItCard.tsx': source })).toEqual([]);
  });

  it('accepts the shared mapping function, which is where the value is supposed to come from', async () => {
    const source = proposalCard().replace(
      'data-proposal-origin="free_route"',
      'data-proposal-origin={nodeSlideProposalOriginAttribute(proposal.origin)}',
    );
    expect(await gradeFixture({ 'ShipItCard.tsx': source })).toEqual([]);
  });

  it('cannot be silenced by moving every surface into the authorless table', async () => {
    /*
     * The cheapest way to make the presence check quiet is not to delete it — it is to exempt
     * everything, one locally-reasonable entry at a time, until the gate polices an empty set.
     * The non-empty check is what makes that fail as loudly as deleting the attribute would.
     */
    const dir = await fixture({
      'ShipItCard.tsx': proposalCard().replace(' data-proposal-origin="free_route"', ''),
    });
    const { checks } = await trustSurfaceChecks({
      srcDir: dir,
      relativeTo: dir,
      allowlist: [],
      proposalOriginAllowlist: [
        {
          file: 'ShipItCard.tsx',
          component: 'ShipItCard',
          reason:
            'a plausible-sounding exemption long enough to satisfy the reason check, which is exactly how this hole would be opened in practice',
        },
      ],
    });
    const failed = checks.filter(([, passed]) => !passed).map(([label]) => label);
    expect(failed.join(' | ')).toContain('at least one surface actually carries');
    // And the presence check itself is genuinely quiet — proving the non-empty check is the
    // thing catching this, not a coincidental second failure.
    expect(failed.join(' | ')).not.toContain('every proposal surface publishes');
  });

  it('expires an exemption the moment the surface it names grows an origin', async () => {
    // A stale exemption is a hole with a story attached: it would go on excusing the NEXT
    // surface to lose the attribute long after it stopped describing anything real.
    const dir = await fixture({ 'ShipItCard.tsx': proposalCard() });
    const { checks } = await trustSurfaceChecks({
      srcDir: dir,
      relativeTo: dir,
      allowlist: [],
      proposalOriginAllowlist: [
        {
          file: 'ShipItCard.tsx',
          component: 'ShipItCard',
          reason: 'this card has no authorship to publish — which stopped being true',
        },
      ],
    });
    const stale = checks.find(([label]) => label.includes('no stale entry in the authorless'));
    expect(stale?.[1]).toBe(false);
    expect(stale?.[2]).toContain('ShipItCard');
  });

  it('refuses an exemption that states no reason', async () => {
    const dir = await fixture({
      'ShipItCard.tsx': proposalCard().replace(' data-proposal-origin="free_route"', ''),
    });
    const { checks } = await trustSurfaceChecks({
      srcDir: dir,
      relativeTo: dir,
      allowlist: [],
      proposalOriginAllowlist: [{ file: 'ShipItCard.tsx', component: 'ShipItCard', reason: 'n/a' }],
    });
    const reasoned = checks.find(([label]) => label.includes('states why it has no origin'));
    expect(reasoned?.[1]).toBe(false);
  });

  it('leaves consent, permission and failed-state surfaces alone — they carry nobody drafts', async () => {
    /*
     * Scope, asserted rather than assumed. `consent` answers how egress was authorized,
     * `permission` answers whether a grant has happened, `failed-state` is a readout. None of
     * them presents someone's draft for approval, so demanding an author of them would be a
     * gate inventing a requirement, and inventing requirements is how gates get suppressed.
     */
    const failures = await gradeFixture({
      'Consent.tsx': `
export function WebConsent({ onGrant, posture }) {
  return (
    <div data-trust-surface="consent" data-agent-web-consent={posture}>
      <button type="button" onClick={() => onGrant()}>Grant</button>
    </div>
  );
}
`,
    });
    const labels = failures.map((f) => f.label).join(' | ');
    expect(labels).not.toContain('every proposal surface publishes');
    expect(labels).not.toContain('stringified into the literal');
    expect(labels).not.toContain('written by nodeSlideProposalOriginAttribute');
    // The non-empty check DOES fire here, and correctly: a tree whose only trust surface is a
    // consent banner has no proposal authorship to police, so the gate is watching nothing.
    // Asserted rather than filtered away, because "the gate is watching nothing" is precisely
    // the state this check exists to refuse to call a pass.
    expect(labels).toContain('at least one surface actually carries');
  });
});

describe('motion deception corpus — the table cannot overstate itself', () => {
  const graded = (corpus) =>
    trustSurfaceChecks({ corpus }).then(({ checks }) =>
      checks.filter(([, passed]) => !passed).map(([label]) => label),
    );

  it('fails when a corpus entry carries no verdict', async () => {
    // THE central anti-drift claim, made falsifiable. Adding an eighth deception without
    // grading it must be a red gate — an ungraded fixture is coverage overstated, the same
    // error as reporting a not-run clause as passed.
    const labels = await graded([
      ...MOTION_DECEPTION_CORPUS,
      { id: 8, deception: 'motion injected by a third-party widget', fixture: 'none', why: 'tbd' },
    ]);
    expect(labels.join(' | ')).toContain('every fixture carries a verdict');
  });

  it('fails when an entry claims a detector that does not exist', async () => {
    const labels = await graded([
      { ...MOTION_DECEPTION_CORPUS[3], detectors: ['clause 9: a check nobody ever wrote'] },
    ]);
    expect(labels.join(' | ')).toContain('names a check that actually exists');
  });

  it('fails when an entry claims "detected" but names no detector', async () => {
    const labels = await graded([{ ...MOTION_DECEPTION_CORPUS[3], detectors: [] }]);
    expect(labels.join(' | ')).toContain('names a check that actually exists');
  });

  it('fails when two entries share an id', async () => {
    const labels = await graded([MOTION_DECEPTION_CORPUS[0], MOTION_DECEPTION_CORPUS[0]]);
    expect(labels.join(' | ')).toContain('fixture ids are unique');
  });
});

describe('motion deception corpus — the coverage the gate prints about itself', () => {
  it('states a denominator, so a green run cannot read as "no deceptive motion exists"', async () => {
    const text = (await motionDeceptionCoverage()).join('\n');

    expect(text).toContain(`of ${MOTION_DECEPTION_CORPUS.length} known deception classes`);
    expect(text).toContain('It is not evidence that no deceptive motion exists');
  });

  it('names every corpus class, detected or not, with its reason', async () => {
    const text = (await motionDeceptionCoverage()).join('\n');

    for (const entry of MOTION_DECEPTION_CORPUS) {
      expect(text).toContain(entry.deception);
      expect(text).toContain(entry.why);
      expect(text).toContain(entry.verdict === 'detected' ? 'DETECTED' : 'NOT-DETECTED');
    }
  });

  it('cites a PROBED runner for every not-detected class, never a bare command', async () => {
    const text = (await motionDeceptionCoverage()).join('\n');
    const misses = MOTION_DECEPTION_CORPUS.filter((entry) => entry.verdict !== 'detected');

    expect(misses.length).toBeGreaterThan(0);
    // Same rule as the not-run clauses: the command is probed, so the day the spec is written
    // this text changes by itself. A gate that cites a runner which does not exist has told
    // the reader the hole is one command from closed when nothing of the sort is true.
    expect(text).toMatch(/NO RUNNER YET|npx playwright test/);
  });
});

describe('trust-surface gate — the repository itself', () => {
  it('passes every static clause with no surface left not-run', async () => {
    const { checks, census: repo } = await trustSurfaceChecks();
    const failures = checks.filter(([, passed]) => !passed);

    expect(failures.map(([label]) => label)).toEqual([]);
    expect(repo.notRun).toEqual([]);
    expect(repo.annotated.length).toBeGreaterThan(0);
  });

  it('enumerates every kind the shipped surfaces actually use', async () => {
    const { census: repo } = await trustSurfaceChecks();
    const kinds = new Set(repo.annotated.map((entry) => entry.kind));

    // Locks the four decision surfaces this gate was built to audit plus the two it found:
    // proposal (agent thread, JSON editor, OpenUI lab, proposal card), diff-review (variation
    // card, compare receipt), consent (composer), permission (publication sign-off),
    // failed-state (Deck CI).
    expect([...kinds].sort()).toEqual([
      'consent',
      'diff-review',
      'failed-state',
      'permission',
      'proposal',
    ]);
  });

  it('never reports a browser-only clause as passed', async () => {
    const modes = await clauseRunMode();
    const notRun = modes.filter(([, mode]) => mode === 'NOT-RUN');

    // Clause 4 (screenshot states match DOM states) and cascade resolution cannot be decided
    // from source text. They must stay visible as not-run; silently dropping them would make
    // a green run look like full coverage of the rule.
    expect(notRun).toHaveLength(2);
    expect(notRun.some(([clause]) => clause.includes('clause 4'))).toBe(true);
    for (const [, , note] of notRun) {
      // The runner is probed, never asserted: a not-run that cites a command which does not
      // exist is its own small lie.
      expect(note).toMatch(/NO RUNNER YET|npx playwright test/);
    }
  });
});
