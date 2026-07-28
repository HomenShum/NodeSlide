/// <reference types="vite/client" />

/**
 * Scenario: Priya owns a pitch deck and wants an agent fleet to edit it while
 * she is asleep. She refuses to paste her deck owner key into an agent config,
 * because that key can delete the deck.
 *
 * The journey under test: owner key -> orchestrator grant -> narrowed worker
 * grant -> the worker's token exchanged for the owner key inside a trusted
 * internal query -> revocation -> deck erasure taking the grants with it.
 *
 * The adversarial half matters more than the happy path: a bearer token that
 * survives its deck, crosses to another deck, outlives its parent, or widens
 * on delegation is the whole risk this module exists to remove.
 */

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import {
  type NodeSlideAccessPolicy,
  nodeSlideMemoryScopeKey,
  normalizeNodeSlideAccessPolicy,
} from '../shared/nodeslideAccessPolicy';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import { nodeSlideDeckCapabilitiesForRole } from './lib/nodeslideDeckScopeAccess';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import {
  type NodeSlideDeckGrantSummary,
  type NodeSlideGrantedDeckSummary,
  authorizeEditJobInternal,
  delegateGrant,
  getGrantedDeck,
  issueGrant,
  listGrants,
  revokeGrant,
} from './nodeslideDeckGrants';
import { deleteOwnedWorkspace } from './nodeslideRetention';
import { create as createScopedMemory } from './nodeslideScopedMemory';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const PRIYA_OWNER_KEY = 'a'.repeat(43);
const RIVAL_OWNER_KEY = 'b'.repeat(43);
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1_000;

type Handler<Args, Result> = (ctx: MutationCtx, args: Args) => Promise<Result>;

function handlerOf<Args, Result>(fn: unknown): Handler<Args, Result> {
  return (fn as { _handler: Handler<Args, Result> })._handler;
}

const issue = handlerOf<
  {
    deckId: string;
    ownerAccessKey: string;
    role: 'owner' | 'editor' | 'viewer';
    capabilities: string[];
    agentPolicy: unknown;
    expiresAt: number;
  },
  { grant: NodeSlideDeckGrantSummary; token: string }
>(issueGrant);

const delegate = handlerOf<
  {
    deckId: string;
    token: string;
    role: 'editor' | 'viewer';
    capabilities: string[];
    agentPolicy: unknown;
    expiresAt: number;
  },
  { grant: NodeSlideDeckGrantSummary; token: string }
>(delegateGrant);

const revoke = handlerOf<
  { deckId: string; grantId: string; ownerAccessKey?: string; token?: string },
  NodeSlideDeckGrantSummary
>(revokeGrant);

const list = handlerOf<
  { deckId: string; ownerAccessKey?: string; token?: string },
  NodeSlideDeckGrantSummary[]
>(listGrants);

const readDeck = handlerOf<{ deckId: string; token: string }, NodeSlideGrantedDeckSummary>(
  getGrantedDeck,
);

const authorizeJob = handlerOf<
  {
    deckId: string;
    token: string;
    providerMode?: string;
    providerModel?: string;
    maxCostUsd?: number;
    webResearch?: boolean;
    memoryMode?: 'off' | 'relevant';
  },
  { ownerAccessKey: string; grantId: string }
>(authorizeEditJobInternal);

const writeScopedMemory = handlerOf<
  {
    deckId: string;
    ownerAccessKey?: string;
    token?: string;
    scopeKind: 'deck' | 'session';
    category: 'preference' | 'fact' | 'decision' | 'instruction' | 'context';
    content: string;
  },
  { created: boolean; memory: { id: string } }
>(createScopedMemory);

const eraseDeck = handlerOf<
  { deckId: string; ownerAccessKey: string },
  { deletedCounts: Record<string, number>; retentionSafe: boolean }
>(deleteOwnedWorkspace);

