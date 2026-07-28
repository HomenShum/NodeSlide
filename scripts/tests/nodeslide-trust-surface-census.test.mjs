import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  clauseRunMode,
  collectTrustSurfaceCensus,
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
    <div className="ns-ship-card" data-trust-surface="proposal" data-decision="undecided">
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
