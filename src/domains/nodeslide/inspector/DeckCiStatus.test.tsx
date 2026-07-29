// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NodeSlideDeckCiResult,
  NodeSlideDeckCiStatus,
} from '../../../../convex/lib/nodeslideDeckCi';
import { DeckCiStatus } from './DeckCiStatus';

afterEach(cleanup);

function ciResult(
  status: NodeSlideDeckCiStatus,
  blockerCount = 0,
  warningCount = 0,
): NodeSlideDeckCiResult {
  return {
    schemaVersion: 'nodeslide.deck-ci/v1',
    deckId: 'deck_ci',
    deckVersion: 3,
    snapshotDigest: 'snapshot-digest',
    referenceTime: 1_720_000_000_000,
    status,
    checks: [],
    blockerCount,
    severityCounts: { critical: 0, error: blockerCount, warning: warningCount, info: 0 },
    affectedSlideIds: [],
    affectedElementIds: [],
    affectedSourceIds: [],
    changedSourceImpact: {
      changedSourceIds: [],
      boundSourceIds: [],
      unboundSourceIds: [],
      missingSourceIds: [],
      slideIds: [],
      elementIds: [],
    },
    validation: {
      id: 'validation_ci',
      supplied: true,
      inputAccepted: true,
      ok: blockerCount === 0,
      publishOk: blockerCount === 0,
      cleanOk: blockerCount === 0 && warningCount === 0,
    },
    semantic: { id: 'semantic_ci', verdict: status === 'fail' ? 'blocked' : 'pass' },
    digest: 'ci-digest',
  };
}

describe('DeckCiStatus', () => {
  it.each([
    { props: { result: null, loading: true }, state: 'loading', label: 'Checking' },
    { props: { result: ciResult('pass') }, state: 'pass', label: 'Passed' },
    { props: { result: ciResult('warn', 0, 2) }, state: 'warn', label: 'Warnings' },
    { props: { result: ciResult('fail', 3, 1) }, state: 'fail', label: 'Failed' },
    { props: { result: null }, state: 'unavailable', label: 'Unavailable' },
    {
      props: { result: ciResult('pass'), error: new Error('network down') },
      state: 'unavailable',
      label: 'Unavailable',
    },
  ])('renders the $state state in the live region', ({ props, state, label }) => {
    render(<DeckCiStatus {...props} />);

    const liveRegion = screen.getByRole('status');
    expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    expect(liveRegion).toHaveAttribute('aria-atomic', 'true');
    expect(liveRegion).toHaveAttribute('data-state', state);
    expect(liveRegion).toHaveTextContent(`Deck CI${label}`);
  });

  it('shows blocker and warning counts without rendering check details', () => {
    render(<DeckCiStatus result={ciResult('fail', 2, 1)} />);

    expect(screen.getByRole('status')).toHaveTextContent('Deck CIFailed2 blockers · 1 warning');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('uses a native button and opens Trace with Enter and Space', async () => {
    const onOpenTrace = vi.fn();
    const user = userEvent.setup();
    render(<DeckCiStatus result={ciResult('warn', 0, 2)} onOpenTrace={onOpenTrace} />);

    const button = screen.getByRole('button', {
      name: 'Deck CI Warnings, 0 blockers, 2 warnings. Open Trace',
    });
    button.focus();

    await user.keyboard('{Enter}');
    await user.keyboard('[Space]');

    expect(onOpenTrace).toHaveBeenCalledTimes(2);
  });
});

/**
 * Wiring guard. The gate is only a gate if it is on the screen where a proposal is accepted;
 * a version that ships the component and never mounts it would pass every test above.
 */
describe('Deck CI status wiring', () => {
  const aiSource = readFileSync('src/domains/nodeslide/inspector/AiInspector.tsx', 'utf8');
  const panelSource = readFileSync('src/domains/nodeslide/inspector/InspectorPanel.tsx', 'utf8');
  const studioSource = readFileSync('src/domains/nodeslide/NodeSlideStudio.tsx', 'utf8');

  it('mounts above the AI composer and reaches the live query', () => {
    expect(aiSource).toContain('<DeckCiStatus');
    expect(aiSource).toContain('onOpenTrace: onOpenDeckCiTrace');
    expect(panelSource).toContain("onOpenDeckCiTrace={() => onTabChange('trace')}");
    expect(studioSource).toContain('nodeslideApi.nodeslideDeckCi.evaluateLatest');
    expect(studioSource).toContain('deckCiResult={deckCiResult ?? null}');
  });

  it('never reports a settled status while the query is still unresolved', () => {
    // `deckCiResult === undefined` is Convex's "still loading"; treating it as a result would
    // render "Unavailable" for every deck on first paint.
    expect(studioSource).toContain('deckCiResult === undefined');
  });
});

/*
 * trust-surfaces clause 1 on Deck CI.
 *
 * Persona: an agent asked to export a deck. Before it exports it wants to know whether the
 * deck passed its checks — and the difference between "failed", "we could not check", and
 * "still checking" decides whether it should stop, retry, or wait. All three have to be
 * separable from the DOM alone, because the agent cannot read the copy's intent.
 *
 * This surface deliberately publishes `data-state` and NOT `data-decision`: nobody accepts
 * or rejects a CI result, and inventing a decision attribute here would advertise an
 * affordance that does not exist.
 */
describe('DeckCiStatus trust surface', () => {
  const surface = () => screen.getByRole('status');

  it('declares itself a failed-state surface in every state it can reach', () => {
    const states: Array<[string, () => void]> = [
      ['loading', () => render(<DeckCiStatus result={null} loading />)],
      ['unavailable', () => render(<DeckCiStatus result={null} error={new Error('down')} />)],
      ['pass', () => render(<DeckCiStatus result={ciResult('pass')} />)],
      ['warn', () => render(<DeckCiStatus result={ciResult('warn', 0, 2)} />)],
      ['fail', () => render(<DeckCiStatus result={ciResult('fail', 3, 1)} />)],
    ];

    for (const [expected, mount] of states) {
      cleanup();
      mount();
      expect(surface()).toHaveAttribute('data-trust-surface', 'failed-state');
      expect(surface()).toHaveAttribute('data-state', expected);
      // A readout is not an affordance. Publishing `data-decision` here would tell an agent
      // a decision is on offer when no control exists to take it.
      expect(surface()).not.toHaveAttribute('data-decision');
    }
  });

  it('keeps "could not check" distinct from "passed"', () => {
    // The failure this prevents is the whole point of the surface: an unreachable check that
    // renders as a pass lets an agent export a deck nothing ever verified.
    render(<DeckCiStatus result={null} error={new Error('backend unreachable')} />);

    expect(surface()).toHaveAttribute('data-state', 'unavailable');
    expect(surface().className).not.toContain('is-pass');
    expect(surface()).toHaveTextContent('Unavailable');
  });

  it('keeps "still checking" distinct from both', () => {
    render(<DeckCiStatus result={ciResult('fail', 2)} loading />);

    // Loading wins over a stale result: reporting the previous verdict during a re-check is
    // a claim about the current deck that nothing has established.
    expect(surface()).toHaveAttribute('data-state', 'loading');
    expect(surface()).toHaveTextContent('Checking');
  });
});
