/// <reference types="vite/client" />

/**
 * Scenario coverage for the uploads / source-refresh / PPTX-sync backend.
 *
 * The parity suites that ship next to this file read their own module source
 * and assert on the text. That catches a bad edit; it does not catch a module
 * that nothing calls. Every test here drives a real handler against
 * convex-test's in-memory instance and asserts on rows and bytes, so a copied
 * module with its consumers unwired fails rather than scores green.
 *
 * The persona is one owner working a full evidence loop: they upload a data
 * file, approve it, materialize it into an agent-readable source, put the
 * source under monitoring, and then ask for the whole deck to be gone.
 */

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import type { MutationCtx, QueryCtx } from './_generated/server';
import crons from './crons';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import * as nodeslideModule from './nodeslide';
import * as sourceRefreshModule from './nodeslideSourceRefresh';
import * as uploadsModule from './nodeslideUploads';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const OWNER_ACCESS_KEY = 'a'.repeat(43);
const SESSION = 'scenario-uploader';
const NOW = 1_800_000_000_000;

// Convex wraps every handler; the suites in this repo reach the inner function
// the same way so a scenario can run one mutation without a deployment.
// biome-ignore lint/suspicious/noExplicitAny: Convex does not export the wrapper shape.
function handlerOf(fn: unknown): (ctx: any, args: any) => Promise<any> {
  // biome-ignore lint/suspicious/noExplicitAny: see above.
  const inner = (fn as { _handler?: (ctx: any, args: any) => Promise<any> })._handler;
  if (!inner) throw new Error('Convex function has no handler.');
  return inner;
}

const prepareUpload = handlerOf(uploadsModule.prepareUpload);
const registerUpload = handlerOf(uploadsModule.registerUpload);
const approveUpload = handlerOf(uploadsModule.approveUpload);
const rejectUpload = handlerOf(uploadsModule.rejectUpload);
const deleteUpload = handlerOf(uploadsModule.deleteUpload);
const listUploadMetadata = handlerOf(uploadsModule.listUploadMetadata);
const getUploadMetadata = handlerOf(uploadsModule.getUploadMetadata);
const getApprovedUploadForMaterialization = handlerOf(
  uploadsModule.getApprovedUploadForMaterializationInternal,
);
const attachStoredDataSource = handlerOf(nodeslideModule.attachStoredDataSourceInternal);
const configureRefresh = handlerOf(sourceRefreshModule.configure);
const listRefresh = handlerOf(sourceRefreshModule.list);
const scanDue = handlerOf(sourceRefreshModule.scanDueInternal);

const CSV = 'quarter,revenue\nQ1,120\nQ2,180\n';

/**
 * The canonical digest the server derives from the bytes. Storage's own sha256
 * is base64 and identifies the object; this one is the content address a source
 * revision is built on. They are deliberately not the same value.
 */
const digestOf = (value: string): string => nodeslideContentDigest(value);

async function seedDeck(ctx: MutationCtx): Promise<string> {
  const built = buildGoldenNodeSlide(SESSION, NOW);
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
  await insertNodeSlideSnapshot(ctx, {
    snapshot: built.snapshot,
    projectRowId,
    clientSessionId: SESSION,
    ownerAccessKey: OWNER_ACCESS_KEY,
    plan: built.plan,
    spec: built.spec,
  });
  return built.snapshot.deck.id;
}

/**
 * Prepares an upload, stores its bytes, and moves the row to `registered`.
 *
 * `registerUpload` is deliberately not used here. It compares the prepared
 * request against `_storage` metadata, and convex-test's in-memory storage
 * records `sha256` and `size` but never `contentType` — so the real handler
 * always fails on a fixture, for a reason that has nothing to do with this
 * code. The transition is applied with the exact field set `registerUpload`
 * writes, and the handler's own refusal path is asserted separately below.
 */
