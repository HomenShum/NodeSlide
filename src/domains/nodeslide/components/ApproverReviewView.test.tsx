// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import { type ApproverReviewState, ApproverReviewView } from './ApproverReviewView';

const snapshot = buildGoldenNodeSlide('approver-review-test', 1_000).snapshot;

function reviewState(overrides: Partial<ApproverReviewState> = {}): ApproverReviewState {
  return {
    approverLabel: 'Reviewer A',
    required: true,
    deckVersion: 5,
    validated: true,
    alreadySignedOff: false,
    workspace: {
      deck: {
        title: snapshot.deck.title,
        theme: snapshot.deck.theme,
        slideOrder: snapshot.deck.slideOrder,
      },
      slides: snapshot.slides,
      elements: snapshot.elements,
    },
    ...overrides,
  };
}

function renderView(overrides: Partial<React.ComponentProps<typeof ApproverReviewView>> = {}) {
  return render(
    <ApproverReviewView
      state={undefined}
      tokenSubmitted={false}
      busy={false}
      error={null}
      onSubmitToken={() => undefined}
      onSignOff={() => undefined}
      onOpenApp={() => undefined}
      {...overrides}
    />,
  );
}

describe('NodeSlide approver review surface', () => {
  afterEach(cleanup);

  it('gates on a pasted capability and never reads it from the URL', async () => {
    const user = userEvent.setup();
    const onSubmitToken = vi.fn();
    renderView({ onSubmitToken });

    // Nothing but the gate renders before a capability is presented.
    expect(screen.queryByTestId('approver-bar')).toBeNull();
    const input = screen.getByTestId('approver-token-input');
    expect(input.getAttribute('type')).toBe('password');
    await user.type(input, '  capability-token  ');
    await user.click(screen.getByTestId('approver-token-submit'));
    expect(onSubmitToken).toHaveBeenCalledWith('capability-token');
  });

  it('reports an invalid or revoked capability honestly instead of retrying', () => {
    renderView({ state: null, tokenSubmitted: true });
    expect(screen.getByRole('alert').textContent).toContain('not valid for the deck');
    // The gate stays available for a corrected paste.
    expect(screen.queryByTestId('approver-token-input')).not.toBeNull();
  });

  it('renders the real slides and signs off the pinned reviewed version', async () => {
    const user = userEvent.setup();
    const onSignOff = vi.fn();
    renderView({ state: reviewState(), tokenSubmitted: true, onSignOff });

    // The approver reviews actual content, not a metadata summary.
    expect(screen.getByLabelText('Slides under review').children.length).toBeGreaterThan(0);
    expect(screen.getByTestId('approver-bar').textContent).toContain('validation receipt present');
    await user.click(screen.getByTestId('approver-sign-off'));
    expect(onSignOff).toHaveBeenCalledWith(5);
  });

  it('blocks sign-off behind an explicit banner when the deck advances mid-review', async () => {
    const user = userEvent.setup();
    const onSignOff = vi.fn();
    const view = renderView({ state: reviewState(), tokenSubmitted: true, onSignOff });

    // The deck advances while the approver reads v5. The button must NOT silently
    // re-target to v6 — it disables and an explicit re-review affordance appears.
    view.rerender(
      <ApproverReviewView
        state={reviewState({ deckVersion: 6 })}
        tokenSubmitted={true}
        busy={false}
        error={null}
        onSubmitToken={() => undefined}
        onSignOff={onSignOff}
        onOpenApp={() => undefined}
      />,
    );
    expect(screen.getByTestId('approver-advanced').textContent).toContain('advanced to v6');
    const signOff = () => screen.getByTestId('approver-sign-off') as HTMLButtonElement;
    expect(signOff().disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Review v6' }));
    expect(signOff().disabled).toBe(false);
    await user.click(signOff());
    expect(onSignOff).toHaveBeenCalledWith(6);
  });

  it('withholds sign-off when the current version has no validation receipt', () => {
    renderView({ state: reviewState({ validated: false }), tokenSubmitted: true });
    expect(screen.getByTestId('approver-bar').textContent).toContain('no validation receipt');
    expect((screen.getByTestId('approver-sign-off') as HTMLButtonElement).disabled).toBe(true);
  });

  it('shows the recorded sign-off state instead of a second sign-off affordance', () => {
    renderView({ state: reviewState({ alreadySignedOff: true }), tokenSubmitted: true });
    expect(screen.getByTestId('approver-signed').textContent).toContain('Signed off v5');
    expect(screen.queryByTestId('approver-sign-off')).toBeNull();
  });

  it('surfaces a server rejection verbatim while keeping the review readable', () => {
    renderView({
      state: reviewState(),
      tokenSubmitted: true,
      error: 'The deck advanced to v7 since v5 was presented for review.',
    });
    const alerts = screen.getAllByRole('alert').map((node) => node.textContent ?? '');
    expect(alerts.some((text) => text.includes('advanced to v7'))).toBe(true);
    expect(screen.queryByLabelText('Slides under review')).not.toBeNull();
  });
});
