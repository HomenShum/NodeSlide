import { getFunctionName } from 'convex/server';
import { describe, expect, it } from 'vitest';
import { nodeslideStableId } from './lib/nodeslideIds';
import {
  mergeAgentJobMemories,
  pairNodeSlideStoredWebSources,
  proposeEdit,
} from './nodeslideAgent';

/**
 * Scenario: an author opens a deck, saves the standing instruction "always spell
 * it NodeSlide, never Nodeslide", and then asks the agent to rewrite a slide.
 *
 * NodeSlide has two memory stores. `nodeslide_scoped_memories` is where that
 * explicit standing instruction lands — it is what the author *told* the
 * product. `nodeslide_agent_memories` is the older store of agent-written
 * recall. Until this port, `proposeEdit` read only the second one. The author's
 * instruction was accepted, stored, visible in the UI, and then ignored by every
 * subsequent edit: the worst shape of bug, because the product looked like it
 * was listening.
 *
 * These tests hold the wiring, not just the helper. Deleting the
 * `retrieveForOwnerInternal` query from `proposeEdit` and going back to
 * legacy-only memories makes the first case fail.
 */

type Dispatch = { name: string; args: Record<string, unknown> };

const OWNER_KEY = 'nsk_1111111111111111111111111111111111';
const DECK_ID = 'deck_memory_wiring';

const SCOPED_MEMORY = {
  origin: 'scoped' as const,
  id: 'mem_scoped_brand_voice',
  category: 'instruction' as const,
  content: 'Always spell it NodeSlide, never Nodeslide.',
  status: 'active' as const,
  source: 'user' as const,
  contentDigest: 'digest-scoped-brand-voice',
  createdAt: 1,
  updatedAt: 2,
  useCount: 0,
  binding: { bindingDigest: 'binding-scoped-brand-voice' },
};

const LEGACY_MEMORY = {
  id: 'mem_legacy_audience',
  deckId: DECK_ID,
  category: 'fact' as const,
  content: 'The board reads the appendix first.',
  status: 'active' as const,
  source: 'agent' as const,
  contentDigest: 'digest-legacy-audience',
  createdAt: 1,
  updatedAt: 2,
  useCount: 3,
};

function workspace() {
  return {
    deck: {
      id: DECK_ID,
      title: 'Board review',
      status: 'draft',
      version: 4,
      slideOrder: ['slide_1'],
      theme: {},
      createdAt: 1,
      updatedAt: 2,
    },
    slides: [
      { id: 'slide_1', deckId: DECK_ID, title: 'Opening', elementOrder: ['el_1'], version: 2 },
    ],
    elements: [
      {
        id: 'el_1',
        deckId: DECK_ID,
        slideId: 'slide_1',
        kind: 'text',
        name: 'Opening headline',
        text: 'Nodeslide grew 40% this quarter.',
        sourceIds: [],
        version: 2,
      },
    ],
    sources: [],
    patches: [],
    comments: [],
  };
}

class ReadContextReached extends Error {
  constructor() {
    super('read-context-sentinel');
  }
}

/**
 * Drives `proposeEdit` as far as the read-context step and records every
 * internal function it dispatched on the way. Stopping there keeps the fixture
 * honest: everything before it is the authorization and memory path this test is
 * about, and everything after it is the planner, which has its own suites.
 */
async function runProposeEditToReadContext(options: {
  scoped: unknown[];
  legacy: unknown[];
}): Promise<Dispatch[]> {
  const dispatches: Dispatch[] = [];
  const record = (reference: unknown, args: Record<string, unknown>) => {
    dispatches.push({ name: getFunctionName(reference as never), args });
  };

  const ctx = {
    runQuery: async (reference: unknown, args: Record<string, unknown>) => {
      record(reference, args);
      const name = getFunctionName(reference as never);
      if (name.endsWith(':getAgentContextInternal')) return workspace();
      if (name.endsWith(':retrieveRelevantInternal')) return options.legacy;
      if (name.endsWith(':retrieveForOwnerInternal')) return options.scoped;
      return null;
    },
    runMutation: async (reference: unknown, args: Record<string, unknown>) => {
      record(reference, args);
      const name = getFunctionName(reference as never);
      if (name.endsWith(':beginAgentRunInternal')) {
        return { created: true, run: { id: 'run_memory_wiring', attempt: 1, status: 'queued' } };
      }
      if (name.endsWith(':advanceAgentRunInternal')) {
        if (args['toolName'] === 'read_context') throw new ReadContextReached();
        return { messageId: 'msg_1', spanId: 'span_1' };
      }
      return null;
    },
    storage: {
      store: async () => {
        throw new Error('proposeEdit stored a blob on the memory path.');
      },
    },
  };

  const handler = (
    proposeEdit as unknown as { _handler: (c: unknown, a: unknown) => Promise<void> }
  )._handler;
  try {
    await handler(ctx, {
      deckId: DECK_ID,
      ownerAccessKey: OWNER_KEY,
      instruction: 'Fix the spelling on the opening slide.',
      baseDeckVersion: 4,
      baseSlideVersions: { slide_1: 2 },
      baseElementVersions: { el_1: 2 },
      scope: { kind: 'deck', deckId: DECK_ID },
      memoryMode: 'relevant',
    });
  } catch (error) {
    if (!(error instanceof ReadContextReached)) throw error;
  }
  return dispatches;
}

