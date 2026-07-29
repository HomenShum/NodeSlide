/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import type { MutationCtx } from './_generated/server';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import { nodeSlideProductionProbeFields } from './lib/nodeslideProductionProbe';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import * as nodeslideBudgets from './nodeslideBudgets';
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
interface SweepOutcome {
  deletedWorkspaceCount: number;
  deletedRowCount: number;
  skippedWorkspaceCount: number;
  skippedWorkspaces: Array<{ deckId: string; reason: string; detail: string }>;
  deferredWorkspaceCount: number;
  stopReason: 'drained' | 'deleteBudgetExhausted' | 'planBudgetExhausted';
}

const sweepProbeHandler = (
  deleteExpiredProductionProbeWorkspaces as unknown as {
    _handler: (ctx: MutationCtx, args: Record<string, never>) => Promise<SweepOutcome>;
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

  /**
   * Scenario: an author generated a deck with a metered model, so the job row
   * carries a `budgetId` and the ledger holds a run budget, its billable calls
   * and its event chain. Then the author deletes the deck.
   *
   * The budget cluster is the one derived group with no surviving anchor. Its
   * id lives only in `job.budgetId`, and the job is deleted in the same write
   * phase, so nothing reachable from the deck can find a leftover ledger row
   * afterwards — including `countJobDerivedRows`, which is what decides whether
   * the receipt may say `retentionSafe: true`.
   *
   * Before the budget ledger had a writer nothing ever inserted these rows and
   * none of this was reachable. It is now.
   */
  it('erases the run-budget cluster with the job, and does not certify over a survivor', async () => {
    const t = convexTest(schema, modules);
    const built = buildGoldenNodeSlide('retention-budget-cluster', NOW);
    const deckId = built.snapshot.deck.id;
    const budgetId = 'nsbudget_retention_cluster';

    await t.run(async (ctx) => {
      await seedRetentionProject(ctx as MutationCtx, built, 'budget-cluster');
      await ctx.db.insert('nodeslide_agent_jobs', {
        id: 'job_retention_budget_cluster',
        kind: 'create_deck',
        clientSessionId: 'budget-cluster',
        admissionQuotaSubject: 'retention-budget-cluster',
        ownerDigest: nodeslideContentDigest(OWNER_ACCESS_KEY),
        executionDigest: nodeslideContentDigest('execution'),
        idempotencyKey: 'idem-retention-budget-cluster',
        requestDigest: nodeslideContentDigest('request'),
        status: 'succeeded',
        phase: 'complete',
        progress: 100,
        attempt: 1,
        maxAttempts: 3,
        streamId: 'stream-retention-budget-cluster',
        memoryIds: [],
        memoryDigests: [],
        resultDeckId: deckId,
        budgetId,
        createdAt: NOW,
        updatedAt: NOW,
      });
      // Seeded through the real ledger mutation, not a hand-built row. A
      // literal fixture would drift from the schema's version literals and
      // digest chain, and would stop proving the sweep handles what `create`
      // actually writes.
      await (
        nodeslideBudgets.create as unknown as {
          _handler: (ctx: MutationCtx, args: unknown) => Promise<unknown>;
        }
      )._handler(ctx as MutationCtx, { budgetId, budget: { maxCostUsd: 1 } });
    });

    const receipt = await t.run((ctx) =>
      deleteHandler(ctx as MutationCtx, { deckId, ownerAccessKey: OWNER_ACCESS_KEY }),
    );

    // The receipt may only claim safety because the cluster is actually gone.
    expect(receipt.retentionSafe).toBe(true);
    expect(receipt.deletedCounts.runBudgets).toBe(1);
    expect(receipt.deletedCounts.budgetEvents).toBe(1);
    expect(receipt.deletedCounts.agentJobs).toBe(1);

    const residue = await t.run(async (ctx) => ({
      budgets: await ctx.db
        .query('nodeslide_run_budgets')
        .withIndex('by_stable_id', (index) => index.eq('id', budgetId))
        .collect(),
      events: await ctx.db
        .query('nodeslide_budget_events')
        .withIndex('by_budget_sequence', (index) => index.eq('budgetId', budgetId))
        .collect(),
      jobs: await ctx.db
        .query('nodeslide_agent_jobs')
        .withIndex('by_result_deck', (index) => index.eq('resultDeckId', deckId))
        .collect(),
    }));
    // Asserted directly rather than through the receipt, because the receipt is
    // exactly the thing that would lie if the sweep had missed them.
    expect(residue.budgets).toEqual([]);
    expect(residue.events).toEqual([]);
    expect(residue.jobs).toEqual([]);
  });

  /**
   * The strand that has no job to anchor it.
   *
   * `nodeslide_agent_runs` is deck-scoped, so the schema-derived pass deletes
   * every one of them against the envelope. The derived pass reads them only to
   * harvest `run.budgetId`. While that read was capped at `DERIVED_SWEEP_LIMIT`
   * and the deleter was not, the two passes disagreed above the cap: run 513's
   * row was deleted, its budget id was never collected, and — with no job
   * referencing that budget — the ledger row survived behind an id that no
   * deck-anchored query can produce, under `remainingDeckRows: 0` and
   * `retentionSafe: true`.
   *
   * This is the same class as tonight's live defect in this file: a row gone, a
   * dependent left behind, and a receipt that said safe.
   */
  it('collects budget ids from every run the schema pass will delete, not just the first 512', async () => {
    const t = convexTest(schema, modules);
    const built = buildGoldenNodeSlide('retention-run-budget-strand', NOW);
    const deckId = built.snapshot.deck.id;
    const overCap = 520;
    const strandedBudgetId = `nsbudget_run_${overCap - 1}`;

    await t.run(async (ctx) => {
      await seedRetentionProject(ctx as MutationCtx, built, 'run-budget-strand');
      for (let index = 0; index < overCap; index += 1) {
        await ctx.db.insert('nodeslide_agent_runs', {
          id: `run_strand_${index}`,
          deckId,
          ownerDigest: nodeslideContentDigest(OWNER_ACCESS_KEY),
          idempotencyKey: `idem-run-strand-${index}`,
          instruction: 'r',
          status: 'completed',
          provider: 'openrouter',
          model: 'moonshotai/kimi-k3',
          webResearch: false,
          attempt: 1,
          // Only the LAST run owns a budget, so the assertion cannot pass by
          // accident from the runs that fall inside the old cap.
          ...(index === overCap - 1 ? { budgetId: strandedBudgetId } : {}),
          createdAt: NOW + index,
          updatedAt: NOW + index,
        });
      }
      await (
        nodeslideBudgets.create as unknown as {
          _handler: (ctx: MutationCtx, args: unknown) => Promise<unknown>;
        }
      )._handler(ctx as MutationCtx, { budgetId: strandedBudgetId, budget: {} });
    });

    const receipt = await t.run((ctx) =>
      deleteHandler(ctx as MutationCtx, { deckId, ownerAccessKey: OWNER_ACCESS_KEY }),
    );
    expect(receipt.retentionSafe).toBe(true);
    expect(receipt.deletedCounts.agentRuns).toBe(overCap);
    expect(receipt.deletedCounts.runBudgets).toBe(1);

    const survivors = await t.run(async (ctx) => ({
      runs: await ctx.db
        .query('nodeslide_agent_runs')
        .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
        .collect(),
      budgets: await ctx.db
        .query('nodeslide_run_budgets')
        .withIndex('by_stable_id', (index) => index.eq('id', strandedBudgetId))
        .collect(),
    }));
    expect(survivors.runs).toEqual([]);
    // The whole point: the run that owned this budget was past the old cap.
    expect(survivors.budgets).toEqual([]);
  });
});

