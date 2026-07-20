import type { DeckPatch, DeckSnapshot, Slide } from '@nodeslide/contracts';
import { createNodeSlideTestSnapshot, createNodeSlideTextPatch } from '@nodeslide/testing';
// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DeckAgentThread,
  NodeSlideDeckViewer,
  NodeSlideProposalReview,
  NodeSlideStudioShell,
  createNodeSlideProposalPreview,
} from './index';

afterEach(cleanup);

function withSecondSlide(
  snapshot: DeckSnapshot,
  secondSlideId = `${snapshot.deck.id}:slide:2`,
): DeckSnapshot {
  const secondElementId = `${secondSlideId}:title`;
  const secondSlide: Slide = {
    id: secondSlideId,
    deckId: snapshot.deck.id,
    title: 'Proof',
    background: '#ffffff',
    elementOrder: [secondElementId],
    version: 1,
  };
  return {
    ...structuredClone(snapshot),
    deck: {
      ...structuredClone(snapshot.deck),
      slideOrder: [...snapshot.deck.slideOrder, secondSlideId],
    },
    slides: [...structuredClone(snapshot.slides), secondSlide],
    elements: [
      ...structuredClone(snapshot.elements),
      {
        id: secondElementId,
        slideId: secondSlideId,
        name: 'Proof title',
        kind: 'text',
        bbox: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 },
        rotation: 0,
        content: 'Verified',
        style: { color: '#111111', fontSize: 36, fontWeight: 700 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native'],
        version: 1,
      },
    ],
  };
}

