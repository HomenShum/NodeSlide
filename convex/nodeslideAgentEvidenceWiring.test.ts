import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFunctionName } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActionCtx } from './_generated/server';
import {
  captureWebSourcesBestEffort,
  finalizeNodeSlideEvidenceRecord,
  nodeSlideEvidenceAttachmentDigest,
} from './nodeslideAgent';

/**
 * Scenario: an author asks for a researched deck, the agent cites three pages,
 * and a reader opens the deck two months later to check one of them. One URL now
 * 404s and another has been rewritten. A retained citation — a URL and a snippet
 * the search provider handed back — proves nothing at that point.
 *
 * `captureWebSourcesBestEffort` is what turns the citation into evidence: it
 * stores either a real page capture or, when no capture provider is configured,
 * an exact title/URL/excerpt snapshot PDF, and records custody of it.
 *
 * Two things must hold, and both are failure modes that have real consequences:
 * a capture failure must never cost the author their proposal, and a stored blob
 * whose custody record fails to commit must not be left orphaned in storage
 * paying rent forever with nothing pointing at it.
 */

const convexDirectory = path.dirname(fileURLToPath(import.meta.url));

const SOURCES = [
  {
    sourceId: 'source_web_alpha',
    title: 'Alpha quarterly filing',
    url: 'https://example.com/alpha',
    snippet: 'Revenue rose 12% year over year.',
    provider: 'tavily',
  },
  {
    sourceId: 'source_web_beta',
    title: 'Beta market note',
    url: 'https://example.com/beta',
    snippet: 'Share fell to 18%.',
    provider: 'tavily',
  },
];

type Recorded = { name: string; args: Record<string, unknown> };

function evidenceCtx(options?: { failRecord?: boolean }) {
  const stored: string[] = [];
  const deleted: string[] = [];
  const recorded: Recorded[] = [];
  let nextStorageId = 0;
  const ctx = {
    storage: {
      store: async () => {
        const id = `storage_${nextStorageId++}`;
        stored.push(id);
        return id;
      },
      delete: async (id: string) => {
        deleted.push(id);
      },
    },
    runMutation: async (reference: unknown, args: Record<string, unknown>) => {
      recorded.push({ name: getFunctionName(reference as never), args });
      if (options?.failRecord) throw new Error('custody write rejected');
      return null;
    },
  } as unknown as ActionCtx;
  return { ctx, stored, deleted, recorded };
}

let previousFirecrawlKey: string | undefined;

beforeEach(() => {
  // No capture provider configured is the default deployment shape, and it is
  // the branch that must still produce evidence rather than nothing.
  previousFirecrawlKey = process.env['FIRECRAWL_API_KEY'];
  process.env['FIRECRAWL_API_KEY'] = '';
});

afterEach(() => {
  // Restored as an empty string rather than removed: `noDelete` is on, and the
  // capture path reads `?.trim()` so absent and empty behave identically.
  process.env['FIRECRAWL_API_KEY'] = previousFirecrawlKey ?? '';
});

