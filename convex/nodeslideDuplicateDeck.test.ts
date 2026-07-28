/// <reference types="vite/client" />

/**
 * Scenario: Dana keeps one deck as a template. Every quarter she duplicates it,
 * hands the copy to a colleague with that colleague's own access key, and
 * expects two things at once — the copy must be fully editable by its new
 * owner, and nothing the copy's owner does may reach back into the template.
 *
 * `forkNodeSlideSnapshot` has produced correct forked snapshots since the
 * decoupling landed, and its unit test proves the id remapping. What it did NOT
 * prove is that anything calls it: until `duplicateDeck` existed, the library
 * was reachable only from its own test file. These tests exercise the mutation,
 * so removing the wiring turns them red rather than leaving a green unit test
 * over an unreachable function.
 */

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import type { MutationCtx } from './_generated/server';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import { duplicateDeck } from './nodeslide';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const OWNER_ACCESS_KEY = 'a'.repeat(43);
const NEW_OWNER_ACCESS_KEY = 'b'.repeat(43);
const STRANGER_ACCESS_KEY = 'c'.repeat(43);
const NOW = 1_800_000_000_000;

const duplicateHandler = (
  duplicateDeck as unknown as {
    _handler: (
      ctx: MutationCtx,
      args: {
        deckId: string;
        ownerAccessKey: string;
        newOwnerAccessKey: string;
        clientSessionId: string;
      },
    ) => Promise<{ deckId: string; title: string }>;
  }
)._handler;

async function seedTemplate(t: ReturnType<typeof convexTest>) {
  const built = buildGoldenNodeSlide('duplicate-template', NOW);
  await t.run(async (ctx) => {
    const projectRowId = await ctx.db.insert('projects', {
      clientSessionId: 'duplicate-template',
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
      clientSessionId: 'duplicate-template',
      ownerAccessKey: OWNER_ACCESS_KEY,
      plan: built.plan,
      spec: built.spec,
    });
  });
  return built;
}

describe('duplicateDeck', () => {
  it('persists a fully re-identified copy owned by the new key', async () => {
    const t = convexTest(schema, modules);
    const built = await seedTemplate(t);
    const sourceDeckId = built.snapshot.deck.id;

    // Arm the sensor: the copy is only meaningful if the template really has
    // slides and elements to re-identify. A template seeded empty would let a
    // no-op "duplicate" pass every assertion below.
    const sourceRows = await t.run(async (ctx) => ({
      slides: await ctx.db
        .query('nodeslide_slides')
        .withIndex('by_deck', (index) => index.eq('deckId', sourceDeckId))
        .collect(),
      elements: await ctx.db
        .query('nodeslide_elements')
        .withIndex('by_deck', (index) => index.eq('deckId', sourceDeckId))
        .collect(),
    }));
    expect(sourceRows.slides.length).toBeGreaterThan(0);
    expect(sourceRows.elements.length).toBeGreaterThan(0);

    const result = await t.run((ctx) =>
      duplicateHandler(ctx as MutationCtx, {
        deckId: sourceDeckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        newOwnerAccessKey: NEW_OWNER_ACCESS_KEY,
        clientSessionId: 'duplicate-session',
      }),
    );
    expect(result.deckId).not.toBe(sourceDeckId);
    // The fork renames the copy so the two are distinguishable in a deck list.
    expect(result.title).toBe(`Copy of ${built.snapshot.deck.title}`);

    const copy = await t.run(async (ctx) => {
      const deck = await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', result.deckId))
        .first();
      const slides = await ctx.db
        .query('nodeslide_slides')
        .withIndex('by_deck', (index) => index.eq('deckId', result.deckId))
        .collect();
      const elements = await ctx.db
        .query('nodeslide_elements')
        .withIndex('by_deck', (index) => index.eq('deckId', result.deckId))
        .collect();
      return { deck, slides, elements };
    });

    expect(copy.deck).not.toBeNull();
    expect(copy.slides).toHaveLength(sourceRows.slides.length);
    expect(copy.elements).toHaveLength(sourceRows.elements.length);
    // Fresh history: a duplicate that inherited the source's version clock would
    // let a restore on the copy resurrect the template's content.
    expect(copy.deck?.version).toBe(1);
    // A copied share slug would publish the template under the copy's link.
    expect(copy.deck?.shareSlug).not.toBe(built.snapshot.deck.shareSlug);

    // Not one identity may be shared between the two decks.
    const sourceSlideIds = new Set(sourceRows.slides.map((row) => row.id));
    expect(copy.slides.some((row) => sourceSlideIds.has(row.id))).toBe(false);
    const sourceElementIds = new Set(sourceRows.elements.map((row) => row.id));
    expect(copy.elements.some((row) => sourceElementIds.has(row.id))).toBe(false);

    // The template is untouched.
    const templateAfter = await t.run((ctx) =>
      ctx.db
        .query('nodeslide_slides')
        .withIndex('by_deck', (index) => index.eq('deckId', sourceDeckId))
        .collect(),
    );
    expect(templateAfter).toHaveLength(sourceRows.slides.length);
  });

  it('refuses a caller who does not already own the source deck', async () => {
    const t = convexTest(schema, modules);
    const built = await seedTemplate(t);

    await expect(
      t.run((ctx) =>
        duplicateHandler(ctx as MutationCtx, {
          deckId: built.snapshot.deck.id,
          ownerAccessKey: STRANGER_ACCESS_KEY,
          newOwnerAccessKey: NEW_OWNER_ACCESS_KEY,
          clientSessionId: 'duplicate-session',
        }),
      ),
    ).rejects.toThrow();

    // Nothing was created on the failed path.
    expect(await t.run((ctx) => ctx.db.query('nodeslide_decks').collect())).toHaveLength(1);
  });

  it('refuses a malformed new owner key rather than minting an unreachable deck', async () => {
    const t = convexTest(schema, modules);
    const built = await seedTemplate(t);

    await expect(
      t.run((ctx) =>
        duplicateHandler(ctx as MutationCtx, {
          deckId: built.snapshot.deck.id,
          ownerAccessKey: OWNER_ACCESS_KEY,
          newOwnerAccessKey: 'too-short',
          clientSessionId: 'duplicate-session',
        }),
      ),
    ).rejects.toThrow(/owner access key for the duplicate/i);

    expect(await t.run((ctx) => ctx.db.query('nodeslide_decks').collect())).toHaveLength(1);
  });
});
