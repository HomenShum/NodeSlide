import type { DeckPatch, DeckSnapshot, PatchStatus, Slide } from '@nodeslide/contracts';
import { createNodeSlideTestSnapshot, createNodeSlideTextPatch } from '@nodeslide/testing';
import { describe, expect, it } from 'vitest';
import {
  createNodeSlideProposalPreview,
  createNodeSlideProposalReviewModel,
} from './proposalReview';

describe('headless proposal review', () => {
  it('previews without mutating the authoritative snapshot', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const before = structuredClone(snapshot);
    const preview = createNodeSlideProposalPreview(snapshot, proposalFor(snapshot));

    expect(preview.ok).toBe(true);
    if (preview.ok) expect(preview.candidate.elements[0]?.content).toBe('After');
    expect(snapshot).toEqual(before);
  });

  it('keeps ready proposals actionable and reports non-ready versus terminal states', () => {
    const snapshot = createNodeSlideTestSnapshot();
    for (const status of [
      'ready',
      'draft',
      'validating',
      'accepted',
      'rejected',
      'stale',
    ] as const) {
      const model = createNodeSlideProposalReviewModel({
        currentSnapshot: snapshot,
        proposal: proposalFor(snapshot, status),
        activeSlideId: snapshot.deck.slideOrder[0] ?? '',
      });
      if (status === 'ready') {
        expect(model.isActionable).toBe(true);
        expect(model.actionsDisabled).toBe(false);
        expect(model.blockReasons).toEqual([]);
      } else if (status === 'draft' || status === 'validating') {
        expect(model.blockReasons).toEqual(['proposal_not_ready']);
      } else if (status === 'stale') {
        expect(model.blockReasons).toEqual(['stale_proposal']);
      } else {
        expect(model.blockReasons).toEqual(['terminal_proposal']);
      }
    }
  });

  it('preserves every overlapping host, pending, and proposal block reason', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const model = createNodeSlideProposalReviewModel({
      currentSnapshot: snapshot,
      proposal: proposalFor(snapshot, 'accepted'),
      activeSlideId: snapshot.deck.slideOrder[0] ?? '',
      pendingDecision: 'accept',
      disabled: true,
    });

    expect(model.actionsDisabled).toBe(true);
    expect(model.blockReason).toBe('host_disabled');
    expect(model.blockReasons).toEqual(['host_disabled', 'pending', 'terminal_proposal']);
  });

  it('fails closed when the proposal cannot be previewed', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const model = createNodeSlideProposalReviewModel({
      currentSnapshot: snapshot,
      proposal: { ...proposalFor(snapshot), baseDeckVersion: 0 },
      activeSlideId: snapshot.deck.slideOrder[0] ?? '',
    });

    expect(model.preview.ok).toBe(false);
    expect(model.actionsDisabled).toBe(true);
    expect(model.blockReasons).toContain('invalid_preview');
    expect(model.candidateSlide).toBeNull();
  });

  it('retains removed slides in the comparison order while exposing a missing candidate pane', () => {
    const snapshot = withSecondSlide(createNodeSlideTestSnapshot());
    const slideId = snapshot.deck.slideOrder[1] ?? '';
    const proposal: DeckPatch = {
      ...proposalFor(snapshot),
      baseSlideVersions: {
        ...proposalFor(snapshot).baseSlideVersions,
        [slideId]: 1,
      },
      scope: { kind: 'deck', deckId: snapshot.deck.id, operationMode: 'unrestricted' },
      operations: [{ op: 'remove_slide', slideId }],
    };
    const model = createNodeSlideProposalReviewModel({
      currentSnapshot: snapshot,
      proposal,
      activeSlideId: slideId,
    });

    expect(model.preview.ok).toBe(true);
    expect(model.orderedSlides.map((slide) => slide.id)).toEqual([
      snapshot.deck.slideOrder[0],
      slideId,
    ]);
    expect(model.currentSlide?.id).toBe(slideId);
    expect(model.candidateSlide).toBeNull();
  });
});

function proposalFor(snapshot: DeckSnapshot, status: PatchStatus = 'ready'): DeckPatch {
  return {
    ...createNodeSlideTextPatch(snapshot, 'After'),
    status,
    createdAt: snapshot.deck.updatedAt,
    updatedAt: snapshot.deck.updatedAt,
  };
}

function withSecondSlide(snapshot: DeckSnapshot): DeckSnapshot {
  const secondSlideId = `${snapshot.deck.id}:slide:2`;
  const secondSlide: Slide = {
    id: secondSlideId,
    deckId: snapshot.deck.id,
    title: 'Removable proof',
    background: '#ffffff',
    elementOrder: [],
    version: 1,
  };
  return {
    ...structuredClone(snapshot),
    deck: {
      ...structuredClone(snapshot.deck),
      slideOrder: [...snapshot.deck.slideOrder, secondSlideId],
    },
    slides: [...structuredClone(snapshot.slides), secondSlide],
  };
}
