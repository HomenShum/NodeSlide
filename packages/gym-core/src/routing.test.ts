import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  type NodeGymTrustedProductionApprovalContext,
  buildNodeGymRoutingApprovalReceipt,
  nodeGymEscalationDecision,
  nodeGymRoutingApprovalReceiptDigest,
  selectNodeGymGovernedRoute,
} from './routing';

const digest = (character: string) => `sha256:${character.repeat(64)}`;
const now = 1_800_000_000_000;
const champion = {
  taskClass: 'chart',
  model: 'small-model',
  harness: 'heavy-v2',
  evidenceDigest: digest('a'),
  eligible: true,
  evaluatedAt: now - 1_000,
  expiresAt: now + 60_000,
  maxCostMicroUsd: 2_000,
};

describe('NodeGym governed routing', () => {
  it('keeps an eligible unapproved champion shadow-only', () => {
    const verifyTrustedProductionApproval = vi.fn(() => true);
    expect(
      selectNodeGymGovernedRoute({
        taskClass: 'chart',
        champions: [champion],
        approvalReceipts: [],
        circuits: [{ routeKey: 'small-model::heavy-v2', state: 'closed', consecutiveFailures: 0 }],
        fallback: { model: 'frontier-default', harness: 'light' },
        now,
        metadataMaxAgeMs: 60_000,
        perRouteCostCapMicroUsd: 3_000,
        mode: 'shadow',
        verifyTrustedProductionApproval,
      }),
    ).toMatchObject({ mode: 'shadow', userVisible: false, routingMutationApplied: false });
    expect(verifyTrustedProductionApproval).not.toHaveBeenCalled();
  });

  it('requires a current exact approval receipt for a user-visible route', () => {
    const base = {
      taskClass: 'chart',
      champions: [champion],
      circuits: [
        { routeKey: 'small-model::heavy-v2', state: 'closed' as const, consecutiveFailures: 0 },
      ],
      fallback: { model: 'frontier-default', harness: 'light' },
      now,
      metadataMaxAgeMs: 60_000,
      perRouteCostCapMicroUsd: 3_000,
      mode: 'production' as const,
    };
    expect(selectNodeGymGovernedRoute({ ...base, approvalReceipts: [] })).toMatchObject({
      mode: 'fallback',
      blockers: ['routing_approval_missing'],
      routingMutationApplied: false,
    });
    const approval = buildNodeGymRoutingApprovalReceipt({
      proposal: champion,
      approvedBy: 'human-owner',
      approvedAt: now - 100,
      expiresAt: now + 60_000,
      status: 'approved',
    });
    const { receiptDigest, ...unsignedApproval } = approval;
    expect(receiptDigest).toBe(nodeGymRoutingApprovalReceiptDigest(unsignedApproval));
    expect(approval.proposalDigest).toBe(
      realSha256(
        JSON.stringify([
          'nodekit.gym-route-proposal/v1',
          champion.taskClass,
          champion.model,
          champion.harness,
          champion.evidenceDigest,
          champion.eligible,
          champion.evaluatedAt,
          champion.expiresAt,
          champion.maxCostMicroUsd,
        ]),
      ),
    );
    expect(receiptDigest).toBe(
      realSha256(
        JSON.stringify([
          unsignedApproval.schemaVersion,
          unsignedApproval.proposalDigest,
          unsignedApproval.taskClass,
          unsignedApproval.model,
          unsignedApproval.harness,
          unsignedApproval.evidenceDigest,
          unsignedApproval.approvedBy,
          unsignedApproval.approvedAt,
          unsignedApproval.expiresAt,
          unsignedApproval.status,
          unsignedApproval.autoApply,
        ]),
      ),
    );
    expect(
      selectNodeGymGovernedRoute({
        ...base,
        approvalReceipts: [approval],
      }),
    ).toMatchObject({
      mode: 'fallback',
      blockers: ['routing_approval_authority_missing'],
      routingMutationApplied: false,
    });

    const verifyTrustedProductionApproval = vi.fn(
      (context: NodeGymTrustedProductionApprovalContext) => {
        expect(context.proposal).toEqual(champion);
        expect(context.approval).toEqual(approval);
        expect(context.expectedProposalDigest).toBe(approval.proposalDigest);
        expect(context.expectedReceiptDigest).toBe(approval.receiptDigest);
        return context.approval.approvedBy === 'human-owner';
      },
    );
    expect(
      selectNodeGymGovernedRoute({
        ...base,
        approvalReceipts: [approval],
        verifyTrustedProductionApproval,
      }),
    ).toMatchObject({ mode: 'production', userVisible: true, routingMutationApplied: true });
    expect(verifyTrustedProductionApproval).toHaveBeenCalledOnce();
  });

  it('rejects arbitrary, tampered, and proposal-replayed approval digests', () => {
    const approval = buildNodeGymRoutingApprovalReceipt({
      proposal: champion,
      approvedBy: 'human-owner',
      approvedAt: now - 100,
      expiresAt: now + 60_000,
      status: 'approved',
    });
    const base = {
      taskClass: 'chart',
      champions: [champion],
      circuits: [
        { routeKey: 'small-model::heavy-v2', state: 'closed' as const, consecutiveFailures: 0 },
      ],
      fallback: { model: 'frontier-default', harness: 'light' },
      now,
      metadataMaxAgeMs: 60_000,
      perRouteCostCapMicroUsd: 3_000,
      mode: 'production' as const,
    };

    for (const forged of [
      { ...approval, receiptDigest: digest('b') },
      { ...approval, approvedBy: 'forged-owner' },
      { ...approval, proposalDigest: digest('c') },
    ]) {
      const verifier = vi.fn(() => true);
      expect(
        selectNodeGymGovernedRoute({
          ...base,
          approvalReceipts: [forged],
          verifyTrustedProductionApproval: verifier,
        }),
      ).toMatchObject({
        mode: 'fallback',
        blockers: ['routing_approval_invalid'],
        routingMutationApplied: false,
      });
      expect(verifier).not.toHaveBeenCalled();
    }

    const changedProposal = { ...champion, maxCostMicroUsd: 2_500 };
    expect(
      selectNodeGymGovernedRoute({
        ...base,
        champions: [changedProposal],
        approvalReceipts: [approval],
      }),
    ).toMatchObject({
      mode: 'fallback',
      blockers: ['routing_approval_invalid'],
      routingMutationApplied: false,
    });
  });

  it('rejects a canonically hashed self-minted approval without trusted authority', () => {
    const attackerMinted = buildNodeGymRoutingApprovalReceipt({
      proposal: champion,
      approvedBy: 'attacker-asserted-owner',
      approvedAt: now - 100,
      expiresAt: now + 60_000,
      status: 'approved',
    });
    const base = {
      taskClass: 'chart',
      champions: [champion],
      approvalReceipts: [attackerMinted],
      circuits: [
        { routeKey: 'small-model::heavy-v2', state: 'closed' as const, consecutiveFailures: 0 },
      ],
      fallback: { model: 'frontier-default', harness: 'light' },
      now,
      metadataMaxAgeMs: 60_000,
      perRouteCostCapMicroUsd: 3_000,
      mode: 'production' as const,
    };

    expect(selectNodeGymGovernedRoute(base)).toMatchObject({
      mode: 'fallback',
      blockers: ['routing_approval_authority_missing'],
      routingMutationApplied: false,
    });
    expect(
      selectNodeGymGovernedRoute({
        ...base,
        verifyTrustedProductionApproval: () => false,
      }),
    ).toMatchObject({
      mode: 'fallback',
      blockers: ['routing_approval_untrusted'],
      routingMutationApplied: false,
    });
    expect(
      selectNodeGymGovernedRoute({
        ...base,
        verifyTrustedProductionApproval: () => {
          throw new Error('trusted authority unavailable');
        },
      }),
    ).toMatchObject({
      mode: 'fallback',
      blockers: ['routing_approval_untrusted'],
      routingMutationApplied: false,
    });
  });

  it('keeps revocation explicit and auto-apply permanently false', () => {
    const revoked = buildNodeGymRoutingApprovalReceipt({
      proposal: champion,
      approvedBy: 'human-owner',
      approvedAt: now - 100,
      expiresAt: now + 60_000,
      status: 'revoked',
    });
    expect(revoked.autoApply).toBe(false);
    expect(
      selectNodeGymGovernedRoute({
        taskClass: 'chart',
        champions: [champion],
        approvalReceipts: [revoked],
        circuits: [{ routeKey: 'small-model::heavy-v2', state: 'closed', consecutiveFailures: 0 }],
        fallback: { model: 'frontier-default', harness: 'light' },
        now,
        metadataMaxAgeMs: 60_000,
        perRouteCostCapMicroUsd: 3_000,
        mode: 'production',
      }),
    ).toMatchObject({
      mode: 'fallback',
      blockers: ['routing_approval_invalid'],
      routingMutationApplied: false,
    });
  });

  it('refuses to approve before evaluation or beyond the bound proposal lifetime', () => {
    expect(() =>
      buildNodeGymRoutingApprovalReceipt({
        proposal: champion,
        approvedBy: 'human-owner',
        approvedAt: champion.evaluatedAt - 1,
        expiresAt: champion.expiresAt,
        status: 'approved',
      }),
    ).toThrow('exceeds its evaluated proposal boundary');
    expect(() =>
      buildNodeGymRoutingApprovalReceipt({
        proposal: champion,
        approvedBy: 'human-owner',
        approvedAt: now,
        expiresAt: champion.expiresAt + 1,
        status: 'approved',
      }),
    ).toThrow('exceeds its evaluated proposal boundary');
  });

  it('fails closed on stale metadata, budgets, and open circuits', () => {
    const result = selectNodeGymGovernedRoute({
      taskClass: 'chart',
      champions: [{ ...champion, evaluatedAt: now - 100_000, maxCostMicroUsd: 9_000 }],
      approvalReceipts: [],
      circuits: [{ routeKey: 'small-model::heavy-v2', state: 'open', consecutiveFailures: 3 }],
      fallback: { model: 'frontier-default', harness: 'light' },
      now,
      metadataMaxAgeMs: 60_000,
      perRouteCostCapMicroUsd: 3_000,
      mode: 'shadow',
    });
    expect(result.blockers).toEqual([
      'champion_metadata_stale',
      'route_budget_exceeded',
      'route_circuit_open',
    ]);
  });

  it('escalates typed ambiguity, evidence gaps, and repeated failures', () => {
    expect(
      nodeGymEscalationDecision({
        evidenceStatus: 'missing',
        semanticIssueCodes: ['chart_unit_missing'],
        consecutiveFailures: 2,
        ambiguityScore: 0.8,
      }),
    ).toMatchObject({
      decision: 'escalate',
      reasons: [
        'repeated_failure',
        'semantic_validation_failure',
        'typed_ambiguity',
        'unsupported_or_conflicting_evidence',
      ],
      routingMutationApplied: false,
    });
  });
});

function realSha256(value: string) {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}
