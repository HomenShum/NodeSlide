import {
  type CaseflowRuntime,
  type NodeKitActor,
  type NodeKitApproval,
  type NodeKitArtifact,
  type NodeKitCase,
  type NodeKitCaseflowSnapshot,
  type NodeKitException,
  type NodeKitProposal,
  type NodeKitReceipt,
  type NodeKitRun,
  runtimeProfiles,
} from '@homenshum/nodekit/caseflow';

/** Replaced with the final packed source identity when NodeKit is frozen. */
export const NODEKIT_CASEFLOW_SOURCE_COMMIT = 'pending-final-nodekit-source' as const;
export const NODEKIT_CASEFLOW_SOURCE_HASH = 'pending-final-nodekit-source-hash' as const;
export const NODEKIT_CASEFLOW_TARBALL_SHA256 = 'pending-final-nodekit-tarball' as const;

export type NodeSlideCaseflowMutation =
  | 'createCase'
  | 'updateCaseInput'
  | 'startRun'
  | 'enterStage'
  | 'createArtifact'
  | 'createProposal'
  | 'decideProposal'
  | 'raiseException'
  | 'resolveException'
  | 'completeRun'
  | 'cancelRun'
  | 'failRunSafely';

export interface NodeSlideCaseflowTransport {
  mutation(operation: NodeSlideCaseflowMutation, args: Record<string, unknown>): Promise<unknown>;
  query(operation: 'snapshot', args: Record<string, unknown>): Promise<unknown>;
}

export interface NodeSlideCaseflowScope {
  /** Existing NodeSlide deck whose authenticated binding determines component scope. */
  deckId: string;
  /** Optional real nodeslide_agent_runs id for domain adoption flows. */
  generationId?: string;
  /** Optional stable reference to the canonical deck/render artifact. */
  domainArtifactRef?: string;
  /** Optional real nodeslide_validations id for a known validation exception. */
  validationRef?: string;
}

type ProposalDecisionInput = Parameters<CaseflowRuntime['decideProposal']>[0] & {
  /** Existing nodeslide_package_receipts id returned by NodeSlideRepository. */
  domainReceiptRef?: string;
};

/**
 * Portable product adapter over application-owned Convex functions. Those
 * functions authenticate, authorize the deck, and then call the installed
 * isolated NodeKit component; this client never receives a scopeKey or bearer.
 */
