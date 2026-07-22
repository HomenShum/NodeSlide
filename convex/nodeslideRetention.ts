import { v } from 'convex/values';
import type { Doc, Id, TableNames } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation, mutation } from './_generated/server';
import { isOwnerAccessKey, requireOwnerAccess } from './lib/nodeslideAccess';
import { findDeckRow } from './lib/nodeslideData';
import { nodeslideContentDigest } from './lib/nodeslideIds';
import {
  isNodeSlideProductionProbeCleanupToken,
  nodeSlideProductionProbeFields,
} from './lib/nodeslideProductionProbe';

const RETENTION_RECEIPT_SCHEMA = 'nodeslide.workspace-retention-receipt/v1' as const;
const RETENTION_TOMBSTONE_SCHEMA = 'nodeslide.retention-tombstone/v1' as const;
const RETENTION_TARGET_BINDING_DOMAIN = 'nodeslide.retention-target/v1';
const RETENTION_PRINCIPAL_BINDING_DOMAIN = 'nodeslide.retention-principal/v1';
const RETENTION_TICKET_DOMAIN = 'nodeslide.retention-ticket/v1';

type DeletedCounts = Record<string, number>;

/**
 * Permanently removes one owner-authorized workspace and every row whose
 * payload can retain deck, source, prompt, trace, export, or snapshot data.
 * The mutation is intentionally transactional: a red response cannot certify
 * partial cleanup, and the returned receipt contains no stable IDs or bearer
 * capabilities.
 */
export const deleteOwnedWorkspace = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    cleanupTicket: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (
      args.deckId.length === 0 ||
      args.deckId.length > 256 ||
      !isOwnerAccessKey(args.ownerAccessKey)
    ) {
      throw new Error('NodeSlide owner access denied.');
    }
    const bindings = nodeSlideRetentionBindings(args.deckId, args.ownerAccessKey);
    if (args.cleanupTicket !== undefined && args.cleanupTicket !== bindings.cleanupTicket) {
      throw new Error('NodeSlide owner access denied.');
    }
    const existing = await findDeckRow(ctx, args.deckId);
    const tombstone = await ctx.db
      .query('nodeslide_retention_tombstones')
      .withIndex('by_target_binding', (index) =>
        index.eq('targetBindingDigest', bindings.targetBindingDigest),
      )
      .first();
    const retainedRows = await countDeckRows(ctx, args.deckId);
    let authorizedDeck: Doc<'nodeslide_decks'> | null = null;
    try {
      authorizedDeck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    } catch {
      // Existing-wrong-owner and never-existing targets deliberately converge
      // on the same denial below, after the same bounded lookup sequence.
    }
    if (!existing) {
      if (
        retainedRows !== 0 ||
        !args.cleanupTicket ||
        !tombstone ||
        tombstone.schemaVersion !== RETENTION_TOMBSTONE_SCHEMA ||
        tombstone.principalBindingDigest !== bindings.principalBindingDigest ||
        tombstone.cleanupTicketDigest !== nodeslideContentDigest(bindings.cleanupTicket)
      ) {
        throw new Error('NodeSlide owner access denied.');
      }
      return retentionReceipt({}, true, bindings);
    }
    if (!authorizedDeck || authorizedDeck._id !== existing._id || tombstone) {
      throw new Error('NodeSlide owner access denied.');
    }
    const counts = await deleteWorkspaceRows(ctx, authorizedDeck);
    const remainingRows = await countDeckRows(ctx, authorizedDeck.id);
    const project = await ctx.db.get(authorizedDeck.projectRowId);
    if (remainingRows !== 0 || project !== null) {
      throw new Error('NodeSlide workspace retention cleanup did not reach zero rows.');
    }
    await ctx.db.insert('nodeslide_retention_tombstones', {
      schemaVersion: RETENTION_TOMBSTONE_SCHEMA,
      targetBindingDigest: bindings.targetBindingDigest,
      principalBindingDigest: bindings.principalBindingDigest,
      cleanupTicketDigest: nodeslideContentDigest(bindings.cleanupTicket),
      createdAt: Date.now(),
    });
    return retentionReceipt(counts, false, bindings);
  },
});

/**
 * Deletes a synthetic production probe even when the browser lost the action
 * response before it learned the deck id or owner capability. Only rows
 * created with the same one-use token digest are reachable.
 */