async function stageUpload(
  // biome-ignore lint/suspicious/noExplicitAny: convex-test instance type.
  t: any,
  deckId: string,
  overrides: { idempotencyKey?: string; fileName?: string } = {},
) {
  const idempotencyKey = overrides.idempotencyKey ?? 'upload-key-1';
  const storageId = await t.run((ctx: MutationCtx) =>
    ctx.storage.store(new Blob([CSV], { type: 'text/csv' })),
  );
  const stored = await t.run((ctx: MutationCtx) => ctx.db.system.get('_storage', storageId));
  if (!stored) throw new Error('convex-test did not persist the fixture blob.');
  const contentDigest: string = stored.sha256;
  const prepared = await t.run((ctx: MutationCtx) =>
    prepareUpload(ctx, {
      deckId,
      ownerAccessKey: OWNER_ACCESS_KEY,
      clientSessionId: SESSION,
      fileName: overrides.fileName ?? 'figures.csv',
      contentType: 'text/csv',
      byteSize: stored.size,
      contentDigest,
      idempotencyKey,
    }),
  );
  const registered = await t.run(async (ctx: MutationCtx) => {
    const row = await ctx.db
      .query('nodeslide_uploads')
      .withIndex('by_stable_id', (index) => index.eq('id', prepared.upload.id))
      .unique();
    if (!row) throw new Error('prepared upload row missing');
    await ctx.db.patch(row._id, {
      storageId,
      lifecycleStatus: 'registered',
      securityStatus: 'pending',
      quarantineStatus: 'quarantined',
      registeredAt: NOW,
      updatedAt: NOW,
    });
    return row.id;
  });
  return { prepared, registeredId: registered, storageId, contentDigest, stored };
}

