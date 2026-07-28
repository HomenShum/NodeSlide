/// <reference types="vite/client" />

/**
 * Scenario: Priya's deck is worked on by several agents across several
 * browser sessions. Some things she says are true for the whole deck ("the
 * audience is Series A investors"); some are true only for the session she is
 * in right now ("stop widening the margins"). Session facts must outrank deck
 * facts, must not leak into another deck, and must not survive the deck.
 *
 * These tests exercise the flat `deck > session` hierarchy that replaced
 * parity's `workspace > project > deck`, the exact-binding checks that make a
 * forged row unusable, the retrieval ceilings, and the bridge to the
 * pre-existing `nodeslide_agent_memories` table.
 */

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import type { NodeSlideAgentMemory } from '../shared/nodeslide';
import {
  nodeSlideMemoryScopeKey,
  normalizeNodeSlideAccessPolicy,
} from '../shared/nodeslideAccessPolicy';
import type { MutationCtx } from './_generated/server';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import { nodeSlideDeckCapabilitiesForRole } from './lib/nodeslideDeckScopeAccess';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import { issueGrant } from './nodeslideDeckGrants';
import {
  NODESLIDE_SCOPED_MEMORY_MAX_CONTENT_LENGTH,
  NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT,
  NODESLIDE_SCOPED_MEMORY_RETRIEVAL_MAX_BYTES,
  type NodeSlideScopedMemoryItem,
  type NodeSlideScopedMemoryRecord,
  archive,
  create,
  createScopedMemoryRecord,
  markUsedForOwnerInternal,
  mergeNodeSlideScopedAndLegacyMemories,
  nodeSlideScopedMemoryScope,
  nodeSlideScopedMemoryScopes,
  retrieve,
  retrieveForOwnerInternal,
  selectNodeSlideScopedMemories,
} from './nodeslideScopedMemory';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

const OWNER_KEY = 'a'.repeat(43);
const OTHER_OWNER_KEY = 'b'.repeat(43);
const NOW = 1_800_000_000_000;
const HOUR = 60 * 60 * 1_000;

type Handler<Args, Result> = (ctx: MutationCtx, args: Args) => Promise<Result>;
function handlerOf<Args, Result>(fn: unknown): Handler<Args, Result> {
  return (fn as { _handler: Handler<Args, Result> })._handler;
}

type MemoryArgs = {
  deckId: string;
  ownerAccessKey?: string;
  token?: string;
  scopeKind: 'deck' | 'session';
  category: 'preference' | 'fact' | 'decision' | 'instruction' | 'context';
  content: string;
};

const createMemory = handlerOf<MemoryArgs, { created: boolean; memory: NodeSlideScopedMemoryItem }>(
  create,
);

const archiveMemory = handlerOf<
  {
    deckId: string;
    ownerAccessKey?: string;
    token?: string;
    memoryId: string;
    contentDigest: string;
    scopeKind: 'deck' | 'session';
    scopeKey: string;
    bindingDigest: string;
  },
  { archived: boolean; memoryId: string }
>(archive);

const retrieveMemories = handlerOf<
  { deckId: string; ownerAccessKey?: string; token?: string; limit?: number },
  NodeSlideScopedMemoryItem[]
>(retrieve);

const retrieveForOwner = handlerOf<
  { deckId: string; ownerAccessKey: string; limit?: number },
  NodeSlideScopedMemoryItem[]
>(retrieveForOwnerInternal);

const markUsed = handlerOf<
  {
    deckId: string;
    ownerAccessKey: string;
    bindings: Array<{ memoryId: string; contentDigest: string; bindingDigest: string }>;
  },
  { updated: number }
>(markUsedForOwnerInternal);

const issue = handlerOf<
  {
    deckId: string;
    ownerAccessKey: string;
    role: 'owner' | 'editor' | 'viewer';
    capabilities: string[];
    agentPolicy: unknown;
    expiresAt: number;
  },
  { token: string }
>(issueGrant);

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

const deck = (deckId: string, sessionId: string) => ({ id: deckId, clientSessionId: sessionId });

