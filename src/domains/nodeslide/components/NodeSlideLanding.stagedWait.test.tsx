// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NodeSlideLanding, creationStageMessage, formatElapsed } from './NodeSlideLanding';

/**
 * Scenario (G4): a founder pastes a long brief on the landing and hits create.
 * The live route takes 2–4 minutes and does not stream progress, so the only
 * honest wait UI is a time-based staged narrative plus a visible elapsed
 * timer. This suite pins:
 *  - the staged copy advancing through all four stages on wall-clock time,
 *  - the visible elapsed timer ticking (no fake percent bars anywhere),
 *  - reset behavior when the creation settles and a new one starts.
 */

function renderLanding(creating: boolean) {
  return render(
    <NodeSlideLanding
      clientSessionId="session-1"
      recentDecks={[]}
      creating={creating}
      onCreate={() => undefined}
      onExploreSample={() => undefined}
      onOpenProjects={() => undefined}
      onOpenDeck={() => undefined}
    />,
  );
}

describe('NodeSlide landing staged creation wait', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('advances honest stage copy on elapsed time with a visible timer', () => {
    renderLanding(true);

    // Stage 1 (0–15s): reading the brief.
    expect(screen.getByTestId('landing-create-stage').textContent).toBe(
      'Reading the brief and evidence…',
    );
    expect(screen.getByTestId('landing-create-elapsed').textContent).toBe('0:00');

    // Stage 2 (15–60s): drafting.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(screen.getByTestId('landing-create-stage').textContent).toBe(
      'The model is drafting the slide plan…',
    );
    expect(screen.getByTestId('landing-create-elapsed').textContent).toBe('0:20');

    // Stage 3 (60–150s): honest long-run expectation setting.
    act(() => {
      vi.advanceTimersByTime(50_000);
    });
    expect(screen.getByTestId('landing-create-stage').textContent).toBe(
      'Still generating — long briefs take 2–4 minutes on the live route…',
    );
    expect(screen.getByTestId('landing-create-elapsed').textContent).toBe('1:10');

    // Stage 4 (150s+): validating and building.
    act(() => {
      vi.advanceTimersByTime(90_000);
    });
    expect(screen.getByTestId('landing-create-stage').textContent).toBe(
      'Validating and building the deck…',
    );
    expect(screen.getByTestId('landing-create-elapsed').textContent).toBe('2:40');

    // No fake determinate progress anywhere in the wait surface.
    expect(document.querySelector('progress')).toBeNull();
    expect(screen.getByTestId('landing-create-status').textContent).not.toMatch(/%/);
  });

  it('resets the narrative when creation settles, so a second run starts at stage one', () => {
    const view = renderLanding(true);
    act(() => {
      vi.advanceTimersByTime(70_000);
    });
    expect(screen.getByTestId('landing-create-stage').textContent).toBe(
      'Still generating — long briefs take 2–4 minutes on the live route…',
    );

    // Creation settles: the wait surface disappears entirely.
    view.rerender(
      <NodeSlideLanding
        clientSessionId="session-1"
        recentDecks={[]}
        creating={false}
        onCreate={() => undefined}
        onExploreSample={() => undefined}
        onOpenProjects={() => undefined}
        onOpenDeck={() => undefined}
      />,
    );
    expect(screen.queryByTestId('landing-create-status')).toBeNull();

    // A second creation starts back at stage one with a zeroed timer.
    view.rerender(
      <NodeSlideLanding
        clientSessionId="session-1"
        recentDecks={[]}
        creating
        onCreate={() => undefined}
        onExploreSample={() => undefined}
        onOpenProjects={() => undefined}
        onOpenDeck={() => undefined}
      />,
    );
    expect(screen.getByTestId('landing-create-stage').textContent).toBe(
      'Reading the brief and evidence…',
    );
    expect(screen.getByTestId('landing-create-elapsed').textContent).toBe('0:00');
  });

  it('stage boundaries are exact and the timer formats like a clock', () => {
    expect(creationStageMessage(0)).toBe('Reading the brief and evidence…');
    expect(creationStageMessage(14)).toBe('Reading the brief and evidence…');
    expect(creationStageMessage(15)).toBe('The model is drafting the slide plan…');
    expect(creationStageMessage(59)).toBe('The model is drafting the slide plan…');
    expect(creationStageMessage(60)).toBe(
      'Still generating — long briefs take 2–4 minutes on the live route…',
    );
    expect(creationStageMessage(149)).toBe(
      'Still generating — long briefs take 2–4 minutes on the live route…',
    );
    expect(creationStageMessage(150)).toBe('Validating and building the deck…');
    expect(creationStageMessage(600)).toBe('Validating and building the deck…');

    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(7)).toBe('0:07');
    expect(formatElapsed(65)).toBe('1:05');
    expect(formatElapsed(155)).toBe('2:35');
  });
});