describe('uploaded evidence, from quarantine to an agent-readable source', () => {
  it('holds an upload in quarantine until the owner approves it', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const { prepared, contentDigest } = await stageUpload(t, deckId);

    expect(prepared.upload.quarantineStatus).toBe('quarantined');
    expect(prepared.uploadUrl).toBeTruthy();
    const registered = await t.run((ctx: QueryCtx) =>
      getUploadMetadata(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        uploadId: prepared.upload.id,
      }),
    );
    expect(registered.lifecycleStatus).toBe('registered');
    expect(registered.quarantineStatus).toBe('quarantined');
    expect(registered.modelAccessAllowed).toBe(false);

    // A quarantined upload has no bridge to storage: the materialization gate
    // is the only path, and it refuses before approval.
    await expect(
      t.run((ctx: QueryCtx) =>
        getApprovedUploadForMaterialization(ctx, {
          deckId,
          ownerAccessKey: OWNER_ACCESS_KEY,
          clientSessionId: SESSION,
          uploadId: prepared.upload.id,
        }),
      ),
    ).rejects.toThrow();

    const approved = await t.run((ctx: MutationCtx) =>
      approveUpload(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        uploadId: prepared.upload.id,
        contentDigest,
      }),
    );
    expect(approved.securityStatus).toBe('approved');
    expect(approved.quarantineStatus).toBe('released');
    expect(approved.modelAccessAllowed).toBe(true);
  });

  it('never lets a storage id reach the client', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const { prepared, contentDigest, storageId } = await stageUpload(t, deckId);
    const approved = await t.run((ctx: MutationCtx) =>
      approveUpload(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        uploadId: prepared.upload.id,
        contentDigest,
      }),
    );
    const listed = await t.run((ctx: QueryCtx) =>
      listUploadMetadata(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
      }),
    );
    expect(listed).toHaveLength(1);
    for (const payload of [prepared.upload, approved, ...listed]) {
      expect(Object.keys(payload)).not.toContain('storageId');
      expect(JSON.stringify(payload)).not.toContain(storageId);
    }
  });

  it('refuses a second owner and a second session', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const { prepared } = await stageUpload(t, deckId);

    await expect(
      t.run((ctx: QueryCtx) =>
        listUploadMetadata(ctx, {
          deckId,
          ownerAccessKey: 'b'.repeat(43),
          clientSessionId: SESSION,
        }),
      ),
    ).rejects.toThrow(/access denied/i);
    await expect(
      t.run((ctx: MutationCtx) =>
        deleteUpload(ctx, {
          deckId,
          ownerAccessKey: OWNER_ACCESS_KEY,
          clientSessionId: 'someone-else',
          uploadId: prepared.upload.id,
        }),
      ),
    ).rejects.toThrow(/access denied/i);
  });

  it('replays a repeated idempotency key instead of charging for a second upload', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const first = await stageUpload(t, deckId);
    const replay = await t.run((ctx: MutationCtx) =>
      prepareUpload(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        fileName: 'figures.csv',
        contentType: first.stored.contentType ?? 'text/csv',
        byteSize: first.stored.size,
        contentDigest: first.contentDigest,
        idempotencyKey: 'upload-key-1',
      }),
    );
    expect(replay.replayed).toBe(true);
    expect(replay.upload.id).toBe(first.prepared.upload.id);

    const rows = await t.run((ctx: QueryCtx) => ctx.db.query('nodeslide_uploads').collect());
    expect(rows).toHaveLength(1);
  });

  it('deletes the stored bytes when the owner deletes the upload', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const { prepared, storageId } = await stageUpload(t, deckId);

    // `t.run` may only return Convex values, so reduce the blob to a boolean.
    const blobExists = (ctx: QueryCtx) => ctx.storage.get(storageId).then((blob) => blob !== null);
    expect(await t.run(blobExists)).toBe(true);
    await t.run((ctx: MutationCtx) =>
      deleteUpload(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        uploadId: prepared.upload.id,
      }),
    );
    expect(
      await t.run(blobExists),
      'deleting an upload must delete its bytes, not only its row',
    ).toBe(false);
  });

  /**
   * `registerUpload` is the one handler a fixture cannot drive to success here
   * (convex-test records no `contentType`), so assert the property that matters:
   * it refuses a stored object that does not match the prepared request instead
   * of trusting the client's declaration. The refusal is the security boundary.
   */
  it('refuses to register a stored object that does not match the prepared request', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const storageId = await t.run((ctx: MutationCtx) =>
      ctx.storage.store(new Blob([CSV], { type: 'text/csv' })),
    );
    const stored = await t.run((ctx: MutationCtx) => ctx.db.system.get('_storage', storageId));
    if (!stored) throw new Error('fixture blob missing');
    const prepared = await t.run((ctx: MutationCtx) =>
      prepareUpload(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        fileName: 'figures.csv',
        contentType: 'text/csv',
        // A client claiming a smaller file than it uploaded.
        byteSize: stored.size + 4_096,
        contentDigest: stored.sha256,
        idempotencyKey: 'mismatch-key',
      }),
    );
    await expect(
      t.run((ctx: MutationCtx) =>
        registerUpload(ctx, {
          deckId,
          ownerAccessKey: OWNER_ACCESS_KEY,
          clientSessionId: SESSION,
          uploadId: prepared.upload.id,
          storageId,
          idempotencyKey: 'mismatch-key',
        }),
      ),
      // In production this is the size mismatch; under convex-test the absent
      // stored `contentType` trips first. Either way the registration refuses,
      // and the assertion below is that nothing was written.
    ).rejects.toThrow(/does not match the prepared upload|MIME type is invalid/i);

    const row = await t.run((ctx: QueryCtx) =>
      ctx.db
        .query('nodeslide_uploads')
        .withIndex('by_stable_id', (index) => index.eq('id', prepared.upload.id))
        .unique(),
    );
    expect(row?.lifecycleStatus, 'a refused registration must not advance the row').toBe(
      'awaiting_upload',
    );
  });

  it('refuses to retroactively reject an approved upload', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const { prepared, contentDigest } = await stageUpload(t, deckId);
    await t.run((ctx: MutationCtx) =>
      approveUpload(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        uploadId: prepared.upload.id,
        contentDigest,
      }),
    );
    await expect(
      t.run((ctx: MutationCtx) =>
        rejectUpload(ctx, {
          deckId,
          ownerAccessKey: OWNER_ACCESS_KEY,
          clientSessionId: SESSION,
          uploadId: prepared.upload.id,
        }),
      ),
    ).rejects.toThrow(/must be deleted/i);
  });
});

