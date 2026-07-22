import {
  type CaseflowConformanceVerdict,
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
  runCaseflowConformance,
  runtimeProfiles,
} from '@homenshum/nodekit/caseflow';

export const NODEKIT_CASEFLOW_SOURCE_COMMIT = '5cc61578b3c1bd5b5c8195b83347b91f8b83242b' as const;

export type NodeSlideCaseflowMutation =
  | 'createCase'
  | 'startRun'
  | 'enterStage'
  | 'createArtifact'
  | 'createProposal'
  | 'decideProposal'
  | 'raiseException'
  | 'resolveException'
  | 'completeRun';

export interface NodeSlideCaseflowTransport {
  mutation(operation: NodeSlideCaseflowMutation, args: Record<string, unknown>): Promise<unknown>;
  query(operation: 'snapshot', args: Record<string, unknown>): Promise<unknown>;
}

export interface NodeSlideCaseflowScope {
  /** Authenticated workspace resolved by the application wrapper. */
  workspaceId: string;
  /** Existing NodeSlide deck bound to that workspace. */
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
 * Thin portable adapter. Authentication is deliberately absent here: every
 * transport target is an application-owned Convex function that resolves
 * ctx.auth and workspace ownership before touching lifecycle rows.
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
  const scoped = (args: Record<string, unknown>) => ({ workspaceId: scope.workspaceId, ...args });
  const mutate = async <T>(operation: NodeSlideCaseflowMutation, args: Record<string, unknown>) =>
    (await transport.mutation(operation, scoped(args))) as T;

  return {
    capabilities: runtimeProfiles.convex,
    createCase: async ({ title, primaryJob }) =>
      mutate<NodeKitCase>('createCase', { deckId: scope.deckId, title, primaryJob }),
    startRun: async ({ caseId, stages }) =>
      mutate<NodeKitRun>('startRun', {
        caseId,
        stages,
        ...(scope.generationId ? { generationId: scope.generationId } : {}),
      }),
    enterStage: async ({ runId, stageId, nextAction, nextActionOwner }) =>
      mutate<NodeKitRun>('enterStage', {
        runId,
        stageId,
        ...(nextAction === undefined ? {} : { nextAction }),
        ...(nextActionOwner === undefined ? {} : { nextActionOwner }),
      }),
    createArtifact: async <T = unknown>({
      caseId,
      runId,
      kind,
      title,
      content,
    }: {
      caseId: string;
      runId: string;
      kind?: string;
      title?: string;
      content: T;
      actor?: NodeKitActor;
    }) =>
      mutate<NodeKitArtifact<T>>('createArtifact', {
        caseId,
        runId,
        title: title ?? 'NodeSlide deck',
        content,
        ...(kind === undefined ? {} : { kind }),
        ...(scope.domainArtifactRef ? { domainArtifactRef: scope.domainArtifactRef } : {}),
      }),
    createProposal: async <T = unknown>({
      artifactId,
      baseVersion,
      patch,
      rationale,
    }: {
      artifactId: string;
      baseVersion: number;
      patch: T;
      rationale?: string;
      actor?: NodeKitActor;
    }) =>
      mutate<NodeKitProposal<T>>('createProposal', {
        artifactId,
        baseVersion,
        patch,
        ...(rationale === undefined ? {} : { rationale }),
      }),
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
    }: {
      runId: string;
      code?: string;
      message?: string;
      preservedState?: T;
      actor?: NodeKitActor;
    }) =>
      mutate<NodeKitException<T>>('raiseException', {
        runId,
        code: code ?? 'unknown',
        message: message ?? 'NodeSlide validation requires attention.',
        preservedState: preservedState ?? {},
        ...(scope.validationRef ? { validationRef: scope.validationRef } : {}),
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
    snapshot: async () =>
      (await transport.query('snapshot', {
        workspaceId: scope.workspaceId,
      })) as NodeKitCaseflowSnapshot,
  };
}

export async function runNodeSlideCaseflowConformance(
  transport: NodeSlideCaseflowTransport,
  scope: NodeSlideCaseflowScope,
): Promise<CaseflowConformanceVerdict> {
  return runCaseflowConformance(() => createNodeSlideCaseflowRuntime(transport, scope));
}

export type NodeSlideCaseflowDomainRefs = {
  deckIds: string[];
  domainArtifactRefs: string[];
  domainReceiptRefs: string[];
  generationIds: string[];
  patchIds: string[];
  validationRefs: string[];
};

export type NodeSlideCaseflowActor = NodeKitActor;
