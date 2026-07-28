/// <reference types="vite/client" />

/**
 * Scenario: Priya has one asset — a .pptx a colleague emailed her. She has no
 * NodeSlide deck, no brief, and no intention of retyping her slides into a
 * prompt. She drops the file in and expects the deck she already owns.
 *
 * `importPptxSnapshot` has parsed archives correctly since the decoupling
 * landed, and its own unit test proves the parse. What it did NOT prove is that
 * anything imports into a NEW deck: the only in-repo caller was
 * `createPptxImportCandidate`, which needs an existing deck to patch, so Priya's
 * case had no path at all. These tests drive `importPptxAsNewDeck` and the
 * mutation it calls, so unwiring either turns them red rather than leaving a
 * green parser test over an unreachable feature.
 *
 * The archive is a real one: a golden deck is exported through `buildPptx` and
 * fed back in. A fixture asserted against a hand-written XML blob would prove
 * the test author can write XML, not that this repo can read its own exports.
 */

import { convexTest } from 'convex-test';
import { getFunctionName } from 'convex/server';
import { describe, expect, it } from 'vitest';
import { buildPptx } from '../src/domains/nodeslide/slidelang/pptx';
import { internal } from './_generated/api';
import type { ActionCtx, MutationCtx } from './_generated/server';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import { createImportedDeckInternal } from './nodeslide';
import { importPptxAsNewDeck } from './nodeslidePptxCreate';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const OWNER_ACCESS_KEY = 'a'.repeat(43);
const STRANGER_ACCESS_KEY = 'b'.repeat(43);
const SESSION = 'pptx-import-session';
const NOW = 1_800_000_000_000;

// Convex wraps every handler; the suites in this repo reach the inner function
// the same way so a scenario can run one function without a deployment.
// biome-ignore lint/suspicious/noExplicitAny: Convex does not export the wrapper shape.
function handlerOf(fn: unknown): (ctx: any, args: any) => Promise<any> {
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  const inner = (fn as { _handler?: (ctx: any, args: any) => Promise<any> })._handler;
  if (!inner) throw new Error('Convex function has no handler.');
  return inner;
}

const importAction = handlerOf(importPptxAsNewDeck);
const createImported = handlerOf(createImportedDeckInternal);

type Recorded = { name: string; args: Record<string, unknown> };

/**
 * An action ctx that records the mutation reference the action reaches for.
 * Recording the RESOLVED function name is the point: an action that stopped
 * calling `createImportedDeckInternal`, or started calling something else,
 * changes this list, and no assertion about the returned deck id would notice.
 */
function recordingActionCtx() {
  const recorded: Recorded[] = [];
  const ctx = {
    runMutation: async (reference: unknown, args: Record<string, unknown>) => {
      recorded.push({ name: getFunctionName(reference as never), args });
      return { deckId: String(args['snapshot']), reused: false };
    },
  } as unknown as ActionCtx;
  return { ctx, recorded };
}

async function pptxBytes(snapshot: unknown): Promise<ArrayBuffer> {
  // biome-ignore lint/suspicious/noExplicitAny: the exporter owns the snapshot shape.
  const binary = await buildPptx(snapshot as any);
  const view = binary instanceof Uint8Array ? binary : new Uint8Array(binary as ArrayBuffer);
  const copy = new ArrayBuffer(view.byteLength);
  new Uint8Array(copy).set(view);
  return copy;
}

/**
 * A short narrative deck — text and shapes, five slides.
 *
 * Both bounds are deliberate and both are properties of the creation gate, not
 * of the importer. Charts are excluded because a .pptx cannot carry the
 * evidence source binding a chart artifact requires (the suite below covers
 * that refusal). Five slides is under the `>= 6` threshold at which
 * `artifact_visual_coverage` starts demanding typed visuals on two slides —
 * which a text deck, by construction, does not have. This fixture is the
 * import that SHOULD succeed, so it must not smuggle in either condition.
 */