/**
 * The wiring test. `materializeApprovedTextUpload` is an action, so its two
 * halves are exercised directly: the gate that hands back a storage id, and the
 * mutation the action calls with the extracted preview. If
 * `attachStoredDataSourceInternal` were removed from `convex/nodeslide.ts`, or
 * the action stopped calling it, no source row would appear and this fails.
 */
describe('materializing an approved upload into an agent-readable source', () => {
  it('produces a source row and an immutable revision, and never stores raw bytes', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const { prepared, contentDigest } = await stageUpload(t, deckId);
    await t.run((ctx: MutationCtx) =>
      approveUpload(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        uploadId: prepared.upload.id,
        contentDigest,
      }),
    );

    const gate = await t.run((ctx: QueryCtx) =>
      getApprovedUploadForMaterialization(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        clientSessionId: SESSION,
        uploadId: prepared.upload.id,
      }),
    );
    expect(gate.storageId).toBeTruthy();

    const storedText = await t.run(async (ctx: QueryCtx) => {
      const blob = await ctx.storage.get(gate.storageId);
      if (!blob) throw new Error('stored upload vanished');
      return await blob.text();
    });
    const materialized = uploadsModule.materializeNodeSlideStoredText(
      new TextEncoder().encode(storedText),
      'csv',
    );
    expect(materialized.truncated).toBe(false);
    expect(materialized.columns).toEqual(['quarter', 'revenue']);
    expect(materialized.rowCount).toBe(2);

    // Exactly what the action passes: a digest derived from the bytes it just
    // read, never the upload row's declared digest.
    const derivedDigest = nodeslideContentDigest(new TextEncoder().encode(storedText));
    const attached = await t.run((ctx: MutationCtx) =>
      attachStoredDataSource(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        title: gate.fileName,
        format: 'csv',
        preview: materialized.preview,
        previewTruncated: materialized.truncated,
        contentDigest: derivedDigest,
        byteSize: gate.byteSize,
        rowCount: materialized.rowCount,
        columns: materialized.columns,
      }),
    );
    expect(attached.kind).toBe('source');

    const persisted = await t.run(async (ctx: QueryCtx) => ({
      source: await ctx.db
        .query('nodeslide_sources')
        .withIndex('by_stable_id', (index) => index.eq('id', attached.id))
        .unique(),
      revisions: await ctx.db
        .query('nodeslide_source_revisions')
        .withIndex('by_source_created', (index) => index.eq('sourceId', attached.id))
        .collect(),
    }));
    expect(persisted.source, 'materialization must create the source row').not.toBeNull();
    expect(persisted.source?.format).toBe('csv');
    expect(persisted.source?.license).toBe('User supplied');
    expect(persisted.source?.citation).toContain('quarter,revenue');
    expect(persisted.revisions, 'materialization must content-address a revision').toHaveLength(1);
    expect(persisted.revisions[0]?.contentDigest).toBe(derivedDigest);

    // The source is a preview, not a copy of the file: no storage id, no bytes.
    const serialized = JSON.stringify(persisted.source);
    expect(serialized).not.toContain('storageId');
    expect(serialized).not.toContain(gate.storageId);
  });

  it('re-materializing the same bytes reuses the revision instead of forking history', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const args = {
      deckId,
      ownerAccessKey: OWNER_ACCESS_KEY,
      title: 'figures.csv',
      format: 'csv' as const,
      preview: CSV,
      previewTruncated: false,
      contentDigest: digestOf(CSV),
      byteSize: 32,
      rowCount: 2,
      columns: ['quarter', 'revenue'],
    };
    const first = await t.run((ctx: MutationCtx) => attachStoredDataSource(ctx, args));
    const second = await t.run((ctx: MutationCtx) => attachStoredDataSource(ctx, args));
    expect(second.id).toBe(first.id);
    const revisions = await t.run((ctx: QueryCtx) =>
      ctx.db
        .query('nodeslide_source_revisions')
        .withIndex('by_source_created', (index) => index.eq('sourceId', first.id))
        .collect(),
    );
    expect(revisions).toHaveLength(1);
  });

  it('refuses a non-UTF-8 file rather than storing mojibake as evidence', async () => {
    expect(() =>
      uploadsModule.materializeNodeSlideStoredText(new Uint8Array([0xff, 0xfe, 0xfd]), 'csv'),
    ).toThrow(/valid UTF-8/i);
    expect(() =>
      uploadsModule.materializeNodeSlideStoredText(new TextEncoder().encode('{'), 'json'),
    ).toThrow(/malformed/i);
    expect(() =>
      uploadsModule.materializeNodeSlideStoredText(new TextEncoder().encode('   '), 'txt'),
    ).toThrow(/empty/i);
  });
});

