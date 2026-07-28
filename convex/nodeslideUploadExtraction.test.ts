/// <reference types="vite/client" />

/**
 * Scenario: Marcus has the analyst report his deck's whole argument rests on,
 * and it is a PDF. He uploads it, approves it, and expects the agent to be able
 * to read it — the same way it reads the CSV he uploaded last week.
 *
 * Until this module existed he could do everything except the last step.
 * `nodeslide_uploads.format` accepts `pdf`, `extractNodeSlidePdfText` shipped
 * with the uploads cluster, and `materializeApprovedTextUpload` answered him
 * with "this stored format does not yet have a model-readable extractor" — a
 * landed extractor with no caller, and a stored file that could never become
 * evidence.
 *
 * These tests drive the action's handler with the real gate query and the real
 * attach mutation behind it, so removing either wire turns them red rather than
 * leaving a green unit test over an unreachable extractor.
 */

import { convexTest } from 'convex-test';
import { getFunctionName } from 'convex/server';
import { describe, expect, it } from 'vitest';
import { internal } from './_generated/api';
import type { ActionCtx, MutationCtx, QueryCtx } from './_generated/server';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import { attachStoredDataSourceInternal } from './nodeslide';
import { materializeApprovedPdfUpload } from './nodeslideUploadExtraction';
import { getApprovedUploadForMaterializationInternal } from './nodeslideUploads';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const OWNER_ACCESS_KEY = 'a'.repeat(43);
const SESSION = 'pdf-materialization';
const NOW = 1_800_000_000_000;

// biome-ignore lint/suspicious/noExplicitAny: Convex does not export the wrapper shape.
function handlerOf(fn: unknown): (ctx: any, args: any) => Promise<any> {
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  const inner = (fn as { _handler?: (ctx: any, args: any) => Promise<any> })._handler;
  if (!inner) throw new Error('Convex function has no handler.');
  return inner;
}

const materializePdf = handlerOf(materializeApprovedPdfUpload);
const gateQuery = handlerOf(getApprovedUploadForMaterializationInternal);
const attachSource = handlerOf(attachStoredDataSourceInternal);

/** A real, parseable PDF. A fake one would only prove the test can lie. */
function minimalTextPdf(text: string): Uint8Array {
  const escaped = text.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(body).byteLength);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = new TextEncoder().encode(body).byteLength;
  body += `xref\n0 ${objects.length + 1}\n`;
  body += '0000000000 65535 f \n';
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('');
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

const PDF_BYTES = minimalTextPdf('Segment revenue grew 12% in the fourth quarter.');

async function seedDeck(t: ReturnType<typeof convexTest>) {
  const built = buildGoldenNodeSlide(SESSION, NOW);
  await t.run(async (ctx) => {
    const projectRowId = await ctx.db.insert('projects', {
      clientSessionId: SESSION,
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
      clientSessionId: SESSION,
      ownerAccessKey: OWNER_ACCESS_KEY,
      plan: built.plan,
      spec: built.spec,
    });
  });
  return built.snapshot.deck.id;
}

/**
 * Stores the bytes and writes the approved upload row directly.
 *
 * The approval workflow has its own scenario suite; reproducing it here would
 * couple this test to that workflow's shape without testing anything extra.
 * What matters to this suite is the state it leaves behind: approved,
 * released, registered, with a digest recorded from the stored bytes.
 */
async function stageApprovedPdf(
  t: ReturnType<typeof convexTest>,
  deckId: string,
  options: { bytes?: Uint8Array; declaredDigest?: string; format?: 'pdf' | 'csv' } = {},
) {
  const bytes = options.bytes ?? PDF_BYTES;
  const uploadId = `upload_${options.format ?? 'pdf'}_${options.declaredDigest ? 'tampered' : 'clean'}`;
  await t.run(async (ctx) => {
    const storageId = await ctx.storage.store(new Blob([bytes as BlobPart]));
    await ctx.db.insert('nodeslide_uploads', {
      id: uploadId,
      deckId,
      clientSessionId: SESSION,
      fileName: 'analyst-report.pdf',
      format: options.format ?? 'pdf',
      contentType: 'application/pdf',
      byteSize: bytes.byteLength,
      contentDigest: options.declaredDigest ?? nodeslideContentDigest(bytes),
      idempotencyKey: uploadId,
      requestFingerprint: uploadId,
      storageId,
      lifecycleStatus: 'registered',
      securityStatus: 'approved',
      quarantineStatus: 'released',
      createdAt: NOW,
      updatedAt: NOW,
      registeredAt: NOW,
      approvedAt: NOW,
    });
  });
  return uploadId;
}

type Recorded = { name: string; args: Record<string, unknown> };

/**
 * An action ctx wired to the REAL gate query and attach mutation, recording the
 * resolved reference of each. Stubbing either would test the stub; recording
 * the names is what makes an unwired or re-pointed action fail here.
 */
