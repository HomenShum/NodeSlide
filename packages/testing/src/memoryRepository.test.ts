import {
  type NodeSlideRepositoryError,
  assertProductionNodeSlideRepository,
  nodeSlideApprovalModeForPatch,
} from '@nodeslide/backend';
import { describe, expect, it } from 'vitest';
import { runNodeSlideRepositoryConformance } from './conformance';
import {
  NODESLIDE_TEST_PRINCIPAL,
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
  });

  it('fails closed when two proposals race from the same base version', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({ snapshots: [snapshot] });
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
  });

  it('supports direct patches, explicit rejection, and isolated reads', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({ snapshots: [snapshot] });
    const direct = createNodeSlideTextPatch(snapshot, 'Direct', 'patch:direct');
    const applied = await repository.applyPatch({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      patch: direct,
    });
    expect(applied.snapshot.deck.version).toBe(2);
    expect(applied.receipt.operation).toBe('patch.applied');

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
  });

  it('normalizes repository errors for missing decks', async () => {
    const repository = new MemoryNodeSlideRepository();
    await expect(
      repository.listVersions({ deckId: 'missing', principal: NODESLIDE_TEST_PRINCIPAL }),
    ).rejects.toMatchObject({ code: 'not_found' } satisfies Partial<NodeSlideRepositoryError>);
  });

  it('requires fine-grained clocks for every existing object a patch touches', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({ snapshots: [snapshot] });
    const patch = createNodeSlideTextPatch(snapshot, 'Clock mismatch', 'patch:bad-clock');
    patch.baseElementVersions = {};

    await expect(
      repository.applyPatch({
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
        patch,
      }),
    ).rejects.toMatchObject({ code: 'conflict' } satisfies Partial<NodeSlideRepositoryError>);
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

  it('defaults authorization to explicit permissions and labels memory as test-only', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({ snapshots: [snapshot] });
    await expect(
      repository.getDeck({
        deckId: snapshot.deck.id,
        principal: { ...NODESLIDE_TEST_PRINCIPAL, permissions: [] },
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
