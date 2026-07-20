import {
  NODESLIDE_GOVERNANCE_CONTRACT_VERSION,
  type NodeSlideServerGovernanceDeclaration,
  assertProductionNodeSlideRepository,
} from '@nodeslide/backend';
import {
  NODESLIDE_TEST_PRINCIPAL,
  createNodeSlideTestSnapshot,
  createNodeSlideTextPatch,
} from '@nodeslide/testing';
import { describe, expect, it, vi } from 'vitest';
import { createNodeSlideHttpAdapters } from './index';

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

describe('@nodeslide/client-http', () => {
  it('uses host credentials without serializing the principal into mutation bodies', async () => {
    const snapshot = createNodeSlideTestSnapshot('deck/http');
    const patch = createNodeSlideTextPatch(snapshot, 'HTTP');
    const fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        patch: { ...patch, status: 'accepted', createdAt: 1, updatedAt: 1 },
        snapshot: { ...snapshot, deck: { ...snapshot.deck, version: 2 } },
        affectedSlideIds: snapshot.deck.slideOrder,
        affectedElementIds: snapshot.elements.map((element) => element.id),
        receipt: {
          id: 'receipt:http',
          deckId: snapshot.deck.id,
          deckVersion: 2,
          operation: 'patch.applied',
          principalId: NODESLIDE_TEST_PRINCIPAL.userId,
          recordedAt: 1,
          attributes: {},
        },
      }),
    );
    const { repository } = createNodeSlideHttpAdapters({
      baseUrl: 'https://api.example.test/root/',
      governance,
      headersForPrincipal: () => ({ authorization: 'Bearer host-session' }),
      fetch,
    });

    await repository.applyPatch({
      deckId: snapshot.deck.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
      patch,
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe('https://api.example.test/root/v1/decks/deck%2Fhttp/patches:apply');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer host-session');
    expect(String(init?.body)).not.toContain(NODESLIDE_TEST_PRINCIPAL.userId);
    expect(() => assertProductionNodeSlideRepository(repository)).not.toThrow();
  });

  it('round-trips binary assets and normalizes server conflicts', async () => {
    const reference = {
      id: 'asset:1',
      deckId: 'deck:test',
      kind: 'image' as const,
      fileName: 'proof.png',
      contentType: 'image/png',
      byteSize: 3,
      contentDigest: 'sha256:proof',
      createdAt: 1,
      metadata: {},
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json({ reference, bytesBase64: 'AQID' }))
      .mockResolvedValueOnce(
        Response.json({ error: { code: 'conflict', message: 'Stale version.' } }, { status: 409 }),
      );
    const { assets, repository } = createNodeSlideHttpAdapters({
      baseUrl: 'https://api.example.test',
      governance,
      headersForPrincipal: () => ({}),
      fetch,
    });

    const stored = await assets.get({
      deckId: reference.deckId,
      assetId: reference.id,
      principal: NODESLIDE_TEST_PRINCIPAL,
    });
    expect(stored?.bytes).toEqual(new Uint8Array([1, 2, 3]));
    await expect(
      repository.getDeck({ deckId: reference.deckId, principal: NODESLIDE_TEST_PRINCIPAL }),
    ).rejects.toMatchObject({ code: 'conflict', message: 'Stale version.' });
  });

  it('refuses privileged writes when no system credential source is configured', async () => {
    const { telemetry } = createNodeSlideHttpAdapters({
      baseUrl: 'https://api.example.test',
      governance,
      headersForPrincipal: () => ({}),
      fetch: vi.fn(),
    });
    await expect(
      telemetry.record({ name: 'proof', timestamp: 1, severity: 'info', attributes: {} }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });
});
