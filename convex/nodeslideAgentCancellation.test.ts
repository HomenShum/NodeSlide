/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { type FunctionReference, getFunctionName } from 'convex/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DeckPatch, NODESLIDE_LOCAL_BYOK_EDIT_CONSENT } from '../shared/nodeslide';
import { api, internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import { insertNodeSlideSnapshot, loadNodeSlideSnapshot } from './lib/nodeslideData';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import { proposeAgentPatchInternal } from './nodeslide';
import { proposeEdit, proposeExternalAgentEdit } from './nodeslideAgent';
import schema from './schema';

const forbidden = vi.hoisted(() => ({ attempts: [] as string[] }));
vi.mock('./lib/nodeslideProvider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./lib/nodeslideProvider')>()),
  callNodeSlideFreeJson: async () => {
    forbidden.attempts.push('provider');
    throw new Error('Cancellation scenarios must not call a provider.');
  },
}));

const modules = import.meta.glob(['./**/*.ts', '!./**/*.test.ts']);
const OWNER = 'a'.repeat(43);
const NOW = 1_800_000_000_000;
type Database = ReturnType<typeof convexTest>;
type Lane = 'deterministic' | 'local_candidate';
type Args = Record<string, unknown>;
type ActionHandler = (ctx: unknown, args: Args) => Promise<{ patch: DeckPatch }>;
type Run = { id: string; attempt: number };
const handlers: Record<Lane, ActionHandler> = {
  deterministic: (proposeEdit as unknown as { _handler: ActionHandler })._handler,
  local_candidate: (proposeExternalAgentEdit as unknown as { _handler: ActionHandler })._handler,
};
const publish = (
  proposeAgentPatchInternal as unknown as {
    _handler: (ctx: MutationCtx, args: Args) => Promise<{ patch: DeckPatch }>;
  }
)._handler;

afterEach(() => {
  const attempts = [...forbidden.attempts];
  forbidden.attempts.length = 0;
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  expect(attempts).toEqual([]);
});

function database() {
  vi.stubEnv('NODESLIDE_AGENTIC_GLOBAL_ENABLED', 'false');
  vi.stubGlobal('fetch', async () => {
    forbidden.attempts.push('fetch');
    throw new Error('Cancellation scenarios must not use the network.');
  });
  return convexTest(schema, modules);
}

async function state(t: Database, deckId: string) {
  return t.run(async (ctx) => ({
    snapshot: await loadNodeSlideSnapshot(ctx, deckId),
    patches: await ctx.db
      .query('nodeslide_patches')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .collect(),
    traces: await ctx.db
      .query('nodeslide_traces')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .collect(),
    runs: await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .collect(),
  }));
}

async function seed(t: Database, key: string) {
  const built = buildGoldenNodeSlide(`cancel-${key}`, NOW);
  const target = built.snapshot.elements.find((el) => el.kind === 'text' && !el.locked);
  if (!target) throw new Error('Golden deck needs unlocked text.');
  target.content = 'Before';
  const slide = built.snapshot.slides.find((item) => item.id === target.slideId);
  if (!slide) throw new Error('Selected text needs a slide.');
  const deckId = built.snapshot.deck.id;
  await t.run(async (ctx) => {
    const projectRowId = await ctx.db.insert('projects', {
      clientSessionId: key,
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
      clientSessionId: key,
      ownerAccessKey: OWNER,
      plan: built.plan,
      spec: built.spec,
    });
  });
  const args = {
    deckId,
    ownerAccessKey: OWNER,
    instruction: 'Replace "Before" with "After".',
    baseDeckVersion: built.snapshot.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: { [target.id]: target.version },
    scope: {
      kind: 'elements',
      deckId,
      slideIds: [slide.id],
      elementIds: [target.id],
      operationMode: 'copy',
    },
  };
  const operations = [
    { op: 'replace_text', slideId: slide.id, elementId: target.id, text: 'After' },
  ];
  return { deckId, args, operations, before: await state(t, deckId) };
}
type Seed = Awaited<ReturnType<typeof seed>>;

function actionArgs(seeded: Seed, lane: Lane, key: string): Args {
  return lane === 'deterministic'
    ? { ...seeded.args, idempotencyKey: key, providerMode: 'deterministic', memoryMode: 'off' }
    : {
        ...seeded.args,
        idempotencyKey: key,
        operations: seeded.operations,
        summary: 'Update selected text',
        provider: 'offline-fixture',
        model: 'supplied-candidate',
        providerConsent: NODESLIDE_LOCAL_BYOK_EDIT_CONSENT,
      };
}

