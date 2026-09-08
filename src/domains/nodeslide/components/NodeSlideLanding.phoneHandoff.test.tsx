// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { NodeSlideLanding } from './NodeSlideLanding';

function renderLanding() {
  return render(
    <NodeSlideLanding
      clientSessionId="session-phone-handoff"
      recentDecks={[]}
      creating={false}
      onCreate={() => undefined}
      onExploreSample={() => undefined}
      onOpenProjects={() => undefined}
      onOpenDeck={() => undefined}
    />,
  );
}

describe('NodeSlide desktop-to-phone handoff', () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, '', '/');
  });

  it('gives a founder a scan target for the safe app entrypoint without forwarding deck capabilities', () => {
    window.history.replaceState({}, '', '/?deck=private-deck&share=private-share#private-fragment');

    renderLanding();

    const handoff = screen.getByTestId('nodeslide-phone-handoff');
    const qr = screen.getByTestId('nodeslide-phone-qr');
    const safeUrl = new URL('/', window.location.origin).toString();

    expect(handoff.textContent).toContain('Open on phone');
    expect(qr.getAttribute('alt')).toBe(`QR code for ${safeUrl}`);
    expect(qr.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(decodeURIComponent(qr.getAttribute('src') ?? '')).toContain(`text=${safeUrl}`);
    expect(qr.getAttribute('src')).not.toContain('private-deck');
    expect(qr.getAttribute('src')).not.toContain('private-share');
    expect(qr.getAttribute('src')).not.toContain('private-fragment');
  });

  it('stays singular through a sustained landing rerender instead of accumulating QR surfaces', () => {
    const view = renderLanding();

    for (let index = 0; index < 100; index += 1) {
      view.rerender(
        <NodeSlideLanding
          clientSessionId={`session-phone-handoff-${index}`}
          recentDecks={[]}
          creating={false}
          onCreate={() => undefined}
          onExploreSample={() => undefined}
          onOpenProjects={() => undefined}
          onOpenDeck={() => undefined}
        />,
      );
    }

    expect(screen.getAllByTestId('nodeslide-phone-handoff')).toHaveLength(1);
    expect(screen.getAllByTestId('nodeslide-phone-qr')).toHaveLength(1);
  });
});
