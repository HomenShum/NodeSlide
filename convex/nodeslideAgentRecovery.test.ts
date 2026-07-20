/// <reference types="vite/client" />

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const NOW = 1_800_000_000_000;

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
});
