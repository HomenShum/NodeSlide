/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import type { MutationCtx } from './_generated/server';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const NOW = 1_800_000_000_000;
const OWNER_ACCESS_KEY = 'a'.repeat(43);

describe('NodeSlide abandoned agent-run recovery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('interrupts every open assistant stream when its worker lease expires', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      await ctx.db.insert('nodeslide_agent_runs', {
        id: 'run:expired',
        deckId: 'deck:expired',
        ownerDigest: 'owner:digest',
        idempotencyKey: 'idempotency:expired',
        instruction: 'Create a concise summary.',
        status: 'planning',
        provider: 'openrouter',
        model: 'moonshotai/kimi-k3',
        webResearch: false,
        attempt: 1,
        leaseExpiresAt: NOW - 1,
        createdAt: NOW - 10_000,
        updatedAt: NOW - 5_000,
      });
      await ctx.db.insert('nodeslide_agent_messages', {
        id: 'message:streaming',
        deckId: 'deck:expired',
        runId: 'run:expired',
        role: 'assistant',
        content: 'Draft in progress',
        streamState: 'streaming',
        createdAt: NOW - 4_000,
        updatedAt: NOW - 4_000,
      });
      await ctx.db.insert('nodeslide_agent_messages', {
        id: 'message:complete',
        deckId: 'deck:expired',
        runId: 'run:expired',
        role: 'assistant',
        content: 'Earlier settled message',
        streamState: 'complete',
        createdAt: NOW - 6_000,
        updatedAt: NOW - 6_000,
      });
    });

    expect(await t.mutation(internal.nodeslide.recoverStaleAgentRunsInternal, {})).toBe(1);

    const recovered = await t.run(async (ctx) => ({
      run: await ctx.db
        .query('nodeslide_agent_runs')
        .withIndex('by_stable_id', (query) => query.eq('id', 'run:expired'))
        .unique(),
      messages: await ctx.db
        .query('nodeslide_agent_messages')
        .withIndex('by_run_created', (query) => query.eq('runId', 'run:expired'))
        .collect(),
    }));
    expect(recovered.run?.status).toBe('failed');
    expect(recovered.messages.find((message) => message.id === 'message:streaming')).toMatchObject({
      streamState: 'interrupted',
      updatedAt: NOW,
    });
    expect(recovered.messages.find((message) => message.id === 'message:complete')).toMatchObject({
      streamState: 'complete',
      updatedAt: NOW - 6_000,
    });
  });

  it('transactionally interrupts an open stream when the run reaches review', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const { deckId } = await seedOwnedRun(t, 'review-settlement');
    await t.run(async (ctx) => {
      await ctx.db.insert('nodeslide_agent_messages', {
        id: 'message:review-stream',
        deckId,
        runId: 'run:review-settlement',
        role: 'assistant',
        content: 'Visible prefix whose final write failed',
        streamState: 'streaming',
        createdAt: NOW - 100,
        updatedAt: NOW - 100,
      });
    });

    await t.mutation(internal.nodeslide.advanceAgentRunInternal, {
      deckId,
      ownerAccessKey: OWNER_ACCESS_KEY,
      runId: 'run:review-settlement',
      status: 'awaiting_review',
    });
    const state = await t.run(async (ctx) => ({
      run: await ctx.db
        .query('nodeslide_agent_runs')
        .withIndex('by_stable_id', (query) => query.eq('id', 'run:review-settlement'))
        .unique(),
      stream: await ctx.db
        .query('nodeslide_agent_messages')
        .withIndex('by_stable_id', (query) => query.eq('id', 'message:review-stream'))
        .unique(),
    }));
    expect(state.run?.status).toBe('awaiting_review');
    expect(state.stream?.streamState).toBe('interrupted');
  });

  it('rejects a completed stream that rewrites its persisted prefix', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    const t = convexTest(schema, modules);
    const { deckId } = await seedOwnedRun(t, 'prefix-integrity');
    const base = {
      deckId,
      ownerAccessKey: OWNER_ACCESS_KEY,
      runId: 'run:prefix-integrity',
      messageId: 'message:prefix-integrity',
    };
    await t.mutation(internal.nodeslide.writeAgentAssistantStreamInternal, {
      ...base,
      content: 'Visible provider prefix',
      state: 'streaming',
    });
    await expect(
      t.mutation(internal.nodeslide.writeAgentAssistantStreamInternal, {
        ...base,
        content: 'Different validated summary',
        state: 'complete',
      }),
    ).rejects.toThrow(/extend the persisted prefix/i);
  });
});

async function seedOwnedRun(t: ReturnType<typeof convexTest>, suffix: string) {
  const built = buildGoldenNodeSlide(`assistant-${suffix}`, NOW);
  const deckId = built.snapshot.deck.id;
  await t.run(async (ctx) => {
    const projectRowId = await ctx.db.insert('projects', {
      clientSessionId: `session:${suffix}`,
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
      clientSessionId: `session:${suffix}`,
      ownerAccessKey: OWNER_ACCESS_KEY,
      plan: built.plan,
      spec: built.spec,
    });
    await ctx.db.insert('nodeslide_agent_runs', {
      id: `run:${suffix}`,
      deckId,
      ownerDigest: 'owner:digest',
      idempotencyKey: `idempotency:${suffix}`,
      instruction: 'Create a concise summary.',
      status: 'planning',
      provider: 'openrouter',
      model: 'moonshotai/kimi-k3',
      webResearch: false,
      attempt: 1,
      leaseExpiresAt: NOW + 60_000,
      createdAt: NOW - 1_000,
      updatedAt: NOW - 500,
    });
  });
  return { deckId };
}