function wiredActionCtx(t: ReturnType<typeof convexTest>) {
  const recorded: Recorded[] = [];
  const ctx = {
    runQuery: async (reference: unknown, args: Record<string, unknown>) => {
      recorded.push({ name: getFunctionName(reference as never), args });
      return await t.run((inner: QueryCtx) => gateQuery(inner, args));
    },
    runMutation: async (reference: unknown, args: Record<string, unknown>) => {
      recorded.push({ name: getFunctionName(reference as never), args });
      return await t.run((inner: MutationCtx) => attachSource(inner, args));
    },
    storage: {
      // The action must see the STORED bytes, not the bytes the test happens to
      // hold, or the digest re-check it performs would be checking nothing. A
      // Blob cannot cross convex-test's function boundary, so the bytes cross
      // and the Blob is rebuilt on this side.
      get: async (storageId: string) => {
        const bytes = await t.run(async (inner) => {
          const blob = await inner.storage.get(storageId);
          if (!blob) return null;
          return await blob.arrayBuffer();
        });
        return bytes === null ? null : new Blob([bytes as BlobPart]);
      },
    },
  } as unknown as ActionCtx;
  return { ctx, recorded };
}

describe('materializeApprovedPdfUpload — the extractor finally has a caller', () => {
  it('turns an approved PDF into an agent-readable source with a page-bound preview', async () => {
    const t = convexTest(schema, modules);
    const deckId = await seedDeck(t);
    const uploadId = await stageApprovedPdf(t, deckId);
    const { ctx, recorded } = wiredActionCtx(t);

    const attached = await materializePdf(ctx, {
      deckId,
      ownerAccessKey: OWNER_ACCESS_KEY,
      clientSessionId: SESSION,
      uploadId,
    });

    expect(attached.kind).toBe('source');

    // Both halves of the wire, by resolved name.
    expect(recorded.map((entry) => entry.name)).toEqual([
      getFunctionName(
        internal.nodeslideUploads.getApprovedUploadForMaterializationInternal as never,
      ),
      getFunctionName(internal.nodeslide.attachStoredDataSourceInternal as never),
    ]);

    const persisted = await t.run(async (inner) => ({
      source: await inner.db
        .query('nodeslide_sources')
        .withIndex('by_stable_id', (index) => index.eq('id', attached.id))
        .unique(),
      revisions: await inner.db
        .query('nodeslide_source_revisions')
        .withIndex('by_source_created', (index) => index.eq('sourceId', attached.id))
        .collect(),
    }));

    expect(persisted.source, 'materialization must create the source row').not.toBeNull();
    expect(persisted.source?.format).toBe('pdf');
    // The preview is page-bound on purpose: a model quoting this source can be
    // held to a page, and a reader can go and check it.
    expect(persisted.source?.citation).toContain('PDF pages: 1');
    expect(persisted.source?.citation).toContain('[Page 1]');
    expect(persisted.source?.citation).toContain('Segment revenue grew 12%');
    expect(persisted.revisions, 'materialization must content-address a revision').toHaveLength(1);
    expect(persisted.revisions[0]?.contentDigest).toBe(nodeslideContentDigest(PDF_BYTES));

    // A preview, not a copy of the file: no storage pointer travels with it.
    expect(JSON.stringify(persisted.source)).not.toContain('storageId');
  });

  it('binds the digest of the bytes it read, not the digest the row declared', async () => {
    const t = convexTest(schema, modules);
    const deckId = await seedDeck(t);
    // Approval is granted against CONTENT. A row whose declared digest no
    // longer matches its stored bytes means the thing a human approved is not
    // the thing about to be read, so extraction must refuse rather than hand
    // the model text nobody cleared.
    const uploadId = await stageApprovedPdf(t, deckId, {
      declaredDigest: `sha256:${'b'.repeat(64)}`,
    });
    const { ctx } = wiredActionCtx(t);

    await expect(
      materializePdf(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        uploadId,
      }),
    ).rejects.toThrow(/no longer matches/i);

    // The seeded deck ships its own sources, so the assertion is about what the
    // refusal added: nothing from the upload.
    const sources = await t.run(
      async (inner) => await inner.db.query('nodeslide_sources').collect(),
    );
    expect(
      sources.filter((source) => source.format === 'pdf'),
      'a refused extraction must attach nothing',
    ).toHaveLength(0);
  });

  it('refuses a non-PDF upload instead of running the PDF parser over it', async () => {
    const t = convexTest(schema, modules);
    const deckId = await seedDeck(t);
    const uploadId = await stageApprovedPdf(t, deckId, {
      format: 'csv',
      bytes: new TextEncoder().encode('quarter,revenue\nQ4,120\n'),
    });
    const { ctx } = wiredActionCtx(t);

    await expect(
      materializePdf(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        uploadId,
      }),
    ).rejects.toThrow(/approved PDF upload is unavailable/i);
  });

  it('refuses a caller who is not the owner, and reveals nothing about the upload', async () => {
    const t = convexTest(schema, modules);
    const deckId = await seedDeck(t);
    const uploadId = await stageApprovedPdf(t, deckId);
    const { ctx } = wiredActionCtx(t);

    await expect(
      materializePdf(ctx, {
        deckId,
        ownerAccessKey: 'c'.repeat(43),
        clientSessionId: SESSION,
        uploadId,
      }),
    ).rejects.toThrow();

    await expect(
      materializePdf(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: 'someone-elses-session',
        uploadId,
      }),
    ).rejects.toThrow();
  });
});
