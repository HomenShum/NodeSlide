// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import type { ConvexReactClient } from 'convex/react';
import { ConvexProvider } from 'convex/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoadingScreen, Toast } from './EditorFeedback';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/**
 * A fake client is enough: the only thing LoadingScreen asks it is whether the websocket is
 * up, and that single bit is the difference between "connecting" and "opening your deck".
 */
function clientWith(isWebSocketConnected: boolean): ConvexReactClient {
  return {
    connectionState: () => ({ isWebSocketConnected }),
    watchQuery: () => ({
      onUpdate: () => () => undefined,
      localQueryResult: () => undefined,
      journal: () => undefined,
    }),
    setAuth: () => undefined,
    clearAuth: () => undefined,
  } as unknown as ConvexReactClient;
}

describe('LoadingScreen honesty', () => {
  it('says it is still connecting instead of claiming the deck is opening', () => {
    render(
      <ConvexProvider client={clientWith(false)}>
        <LoadingScreen title="Opening your deck…" kind="opening_deck" />
      </ConvexProvider>,
    );
    const stage = screen.getByTestId('ns-loading-stage');
    expect(stage).toHaveAttribute('data-stage', 'connecting');
    expect(screen.getAllByText('Connecting to the workspace service…').length).toBe(2);
    expect(screen.queryByText('Opening your deck…')).not.toBeInTheDocument();
  });

  it('names the deck stage once the transport is up', () => {
    render(
      <ConvexProvider client={clientWith(true)}>
        <LoadingScreen title="Opening your deck…" kind="opening_deck" />
      </ConvexProvider>,
    );
    expect(screen.getByTestId('ns-loading-stage')).toHaveAttribute('data-stage', 'opening_deck');
  });

  it('offers a retry rather than spinning indefinitely', () => {
    vi.useFakeTimers();
    render(
      <ConvexProvider client={clientWith(true)}>
        <LoadingScreen title="Preparing the sample…" />
      </ConvexProvider>,
    );
    expect(screen.queryByTestId('ns-loading-retry')).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(13_000));
    expect(screen.getByTestId('ns-loading-retry')).toBeInTheDocument();
  });
});

describe('Toast honesty', () => {
  it('never auto-dismisses a failure', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast toast={{ kind: 'error', message: 'The edit failed.' }} onClose={onClose} />);
    act(() => vi.advanceTimersByTime(30_000));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('The edit failed.').closest('output')).toHaveAttribute(
      'data-toast-kind',
      'error',
    );
  });

  it('auto-dismisses a success', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();
    render(<Toast toast={{ kind: 'success', message: 'Saved.' }} onClose={onClose} />);
    act(() => vi.advanceTimersByTime(5_000));
    expect(onClose).toHaveBeenCalled();
  });
});

/** Wiring guard: the studio must use the shared module, not a re-grown local copy. */
describe('EditorFeedback wiring', () => {
  const studio = readFileSync('src/domains/nodeslide/NodeSlideStudio.tsx', 'utf8');

  it('is the studio shell, not a parallel implementation', () => {
    expect(studio).toContain("from './components/shell/EditorFeedback'");
    expect(studio).toContain("kind={requestedDeck ? 'opening_deck' : 'preparing_sample'}");
    expect(studio).not.toContain('function LoadingScreen(');
    expect(studio).not.toContain('function Toast(');
    expect(studio).not.toContain('function RecoveryScreen(');
  });
});