describe('captureWebSourcesBestEffort', () => {
  it('records custody for every source it stored, bound to the run and parent span', async () => {
    const { ctx, stored, recorded } = evidenceCtx();
    await captureWebSourcesBestEffort(ctx, {
      deckId: 'deck_evidence',
      ownerAccessKey: 'nsk_2222222222222222222222222222222222',
      runId: 'run_evidence',
      parentSpanId: 'span_source_snapshot',
      sources: SOURCES,
    });
    expect(stored).toHaveLength(SOURCES.length);
    expect(recorded.map((entry) => entry.name)).toEqual(
      SOURCES.map(() => 'nodeslide:recordEvidenceCaptureInternal'),
    );
    for (const entry of recorded) {
      expect(entry.args['runId']).toBe('run_evidence');
      expect(entry.args['parentSpanId']).toBe('span_source_snapshot');
      expect(entry.args['status']).toBe('ready');
      // The digest is what lets a reader verify the stored bytes later. A
      // custody record without one is a receipt for nothing.
      expect(typeof entry.args['contentDigest']).toBe('string');
    }
  });

  it('labels the fallback honestly instead of calling a text snapshot a screenshot', async () => {
    const { ctx, recorded } = evidenceCtx();
    await captureWebSourcesBestEffort(ctx, {
      deckId: 'deck_evidence',
      ownerAccessKey: 'nsk_2222222222222222222222222222222222',
      runId: 'run_evidence',
      parentSpanId: 'span_source_snapshot',
      sources: [SOURCES[0] as (typeof SOURCES)[number]],
    });
    const steps = recorded[0]?.args['steps'] as Array<Record<string, unknown>>;
    expect(recorded[0]?.args['provider']).toBe('nodeslide-source-snapshot/v1');
    expect(steps[0]?.['screenshotStorageId']).toBeUndefined();
    expect(steps[0]?.['pdfStorageId']).toBeDefined();
    // A reader must be able to tell a preserved excerpt from a page capture.
    expect(String(steps[0]?.['detail'])).toContain('not a webpage screenshot');
  });

  it('caps the capture fan-out so a ten-source run cannot stall the proposal', async () => {
    const many = Array.from({ length: 10 }, (_, index) => ({
      sourceId: `source_web_${index}`,
      title: `Source ${index}`,
      url: `https://example.com/${index}`,
      snippet: 'x',
      provider: 'tavily',
    }));
    const { ctx, stored } = evidenceCtx();
    await captureWebSourcesBestEffort(ctx, {
      deckId: 'deck_evidence',
      ownerAccessKey: 'nsk_2222222222222222222222222222222222',
      runId: 'run_evidence',
      parentSpanId: 'span_source_snapshot',
      sources: many,
    });
    // Bounded work on the request path: the author is waiting on this action.
    expect(stored.length).toBeLessThanOrEqual(3);
  });

  it('deletes the orphaned blob when the custody record cannot be committed', async () => {
    const { ctx, stored, deleted } = evidenceCtx({ failRecord: true });
    await expect(
      captureWebSourcesBestEffort(ctx, {
        deckId: 'deck_evidence',
        ownerAccessKey: 'nsk_2222222222222222222222222222222222',
        runId: 'run_evidence',
        parentSpanId: 'span_source_snapshot',
        sources: [SOURCES[0] as (typeof SOURCES)[number]],
      }),
    ).rejects.toThrow(/custody write rejected/);
    // Without this, every failed custody write leaks a blob that nothing
    // references and nothing will ever clean up.
    expect(deleted).toEqual(stored);
  });
});

describe('finalizeNodeSlideEvidenceRecord', () => {
  it('returns the record result untouched on the happy path', async () => {
    const deletes: string[] = [];
    const result = await finalizeNodeSlideEvidenceRecord({
      storageId: 'storage_ok',
      deleteStorage: async (id: string) => {
        deletes.push(id);
      },
      record: async () => 'committed',
    });
    expect(result).toBe('committed');
    expect(deletes).toEqual([]);
  });

  it('surfaces both failures when the cleanup also fails, rather than hiding one', async () => {
    // Losing the original error to a cleanup error would leave an operator
    // debugging storage when the real fault was the custody write.
    const failure = finalizeNodeSlideEvidenceRecord({
      storageId: 'storage_bad',
      deleteStorage: async () => {
        throw new Error('storage delete refused');
      },
      record: async () => {
        throw new Error('custody write rejected');
      },
    });
    await expect(failure).rejects.toBeInstanceOf(AggregateError);
    const error = (await failure.catch((thrown: unknown) => thrown)) as AggregateError;
    expect(error.errors.map((entry: Error) => entry.message)).toEqual([
      'custody write rejected',
      'storage delete refused',
    ]);
  });
});

describe('nodeSlideEvidenceAttachmentDigest', () => {
  it('is content-addressed, so identical bytes verify to the same receipt', () => {
    const left = nodeSlideEvidenceAttachmentDigest(new Uint8Array([1, 2, 3]));
    const right = nodeSlideEvidenceAttachmentDigest(new Uint8Array([1, 2, 3]));
    const other = nodeSlideEvidenceAttachmentDigest(new Uint8Array([1, 2, 4]));
    expect(left).toBe(right);
    expect(left).not.toBe(other);
  });
});

describe('the evidence capture is actually wired into proposeEdit', () => {
  it('calls captureWebSourcesBestEffort on the paired sources, not on raw references', () => {
    // The unit tests above all pass with a dead export. This is the assertion
    // that fails when the call site is deleted — the exact defect this port is
    // meant not to repeat.
    const agentSource = readFileSync(path.join(convexDirectory, 'nodeslideAgent.ts'), 'utf8');
    expect(agentSource).toContain('await captureWebSourcesBestEffort(ctx, {');
    expect(agentSource).toContain('sources: storedWebSources,');
    expect(agentSource).toContain('storedWebSources = pairNodeSlideStoredWebSources({');
  });
});
