/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import type { MutationCtx } from './_generated/server';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import { nodeSlideProductionProbeFields } from './lib/nodeslideProductionProbe';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import {
  deleteExpiredProductionProbeWorkspaces,
  deleteOwnedWorkspace,
  deleteProductionProbeWorkspace,
  nodeSlideRetentionBindings,
} from './nodeslideRetention';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const OWNER_ACCESS_KEY = 'a'.repeat(43);
const OTHER_OWNER_ACCESS_KEY = 'b'.repeat(43);
const NOW = 1_800_000_000_000;

type DeleteHandler = (
  ctx: MutationCtx,
  args: { deckId: string; ownerAccessKey: string; cleanupTicket?: string },
) => Promise<{
  schemaVersion: string;
  status: string;
  retentionSafe: boolean;
  remainingDeckRows: number;
  remainingSourceRows: number;
  deletedRowCount: number;
  deletedCounts: Record<string, number>;
  alreadyAbsent: boolean;
  targetBindingDigest: string;
  principalBindingDigest: string;
  cleanupTicket: string;
  receiptDigest: string;
}>;

const deleteHandler = (deleteOwnedWorkspace as unknown as { _handler: DeleteHandler })._handler;
const deleteProbeHandler = (
  deleteProductionProbeWorkspace as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: { clientSessionId: string; cleanupToken: string },
    ) => Promise<{ retentionSafe: boolean; alreadyAbsent: boolean; deletedRowCount: number }>;
  }
)._handler;
const sweepProbeHandler = (
  deleteExpiredProductionProbeWorkspaces as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: Record<string, never>,
    ) => Promise<{ deletedWorkspaceCount: number; deletedRowCount: number }>;
  }
)._handler;

