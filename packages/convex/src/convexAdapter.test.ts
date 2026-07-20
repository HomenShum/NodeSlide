import {
  NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
  type NodeSlideServerGovernanceDeclaration,
} from '@nodeslide/backend';
import {
  NODESLIDE_TEST_PRINCIPAL,
  createNodeSlideTestSnapshot,
  createNodeSlideTextPatch,
} from '@nodeslide/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_CONVEX_COMPONENT_SCHEMA_VERSION,
  planNodeSlideConvexMigrations,
  runNodeSlideConvexMigrations,
} from './component';
import {
  type NodeSlideCapabilityConvexReferences,
  type NodeSlideConvexAdapterConfig,
  type NodeSlideConvexReferences,
  createNodeSlideCapabilityConvexAdapters,
  createNodeSlideConvexAdapters,
} from './index';

const governance: NodeSlideServerGovernanceDeclaration = {
  version: NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
  enforced: {
    mutation_authority: true,
    version_cas: true,
    candidate_validation: true,
    trace_lineage: true,
    source_authorization: true,
    rollback: true,
  },
};

describe('@nodeslide/convex', () => {
  it('injects generated references and leaves principal resolution to the host session', async () => {
    const snapshot = createNodeSlideTestSnapshot('deck:convex');
    const bindPrincipal = vi.fn();
    const query = vi.fn().mockResolvedValue(snapshot);
    const mutation = vi.fn();
    const references = {
      getDeck: { _type: 'query' },
    } as unknown as NodeSlideConvexReferences;
    const adapter = {
      client: { query, mutation },
      references,
      governance,
      bindPrincipal,
    } as unknown as NodeSlideConvexAdapterConfig;
    const { repository } = createNodeSlideConvexAdapters(adapter);

    const result = await repository.getDeck({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
    });

    expect(result?.deck.id).toBe(snapshot.deck.id);
    expect(bindPrincipal).toHaveBeenCalledWith(NODESLIDE_TEST_PRINCIPAL);
    expect(query).toHaveBeenCalledWith(references.getDeck, { deckId: snapshot.deck.id });
    expect(JSON.stringify(query.mock.calls[0]?.[1])).not.toContain(NODESLIDE_TEST_PRINCIPAL.userId);
  });

  it('keeps serialized principals out of capability-host requests and returns the server receipt', async () => {
    const snapshot = createNodeSlideTestSnapshot('deck:capability');
    const patch = {
      ...createNodeSlideTextPatch(snapshot, 'Capability host'),
      traceId: 'forged-client-trace',
    };
    const ownerAccessKey = 'a'.repeat(43);
    const serverReceipt = {
      id: 'receipt:server-path',
      deckId: snapshot.deck.id,
      deckVersion: snapshot.deck.version + 1,
      operation: 'patch.applied' as const,
      principalId: 'anonymous-owner:server-derived',
      patchId: patch.id,
      recordedAt: snapshot.deck.updatedAt + 1,
      attributes: { governancePath: 'existing_nodeslide_server' },
    };
    const acceptedPatch = {
      ...patch,
      source: 'human' as const,
      status: 'accepted' as const,
      resultingDeckVersion: snapshot.deck.version + 1,
      createdAt: snapshot.deck.updatedAt + 1,
      updatedAt: snapshot.deck.updatedAt + 1,
    };
    const updatedSnapshot = {
      ...snapshot,
      deck: { ...snapshot.deck, version: snapshot.deck.version + 1 },
    };
    const mutation = vi.fn().mockResolvedValue({
      status: 'accepted',
      result: {
        patch: acceptedPatch,
        snapshot: updatedSnapshot,
        affectedSlideIds: [snapshot.slides[0]?.id],
        affectedElementIds: [snapshot.elements[0]?.id],
        receipt: serverReceipt,
      },
    });
    const references = {
      applyPatch: { _type: 'mutation' },
    } as unknown as NodeSlideCapabilityConvexReferences;
    const forgedPrincipal = {
      ...NODESLIDE_TEST_PRINCIPAL,
      userId: 'forged:administrator',
      roles: ['administrator'],
      permissions: ['*'],
    };
    const { repository } = createNodeSlideCapabilityConvexAdapters({
      client: { query: vi.fn(), mutation },
      references,
      governance,
      resolveOwnerAccessKey: () => ownerAccessKey,
    });

    const result = await repository.applyPatch({
      deckId: snapshot.deck.id,
      principal: forgedPrincipal,
      patch,
    });

    const sent = mutation.mock.calls[0]?.[1];
    expect(sent).toEqual(expect.objectContaining({ deckId: snapshot.deck.id, ownerAccessKey }));
    expect(JSON.stringify(sent)).not.toContain(forgedPrincipal.userId);
    expect(JSON.stringify(sent)).not.toContain('permissions');
    expect(JSON.stringify(sent)).not.toContain('forged-client-trace');
    expect(sent.patch).not.toHaveProperty('source');
    expect(sent.patch).not.toHaveProperty('traceId');
    expect(result.receipt).toBe(serverReceipt);
    expect(result.patch.source).toBe('human');
  });

  it('fails closed before Convex when a capability resolver returns a malformed key', async () => {
    const snapshot = createNodeSlideTestSnapshot('deck:missing-capability');
    const query = vi.fn();
    const references = {
      getDeck: { _type: 'query' },
    } as unknown as NodeSlideCapabilityConvexReferences;
    const { repository } = createNodeSlideCapabilityConvexAdapters({
      client: { query, mutation: vi.fn() },
      references,
      governance,
      resolveOwnerAccessKey: () => 'not-a-capability',
    });

    await expect(
      repository.getDeck({ deckId: snapshot.deck.id, principal: NODESLIDE_TEST_PRINCIPAL }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(query).not.toHaveBeenCalled();
  });

  it('does not expose a public path for owner-fabricated mutation receipts', async () => {
    const mutation = vi.fn();
    const references = {} as NodeSlideCapabilityConvexReferences;
    const { repository } = createNodeSlideCapabilityConvexAdapters({
      client: { query: vi.fn(), mutation },
      references,
      governance,
      resolveOwnerAccessKey: () => 'a'.repeat(43),
    });

    await expect(
      repository.storeReceipt({
        id: 'forged-receipt',
        deckId: 'deck:capability',
        deckVersion: 999,
        operation: 'proposal.accepted',
        principalId: 'anonymous-owner:forged',
        patchId: 'forged-patch',
        traceId: 'forged-trace',
        recordedAt: 1,
        attributes: {},
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(mutation).not.toHaveBeenCalled();
  });

  it('plans and receipts a contiguous, non-destructive component migration', async () => {
    expect(NODESLIDE_CONVEX_COMPONENT_SCHEMA_VERSION).toBe(1);
    expect(planNodeSlideConvexMigrations(1)).toEqual([]);
    const receipts = await runNodeSlideConvexMigrations({
      installedVersion: 0,
      apply: async (step) => ({
        id: `receipt:${step.id}`,
        stepId: step.id,
        fromVersion: step.fromVersion,
        toVersion: step.toVersion,
        appliedAt: 1,
      }),
    });
    expect(receipts.map((receipt) => receipt.stepId)).toEqual(['initialize_isolated_tables_v1']);
    expect(() => planNodeSlideConvexMigrations(2)).toThrow(/newer than supported/);
  });
});