describe('@nodeslide/react controlled surfaces', () => {
  it('renders only the host-selected slide and reports navigation intent', async () => {
    const user = userEvent.setup();
    const snapshot = withSecondSlide(createNodeSlideTestSnapshot());
    const activeSlideId = snapshot.deck.slideOrder[0] ?? '';
    const onActiveSlideChange = vi.fn();
    render(
      <NodeSlideDeckViewer
        snapshot={snapshot}
        activeSlideId={activeSlideId}
        onActiveSlideChange={onActiveSlideChange}
      />,
    );

    expect(screen.getByText('Before')).toBeTruthy();
    expect(screen.queryByText('Verified')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Next slide' }));
    expect(onActiveSlideChange).toHaveBeenCalledWith(snapshot.deck.slideOrder[1]);
  });

  it('supports roving slide-tab keyboard navigation without owning selection state', async () => {
    const user = userEvent.setup();
    const snapshot = withSecondSlide(createNodeSlideTestSnapshot());
    const activeSlideId = snapshot.deck.slideOrder[0] ?? '';
    const onActiveSlideChange = vi.fn();
    render(
      <NodeSlideDeckViewer
        snapshot={snapshot}
        activeSlideId={activeSlideId}
        onActiveSlideChange={onActiveSlideChange}
      />,
    );

    const firstTab = screen.getByRole('tab', { name: /Portable boundary/ });
    firstTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(onActiveSlideChange).toHaveBeenCalledWith(snapshot.deck.slideOrder[1]);
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Proof/ }));
  });

  it('requests focus by slide identity even when the ID contains selector punctuation', async () => {
    const user = userEvent.setup();
    const base = createNodeSlideTestSnapshot();
    const snapshot = withSecondSlide(base, `${base.deck.id}:slide:"[proof]`);
    const activeSlideId = snapshot.deck.slideOrder[0] ?? '';
    render(
      <NodeSlideDeckViewer
        snapshot={snapshot}
        activeSlideId={activeSlideId}
        onActiveSlideChange={vi.fn()}
      />,
    );

    const firstTab = screen.getByRole('tab', { name: /Portable boundary/ });
    firstTab.focus();
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Proof/ }));
  });

  it('materializes a proposal preview without mutating the authoritative snapshot', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const proposal = proposalFromCommand(snapshot, 'After');
    const preview = createNodeSlideProposalPreview(snapshot, proposal);

    expect(preview.ok).toBe(true);
    expect(snapshot.elements[0]?.content).toBe('Before');
    if (preview.ok) expect(preview.candidate.elements[0]?.content).toBe('After');
  });

  it('renders current and proposed states and emits explicit decisions only', async () => {
    const user = userEvent.setup();
    const snapshot = createNodeSlideTestSnapshot();
    const proposal = proposalFromCommand(snapshot, 'After');
    const onDecision = vi.fn();
    render(
      <NodeSlideProposalReview
        currentSnapshot={snapshot}
        proposal={proposal}
        activeSlideId={snapshot.deck.slideOrder[0] ?? ''}
        onActiveSlideChange={vi.fn()}
        onDecision={onDecision}
      />,
    );

    expect(screen.getByLabelText(/Current version/).textContent).toContain('Before');
    expect(screen.getByLabelText(/Proposed version/).textContent).toContain('After');
    expect(screen.getByText(/No change is applied/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Accept proposal' }));
    await user.click(screen.getByRole('button', { name: 'Reject proposal' }));
    expect(onDecision.mock.calls).toEqual([['accept'], ['reject']]);
  });

  it('fails closed and disables decisions for a stale proposal', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const proposal = { ...proposalFromCommand(snapshot, 'After'), baseDeckVersion: 0 };
    render(
      <NodeSlideProposalReview
        currentSnapshot={snapshot}
        proposal={proposal}
        activeSlideId={snapshot.deck.slideOrder[0] ?? ''}
        onActiveSlideChange={vi.fn()}
        onDecision={vi.fn()}
      />,
    );

    expect(screen.getByRole('alert').textContent).toMatch(/Stale patch/);
    expect(screen.getByRole('button', { name: 'Accept proposal' }).hasAttribute('disabled')).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Reject proposal' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('renders terminal proposals for audit but keeps their decisions disabled', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const proposal = { ...proposalFromCommand(snapshot, 'After'), status: 'accepted' as const };
    render(
      <NodeSlideProposalReview
        currentSnapshot={snapshot}
        proposal={proposal}
        activeSlideId={snapshot.deck.slideOrder[0] ?? ''}
        onActiveSlideChange={vi.fn()}
        onDecision={vi.fn()}
      />,
    );

    expect(screen.getByText(/accepted proposal is read-only/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept proposal' }).hasAttribute('disabled')).toBe(
      true,
    );
  });

  it('keeps the studio controlled and permission-gates host callbacks', async () => {
    const user = userEvent.setup();
    const snapshot = createNodeSlideTestSnapshot();
    const onExport = vi.fn();
    const onPatch = vi.fn();
    render(
      <NodeSlideStudioShell
        onAccept={vi.fn()}
        onExport={onExport}
        onPatch={onPatch}
        onPropose={vi.fn()}
        onReject={vi.fn()}
        onSelectionChange={vi.fn()}
        permissions={{
          canRead: true,
          canPropose: false,
          canPatch: false,
          canApprove: false,
          canExport: false,
        }}
        renderComposer={(actions) => (
          <button
            onClick={() => actions.patch(createNodeSlideTextPatch(snapshot, 'Denied'))}
            type="button"
          >
            Host composer patch
          </button>
        )}
        selection={{ slideId: snapshot.deck.slideOrder[0] ?? null, elementIds: [] }}
        snapshot={snapshot}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Host composer patch' }));
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Export' }).hasAttribute('disabled')).toBe(true);
    expect(onExport).not.toHaveBeenCalled();
  });

  it('lets a rich host render through the shell without bypassing normalized controls', async () => {
    const user = userEvent.setup();
    const snapshot = withSecondSlide(createNodeSlideTestSnapshot());
    const proposal = proposalFromCommand(snapshot, 'After');
    const onAccept = vi.fn();
    const onExport = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <NodeSlideStudioShell
        onAccept={onAccept}
        onExport={onExport}
        onPatch={vi.fn()}
        onPropose={vi.fn()}
        onReject={vi.fn()}
        onSelectionChange={onSelectionChange}
        permissions={{
          canRead: true,
          canPropose: true,
          canPatch: true,
          canApprove: true,
          canExport: true,
        }}
        proposal={proposal}
        renderSurface={(actions) => (
          <main data-testid="rich-host" data-slide-id={actions.selection.slideId ?? ''}>
            <button
              onClick={() =>
                actions.select({
                  slideId: snapshot.deck.slideOrder[1] ?? null,
                  elementIds: [snapshot.elements[0]?.id ?? 'missing'],
                })
              }
              type="button"
            >
              Host select
            </button>
            <button onClick={actions.exportDeck} type="button">
              Host export
            </button>
            <button onClick={() => actions.accept(proposal.id)} type="button">
              Host accept
            </button>
          </main>
        )}
        selection={{ slideId: snapshot.deck.slideOrder[0] ?? null, elementIds: [] }}
        snapshot={snapshot}
      />,
    );

    expect(screen.getByTestId('rich-host').getAttribute('data-slide-id')).toBe(
      snapshot.deck.slideOrder[0],
    );
    expect(screen.queryByLabelText('NodeSlide studio')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Host select' }));
    expect(onSelectionChange).toHaveBeenCalledWith({
      slideId: snapshot.deck.slideOrder[1],
      elementIds: [],
    });
    await user.click(screen.getByRole('button', { name: 'Host export' }));
    await user.click(screen.getByRole('button', { name: 'Host accept' }));
    expect(onExport).toHaveBeenCalledOnce();
    expect(onAccept).toHaveBeenCalledWith(proposal.id);
  });

  it('keeps rich-host proposal decisions fail-closed when preview validation fails', async () => {
    const user = userEvent.setup();
    const snapshot = createNodeSlideTestSnapshot();
    const staleProposal = { ...proposalFromCommand(snapshot, 'After'), baseDeckVersion: 0 };
    const onAccept = vi.fn();
    render(
      <NodeSlideStudioShell
        onAccept={onAccept}
        onExport={vi.fn()}
        onPatch={vi.fn()}
        onPropose={vi.fn()}
        onReject={vi.fn()}
        onSelectionChange={vi.fn()}
        permissions={{
          canRead: true,
          canPropose: true,
          canPatch: true,
          canApprove: true,
          canExport: true,
        }}
        proposal={staleProposal}
        renderSurface={(actions) => (
          <button onClick={() => actions.accept(staleProposal.id)} type="button">
            {actions.canAccept ? 'Accept enabled' : 'Accept blocked'}
          </button>
        )}
        selection={{ slideId: snapshot.deck.slideOrder[0] ?? null, elementIds: [] }}
        snapshot={snapshot}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Accept blocked' }));
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('renders a controlled agent transcript and emits trimmed input', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <DeckAgentThread
        entries={[
          {
            id: 'planner:1',
            role: 'planner',
            text: 'Plan ready',
            inputTokens: 10,
            outputTokens: 5,
          },
        ]}
        onSubmit={onSubmit}
        onValueChange={vi.fn()}
        value="  tighten copy  "
      />,
    );
    expect(screen.getByText('Plan ready')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).toHaveBeenCalledWith('tighten copy');
  });
});

function proposalFromCommand(snapshot: DeckSnapshot, text: string): DeckPatch {
  const command = createNodeSlideTextPatch(snapshot, text);
  return {
    ...command,
    status: 'ready',
    createdAt: snapshot.deck.updatedAt,
    updatedAt: snapshot.deck.updatedAt,
  };
}