describe('proposeEdit memory wiring', () => {
  it('reads the scoped memory store, not only the legacy one', async () => {
    const dispatches = await runProposeEditToReadContext({
      scoped: [SCOPED_MEMORY],
      legacy: [LEGACY_MEMORY],
    });
    const names = dispatches.map((dispatch) => dispatch.name);
    // This is the assertion that fails if the scoped read is deleted.
    expect(names).toContain('nodeslideScopedMemory:retrieveForOwnerInternal');
    expect(names).toContain('nodeslideMemory:retrieveRelevantInternal');
  });

  it('carries the standing instruction into the run receipt', async () => {
    const dispatches = await runProposeEditToReadContext({
      scoped: [SCOPED_MEMORY],
      legacy: [LEGACY_MEMORY],
    });
    const memoryReceipt = dispatches.find(
      (dispatch) => dispatch.args['toolName'] === 'memory_retrieval',
    );
    expect(memoryReceipt, 'no memory_retrieval receipt was written').toBeDefined();
    const memoryIds = memoryReceipt?.args['memoryIds'] as string[];
    expect(memoryIds).toContain(SCOPED_MEMORY.id);
    expect(memoryIds).toContain(LEGACY_MEMORY.id);
    // The author-visible message has to distinguish the two, because "loaded 2
    // memories" tells nobody whether their instruction was one of them.
    expect(memoryReceipt?.args['message']).toContain('1 explicit standing instruction');
  });

  it('marks used rows in each store separately, and only the ones that survived the merge', async () => {
    const dispatches = await runProposeEditToReadContext({
      scoped: [SCOPED_MEMORY],
      legacy: [LEGACY_MEMORY],
    });
    const scopedMark = dispatches.find(
      (dispatch) => dispatch.name === 'nodeslideScopedMemory:markUsedForOwnerInternal',
    );
    const legacyMark = dispatches.find(
      (dispatch) => dispatch.name === 'nodeslideMemory:markUsedInternal',
    );
    expect(scopedMark?.args['bindings']).toEqual([
      {
        memoryId: SCOPED_MEMORY.id,
        contentDigest: SCOPED_MEMORY.contentDigest,
        bindingDigest: SCOPED_MEMORY.binding.bindingDigest,
      },
    ]);
    expect(legacyMark?.args['memoryIds']).toEqual([LEGACY_MEMORY.id]);
  });

  it('does not touch either store when the author turned memory off', async () => {
    const dispatches: Dispatch[] = [];
    const ctx = {
      runQuery: async (reference: unknown, args: Record<string, unknown>) => {
        dispatches.push({ name: getFunctionName(reference as never), args });
        return getFunctionName(reference as never).endsWith(':getAgentContextInternal')
          ? workspace()
          : null;
      },
      runMutation: async (reference: unknown, args: Record<string, unknown>) => {
        dispatches.push({ name: getFunctionName(reference as never), args });
        const name = getFunctionName(reference as never);
        if (name.endsWith(':beginAgentRunInternal')) {
          return { created: true, run: { id: 'run_off', attempt: 1, status: 'queued' } };
        }
        if (name.endsWith(':advanceAgentRunInternal')) {
          if (args['toolName'] === 'read_context') throw new ReadContextReached();
          return { messageId: 'msg_1', spanId: 'span_1' };
        }
        return null;
      },
      storage: { store: async () => null },
    };
    const handler = (
      proposeEdit as unknown as { _handler: (c: unknown, a: unknown) => Promise<void> }
    )._handler;
    try {
      await handler(ctx, {
        deckId: DECK_ID,
        ownerAccessKey: OWNER_KEY,
        instruction: 'Fix the spelling on the opening slide.',
        baseDeckVersion: 4,
        baseSlideVersions: { slide_1: 2 },
        baseElementVersions: { el_1: 2 },
        scope: { kind: 'deck', deckId: DECK_ID },
      });
    } catch (error) {
      if (!(error instanceof ReadContextReached)) throw error;
    }
    const names = dispatches.map((dispatch) => dispatch.name);
    expect(names).not.toContain('nodeslideScopedMemory:retrieveForOwnerInternal');
    expect(names).not.toContain('nodeslideMemory:retrieveRelevantInternal');
  });
});