export function createNodeSlideCaseflowRuntime(
  transport: NodeSlideCaseflowTransport,
  scope: NodeSlideCaseflowScope,
): CaseflowRuntime & {
  decideProposal(input: ProposalDecisionInput): Promise<{
    approval: NodeKitApproval;
    artifact: NodeKitArtifact;
    proposal: NodeKitProposal;
    reused: boolean;
  }>;
} {
  const scoped = (args: Record<string, unknown>) => ({ deckId: scope.deckId, ...args });
  const mutate = async <T>(operation: NodeSlideCaseflowMutation, args: Record<string, unknown>) =>
    (await transport.mutation(operation, scoped(args))) as T;

  return {
    capabilities: runtimeProfiles.convex,
    createCase: async ({ title, primaryJob }) =>
      mutate<NodeKitCase>('createCase', { title, primaryJob }),
    updateCaseInput: async ({ caseId, title, primaryJob }) =>
      mutate<NodeKitCase>('updateCaseInput', {
        caseId,
        ...(title === undefined ? {} : { title }),
        ...(primaryJob === undefined ? {} : { primaryJob }),
      }),
    startRun: async ({ caseId, stages }) =>
      mutate<NodeKitRun>('startRun', {
        caseId,
        stages,
        ...(scope.generationId ? { generationId: scope.generationId } : {}),
      }),
    enterStage: async ({ runId, stageId, nextAction, nextActionOwner, idempotencyKey }) =>
      mutate<NodeKitRun>('enterStage', {
        runId,
        stageId,
        ...(nextAction === undefined ? {} : { nextAction }),
        ...(nextActionOwner === undefined ? {} : { nextActionOwner }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      }),
    createArtifact: async <T = unknown>({
      caseId,
      runId,
      title,
      content,
      idempotencyKey,
    }: {
      caseId: string;
      runId: string;
      kind?: string;
      title?: string;
      content: T;
      actor?: NodeKitActor;
      idempotencyKey?: string;
    }) =>
      mutate<NodeKitArtifact<T>>('createArtifact', {
        caseId,
        runId,
        content,
        ...(title === undefined ? {} : { title }),
        ...(scope.generationId ? { generationId: scope.generationId } : {}),
        ...(scope.domainArtifactRef ? { domainArtifactRef: scope.domainArtifactRef } : {}),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      }),
    createProposal: async <T = unknown>({
      artifactId,
      baseVersion,
      patch,
      rationale,
      idempotencyKey,
    }: {
      artifactId: string;
      baseVersion: number;
      patch: T;
      rationale?: string;
      actor?: NodeKitActor;
      idempotencyKey?: string;
    }) => {
      const patchId = (patch as { id?: unknown } | null)?.id;
      if (typeof patchId !== 'string' || !patchId.trim()) {
        throw new Error('NodeSlide Caseflow proposals require a persisted patch id.');
      }
      return mutate<NodeKitProposal<T>>('createProposal', {
        artifactId,
        baseVersion,
        patchId,
        ...(rationale === undefined ? {} : { rationale }),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      });
    },
    decideProposal: async (input: ProposalDecisionInput) =>
      mutate<{
        approval: NodeKitApproval;
        artifact: NodeKitArtifact;
        proposal: NodeKitProposal;
        reused: boolean;
      }>('decideProposal', {
        proposalId: input.proposalId,
        decision: input.decision,
        ...(input.comment === undefined ? {} : { comment: input.comment }),
        ...(input.domainReceiptRef === undefined
          ? {}
          : { domainReceiptRef: input.domainReceiptRef }),
      }),
    raiseException: async <T = unknown>({
      runId,
      code,
      message,
      preservedState,
      idempotencyKey,
    }: {
      runId: string;
      code?: string;
      message?: string;
      preservedState?: T;
      actor?: NodeKitActor;
      idempotencyKey?: string;
    }) =>
      mutate<NodeKitException<T>>('raiseException', {
        runId,
        ...(code === undefined ? {} : { code }),
        ...(message === undefined ? {} : { message }),
        ...(preservedState === undefined ? {} : { preservedState }),
        ...(scope.validationRef ? { validationRef: scope.validationRef } : {}),
        ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      }),
    resolveException: async ({ exceptionId, resolution, nextAction, nextActionOwner }) =>
      mutate<{ exception: NodeKitException; run: NodeKitRun }>('resolveException', {
        exceptionId,
        ...(resolution === undefined ? {} : { resolution }),
        ...(nextAction === undefined ? {} : { nextAction }),
        ...(nextActionOwner === undefined ? {} : { nextActionOwner }),
      }),
    completeRun: async ({ runId }) =>
      mutate<{ receipt: NodeKitReceipt; run: NodeKitRun; reused: boolean }>('completeRun', {
        runId,
      }),
    cancelRun: async ({ runId, reason }) =>
      mutate<{ receipt: NodeKitReceipt; run: NodeKitRun; reused: boolean }>('cancelRun', {
        runId,
        ...(reason === undefined ? {} : { reason }),
      }),
    failRunSafely: async ({ runId, reason }) =>
      mutate<{ receipt: NodeKitReceipt; run: NodeKitRun; reused: boolean }>('failRunSafely', {
        runId,
        ...(reason === undefined ? {} : { reason }),
      }),
    snapshot: async () =>
      (await transport.query('snapshot', { deckId: scope.deckId })) as NodeKitCaseflowSnapshot,
  };
}

export type NodeSlideCaseflowActor = NodeKitActor;
