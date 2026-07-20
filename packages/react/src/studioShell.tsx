import type { NodeSlidePatchCommand, NodeSlideProposalDecision } from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot } from '@nodeslide/contracts';
import {
  type NodeSlideSelection,
  type NodeSlideStudioPermissions,
  createNodeSlideProposalReviewModel,
  normalizeNodeSlideSelection,
} from '@nodeslide/react-headless';
import type { ReactNode } from 'react';
import { NodeSlideProposalReview } from './proposalReview';
import { NodeSlideDeckViewer } from './viewer';

export interface NodeSlideStudioComposerActions {
  canPatch: boolean;
  canPropose: boolean;
  patch(command: NodeSlidePatchCommand): void;
  propose(command: NodeSlidePatchCommand): void;
}

export interface NodeSlideStudioShellActions extends NodeSlideStudioComposerActions {
  selection: NodeSlideSelection;
  canAccept: boolean;
  canReject: boolean;
  canExport: boolean;
  select(selection: NodeSlideSelection): void;
  accept(proposalId: string): void;
  reject(proposalId: string): void;
  exportDeck(): void;
}

export interface NodeSlideStudioShellProps {
  snapshot: DeckSnapshot | null;
  selection: NodeSlideSelection;
  proposal?: DeckPatch | null;
  permissions: NodeSlideStudioPermissions;
  onSelectionChange(selection: NodeSlideSelection): void;
  onPatch(command: NodeSlidePatchCommand): void;
  onPropose(command: NodeSlidePatchCommand): void;
  onAccept(proposalId: string): void;
  onReject(proposalId: string): void;
  onExport(): void;
  pendingDecision?: NodeSlideProposalDecision | null;
  disabled?: boolean;
  loading?: boolean;
  error?: string | null;
  className?: string;
  agentThread?: ReactNode;
  renderComposer?: (actions: NodeSlideStudioComposerActions) => ReactNode;
  /**
   * Lets a product keep its richer visual shell while adopting this controlled
   * boundary. Selection normalization and every exposed command remain gated
   * here; the host renderer owns markup only.
   */
  renderSurface?: (actions: NodeSlideStudioShellActions) => ReactNode;
}

/** Styled, fully controlled shell. Persistence and identity stay in the host. */
export function NodeSlideStudioShell({
  snapshot,
  selection,
  proposal = null,
  permissions,
  onSelectionChange,
  onPatch,
  onPropose,
  onAccept,
  onReject,
  onExport,
  pendingDecision = null,
  disabled = false,
  loading = false,
  error = null,
  className,
  agentThread,
  renderComposer,
  renderSurface,
}: NodeSlideStudioShellProps) {
  const normalized = snapshot
    ? normalizeNodeSlideSelection(snapshot, selection)
    : { slideId: null, elementIds: [] };
  const activeSlideId = normalized.slideId ?? '';
  const interactionDisabled = disabled || loading;
  const composerActions: NodeSlideStudioComposerActions = {
    canPatch: permissions.canPatch && !interactionDisabled,
    canPropose: permissions.canPropose && !interactionDisabled,
    patch: (command) => {
      if (permissions.canPatch && !interactionDisabled) onPatch(command);
    },
    propose: (command) => {
      if (permissions.canPropose && !interactionDisabled) onPropose(command);
    },
  };
  const proposalReview =
    snapshot && proposal
      ? createNodeSlideProposalReviewModel({
          currentSnapshot: snapshot,
          proposal,
          activeSlideId,
          pendingDecision,
          disabled: !permissions.canApprove || interactionDisabled,
        })
      : null;
  const canDecide = proposalReview !== null && !proposalReview.actionsDisabled;
  const actions: NodeSlideStudioShellActions = {
    ...composerActions,
    selection: normalized,
    canAccept: canDecide,
    canReject: canDecide,
    canExport: Boolean(snapshot) && permissions.canExport && !interactionDisabled,
    select: (nextSelection) => {
      if (!snapshot || !permissions.canRead || interactionDisabled) return;
      onSelectionChange(normalizeNodeSlideSelection(snapshot, nextSelection));
    },
    accept: (proposalId) => {
      if (canDecide && proposal?.id === proposalId) onAccept(proposalId);
    },
    reject: (proposalId) => {
      if (canDecide && proposal?.id === proposalId) onReject(proposalId);
    },
    exportDeck: () => {
      if (snapshot && permissions.canExport && !interactionDisabled) onExport();
    },
  };

  if (renderSurface) return <>{renderSurface(actions)}</>;

  return (
    <section
      aria-busy={loading}
      aria-label="NodeSlide studio"
      className={['nsx-studio-shell', className].filter(Boolean).join(' ')}
      data-nodeslide-surface="studio-shell"
    >
      <header className="nsx-studio-toolbar">
        <div>
          <p className="nsx-eyebrow">NodeSlide Studio</p>
          <h1>{snapshot?.deck.title ?? 'Presentation unavailable'}</h1>
        </div>
        <button
          disabled={!snapshot || !permissions.canExport || interactionDisabled}
          onClick={actions.exportDeck}
          type="button"
        >
          Export
        </button>
      </header>

      {error ? (
        <div className="nsx-studio-error" role="alert">
          {error}
        </div>
      ) : null}

      <div className="nsx-studio-grid">
        <main>
          {snapshot && permissions.canRead ? (
            proposal ? (
              <NodeSlideProposalReview
                activeSlideId={activeSlideId}
                currentSnapshot={snapshot}
                disabled={!permissions.canApprove || interactionDisabled}
                onActiveSlideChange={(slideId) => actions.select({ slideId, elementIds: [] })}
                onDecision={(decision) =>
                  decision === 'accept' ? actions.accept(proposal.id) : actions.reject(proposal.id)
                }
                pendingDecision={pendingDecision}
                proposal={proposal}
              />
            ) : (
              <NodeSlideDeckViewer
                activeSlideId={activeSlideId}
                onActiveSlideChange={(slideId) => actions.select({ slideId, elementIds: [] })}
                snapshot={snapshot}
              />
            )
          ) : (
            <output className="nsx-empty-state">
              {loading
                ? 'Loading presentation…'
                : permissions.canRead
                  ? 'The presentation was not found.'
                  : 'You do not have permission to view this presentation.'}
            </output>
          )}
        </main>
        {agentThread || renderComposer ? (
          <aside className="nsx-studio-agent" aria-label="Presentation agent">
            {agentThread}
            {renderComposer?.(composerActions)}
          </aside>
        ) : null}
      </div>
    </section>
  );
}