describe('NodeSlide scoped memory — deck > session, rooted at the deck', () => {
  it('requires a real capability, dedupes by normalized content digest, and stores no token', async () => {
    const t = convexTest(schema, modules);
    const sessionId = 'priya-session';
    const deckId = await seedDeck(t, sessionId, OWNER_KEY);

    expect(
      await rejection(() =>
        t.run((ctx) =>
          createMemory(ctx as MutationCtx, {
            deckId,
            ownerAccessKey: OTHER_OWNER_KEY,
            scopeKind: 'deck',
            category: 'fact',
            content: 'Audience is Series A investors.',
          }),
        ),
      ),
    ).toMatch(/owner access denied/i);

    const first = await t.run((ctx) =>
      createMemory(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: OWNER_KEY,
        scopeKind: 'deck',
        category: 'fact',
        content: 'Audience is Series A investors.',
      }),
    );
    expect(first.created).toBe(true);
    expect(first.memory.binding.kind).toBe('deck');
    expect(first.memory.binding.deckId).toBe(deckId);
    expect(first.memory.binding.sessionId).toBeUndefined();

    // Whitespace-only differences are the same memory, not a second row.
    const again = await t.run((ctx) =>
      createMemory(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: OWNER_KEY,
        scopeKind: 'deck',
        category: 'fact',
        content: '   Audience   is Series A\n investors.  ',
      }),
    );
    expect(again.created).toBe(false);
    expect(again.memory.id).toBe(first.memory.id);

    const rows = await t.run(async (ctx) => ctx.db.query('nodeslide_scoped_memories').collect());
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(OWNER_KEY);
    expect(rows[0]?.deckId).toBe(deckId);

    // Content ceilings are enforced, not truncated silently.
    expect(
      await rejection(() =>
        t.run((ctx) =>
          createMemory(ctx as MutationCtx, {
            deckId,
            ownerAccessKey: OWNER_KEY,
            scopeKind: 'deck',
            category: 'fact',
            content: 'x'.repeat(NODESLIDE_SCOPED_MEMORY_MAX_CONTENT_LENGTH + 1),
          }),
        ),
      ),
    ).toMatch(/exceeds 800 characters/);
  });

  it('ranks session memory above deck memory and never leaks across decks', async () => {
    const t = convexTest(schema, modules);
    const sessionA = 'priya-session';
    const sessionB = 'rival-session';
    const deckA = await seedDeck(t, sessionA, OWNER_KEY);
    const deckB = await seedDeck(t, sessionB, OTHER_OWNER_KEY);

    await t.run((ctx) =>
      createMemory(ctx as MutationCtx, {
        deckId: deckA,
        ownerAccessKey: OWNER_KEY,
        scopeKind: 'deck',
        category: 'fact',
        content: 'Deck-wide: audience is Series A investors.',
      }),
    );
    await t.run((ctx) =>
      createMemory(ctx as MutationCtx, {
        deckId: deckA,
        ownerAccessKey: OWNER_KEY,
        scopeKind: 'session',
        category: 'instruction',
        content: 'This session: stop widening the margins.',
      }),
    );
    await t.run((ctx) =>
      createMemory(ctx as MutationCtx, {
        deckId: deckB,
        ownerAccessKey: OTHER_OWNER_KEY,
        scopeKind: 'deck',
        category: 'fact',
        content: 'Rival deck secret.',
      }),
    );

    const retrieved = await t.run((ctx) =>
      retrieveMemories(ctx as MutationCtx, { deckId: deckA, ownerAccessKey: OWNER_KEY }),
    );
    expect(retrieved.map((item) => item.binding.kind)).toEqual(['session', 'deck']);
    expect(retrieved.map((item) => item.content)).toEqual([
      'This session: stop widening the margins.',
      'Deck-wide: audience is Series A investors.',
    ]);
    expect(retrieved.some((item) => item.content.includes('Rival'))).toBe(false);

    const rivalView = await t.run((ctx) =>
      retrieveMemories(ctx as MutationCtx, { deckId: deckB, ownerAccessKey: OTHER_OWNER_KEY }),
    );
    expect(rivalView).toHaveLength(1);
    expect(rivalView[0]?.content).toBe('Rival deck secret.');

    // Archiving takes the exact binding tuple and nothing weaker.
    const target = retrieved[0] as NodeSlideScopedMemoryItem;
    expect(
      await rejection(() =>
        t.run((ctx) =>
          archiveMemory(ctx as MutationCtx, {
            deckId: deckA,
            ownerAccessKey: OWNER_KEY,
            memoryId: target.id,
            contentDigest: target.contentDigest,
            scopeKind: 'session',
            scopeKey: target.binding.scopeKey,
            bindingDigest: `${target.binding.bindingDigest}0`,
          }),
        ),
      ),
    ).toMatch(/binding mismatch/i);

    await t.run((ctx) =>
      archiveMemory(ctx as MutationCtx, {
        deckId: deckA,
        ownerAccessKey: OWNER_KEY,
        memoryId: target.id,
        contentDigest: target.contentDigest,
        scopeKind: 'session',
        scopeKey: target.binding.scopeKey,
        bindingDigest: target.binding.bindingDigest,
      }),
    );
    const afterArchive = await t.run((ctx) =>
      retrieveMemories(ctx as MutationCtx, { deckId: deckA, ownerAccessKey: OWNER_KEY }),
    );
    expect(afterArchive.map((item) => item.binding.kind)).toEqual(['deck']);
  });

  it('lets a grant token read memory only for the scope keys its agent policy names', async () => {
    const t = convexTest(schema, modules);
    const sessionId = 'priya-session';
    const deckId = await seedDeck(t, sessionId, OWNER_KEY);
    const deckScopeKey = nodeSlideMemoryScopeKey({ kind: 'deck', deckId });
    const sessionScopeKey = nodeSlideMemoryScopeKey({ kind: 'session', deckId, sessionId });

    await t.run((ctx) =>
      createMemory(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: OWNER_KEY,
        scopeKind: 'deck',
        category: 'fact',
        content: 'Deck-wide fact.',
      }),
    );

    const agentPolicy = (memoryScopeKeys: string[], capabilities: string[]) =>
      normalizeNodeSlideAccessPolicy({
        role: 'researcher',
        capabilities,
        scopes: {
          deckIds: [deckId],
          sourceIds: [],
          providerIds: [],
          modelIds: [],
          toolIds: [],
          memoryScopeKeys,
        },
        budget: {
          maxCostMicroUsd: 1_000,
          maxInputTokens: 1_000,
          maxOutputTokens: 500,
          maxDurationMs: 10_000,
          maxIterations: 3,
          maxToolCalls: 2,
        },
      });

    // A read touches the whole hierarchy, so a grant naming only the deck
    // scope is not enough — it would otherwise read session rows it was never
    // given.
    const partial = await t.run((ctx) =>
      issue(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: OWNER_KEY,
        role: 'viewer',
        capabilities: [...nodeSlideDeckCapabilitiesForRole('viewer')],
        agentPolicy: agentPolicy([deckScopeKey], ['deck:read', 'memory:read']),
        expiresAt: Date.now() + HOUR,
      }),
    );
    expect(
      await rejection(() =>
        t.run((ctx) => retrieveMemories(ctx as MutationCtx, { deckId, token: partial.token })),
      ),
    ).toMatch(/scoped memory access denied/i);

    // A grant naming both scopes reads, but memory:read alone cannot write.
    const reader = await t.run((ctx) =>
      issue(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: OWNER_KEY,
        role: 'viewer',
        capabilities: [...nodeSlideDeckCapabilitiesForRole('viewer')],
        agentPolicy: agentPolicy([deckScopeKey, sessionScopeKey], ['deck:read', 'memory:read']),
        expiresAt: Date.now() + HOUR,
      }),
    );
    const read = await t.run((ctx) =>
      retrieveMemories(ctx as MutationCtx, { deckId, token: reader.token }),
    );
    expect(read.map((item) => item.content)).toEqual(['Deck-wide fact.']);
    expect(
      await rejection(() =>
        t.run((ctx) =>
          createMemory(ctx as MutationCtx, {
            deckId,
            token: reader.token,
            scopeKind: 'deck',
            category: 'fact',
            content: 'A reader should not be able to write this.',
          }),
        ),
      ),
    ).toMatch(/scoped memory access denied/i);

    // memory:write plus the exact scope key does write.
    const writer = await t.run((ctx) =>
      issue(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: OWNER_KEY,
        role: 'viewer',
        capabilities: [...nodeSlideDeckCapabilitiesForRole('viewer')],
        agentPolicy: agentPolicy(
          [deckScopeKey, sessionScopeKey],
          ['deck:read', 'memory:read', 'memory:write'],
        ),
        expiresAt: Date.now() + HOUR,
      }),
    );
    const written = await t.run((ctx) =>
      createMemory(ctx as MutationCtx, {
        deckId,
        token: writer.token,
        scopeKind: 'session',
        category: 'context',
        content: 'Agent-observed session context.',
      }),
    );
    expect(written.created).toBe(true);
    expect(written.memory.binding.sessionId).toBe(sessionId);

    // A revoked grant stops working immediately.
    await t.run(async (ctx) => {
      const rows = await ctx.db.query('nodeslide_deck_grants').collect();
      for (const row of rows) await ctx.db.patch(row._id, { revokedAt: Date.now() });
    });
    expect(
      await rejection(() =>
        t.run((ctx) => retrieveMemories(ctx as MutationCtx, { deckId, token: reader.token })),
      ),
    ).toMatch(/scoped memory access denied/i);
  });

  it('serves durable jobs on the owner key and counts a use only for an exact binding', async () => {
    const t = convexTest(schema, modules);
    const sessionId = 'priya-session';
    const deckId = await seedDeck(t, sessionId, OWNER_KEY);

    const seeded = await t.run((ctx) =>
      createMemory(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: OWNER_KEY,
        scopeKind: 'session',
        category: 'instruction',
        content: 'Keep the closing slide to one number.',
      }),
    );

    // The internal path is the one a durable job uses: it is already holding
    // the owner key, so it never presents a grant token.
    expect(
      await rejection(() =>
        t.run((ctx) =>
          retrieveForOwner(ctx as MutationCtx, { deckId, ownerAccessKey: OTHER_OWNER_KEY }),
        ),
      ),
    ).toMatch(/owner access denied/i);

    const retrieved = await t.run((ctx) =>
      retrieveForOwner(ctx as MutationCtx, { deckId, ownerAccessKey: OWNER_KEY }),
    );
    expect(retrieved).toHaveLength(1);
    const binding = (retrieved[0] as NodeSlideScopedMemoryItem).binding;
    expect(retrieved[0]?.useCount).toBe(0);

    // A binding whose digest does not match is skipped silently rather than
    // throwing — a job must not die because one remembered fact went stale —
    // but it must not be counted as used either.
    const skipped = await t.run((ctx) =>
      markUsed(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: OWNER_KEY,
        bindings: [
          {
            memoryId: binding.memoryId,
            contentDigest: binding.contentDigest,
            bindingDigest: `${binding.bindingDigest}0`,
          },
        ],
      }),
    );
    expect(skipped.updated).toBe(0);

    const counted = await t.run((ctx) =>
      markUsed(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: OWNER_KEY,
        bindings: [
          {
            memoryId: binding.memoryId,
            contentDigest: binding.contentDigest,
            bindingDigest: binding.bindingDigest,
          },
        ],
      }),
    );
    expect(counted.updated).toBe(1);

    const after = await t.run((ctx) =>
      retrieveForOwner(ctx as MutationCtx, { deckId, ownerAccessKey: OWNER_KEY }),
    );
    expect(after[0]?.useCount).toBe(1);
    expect(after[0]?.lastUsedAt).toBeGreaterThan(0);
    expect(after[0]?.id).toBe(seeded.memory.id);

    // The retrieval limit is clamped, not trusted: an absurd request cannot
    // widen the ceiling a job budget was written against.
    const clamped = await t.run((ctx) =>
      retrieveForOwner(ctx as MutationCtx, {
        deckId,
        ownerAccessKey: OWNER_KEY,
        limit: 10_000,
      }),
    );
    expect(clamped.length).toBeLessThanOrEqual(NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT);
  });

  it('rejects forged bindings and enforces both the six-item and UTF-8 byte ceilings', () => {
    const scopes = nodeSlideScopedMemoryScopes(deck('deck-1', 'session-1'));
    const deckScope = nodeSlideScopedMemoryScope(deck('deck-1', 'session-1'), 'deck');

    const genuine = createScopedMemoryRecord({
      scope: deckScope,
      category: 'fact',
      content: 'Genuine memory.',
      source: 'user',
      now: NOW,
    });
    expect(selectNodeSlideScopedMemories([genuine], scopes)).toHaveLength(1);

    // A row whose id, digest, or scope was tampered with is not selectable,
    // even though it is structurally a valid row.
    const forgedId: NodeSlideScopedMemoryRecord = { ...genuine, id: `${genuine.id}x` };
    const forgedBinding: NodeSlideScopedMemoryRecord = { ...genuine, bindingDigest: 'deadbeef' };
    const forgedContent: NodeSlideScopedMemoryRecord = { ...genuine, content: 'Swapped content.' };
    const foreignScope: NodeSlideScopedMemoryRecord = { ...genuine, deckId: 'deck-2' };
    for (const row of [forgedId, forgedBinding, forgedContent, foreignScope]) {
      expect(selectNodeSlideScopedMemories([row], scopes)).toEqual([]);
    }

    // The item ceiling holds even when every row is legitimate.
    const many = Array.from({ length: NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT + 4 }, (_, index) =>
      createScopedMemoryRecord({
        scope: deckScope,
        category: 'fact',
        content: `Memory number ${index}.`,
        source: 'user',
        now: NOW + index,
      }),
    );
    expect(selectNodeSlideScopedMemories(many, scopes)).toHaveLength(
      NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT,
    );

    // The byte ceiling is measured in UTF-8, not characters: two multi-byte
    // memories that fit by length must still be refused by weight.
    const heavy = Array.from({ length: 4 }, (_, index) =>
      createScopedMemoryRecord({
        scope: deckScope,
        category: 'context',
        content: `${index}${'漢'.repeat(NODESLIDE_SCOPED_MEMORY_MAX_CONTENT_LENGTH - 1)}`,
        source: 'user',
        now: NOW + index,
      }),
    );
    const selectedHeavy = selectNodeSlideScopedMemories(heavy, scopes);
    const bytes = selectedHeavy.reduce(
      (total, item) => total + new TextEncoder().encode(item.content).byteLength,
      0,
    );
    expect(bytes).toBeLessThanOrEqual(NODESLIDE_SCOPED_MEMORY_RETRIEVAL_MAX_BYTES);
    expect(selectedHeavy.length).toBeLessThan(heavy.length);
  });

  it('merges legacy deck memories without weakening scope, archive state, digest, or bounds', () => {
    const deckId = 'deck-1';
    const sessionId = 'session-1';
    const scopes = nodeSlideScopedMemoryScopes(deck(deckId, sessionId));
    const deckScope = nodeSlideScopedMemoryScope(deck(deckId, sessionId), 'deck');
    const sessionScope = nodeSlideScopedMemoryScope(deck(deckId, sessionId), 'session');

    const legacy = (
      overrides: Partial<NodeSlideAgentMemory> & { content: string; id: string },
    ): NodeSlideAgentMemory =>
      ({
        deckId,
        category: 'fact',
        status: 'active',
        source: 'user',
        contentDigest: nodeslideContentDigest(overrides.content),
        createdAt: NOW,
        updatedAt: NOW,
        useCount: 0,
        ...overrides,
      }) as NodeSlideAgentMemory;

    const sessionRow = createScopedMemoryRecord({
      scope: sessionScope,
      category: 'instruction',
      content: 'Session instruction.',
      source: 'agent',
      now: NOW + 10,
    });
    const deckRow = createScopedMemoryRecord({
      scope: deckScope,
      category: 'fact',
      content: 'Shared content.',
      source: 'user',
      now: NOW + 5,
    });

    const merged = mergeNodeSlideScopedAndLegacyMemories({
      scopedRows: [sessionRow, deckRow],
      legacyMemories: [
        // Same digest as deckRow: the scoped row must win the collision.
        legacy({ id: 'legacy-dupe', content: 'Shared content.', updatedAt: NOW + 5 }),
        legacy({ id: 'legacy-live', content: 'Legacy-only fact.' }),
        // Must be dropped: archived, wrong deck, and a lying digest.
        legacy({ id: 'legacy-archived', content: 'Archived.', status: 'archived' }),
        legacy({ id: 'legacy-foreign', content: 'Foreign deck.', deckId: 'deck-2' }),
        { ...legacy({ id: 'legacy-liar', content: 'Tampered.' }), contentDigest: 'nope' },
      ],
      scopes,
    });

    expect(merged.map((item) => item.id)).toContain(sessionRow.id);
    expect(merged.map((item) => item.content)).toEqual([
      'Session instruction.',
      'Shared content.',
      'Legacy-only fact.',
    ]);
    // The collision resolved to the scoped row, not the legacy one.
    expect(merged[1]?.origin).toBe('scoped');
    expect(merged[1]?.id).toBe(deckRow.id);
    // Legacy rows join at the deck scope only, and carry a legacy binding
    // digest that cannot be replayed as a scoped one.
    const legacyItem = merged[2] as NodeSlideScopedMemoryItem;
    expect(legacyItem.origin).toBe('legacy');
    expect(legacyItem.binding.kind).toBe('deck');
    expect(legacyItem.binding.sessionId).toBeUndefined();
    expect(legacyItem.binding.bindingDigest).not.toBe(deckRow.bindingDigest);
    for (const dropped of ['Archived.', 'Foreign deck.', 'Tampered.']) {
      expect(merged.map((item) => item.content)).not.toContain(dropped);
    }

    // The merge honours the same item ceiling as plain retrieval.
    const flood = Array.from({ length: 12 }, (_, index) =>
      legacy({ id: `legacy-${index}`, content: `Legacy fact ${index}.` }),
    );
    expect(
      mergeNodeSlideScopedAndLegacyMemories({
        scopedRows: [],
        legacyMemories: flood,
        scopes,
      }),
    ).toHaveLength(NODESLIDE_SCOPED_MEMORY_RETRIEVAL_LIMIT);
  });
});