export const deleteProductionProbeWorkspace = mutation({
  args: { clientSessionId: v.string(), cleanupToken: v.string() },
  handler: async (ctx, args) => {
    if (
      args.clientSessionId.length === 0 ||
      args.clientSessionId.length > 256 ||
      !isNodeSlideProductionProbeCleanupToken(args.cleanupToken)
    ) {
      throw new Error('NodeSlide production probe cleanup denied.');
    }
    const { productionProbeCleanupDigest } = nodeSlideProductionProbeFields(
      args.cleanupToken,
      Date.now(),
    );
    const rows = await ctx.db
      .query('nodeslide_decks')
      .withIndex('by_production_probe_cleanup', (index) =>
        index.eq('productionProbeCleanupDigest', productionProbeCleanupDigest),
      )
      .take(2);
    if (rows.length === 0) return productionProbeReceipt({}, true, productionProbeCleanupDigest);
    const deck = rows[0];
    if (
      rows.length !== 1 ||
      !deck ||
      deck.clientSessionId !== args.clientSessionId ||
      deck.productionProbeExpiresAt === undefined
    ) {
      throw new Error('NodeSlide production probe cleanup denied.');
    }
    const counts = await deleteWorkspaceRows(ctx, deck);
    const remainingRows = await countDeckRows(ctx, deck.id);
    const project = await ctx.db.get(deck.projectRowId);
    if (remainingRows !== 0 || project !== null) {
      throw new Error('NodeSlide production probe retention cleanup did not reach zero rows.');
    }
    return productionProbeReceipt(counts, false, productionProbeCleanupDigest);
  },
});

/** Backstop for a runner crash before its finally block can call the cleanup mutation. */
export const deleteExpiredProductionProbeWorkspaces = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const rows = await ctx.db
      .query('nodeslide_decks')
      .withIndex('by_production_probe_expiry', (index) =>
        index.gt('productionProbeExpiresAt', 0).lt('productionProbeExpiresAt', now),
      )
      .take(10);
    let deletedWorkspaceCount = 0;
    let deletedRowCount = 0;
    for (const deck of rows) {
      if (!deck.productionProbeCleanupDigest) continue;
      const counts = await deleteWorkspaceRows(ctx, deck);
      const remainingRows = await countDeckRows(ctx, deck.id);
      const project = await ctx.db.get(deck.projectRowId);
      if (remainingRows !== 0 || project !== null) {
        throw new Error('Expired NodeSlide production probe cleanup did not reach zero rows.');
      }
      deletedWorkspaceCount += 1;
      deletedRowCount += Object.values(counts).reduce((sum, count) => sum + count, 0);
    }
    return { deletedWorkspaceCount, deletedRowCount, scannedAt: now };
  },
});