async function narrativePptxBytes(): Promise<ArrayBuffer> {
  const built = buildGoldenNodeSlide('pptx-import-source', NOW);
  const slides = built.snapshot.slides.slice(0, 5);
  const keptSlideIds = new Set(slides.map((slide) => slide.id));
  return await pptxBytes({
    ...built.snapshot,
    slides,
    elements: built.snapshot.elements.filter(
      (element) => element.kind !== 'chart' && keptSlideIds.has(element.slideId),
    ),
  });
}

/**
 * A deck carrying a chart. Its evidence bindings cannot survive the export —
 * OOXML has nowhere to put a NodeSlide source id — so this is the archive that
 * reaches the creation gate unevidenced.
 */
async function chartPptxBytes(): Promise<ArrayBuffer> {
  return await pptxBytes(buildGoldenNodeSlide('pptx-import-source', NOW).snapshot);
}

const baseArgs = {
  clientSessionId: SESSION,
  ownerAccessKey: OWNER_ACCESS_KEY,
  idempotencyKey: 'import-1',
  fileName: 'quarterly.pptx',
};

describe('importPptxAsNewDeck — refusing before the parser runs', () => {
  /**
   * Each of these must fail WITHOUT reaching the archive parser. The parser is
   * the expensive, hostile-input surface; a request that was never going to be
   * persisted should not be allowed to reach it, and a recorded mutation list
   * that is not empty would mean a rejected import still wrote a deck.
   */
  it('refuses a malformed owner key with a code, not an exception', async () => {
    const { ctx, recorded } = recordingActionCtx();
    const result = await importAction(ctx, {
      ...baseArgs,
      ownerAccessKey: 'too-short',
      bytes: new ArrayBuffer(16),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_owner_key');
    expect(recorded, 'a refused import must not persist anything').toEqual([]);
  });

  it('refuses a file that is not a .pptx', async () => {
    const { ctx, recorded } = recordingActionCtx();
    const result = await importAction(ctx, {
      ...baseArgs,
      fileName: 'quarterly.key',
      bytes: new ArrayBuffer(16),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('unsupported_format');
    expect(recorded).toEqual([]);
  });

  it('refuses an empty archive and an oversized one with the same bound', async () => {
    const { ctx, recorded } = recordingActionCtx();
    const empty = await importAction(ctx, { ...baseArgs, bytes: new ArrayBuffer(0) });
    expect(empty.ok).toBe(false);
    expect(empty.code).toBe('archive_too_large');

    const oversized = await importAction(ctx, {
      ...baseArgs,
      bytes: new ArrayBuffer(9 * 1024 * 1024),
    });
    expect(oversized.ok).toBe(false);
    expect(oversized.code).toBe('archive_too_large');
    expect(recorded).toEqual([]);
  });

  it('refuses an unusable idempotency key', async () => {
    const { ctx, recorded } = recordingActionCtx();
    const result = await importAction(ctx, {
      ...baseArgs,
      idempotencyKey: '   ',
      bytes: new ArrayBuffer(16),
    });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('invalid_request');
    expect(recorded).toEqual([]);
  });

  it('reports a coded failure for bytes that are not an archive at all', async () => {
    const { ctx, recorded } = recordingActionCtx();
    const junk = new TextEncoder().encode('this is not a zip archive, it is a sentence.');
    const result = await importAction(ctx, { ...baseArgs, bytes: junk.buffer });
    // The point is the shape, not the specific code: a parse failure surfaces
    // as `ok: false` with a code the caller can branch on, and it never
    // fabricates a placeholder deck to have something to return.
    expect(result.ok).toBe(false);
    expect(typeof result.code).toBe('string');
    expect(result.code).not.toBe('');
    expect(recorded, 'a failed parse must not persist a deck').toEqual([]);
  });
});

describe('importPptxAsNewDeck — the wire to the persistence mutation', () => {
  it('parses a real archive and hands the snapshot to createImportedDeckInternal', async () => {
    const { ctx, recorded } = recordingActionCtx();
    const result = await importAction(ctx, { ...baseArgs, bytes: await narrativePptxBytes() });

    expect(result.ok, `import failed: ${JSON.stringify(result)}`).toBe(true);
    expect(result.slideCount).toBeGreaterThan(0);

    expect(recorded, 'the action must call exactly one mutation').toHaveLength(1);
    expect(recorded[0]?.name).toBe(
      getFunctionName(internal.nodeslide.createImportedDeckInternal as never),
    );
    const passed = recorded[0]?.args ?? {};
    expect(passed['ownerAccessKey']).toBe(OWNER_ACCESS_KEY);
    expect(passed['fileName']).toBe('quarterly.pptx');
    expect(passed['snapshot'], 'the parsed snapshot is what gets persisted').toBeTruthy();
    // The render-repair pass is part of the contract, not an optimization: its
    // outcome is disclosed in the notes the creation trace will carry.
    expect(
      (passed['fidelityNotes'] as string[]).some((note) => note.startsWith('Render repair:')),
      'the repair pass must disclose its outcome',
    ).toBe(true);
  });

  it('derives the same deck id from the same idempotency key, and a different one otherwise', async () => {
    const bytes = await narrativePptxBytes();
    const first = await importAction(recordingActionCtx().ctx, { ...baseArgs, bytes });
    const replay = await importAction(recordingActionCtx().ctx, { ...baseArgs, bytes });
    const other = await importAction(recordingActionCtx().ctx, {
      ...baseArgs,
      idempotencyKey: 'import-2',
      bytes,
    });

    expect(first.ok && replay.ok && other.ok).toBe(true);
    expect(replay.deckId, 'a retry must address the same deck').toBe(first.deckId);
    expect(other.deckId, 'a separate import must not collide').not.toBe(first.deckId);
  });
});

/**
 * The regression this suite exists for.
 *
 * `assertNodeSlideArtifactCompilation` refuses a chart artifact carrying no
 * canonical evidence source, and a .pptx cannot encode NodeSlide source ids —
 * so the round trip drops the deck's sources and every imported chart reaches
 * the gate unevidenced. The gate is right to refuse. What must NOT happen is
 * the refusal reaching the user as an opaque server error from an action whose
 * whole contract is a coded, fidelity-annotated result.
 *
 * Deleting the try/catch in `importPptxAsNewDeck` turns this red.
 */
describe('importPptxAsNewDeck — a refusal the creation gate raises', () => {
  it('reports an unevidenced chart as a coded result instead of throwing', async () => {
    const t = convexTest(schema, modules);
    const { recorded } = recordingActionCtx();

    // Route the action's mutation call at the real handler, so the real gate
    // decides. A stub here would test the stub.
    const ctx = {
      runMutation: async (reference: unknown, args: Record<string, unknown>) => {
        recorded.push({ name: getFunctionName(reference as never), args });
        return await t.run((inner: MutationCtx) => createImported(inner, args));
      },
    } as unknown as ActionCtx;

    const result = await importAction(ctx, { ...baseArgs, bytes: await chartPptxBytes() });

    expect(result.ok, 'an unevidenced chart must not be persisted').toBe(false);
    expect(result.code).toBe('unsupported_content');
    expect(
      result.message,
      'the message must name the rule the archive broke, not just say it failed',
    ).toMatch(/evidence source/i);
    expect(recorded, 'the action did reach the gate').toHaveLength(1);

    const decks = await t.run(async (inner) => await inner.db.query('nodeslide_decks').collect());
    expect(decks, 'a refused import must leave no deck behind').toHaveLength(0);
  });
});

describe('createImportedDeckInternal — persistence on the shared creation path', () => {
  async function importedSnapshot() {
    const { ctx, recorded } = recordingActionCtx();
    const result = await importAction(ctx, { ...baseArgs, bytes: await narrativePptxBytes() });
    if (!result.ok) throw new Error(`import failed: ${JSON.stringify(result)}`);
    const args = recorded[0]?.args ?? {};
    return {
      snapshot: args['snapshot'],
      fidelityNotes: args['fidelityNotes'] as string[],
      deckId: result.deckId,
    };
  }

  it('persists the deck, its validation, its first version and its creation trace', async () => {
    const t = convexTest(schema, modules);
    const imported = await importedSnapshot();

    const created = await t.run((ctx: MutationCtx) =>
      createImported(ctx, {
        clientSessionId: SESSION,
        ownerAccessKey: OWNER_ACCESS_KEY,
        snapshot: imported.snapshot,
        fileName: 'quarterly.pptx',
        fidelityNotes: imported.fidelityNotes,
      }),
    );
    expect(created.reused).toBe(false);
    expect(created.deckId).toBe(imported.deckId);

    const rows = await t.run(async (ctx) => ({
      deck: await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', created.deckId))
        .unique(),
      slides: await ctx.db
        .query('nodeslide_slides')
        .withIndex('by_deck', (index) => index.eq('deckId', created.deckId))
        .collect(),
      validations: await ctx.db
        .query('nodeslide_validations')
        .withIndex('by_deck_checked', (index) => index.eq('deckId', created.deckId))
        .collect(),
      versions: await ctx.db
        .query('nodeslide_versions')
        .withIndex('by_deck_version', (index) => index.eq('deckId', created.deckId))
        .collect(),
      traces: await ctx.db
        .query('nodeslide_traces')
        .withIndex('by_deck_created', (index) => index.eq('deckId', created.deckId))
        .collect(),
    }));

    expect(rows.deck, 'the import must produce a deck row').not.toBeNull();
    expect(rows.deck?.ownerAccessKey).toBe(OWNER_ACCESS_KEY);
    expect(rows.slides.length).toBeGreaterThan(0);
    // An imported deck that skipped validation would be the one deck in the
    // deployment whose snapshot was never checked.
    expect(rows.validations, 'the import must be validated').toHaveLength(1);
    expect(rows.versions, 'the import must open a version history').toHaveLength(1);
    expect(rows.traces, 'the import must leave a creation trace').toHaveLength(1);
  });

  it('records what the import could not carry, and says so plainly when it lost nothing', async () => {
    const t = convexTest(schema, modules);
    const imported = await importedSnapshot();

    const created = await t.run((ctx: MutationCtx) =>
      createImported(ctx, {
        clientSessionId: SESSION,
        ownerAccessKey: OWNER_ACCESS_KEY,
        snapshot: imported.snapshot,
        fileName: 'quarterly.pptx',
        fidelityNotes: [],
      }),
    );
    const trace = await t.run(async (ctx) =>
      ctx.db
        .query('nodeslide_traces')
        .withIndex('by_deck_created', (index) => index.eq('deckId', created.deckId))
        .unique(),
    );
    // An empty fidelity list must read as an explicit claim, not as an absence
    // the reader has to interpret.
    expect(trace?.context).toContain('Fidelity: full import, no recorded loss');
    expect(trace?.context).toContain('Source file: quarterly.pptx');
  });

  it('is idempotent for the owner and opaque to everyone else', async () => {
    const t = convexTest(schema, modules);
    const imported = await importedSnapshot();
    const args = {
      clientSessionId: SESSION,
      ownerAccessKey: OWNER_ACCESS_KEY,
      snapshot: imported.snapshot,
      fileName: 'quarterly.pptx',
      fidelityNotes: imported.fidelityNotes,
    };

    const first = await t.run((ctx: MutationCtx) => createImported(ctx, args));
    const second = await t.run((ctx: MutationCtx) => createImported(ctx, args));
    expect(first.reused).toBe(false);
    expect(second.reused, 'a retried import must not fork a second deck').toBe(true);

    const deckCount = await t.run(async (ctx) => {
      const decks = await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', first.deckId))
        .collect();
      return decks.length;
    });
    expect(deckCount).toBe(1);

    // A stranger replaying the same request must be refused rather than told
    // "reused: true", which would confirm the deck exists.
    await expect(
      t.run((ctx: MutationCtx) =>
        createImported(ctx, { ...args, ownerAccessKey: STRANGER_ACCESS_KEY }),
      ),
    ).rejects.toThrow();
  });
});
