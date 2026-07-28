/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import type { MutationCtx } from './_generated/server';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import { nodeSlideProductionProbeFields } from './lib/nodeslideProductionProbe';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import {
  NODESLIDE_DECK_ERASURE_MAX_RECORDS,
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
    ) => Promise<{
      retentionSafe: boolean;
      alreadyAbsent: boolean;
      deletedRowCount: number;
      receiptDigest: string;
    }>;
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
    expectCanonicalReceiptDigest(receipt);
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
    expectCanonicalReceiptDigest(receipt);
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

/**
 * The atomic envelope, ported from parity with its fail-closed semantics.
 *
 * Both tests below arm the sensor before they assert anything: they count the
 * oversized rows and require the count to be non-zero, because "the deck was
 * not erased" is exactly what an empty fixture would also report. The refusal
 * only means something over rows that were really there.
 */
describe('NodeSlide erasure refuses a deck that does not fit one transaction', () => {
  it('refuses on the byte envelope and writes nothing', async () => {
    const t = convexTest(schema, modules);
    const built = buildGoldenNodeSlide('retention-oversize-bytes', NOW);
    const deckId = built.snapshot.deck.id;
    // 48 x 128 KiB of trace context comfortably clears the 4 MiB envelope while
    // staying far under the record limit, so this test can only fail on bytes.
    const filler = 'x'.repeat(128 * 1024);
    const projectRowId = await t.run(async (ctx) => {
      const projectId = await seedRetentionProject(ctx as MutationCtx, built, 'oversize-bytes');
      for (let index = 0; index < 48; index += 1) {
        await ctx.db.insert('nodeslide_traces', {
          id: `oversize-trace-${index}`,
          deckId,
          status: 'completed',
          summary: 'Oversized fixture trace',
          plan: [],
          context: [filler],
          toolCalls: [],
          guardrails: [],
          createdAt: NOW,
          completedAt: NOW,
        });
      }
      return projectId;
    });

    const seededTraces = await t.run((ctx) =>
      ctx.db
        .query('nodeslide_traces')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
        .collect(),
    );
    expect(
      seededTraces.length,
      'the refusal proves nothing unless the oversized rows are really there',
    ).toBe(48);

    await expect(
      t.run((ctx) =>
        deleteHandler(ctx as MutationCtx, { deckId, ownerAccessKey: OWNER_ACCESS_KEY }),
      ),
    ).rejects.toThrow(/failed closed.*exceeds the atomic limit.*bytes; no records were deleted/is);

    // Fail-closed: a refusal that had already deleted the deck row would be the
    // worst of both outcomes — a destroyed deck and an error the caller retries.
    const survivors = await t.run(async (ctx) => ({
      deck: await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', deckId))
        .first(),
      project: await ctx.db.get(projectRowId),
      traces: await ctx.db
        .query('nodeslide_traces')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
        .collect(),
    }));
    expect(survivors.deck).not.toBeNull();
    expect(survivors.project).not.toBeNull();
    expect(survivors.traces).toHaveLength(48);
  });

  it('refuses on the record envelope and writes nothing', async () => {
    const t = convexTest(schema, modules);
    const built = buildGoldenNodeSlide('retention-oversize-records', NOW);
    const deckId = built.snapshot.deck.id;
    // One row past the limit, with payloads small enough that the byte envelope
    // cannot be what trips: this test can only fail on the record count.
    const overflow = NODESLIDE_DECK_ERASURE_MAX_RECORDS + 1;
    const projectRowId = await t.run(async (ctx) => {
      const projectId = await seedRetentionProject(ctx as MutationCtx, built, 'oversize-records');
      for (let index = 0; index < overflow; index += 1) {
        await ctx.db.insert('nodeslide_traces', {
          id: `record-trace-${index}`,
          deckId,
          status: 'completed',
          summary: 'r',
          plan: [],
          context: [],
          toolCalls: [],
          guardrails: [],
          createdAt: NOW,
          completedAt: NOW,
        });
      }
      return projectId;
    });

    const seededCount = await t.run(async (ctx) => {
      const rows = await ctx.db
        .query('nodeslide_traces')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
        .collect();
      return rows.length;
    });
    expect(seededCount).toBe(overflow);

    await expect(
      t.run((ctx) =>
        deleteHandler(ctx as MutationCtx, { deckId, ownerAccessKey: OWNER_ACCESS_KEY }),
      ),
    ).rejects.toThrow(
      new RegExp(
        `failed closed.*exceeds the atomic limit of ${NODESLIDE_DECK_ERASURE_MAX_RECORDS} records; no records were deleted`,
        'is',
      ),
    );

    const survivors = await t.run(async (ctx) => ({
      deck: await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', deckId))
        .first(),
      project: await ctx.db.get(projectRowId),
    }));
    expect(survivors.deck).not.toBeNull();
    expect(survivors.project).not.toBeNull();
  });

  it('erases a deck that sits just inside the record envelope', async () => {
    const t = convexTest(schema, modules);
    const built = buildGoldenNodeSlide('retention-inside-envelope', NOW);
    const deckId = built.snapshot.deck.id;
    await t.run(async (ctx) => {
      await seedRetentionProject(ctx as MutationCtx, built, 'inside-envelope');
      for (let index = 0; index < 64; index += 1) {
        await ctx.db.insert('nodeslide_traces', {
          id: `inside-trace-${index}`,
          deckId,
          status: 'completed',
          summary: 'i',
          plan: [],
          context: [],
          toolCalls: [],
          guardrails: [],
          createdAt: NOW,
          completedAt: NOW,
        });
      }
    });

    // The envelope must bound the erasure without shrinking it. A `take` that
    // silently capped the read at the budget instead of one past it would erase
    // most of the deck and still certify success.
    const receipt = await t.run((ctx) =>
      deleteHandler(ctx as MutationCtx, { deckId, ownerAccessKey: OWNER_ACCESS_KEY }),
    );
    expect(receipt.retentionSafe).toBe(true);
    expect(receipt.deletedCounts.traces).toBe(64);
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('nodeslide_traces')
          .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
          .collect(),
      ),
    ).toEqual([]);
  });
});

async function seedRetentionProject(
  ctx: MutationCtx,
  built: ReturnType<typeof buildGoldenNodeSlide>,
  clientSessionId: string,
) {
  const projectRowId = await ctx.db.insert('projects', {
    clientSessionId,
    title: built.snapshot.deck.title,
    domain: 'nodeslide',
    brief: built.snapshot.deck.brief,
    sourceType: 'prompt',
    starred: false,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await insertNodeSlideSnapshot(ctx, {
    snapshot: built.snapshot,
    projectRowId,
    clientSessionId,
    ownerAccessKey: OWNER_ACCESS_KEY,
    plan: built.plan,
    spec: built.spec,
  });
  return projectRowId;
}

async function rejectionMessage(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected retention request to fail.');
}

function expectCanonicalReceiptDigest(
  receipt: { receiptDigest: string } & Record<string, unknown>,
) {
  const { receiptDigest, ...unsigned } = receipt;
  expect(receiptDigest).toBe(nodeslideContentDigest(canonicalJson(unsigned)));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