async function deleteWorkspaceRows(
  ctx: MutationCtx,
  deck: Doc<'nodeslide_decks'>,
): Promise<DeletedCounts> {
  const counts: DeletedCounts = {};
  const projectDecks = await ctx.db
    .query('nodeslide_decks')
    .withIndex('by_project_row', (index) => index.eq('projectRowId', deck.projectRowId))
    .take(2);
  if (projectDecks.length !== 1 || projectDecks[0]?._id !== deck._id) {
    throw new Error('NodeSlide project retention scope is not one workspace.');
  }
  await deleteRows(
    ctx,
    'slides',
    await ctx.db
      .query('nodeslide_slides')
      .withIndex('by_deck', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'elements',
    await ctx.db
      .query('nodeslide_elements')
      .withIndex('by_deck', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'patches',
    await ctx.db
      .query('nodeslide_patches')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'variationBatches',
    await ctx.db
      .query('nodeslide_variation_batches')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'variations',
    await ctx.db
      .query('nodeslide_variations')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'variationDecisions',
    await ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'comments',
    await ctx.db
      .query('nodeslide_comments')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'versions',
    await ctx.db
      .query('nodeslide_versions')
      .withIndex('by_deck_version', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'packageReceipts',
    await ctx.db
      .query('nodeslide_package_receipts')
      .withIndex('by_deck_recorded', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'packageSubmissions',
    await ctx.db
      .query('nodeslide_package_submissions')
      .withIndex('by_deck_patch', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'packageAssets',
    await ctx.db
      .query('nodeslide_package_assets')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'sources',
    await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_deck', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'agentRuns',
    await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'agentMessages',
    await ctx.db
      .query('nodeslide_agent_messages')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'agentMemories',
    await ctx.db
      .query('nodeslide_agent_memories')
      .withIndex('by_deck_updated', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'agentSpans',
    await ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'agentEvents',
    await ctx.db
      .query('nodeslide_agent_events')
      .withIndex('by_deck_timestamp', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'validations',
    await ctx.db
      .query('nodeslide_validations')
      .withIndex('by_deck_checked', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'traces',
    await ctx.db
      .query('nodeslide_traces')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'executionTraces',
    await ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'shadowComparisons',
    await ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'exports',
    await ctx.db
      .query('nodeslide_exports')
      .withIndex('by_deck_created', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'publications',
    await ctx.db
      .query('nodeslide_publications')
      .withIndex('by_deck_revision', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'publishApprovers',
    await ctx.db
      .query('nodeslide_publish_approvers')
      .withIndex('by_deck', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'publishApprovals',
    await ctx.db
      .query('nodeslide_publish_approvals')
      .withIndex('by_deck_version', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'preferenceEvents',
    await ctx.db
      .query('nodeslide_preference_events')
      .withIndex('by_deck_recorded', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'presence',
    await ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', deck.id))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'signatureProfiles',
    await ctx.db
      .query('nodeslide_signature_profiles')
      .withIndex('by_tenant_updated', (index) => index.eq('tenantId', deck.projectId))
      .collect(),
    counts,
  );
  await deleteRows(
    ctx,
    'tasteProfiles',
    await ctx.db
      .query('nodeslide_taste_profiles')
      .withIndex('by_tenant_actor', (index) => index.eq('tenantId', deck.projectId))
      .collect(),
    counts,
  );
  const retainedTenantRows = await Promise.all([
    ctx.db
      .query('nodeslide_signature_profiles')
      .withIndex('by_tenant_updated', (index) => index.eq('tenantId', deck.projectId))
      .take(1),
    ctx.db
      .query('nodeslide_taste_profiles')
      .withIndex('by_tenant_actor', (index) => index.eq('tenantId', deck.projectId))
      .take(1),
  ]);
  if (retainedTenantRows.some((rows) => rows.length !== 0)) {
    throw new Error('NodeSlide workspace retention left project-scoped profile rows.');
  }
  await ctx.db.delete(deck._id);
  counts['deck'] = 1;
  await ctx.db.delete(deck.projectRowId);
  counts['project'] = 1;
  return counts;
}

async function deleteRows<TableName extends TableNames>(
  ctx: MutationCtx,
  label: string,
  rows: ReadonlyArray<{ _id: Id<TableName> }>,
  counts: DeletedCounts,
): Promise<void> {
  for (const row of rows) await ctx.db.delete(row._id);
  if (rows.length > 0) counts[label] = rows.length;
}

async function countDeckRows(ctx: MutationCtx, deckId: string): Promise<number> {
  const rows = await Promise.all([
    ctx.db
      .query('nodeslide_decks')
      .withIndex('by_stable_id', (q) => q.eq('id', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_slides')
      .withIndex('by_deck', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_elements')
      .withIndex('by_deck', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_patches')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_variation_batches')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_variations')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_comments')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_versions')
      .withIndex('by_deck_version', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_package_receipts')
      .withIndex('by_deck_recorded', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_package_submissions')
      .withIndex('by_deck_patch', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_package_assets')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_sources')
      .withIndex('by_deck', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_agent_messages')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_agent_memories')
      .withIndex('by_deck_updated', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_agent_events')
      .withIndex('by_deck_timestamp', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_validations')
      .withIndex('by_deck_checked', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_traces')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_exports')
      .withIndex('by_deck_created', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_publications')
      .withIndex('by_deck_revision', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_publish_approvers')
      .withIndex('by_deck', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_publish_approvals')
      .withIndex('by_deck_version', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_preference_events')
      .withIndex('by_deck_recorded', (q) => q.eq('deckId', deckId))
      .take(1),
    ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_expiry', (q) => q.eq('deckId', deckId))
      .take(1),
  ]);
  return rows.reduce((total, found) => total + found.length, 0);
}

export function nodeSlideRetentionBindings(deckId: string, ownerAccessKey: string) {
  const targetBindingDigest = nodeslideContentDigest(
    [RETENTION_TARGET_BINDING_DOMAIN, deckId].join('\u001f'),
  );
  const principalBindingDigest = nodeslideContentDigest(
    [RETENTION_PRINCIPAL_BINDING_DOMAIN, ownerAccessKey].join('\u001f'),
  );
  const cleanupTicket = nodeslideContentDigest(
    [RETENTION_TICKET_DOMAIN, targetBindingDigest, principalBindingDigest].join('\u001f'),
  );
  return { targetBindingDigest, principalBindingDigest, cleanupTicket };
}

function retentionReceipt(
  counts: DeletedCounts,
  alreadyAbsent: boolean,
  bindings: ReturnType<typeof nodeSlideRetentionBindings>,
) {
  const deletedRowCount = Object.values(counts).reduce((total, count) => total + count, 0);
  const body = {
    schemaVersion: RETENTION_RECEIPT_SCHEMA,
    status: 'passed' as const,
    retentionSafe: true,
    remainingDeckRows: 0,
    remainingSourceRows: 0,
    deletedRowCount,
    deletedCounts: counts,
    alreadyAbsent,
    targetBindingDigest: bindings.targetBindingDigest,
    principalBindingDigest: bindings.principalBindingDigest,
    cleanupTicket: bindings.cleanupTicket,
  };
  return {
    ...body,
    receiptDigest: nodeslideContentDigest(canonicalJson(body)),
  };
}

function productionProbeReceipt(
  counts: DeletedCounts,
  alreadyAbsent: boolean,
  cleanupBindingDigest: string,
) {
  const deletedRowCount = Object.values(counts).reduce((total, count) => total + count, 0);
  const body = {
    schemaVersion: 'nodeslide.production-probe-retention-receipt/v1' as const,
    status: 'passed' as const,
    retentionSafe: true,
    remainingDeckRows: 0,
    remainingSourceRows: 0,
    deletedRowCount,
    deletedCounts: counts,
    alreadyAbsent,
    cleanupBindingDigest,
  };
  return { ...body, receiptDigest: nodeslideContentDigest(canonicalJson(body)) };
}

/**
 * Convex may serialize object keys in a different order than the server used
 * when it constructed a receipt. Bind the digest to the value, not incidental
 * insertion order, so every runtime verifies the same bytes.
 */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}
