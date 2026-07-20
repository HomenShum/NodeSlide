import type {
  NodeSlideAuthorizationEvidence,
  NodeSlideAuthorizationReceipt,
  NodeSlideRepositoryAuthorizationAction,
} from '@nodeslide/backend';
import { v } from 'convex/values';

export const NODESLIDE_COMPONENT_GRANT_VERSION = 'nodeslide.component-grant/v1' as const;

export type NodeSlideComponentGrantAction =
  | NodeSlideRepositoryAuthorizationAction
  | 'deck.initialize'
  | 'asset.put'
  | 'asset.get'
  | 'asset.delete'
  | 'migration.apply';

export type NodeSlideComponentResourceKind =
  | 'deck'
  | 'patch'
  | 'proposal'
  | 'receipt'
  | 'asset'
  | 'migration';

export interface NodeSlideComponentGrant {
  schemaVersion: typeof NODESLIDE_COMPONENT_GRANT_VERSION;
  id: string;
  principalId: string;
  organizationId?: string;
  deckId: string;
  action: NodeSlideComponentGrantAction;
  resource: { kind: NodeSlideComponentResourceKind; id: string };
  authorizedAt: number;
  evidence: NodeSlideAuthorizationEvidence;
}

const componentActionValidator = v.union(
  v.literal('deck.read'),
  v.literal('patch.apply'),
  v.literal('proposal.create'),
  v.literal('proposal.accept'),
  v.literal('proposal.reject'),
  v.literal('versions.list'),
  v.literal('receipt.store'),
  v.literal('deck.initialize'),
  v.literal('asset.put'),
  v.literal('asset.get'),
  v.literal('asset.delete'),
  v.literal('migration.apply'),
);

export const nodeSlideComponentGrantValidator = v.object({
  schemaVersion: v.literal(NODESLIDE_COMPONENT_GRANT_VERSION),
  id: v.string(),
  principalId: v.string(),
  organizationId: v.optional(v.string()),
  deckId: v.string(),
  action: componentActionValidator,
  resource: v.object({
    kind: v.union(
      v.literal('deck'),
      v.literal('patch'),
      v.literal('proposal'),
      v.literal('receipt'),
      v.literal('asset'),
      v.literal('migration'),
    ),
    id: v.string(),
  }),
  authorizedAt: v.number(),
  evidence: v.object({
    issuer: v.string(),
    policyId: v.string(),
    policyVersion: v.string(),
    evidenceId: v.optional(v.string()),
  }),
});

const REPOSITORY_ACTIONS = new Set<NodeSlideRepositoryAuthorizationAction>([
  'deck.read',
  'patch.apply',
  'proposal.create',
  'proposal.accept',
  'proposal.reject',
  'versions.list',
  'receipt.store',
]);

export function nodeSlideAuthorizationReceiptFromGrant(
  grant: NodeSlideComponentGrant,
): NodeSlideAuthorizationReceipt {
  if (!REPOSITORY_ACTIONS.has(grant.action as NodeSlideRepositoryAuthorizationAction)) {
    throw new Error(`Component grant ${grant.id} cannot become a repository receipt.`);
  }
  return {
    schemaVersion: 'nodeslide.authorization/v1',
    id: grant.id,
    principalId: grant.principalId,
    ...(grant.organizationId === undefined ? {} : { organizationId: grant.organizationId }),
    deckId: grant.deckId,
    action: grant.action as NodeSlideRepositoryAuthorizationAction,
    resource: grant.resource as NodeSlideAuthorizationReceipt['resource'],
    authorizedAt: grant.authorizedAt,
    evidence: structuredClone(grant.evidence),
  };
}