function context(
  t: Database,
  hooks: {
    started?: (run: Run) => Promise<void>;
    beforePublish?: (args: Args) => Promise<void>;
    published?: (patch: DeckPatch) => Promise<void>;
  } = {},
) {
  return {
    runQuery: (ref: FunctionReference<'query'>, args: Args) => t.query(ref, args),
    runMutation: async (ref: FunctionReference<'mutation'>, args: Args) => {
      const name = getFunctionName(ref);
      if (name === 'nodeslide:proposeAgentPatchInternal') await hooks.beforePublish?.(args);
      const result = await t.mutation(ref, args);
      if (name === 'nodeslide:beginAgentRunInternal' && result.created) {
        await hooks.started?.(result.run);
      }
      if (name === 'nodeslide:proposeAgentPatchInternal') await hooks.published?.(result.patch);
      return result;
    },
  };
}

function cancel(t: Database, seeded: Seed, runId: string) {
  return t.mutation(api.nodeslide.cancelAgentRun, {
    deckId: seeded.deckId,
    ownerAccessKey: OWNER,
    runId,
  });
}

function begin(t: Database, seeded: Seed, key: string) {
  return t.mutation(internal.nodeslide.beginAgentRunInternal, {
    deckId: seeded.deckId,
    ownerAccessKey: OWNER,
    idempotencyKey: key,
    instruction: seeded.args.instruction,
    provider: 'deterministic',
    model: 'fixture',
    webResearch: false,
  });
}

function publication(seeded: Seed, run: Run, key: string): Args {
  return {
    ...seeded.args,
    runId: run.id,
    runAttempt: run.attempt,
    id: `patch-${key}`,
    traceId: `trace-${key}`,
    operations: seeded.operations,
    source: 'agent',
    summary: 'Update text',
    shadowComparisonRequested: false,
    traceSummary: 'An offline bounded candidate',
    traceContext: [],
    toolCalls: [],
  };
}

