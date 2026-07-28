/// <reference types="vite/client" />

/**
 * Scenario coverage for the whole-deck data-rights surface.
 *
 * The persona is an owner who has actually used the product: they created a
 * deck, ran the agent, took variations, commented, published, and invited an
 * approver. Then they ask for their data, and then they ask for it to be gone.
 *
 * The load-bearing property is not "the tests pass". It is that the expected
 * set is DERIVED from `convex/schema.ts`, so:
 *   - the seeder must populate every deck-owned table or the test names the
 *     table it missed (an unseeded table would make "nothing survives" vacuous);
 *   - the survival assertion covers every deck-owned table, including one added
 *     after this file was written.
 *
 * Everything runs against convex-test's in-memory instance. Nothing here can
 * reach a deployment.
 */

import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { insertNodeSlideSnapshot } from './lib/nodeslideData';
import { collectNodeSlideOwnerDataExport } from './lib/nodeslideDataExport';
import { takeNodeSlideScopedRows } from './lib/nodeslideDeckRows';
import type { NodeSlideErasureEntry, NodeSlideSchemaLike } from './lib/nodeslideErasureContract';
import { buildGoldenNodeSlide } from './lib/nodeslideSeed';
import {
  NODESLIDE_ERASURE_CONTRACT,
  deleteOwnedWorkspace,
  nodeSlideRetentionBindings,
} from './nodeslideRetention';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const OWNER_ACCESS_KEY = 'a'.repeat(43);
const NOW = 1_800_000_000_000;
const DIGEST = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

type DeleteHandler = (
  ctx: MutationCtx,
  args: { deckId: string; ownerAccessKey: string; cleanupTicket?: string },
) => Promise<{
  retentionSafe: boolean;
  deletedRowCount: number;
  deletedCounts: Record<string, number>;
  alreadyAbsent: boolean;
  cleanupTicket: string;
}>;

const deleteHandler = (deleteOwnedWorkspace as unknown as { _handler: DeleteHandler })._handler;

const deckScopedEntries: readonly NodeSlideErasureEntry[] = NODESLIDE_ERASURE_CONTRACT.filter(
  (entry) => entry.scope.kind === 'deckScoped',
);
const tenantScopedEntries: readonly NodeSlideErasureEntry[] = NODESLIDE_ERASURE_CONTRACT.filter(
  (entry) => entry.scope.kind === 'tenantScoped',
);

/**
 * Seeds one production-shaped workspace: not a minimal fixture, but a deck that
 * has been through creation, agent editing, review, variation, publication, and
 * approval.
 */