/**
 * The expiry sweep is the one caller that erases many decks inside a single
 * transaction, and until now the only bound it had was per deck with a fresh
 * budget each time. These are the batch's own scenarios.
 *
 * Persona: the production probe runner. It creates a synthetic deck on a live
 * deployment, works it, and deletes it in a `finally`. When the runner is killed
 * mid-flight that `finally` never runs, so the cron below is the only thing that
 * ever removes the deck — which is why a sweep that cannot make progress is a
 * retention failure and not merely an operational annoyance.
 *
 * Every case here asserts on a transaction that COMMITS. That matters: the trap
 * with `convex-test` is that `t.run` rolls its handler back when it throws, so
 * "nothing was deleted", observed from outside a throwing run, measures the
 * rollback and would pass against an implementation that deletes everything and
 * only then notices. Here the sweep returns normally and its writes land, so a
 * row that survived is positive evidence that no delete was ever issued for it —
 * not evidence that one was issued and undone. The one case that needs to see
 * inside the transaction says so at the point it looks.
 */
describe('NodeSlide expired-probe sweep bounds the batch, not just each deck', () => {
  it('deletes an entire batch that fits, so the bound is a gate and not a wall', async () => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      for (let index = 0; index < 4; index += 1) {
        await seedExpiredProbe(ctx as MutationCtx, `probe-batch-fits-${index}`, index + 1, 2, 1024);
      }
    });
    expect(await t.run((ctx) => ctx.db.query('nodeslide_decks').collect())).toHaveLength(4);

    const outcome = await t.run((ctx) => sweepProbeHandler(ctx as MutationCtx, {}));
    expect(outcome.deletedWorkspaceCount).toBe(4);
    expect(outcome.skippedWorkspaceCount).toBe(0);
    expect(outcome.deferredWorkspaceCount).toBe(0);
    expect(outcome.stopReason).toBe('drained');
    expect(outcome.deletedRowCount).toBeGreaterThan(0);

    const survivors = await t.run(async (ctx) => ({
      decks: await ctx.db.query('nodeslide_decks').collect(),
      projects: await ctx.db.query('projects').collect(),
      traces: await ctx.db.query('nodeslide_traces').collect(),
    }));
    expect(survivors.decks).toEqual([]);
    expect(survivors.projects).toEqual([]);
    expect(survivors.traces).toEqual([]);
  });

  it('stops a batch whose total exceeds the shared budget, coherently, and drains the rest next run', async () => {
    const t = convexTest(schema, modules);
    // Five decks at ~1 MiB each. Every one of them fits the 4 MiB per-deck
    // envelope with room to spare — the per-deck refusal has nothing to say
    // here — but together they are ~5 MiB in one transaction, which is what had
    // no ceiling at all.
    const deckIds = await t.run(async (ctx) => {
      const ids: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        ids.push(
          await seedExpiredProbe(
            ctx as MutationCtx,
            `probe-batch-over-${index}`,
            index + 1,
            8,
            128 * 1024,
          ),
        );
      }
      return ids;
    });
    // Arm the sensor: a "the batch stopped" assertion proves nothing over a
    // fixture that was never big enough to need stopping.
    expect(await t.run((ctx) => ctx.db.query('nodeslide_traces').collect())).toHaveLength(40);

    const first = await t.run(async (ctx) => {
      const result = await sweepProbeHandler(ctx as MutationCtx, {});
      // Read INSIDE the transaction, on purpose. From out here the same query
      // would be reading whatever the transaction settled on; in here it is
      // reading what the handler itself left behind, at the moment it stopped.
      const remainingDecks = await ctx.db.query('nodeslide_decks').collect();
      return { result, remainingDeckIds: remainingDecks.map((deck) => deck.id).sort() };
    });

    // Bounded: it refused to carry all five decks in one transaction.
    expect(first.result.stopReason).toBe('deleteBudgetExhausted');
    expect(first.result.deletedWorkspaceCount).toBeGreaterThanOrEqual(1);
    expect(first.result.deletedWorkspaceCount).toBeLessThan(5);
    // Clean, not crashed: nothing was skipped, the stop is a deferral.
    expect(first.result.skippedWorkspaceCount).toBe(0);
    expect(first.result.deferredWorkspaceCount).toBe(5 - first.result.deletedWorkspaceCount);
    expect(first.remainingDeckIds).toHaveLength(5 - first.result.deletedWorkspaceCount);

    // Coherent: the sweep is expiry-ordered, so what it deleted is a prefix, and
    // each deck is all-or-nothing. A deck row gone with its traces left behind —
    // or the reverse — would be the half-erased state the envelope exists to
    // prevent, just relocated from inside a deck to inside a batch.
    const perDeck = await t.run(async (ctx) =>
      Promise.all(
        deckIds.map(async (deckId) => ({
          deckId,
          deck: await ctx.db
            .query('nodeslide_decks')
            .withIndex('by_stable_id', (index) => index.eq('id', deckId))
            .first(),
          traces: await ctx.db
            .query('nodeslide_traces')
            .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
            .collect(),
        })),
      ),
    );
    for (const row of perDeck) {
      if (row.deck === null) {
        expect(row.traces, `${row.deckId} lost its deck row but kept trace rows`).toEqual([]);
      } else {
        expect(row.traces, `${row.deckId} survived but was partially erased`).toHaveLength(8);
      }
    }
    const deletedPrefix = perDeck.findIndex((row) => row.deck !== null);
    expect(
      perDeck.slice(deletedPrefix).every((row) => row.deck !== null),
      'the sweep deleted out of expiry order',
    ).toBe(true);

    // The remainder survives for the next run, and the next run takes it. A
    // partial batch is only the right answer if the sweep actually drains.
    let runs = 1;
    let totalDeleted = first.result.deletedWorkspaceCount;
    while (runs < 5) {
      const next = await t.run((ctx) => sweepProbeHandler(ctx as MutationCtx, {}));
      runs += 1;
      totalDeleted += next.deletedWorkspaceCount;
      if (next.stopReason === 'drained') break;
    }
    expect(runs).toBeGreaterThan(1);
    expect(totalDeleted).toBe(5);
    expect(await t.run((ctx) => ctx.db.query('nodeslide_decks').collect())).toEqual([]);
    expect(await t.run((ctx) => ctx.db.query('projects').collect())).toEqual([]);
  });

  it('skips and records one oversized deck while the healthy decks around it are still erased', async () => {
    const t = convexTest(schema, modules);
    // The middle deck is ~6 MiB on its own: past the per-deck envelope, so no
    // budget in any run will ever fit it. Under the old sweep it threw, the
    // whole batch rolled back, and the next cron re-selected the same deck
    // first — the sweep could never drain past it without manual removal.
    const healthyBefore = await t.run(async (ctx) => {
      const before = await seedExpiredProbe(ctx as MutationCtx, 'probe-skip-healthy-a', 1, 4, 1024);
      await seedExpiredProbe(ctx as MutationCtx, 'probe-skip-oversized', 2, 48, 128 * 1024);
      const after = await seedExpiredProbe(ctx as MutationCtx, 'probe-skip-healthy-b', 3, 4, 1024);
      return { before, after };
    });
    const oversizedDeckId = await t.run(async (ctx) => {
      const decks = await ctx.db.query('nodeslide_decks').collect();
      const oversized = decks.find((deck) => deck.clientSessionId === 'probe-skip-oversized');
      return oversized?.id ?? '';
    });
    expect(oversizedDeckId).not.toBe('');
    expect(
      await t.run((ctx) =>
        ctx.db
          .query('nodeslide_traces')
          .withIndex('by_deck_created', (index) => index.eq('deckId', oversizedDeckId))
          .collect(),
      ),
      'the skip proves nothing unless the oversized rows are really there',
    ).toHaveLength(48);

    const outcome = await t.run((ctx) => sweepProbeHandler(ctx as MutationCtx, {}));

    // Not poisoned: the healthy deck AFTER the oversized one was still erased,
    // which is the half a throw could never deliver.
    expect(outcome.deletedWorkspaceCount).toBe(2);
    expect(outcome.stopReason).toBe('drained');
    expect(outcome.deferredWorkspaceCount).toBe(0);

    // Recorded, not silently dropped. A skip nobody can see is a leak with
    // better manners than a crash.
    expect(outcome.skippedWorkspaceCount).toBe(1);
    expect(outcome.skippedWorkspaces).toHaveLength(1);
    expect(outcome.skippedWorkspaces[0]?.deckId).toBe(oversizedDeckId);
    expect(outcome.skippedWorkspaces[0]?.reason).toBe('oversized');
    expect(outcome.skippedWorkspaces[0]?.detail).toMatch(
      /failed closed.*exceeds the atomic limit.*no records were deleted/is,
    );

    // The skip was decided in the read phase, so the oversized deck is untouched
    // — not partly erased and rolled back. This transaction COMMITTED (the two
    // healthy decks are really gone), so any delete issued against the oversized
    // deck would have committed too. Its intact rows are therefore evidence
    // about ordering, not about a rollback.
    const state = await t.run(async (ctx) => ({
      decks: await ctx.db.query('nodeslide_decks').collect(),
      oversizedTraces: await ctx.db
        .query('nodeslide_traces')
        .withIndex('by_deck_created', (index) => index.eq('deckId', oversizedDeckId))
        .collect(),
      healthyBeforeDeck: await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', healthyBefore.before))
        .first(),
      healthyAfterDeck: await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', healthyBefore.after))
        .first(),
    }));
    expect(state.healthyBeforeDeck).toBeNull();
    expect(state.healthyAfterDeck).toBeNull();
    expect(state.decks.map((deck) => deck.id)).toEqual([oversizedDeckId]);
    expect(state.oversizedTraces).toHaveLength(48);

    // And the sweep stays unwedged: a later run over nothing but the oversized
    // deck still returns instead of throwing. Being honest about the residual —
    // this deck is skipped, not erased. It needs an operator, and the record
    // above is how they learn it exists.
    const second = await t.run((ctx) => sweepProbeHandler(ctx as MutationCtx, {}));
    expect(second.deletedWorkspaceCount).toBe(0);
    expect(second.skippedWorkspaceCount).toBe(1);
    expect(second.stopReason).toBe('drained');
  });
});

/**
 * One expired production probe deck, its own project shell, and `traces`
 * trace rows of `fillerBytes` each — the knob the batch scenarios turn to make
 * a deck cheap or ruinous without changing anything else about it.
 */
async function seedExpiredProbe(
  ctx: MutationCtx,
  clientSessionId: string,
  expiresAt: number,
  traces: number,
  fillerBytes: number,
): Promise<string> {
  const built = buildGoldenNodeSlide(clientSessionId, NOW);
  const deckId = built.snapshot.deck.id;
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
    productionProbeCleanupDigest: `sha256:${nodeslideContentDigest(clientSessionId).slice(-64)}`,
    productionProbeExpiresAt: expiresAt,
  });
  const filler = 'x'.repeat(fillerBytes);
  for (let index = 0; index < traces; index += 1) {
    await ctx.db.insert('nodeslide_traces', {
      id: `${clientSessionId}-trace-${index}`,
      deckId,
      status: 'completed',
      summary: 'Expired probe fixture trace',
      plan: [],
      context: [filler],
      toolCalls: [],
      guardrails: [],
      createdAt: NOW,
      completedAt: NOW,
    });
  }
  return deckId;
}

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
