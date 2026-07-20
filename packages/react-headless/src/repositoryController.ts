import type {
  NodeSlidePatchCommand,
  NodeSlidePrincipal,
  NodeSlideProposalDecision,
  NodeSlideProposalResolution,
  NodeSlideRepository,
} from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot } from '@nodeslide/contracts';
import { useCallback, useEffect, useRef, useState } from 'react';

export type NodeSlideRepositoryLoadStatus = 'loading' | 'ready' | 'not_found' | 'error';

export interface UseNodeSlideRepositoryControllerInput {
  repository: NodeSlideRepository;
  deckId: string;
  principal: NodeSlidePrincipal;
}

export interface NodeSlideRepositoryController {
  status: NodeSlideRepositoryLoadStatus;
  snapshot: DeckSnapshot | null;
  error: Error | null;
  pendingCommand: 'apply' | 'propose' | 'resolve' | null;
  reload(): Promise<void>;
  applyPatch(patch: NodeSlidePatchCommand): Promise<DeckSnapshot>;
  createProposal(patch: NodeSlidePatchCommand): Promise<DeckPatch>;
  resolveProposal(
    proposalId: string,
    decision: NodeSlideProposalDecision,
  ): Promise<NodeSlideProposalResolution>;
}

export function useNodeSlideRepositoryController({
  repository,
  deckId,
  principal,
}: UseNodeSlideRepositoryControllerInput): NodeSlideRepositoryController {
  const [status, setStatus] = useState<NodeSlideRepositoryLoadStatus>('loading');
  const [snapshot, setSnapshot] = useState<DeckSnapshot | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [pendingCommand, setPendingCommand] =
    useState<NodeSlideRepositoryController['pendingCommand']>(null);
  const requestSequence = useRef(0);

  const reload = useCallback(async () => {
    const request = ++requestSequence.current;
    setStatus('loading');
    setError(null);
    try {
      const value = await repository.getDeck({ deckId, principal });
      if (request !== requestSequence.current) return;
      setSnapshot(value);
      setStatus(value ? 'ready' : 'not_found');
    } catch (cause) {
      if (request !== requestSequence.current) return;
      setSnapshot(null);
      setError(asError(cause));
      setStatus('error');
    }
  }, [deckId, principal, repository]);

  useEffect(() => {
    void reload();
    return () => {
      requestSequence.current += 1;
    };
  }, [reload]);

  const applyPatch = useCallback(
    async (patch: NodeSlidePatchCommand) => {
      setPendingCommand('apply');
      setError(null);
      try {
        const result = await repository.applyPatch({ deckId, principal, patch });
        setSnapshot(result.snapshot);
        setStatus('ready');
        return result.snapshot;
      } catch (cause) {
        const next = asError(cause);
        setError(next);
        throw next;
      } finally {
        setPendingCommand(null);
      }
    },
    [deckId, principal, repository],
  );

  const createProposal = useCallback(
    async (patch: NodeSlidePatchCommand) => {
      setPendingCommand('propose');
      setError(null);
      try {
        return await repository.createProposal({ deckId, principal, patch });
      } catch (cause) {
        const next = asError(cause);
        setError(next);
        throw next;
      } finally {
        setPendingCommand(null);
      }
    },
    [deckId, principal, repository],
  );

  const resolveProposal = useCallback(
    async (proposalId: string, decision: NodeSlideProposalDecision) => {
      setPendingCommand('resolve');
      setError(null);
      try {
        const result = await repository.resolveProposal({
          deckId,
          principal,
          proposalId,
          decision,
        });
        setSnapshot(result.snapshot);
        setStatus('ready');
        return result;
      } catch (cause) {
        const next = asError(cause);
        setError(next);
        throw next;
      } finally {
        setPendingCommand(null);
      }
    },
    [deckId, principal, repository],
  );

  return {
    status,
    snapshot,
    error,
    pendingCommand,
    reload,
    applyPatch,
    createProposal,
    resolveProposal,
  };
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