describe.each<Lane>(['deterministic', 'local_candidate'])('%s cancellation publication', (lane) => {
  it.each(['before_planning', 'before_publication'] as const)(
    'an author cancelling %s gets no proposal or trace',
    async (ordering) => {
      const t = database();
      const seeded = await seed(t, `${lane}-${ordering}`);
      let run: Run;
      const ctx = context(t, {
        started: async (value) => {
          run = value;
          if (ordering === 'before_planning') await cancel(t, seeded, run.id);
        },
        beforePublish: async () => {
          if (ordering === 'before_publication') await cancel(t, seeded, run.id);
        },
      });
      await expect(handlers[lane](ctx, actionArgs(seeded, lane, ordering))).rejects.toThrow(
        /cancel/i,
      );
      const after = await state(t, seeded.deckId);
      expect(after.patches).toHaveLength(0);
      expect(after.traces).toHaveLength(0);
      expect(after.runs).toHaveLength(1);
      expect(after.runs[0].status).toBe('cancelled');
      expect(after.snapshot).toEqual(seeded.before.snapshot);
    },
  );

  it('links publication before the final checkpoint so cancellation and replay preserve it', async () => {
    const t = database();
    const seeded = await seed(t, `${lane}-publication-gap`);
    const args = actionArgs(seeded, lane, 'publication-gap');
    let run: Run;
    let gap: Awaited<ReturnType<typeof state>> | undefined;
    let cancelled: unknown;
    let replay: { patch: DeckPatch } | undefined;
    const result = await handlers[lane](
      context(t, {
        started: async (value) => {
          run = value;
        },
        published: async () => {
          gap = await state(t, seeded.deckId);
          cancelled = await cancel(t, seeded, run.id);
          replay = await handlers[lane](context(t), args);
        },
      }),
      args,
    );
    if (!gap) throw new Error('Publication checkpoint was not observed.');
    expect(gap.runs[0].status).not.toBe('awaiting_review');
    expect(gap.runs[0].patchId).toBe(result.patch.id);
    expect(gap.runs[0].traceId).toBe(gap.traces[0].id);
    expect(cancelled).toMatchObject({ patchId: result.patch.id, status: gap.runs[0].status });
    expect(replay?.patch.id).toBe(result.patch.id);
    const after = await state(t, seeded.deckId);
    expect(after.patches).toHaveLength(1);
    expect(after.traces).toHaveLength(1);
    expect(after.runs).toHaveLength(1);
    expect(after.runs[0].status).toBe('awaiting_review');
    expect(after.snapshot).toEqual(seeded.before.snapshot);
  });

  it('preserves completed publication and ordinary idempotent replay', async () => {
    const t = database();
    const seeded = await seed(t, `${lane}-complete-first`);
    const args = actionArgs(seeded, lane, 'complete-first');
    const first = await handlers[lane](context(t), args);
    const before = await state(t, seeded.deckId);
    expect(await cancel(t, seeded, before.runs[0].id)).toMatchObject({ status: 'awaiting_review' });
    const replay = await handlers[lane](context(t), args);
    expect(replay.patch.id).toBe(first.patch.id);
    const after = await state(t, seeded.deckId);
    expect(after.patches).toEqual(before.patches);
    expect(after.traces).toEqual(before.traces);
    expect(after.runs).toEqual(before.runs);
    expect(after.snapshot).toEqual(seeded.before.snapshot);
  });

  it('rejects an old attempt without failing the reopened current attempt', async () => {
    const t = database();
    const seeded = await seed(t, `${lane}-replacement`);
    let captured: Run | undefined;
    let replacement: Run | undefined;
    const ctx = context(t, {
      started: async (value) => {
        captured = value;
      },
      beforePublish: async () => {
        if (!captured) throw new Error('Original attempt was not observed.');
        await t.mutation(internal.nodeslide.advanceAgentRunInternal, {
          deckId: seeded.deckId,
          ownerAccessKey: OWNER,
          runId: captured.id,
          status: 'failed',
          error: 'Earlier worker failed',
        });
        replacement = (await begin(t, seeded, 'replacement')).run;
      },
    });
    await expect(handlers[lane](ctx, actionArgs(seeded, lane, 'replacement'))).rejects.toThrow();
    const after = await state(t, seeded.deckId);
    if (!replacement || !captured) throw new Error('Attempt replacement was not observed.');
    expect(replacement.id).toBe(captured.id);
    expect(replacement.attempt).toBe(captured.attempt + 1);
    expect(after.runs[0]).toMatchObject({ id: replacement.id, attempt: 2, status: 'queued' });
    expect(after.runs[0].error).toBeUndefined();
    expect(after.patches).toHaveLength(0);
    expect(after.traces).toHaveLength(0);
    expect(after.snapshot).toEqual(seeded.before.snapshot);
  });
});

it('refuses invalid run/deck/owner/attempt bindings and terminal or published runs before writes', async () => {
  const t = database();
  const seeded = await seed(t, 'invalid-bindings');
  const other = await seed(t, 'another-deck');
  for (const kind of [
    'missing_run',
    'missing_attempt',
    'unknown_run',
    'other_deck',
    'other_owner',
    'old_attempt',
    'cancelled',
    'failed',
    'completed',
    'awaiting_review',
    'published',
  ] as const) {
    const start = await begin(t, kind === 'other_deck' ? other : seeded, kind);
    const args = publication(seeded, start.run, kind);
    if (kind === 'missing_run') args.runId = undefined;
    if (kind === 'missing_attempt') args.runAttempt = undefined;
    if (kind === 'unknown_run') args.runId = 'absent';
    if (kind === 'old_attempt') args.runAttempt = 0;
    await t.run(async (ctx) => {
      const row = await ctx.db
        .query('nodeslide_agent_runs')
        .withIndex('by_stable_id', (q) => q.eq('id', start.run.id))
        .unique();
      if (!row) throw new Error('Seeded run missing');
      if (kind === 'other_owner') await ctx.db.patch(row._id, { ownerDigest: 'different-owner' });
      if (kind === 'published')
        await ctx.db.patch(row._id, { patchId: 'existing-patch', traceId: 'existing-trace' });
      if (['cancelled', 'failed', 'completed', 'awaiting_review'].includes(kind)) {
        await ctx.db.patch(row._id, {
          status: kind as 'cancelled' | 'failed' | 'completed' | 'awaiting_review',
        });
      }
    });
    const before = await state(t, seeded.deckId);
    // The raw handler keeps this same-case RED meaningful before the new argument validators exist.
    // It still runs inside an actual Convex-test transaction with all actual persistence helpers.
    await expect(t.run((ctx) => publish(ctx as MutationCtx, args))).rejects.toThrow();
    expect(await state(t, seeded.deckId)).toEqual(before);
  }
}, 20_000);