describe('source monitoring is opt-in, owner-bound, and scheduled', () => {
  async function seedMonitorableSource(
    // biome-ignore lint/suspicious/noExplicitAny: convex-test instance type.
    t: any,
    deckId: string,
    url = 'https://example.com/quarterly',
  ) {
    const sourceId = 'source_monitored_scenario';
    await t.run((ctx: MutationCtx) =>
      ctx.db.insert('nodeslide_sources', {
        id: sourceId,
        deckId,
        title: 'Quarterly report',
        url,
        sourceType: 'url',
        retrievedAt: NOW,
        citation: 'Published quarterly figures.',
        format: 'web',
        contentDigest: digestOf('baseline'),
      }),
    );
    return sourceId;
  }

  it('schedules only an owner-authorized HTTPS source', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const sourceId = await seedMonitorableSource(t, deckId);

    const schedule = await t.run((ctx: MutationCtx) =>
      configureRefresh(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        sourceId,
        enabled: true,
        intervalMinutes: 60,
      }),
    );
    expect(schedule.enabled).toBe(true);
    expect(schedule.status).toBe('ready');

    const listed = await t.run((ctx: QueryCtx) =>
      listRefresh(ctx, { deckId, ownerAccessKey: OWNER_ACCESS_KEY }),
    );
    expect(listed.schedules).toHaveLength(1);
    // A different owner sees nothing, even though the deck id is the same.
    await expect(
      t.run((ctx: QueryCtx) => listRefresh(ctx, { deckId, ownerAccessKey: 'c'.repeat(43) })),
    ).rejects.toThrow(/access denied/i);
  });

  it('refuses plaintext, credentialed, and non-owned sources before any request is made', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));

    const insecure = await seedMonitorableSource(t, deckId, 'http://example.com/report');
    await expect(
      t.run((ctx: MutationCtx) =>
        configureRefresh(ctx, {
          deckId,
          ownerAccessKey: OWNER_ACCESS_KEY,
          sourceId: insecure,
          enabled: true,
          intervalMinutes: 60,
        }),
      ),
    ).rejects.toThrow(/credential-free HTTPS/i);

    await t.run((ctx: MutationCtx) =>
      ctx.db.insert('nodeslide_sources', {
        id: 'source_credentialed',
        deckId,
        title: 'Credentialed',
        url: 'https://user:pass@example.com/report',
        sourceType: 'url',
        retrievedAt: NOW,
        citation: 'x',
      }),
    );
    await expect(
      t.run((ctx: MutationCtx) =>
        configureRefresh(ctx, {
          deckId,
          ownerAccessKey: OWNER_ACCESS_KEY,
          sourceId: 'source_credentialed',
          enabled: true,
          intervalMinutes: 60,
        }),
      ),
    ).rejects.toThrow(/credential-free HTTPS/i);
  });

  /**
   * The monitored URL is handed to a third-party fetcher, so a private-range
   * target is refused at the moment the owner configures it rather than
   * failing silently every interval forever.
   */
  it('refuses to monitor a private-network address', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const privateUrls = [
      'https://127.0.0.1/report',
      'https://10.4.2.9/report',
      'https://192.168.1.1/report',
      'https://169.254.169.254/latest/meta-data/',
      'https://172.16.0.5/report',
      'https://localhost/report',
    ];
    for (const [index, url] of privateUrls.entries()) {
      const sourceId = `source_private_${index}`;
      await t.run((ctx: MutationCtx) =>
        ctx.db.insert('nodeslide_sources', {
          id: sourceId,
          deckId,
          title: 'Internal',
          url,
          sourceType: 'url',
          retrievedAt: NOW,
          citation: 'x',
        }),
      );
      await expect(
        t.run((ctx: MutationCtx) =>
          configureRefresh(ctx, {
            deckId,
            ownerAccessKey: OWNER_ACCESS_KEY,
            sourceId,
            enabled: true,
            intervalMinutes: 60,
          }),
        ),
        `${url} must not become a monitored source`,
      ).rejects.toThrow(/private network|credential-free HTTPS/i);
    }
    const schedules = await t.run((ctx: QueryCtx) =>
      ctx.db.query('nodeslide_source_refresh_schedules').collect(),
    );
    expect(schedules, 'no schedule row may survive a refused configuration').toHaveLength(0);
  });

  it('bounds the polling interval at both ends', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const sourceId = await seedMonitorableSource(t, deckId);
    for (const intervalMinutes of [1, 14, 8 * 24 * 60]) {
      await expect(
        t.run((ctx: MutationCtx) =>
          configureRefresh(ctx, {
            deckId,
            ownerAccessKey: OWNER_ACCESS_KEY,
            sourceId,
            enabled: true,
            intervalMinutes,
          }),
        ),
      ).rejects.toThrow(/15-10080 minutes/);
    }
  });

  it('claims a due schedule under a lease so two scans cannot run the same check', async () => {
    const t = convexTest(schema, modules);
    const deckId = await t.run((ctx) => seedDeck(ctx as MutationCtx));
    const sourceId = await seedMonitorableSource(t, deckId);
    await t.run((ctx: MutationCtx) =>
      configureRefresh(ctx, {
        deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        sourceId,
        enabled: true,
        intervalMinutes: 15,
      }),
    );

    const first = await t.run((ctx: MutationCtx) => scanDue(ctx, {}));
    expect(first.claimed).toBe(1);
    const claimed = await t.run((ctx: QueryCtx) =>
      ctx.db.query('nodeslide_source_refresh_schedules').first(),
    );
    expect(claimed?.status).toBe('checking');
    expect(claimed?.leaseId).toBeTruthy();

    // The lease is still live, so a second scan must not re-claim it.
    const second = await t.run((ctx: MutationCtx) => scanDue(ctx, {}));
    expect(second.claimed, 'a live lease must block a second claim').toBe(0);
  });

  /**
   * The wiring test for source monitoring. `scanDueInternal` is a mutation
   * nothing in the product calls except the cron: without this entry, every
   * schedule sits at `ready` forever and the feature is inert while all its
   * own unit tests still pass.
   */
  it('is actually driven by a cron, not merely defined', () => {
    const jobs = Object.values(
      (crons as unknown as { crons: Record<string, { name: string; args: unknown[] }> }).crons,
    );
    const scan = jobs.find((job) => job.name.endsWith('nodeslideSourceRefresh:scanDueInternal'));
    expect(scan, 'a cron must invoke nodeslideSourceRefresh:scanDueInternal').toBeDefined();
  });

  it('backs off instead of hammering a source that keeps failing', () => {
    const first = sourceRefreshModule.nodeSlideSourceRefreshBackoffMinutes(60, 1);
    const later = sourceRefreshModule.nodeSlideSourceRefreshBackoffMinutes(60, 5);
    expect(later).toBeGreaterThan(first);
    // Bounded: no failure count may push the next check past the maximum interval.
    expect(sourceRefreshModule.nodeSlideSourceRefreshBackoffMinutes(60, 999)).toBeLessThanOrEqual(
      7 * 24 * 60,
    );
    expect(sourceRefreshModule.nodeSlideSourceRefreshObservationKind('a', 'a')).toBe('unchanged');
    expect(sourceRefreshModule.nodeSlideSourceRefreshObservationKind('a', 'b')).toBe('changed');
  });
});