describe('mergeAgentJobMemories', () => {
  it('puts the author instruction ahead of agent recall', () => {
    const merged = mergeAgentJobMemories(DECK_ID, [SCOPED_MEMORY], [LEGACY_MEMORY]);
    expect(merged.map((memory) => memory.id)).toEqual([SCOPED_MEMORY.id, LEGACY_MEMORY.id]);
  });

  it('drops the legacy duplicate of a scoped memory instead of prompting it twice', () => {
    const duplicate = {
      ...LEGACY_MEMORY,
      id: 'mem_legacy_dup',
      contentDigest: 'digest-scoped-brand-voice',
    };
    const merged = mergeAgentJobMemories(DECK_ID, [SCOPED_MEMORY], [duplicate]);
    expect(merged.map((memory) => memory.id)).toEqual([SCOPED_MEMORY.id]);
  });

  it('skips archived rows so a deleted instruction cannot come back through the prompt', () => {
    const archived = { ...SCOPED_MEMORY, status: 'archived' as const };
    const merged = mergeAgentJobMemories(DECK_ID, [archived], [LEGACY_MEMORY]);
    expect(merged.map((memory) => memory.id)).toEqual([LEGACY_MEMORY.id]);
  });

  it('holds the prompt budget on a deck that accumulated memories for months', () => {
    // Sustained-use scenario: a year-old deck with 400 stored memories, several
    // of them long. Unbounded, this is the line item that quietly doubles every
    // planner call's input cost.
    const many = Array.from({ length: 400 }, (_, index) => ({
      ...SCOPED_MEMORY,
      id: `mem_${index}`,
      contentDigest: `digest_${index}`,
      content: 'x'.repeat(900),
    }));
    const merged = mergeAgentJobMemories(DECK_ID, many, []);
    expect(merged.length).toBeLessThanOrEqual(6);
    const bytes = merged.reduce(
      (total, memory) => total + new TextEncoder().encode(memory.content).byteLength,
      0,
    );
    expect(bytes).toBeLessThanOrEqual(4_800);
  });
});

describe('pairNodeSlideStoredWebSources', () => {
  const BROKEN = { title: 'Broken', url: 'not a url', snippet: 'x', provider: 'p' };
  const REAL = {
    title: 'Real report',
    url: 'https://example.com/report',
    snippet: 'y',
    provider: 'p',
  };
  const OTHER = {
    title: 'Other report',
    url: 'https://example.com/other',
    snippet: 'z',
    provider: 'p',
  };
  // The id `attachWebSourcesInternal` assigns is derived from the normalized URL,
  // not from the input's position — that is the identity being rejoined on.
  const idFor = (url: string) => nodeslideStableId('source_web', DECK_ID, new URL(url).toString());

  it('does not misattribute a source when an earlier URL was rejected', () => {
    // `attachWebSourcesInternal` silently skips inputs whose URL will not parse,
    // so results and inputs are not positionally aligned. Zipping them by index
    // would hand the surviving result the *broken* input's title and snippet — a
    // citation pointing at the wrong page, which is worse than no citation.
    const paired = pairNodeSlideStoredWebSources({
      deckId: DECK_ID,
      inputs: [BROKEN, REAL],
      references: [{ id: idFor(REAL.url) }],
    });
    expect(paired).toHaveLength(1);
    expect(paired[0]?.title).toBe(REAL.title);
    expect(paired[0]?.snippet).toBe(REAL.snippet);
  });

  it('preserves the order the mutation returned, not the order of the inputs', () => {
    const paired = pairNodeSlideStoredWebSources({
      deckId: DECK_ID,
      inputs: [REAL, OTHER],
      references: [{ id: idFor(OTHER.url) }, { id: idFor(REAL.url) }],
    });
    expect(paired.map((source) => source.title)).toEqual([OTHER.title, REAL.title]);
  });

  it('never invents a binding for a reference it cannot match', () => {
    const paired = pairNodeSlideStoredWebSources({
      deckId: DECK_ID,
      inputs: [REAL],
      references: [{ id: 'source_web_something_else' }],
    });
    expect(paired).toEqual([]);
  });

  it('rejects non-http schemes rather than storing them as citations', () => {
    const paired = pairNodeSlideStoredWebSources({
      deckId: DECK_ID,
      inputs: [{ title: 'Local', url: 'file:///etc/passwd', snippet: 's', provider: 'p' }],
      references: [{ id: 'anything' }],
    });
    expect(paired).toEqual([]);
  });
});