it('admits the current retry once and rolls back invalid proposal writes', async () => {
  const t = database();
  const seeded = await seed(t, 'current-retry');
  const first = await begin(t, seeded, 'retry');
  await t.mutation(internal.nodeslide.advanceAgentRunInternal, {
    deckId: seeded.deckId,
    ownerAccessKey: OWNER,
    runId: first.run.id,
    status: 'failed',
  });
  const current = await begin(t, seeded, 'retry');
  expect(current.run.attempt).toBe(2);
  const args = publication(seeded, current.run, 'retry');
  const before = await state(t, seeded.deckId);
  await expect(
    t.run((ctx) => publish(ctx as MutationCtx, { ...args, operations: [] })),
  ).rejects.toThrow();
  expect(await state(t, seeded.deckId)).toEqual(before);
  const result = await t.run((ctx) => publish(ctx as MutationCtx, args));
  const published = await state(t, seeded.deckId);
  expect(published.patches).toHaveLength(1);
  expect(published.traces).toHaveLength(1);
  expect(published.runs[0]).toMatchObject({
    patchId: result.patch.id,
    traceId: 'trace-retry',
    attempt: 2,
  });
  await expect(t.run((ctx) => publish(ctx as MutationCtx, args))).rejects.toThrow();
  expect(await state(t, seeded.deckId)).toEqual(published);
  expect(published.snapshot).toEqual(seeded.before.snapshot);
});

it('keeps four overlapping jobs cancelled without cross-deck publication', async () => {
  const t = database();
  const seeds: Seed[] = [];
  for (let n = 0; n < 4; n++) seeds.push(await seed(t, `overlap-${n}`));
  let arrivals = 0;
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const results = await Promise.allSettled(
    seeds.map(async (seeded, n) => {
      const lane: Lane = n % 2 ? 'local_candidate' : 'deterministic';
      let run: Run;
      return handlers[lane](
        context(t, {
          started: async (value) => {
            run = value;
          },
          beforePublish: async () => {
            if (++arrivals === 4) release();
            await gate;
            await cancel(t, seeded, run.id);
          },
        }),
        actionArgs(seeded, lane, `overlap-${n}`),
      );
    }),
  );
  expect(arrivals).toBe(4);
  expect(results.every((result) => result.status === 'rejected')).toBe(true);
  for (const seeded of seeds) {
    const after = await state(t, seeded.deckId);
    expect(after.runs[0].status).toBe('cancelled');
    expect(after.patches).toHaveLength(0);
    expect(after.traces).toHaveLength(0);
    expect(after.snapshot).toEqual(seeded.before.snapshot);
  }
}, 20_000);

it('retains twelve cancellation/manual-recovery cycles without orphan proposals', async () => {
  const t = database();
  const seeded = await seed(t, 'retained');
  for (let n = 0; n < 12; n++) {
    const lane: Lane = n % 2 ? 'local_candidate' : 'deterministic';
    let run: Run;
    await expect(
      handlers[lane](
        context(t, {
          started: async (value) => {
            run = value;
          },
          beforePublish: async () => {
            await cancel(t, seeded, run.id);
          },
        }),
        actionArgs(seeded, lane, `cancel-${n}`),
      ),
    ).rejects.toThrow(/cancel/i);
    const result = await handlers[lane](context(t), actionArgs(seeded, lane, `recover-${n}`));
    const after = await state(t, seeded.deckId);
    expect(after.runs).toHaveLength((n + 1) * 2);
    expect(after.runs.filter((row) => row.status === 'cancelled')).toHaveLength(n + 1);
    expect(after.runs.filter((row) => row.status === 'awaiting_review')).toHaveLength(n + 1);
    expect(after.patches).toHaveLength(n + 1);
    expect(after.traces).toHaveLength(n + 1);
    expect(after.patches.some((patch) => patch.id === result.patch.id)).toBe(true);
    expect(after.snapshot).toEqual(seeded.before.snapshot);
  }
}, 30_000);
