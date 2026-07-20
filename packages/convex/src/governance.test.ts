import {
  NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
  type NodeSlideServerGovernanceDeclaration,
} from '@nodeslide/backend';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NODESLIDE_CONVEX_COMPONENT_UX_CONFIGURATION,
  NODESLIDE_CONVEX_COMPONENT_GOVERNANCE,
  assertNodeSlideConvexComponentConfiguration,
  nodeSlideComponentApprovalMode,
} from './governance';

describe('NodeSlide component governance configuration', () => {
  it('keeps every mutation invariant literal and non-configurable', () => {
    expect(NODESLIDE_CONVEX_COMPONENT_GOVERNANCE).toEqual({
      version: NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
      enforced: {
        mutation_authority: true,
        version_cas: true,
        candidate_validation: true,
        trace_lineage: true,
        source_authorization: true,
        rollback: true,
      },
    });
    const weakened = structuredClone(NODESLIDE_CONVEX_COMPONENT_GOVERNANCE) as unknown as {
      enforced: Record<string, boolean>;
    };
    weakened.enforced['candidate_validation'] = false;
    expect(() =>
      assertNodeSlideConvexComponentConfiguration({
        governance: weakened as unknown as NodeSlideServerGovernanceDeclaration,
      }),
    ).toThrow(/cannot disable candidate_validation/);
  });

  it('allows UX approval policy without turning off validation or rollback', () => {
    const ux = assertNodeSlideConvexComponentConfiguration({
      governance: NODESLIDE_CONVEX_COMPONENT_GOVERNANCE,
      ux: {
        approval: {
          defaultMode: 'auto_commit',
          byOperationMode: { copy: 'auto_commit', layout: 'proposal_required' },
          alwaysRequireProposalFor: ['remove_slide'],
        },
        turboAutoCommit: true,
        publishing: { requireHumanApproval: true },
        retention: { receiptDays: 30, versionLimit: 10 },
      },
    });
    expect(
      nodeSlideComponentApprovalMode(ux, {
        scope: { kind: 'deck', deckId: 'deck:test', operationMode: 'copy' },
        operations: [
          { op: 'update_deck', properties: { title: 'Cannot actually pass copy validation' } },
        ],
      }),
    ).toBe('auto_commit');
    expect(NODESLIDE_CONVEX_COMPONENT_GOVERNANCE.enforced.candidate_validation).toBe(true);
    expect(NODESLIDE_CONVEX_COMPONENT_GOVERNANCE.enforced.rollback).toBe(true);
    expect(DEFAULT_NODESLIDE_CONVEX_COMPONENT_UX_CONFIGURATION.turboAutoCommit).toBe(false);
  });
});
