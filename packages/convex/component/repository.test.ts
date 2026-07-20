/// <reference types="vite/client" />

import type { NodeSlidePatchCommand } from '@nodeslide/backend';
import type { DeckSnapshot } from '@nodeslide/contracts';
import {
  NODESLIDE_TEST_PRINCIPAL,
  createNodeSlideTestSnapshot,
  createNodeSlideTextPatch,
} from '@nodeslide/testing';
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api.js';
import type { NodeSlideComponentGrant, NodeSlideComponentGrantAction } from './protocol.js';
import { nodeSlideComponentPatchDigest } from './protocol.js';
import schema from './schema.js';

const modules = import.meta.glob('./**/*.ts');

describe('isolated NodeSlide Convex component', () => {
  it('mounts isolated tables and runs initialize -> proposal -> accept -> reread', async () => {
    const t = convexTest(schema, modules);
    const snapshot = createNodeSlideTestSnapshot('deck:component-journey');

    await t.mutation(api.repository.initializeDeck, {
      snapshot,
      grant: grant('initialize', 'deck.initialize', snapshot.deck.id, 'deck', snapshot.deck.id),
    });
    const proposal = createNodeSlideTextPatch(snapshot, 'Isolated component accepted');
    await t.mutation(api.repository.createProposal, {
      deckId: snapshot.deck.id,
      patch: proposal,
      grant: await patchGrant('propose', 'proposal.create', snapshot.deck.id, proposal),
    });
    const resolution = (await t.mutation(api.repository.resolveProposal, {
      deckId: snapshot.deck.id,
      proposalId: proposal.id,
      decision: 'accept',
      grant: grant('accept', 'proposal.accept', snapshot.deck.id, 'proposal', proposal.id),
    })) as {
      status: string;
      receipt: { authorization: unknown };
    };
    const reread = (await t.query(api.repository.getDeck, {
      deckId: snapshot.deck.id,
      grant: grant('read', 'deck.read', snapshot.deck.id, 'deck', snapshot.deck.id),
    })) as DeckSnapshot | null;
    const versions = await t.query(api.repository.listVersions, {
      deckId: snapshot.deck.id,
      grant: grant('versions', 'versions.list', snapshot.deck.id, 'deck', snapshot.deck.id),
    });

    expect(resolution.status).toBe('accepted');
    expect(resolution.receipt.authorization).toMatchObject({
      principalId: NODESLIDE_TEST_PRINCIPAL.userId,
      action: 'proposal.accept',
      resource: { kind: 'proposal', id: proposal.id },
    });
    expect(JSON.stringify(resolution)).not.toContain('ActorProof');
    if (!reread) throw new Error('Accepted component deck was not persisted.');
    expect(reread.deck.version).toBe(snapshot.deck.version + 1);
    expect(reread.elements[0]?.content).toBe('Isolated component accepted');
    expect(versions.map((version: { version: number }) => version.version)).toEqual([
      snapshot.deck.version + 1,
      snapshot.deck.version,
    ]);
  });

  it('fails closed on replayed, mismatched, stale, and invalid candidate mutations', async () => {
    const t = convexTest(schema, modules);
    const snapshot = createNodeSlideTestSnapshot('deck:component-fail-closed');
    await t.mutation(api.repository.initializeDeck, {
      snapshot,
      grant: grant('initialize', 'deck.initialize', snapshot.deck.id, 'deck', snapshot.deck.id),
    });
    const first = createNodeSlideTextPatch(snapshot, 'First accepted', 'patch:first');
    const firstGrant = await patchGrant('first', 'patch.apply', snapshot.deck.id, first);
    await t.mutation(api.repository.applyPatch, {
      deckId: snapshot.deck.id,
      patch: first,
      grant: firstGrant,
    });
    await expect(
      t.mutation(api.repository.applyPatch, {
        deckId: snapshot.deck.id,
        patch: first,
        grant: firstGrant,
      }),
    ).rejects.toThrow(/already consumed/);

    const stale = createNodeSlideTextPatch(snapshot, 'Stale', 'patch:stale');
    await expect(
      t.mutation(api.repository.applyPatch, {
        deckId: snapshot.deck.id,
        patch: stale,
        grant: await patchGrant('stale', 'patch.apply', snapshot.deck.id, stale),
      }),
    ).rejects.toThrow(/CONFLICT/);

    const current = (await t.query(api.repository.getDeck, {
      deckId: snapshot.deck.id,
      grant: grant('read-current', 'deck.read', snapshot.deck.id, 'deck', snapshot.deck.id),
    })) as DeckSnapshot | null;
    if (!current) throw new Error('Component deck disappeared before validation test.');
    const invalid: NodeSlidePatchCommand = {
      id: 'patch:invalid',
      deckId: current.deck.id,
      baseDeckVersion: current.deck.version,
      baseSlideVersions: {},
      baseElementVersions: {},
      scope: {
        kind: 'deck',
        deckId: current.deck.id,
        operationMode: 'unrestricted',
      },
      operations: [
        {
          op: 'update_deck',
          properties: { title: '' },
        },
      ],
      source: 'agent',
      summary: 'Force an invalid deck title candidate.',
    };
    await expect(
      t.mutation(api.repository.applyPatch, {
        deckId: snapshot.deck.id,
        patch: invalid,
        grant: await patchGrant('invalid', 'patch.apply', snapshot.deck.id, invalid),
      }),
    ).rejects.toThrow(/Invalid patch/);

    const mismatchedGrant = await patchGrant(
      'mismatch',
      'proposal.create',
      snapshot.deck.id,
      invalid,
    );
    await expect(
      t.mutation(api.repository.applyPatch, {
        deckId: snapshot.deck.id,
        patch: invalid,
        grant: mismatchedGrant,
      }),
    ).rejects.toThrow(/not bound/);
  });

  it('records contiguous migrations and rejects skipped schema versions', async () => {
    const t = convexTest(schema, modules);
    const componentDeckId = 'component:nodeslide';
    const firstMigrationGrant = grant(
      'migration-v1',
      'migration.apply',
      componentDeckId,
      'migration',
      'initialize_isolated_tables_v1',
    );
    await t.mutation(api.repository.applyMigration, {
      stepId: 'initialize_isolated_tables_v1',
      fromVersion: 0,
      toVersion: 1,
      grant: firstMigrationGrant,
    });
    await expect(
      t.mutation(api.repository.applyMigration, {
        stepId: 'initialize_isolated_tables_v1',
        fromVersion: 0,
        toVersion: 1,
        grant: firstMigrationGrant,
      }),
    ).rejects.toThrow(/already consumed/);
    await expect(
      t.mutation(api.repository.applyMigration, {
        stepId: 'skip-v3',
        fromVersion: 2,
        toVersion: 3,
        grant: grant('migration-v3', 'migration.apply', componentDeckId, 'migration', 'skip-v3'),
      }),
    ).rejects.toThrow(/not an exact declared/);
    await expect(
      t.mutation(api.repository.applyMigration, {
        stepId: 'add_authorization_grant_ledger_v2',
        fromVersion: 1,
        toVersion: 99,
        grant: grant(
          'migration-forged',
          'migration.apply',
          componentDeckId,
          'migration',
          'add_authorization_grant_ledger_v2',
        ),
      }),
    ).rejects.toThrow(/not an exact declared/);
  });

  it('binds grants to canonical patch content and rejects caller-owned provenance fields', async () => {
    const t = convexTest(schema, modules);
    const snapshot = createNodeSlideTestSnapshot('deck:component-command-binding');
    await t.mutation(api.repository.initializeDeck, {
      snapshot,
      grant: grant(
        'initialize-binding',
        'deck.initialize',
        snapshot.deck.id,
        'deck',
        snapshot.deck.id,
      ),
    });
    const authorized = createNodeSlideTextPatch(snapshot, 'Authorized bytes', 'patch:bound');
    const substituted = { ...authorized, summary: 'Substituted after host authorization.' };
    await expect(
      t.mutation(api.repository.applyPatch, {
        deckId: snapshot.deck.id,
        patch: substituted,
        grant: await patchGrant('bound-content', 'patch.apply', snapshot.deck.id, authorized),
      }),
    ).rejects.toThrow(/not bound/);
    await expect(
      t.mutation(api.repository.applyPatch, {
        deckId: snapshot.deck.id,
        patch: { ...authorized, source: 'forged', status: 'accepted' },
        grant: await patchGrant('forged-fields', 'patch.apply', snapshot.deck.id, authorized),
      }),
    ).rejects.toThrow(/unsupported field|source is invalid/);
  });

  it('hashes asset bytes and rejects unsafe metadata before consuming the grant', async () => {
    const t = convexTest(schema, modules);
    const snapshot = createNodeSlideTestSnapshot('deck:component-assets');
    await t.mutation(api.repository.initializeDeck, {
      snapshot,
      grant: grant(
        'initialize-assets',
        'deck.initialize',
        snapshot.deck.id,
        'deck',
        snapshot.deck.id,
      ),
    });
    const bytes = new TextEncoder().encode('verified component asset').buffer;
    const digest = await sha256(bytes);
    const assetGrant = grant('asset', 'asset.put', snapshot.deck.id, 'asset', 'asset:verified');
    await expect(
      t.mutation(api.repository.putAsset, {
        deckId: snapshot.deck.id,
        assetId: 'asset:verified',
        kind: 'image',
        fileName: 'verified.png',
        contentType: 'image/png',
        contentDigest: `sha256:${'0'.repeat(64)}`,
        bytes,
        metadata: {},
        grant: assetGrant,
      }),
    ).rejects.toThrow(/does not match/);
    await t.mutation(api.repository.putAsset, {
      deckId: snapshot.deck.id,
      assetId: 'asset:verified',
      kind: 'image',
      fileName: 'verified.png',
      contentType: 'image/png',
      contentDigest: digest,
      bytes,
      metadata: { source: 'fixture' },
      grant: assetGrant,
    });
    await expect(
      t.mutation(api.repository.putAsset, {
        deckId: snapshot.deck.id,
        assetId: 'asset:unsafe',
        kind: 'image',
        fileName: 'unsafe.png',
        contentType: 'image/png',
        contentDigest: digest,
        bytes,
        metadata: { unsupported: 1n },
        grant: grant('asset-unsafe', 'asset.put', snapshot.deck.id, 'asset', 'asset:unsafe'),
      }),
    ).rejects.toThrow(/JSON data/);
  });
});

