import type {
  NodeSlidePatchCommand,
  NodeSlidePrincipal,
  NodeSlideProposalDecision,
} from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot } from '@nodeslide/contracts';
import { type NodeSlideStudioComposerActions, NodeSlideStudioShell } from '@nodeslide/react';
import {
  type NodeSlideSelection,
  nodeSlideStudioPermissionsForPrincipal,
  useNodeSlideRepositoryController,
} from '@nodeslide/react-headless';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { type NodeSlideConvexAdapterConfig, createNodeSlideConvexAdapters } from './index';

export interface ConvexNodeSlideStudioProps {
  deckId: string;
  principal: NodeSlidePrincipal;
  adapter: NodeSlideConvexAdapterConfig;
  initialProposal?: DeckPatch | null;
  onExport?: (snapshot: DeckSnapshot) => void;
  onError?: (error: Error) => void;
  agentThread?: ReactNode;
  renderComposer?: (actions: NodeSlideStudioComposerActions) => ReactNode;
  className?: string;
}

/**
 * Optional convenience binding. It owns only transient selection and the
 * currently-created proposal; Convex remains authoritative for deck state.
 */
export function ConvexNodeSlideStudio({
  deckId,
  principal,
  adapter,
  initialProposal = null,
  onExport,
  onError,
  agentThread,
  renderComposer,
  className,
}: ConvexNodeSlideStudioProps) {
  const adapters = useMemo(() => createNodeSlideConvexAdapters(adapter), [adapter]);
  const controller = useNodeSlideRepositoryController({
    repository: adapters.repository,
    deckId,
    principal,
  });
  const [selection, setSelection] = useState<NodeSlideSelection>({
    slideId: null,
    elementIds: [],
  });
  const [proposal, setProposal] = useState<DeckPatch | null>(initialProposal);
  const [pendingDecision, setPendingDecision] = useState<NodeSlideProposalDecision | null>(null);
  const permissions = nodeSlideStudioPermissionsForPrincipal(principal);

  useEffect(() => {
    const snapshot = controller.snapshot;
    if (!snapshot) return;
    if (snapshot.slides.some((slide) => slide.id === selection.slideId)) return;
    setSelection({ slideId: snapshot.deck.slideOrder[0] ?? null, elementIds: [] });
  }, [controller.snapshot, selection.slideId]);

  useEffect(() => {
    if (controller.error) onError?.(controller.error);
  }, [controller.error, onError]);

  function apply(command: NodeSlidePatchCommand): void {
    void controller.applyPatch(command).catch(() => undefined);
  }

  function propose(command: NodeSlidePatchCommand): void {
    void controller
      .createProposal(command)
      .then(setProposal)
      .catch(() => undefined);
  }

  function resolve(proposalId: string, decision: NodeSlideProposalDecision): void {
    setPendingDecision(decision);
    void controller
      .resolveProposal(proposalId, decision)
      .then((result) => setProposal(result.patch))
      .catch(() => undefined)
      .finally(() => setPendingDecision(null));
  }

  return (
    <NodeSlideStudioShell
      {...(agentThread === undefined ? {} : { agentThread })}
      {...(className === undefined ? {} : { className })}
      disabled={controller.pendingCommand !== null}
      error={controller.error?.message ?? null}
      loading={controller.status === 'loading'}
      onAccept={(proposalId) => resolve(proposalId, 'accept')}
      onExport={() => {
        if (controller.snapshot) onExport?.(controller.snapshot);
      }}
      onPatch={apply}
      onPropose={propose}
      onReject={(proposalId) => resolve(proposalId, 'reject')}
      onSelectionChange={setSelection}
      pendingDecision={pendingDecision}
      permissions={permissions}
      proposal={proposal}
      {...(renderComposer === undefined ? {} : { renderComposer })}
      selection={selection}
      snapshot={controller.snapshot}
    />
  );
}
