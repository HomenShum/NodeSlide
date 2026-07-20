import type { NodeSlideProposalDecision } from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot, Slide } from '@nodeslide/contracts';
import { applyDeckPatch } from '@nodeslide/engine';
import type { ReactNode } from 'react';
import { NodeSlideSlideFrame } from './viewer';

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

export interface NodeSlideProposalReviewProps {
  currentSnapshot: DeckSnapshot;
  proposal: DeckPatch;
  /** Host-controlled slide shown in the comparison. */
  activeSlideId: string;
  onActiveSlideChange: (slideId: string) => void;
  /** Host persists the decision; this component never calls a repository. */
  onDecision: (decision: NodeSlideProposalDecision) => void;
  pendingDecision?: NodeSlideProposalDecision | null;
  disabled?: boolean;
  className?: string;
  acceptLabel?: string;
  rejectLabel?: string;
}

/**
 * Controlled proposal comparison and decision surface.
 *
 * The deterministic engine creates a preview in memory. Accept/reject are
 * callbacks only; CAS, authorization, persistence, and receipts remain host
 * responsibilities behind `NodeSlideRepository`.
 */
export function NodeSlideProposalReview({
  currentSnapshot,
  proposal,
  activeSlideId,
  onActiveSlideChange,
  onDecision,
  pendingDecision = null,
  disabled = false,
  className,
  acceptLabel = 'Accept proposal',
  rejectLabel = 'Reject proposal',
}: NodeSlideProposalReviewProps) {
  const preview = createNodeSlideProposalPreview(currentSnapshot, proposal);
  const orderedSlideIds = preview.ok
    ? [...new Set([...currentSnapshot.deck.slideOrder, ...preview.candidate.deck.slideOrder])]
    : currentSnapshot.deck.slideOrder;
  const orderedSlides = preview.ok
    ? orderedSlideIds
        .map(
          (slideId) =>
            preview.candidate.slides.find((slide) => slide.id === slideId) ??
            currentSnapshot.slides.find((slide) => slide.id === slideId),
        )
        .filter((slide): slide is Slide => slide !== undefined)
    : orderedSlideIds
        .map((slideId) => currentSnapshot.slides.find((slide) => slide.id === slideId))
        .filter((slide): slide is Slide => slide !== undefined);
  const currentSlide = currentSnapshot.slides.find((slide) => slide.id === activeSlideId);
  const candidateSlide = preview.ok
    ? preview.candidate.slides.find((slide) => slide.id === activeSlideId)
    : undefined;
  const isBusy = pendingDecision !== null;
  const isActionable = proposal.status === 'ready';
  const actionsDisabled = disabled || isBusy || !preview.ok || !isActionable;

  return (
    <section
      aria-busy={isBusy}
      aria-label={`Review proposal: ${proposal.summary}`}
      className={['nsx-proposal-review', className].filter(Boolean).join(' ')}
      data-nodeslide-surface="proposal-review"
    >
      <header className="nsx-proposal-header">
        <div>
          <p className="nsx-eyebrow">Unapplied proposal</p>
          <h2>{proposal.summary}</h2>
          <p>
            {proposal.operations.length} operation{proposal.operations.length === 1 ? '' : 's'} ·
            based on deck v{proposal.baseDeckVersion}
          </p>
        </div>
        <span className="nsx-proposal-status" data-status={proposal.status}>
          {proposal.status}
        </span>
      </header>

      {preview.ok ? (
        <>
          <label className="nsx-slide-picker">
            <span>Compare slide</span>
            <select
              onChange={(event) => onActiveSlideChange(event.currentTarget.value)}
              value={activeSlideId}
            >
              {orderedSlides.map((slide, index) => (
                <option key={slide.id} value={slide.id}>
                  {index + 1}. {slide.title}
                </option>
              ))}
            </select>
          </label>

          <div className="nsx-proposal-comparison">
            <NodeSlideComparisonPane label="Current" version={currentSnapshot.deck.version}>
              {currentSlide ? (
                <NodeSlideSlideFrame
                  ariaLabel={`Current version of ${currentSlide.title}`}
                  elements={currentSnapshot.elements.filter(
                    (element) => element.slideId === currentSlide.id,
                  )}
                  slide={currentSlide}
                  theme={currentSnapshot.deck.theme}
                />
              ) : (
                <p className="nsx-empty-state">This slide does not exist in the current deck.</p>
              )}
            </NodeSlideComparisonPane>
            <NodeSlideComparisonPane label="Proposed" version={preview.candidate.deck.version}>
              {candidateSlide ? (
                <NodeSlideSlideFrame
                  ariaLabel={`Proposed version of ${candidateSlide.title}`}
                  elements={preview.candidate.elements.filter(
                    (element) => element.slideId === candidateSlide.id,
                  )}
                  slide={candidateSlide}
                  theme={preview.candidate.deck.theme}
                />
              ) : (
                <p className="nsx-empty-state">This proposal removes the selected slide.</p>
              )}
            </NodeSlideComparisonPane>
          </div>

          <dl className="nsx-change-summary">
            <div>
              <dt>Affected slides</dt>
              <dd>{preview.affectedSlideIds.length}</dd>
            </div>
            <div>
              <dt>Affected elements</dt>
              <dd>{preview.affectedElementIds.length}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>{proposal.source}</dd>
            </div>
          </dl>
        </>
      ) : (
        <div className="nsx-proposal-error" role="alert">
          <strong>Preview blocked</strong>
          <p>{preview.error}</p>
        </div>
      )}

      <footer className="nsx-proposal-actions">
        <p aria-live="polite">
          {pendingDecision === 'accept'
            ? 'Accepting proposal…'
            : pendingDecision === 'reject'
              ? 'Rejecting proposal…'
              : preview.ok
                ? isActionable
                  ? 'No change is applied until the host records your decision.'
                  : `This ${proposal.status} proposal is read-only and cannot be decided.`
                : 'Resolve the preview error before making a decision.'}
        </p>
        <div>
          <button disabled={actionsDisabled} onClick={() => onDecision('reject')} type="button">
            {rejectLabel}
          </button>
          <button
            className="nsx-primary-action"
            disabled={actionsDisabled}
            onClick={() => onDecision('accept')}
            type="button"
          >
            {acceptLabel}
          </button>
        </div>
      </footer>
    </section>
  );
}

function NodeSlideComparisonPane({
  label,
  version,
  children,
}: {
  label: string;
  version: number;
  children: ReactNode;
}) {
  return (
    <article className="nsx-comparison-pane">
      <header>
        <h3>{label}</h3>
        <span>v{version}</span>
      </header>
      {children}
    </article>
  );
}