function agentPolicyFor(deckId: string, sessionId: string): NodeSlideAccessPolicy {
  return normalizeNodeSlideAccessPolicy({
    role: 'planner',
    capabilities: ['deck:read', 'source:read', 'model:invoke', 'memory:read', 'proposal:create'],
    scopes: {
      deckIds: [deckId],
      sourceIds: [],
      providerIds: ['nebius'],
      modelIds: ['nebius/zai-org/GLM-5.2'],
      toolIds: [],
      memoryScopeKeys: [
        nodeSlideMemoryScopeKey({ kind: 'deck', deckId }),
        nodeSlideMemoryScopeKey({ kind: 'session', deckId, sessionId }),
      ],
    },
    budget: {
      maxCostMicroUsd: 2_000_000,
      maxInputTokens: 100_000,
      maxOutputTokens: 20_000,
      maxDurationMs: 300_000,
      maxIterations: 8,
      maxToolCalls: 16,
    },
  });
}

async function seedDeck(
  t: ReturnType<typeof convexTest>,
  sessionId: string,
  ownerAccessKey: string,
): Promise<string> {
  const built = buildGoldenNodeSlide(sessionId, NOW);
  await t.run(async (ctx) => {
    const projectRowId = await ctx.db.insert('projects', {
      clientSessionId: sessionId,
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
      clientSessionId: sessionId,
      ownerAccessKey,
      plan: built.plan,
      spec: built.spec,
    });
  });
  return built.snapshot.deck.id;
}

async function rejection(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the call to be rejected, but it resolved.');
}