function grant(
  id: string,
  action: NodeSlideComponentGrantAction,
  deckId: string,
  resourceKind: NodeSlideComponentGrant['resource']['kind'],
  resourceId: string,
  requestDigest?: string,
): NodeSlideComponentGrant {
  return {
    schemaVersion: 'nodeslide.component-grant/v1',
    id: `grant:${id}`,
    principalId: NODESLIDE_TEST_PRINCIPAL.userId,
    ...(NODESLIDE_TEST_PRINCIPAL.organizationId === undefined
      ? {}
      : { organizationId: NODESLIDE_TEST_PRINCIPAL.organizationId }),
    deckId,
    action,
    resource: { kind: resourceKind, id: resourceId },
    ...(requestDigest === undefined ? {} : { requestDigest }),
    authorizedAt: 1_700_000_000_000 + id.length,
    evidence: {
      issuer: 'nodeslide.component.test',
      policyId: 'component-test-policy',
      policyVersion: '1',
      evidenceId: `evidence:${id}`,
    },
  };
}

async function patchGrant(
  id: string,
  action: 'patch.apply' | 'proposal.create',
  deckId: string,
  patch: Parameters<typeof nodeSlideComponentPatchDigest>[0],
): Promise<NodeSlideComponentGrant> {
  return grant(id, action, deckId, 'patch', patch.id, await nodeSlideComponentPatchDigest(patch));
}

async function sha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')}`;
}
