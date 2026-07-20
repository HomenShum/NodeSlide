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
  | { ok: false; error: string };

export type NodeSlideProposalReviewBlockReason =
  | 'host_disabled'
  | 'pending'
  | 'invalid_preview'
  | 'terminal_proposal'
  | null;

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
  actionsDisabled: boolean;
  blockReason: NodeSlideProposalReviewBlockReason;
}

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
  const isBusy = pendingDecision !== null;
  const blockReason: NodeSlideProposalReviewBlockReason = disabled
    ? 'host_disabled'
    : isBusy
      ? 'pending'
      : !preview.ok
        ? 'invalid_preview'
        : proposal.status !== 'ready'
          ? 'terminal_proposal'
          : null;
  return {
    preview,
    orderedSlides,
    currentSlide: currentSnapshot.slides.find((slide) => slide.id === activeSlideId) ?? null,
    candidateSlide: preview.ok
      ? (preview.candidate.slides.find((slide) => slide.id === activeSlideId) ?? null)
      : null,
    isBusy,
    actionsDisabled: blockReason !== null,
    blockReason,
  };
}