describe('NodeSlide deck grants — delegating agent authority without the owner key', () => {
  it('walks owner -> orchestrator -> worker, exchanges the worker token for the owner key, then revokes', async () => {
    const t = convexTest(schema, modules);
    const sessionId = 'priya-session';
    const deckId = await seedDeck(t, sessionId, PRIYA_OWNER_KEY);
    const policy = agentPolicyFor(deckId, sessionId);

    // Priya mints an orchestrator grant. It is owner-role, so it can delegate.
    const orchestrator = await t.run((ctx) =>
      issue(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: PRIYA_OWNER_KEY,
        role: 'owner',
        capabilities: [...nodeSlideDeckCapabilitiesForRole('owner')],
        agentPolicy: policy,
        expiresAt: Date.now() + 24 * HOUR,
      }),
    );
    expect(orchestrator.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(orchestrator.token).not.toBe(PRIYA_OWNER_KEY);
    expect(orchestrator.grant.status).toBe('active');
    // The bearer token must never be recoverable from a stored row.
    const storedTokens = await t.run(async (ctx) => {
      const rows = await ctx.db.query('nodeslide_deck_grants').collect();
      return rows.map((row) => JSON.stringify(row));
    });
    expect(storedTokens.some((row) => row.includes(orchestrator.token))).toBe(false);

    // The orchestrator delegates a strictly narrower worker grant.
    const worker = await t.run((ctx) =>
      delegate(ctx as MutationCtx, {
        deckId,
        token: orchestrator.token,
        role: 'editor',
        capabilities: [...nodeSlideDeckCapabilitiesForRole('editor')],
        agentPolicy: policy,
        expiresAt: Date.now() + 12 * HOUR,
      }),
    );
    expect(worker.grant.role).toBe('editor');
    expect(worker.grant.parentGrantId).toBe(orchestrator.grant.id);
    expect(worker.grant.policy.capabilities).not.toContain('grant:issue');

    // The worker can read the deck through its token, without the owner key.
    const summary = await t.run((ctx) =>
      readDeck(ctx as QueryCtx as MutationCtx, { deckId, token: worker.token }),
    );
    expect(summary.id).toBe(deckId);

    // The exchange: inside the trusted boundary the worker token yields the
    // owner key, which is what lets a job run without the delegate ever
    // holding that key.
    const authorized = await t.run((ctx) =>
      authorizeJob(ctx as MutationCtx, {
        deckId,
        token: worker.token,
        providerMode: 'nebius',
        providerModel: 'nebius/zai-org/GLM-5.2',
        maxCostUsd: 1,
        memoryMode: 'relevant',
      }),
    );
    expect(authorized.ownerAccessKey).toBe(PRIYA_OWNER_KEY);
    expect(authorized.grantId).toBe(worker.grant.id);

    // Priya can see both grants and the audit trail behind them.
    const grants = await t.run((ctx) =>
      list(ctx as MutationCtx, { deckId, ownerAccessKey: PRIYA_OWNER_KEY }),
    );
    expect(grants.map((grant) => grant.id).sort()).toEqual(
      [orchestrator.grant.id, worker.grant.id].sort(),
    );
    const events = await t.run(async (ctx) =>
      ctx.db
        .query('nodeslide_deck_grant_events')
        .withIndex('by_deck_occurred', (index) => index.eq('deckId', deckId))
        .collect(),
    );
    expect(events.map((event) => event.kind)).toEqual(['issued', 'issued']);
    expect(events.some((event) => event.actorGrantId === orchestrator.grant.id)).toBe(true);

    // Revocation kills the orchestrator token immediately.
    const revoked = await t.run((ctx) =>
      revoke(ctx as MutationCtx, {
        deckId,
        grantId: orchestrator.grant.id,
        ownerAccessKey: PRIYA_OWNER_KEY,
      }),
    );
    expect(revoked.status).toBe('revoked');
    expect(
      await rejection(() =>
        t.run((ctx) =>
          delegate(ctx as MutationCtx, {
            deckId,
            token: orchestrator.token,
            role: 'viewer',
            capabilities: ['deck:read'],
            agentPolicy: policy,
            expiresAt: Date.now() + HOUR,
          }),
        ),
      ),
    ).toMatch(/access denied/i);

    // KNOWN, ASSERTED BEHAVIOUR: revocation does not cascade. The worker grant
    // issued by the orchestrator stays live until revoked in its own right.
    // Parity behaved the same way; this test exists so the next change to
    // revocation semantics is a deliberate one and not a surprise.
    const survivingWorker = await t.run((ctx) =>
      readDeck(ctx as QueryCtx as MutationCtx, { deckId, token: worker.token }),
    );
    expect(survivingWorker.id).toBe(deckId);
    const revokedWorker = await t.run((ctx) =>
      revoke(ctx as MutationCtx, {
        deckId,
        grantId: worker.grant.id,
        ownerAccessKey: PRIYA_OWNER_KEY,
      }),
    );
    expect(revokedWorker.status).toBe('revoked');
    expect(
      await rejection(() =>
        t.run((ctx) => readDeck(ctx as QueryCtx as MutationCtx, { deckId, token: worker.token })),
      ),
    ).toMatch(/access denied/i);

    // Revoking twice is idempotent, not an error, and does not double-log.
    const again = await t.run((ctx) =>
      revoke(ctx as MutationCtx, {
        deckId,
        grantId: worker.grant.id,
        ownerAccessKey: PRIYA_OWNER_KEY,
      }),
    );
    expect(again.status).toBe('revoked');
    expect(again.revokedAt).toBe(revokedWorker.revokedAt);
    const revokeEvents = await t.run(async (ctx) =>
      ctx.db
        .query('nodeslide_deck_grant_events')
        .withIndex('by_deck_occurred', (index) => index.eq('deckId', deckId))
        .collect(),
    );
    expect(revokeEvents.filter((event) => event.kind === 'revoked')).toHaveLength(2);
  });

  it('refuses widening, cross-deck replay, over-budget jobs, and unauthorized grant admin', async () => {
    const t = convexTest(schema, modules);
    const priyaSession = 'priya-session';
    const rivalSession = 'rival-session';
    const deckId = await seedDeck(t, priyaSession, PRIYA_OWNER_KEY);
    const rivalDeckId = await seedDeck(t, rivalSession, RIVAL_OWNER_KEY);
    expect(rivalDeckId).not.toBe(deckId);
    const policy = agentPolicyFor(deckId, priyaSession);

    const orchestrator = await t.run((ctx) =>
      issue(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: PRIYA_OWNER_KEY,
        role: 'owner',
        capabilities: [...nodeSlideDeckCapabilitiesForRole('owner')],
        agentPolicy: policy,
        expiresAt: Date.now() + 4 * HOUR,
      }),
    );
    const viewer = await t.run((ctx) =>
      delegate(ctx as MutationCtx, {
        deckId,
        token: orchestrator.token,
        role: 'viewer',
        capabilities: ['deck:read'],
        agentPolicy: policy,
        expiresAt: Date.now() + 2 * HOUR,
      }),
    );

    // A viewer cannot delegate, cannot revoke, and cannot list.
    expect(
      await rejection(() =>
        t.run((ctx) =>
          delegate(ctx as MutationCtx, {
            deckId,
            token: viewer.token,
            role: 'viewer',
            capabilities: ['deck:read'],
            agentPolicy: policy,
            expiresAt: Date.now() + HOUR,
          }),
        ),
      ),
    ).toMatch(/access denied/i);
    expect(
      await rejection(() =>
        t.run((ctx) =>
          revoke(ctx as MutationCtx, {
            deckId,
            grantId: orchestrator.grant.id,
            token: viewer.token,
          }),
        ),
      ),
    ).toMatch(/access denied/i);
    expect(
      await rejection(() =>
        t.run((ctx) => list(ctx as MutationCtx, { deckId, token: viewer.token })),
      ),
    ).toMatch(/access denied/i);

    // A viewer holds no job:create, so the owner-key exchange is closed to it.
    expect(
      await rejection(() =>
        t.run((ctx) => authorizeJob(ctx as MutationCtx, { deckId, token: viewer.token })),
      ),
    ).toMatch(/access denied/i);

    // The orchestrator's own token cannot be replayed against another owner's
    // deck, even though the token itself is valid.
    expect(
      await rejection(() =>
        t.run((ctx) =>
          readDeck(ctx as QueryCtx as MutationCtx, {
            deckId: rivalDeckId,
            token: orchestrator.token,
          }),
        ),
      ),
    ).toMatch(/access denied/i);
    expect(
      await rejection(() =>
        t.run((ctx) =>
          list(ctx as MutationCtx, { deckId: rivalDeckId, token: orchestrator.token }),
        ),
      ),
    ).toMatch(/access denied/i);

    // A child cannot outlive its parent.
    expect(
      await rejection(() =>
        t.run((ctx) =>
          delegate(ctx as MutationCtx, {
            deckId,
            token: orchestrator.token,
            role: 'editor',
            capabilities: ['deck:read', 'job:create'],
            agentPolicy: policy,
            expiresAt: Date.now() + 10 * HOUR,
          }),
        ),
      ),
    ).toMatch(/access denied/i);

    // A child cannot widen its capabilities past its role ceiling.
    expect(
      await rejection(() =>
        t.run((ctx) =>
          delegate(ctx as MutationCtx, {
            deckId,
            token: orchestrator.token,
            role: 'editor',
            capabilities: ['deck:read', 'grant:issue'],
            agentPolicy: policy,
            expiresAt: Date.now() + HOUR,
          }),
        ),
      ),
    ).toMatch(/outside the editor role ceiling/i);

    // Budget is enforced at the exchange, not left to the job to honour.
    const worker = await t.run((ctx) =>
      delegate(ctx as MutationCtx, {
        deckId,
        token: orchestrator.token,
        role: 'editor',
        capabilities: ['deck:read', 'job:create'],
        agentPolicy: policy,
        expiresAt: Date.now() + HOUR,
      }),
    );
    expect(
      await rejection(() =>
        t.run((ctx) =>
          authorizeJob(ctx as MutationCtx, { deckId, token: worker.token, maxCostUsd: 3 }),
        ),
      ),
    ).toMatch(/access denied/i);
    // ...and an unnamed model cannot be invoked even inside budget.
    expect(
      await rejection(() =>
        t.run((ctx) =>
          authorizeJob(ctx as MutationCtx, {
            deckId,
            token: worker.token,
            providerMode: 'openrouter_free',
            providerModel: 'openrouter/deepseek/deepseek-chat-v3.1:free',
            maxCostUsd: 1,
          }),
        ),
      ),
    ).toMatch(/access denied/i);

    // A wrong owner key never reaches issuance.
    expect(
      await rejection(() =>
        t.run((ctx) =>
          issue(ctx as MutationCtx, {
            deckId,
            ownerAccessKey: RIVAL_OWNER_KEY,
            role: 'viewer',
            capabilities: ['deck:read'],
            agentPolicy: policy,
            expiresAt: Date.now() + HOUR,
          }),
        ),
      ),
    ).toMatch(/owner access denied/i);

    // A grant with no lifetime, or one longer than a year, is not a grant.
    for (const expiresAt of [Date.now() - 1, Date.now() + 400 * 24 * HOUR]) {
      expect(
        await rejection(() =>
          t.run((ctx) =>
            issue(ctx as MutationCtx, {
              deckId,
              ownerAccessKey: PRIYA_OWNER_KEY,
              role: 'viewer',
              capabilities: ['deck:read'],
              agentPolicy: policy,
              expiresAt,
            }),
          ),
        ),
      ).toMatch(/expiry/i);
    }
  });

  it('takes grants, grant events, and scoped memories with the deck when the deck is erased', async () => {
    const t = convexTest(schema, modules);
    const sessionId = 'priya-session';
    const deckId = await seedDeck(t, sessionId, PRIYA_OWNER_KEY);
    const policy = agentPolicyFor(deckId, sessionId);

    const grant = await t.run((ctx) =>
      issue(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: PRIYA_OWNER_KEY,
        role: 'editor',
        capabilities: [...nodeSlideDeckCapabilitiesForRole('editor')],
        agentPolicy: policy,
        expiresAt: Date.now() + HOUR,
      }),
    );
    await t.run((ctx) =>
      writeScopedMemory(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: PRIYA_OWNER_KEY,
        scopeKind: 'session',
        category: 'preference',
        content: 'Priya prefers three bullets per slide.',
      }),
    );

    const before = await t.run(async (ctx) => ({
      grants: (await ctx.db.query('nodeslide_deck_grants').collect()).length,
      events: (await ctx.db.query('nodeslide_deck_grant_events').collect()).length,
      memories: (await ctx.db.query('nodeslide_scoped_memories').collect()).length,
    }));
    expect(before).toEqual({ grants: 1, events: 1, memories: 1 });

    const receipt = await t.run((ctx) =>
      eraseDeck(ctx as MutationCtx, { deckId, ownerAccessKey: PRIYA_OWNER_KEY }),
    );
    expect(receipt.retentionSafe).toBe(true);
    // The erasure contract is derived from the schema, so these three labels
    // appear because the tables carry a required deckId — not because anyone
    // remembered to add them to a list.
    expect(receipt.deletedCounts['deckGrants']).toBe(1);
    expect(receipt.deletedCounts['deckGrantEvents']).toBe(1);
    expect(receipt.deletedCounts['scopedMemories']).toBe(1);

    const after = await t.run(async (ctx) => ({
      grants: (await ctx.db.query('nodeslide_deck_grants').collect()).length,
      events: (await ctx.db.query('nodeslide_deck_grant_events').collect()).length,
      memories: (await ctx.db.query('nodeslide_scoped_memories').collect()).length,
    }));
    expect(after).toEqual({ grants: 0, events: 0, memories: 0 });

    // The revoked-or-not question is moot once the row is gone: the token can
    // no longer authorize anything, because there is nothing to authorize.
    expect(
      await rejection(() =>
        t.run((ctx) => readDeck(ctx as QueryCtx as MutationCtx, { deckId, token: grant.token })),
      ),
    ).toMatch(/access denied/i);
  });
});