describe('NodeSlide owner-controlled workspace retention', () => {
  it('denies another capability, deletes content-bearing rows transactionally, and is idempotent', async () => {
    const t = convexTest(schema, modules);
    const built = buildGoldenNodeSlide('retention-fixture', NOW);
    const deckId = built.snapshot.deck.id;
    const projectRowId = await t.run(async (ctx) => {
      const projectId = await ctx.db.insert('projects', {
        clientSessionId: 'retention-fixture',
        title: built.snapshot.deck.title,
        domain: 'nodeslide',
        brief: built.snapshot.deck.brief,
        sourceType: 'prompt',
        starred: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await insertNodeSlideSnapshot(ctx as MutationCtx, {
        snapshot: built.snapshot,
        projectRowId: projectId,
        clientSessionId: 'retention-fixture',
        ownerAccessKey: OWNER_ACCESS_KEY,
        plan: built.plan,
        spec: built.spec,
      });
      await ctx.db.insert('nodeslide_versions', {
        id: 'retention-version',
        deckId,
        version: built.snapshot.deck.version,
        label: 'Retention fixture snapshot',
        source: 'system',
        snapshot: built.snapshot,
        createdAt: NOW,
      });
      await ctx.db.insert('nodeslide_traces', {
        id: 'retention-trace',
        deckId,
        status: 'completed',
        summary: 'Protected UI fixture trace',
        plan: [],
        context: ['Protected fixture content'],
        toolCalls: [],
        guardrails: [],
        createdAt: NOW,
        completedAt: NOW,
      });
      return projectId;
    });

    const wrongExistingMessage = await rejectionMessage(() =>
      t.run((ctx) =>
        deleteHandler(ctx as MutationCtx, {
          deckId,
          ownerAccessKey: OTHER_OWNER_ACCESS_KEY,
        }),
      ),
    );
    expect(wrongExistingMessage).toMatch(/owner access denied/i);

    const receipt = await t.run((ctx) =>
      deleteHandler(ctx as MutationCtx, { deckId, ownerAccessKey: OWNER_ACCESS_KEY }),
    );
    expect(receipt).toMatchObject({
      schemaVersion: 'nodeslide.workspace-retention-receipt/v1',
      status: 'passed',
      retentionSafe: true,
      remainingDeckRows: 0,
      remainingSourceRows: 0,
      alreadyAbsent: false,
      deletedCounts: {
        deck: 1,
        project: 1,
        versions: 1,
        traces: 1,
      },
    });
    expect(receipt.deletedCounts.sources).toBeGreaterThan(0);
    expect(receipt).toMatchObject(nodeSlideRetentionBindings(deckId, OWNER_ACCESS_KEY));
    expect(receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(JSON.stringify(receipt)).not.toContain(deckId);
    expect(JSON.stringify(receipt)).not.toContain(OWNER_ACCESS_KEY);

    const retained = await t.run(async (ctx) => ({
      deck: await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', deckId))
        .first(),
      sources: await ctx.db
        .query('nodeslide_sources')
        .withIndex('by_deck', (index) => index.eq('deckId', deckId))
        .collect(),
      versions: await ctx.db
        .query('nodeslide_versions')
        .withIndex('by_deck_version', (index) => index.eq('deckId', deckId))
        .collect(),
      traces: await ctx.db
        .query('nodeslide_traces')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
        .collect(),
      project: await ctx.db.get(projectRowId),
    }));
    expect(retained).toEqual({ deck: null, sources: [], versions: [], traces: [], project: null });

    const wrongAbsentMessage = await rejectionMessage(() =>
      t.run((ctx) =>
        deleteHandler(ctx as MutationCtx, {
          deckId,
          ownerAccessKey: OTHER_OWNER_ACCESS_KEY,
          cleanupTicket: nodeSlideRetentionBindings(deckId, OTHER_OWNER_ACCESS_KEY).cleanupTicket,
        }),
      ),
    );
    expect(wrongAbsentMessage).toBe(wrongExistingMessage);
    await expect(
      t.run((ctx) =>
        deleteHandler(ctx as MutationCtx, { deckId, ownerAccessKey: OWNER_ACCESS_KEY }),
      ),
    ).rejects.toThrow(/owner access denied/i);
    await expect(
      t.run((ctx) =>
        deleteHandler(ctx as MutationCtx, {
          deckId,
          ownerAccessKey: OWNER_ACCESS_KEY,
          cleanupTicket: receipt.cleanupTicket,
        }),
      ),
    ).resolves.toMatchObject({
      status: 'passed',
      retentionSafe: true,
      alreadyAbsent: true,
      deletedRowCount: 0,
      targetBindingDigest: receipt.targetBindingDigest,
      principalBindingDigest: receipt.principalBindingDigest,
      cleanupTicket: receipt.cleanupTicket,
    });
  });

  it('refuses to certify an absent target with project/profile orphans or a forged ticket', async () => {
    const t = convexTest(schema, modules);
    const deckId = 'deck_absent_with_orphans';
    const tenantId = 'project_absent_with_orphans';
    await t.run(async (ctx) => {
      await ctx.db.insert('projects', {
        clientSessionId: 'absent-with-orphans',
        title: 'Orphaned project',
        domain: 'nodeslide',
        sourceType: 'prompt',
        starred: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert('nodeslide_signature_profiles', {
        id: 'orphan-signature-profile',
        tenantId,
        profileId: 'profile-orphan',
        sourceDigest: `sha256:${'c'.repeat(64)}`,
        sourceKind: 'pptx',
        name: 'Orphan profile',
        confidence: 'low',
        warningCount: 0,
        profileJson: '{}',
        createdAt: NOW,
        updatedAt: NOW,
      });
      await ctx.db.insert('nodeslide_taste_profiles', {
        schemaVersion: 'nodeslide.preference/v1',
        id: 'orphan-taste-profile',
        tenantId,
        actorId: 'orphan-actor',
        signals: [],
        updatedAt: NOW,
      });
    });
    const bindings = nodeSlideRetentionBindings(deckId, OWNER_ACCESS_KEY);

    await expect(
      t.run((ctx) =>
        deleteHandler(ctx as MutationCtx, {
          deckId,
          ownerAccessKey: OWNER_ACCESS_KEY,
          cleanupTicket: bindings.cleanupTicket,
        }),
      ),
    ).rejects.toThrow(/owner access denied/i);
    await expect(
      t.run((ctx) =>
        deleteHandler(ctx as MutationCtx, {
          deckId,
          ownerAccessKey: OWNER_ACCESS_KEY,
          cleanupTicket: `sha256:${'0'.repeat(64)}`,
        }),
      ),
    ).rejects.toThrow(/owner access denied/i);

    const orphans = await t.run(async (ctx) => ({
      projects: await ctx.db.query('projects').collect(),
      signatures: await ctx.db.query('nodeslide_signature_profiles').collect(),
      tastes: await ctx.db.query('nodeslide_taste_profiles').collect(),
      tombstones: await ctx.db.query('nodeslide_retention_tombstones').collect(),
    }));
    expect(orphans.projects).toHaveLength(1);
    expect(orphans.signatures).toHaveLength(1);
    expect(orphans.tastes).toHaveLength(1);
    expect(orphans.tombstones).toHaveLength(0);
  });

  it('deletes a tagged probe using the client-known lease even when no deck id or owner key returned', async () => {
    const t = convexTest(schema, modules);
    const built = buildGoldenNodeSlide('probe-response-lost', NOW);
    const cleanupToken = `probe_${'c'.repeat(43)}`;
    const probeFields = nodeSlideProductionProbeFields(cleanupToken, NOW);
    await t.run(async (ctx) => {
      const projectRowId = await ctx.db.insert('projects', {
        clientSessionId: 'probe-session',
        title: built.snapshot.deck.title,
        domain: 'nodeslide',
        brief: built.snapshot.deck.brief,
        sourceType: 'prompt',
        starred: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await insertNodeSlideSnapshot(ctx as MutationCtx, {
        snapshot: built.snapshot,
        projectRowId,
        clientSessionId: 'probe-session',
        ownerAccessKey: OWNER_ACCESS_KEY,
        plan: built.plan,
        spec: built.spec,
        ...probeFields,
      });
    });

    await expect(
      t.run((ctx) =>
        deleteProbeHandler(ctx as MutationCtx, {
          clientSessionId: 'different-session',
          cleanupToken,
        }),
      ),
    ).rejects.toThrow(/cleanup denied/i);
    const receipt = await t.run((ctx) =>
      deleteProbeHandler(ctx as MutationCtx, {
        clientSessionId: 'probe-session',
        cleanupToken,
      }),
    );
    expect(receipt).toMatchObject({ retentionSafe: true, alreadyAbsent: false });
    expect(receipt.deletedRowCount).toBeGreaterThan(2);
    await expect(
      t.run((ctx) =>
        deleteProbeHandler(ctx as MutationCtx, {
          clientSessionId: 'probe-session',
          cleanupToken,
        }),
      ),
    ).resolves.toMatchObject({ retentionSafe: true, alreadyAbsent: true, deletedRowCount: 0 });
  });

  it('sweeps a bounded expired probe after a runner crash', async () => {
    const t = convexTest(schema, modules);
    const built = buildGoldenNodeSlide('probe-expired', NOW);
    await t.run(async (ctx) => {
      const projectRowId = await ctx.db.insert('projects', {
        clientSessionId: 'expired-probe-session',
        title: built.snapshot.deck.title,
        domain: 'nodeslide',
        brief: built.snapshot.deck.brief,
        sourceType: 'prompt',
        starred: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await insertNodeSlideSnapshot(ctx as MutationCtx, {
        snapshot: built.snapshot,
        projectRowId,
        clientSessionId: 'expired-probe-session',
        ownerAccessKey: OWNER_ACCESS_KEY,
        plan: built.plan,
        spec: built.spec,
        productionProbeCleanupDigest: `sha256:${'d'.repeat(64)}`,
        productionProbeExpiresAt: 1,
      });
    });
    await expect(t.run((ctx) => sweepProbeHandler(ctx as MutationCtx, {}))).resolves.toMatchObject({
      deletedWorkspaceCount: 1,
    });
    expect(await t.run((ctx) => ctx.db.query('nodeslide_decks').collect())).toEqual([]);
  });

  it('rolls an expiry sweep back when the project scope is not exactly one workspace', async () => {
    const t = convexTest(schema, modules);
    const expired = buildGoldenNodeSlide('probe-expired-ambiguous', NOW);
    const sibling = buildGoldenNodeSlide('probe-sibling', NOW + 1);
    await t.run(async (ctx) => {
      const projectRowId = await ctx.db.insert('projects', {
        clientSessionId: 'ambiguous-probe-session',
        title: expired.snapshot.deck.title,
        domain: 'nodeslide',
        brief: expired.snapshot.deck.brief,
        sourceType: 'prompt',
        starred: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await insertNodeSlideSnapshot(ctx as MutationCtx, {
        snapshot: expired.snapshot,
        projectRowId,
        clientSessionId: 'ambiguous-probe-session',
        ownerAccessKey: OWNER_ACCESS_KEY,
        plan: expired.plan,
        spec: expired.spec,
        productionProbeCleanupDigest: `sha256:${'e'.repeat(64)}`,
        productionProbeExpiresAt: 1,
      });
      await insertNodeSlideSnapshot(ctx as MutationCtx, {
        snapshot: sibling.snapshot,
        projectRowId,
        clientSessionId: 'ambiguous-probe-session',
        ownerAccessKey: OTHER_OWNER_ACCESS_KEY,
        plan: sibling.plan,
        spec: sibling.spec,
      });
    });

    await expect(t.run((ctx) => sweepProbeHandler(ctx as MutationCtx, {}))).rejects.toThrow(
      /scope is not one workspace/i,
    );
    expect(await t.run((ctx) => ctx.db.query('nodeslide_decks').collect())).toHaveLength(2);
  });
});

async function rejectionMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected retention request to fail.');
}
