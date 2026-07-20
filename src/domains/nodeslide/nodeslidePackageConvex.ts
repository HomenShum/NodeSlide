import {
  NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
  NodeSlideRepositoryError,
  type NodeSlideServerGovernanceDeclaration,
} from '@nodeslide/backend';
import {
  type NodeSlideCapabilityConvexAdapters,
  type NodeSlideCapabilityConvexReferences,
  createNodeSlideCapabilityConvexAdapters,
} from '@nodeslide/convex';
import type { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../convex/_generated/api';
import { getDeckOwnerAccessKey } from '../../lib/sessionIdentity';

export const NODESLIDE_APP_CONVEX_GOVERNANCE = {
  version: NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
  enforced: {
    mutation_authority: true,
    version_cas: true,
    candidate_validation: true,
    trace_lineage: true,
    source_authorization: true,
    rollback: true,
  },
} satisfies NodeSlideServerGovernanceDeclaration;

/**
 * Concrete package binding for the live app. The generated references prove
 * that @nodeslide/convex can consume this deployment without importing its
 * `_generated/api`; only this host-owned file knows the generated API shape.
 */
export function createNodeSlideAppPackageAdapters(
  client: Pick<ConvexHttpClient, 'query' | 'mutation'>,
): NodeSlideCapabilityConvexAdapters {
  const references: NodeSlideCapabilityConvexReferences = {
    getDeck: api.nodeslide.packageGetDeck,
    applyPatch: api.nodeslide.packageApplyPatch,
    createProposal: api.nodeslide.packageCreateProposal,
    resolveProposal: api.nodeslide.packageResolveProposal,
    listVersions: api.nodeslide.packageListVersions,
    putAsset: api.nodeslide.packagePutAsset,
    getAsset: api.nodeslide.packageGetAsset,
    deleteAsset: api.nodeslide.packageDeleteAsset,
  };

  return createNodeSlideCapabilityConvexAdapters({
    client,
    references,
    governance: NODESLIDE_APP_CONVEX_GOVERNANCE,
    resolveOwnerAccessKey: (_principal, deckId) => requireStoredOwnerAccessKey(deckId),
  });
}

function requireStoredOwnerAccessKey(deckId: string): string {
  const ownerAccessKey = getDeckOwnerAccessKey(deckId);
  if (!ownerAccessKey) {
    throw new NodeSlideRepositoryError(
      'forbidden',
      `Owner access is unavailable for deck ${deckId}.`,
    );
  }
  return ownerAccessKey;
}
