import {
  NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
  type NodeSlideApprovalMode,
  type NodeSlideMutationInvariant,
  type NodeSlideServerGovernanceDeclaration,
} from '@nodeslide/backend';
import type { OperationMode, PatchOperation } from '@nodeslide/contracts';

export const NODESLIDE_CONVEX_COMPONENT_GOVERNANCE = Object.freeze({
  version: NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
  enforced: Object.freeze({
    mutation_authority: true,
    version_cas: true,
    candidate_validation: true,
    trace_lineage: true,
    source_authorization: true,
    rollback: true,
  }),
}) satisfies NodeSlideServerGovernanceDeclaration;

export interface NodeSlideConvexComponentUxConfiguration {
  approval: {
    defaultMode: NodeSlideApprovalMode;
    byOperationMode: Partial<Record<OperationMode, NodeSlideApprovalMode>>;
    alwaysRequireProposalFor: readonly PatchOperation['op'][];
  };
  turboAutoCommit: boolean;
  publishing: {
    requireHumanApproval: boolean;
  };
  retention: {
    receiptDays: number;
    versionLimit: number;
  };
}

export const DEFAULT_NODESLIDE_CONVEX_COMPONENT_UX_CONFIGURATION = Object.freeze({
  approval: Object.freeze({
    defaultMode: 'proposal_required',
    byOperationMode: Object.freeze({}),
    alwaysRequireProposalFor: Object.freeze([]),
  }),
  turboAutoCommit: false,
  publishing: Object.freeze({ requireHumanApproval: true }),
  retention: Object.freeze({ receiptDays: 365, versionLimit: 100 }),
}) satisfies NodeSlideConvexComponentUxConfiguration;

const MUTATION_INVARIANTS = new Set<NodeSlideMutationInvariant>([
  'mutation_authority',
  'version_cas',
  'candidate_validation',
  'trace_lineage',
  'source_authorization',
  'rollback',
]);

/**
 * Fails closed if a host tries to weaken server governance while configuring UX.
 * UX policy is deliberately configurable, but the six mutation invariants are not.
 */
export function assertNodeSlideConvexComponentConfiguration(input: {
  governance: NodeSlideServerGovernanceDeclaration;
  ux?: NodeSlideConvexComponentUxConfiguration;
}): NodeSlideConvexComponentUxConfiguration {
  if (input.governance.version !== NODESLIDE_GOVERNANCE_CONTRACT_VERSION) {
    throw new Error(`Unsupported NodeSlide governance ${String(input.governance.version)}.`);
  }
  for (const invariant of MUTATION_INVARIANTS) {
    if (input.governance.enforced[invariant] !== true) {
      throw new Error(`The Convex component cannot disable ${invariant}.`);
    }
  }
  const ux = input.ux ?? DEFAULT_NODESLIDE_CONVEX_COMPONENT_UX_CONFIGURATION;
  assertApprovalMode(ux.approval.defaultMode, 'approval.defaultMode');
  for (const [mode, value] of Object.entries(ux.approval.byOperationMode)) {
    if (!isOperationMode(mode)) throw new Error(`Unknown operation mode ${mode}.`);
    assertApprovalMode(value, `approval.byOperationMode.${mode}`);
  }
  if (
    new Set(ux.approval.alwaysRequireProposalFor).size !==
    ux.approval.alwaysRequireProposalFor.length
  ) {
    throw new Error('approval.alwaysRequireProposalFor must not contain duplicates.');
  }
  if (!Number.isSafeInteger(ux.retention.receiptDays) || ux.retention.receiptDays < 1) {
    throw new Error('retention.receiptDays must be a positive integer.');
  }
  if (!Number.isSafeInteger(ux.retention.versionLimit) || ux.retention.versionLimit < 2) {
    throw new Error('retention.versionLimit must retain at least two versions for rollback.');
  }
  return structuredClone(ux);
}

export function nodeSlideComponentApprovalMode(
  configuration: NodeSlideConvexComponentUxConfiguration,
  patch: Pick<import('@nodeslide/backend').NodeSlidePatchCommand, 'operations' | 'scope'>,
): NodeSlideApprovalMode {
  if (
    patch.operations.some((operation) =>
      configuration.approval.alwaysRequireProposalFor.includes(operation.op),
    )
  ) {
    return 'proposal_required';
  }
  if (!configuration.turboAutoCommit) return 'proposal_required';
  return (
    configuration.approval.byOperationMode[patch.scope.operationMode] ??
    configuration.approval.defaultMode
  );
}

function assertApprovalMode(value: unknown, label: string): asserts value is NodeSlideApprovalMode {
  if (value !== 'auto_commit' && value !== 'proposal_required') {
    throw new Error(`${label} must be auto_commit or proposal_required.`);
  }
}

function isOperationMode(value: string): value is OperationMode {
  return value === 'copy' || value === 'style' || value === 'layout' || value === 'unrestricted';
}
