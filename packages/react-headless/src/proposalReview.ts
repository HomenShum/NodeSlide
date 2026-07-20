import type { NodeSlideProposalDecision } from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot, Slide } from '@nodeslide/contracts';
import { applyDeckPatch } from '@nodeslide/engine';

export type NodeSlideProposalPreview =
  | {
      ok: true;
      candidate: DeckSnapshot;
      affectedSlideIds: readonly string[];
      affectedElementIds: readonly string[];
    }
  | {
      ok: false;
      error: string;
    };

export type NodeSlideProposalReviewBlockReason =
  | 'host_disabled'
  | 'pending'
  | 'invalid_preview'
  | 'proposal_not_ready'
  | 'stale_proposal'
  | 'terminal_proposal';

export interface CreateNodeSlideProposalReviewModelInput {
  currentSnapshot: DeckSnapshot;
  proposal: DeckPatch;
  activeSlideId: string;
  pendingDecision?: NodeSlideProposalDecision | null;
  disabled?: boolean;
}

export interface NodeSlideProposalReviewModel {
  preview: NodeSlideProposalPreview;
  orderedSlides: readonly Slide[];
  currentSlide: Slide | null;
  candidateSlide: Slide | null;
  isBusy: boolean;
  isActionable: boolean;
  actionsDisabled: boolean;
  blockReason: NodeSlideProposalReviewBlockReason | null;
  blockReasons: readonly NodeSlideProposalReviewBlockReason[];
}

/** Materializes an unapplied proposal without mutating the authoritative snapshot. */
export function createNodeSlideProposalPreview(
  currentSnapshot: DeckSnapshot,
  proposal: DeckPatch,
): NodeSlideProposalPreview {
  try {
    const result = applyDeckPatch(currentSnapshot, proposal, currentSnapshot.deck.updatedAt);
    return {
      ok: true,
      candidate: result.snapshot,
      affectedSlideIds: result.affectedSlideIds,
      affectedElementIds: result.affectedElementIds,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The proposal could not be previewed.',
    };
  }
}

/** Derives proposal-review state without rendering or persisting a decision. */
export function createNodeSlideProposalReviewModel({
  currentSnapshot,
  proposal,
  activeSlideId,
  pendingDecision = null,
  disabled = false,
}: CreateNodeSlideProposalReviewModelInput): NodeSlideProposalReviewModel {
  const preview = createNodeSlideProposalPreview(currentSnapshot, proposal);
  const orderedSlideIds = preview.ok
    ? [...new Set([...currentSnapshot.deck.slideOrder, ...preview.candidate.deck.slideOrder])]
    : currentSnapshot.deck.slideOrder;
  const orderedSlides = orderedSlideIds
    .map((slideId) =>
      preview.ok
        ? (preview.candidate.slides.find((slide) => slide.id === slideId) ??
          currentSnapshot.slides.find((slide) => slide.id === slideId))
        : currentSnapshot.slides.find((slide) => slide.id === slideId),
    )
    .filter((slide): slide is Slide => slide !== undefined);
  const currentSlide = currentSnapshot.slides.find((slide) => slide.id === activeSlideId) ?? null;
  const candidateSlide = preview.ok
    ? (preview.candidate.slides.find((slide) => slide.id === activeSlideId) ?? null)
    : null;
  const isBusy = pendingDecision !== null;
  const isActionable = proposal.status === 'ready';
  const blockReasons: NodeSlideProposalReviewBlockReason[] = [];
  if (disabled) blockReasons.push('host_disabled');
  if (isBusy) blockReasons.push('pending');
  if (!preview.ok) blockReasons.push('invalid_preview');
  if (proposal.status === 'draft' || proposal.status === 'validating') {
    blockReasons.push('proposal_not_ready');
  } else if (proposal.status === 'stale') {
    blockReasons.push('stale_proposal');
  } else if (!isActionable) {
    blockReasons.push('terminal_proposal');
  }

  return {
    preview,
    orderedSlides,
    currentSlide,
    candidateSlide,
    isBusy,
    isActionable,
    actionsDisabled: blockReasons.length > 0,
    blockReason: blockReasons[0] ?? null,
    blockReasons,
  };
}
