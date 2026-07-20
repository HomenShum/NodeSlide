import {
  type NodeSlideAuthorize,
  type NodeSlideRepositoryAuthorizationRequest,
  type NodeSlideRepositoryError,
  assertProductionNodeSlideRepository,
  explicitPermissionAuthorization,
  nodeSlideApprovalModeForPatch,
} from '@nodeslide/backend';
import { describe, expect, it } from 'vitest';
import { runNodeSlideRepositoryConformance } from './conformance';
import {
  NODESLIDE_TEST_PRINCIPAL,
  authorizeNodeSlideTestPrincipal,
  createNodeSlideTestSnapshot,
  createNodeSlideTextPatch,
} from './fixtures';
import { MemoryNodeSlideAssetStore } from './memoryAssetStore';
import { MemoryNodeSlideRepository } from './memoryRepository';
import { MemoryNodeSlideTelemetryAdapter } from './memoryTelemetry';

describe('injectable NodeSlide testkit', () => {
  it('keeps proposals unapplied until the governed acceptance path', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    let now = snapshot.deck.updatedAt + 1;
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      now: () => now++,
      authorize: authorizeNodeSlideTestPrincipal,
    });
    const result = await runNodeSlideRepositoryConformance({
      repository,
      principal: NODESLIDE_TEST_PRINCIPAL,
      initialSnapshot: snapshot,
      proposal: createNodeSlideTextPatch(snapshot, 'After'),
    });

    expect(result.proposalVersion).toBe(1);
    expect(result.acceptedVersion).toBe(2);
    expect(result.versionCount).toBe(2);
    expect(result.resolution.snapshot.elements[0]?.content).toBe('After');
    expect(result.resolution.receipt.operation).toBe('proposal.accepted');
    expect(
      repository
        .receiptsForDeck(snapshot.deck.id)
        .find((receipt) => receipt.operation === 'proposal.created')?.authorization.resource,
    ).toEqual({ kind: 'proposal', id: result.resolution.patch.id });
  });

  it('fails closed when two proposals race from the same base version', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      authorize: authorizeNodeSlideTestPrincipal,
    });
    const first = createNodeSlideTextPatch(snapshot, 'First winner', 'patch:first');
    const second = createNodeSlideTextPatch(snapshot, 'Stale loser', 'patch:second');
    await repository.createProposal({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      patch: first,
    });
    await repository.createProposal({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      patch: second,
    });

    const accepted = await repository.resolveProposal({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      proposalId: first.id,
      decision: 'accept',
    });
    const stale = await repository.resolveProposal({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      proposalId: second.id,
      decision: 'accept',
    });

    expect(accepted.status).toBe('accepted');
    expect(stale.status).toBe('stale');
    expect(stale.snapshot.elements[0]?.content).toBe('First winner');
    expect(stale.receipt.operation).toBe('proposal.stale');
    expect(stale.receipt.authorization).toMatchObject({
      action: 'proposal.accept',
      resource: { kind: 'proposal', id: second.id },
    });
    const receiptsBeforeOppositeDecision = repository.receiptsForDeck(snapshot.deck.id);
    await expect(
      repository.resolveProposal({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        proposalId: second.id,
        decision: 'reject',
      }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    } satisfies Partial<NodeSlideRepositoryError>);
    expect(repository.receiptsForDeck(snapshot.deck.id)).toEqual(receiptsBeforeOppositeDecision);
  });

  it('supports direct patches, explicit rejection, and isolated reads', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      authorize: authorizeNodeSlideTestPrincipal,
    });
    const direct = createNodeSlideTextPatch(snapshot, 'Direct', 'patch:direct');
    const applied = await repository.applyPatch({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      patch: direct,
    });
    expect(applied.snapshot.deck.version).toBe(2);
    expect(applied.receipt.operation).toBe('patch.applied');
    expect(applied.receipt.authorization).toMatchObject({
      action: 'patch.apply',
      resource: { kind: 'patch', id: direct.id },
    });

    const returned = await repository.getDeck({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
    });
    if (!returned) throw new Error('Expected the direct patch result.');
    returned.deck.title = 'Caller mutation';
    const reread = await repository.getDeck({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
    });
    if (!reread) throw new Error('Expected the isolated deck reread.');
    expect(reread?.deck.title).toBe(snapshot.deck.title);

    const rejectionPatch = createNodeSlideTextPatch(reread, 'Never applied', 'patch:reject');
    await repository.createProposal({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      patch: rejectionPatch,
    });
    const rejected = await repository.resolveProposal({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      proposalId: rejectionPatch.id,
      decision: 'reject',
    });
    expect(rejected.status).toBe('rejected');
    expect(rejected.snapshot.elements[0]?.content).toBe('Direct');
    expect(rejected.receipt.authorization).toMatchObject({
      action: 'proposal.reject',
      resource: { kind: 'proposal', id: rejectionPatch.id },
    });
  });

  it('normalizes repository errors for missing decks', async () => {
    const repository = new MemoryNodeSlideRepository({
      authorize: authorizeNodeSlideTestPrincipal,
    });
    await expect(
      repository.listVersions({
        deckId: 'missing',
        principal: NODESLIDE_TEST_PRINCIPAL,
      }),
    ).rejects.toMatchObject({
      code: 'not_found',
    } satisfies Partial<NodeSlideRepositoryError>);
  });

  it('requires fine-grained clocks for every existing object a patch touches', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      authorize: authorizeNodeSlideTestPrincipal,
    });
    const patch = createNodeSlideTextPatch(snapshot, 'Clock mismatch', 'patch:bad-clock');
    patch.baseElementVersions = {};

    await expect(
      repository.applyPatch({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        patch,
      }),
    ).rejects.toMatchObject({
      code: 'conflict',
    } satisfies Partial<NodeSlideRepositoryError>);
  });

  it('requires a host authorizer and validates principals before calling it', async () => {
    expect(() => new MemoryNodeSlideRepository({} as { authorize: NodeSlideAuthorize })).toThrow(
      'requires a host authorizer',
    );

    let authorizationCalls = 0;
    const repository = new MemoryNodeSlideRepository({
      snapshots: [createNodeSlideTestSnapshot()],
      authorize: (request) => {
        authorizationCalls += 1;
        return authorizeNodeSlideTestPrincipal(request);
      },
    });
    await expect(
      repository.getDeck({
        deckId: 'deck:test',
        principal: {
          ...NODESLIDE_TEST_PRINCIPAL,
          hostAuthVerified: true,
        } as typeof NODESLIDE_TEST_PRINCIPAL,
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    } satisfies Partial<NodeSlideRepositoryError>);
    expect(authorizationCalls).toBe(0);
  });

  it('denies before mutation and binds acceptance to the exact frozen host request', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const requests: NodeSlideRepositoryAuthorizationRequest[] = [];
    let denyAcceptance = true;
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      authorize: (request) => {
        expect(Object.isFrozen(request)).toBe(true);
        expect(Object.isFrozen(request.principal)).toBe(true);
        if (request.action === 'proposal.create' || request.action === 'patch.apply') {
          expect(Object.isFrozen(request.patch)).toBe(true);
        }
        requests.push(structuredClone(request));
        if (request.action === 'proposal.accept' && denyAcceptance) {
          throw new Error('host policy denied');
        }
        return authorizeNodeSlideTestPrincipal(request);
      },
    });
    const patch = createNodeSlideTextPatch(snapshot, 'Authorized', 'proposal:authorized');
    await repository.createProposal({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      patch,
    });
    const receiptsBeforeDenial = repository.receiptsForDeck(snapshot.deck.id);

    await expect(
      repository.resolveProposal({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        proposalId: patch.id,
        decision: 'accept',
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
    } satisfies Partial<NodeSlideRepositoryError>);
    expect(repository.receiptsForDeck(snapshot.deck.id)).toEqual(receiptsBeforeDenial);

    denyAcceptance = false;
    const accepted = await repository.resolveProposal({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      proposalId: patch.id,
      decision: 'accept',
    });
    expect(accepted.receipt.authorization).toMatchObject({
      principalId: NODESLIDE_TEST_PRINCIPAL.userId,
      deckId: snapshot.deck.id,
      action: 'proposal.accept',
      resource: { kind: 'proposal', id: patch.id },
      evidence: {
        issuer: '@nodeslide/testing',
        policyId: 'testing.permission-map',
        policyVersion: '1',
      },
    });
    expect(requests).toContainEqual({
      action: 'proposal.accept',
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      proposalId: patch.id,
    });

    const replay = await repository.resolveProposal({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      proposalId: patch.id,
      decision: 'accept',
    });
    expect(replay.receipt.id).toBe(accepted.receipt.id);
    expect(replay.receipt.authorization.id).toBe(accepted.receipt.authorization.id);
    await repository.getDeck({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
    });
    await repository.listVersions({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
    });
    expect(requests.map((request) => request.action)).toEqual(
      expect.arrayContaining(['deck.read', 'versions.list']),
    );
  });

  it('derives custom receipt identity and authorization instead of accepting caller claims', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      authorize: authorizeNodeSlideTestPrincipal,
    });
    const draft = {
      id: 'custom-receipt:consumer-audit:1' as const,
      deckId: snapshot.deck.id,
      deckVersion: snapshot.deck.version,
      operation: 'custom' as const,
      recordedAt: snapshot.deck.updatedAt,
      attributes: { purpose: 'consumer-audit' },
    };

    await expect(
      repository.storeReceipt({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        receipt: {
          ...draft,
          principalId: 'user:forged',
          authorization: { id: 'authorization:forged' },
        } as typeof draft,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    } satisfies Partial<NodeSlideRepositoryError>);
    expect(repository.receiptsForDeck(snapshot.deck.id)).toHaveLength(0);

    const accessorDraft = { ...draft } as Record<string, unknown>;
    Object.defineProperty(accessorDraft, 'operation', {
      enumerable: true,
      get: () => 'custom',
    });
    await expect(
      repository.storeReceipt({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        receipt: accessorDraft as never,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    } satisfies Partial<NodeSlideRepositoryError>);
    expect(repository.receiptsForDeck(snapshot.deck.id)).toHaveLength(0);

    await expect(
      repository.storeReceipt({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        receipt: {
          ...draft,
          attributes: { createdAt: new Date() },
        } as unknown as typeof draft,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    } satisfies Partial<NodeSlideRepositoryError>);

    await expect(
      repository.storeReceipt({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        receipt: {
          ...draft,
          operation: 'proposal.accepted',
        } as unknown as typeof draft,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    } satisfies Partial<NodeSlideRepositoryError>);

    const stored = await repository.storeReceipt({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      receipt: draft,
    });
    expect(stored.principalId).toBe(NODESLIDE_TEST_PRINCIPAL.userId);
    expect(stored.authorization).toMatchObject({
      action: 'receipt.store',
      resource: { kind: 'receipt', id: draft.id },
      evidence: { policyId: 'testing.permission-map' },
    });
    const replay = await repository.storeReceipt({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      receipt: draft,
    });
    expect(replay).toEqual(stored);

    await expect(
      repository.storeReceipt({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        receipt: { ...draft, attributes: { purpose: 'different' } },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    } satisfies Partial<NodeSlideRepositoryError>);
  });

  it('snapshots store-receipt outer fields once without invoking accessors or proxy gets', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      authorize: authorizeNodeSlideTestPrincipal,
    });
    const draft = {
      id: 'custom-receipt:outer-snapshot' as const,
      deckId: snapshot.deck.id,
      deckVersion: snapshot.deck.version,
      operation: 'custom' as const,
      recordedAt: snapshot.deck.updatedAt,
      attributes: {},
    };

    let accessorCalls = 0;
    const accessorInput = {
      principal: NODESLIDE_TEST_PRINCIPAL,
      receipt: draft,
    } as Record<string, unknown>;
    Object.defineProperty(accessorInput, 'deckId', {
      enumerable: true,
      get: () => {
        accessorCalls += 1;
        return snapshot.deck.id;
      },
    });
    await expect(repository.storeReceipt(accessorInput as never)).rejects.toMatchObject({
      code: 'invalid_state',
    } satisfies Partial<NodeSlideRepositoryError>);
    expect(accessorCalls).toBe(0);

    let deckDescriptorReads = 0;
    let propertyReads = 0;
    const proxyInput = new Proxy(
      {
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        receipt: draft,
      },
      {
        getOwnPropertyDescriptor(target, property) {
          if (property === 'deckId') deckDescriptorReads += 1;
          return Reflect.getOwnPropertyDescriptor(target, property);
        },
        get() {
          propertyReads += 1;
          throw new Error('Store-receipt input must not be read through property access.');
        },
      },
    );
    const stored = await repository.storeReceipt(proxyInput);
    expect(stored.deckId).toBe(snapshot.deck.id);
    expect(deckDescriptorReads).toBe(1);
    expect(propertyReads).toBe(0);
  });

  it('reserves mutation receipt IDs and rejects conflicting direct-patch replay', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      authorize: authorizeNodeSlideTestPrincipal,
    });
    const patch = createNodeSlideTextPatch(snapshot, 'First command', 'patch:collision');
    await expect(
      repository.storeReceipt({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        receipt: {
          id: `receipt:${patch.id}:1`,
          deckId: snapshot.deck.id,
          deckVersion: snapshot.deck.version,
          operation: 'custom',
          recordedAt: snapshot.deck.updatedAt,
          attributes: {},
        } as never,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    } satisfies Partial<NodeSlideRepositoryError>);

    const applied = await repository.applyPatch({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      patch,
    });
    expect(applied.snapshot.deck.version).toBe(2);
    expect(repository.receiptsForDeck(snapshot.deck.id)).toEqual([applied.receipt]);

    const conflictingReplay = {
      ...patch,
      summary: 'Different command under the same ID',
    };
    await expect(
      repository.applyPatch({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        patch: conflictingReplay,
      }),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    } satisfies Partial<NodeSlideRepositoryError>);
  });

  it('rejects malformed proposal decisions before host authorization or state changes', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    let authorizationCalls = 0;
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      authorize: (request) => {
        authorizationCalls += 1;
        return authorizeNodeSlideTestPrincipal(request);
      },
    });
    const patch = createNodeSlideTextPatch(snapshot, 'Pending', 'proposal:decision');
    await repository.createProposal({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      patch,
    });
    const callsBeforeDecision = authorizationCalls;
    const receiptsBeforeDecision = repository.receiptsForDeck(snapshot.deck.id);

    await expect(
      repository.resolveProposal({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        proposalId: patch.id,
        decision: 'approve-typo',
      } as never),
    ).rejects.toMatchObject({
      code: 'invalid_state',
    } satisfies Partial<NodeSlideRepositoryError>);
    expect(authorizationCalls).toBe(callsBeforeDecision);
    expect(repository.receiptsForDeck(snapshot.deck.id)).toEqual(receiptsBeforeDecision);
  });

  it('provides host-neutral asset and telemetry fakes', async () => {
    const assets = new MemoryNodeSlideAssetStore({ now: () => 123 });
    const stored = await assets.put({
      deckId: 'deck:test',
      principal: NODESLIDE_TEST_PRINCIPAL,
      kind: 'image',
      fileName: 'proof.png',
      contentType: 'image/png',
      contentDigest: 'sha256:test',
      bytes: new Uint8Array([1, 2, 3]),
      metadata: { source: 'fixture' },
    });
    const read = await assets.get({
      deckId: 'deck:test',
      principal: NODESLIDE_TEST_PRINCIPAL,
      assetId: stored.id,
    });
    expect(read?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(read?.reference.createdAt).toBe(123);

    const telemetry = new MemoryNodeSlideTelemetryAdapter();
    await telemetry.record({
      name: 'proposal.accepted',
      timestamp: 123,
      severity: 'info',
      deckId: 'deck:test',
      attributes: { version: 2 },
    });
    expect(telemetry.records()).toHaveLength(1);
  });

  it('default-denies explicit permissions and labels memory as test-only', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const principalWithoutPermissions = {
      ...NODESLIDE_TEST_PRINCIPAL,
      permissions: [],
    };
    await expect(
      explicitPermissionAuthorization.authorize({
        action: 'deck.read',
        deckId: snapshot.deck.id,
        principal: principalWithoutPermissions,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      authorize: authorizeNodeSlideTestPrincipal,
    });
    await expect(
      repository.getDeck({
        deckId: snapshot.deck.id,
        principal: principalWithoutPermissions,
      }),
    ).rejects.toMatchObject({ code: 'forbidden' });
    expect(() => assertProductionNodeSlideRepository(repository)).toThrow(
      /not production-governed/,
    );
  });

  it('fails closed to proposal review for unspecified governance modes', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const patch = createNodeSlideTextPatch(snapshot, 'Policy');
    expect(nodeSlideApprovalModeForPatch({ byOperationMode: {} }, patch)).toBe('proposal_required');
    expect(nodeSlideApprovalModeForPatch({ byOperationMode: { copy: 'auto_commit' } }, patch)).toBe(
      'auto_commit',
    );
  });
});