async function seedUsedWorkspace(ctx: MutationCtx, clientSessionId: string) {
  const built = buildGoldenNodeSlide(clientSessionId, NOW);
  const deckId = built.snapshot.deck.id;
  const projectId = built.snapshot.deck.projectId;
  const slide = built.snapshot.slides[0];
  const element = built.snapshot.elements[0];
  if (!slide || !element) throw new Error('Golden fixture must have a slide and an element.');

  const projectRowId = await ctx.db.insert('projects', {
    clientSessionId,
    title: built.snapshot.deck.title,
    domain: 'nodeslide',
    brief: built.snapshot.deck.brief,
    sourceType: 'prompt',
    starred: false,
    createdAt: NOW,
    updatedAt: NOW,
  });
  // deck + slides + elements + sources
  await insertNodeSlideSnapshot(ctx, {
    snapshot: built.snapshot,
    projectRowId,
    clientSessionId,
    ownerAccessKey: OWNER_ACCESS_KEY,
    plan: built.plan,
    spec: built.spec,
  });

  const patchId = 'patch_scenario';
  const runId = 'run_scenario';
  const traceId = 'trace_scenario';
  const batchId = 'batch_scenario';
  const variationId = 'variation_scenario';
  const validationId = 'validation_scenario';
  const approverId = 'approver_scenario';

  await ctx.db.insert('nodeslide_patches', {
    id: patchId,
    deckId,
    baseDeckVersion: built.snapshot.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: { [element.id]: element.version },
    scope: { kind: 'slide', deckId, slideIds: [slide.id], operationMode: 'copy' },
    operations: [],
    source: 'agent',
    status: 'accepted',
    summary: 'Tighten the opening claim',
    traceId,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await ctx.db.insert('nodeslide_variation_batches', {
    id: batchId,
    deckId,
    slideId: slide.id,
    requestedCount: 3,
    status: 'ready',
    origin: 'deterministic_fallback',
    variationIds: [variationId],
    elapsedMs: 812,
    acceptedVariationId: variationId,
    createdAt: NOW,
    completedAt: NOW,
  });
  await ctx.db.insert('nodeslide_variations', {
    schemaVersion: 'nodeslide.variation/v1',
    id: variationId,
    batchId,
    deckId,
    slideId: slide.id,
    baseDeckVersion: built.snapshot.deck.version,
    baseSlideVersion: slide.version,
    baseElementVersions: { [element.id]: element.version },
    axes: { contentAngle: 'data_led', density: 'executive', layoutArchetype: 'headline' },
    origin: 'deterministic_fallback',
    operations: [],
    candidate: { slide, elements: [element] },
    validation: {
      id: validationId,
      deckId,
      deckVersion: built.snapshot.deck.version,
      ok: true,
      publishOk: true,
      cleanOk: true,
      issues: [],
      checkedAt: NOW,
      toolchainVersion: built.snapshot.deck.toolchainVersion,
    },
    status: 'accepted',
    selectedPatchId: patchId,
    createdAt: NOW,
    decidedAt: NOW,
  });
  await ctx.db.insert('nodeslide_variation_decisions', {
    id: 'decision_scenario',
    eventName: 'variation_selected',
    deckId,
    slideId: slide.id,
    batchId,
    variationId,
    deckVersion: built.snapshot.deck.version,
    traceId,
    axes: { contentAngle: 'data_led', density: 'executive', layoutArchetype: 'headline' },
    origin: 'deterministic_fallback',
    selectedPatchId: patchId,
    createdAt: NOW,
  });
  await ctx.db.insert('nodeslide_comments', {
    id: 'comment_scenario',
    deckId,
    anchor: { type: 'slide', deckId, slideId: slide.id },
    authorId: 'author_scenario',
    authorName: 'Reviewer',
    text: 'Can we cite the survey directly here?',
    status: 'open',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await ctx.db.insert('nodeslide_versions', {
    id: 'version_scenario',
    deckId,
    version: built.snapshot.deck.version,
    label: 'Accepted agent edit',
    source: 'agent',
    patchId,
    snapshot: built.snapshot,
    createdAt: NOW,
  });
  await ctx.db.insert('nodeslide_package_receipts', {
    receiptId: 'receipt_scenario',
    deckId,
    patchId,
    principalId: 'principal_scenario',
    receipt: { ok: true },
    recordedAt: NOW,
  });
  await ctx.db.insert('nodeslide_package_submissions', {
    submissionId: 'submission_scenario',
    deckId,
    patchId,
    kind: 'proposal',
    commandDigest: DIGEST('1'),
    originReceiptId: 'receipt_scenario',
    submittedAt: NOW,
    resolutionDecision: 'accept',
    resolutionStatus: 'accepted',
    resolutionDeckVersion: built.snapshot.deck.version,
    resolvedAt: NOW,
  });
  await ctx.db.insert('nodeslide_package_assets', {
    assetId: 'asset_scenario',
    deckId,
    reference: { kind: 'image', name: 'chart.png' },
    bytes: new Uint8Array([1, 2, 3, 4]).buffer,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await ctx.db.insert('nodeslide_agent_runs', {
    id: runId,
    deckId,
    ownerDigest: `actor_${DIGEST('2')}`,
    idempotencyKey: 'idem_scenario',
    instruction: 'Sharpen the opening claim and cite the survey.',
    status: 'completed',
    provider: 'deterministic',
    model: 'deterministic-v1',
    webResearch: false,
    attempt: 1,
    patchId,
    traceId,
    createdAt: NOW,
    updatedAt: NOW,
    completedAt: NOW,
  });
  await ctx.db.insert('nodeslide_agent_messages', {
    id: 'message_scenario',
    deckId,
    runId,
    role: 'assistant',
    content: 'Proposed a tighter headline bound to the existing source.',
    createdAt: NOW,
  });
  await ctx.db.insert('nodeslide_agent_memories', {
    id: 'memory_scenario',
    deckId,
    category: 'preference',
    content: 'Prefer executive density on opening slides.',
    status: 'active',
    source: 'user',
    contentDigest: DIGEST('3'),
    createdAt: NOW,
    updatedAt: NOW,
    useCount: 2,
  });
  await ctx.db.insert('nodeslide_agent_spans', {
    id: 'span_scenario',
    deckId,
    runId,
    traceId,
    spanId: 'span_1',
    name: 'plan',
    operationName: 'agent.plan',
    kind: 'internal',
    status: 'ok',
    startTime: NOW,
    endTime: NOW + 40,
    durationMs: 40,
    attributes: [{ key: 'stage', value: 'plan' }],
    sequence: 1,
    createdAt: NOW,
    updatedAt: NOW,
  });
  await ctx.db.insert('nodeslide_agent_events', {
    id: 'event_scenario',
    deckId,
    runId,
    traceId,
    spanId: 'span_1',
    name: 'plan.completed',
    severity: 'info',
    timestamp: NOW,
    body: 'Plan produced one scoped operation.',
    attributes: [],
    sequence: 1,
  });
  await ctx.db.insert('nodeslide_validations', {
    id: validationId,
    deckId,
    deckVersion: built.snapshot.deck.version,
    ok: true,
    publishOk: true,
    cleanOk: true,
    issues: [],
    checkedAt: NOW,
    toolchainVersion: built.snapshot.deck.toolchainVersion,
  });
  await ctx.db.insert('nodeslide_traces', {
    id: traceId,
    deckId,
    patchId,
    status: 'completed',
    summary: 'Scoped edit with review',
    plan: ['read slide', 'propose edit'],
    context: ['Owner brief', 'Attached survey'],
    toolCalls: ['read_deck'],
    guardrails: ['scope:slide'],
    createdAt: NOW,
    completedAt: NOW,
  });
  await ctx.db.insert('nodeslide_execution_traces', {
    schemaVersion: 'nodeslide.execution-trace/v1',
    id: 'exec_scenario',
    deckId,
    actorDigest: DIGEST('4'),
    sessionId: 'session_scenario',
    cohort: 'control',
    kind: 'deck_repl',
    status: 'completed',
    terminalReason: 'completed',
    baseSnapshotDigest: DIGEST('5'),
    baseDeckVersion: built.snapshot.deck.version,
    adapterId: 'deterministic',
    adapterVersion: '1',
    egressMode: 'deny',
    allowedHosts: [],
    plan: ['inspect'],
    steps: [],
    guardrails: [],
    proposalDigests: [],
    budget: {
      maxSteps: 8,
      maxInputBytes: 1_000,
      maxOutputBytes: 1_000,
      maxOperations: 8,
      maxWallTimeMs: 5_000,
    },
    usage: { steps: 1, inputBytes: 10, outputBytes: 10, operations: 1, elapsedMs: 12 },
    cleanupConfirmed: true,
    traceDigest: DIGEST('6'),
    createdAt: NOW,
    completedAt: NOW,
    expiresAt: NOW + 86_400_000,
  });
  await ctx.db.insert('nodeslide_shadow_comparisons', {
    schemaVersion: 'nodeslide.shadow-comparison/v1',
    id: 'shadow_scenario',
    deckId,
    actorDigest: DIGEST('7'),
    turnId: 'turn_scenario',
    baselinePatchId: patchId,
    baselineTraceId: traceId,
    turnInputDigest: DIGEST('8'),
    baseSnapshotDigest: DIGEST('9'),
    baseDeckVersion: built.snapshot.deck.version,
    controlsDigest: DIGEST('a'),
    baseline: {
      adapterId: 'deterministic',
      adapterVersion: '1',
      outcome: 'proposed',
      terminalReason: 'completed',
      origin: 'deterministic_fallback',
      proposalDigest: DIGEST('b'),
      operationCount: 1,
      elapsedMs: 20,
    },
    candidate: {
      adapterId: 'shadow',
      adapterVersion: '1',
      outcome: 'skipped',
      terminalReason: 'not_attempted',
      operationCount: 0,
      elapsedMs: 0,
    },
    candidateExposed: false,
    candidateCommitted: false,
    comparisonDigest: DIGEST('c'),
    createdAt: NOW,
    completedAt: NOW,
    expiresAt: NOW + 86_400_000,
  });
  await ctx.db.insert('nodeslide_exports', {
    id: 'export_scenario',
    deckId,
    deckVersion: built.snapshot.deck.version,
    kind: 'pptx',
    status: 'ready',
    capabilityWarnings: [],
    fileName: 'scenario.pptx',
    createdAt: NOW,
  });
  await ctx.db.insert('nodeslide_publications', {
    id: 'publication_scenario',
    deckId,
    shareSlug: `share-${'d'.repeat(36)}`,
    revision: 1,
    deckVersion: built.snapshot.deck.version,
    validationId,
    status: 'active',
    snapshot: {
      deck: {
        schemaVersion: 'nodeslide.slidelang/v1',
        toolchainVersion: built.snapshot.deck.toolchainVersion,
        id: deckId,
        title: built.snapshot.deck.title,
        theme: built.snapshot.deck.theme,
        slideOrder: built.snapshot.deck.slideOrder,
        version: built.snapshot.deck.version,
        status: 'published',
        createdAt: NOW,
        updatedAt: NOW,
      },
      slides: built.snapshot.slides.map((entry) => ({
        id: entry.id,
        deckId,
        title: entry.title,
        background: entry.background,
        elementOrder: entry.elementOrder,
        version: entry.version,
      })),
      elements: built.snapshot.elements,
      sources: [],
    },
    publishedAt: NOW,
  });
  await ctx.db.insert('nodeslide_publish_approvers', {
    id: approverId,
    deckId,
    tokenDigest: DIGEST('e'),
    label: 'Legal review',
    issuedAt: NOW,
  });
  await ctx.db.insert('nodeslide_publish_approvals', {
    id: 'approval_scenario',
    deckId,
    deckVersion: built.snapshot.deck.version,
    validationId,
    approverId,
    approvedAt: NOW,
  });
  await ctx.db.insert('nodeslide_preference_events', {
    schemaVersion: 'nodeslide.preference/v1',
    id: 'preference_scenario',
    tenantId: projectId,
    actorId: 'actor_scenario',
    deckId,
    type: 'patch_accepted',
    scope: { kind: 'slide', deckId, slideId: slide.id },
    provenance: { deckVersion: built.snapshot.deck.version, patchId },
    attributes: {
      contentAngle: 'data_led',
      density: 'executive',
      layoutArchetype: 'headline',
    },
    occurredAt: NOW,
    recordedAt: NOW,
  });
  await ctx.db.insert('nodeslide_presence', {
    id: 'presence_scenario',
    deckId,
    sessionId: clientSessionId,
    displayName: 'Owner',
    color: '#3b82f6',
    slideId: slide.id,
    elementIds: [element.id],
    lastSeenAt: NOW,
    expiresAt: NOW + 60_000,
  });
  await ctx.db.insert('nodeslide_signature_profiles', {
    id: 'signature_scenario',
    tenantId: projectId,
    profileId: 'profile_scenario',
    sourceDigest: DIGEST('f'),
    sourceKind: 'pptx',
    name: 'House style',
    confidence: 'high',
    warningCount: 0,
    profileJson: '{"palette":["#101828"]}',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await ctx.db.insert('nodeslide_taste_profiles', {
    schemaVersion: 'nodeslide.preference/v1',
    id: 'taste_scenario',
    tenantId: projectId,
    actorId: 'actor_scenario',
    signals: [],
    updatedAt: NOW,
  });
  // A deck that was connected to Google Slides: one abandoned authorization,
  // one live grant, and the server-side sync baseline. These are the rows a
  // "delete everything" request is most likely to be about, so the erasure
  // scenario has to be seeded with them or it proves nothing about them.
  await ctx.db.insert('nodeslide_oauth_sessions', {
    stateDigest: DIGEST('g'),
    deckId,
    provider: 'google_slides',
    codeVerifierCiphertext: 'v1:scenario-code-verifier-ciphertext',
    returnTo: 'https://nodeslide.example/deck',
    expiresAt: NOW + 600_000,
    createdAt: NOW,
  });
  await ctx.db.insert('nodeslide_oauth_credentials', {
    deckId,
    provider: 'google_slides',
    accessTokenCiphertext: 'v1:scenario-access-token-ciphertext',
    refreshTokenCiphertext: 'v1:scenario-refresh-token-ciphertext',
    accessTokenExpiresAt: NOW + 3_600_000,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
    tokenType: 'Bearer',
    createdAt: NOW,
    updatedAt: NOW,
  });
  await ctx.db.insert('nodeslide_google_sync_states', {
    id: 'google_sync_scenario',
    deckId,
    remotePresentationId: 'presentation_scenario',
    status: 'active',
    stateVersion: 1,
    baselineJson: '{"slides":[]}',
    baselineDigest: DIGEST('h'),
    baselineRemoteRevision: 'revision_scenario',
    createdAt: NOW,
    updatedAt: NOW,
  });

  return { deckId, projectId, projectRowId, deckTitle: built.snapshot.deck.title, built };
}

async function scopedRowCounts(
  ctx: QueryCtx,
  entries: readonly NodeSlideErasureEntry[],
  value: string,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    const rows = await takeNodeSlideScopedRows(ctx, entry, value, 50);
    counts[entry.table] = rows.length;
  }
  return counts;
}

describe('whole-deck erasure, seeded from a deck that was actually used', () => {
  it('destroys every deck-owned table the schema declares, and leaves nothing behind', async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedUsedWorkspace(ctx as MutationCtx, 'scenario-owner'));

    // Arm the sensor first. If the fixture skipped a table, the survival
    // assertion below would pass over an empty table and prove nothing — so
    // name the unseeded tables instead of quietly succeeding.
    const before = await t.run((ctx) =>
      scopedRowCounts(ctx as QueryCtx, deckScopedEntries, seeded.deckId),
    );
    const unseeded = Object.entries(before)
      .filter(([, count]) => count === 0)
      .map(([table]) => table);
    expect(
      unseeded,
      'every deck-owned table must carry seeded rows before the erasure is meaningful',
    ).toEqual([]);
    const beforeTenant = await t.run((ctx) =>
      scopedRowCounts(ctx as QueryCtx, tenantScopedEntries, seeded.projectId),
    );
    expect(Object.values(beforeTenant).every((count) => count > 0)).toBe(true);

    const receipt = await t.run((ctx) =>
      deleteHandler(ctx as MutationCtx, {
        deckId: seeded.deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    );
    expect(receipt.retentionSafe).toBe(true);
    expect(receipt.alreadyAbsent).toBe(false);

    // The receipt must account for every table that had rows, by its own label.
    const expectedLabels = NODESLIDE_ERASURE_CONTRACT.map((entry) => entry.label).sort();
    expect(Object.keys(receipt.deletedCounts).sort()).toEqual(expectedLabels);
    expect(receipt.deletedRowCount).toBe(
      Object.values(receipt.deletedCounts).reduce((total, count) => total + count, 0),
    );

    const after = await t.run((ctx) =>
      scopedRowCounts(ctx as QueryCtx, deckScopedEntries, seeded.deckId),
    );
    const survivors = Object.entries(after)
      .filter(([, count]) => count > 0)
      .map(([table]) => table);
    expect(survivors, 'no deck-owned row may survive the erasure').toEqual([]);

    const afterTenant = await t.run((ctx) =>
      scopedRowCounts(ctx as QueryCtx, tenantScopedEntries, seeded.projectId),
    );
    expect(Object.values(afterTenant).every((count) => count === 0)).toBe(true);

    const anchors = await t.run(async (ctx) => ({
      deck: await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', seeded.deckId))
        .first(),
      project: await ctx.db.get(seeded.projectRowId),
      tombstones: await ctx.db.query('nodeslide_retention_tombstones').collect(),
    }));
    expect(anchors.deck).toBeNull();
    expect(anchors.project).toBeNull();
    // The tombstone is the one deliberate survivor, and it is content-free.
    expect(anchors.tombstones).toHaveLength(1);
    expect(JSON.stringify(anchors.tombstones)).not.toContain(seeded.deckId);
    expect(JSON.stringify(anchors.tombstones)).not.toContain(OWNER_ACCESS_KEY);
  });

  it('refuses a deck that never existed, and says nothing about whether it did', async () => {
    const t = convexTest(schema, modules);
    const bindings = nodeSlideRetentionBindings('deck_never_existed', OWNER_ACCESS_KEY);
    await expect(
      t.run((ctx) =>
        deleteHandler(ctx as MutationCtx, {
          deckId: 'deck_never_existed',
          ownerAccessKey: OWNER_ACCESS_KEY,
          cleanupTicket: bindings.cleanupTicket,
        }),
      ),
    ).rejects.toThrow(/owner access denied/i);
    expect(await t.run((ctx) => ctx.db.query('nodeslide_retention_tombstones').collect())).toEqual(
      [],
    );
  });

  it('is idempotent for the holder of the cleanup ticket and closed to everyone else', async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedUsedWorkspace(ctx as MutationCtx, 'twice-owner'));

    const first = await t.run((ctx) =>
      deleteHandler(ctx as MutationCtx, {
        deckId: seeded.deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    );
    expect(first.deletedRowCount).toBeGreaterThan(0);

    // Without the ticket, a second delete is indistinguishable from a probe.
    await expect(
      t.run((ctx) =>
        deleteHandler(ctx as MutationCtx, {
          deckId: seeded.deckId,
          ownerAccessKey: OWNER_ACCESS_KEY,
        }),
      ),
    ).rejects.toThrow(/owner access denied/i);

    const second = await t.run((ctx) =>
      deleteHandler(ctx as MutationCtx, {
        deckId: seeded.deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
        cleanupTicket: first.cleanupTicket,
      }),
    );
    expect(second).toMatchObject({ alreadyAbsent: true, deletedRowCount: 0, retentionSafe: true });
    expect(
      await t.run((ctx) => ctx.db.query('nodeslide_retention_tombstones').collect()),
    ).toHaveLength(1);
  });

  it('erases a deck with no slides and no activity at all', async () => {
    const t = convexTest(schema, modules);
    const built = buildGoldenNodeSlide('empty-owner', NOW);
    const deckId = built.snapshot.deck.id;
    const projectRowId = await t.run(async (ctx) => {
      const rowId = await ctx.db.insert('projects', {
        clientSessionId: 'empty-owner',
        title: built.snapshot.deck.title,
        domain: 'nodeslide',
        sourceType: 'prompt',
        starred: false,
        createdAt: NOW,
        updatedAt: NOW,
      });
      await insertNodeSlideSnapshot(ctx as MutationCtx, {
        snapshot: { ...built.snapshot, slides: [], elements: [], sources: [] },
        projectRowId: rowId,
        clientSessionId: 'empty-owner',
        ownerAccessKey: OWNER_ACCESS_KEY,
        plan: built.plan,
        spec: built.spec,
      });
      return rowId;
    });

    const receipt = await t.run((ctx) =>
      deleteHandler(ctx as MutationCtx, { deckId, ownerAccessKey: OWNER_ACCESS_KEY }),
    );
    expect(receipt.retentionSafe).toBe(true);
    // Only the two anchors had rows; nothing is invented to pad the receipt.
    expect(Object.keys(receipt.deletedCounts).sort()).toEqual(['deck', 'project']);
    expect(await t.run((ctx) => ctx.db.get(projectRowId))).toBeNull();
  });
});

describe('owner data export', () => {
  it('hands back one record per deck-owned row and names what it withholds', async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedUsedWorkspace(ctx as MutationCtx, 'export-owner'));

    const bundle = await t.run(async (ctx) => {
      const deck = await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', seeded.deckId))
        .unique();
      if (!deck) throw new Error('seeded deck missing');
      return await collectNodeSlideOwnerDataExport(ctx as QueryCtx, {
        deck,
        ownerAccessKey: OWNER_ACCESS_KEY,
        generatedAt: NOW,
        contract: NODESLIDE_ERASURE_CONTRACT,
        schema: schema as unknown as NodeSlideSchemaLike,
      });
    });

    expect(bundle.manifest.scope).toEqual({
      kind: 'deck_owner_capability',
      deckId: seeded.deckId,
      deckVersion: seeded.built.snapshot.deck.version,
    });
    expect(bundle.manifest.completeness).toMatchObject({ status: 'complete', truncated: false });

    // The bundle covers exactly the erasure contract minus the tenant-scoped
    // tables, and every included collection is non-empty for this seed.
    const includedTables = NODESLIDE_ERASURE_CONTRACT.filter(
      (entry) => entry.scope.kind !== 'tenantScoped',
    ).map((entry) => entry.table);
    expect(bundle.manifest.collections.map((entry) => entry.table)).toEqual(includedTables);
    const emptyCollections = bundle.manifest.collections
      .filter((entry) => entry.recordCount === 0)
      .map((entry) => entry.path);
    expect(emptyCollections).toEqual([]);
    expect(bundle.manifest.completeness.recordCount).toBe(
      bundle.manifest.collections.reduce((total, entry) => total + entry.recordCount, 0),
    );

    // Withheld tables are stated, not silently dropped.
    const withheld = bundle.manifest.omissions.collections.map((entry) => entry.name).sort();
    expect(withheld).toEqual(
      [
        ...tenantScopedEntries.map((entry) => entry.table),
        'nodeslide_rate_limits',
        'nodeslide_retention_tombstones',
      ].sort(),
    );
    for (const omission of bundle.manifest.omissions.collections) {
      expect(omission.detail.length).toBeGreaterThan(20);
      expect(bundle.data[omission.name]).toBeUndefined();
    }

    // Binary columns are named individually, and their bytes are not present.
    expect(bundle.manifest.omissions.fields.map((entry) => entry.name)).toContain(
      'nodeslide_package_assets.bytes',
    );
    expect(JSON.stringify(bundle.data['packageAssets'])).not.toContain('bytes');
    expect(bundle.manifest.omissions.removedFieldCount).toBeGreaterThan(0);
  });

  it('never returns the owner capability or any owner digest', async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedUsedWorkspace(ctx as MutationCtx, 'redaction-owner'));

    const bundle = await t.run(async (ctx) => {
      const deck = await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', seeded.deckId))
        .unique();
      if (!deck) throw new Error('seeded deck missing');
      return await collectNodeSlideOwnerDataExport(ctx as QueryCtx, {
        deck,
        ownerAccessKey: OWNER_ACCESS_KEY,
        generatedAt: NOW,
        contract: NODESLIDE_ERASURE_CONTRACT,
        schema: schema as unknown as NodeSlideSchemaLike,
      });
    });

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain(OWNER_ACCESS_KEY);
    expect(serialized).not.toContain('ownerAccessKey');
    expect(serialized).not.toContain('ownerDigest');
    expect(serialized).not.toContain('tokenDigest');
    expect(serialized).not.toContain('clientSessionId');
    // The deck id itself is the scope and must stay, or the bundle is unusable.
    expect(serialized).toContain(seeded.deckId);

    // The Google grant is deck-owned, so it is in the export's scope — but the
    // token material is not the owner's to receive back in plaintext, and an
    // export bundle is a file that gets emailed around. The redaction rule is
    // the `*Ciphertext` suffix, so this asserts the outcome rather than the rule.
    expect(serialized).not.toContain('scenario-access-token-ciphertext');
    expect(serialized).not.toContain('scenario-refresh-token-ciphertext');
    expect(serialized).not.toContain('scenario-code-verifier-ciphertext');
    // The row itself is still reported, so the owner learns the grant exists.
    expect(bundle.data['oauthCredentials']).toHaveLength(1);
    expect(JSON.stringify(bundle.data['oauthCredentials'])).toContain(
      'https://www.googleapis.com/auth/drive.file',
    );
  });

  it('exports what the erasure would destroy: the two lists agree by construction', async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run((ctx) => seedUsedWorkspace(ctx as MutationCtx, 'symmetry-owner'));

    const bundle = await t.run(async (ctx) => {
      const deck = await ctx.db
        .query('nodeslide_decks')
        .withIndex('by_stable_id', (index) => index.eq('id', seeded.deckId))
        .unique();
      if (!deck) throw new Error('seeded deck missing');
      return await collectNodeSlideOwnerDataExport(ctx as QueryCtx, {
        deck,
        ownerAccessKey: OWNER_ACCESS_KEY,
        generatedAt: NOW,
        contract: NODESLIDE_ERASURE_CONTRACT,
        schema: schema as unknown as NodeSlideSchemaLike,
      });
    });
    const receipt = await t.run((ctx) =>
      deleteHandler(ctx as MutationCtx, {
        deckId: seeded.deckId,
        ownerAccessKey: OWNER_ACCESS_KEY,
      }),
    );

    const exported = new Set(bundle.manifest.collections.map((entry) => entry.path));
    const erased = new Set(Object.keys(receipt.deletedCounts));
    const erasedButNotExported = [...erased].filter((label) => !exported.has(label)).sort();
    expect(erasedButNotExported).toEqual(tenantScopedEntries.map((entry) => entry.label).sort());
    expect([...exported].filter((label) => !erased.has(label))).toEqual([]);

    // Row counts agree for every collection present in both.
    for (const entry of bundle.manifest.collections) {
      expect(receipt.deletedCounts[entry.path]).toBe(entry.recordCount);
    }
  });
});
