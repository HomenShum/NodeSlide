import { v } from 'convex/values';
import {
  NODESLIDE_PERMISSIONS,
  type NodeSlidePrincipal,
  type NodeSlideProposalResolution,
  type NodeSlideReceipt,
  type NodeSlideRepositoryAuthorizationAction,
  type NodeSlideRepositoryAuthorizationRequest,
  createNodeSlideAuthorizationReceipt,
} from '../packages/backend/src/index';
import {
  type CandidateValidationReceipt,
  type CommentAnchor,
  type DeckComment,
  type DeckPatch,
  type DeckSnapshot,
  NODESLIDE_DESIGN_BEHAVIORS,
  NODESLIDE_DESIGN_BEHAVIOR_POLICY_VERSION,
  NODESLIDE_EDITOR_CAPABILITY_VERSION,
  NODESLIDE_LAYER_OPERATION_VERSION,
  NODESLIDE_PATCH_OPERATION_LIMIT,
  NODESLIDE_REFERENCE_USE_POLICIES,
  type NodeSlideWorkspace,
  type PatchOperation,
  type PatchScope,
  type PatchSource,
  type ValidationResult,
  clampNormalized,
} from '../shared/nodeslide';
import { normalizeWebSourceExcerpt } from '../shared/nodeslideEvidence';
import { applyDeckPatch } from '../shared/nodeslidePatch';
import type { SlideVariation } from '../shared/nodeslideVariation';
import { internal } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import { internalMutation, internalQuery, mutation, query } from './_generated/server';
import {
  createOwnerAccessKey,
  createShareSlug,
  isOwnerAccessKey,
  requireOwnerAccess,
  requireShareSlug,
} from './lib/nodeslideAccess';
import { summarizeNodeSlideExecutionTraces } from './lib/nodeslideAgenticTelemetry';
import { NODESLIDE_ASSISTANT_STREAM_CONTENT_LIMIT } from './lib/nodeslideAssistantStream';
import {
  candidateValidationBindingMatches,
  candidateValidationReceipt,
  materializeNodeSlideCandidate,
  nodeSlideCandidateDigest,
  nodeSlideCandidateValidationId,
  validationFromCandidateReceipt,
} from './lib/nodeslideCandidate';
import {
  NODESLIDE_WORKSPACE_LIMITS,
  commentFromRow,
  deckFromRow,
  findCommentRow,
  findCurrentValidationRow,
  findDeckRow,
  findLatestPublicationByShareSlug,
  findLatestPublicationForDeck,
  findPatchRow,
  findVersionRow,
  insertNodeSlideSnapshot,
  loadNodeSlideSnapshot,
  loadNodeSlideWorkspace,
  patchFromRow,
  presenceFromRow,
  publicationFromRow,
  publishedNodeSlideFromRow,
  sanitizeNodeSlideSnapshot,
  writeNodeSlideSnapshot,
} from './lib/nodeslideData';
import {
  NODESLIDE_DATA_ATTACHMENT_MAX_BYTES,
  nodeSlideDataAttachmentShape,
  normalizeNodeSlideDataAttachment,
} from './lib/nodeslideDataAttachment';
import {
  NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK,
  type NodeSlideExecutionTrace,
  assertExecutionTraceBounds,
  executionTraceRetentionPlan,
} from './lib/nodeslideExecutionTrace';
import { nodeslideExecutionTraceValidator } from './lib/nodeslideExecutionTraceValidator';
import {
  nodeslideContentDigest,
  nodeslideEventId,
  nodeslideHash,
  nodeslideIdDigest,
  nodeslideStableId,
} from './lib/nodeslideIds';
import {
  type NodeSlidePatchInput,
  clocksForNodeSlideOperations,
  evaluateNodeSlideCas,
  validateNodeSlidePatch,
} from './lib/nodeslidePatches';
import { planNodeSlidePropagation } from './lib/nodeslidePropagation';
import {
  NODESLIDE_APPROVER_ROW_LIMIT,
  decideNodeSlidePublishApproval,
  selectAuthorizingApproval,
} from './lib/nodeslidePublishApprovalPolicy';
import { NodeSlidePreviewQuotaError, consumePreviewQuotaBuckets } from './lib/nodeslideQuota';
import {
  buildBriefNodeSlide,
  buildGoldenNodeSlide,
  repairLegacyGoldenSnapshot,
} from './lib/nodeslideSeed';
import {
  NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK,
  type NodeSlideShadowComparison,
  assertNodeSlideShadowComparisonBaselineBinding,
  assertNodeSlideShadowComparisonBounds,
  nodeSlideShadowComparisonExpected,
  nodeSlideShadowComparisonRetentionPlan,
} from './lib/nodeslideShadowComparison';
import { nodeslideShadowComparisonValidator } from './lib/nodeslideShadowComparisonValidator';
import {
  requireDeckSignatureProfile,
  requireSignatureProfile,
} from './lib/nodeslideSignatureProfiles';
import { isNormalizedBoundingBox, validateNodeSlideSnapshot } from './lib/nodeslideValidation';
import {
  nodeslideBriefAttachmentValidator,
  nodeslideBriefValidator,
  nodeslideCommentAnchorValidator,
  nodeslideCursorValidator,
  nodeslidePatchOperationValidator,
  nodeslidePatchScopeValidator,
  nodeslideReasoningEffortValidator,
  nodeslideVersionClockValidator,
} from './lib/nodeslideValidators';
import {
  NODESLIDE_VARIATION_DECISION_LIMIT,
  NODESLIDE_VARIATION_REASON_LIMIT,
  NodeSlideVariationError,
  type VariationDecisionTrace,
  planVariationAcceptance,
  planVariationRejection,
  summarizeVariationOperations,
} from './lib/nodeslideVariationHarness';

const PRESENCE_TTL_MS = 45_000;
const MAX_PATCH_OPERATIONS = NODESLIDE_PATCH_OPERATION_LIMIT;
const MAX_PRESENCE_ELEMENTS = 64;
const MAX_LISTED_DECKS = 32;
const patchCoreArgs = {
  id: v.optional(v.string()),
  deckId: v.string(),
  ownerAccessKey: v.string(),
  baseDeckVersion: v.number(),
  baseSlideVersions: nodeslideVersionClockValidator,
  baseElementVersions: nodeslideVersionClockValidator,
  scope: nodeslidePatchScopeValidator,
  operations: v.array(nodeslidePatchOperationValidator),
  summary: v.optional(v.string()),
  linkedCommentId: v.optional(v.string()),
  profileId: v.optional(v.string()),
  profileDigest: v.optional(v.string()),
};
const publicPatchArgs = patchCoreArgs;
const internalAgentPatchArgs = {
  ...patchCoreArgs,
  id: v.string(),
  traceId: v.string(),
  // Kept temporarily for the existing internal action caller; the handler
  // ignores it and always records agent provenance.
  source: v.optional(v.literal('agent')),
};

type HumanPatchMutationArgs = {
  id?: string;
  deckId: string;
  ownerAccessKey: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  summary?: string;
  linkedCommentId?: string;
  profileId?: string;
  profileDigest?: string;
};

type PatchMutationArgs = {
  id?: string;
  deckId: string;
  ownerAccessKey: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  source?: PatchSource;
  summary?: string;
  linkedCommentId?: string;
  traceId?: string;
  proposalKind?: 'edit' | 'propagation';
  parentPatchId?: string;
  affectedSlideIds?: string[];
  affectedSlideDigest?: string;
  candidateDigest?: string;
  candidateValidation?: CandidateValidationReceipt;
  profileId?: string;
  profileDigest?: string;
};

type PackageHostPatchCommand = Omit<HumanPatchMutationArgs, 'ownerAccessKey'>;

const packageHostPatchValidator = v.object({
  id: v.optional(v.string()),
  deckId: v.string(),
  baseDeckVersion: v.number(),
  baseSlideVersions: nodeslideVersionClockValidator,
  baseElementVersions: nodeslideVersionClockValidator,
  scope: nodeslidePatchScopeValidator,
  operations: v.array(nodeslidePatchOperationValidator),
  summary: v.optional(v.string()),
  linkedCommentId: v.optional(v.string()),
  profileId: v.optional(v.string()),
  profileDigest: v.optional(v.string()),
});

const packageAssetKindValidator = v.union(
  v.literal('image'),
  v.literal('video'),
  v.literal('document'),
  v.literal('data'),
  v.literal('export'),
  v.literal('other'),
);

const PACKAGE_ASSET_MAX_BYTES = 8 * 1024 * 1024;
const PACKAGE_ASSET_METADATA_MAX_BYTES = 32 * 1024;

type PackageHostReceiptOperation = NodeSlideReceipt['operation'];
type PackageHostReceipt = NodeSlideReceipt;
type PackageSubmissionKind = 'direct' | 'proposal';
type PackageProposalDecision = 'accept' | 'reject';
type StoredPackageHostReceipt = Omit<PackageHostReceipt, 'authorization'> & {
  authorization?: PackageHostReceipt['authorization'];
};
type PackageSubmissionBinding = {
  row: Doc<'nodeslide_package_submissions'>;
  originReceipt: PackageHostReceipt;
};

type PackageJsonValue =
  | string
  | number
  | boolean
  | null
  | PackageJsonValue[]
  | { [key: string]: PackageJsonValue };

export const ensureWorkspace = mutation({
  args: { clientSessionId: v.string(), ownerAccessKey: v.optional(v.string()) },
  handler: async (ctx, { clientSessionId, ownerAccessKey: providedOwnerAccessKey }) => {
    const session = requiredText(clientSessionId, 'clientSessionId', 256);
    await consumePreviewQuotaBuckets(ctx, [
      {
        key: `workspace:${nodeslideHash(session)}`,
        limit: 100,
        windowMs: 86_400_000,
      },
      { key: 'workspace:global', limit: 1_000, windowMs: 3_600_000 },
    ]);
    const built = buildGoldenNodeSlide(session, Date.now());
    const existing = await findDeckRow(ctx, built.snapshot.deck.id);
    if (existing) {
      if (existing.clientSessionId !== session) throw new Error('NodeSlide stable-id collision.');
      // Existing anonymous-session rows predate owner capabilities. The stored
      // session is the only migration proof accepted for claiming those rows.
      if (!existing.ownerAccessKey) {
        const ownerAccessKey = createOwnerAccessKey();
        const now = Date.now();
        await ctx.db.patch(existing._id, { ownerAccessKey, updatedAt: now });
        if (!isSecureShareSlug(existing.shareSlug)) {
          await ctx.db.patch(existing._id, {
            shareSlug: createShareSlug(),
            updatedAt: now,
          });
        }
        await migrateLegacyGoldenWorkspace(ctx, existing.id, built.snapshot, now);
        return await ownerWorkspaceResponse(ctx, existing.id, ownerAccessKey, now);
      }
      if (!providedOwnerAccessKey) throw new Error('NodeSlide owner access key is required.');
      await requireOwnerAccess(ctx, existing.id, providedOwnerAccessKey);
      const now = Date.now();
      if (!isSecureShareSlug(existing.shareSlug)) {
        await ctx.db.patch(existing._id, {
          shareSlug: createShareSlug(),
          updatedAt: now,
        });
      }
      await migrateLegacyGoldenWorkspace(ctx, existing.id, built.snapshot, now);
      return await ownerWorkspaceResponse(ctx, existing.id, providedOwnerAccessKey, now);
    }
    const ownerAccessKey = createOwnerAccessKey();
    await createWorkspaceRows(ctx, {
      clientSessionId: session,
      ownerAccessKey,
      built,
      trace: {
        summary: 'Created the polished seven-slide NodeSlide golden workspace.',
        context: ['Anonymous session seed', 'Deterministic golden deck specification'],
        toolCalls: ['Built normalized deck snapshot', 'Ran structural and geometry validation'],
        provider: 'deterministic',
        model: 'golden-seed/v1',
      },
    });
    return await ownerWorkspaceResponse(ctx, built.snapshot.deck.id, ownerAccessKey, Date.now());
  },
});

export const listDecks = query({
  args: {
    access: v.array(v.object({ deckId: v.string(), ownerAccessKey: v.string() })),
  },
  handler: async (ctx, { access }) => {
    if (access.length > MAX_LISTED_DECKS) throw new Error('Too many NodeSlide decks requested.');
    const rows = await Promise.all(
      access.map(async ({ deckId, ownerAccessKey }) => {
        try {
          return deckFromRow(await requireOwnerAccess(ctx, deckId, ownerAccessKey));
        } catch {
          return null;
        }
      }),
    );
    return rows
      .filter((row) => row !== null)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  },
});

export const getWorkspace = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    try {
      await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    } catch {
      return null;
    }
    return await loadNodeSlideWorkspace(ctx, deckId, Date.now());
  },
});

/**
 * Stores a bounded user-uploaded data file as an owner-gated source record.
 * The agent may read it only when the client explicitly includes the returned
 * source reference in readContext.
 */
export const attachDataSource = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    title: v.string(),
    format: v.union(v.literal('csv'), v.literal('json'), v.literal('txt')),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const title = requiredText(args.title, 'data file name', 180);
    const content = normalizeNodeSlideDataAttachment(
      args.content,
      args.format,
      NODESLIDE_DATA_ATTACHMENT_MAX_BYTES,
    );
    const sourceType =
      args.format === 'csv' ? 'spreadsheet' : args.format === 'json' ? 'document' : 'note';
    const id = nodeslideStableId(
      'source',
      args.deckId,
      sourceType,
      title,
      nodeslideContentDigest(content),
    );
    const existing = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (query) => query.eq('id', id))
      .unique();
    const source = {
      id,
      deckId: args.deckId,
      title,
      sourceType,
      retrievedAt: existing?.retrievedAt ?? Date.now(),
      citation: `Uploaded file: ${title}\n${content}`,
      license: 'User supplied',
      format: args.format,
      contentDigest: nodeslideContentDigest(content),
      byteSize: new TextEncoder().encode(content).byteLength,
      ...nodeSlideDataAttachmentShape(content, args.format),
      retention: 'until_deleted' as const,
      status: 'ready' as const,
      lastRefreshedAt: Date.now(),
    } as const;
    if (existing) await ctx.db.patch(existing._id, source);
    else {
      const sourceCount = (
        await ctx.db
          .query('nodeslide_sources')
          .withIndex('by_deck', (query) => query.eq('deckId', args.deckId))
          .collect()
      ).length;
      if (sourceCount >= 64) throw new Error('This deck has reached its source attachment limit.');
      await ctx.db.insert('nodeslide_sources', source);
    }
    return { id, kind: 'source' as const, label: `Source: ${title}` };
  },
});

/** Owner-controlled deletion for private uploaded evidence. Linked data fails closed. */
export const deleteDataSource = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    sourceId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const source = await ctx.db
      .query('nodeslide_sources')
      .withIndex('by_stable_id', (query) => query.eq('id', args.sourceId))
      .unique();
    if (!source || source.deckId !== args.deckId) return false;
    if (source.sourceType === 'url' || source.license !== 'User supplied') {
      throw new Error('Only private user-uploaded sources can be deleted from this control.');
    }
    const elements = await ctx.db
      .query('nodeslide_elements')
      .withIndex('by_deck', (query) => query.eq('deckId', args.deckId))
      .collect();
    if (elements.some((element) => element.sourceIds.includes(args.sourceId))) {
      throw new Error('This source is still bound to slide content. Remove those bindings first.');
    }
    await ctx.db.delete(source._id);
    return true;
  },
});

export const listAgentRuns = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 40)));
    const rows = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_created', (query) => query.eq('deckId', args.deckId))
      .order('desc')
      .take(limit);
    return rows.map(({ _id, _creationTime, ownerDigest: _ownerDigest, ...run }) => run);
  },
});

export const listAgentMessages = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 80)));
    const rows = await ctx.db
      .query('nodeslide_agent_messages')
      .withIndex('by_deck_created', (query) => query.eq('deckId', args.deckId))
      .order('desc')
      .take(limit);
    return rows.reverse().map(({ _id, _creationTime, ...message }) => message);
  },
});

export const listAgentTelemetryPage = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    runId: v.string(),
    beforeSequence: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const run = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!run || run.deckId !== args.deckId) throw new Error('Agent run not found.');
    const limit = Math.max(1, Math.min(200, Math.floor(args.limit ?? 60)));
    const before = Math.max(1, Math.floor(args.beforeSequence ?? Number.MAX_SAFE_INTEGER));
    const spans = await ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_run_sequence', (query) => query.eq('runId', args.runId).lt('sequence', before))
      .order('desc')
      .take(limit + 1);
    const events = await ctx.db
      .query('nodeslide_agent_events')
      .withIndex('by_run_sequence', (query) => query.eq('runId', args.runId).lt('sequence', before))
      .order('desc')
      .take(limit + 1);
    const page = [
      ...spans.map((row) => ({ kind: 'span' as const, row })),
      ...events.map((row) => ({ kind: 'event' as const, row })),
    ]
      .sort((left, right) => right.row.sequence - left.row.sequence)
      .slice(0, limit);
    const nextBeforeSequence = page.at(-1)?.row.sequence;
    return {
      spans: page
        .filter((item) => item.kind === 'span')
        .map(({ row: { _id, _creationTime, ...span } }) => span),
      events: page
        .filter((item) => item.kind === 'event')
        .map(({ row: { _id, _creationTime, ...event } }) => event),
      hasMore: page.length === limit && nextBeforeSequence !== undefined && nextBeforeSequence > 1,
      ...(nextBeforeSequence !== undefined ? { nextBeforeSequence } : {}),
      totalRecorded: Math.max(0, (run.nextTelemetrySequence ?? 1) - 1),
    };
  },
});

export const cancelAgentRun = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!row || row.deckId !== args.deckId) return null;
    if (['completed', 'failed', 'cancelled', 'awaiting_review'].includes(row.status)) {
      const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = row;
      return run;
    }
    const now = Date.now();
    await ctx.db.patch(row._id, {
      status: 'cancelled',
      updatedAt: now,
      completedAt: now,
    });
    const updated = await ctx.db.get(row._id);
    if (!updated) return null;
    const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = updated;
    return run;
  },
});

/** Versioned, owner-gated registry consumed by the editor command and policy menus. */
export const getEditorCapabilities = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    return {
      version: NODESLIDE_EDITOR_CAPABILITY_VERSION,
      designBehaviorPolicyVersion: NODESLIDE_DESIGN_BEHAVIOR_POLICY_VERSION,
      designBehaviors: NODESLIDE_DESIGN_BEHAVIORS,
      referenceUsePolicies: NODESLIDE_REFERENCE_USE_POLICIES,
      commands: [
        {
          id: 'edit' as const,
          authority: 'nodeslideAgent.proposeEdit' as const,
          proposalKind: 'edit' as const,
        },
        {
          id: 'variations' as const,
          authority: 'nodeslideVariations.generate' as const,
          proposalKind: 'edit' as const,
        },
        {
          id: 'propagate' as const,
          authority: 'nodeslide.proposePropagation' as const,
          proposalKind: 'propagation' as const,
        },
      ],
      layerOperationVersion: NODESLIDE_LAYER_OPERATION_VERSION,
      layerOperations: [
        'set_visibility_v1',
        'group_elements_v1',
        'ungroup_elements_v1',
        'reorder_element_v1',
      ] as const,
    };
  },
});

export const getPresenterSnapshot = query({
  args: { shareSlug: v.string() },
  handler: async (ctx, { shareSlug }) => {
    const slug = requireShareSlug(shareSlug);
    const publication = await findLatestPublicationByShareSlug(ctx, slug);
    if (
      !publication ||
      publication.shareSlug !== slug ||
      publication.status !== 'active' ||
      publication.snapshot.deck.id !== publication.deckId ||
      publication.snapshot.deck.version !== publication.deckVersion
    ) {
      return null;
    }
    return publishedNodeSlideFromRow(publication);
  },
});

export const publishDeck = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    const deckRow = await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const snapshot = await requireSnapshot(ctx, deckId);
    const validation = await findCurrentValidationRow(ctx, deckId, snapshot.deck.version);
    if (!validationAllowsPublication(snapshot, validation)) {
      throw new Error('The current deck version must pass publish validation before sharing.');
    }

    // D9 governance: when the approval gate is on, only an approver sign-off
    // bound to this exact version + validation receipt authorizes publish.
    const approvalRows = await ctx.db
      .query('nodeslide_publish_approvals')
      .withIndex('by_deck_version', (queryBuilder) =>
        queryBuilder.eq('deckId', deckId).eq('deckVersion', snapshot.deck.version),
      )
      .collect();
    // A revoked approver's sign-off is void — publishing must not proceed on the
    // authority of a capability the owner has since rescinded. Exclude them before
    // choosing the newest authorizing sign-off (fail-closed governance).
    // Bounded read on the critical publish path: the approver table is capped at
    // NODESLIDE_APPROVER_ROW_LIMIT on issue, so this take() reads the whole table without
    // risking a Convex per-query read-limit failure at pathological row counts.
    const approverRows = await ctx.db
      .query('nodeslide_publish_approvers')
      .withIndex('by_deck', (queryBuilder) => queryBuilder.eq('deckId', deckId))
      .take(NODESLIDE_APPROVER_ROW_LIMIT);
    const revokedApproverIds = new Set(
      approverRows.filter((row) => row.revokedAt).map((row) => row.id),
    );
    const newestApproval = selectAuthorizingApproval(approvalRows, revokedApproverIds);
    const approvalDecision = decideNodeSlidePublishApproval({
      required: deckRow.publishApprovalRequired === true,
      deckVersion: snapshot.deck.version,
      validationId: validation.id,
      approval: newestApproval
        ? {
            deckVersion: newestApproval.deckVersion,
            validationId: newestApproval.validationId,
            approverId: newestApproval.approverId,
            approvedAt: newestApproval.approvedAt,
          }
        : null,
    });
    if (!approvalDecision.allowed) throw new Error(approvalDecision.message);

    const now = Date.now();
    const previous = await findLatestPublicationForDeck(ctx, deckId);
    const shareSlug =
      previous?.status === 'active' && isSecureShareSlug(previous.shareSlug)
        ? previous.shareSlug
        : previous?.status === 'revoked' &&
            isSecureShareSlug(deckRow.shareSlug) &&
            deckRow.shareSlug !== previous.shareSlug
          ? deckRow.shareSlug
          : createShareSlug();
    const revision = (previous?.revision ?? 0) + 1;
    const id = nodeslideStableId('publication', deckId, String(revision));
    if (previous?.status === 'active') {
      await ctx.db.patch(previous._id, {
        status: 'superseded',
        supersededAt: now,
        supersededById: id,
      });
    }
    const publishedSnapshot = sanitizeNodeSlideSnapshot(snapshot);
    await ctx.db.insert('nodeslide_publications', {
      id,
      deckId,
      shareSlug,
      revision,
      deckVersion: snapshot.deck.version,
      validationId: validation.id,
      status: 'active',
      snapshot: publishedSnapshot,
      publishedAt: now,
    });
    await ctx.db.patch(deckRow._id, {
      shareSlug,
      status: 'published',
      updatedAt: now,
    });
    await prunePublicationHistory(ctx, deckId);
    return {
      publication: {
        id,
        deckId,
        shareSlug,
        revision,
        deckVersion: snapshot.deck.version,
        validationId: validation.id,
        status: 'active' as const,
        publishedAt: now,
      },
      snapshot: publishedSnapshot,
    };
  },
});

export const revokePublication = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    const deckRow = await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const publication = await findLatestPublicationForDeck(ctx, deckId);
    if (!publication) return null;
    if (publication.status !== 'active') return publicationFromRow(publication);
    const now = Date.now();
    await ctx.db.patch(publication._id, { status: 'revoked', revokedAt: now });
    // A revoked capability is never reactivated by a later publish.
    await ctx.db.patch(deckRow._id, {
      shareSlug: createShareSlug(),
      status: 'ready',
      updatedAt: now,
    });
    return {
      ...publicationFromRow(publication),
      status: 'revoked' as const,
      revokedAt: now,
    };
  },
});

export const applyPatch = mutation({
  args: publicPatchArgs,
  handler: async (ctx, args) => await commitPatch(ctx, normalizeHumanPatchArgs(args), null),
});

export const proposePatch = mutation({
  args: publicPatchArgs,
  handler: async (ctx, args) => await persistProposal(ctx, normalizeHumanPatchArgs(args)),
});

export const proposePropagation = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    parentPatchId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const parent = await findPatchRow(ctx, args.parentPatchId);
    if (!parent || parent.deckId !== args.deckId) throw new Error('Parent patch is unavailable.');
    const snapshot = await requireSnapshot(ctx, args.deckId);
    const plan = planNodeSlidePropagation(snapshot, patchFromRow(parent));
    const now = Date.now();
    const id = nodeslideEventId(
      'patch_propagation',
      now,
      args.deckId,
      args.parentPatchId,
      plan.affectedSlideDigest,
    );
    return await persistProposal(ctx, {
      id,
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
      baseDeckVersion: plan.baseDeckVersion,
      baseSlideVersions: plan.baseSlideVersions,
      baseElementVersions: plan.baseElementVersions,
      scope: plan.scope,
      operations: plan.operations,
      source: 'system',
      summary: `Propagate accepted design behavior to ${plan.affectedSlideIds.length} matching slide${plan.affectedSlideIds.length === 1 ? '' : 's'}.`,
      proposalKind: 'propagation',
      parentPatchId: plan.parentPatchId,
      affectedSlideIds: plan.affectedSlideIds,
      affectedSlideDigest: plan.affectedSlideDigest,
    });
  },
});

export const acceptPatch = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), patchId: v.string() },
  handler: async (ctx, args) => await acceptPatchForOwner(ctx, args),
});

/**
 * W3 acceptance is one transaction: the normal patch commit/CAS path and the
 * selected/sibling decision records either all commit or all roll back.
 */
export const acceptVariationPatch = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    variationId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const selectedRow = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
    const batch = await requireAtomicVariationBatch(ctx, args.deckId, selectedRow.batchId);
    const siblingRows = await ctx.db
      .query('nodeslide_variations')
      .withIndex('by_batch', (index) => index.eq('batchId', selectedRow.batchId))
      .take(4);
    if (
      siblingRows.length !== 3 ||
      siblingRows.some((variation) => variation.deckId !== args.deckId)
    ) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The variation batch cannot be reconciled safely.',
      );
    }

    const linkedPatches = await Promise.all(
      siblingRows.map(async (variation) => ({
        variation,
        patch: await findAtomicVariationPatch(ctx, variation),
      })),
    );
    if (
      linkedPatches.some(
        ({ variation, patch }) => patch && !atomicVariationPatchMatches(patch, variation),
      )
    ) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'A linked patch belongs to a different variation operation set.',
      );
    }
    const committed = linkedPatches.filter(({ patch }) => patch?.status === 'accepted');
    if (committed.length > 1) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'Multiple accepted patches exist for one variation batch.',
      );
    }
    const committedWinner = committed[0];
    if (committedWinner?.patch) {
      const wasReady = selectedRow.status === 'ready';
      await finalizeAtomicVariationSelection(
        ctx,
        batch,
        siblingRows,
        linkedPatches,
        committedWinner.variation,
        committedWinner.patch.id,
      );
      const updated = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
      return {
        variation: atomicVariationFromRow(updated),
        patch:
          wasReady && committedWinner.variation.id === selectedRow.id
            ? patchFromRow(committedWinner.patch)
            : null,
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
        rebased: false,
        staleReasons: [],
      };
    }

    if (batch.acceptedVariationId) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The accepted variation decision has no verifiable accepted patch.',
      );
    }

    if (selectedRow.status !== 'ready') {
      if (batch.acceptingVariationId) {
        await ctx.db.patch(batch._id, { acceptingVariationId: undefined });
      }
      return {
        variation: atomicVariationFromRow(selectedRow),
        patch: null,
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
        rebased: false,
        staleReasons: [],
      };
    }

    const selectedLink = linkedPatches.find(({ variation }) => variation.id === selectedRow.id);
    const existingPatch = selectedLink?.patch ?? null;
    if (existingPatch && !atomicVariationPatchMatches(existingPatch, selectedRow)) {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The linked patch ID belongs to a different operation set.',
      );
    }
    if (existingPatch?.status === 'rejected') {
      await rejectAtomicVariation(ctx, batch, selectedRow, 'patch_rejected');
      const updated = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
      return {
        variation: atomicVariationFromRow(updated),
        patch: null,
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
        rebased: false,
        staleReasons: [],
      };
    }
    if (existingPatch?.status === 'stale') {
      await markAtomicVariationStale(ctx, batch, selectedRow);
      const updated = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
      return {
        variation: atomicVariationFromRow(updated),
        patch: patchFromRow(existingPatch),
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
        rebased: false,
        staleReasons: ['The linked variation patch was already stale.'],
      };
    }

    const patchId = await allocateAtomicVariationPatchId(ctx, selectedRow);
    const patchArgs = atomicVariationPatchArgs(selectedRow, args.ownerAccessKey, patchId);
    const snapshot = await requireSnapshot(ctx, args.deckId);
    const cas = evaluateNodeSlideCas(snapshot, patchInput(patchArgs));
    if (!cas.canCommit) {
      const now = Date.now();
      const stale = patchRow(patchArgs, now, 'stale', existingPatch?.createdAt);
      if (existingPatch) {
        await ctx.db.patch(existingPatch._id, {
          status: 'stale',
          updatedAt: now,
        });
      } else {
        await ctx.db.insert('nodeslide_patches', stale);
      }
      await markAtomicVariationStale(ctx, batch, selectedRow, now);
      const updated = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
      return {
        variation: atomicVariationFromRow(updated),
        patch: stale,
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
        rebased: false,
        staleReasons: cas.reasons,
      };
    }

    if (snapshot.deck.activeSignatureProfileId) {
      const checkedAt = Date.now();
      let activeSignatureValidation: ValidationResult;
      try {
        const preview = applyDeckPatch(
          structuredClone(snapshot),
          {
            baseDeckVersion: snapshot.deck.version,
            scope: patchArgs.scope,
            operations: patchArgs.operations,
          },
          checkedAt,
        ).snapshot;
        activeSignatureValidation = await validateWithActiveSignature(ctx, preview, checkedAt);
      } catch {
        throw new NodeSlideVariationError(
          'generation_failed',
          'The direction could not be checked against the active signature profile.',
        );
      }
      if (!activeSignatureValidation.publishOk) {
        throw new NodeSlideVariationError(
          'generation_failed',
          'This direction conflicts with the active signature profile. Generate new directions and review again.',
        );
      }
    }

    let receipt: Awaited<ReturnType<typeof commitPatch>>;
    try {
      receipt = await commitPatch(ctx, patchArgs, existingPatch);
    } catch {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The variation could not be committed through the patch validator.',
      );
    }
    if (receipt.patch.status !== 'accepted') {
      throw new NodeSlideVariationError(
        'generation_failed',
        'The atomic variation patch returned an unexpected state.',
      );
    }
    await finalizeAtomicVariationSelection(
      ctx,
      batch,
      siblingRows,
      linkedPatches,
      selectedRow,
      receipt.patch.id,
    );
    const updated = await requireAtomicVariationRow(ctx, args.deckId, args.variationId);
    return {
      variation: atomicVariationFromRow(updated),
      patch: receipt.patch,
      workspace: receipt.workspace,
      rebased: receipt.rebased,
      staleReasons: [],
    };
  },
});

export const rejectPatch = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string(), patchId: v.string() },
  handler: async (ctx, args) => await rejectPatchForOwner(ctx, args),
});

/**
 * Package-host wrappers for the existing anonymous-capability deployment.
 * They deliberately reuse the production mutation core above instead of
 * mounting a second copy of the NodeSlide data model. Serialized package
 * principals are not accepted; owner identity is derived from the bearer
 * capability only after requireOwnerAccess succeeds.
 */
export const packageGetDeck = query({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    return await loadNodeSlideSnapshot(ctx, args.deckId);
  },
});

export const packageApplyPatch = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    patch: packageHostPatchValidator,
  },
  handler: async (ctx, args) => {
    const normalized = normalizePackageHostPatch(args);
    await requireOwnerAccess(ctx, normalized.deckId, normalized.ownerAccessKey);
    let existing = normalized.id ? await findPatchRow(ctx, normalized.id) : null;
    let submission = null;
    if (existing) {
      assertExactPatchCommandReplay(existing, normalized);
      submission = await requirePackageSubmission(ctx, {
        patch: existing,
        ownerAccessKey: args.ownerAccessKey,
        expectedKind: 'direct',
      });
      existing = await upgradeLegacyStalePatchVersion(ctx, existing, submission.originReceipt);
    }
    const before = await requireSnapshot(ctx, args.deckId);
    const replayed = existing?.status === 'accepted' || existing?.status === 'stale';
    const committed = await commitPatch(ctx, normalized, existing);
    const replaySnapshot = replayed
      ? await packagePersistedPatchSnapshot(ctx, committed.patch)
      : null;
    const replayResult =
      replaySnapshot !== null && committed.patch.status === 'accepted'
        ? await packageAcceptedPatchReplay(ctx, committed.patch, replaySnapshot)
        : null;
    const snapshot =
      replaySnapshot ?? packageSnapshot(requirePackageWorkspace(committed.workspace));
    const replayedStaleReasons =
      replayed && committed.patch.status === 'stale'
        ? evaluateNodeSlideCas(snapshot, patchInput(normalized)).reasons
        : null;
    const receipt =
      submission?.originReceipt ??
      (await persistPackageHostReceipt(
        ctx,
        packageHostReceipt({
          ownerAccessKey: args.ownerAccessKey,
          patch: committed.patch,
          deckVersion: committed.patch.resultingDeckVersion ?? snapshot.deck.version,
          operation: committed.patch.status === 'accepted' ? 'patch.applied' : 'custom',
          authorizationAction: 'patch.apply',
        }),
      ));
    if (!submission) {
      submission = await persistPackageSubmission(ctx, {
        patch: committed.patch,
        kind: 'direct',
        originReceipt: receipt,
      });
    }
    if (committed.patch.status !== 'accepted') {
      return {
        status: 'stale' as const,
        patch: committed.patch,
        snapshot,
        receipt,
        reasons: replayedStaleReasons ?? committed.staleReasons ?? ['The patch is stale.'],
      };
    }
    const applied =
      replayResult ??
      applyDeckPatch(
        before,
        {
          baseDeckVersion: before.deck.version,
          scope: committed.patch.scope,
          operations: committed.patch.operations,
        },
        committed.patch.updatedAt,
      );
    return {
      status: 'accepted' as const,
      result: {
        patch: committed.patch,
        snapshot,
        affectedSlideIds: applied.affectedSlideIds,
        affectedElementIds: applied.affectedElementIds,
        receipt,
      },
    };
  },
});

export const packageCreateProposal = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    patch: packageHostPatchValidator,
  },
  handler: async (ctx, args) => {
    const normalized = normalizePackageHostPatch(args);
    await requireOwnerAccess(ctx, normalized.deckId, normalized.ownerAccessKey);
    let existing = normalized.id ? await findPatchRow(ctx, normalized.id) : null;
    if (existing) {
      assertExactPatchCommandReplay(existing, normalized);
      const submission = await requirePackageSubmission(ctx, {
        patch: existing,
        ownerAccessKey: args.ownerAccessKey,
        expectedKind: 'proposal',
      });
      if (
        submission.row.resolutionStatus !== undefined ||
        existing.status === 'accepted' ||
        existing.status === 'rejected' ||
        (existing.status === 'stale' && submission.originReceipt.operation === 'proposal.created')
      ) {
        throw new Error(
          `Proposal ${existing.id} was already resolved; its creation response cannot be replayed.`,
        );
      }
      existing = await upgradeLegacyStalePatchVersion(ctx, existing, submission.originReceipt);
      return { patch: patchFromRow(existing), receipt: submission.originReceipt };
    }
    const proposed = await persistProposal(ctx, normalized);
    const receipt = await persistPackageHostReceipt(
      ctx,
      packageHostReceipt({
        ownerAccessKey: args.ownerAccessKey,
        patch: proposed.patch,
        deckVersion:
          proposed.patch.resultingDeckVersion ??
          requirePackageWorkspace(proposed.workspace).deck.version,
        operation: proposed.patch.status === 'stale' ? 'proposal.stale' : 'proposal.created',
        authorizationAction: 'proposal.create',
      }),
    );
    await persistPackageSubmission(ctx, {
      patch: proposed.patch,
      kind: 'proposal',
      originReceipt: receipt,
    });
    return { patch: proposed.patch, receipt };
  },
});

export const packageResolveProposal = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    proposalId: v.string(),
    decision: v.union(v.literal('accept'), v.literal('reject')),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const proposal = await findPatchRow(ctx, args.proposalId);
    if (!proposal || proposal.deckId !== args.deckId) {
      throw new Error(`Patch ${args.proposalId} not found.`);
    }
    const submission = await requirePackageSubmission(ctx, {
      patch: proposal,
      ownerAccessKey: args.ownerAccessKey,
      expectedKind: 'proposal',
    });
    const replay = await packageExistingProposalResolution(ctx, {
      submission,
      patch: proposal,
      ownerAccessKey: args.ownerAccessKey,
      decision: args.decision,
    });
    if (replay) return replay;

    if (args.decision === 'accept') {
      const resolved = await acceptPatchForOwner(ctx, {
        deckId: args.deckId,
        ownerAccessKey: args.ownerAccessKey,
        patchId: args.proposalId,
      });
      const currentSnapshot = packageSnapshot(requirePackageWorkspace(resolved.workspace));
      const status = resolved.patch.status === 'accepted' ? 'accepted' : 'stale';
      const resolvedAt = Date.now();
      const receipt = await persistPackageHostReceipt(
        ctx,
        packageHostReceipt({
          ownerAccessKey: args.ownerAccessKey,
          patch: resolved.patch,
          deckVersion: currentSnapshot.deck.version,
          operation: status === 'accepted' ? 'proposal.accepted' : 'proposal.stale',
          authorizationAction: 'proposal.accept',
          recordedAt: resolvedAt,
        }),
      );
      const snapshot = await immutablePackageResolutionSnapshot(ctx, resolved.patch, receipt);
      const resolution = {
        status: status as 'accepted' | 'stale',
        patch: resolved.patch,
        snapshot,
        receipt,
      };
      await persistPackageProposalResolution(ctx, submission.row, 'accept', resolution, resolvedAt);
      return resolution;
    }

    const patch = await rejectPatchForOwner(ctx, {
      deckId: args.deckId,
      ownerAccessKey: args.ownerAccessKey,
      patchId: args.proposalId,
    });
    if (!patch) throw new Error(`Patch ${args.proposalId} not found.`);
    const currentSnapshot = await requireSnapshot(ctx, args.deckId);
    const resolvedAt = Date.now();
    const receipt = await persistPackageHostReceipt(
      ctx,
      packageHostReceipt({
        ownerAccessKey: args.ownerAccessKey,
        patch,
        deckVersion: currentSnapshot.deck.version,
        operation: 'proposal.rejected',
        authorizationAction: 'proposal.reject',
        recordedAt: resolvedAt,
      }),
    );
    const snapshot = await immutablePackageResolutionSnapshot(ctx, patch, receipt);
    const resolution = { status: 'rejected' as const, patch, snapshot, receipt };
    await persistPackageProposalResolution(ctx, submission.row, 'reject', resolution, resolvedAt);
    return resolution;
  },
});

export const packageListVersions = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit ?? 50)));
    const workspace = await loadNodeSlideWorkspace(ctx, args.deckId, Date.now());
    return [...requirePackageWorkspace(workspace).versions]
      .sort((left, right) => right.version - left.version)
      .slice(0, limit);
  },
});

export const packagePutAsset = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    id: v.optional(v.string()),
    kind: packageAssetKindValidator,
    fileName: v.string(),
    contentType: v.string(),
    contentDigest: v.string(),
    bytes: v.bytes(),
    metadata: v.any(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const bytes = new Uint8Array(args.bytes);
    if (bytes.byteLength > PACKAGE_ASSET_MAX_BYTES) {
      throw new Error(`NodeSlide package assets support at most ${PACKAGE_ASSET_MAX_BYTES} bytes.`);
    }
    if (nodeslideContentDigest(bytes) !== args.contentDigest) {
      throw new Error('NodeSlide package asset digest mismatch.');
    }
    const fileName = requiredText(args.fileName, 'fileName', 240);
    const contentType = requiredText(args.contentType, 'contentType', 160);
    const metadata = boundedPackageMetadata(args.metadata);
    const now = Date.now();
    const assetId = args.id
      ? requiredText(args.id, 'assetId', 240)
      : nodeslideEventId('asset', now, args.deckId, args.contentDigest, fileName);
    const existing = await ctx.db
      .query('nodeslide_package_assets')
      .withIndex('by_stable_id', (index) => index.eq('assetId', assetId))
      .first();
    if (existing && existing.deckId !== args.deckId) throw new Error('Asset is unavailable.');
    const reference = {
      id: assetId,
      deckId: args.deckId,
      kind: args.kind,
      fileName,
      contentType,
      byteSize: bytes.byteLength,
      contentDigest: args.contentDigest,
      createdAt: existing?.createdAt ?? now,
      metadata,
    };
    const row = {
      assetId,
      deckId: args.deckId,
      reference,
      bytes: args.bytes,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    if (existing) await ctx.db.replace(existing._id, row);
    else await ctx.db.insert('nodeslide_package_assets', row);
    return reference;
  },
});

export const packageGetAsset = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    assetId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const asset = await ctx.db
      .query('nodeslide_package_assets')
      .withIndex('by_stable_id', (index) => index.eq('assetId', args.assetId))
      .first();
    if (!asset || asset.deckId !== args.deckId) return null;
    return { reference: asset.reference, bytes: asset.bytes };
  },
});

export const packageDeleteAsset = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    assetId: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const asset = await ctx.db
      .query('nodeslide_package_assets')
      .withIndex('by_stable_id', (index) => index.eq('assetId', args.assetId))
      .first();
    if (!asset || asset.deckId !== args.deckId) return false;
    await ctx.db.delete(asset._id);
    return true;
  },
});

export const restoreVersion = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    versionId: v.optional(v.string()),
    version: v.optional(v.number()),
    baseDeckVersion: v.number(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const current = await requireSnapshot(ctx, args.deckId);
    const target = await findVersionRow(ctx, args);
    if (!target) throw new Error('Restore target version not found.');
    const now = Date.now();
    const patchId = nodeslideEventId('patch_restore', now, args.deckId, target.id);
    const clocks = clocksForNodeSlideOperations(current, []);
    const receipt = {
      id: patchId,
      deckId: args.deckId,
      baseDeckVersion: args.baseDeckVersion,
      ...clocks,
      scope: {
        kind: 'deck',
        deckId: args.deckId,
        operationMode: 'unrestricted',
      } as const,
      operations: [] as PatchOperation[],
      source: 'system' as const,
      summary: `Restore version ${target.version} as a new write.`,
      createdAt: now,
      updatedAt: now,
    };
    if (args.baseDeckVersion !== current.deck.version) {
      await ctx.db.insert('nodeslide_patches', { ...receipt, status: 'stale' });
      return {
        patch: { ...receipt, status: 'stale' as const },
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
      };
    }
    const restored = restoredSnapshot(current, target.snapshot, now);
    const validation = await validateWithActiveSignature(ctx, restored, now);
    await writeNodeSlideSnapshot(ctx, current, restored, now);
    await ctx.db.insert('nodeslide_patches', {
      ...receipt,
      status: 'accepted',
      resultingDeckVersion: restored.deck.version,
    });
    await insertVersion(ctx, restored, `Restored v${target.version}`, 'system', patchId, now);
    await ctx.db.insert('nodeslide_validations', validation);
    return {
      patch: {
        ...receipt,
        status: 'accepted' as const,
        resultingDeckVersion: restored.deck.version,
      },
      snapshot: restored,
      validation,
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
      rebased: false,
    };
  },
});

export const addComment = mutation({
  args: {
    id: v.optional(v.string()),
    deckId: v.string(),
    ownerAccessKey: v.string(),
    anchor: nodeslideCommentAnchorValidator,
    authorId: v.string(),
    authorName: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const snapshot = await requireSnapshot(ctx, args.deckId);
    validateAnchor(snapshot, args.anchor);
    const now = Date.now();
    const id = args.id ?? nodeslideEventId('comment', now, args.deckId, args.authorId, args.text);
    const existing = await findCommentRow(ctx, id);
    if (existing) {
      if (existing.deckId !== args.deckId) throw new Error('Comment id is unavailable.');
      return commentFromRow(existing);
    }
    const comment = {
      id,
      deckId: args.deckId,
      anchor: args.anchor,
      authorId: requiredText(args.authorId, 'authorId', 256),
      authorName: requiredText(args.authorName, 'authorName', 80),
      text: requiredText(args.text, 'comment', 4000),
      status: 'open' as const,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert('nodeslide_comments', comment);
    return comment;
  },
});

export const replyComment = mutation({
  args: {
    id: v.optional(v.string()),
    deckId: v.string(),
    ownerAccessKey: v.string(),
    parentId: v.string(),
    authorId: v.string(),
    authorName: v.string(),
    text: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const parent = await findCommentRow(ctx, args.parentId);
    if (!parent || parent.deckId !== args.deckId)
      throw new Error(`Comment ${args.parentId} not found.`);
    const now = Date.now();
    const id =
      args.id ?? nodeslideEventId('comment_reply', now, args.parentId, args.authorId, args.text);
    const existing = await findCommentRow(ctx, id);
    if (existing) {
      if (existing.deckId !== args.deckId) throw new Error('Comment id is unavailable.');
      return commentFromRow(existing);
    }
    const comment = {
      id,
      deckId: parent.deckId,
      parentId: parent.id,
      anchor: parent.anchor,
      authorId: requiredText(args.authorId, 'authorId', 256),
      authorName: requiredText(args.authorName, 'authorName', 80),
      text: requiredText(args.text, 'reply', 4000),
      status: 'open' as const,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert('nodeslide_comments', comment);
    return comment;
  },
});

export const resolveComment = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    commentId: v.string(),
    linkedPatchId: v.optional(v.string()),
  },
  handler: async (ctx, { deckId, ownerAccessKey, commentId, linkedPatchId }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const comment = await findCommentRow(ctx, commentId);
    if (!comment || comment.deckId !== deckId) throw new Error(`Comment ${commentId} not found.`);
    if (linkedPatchId) {
      const patch = await findPatchRow(ctx, linkedPatchId);
      if (!patch || patch.deckId !== comment.deckId || patch.status !== 'accepted') {
        throw new Error('A comment can only link an accepted patch from the same deck.');
      }
    }
    await ctx.db.patch(comment._id, {
      status: 'resolved',
      ...(linkedPatchId ? { linkedPatchId } : {}),
      updatedAt: Date.now(),
    });
    const updated = await findCommentRow(ctx, commentId);
    return updated ? commentFromRow(updated) : null;
  },
});

export const reopenComment = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    commentId: v.string(),
  },
  handler: async (ctx, { deckId, ownerAccessKey, commentId }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const comment = await findCommentRow(ctx, commentId);
    if (!comment || comment.deckId !== deckId) throw new Error(`Comment ${commentId} not found.`);
    await ctx.db.patch(comment._id, { status: 'open', updatedAt: Date.now() });
    const updated = await findCommentRow(ctx, commentId);
    return updated ? commentFromRow(updated) : null;
  },
});

export const touchPresence = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    sessionId: v.string(),
    displayName: v.string(),
    color: v.string(),
    slideId: v.optional(v.string()),
    elementIds: v.array(v.string()),
    cursor: v.optional(nodeslideCursorValidator),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    if (args.elementIds.length > MAX_PRESENCE_ELEMENTS) {
      throw new Error(`Presence supports at most ${MAX_PRESENCE_ELEMENTS} elements.`);
    }
    const snapshot = await requireSnapshot(ctx, args.deckId);
    const slides = new Set(snapshot.slides.map((slide) => slide.id));
    const elements = new Set(snapshot.elements.map((element) => element.id));
    if (args.slideId && !slides.has(args.slideId)) throw new Error('Presence slide is unknown.');
    if (args.elementIds.some((id) => !elements.has(id)))
      throw new Error('Presence element is unknown.');
    const now = Date.now();
    const expired = await ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', args.deckId).lte('expiresAt', now))
      .take(100);
    for (const row of expired) await ctx.db.delete(row._id);
    const existing = await ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_session', (index) =>
        index.eq('deckId', args.deckId).eq('sessionId', args.sessionId),
      )
      .first();
    const value = {
      id: existing?.id ?? nodeslideStableId('presence', args.deckId, args.sessionId),
      deckId: args.deckId,
      sessionId: requiredText(args.sessionId, 'sessionId', 256),
      displayName: requiredText(args.displayName, 'displayName', 80),
      color: requiredText(args.color, 'color', 64),
      ...(args.slideId ? { slideId: args.slideId } : {}),
      elementIds: [...new Set(args.elementIds)],
      ...(args.cursor
        ? {
            cursor: {
              x: clampNormalized(args.cursor.x),
              y: clampNormalized(args.cursor.y),
            },
          }
        : {}),
      lastSeenAt: now,
      expiresAt: now + PRESENCE_TTL_MS,
    };
    if (existing) await ctx.db.replace(existing._id, value);
    else await ctx.db.insert('nodeslide_presence', value);
    const active = await ctx.db
      .query('nodeslide_presence')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', args.deckId).gt('expiresAt', now))
      .order('desc')
      .take(NODESLIDE_WORKSPACE_LIMITS.presence);
    return active
      .map(presenceFromRow)
      .sort((left, right) => right.lastSeenAt - left.lastSeenAt || right.id.localeCompare(left.id));
  },
});

export const validateAndRecord = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    const snapshot = await requireSnapshot(ctx, deckId);
    const now = Date.now();
    const result = await validateWithActiveSignature(ctx, snapshot, now);
    await ctx.db.insert('nodeslide_validations', result);
    return result;
  },
});

export const listExecutionTraces = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const requestedLimit = args.limit ?? 20;
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
      throw new Error('Execution trace list limit must be an integer from 1 to 50.');
    }
    const now = Date.now();
    const rows = await ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', args.deckId).gt('expiresAt', now))
      .take(NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK);
    return rows
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      .slice(0, requestedLimit)
      .map(({ _id, _creationTime, actorDigest: _actorDigest, ...trace }) => trace);
  },
});

export const listShadowComparisons = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const requestedLimit = args.limit ?? 20;
    if (!Number.isSafeInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
      throw new Error('Shadow comparison list limit must be an integer from 1 to 50.');
    }
    const now = Date.now();
    const rows = await ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', args.deckId).gt('expiresAt', now))
      .take(NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK);
    return rows
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id))
      .slice(0, requestedLimit)
      .map(({ _id, _creationTime, actorDigest: _actorDigest, ...comparison }) => comparison);
  },
});

export const getExecutionTelemetrySummary = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const now = Date.now();
    const rows = await ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_deck_expiry', (index) => index.eq('deckId', args.deckId).gt('expiresAt', now))
      .take(NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK);
    return summarizeNodeSlideExecutionTraces(rows.map(({ _id, _creationTime, ...trace }) => trace));
  },
});

export const persistExecutionTraceInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    trace: nodeslideExecutionTraceValidator,
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const trace = structuredClone(args.trace) as NodeSlideExecutionTrace;
    assertExecutionTraceBounds(trace);
    if (trace.deckId !== args.deckId) throw new Error('Execution trace deck binding mismatch.');
    if (trace.actorDigest !== `actor_${nodeslideContentDigest(args.ownerAccessKey)}`) {
      throw new Error('Execution trace actor binding mismatch.');
    }
    const collisions = await ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_stable_id', (index) => index.eq('id', trace.id))
      .take(2);
    if (collisions.length > 0) {
      const existing = collisions.find(
        (candidate) =>
          candidate.deckId === trace.deckId && candidate.traceDigest === trace.traceDigest,
      );
      if (existing) return existing;
      throw new Error('Execution trace ID collision.');
    }
    await ctx.db.insert('nodeslide_execution_traces', trace);

    const now = Date.now();
    const [expired, recent] = await Promise.all([
      ctx.db
        .query('nodeslide_execution_traces')
        .withIndex('by_deck_expiry', (index) =>
          index.eq('deckId', args.deckId).lte('expiresAt', now),
        )
        .take(NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK),
      ctx.db
        .query('nodeslide_execution_traces')
        .withIndex('by_deck_created', (index) => index.eq('deckId', args.deckId))
        .order('desc')
        .take(NODESLIDE_EXECUTION_TRACE_LIMIT_PER_DECK + 1),
    ]);
    const deleteIds = new Set(executionTraceRetentionPlan([...expired, ...recent], now));
    for (const row of [...expired, ...recent]) {
      if (deleteIds.has(row.id)) await ctx.db.delete(row._id);
    }
    return trace;
  },
});

const EXECUTION_TRACE_PRUNE_BATCH_SIZE = 250;

export const pruneExpiredExecutionTracesInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('nodeslide_execution_traces')
      .withIndex('by_expiry', (index) => index.lte('expiresAt', now))
      .take(EXECUTION_TRACE_PRUNE_BATCH_SIZE);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === EXECUTION_TRACE_PRUNE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.nodeslide.pruneExpiredExecutionTracesInternal, {});
    }
    return { deleted: expired.length, cutoff: now };
  },
});

export const persistShadowComparisonInternal = internalMutation({
  args: {
    deckId: v.string(),
    comparison: nodeslideShadowComparisonValidator,
  },
  handler: async (ctx, args) => {
    const deck = await findDeckRow(ctx, args.deckId);
    if (!deck?.ownerAccessKey) throw new Error('Shadow comparison deck binding mismatch.');
    const comparison = structuredClone(args.comparison) as NodeSlideShadowComparison;
    assertNodeSlideShadowComparisonBounds(comparison);
    if (comparison.deckId !== args.deckId) {
      throw new Error('Shadow comparison deck binding mismatch.');
    }
    if (comparison.actorDigest !== `actor_${nodeslideContentDigest(deck.ownerAccessKey)}`) {
      throw new Error('Shadow comparison actor binding mismatch.');
    }
    const baselinePatch = await findPatchRow(ctx, comparison.baselinePatchId);
    const baselineTrace = await ctx.db
      .query('nodeslide_traces')
      .withIndex('by_stable_deck_patch', (index) =>
        index
          .eq('id', comparison.baselineTraceId)
          .eq('deckId', args.deckId)
          .eq('patchId', comparison.baselinePatchId),
      )
      .first();
    if (!baselinePatch || !baselineTrace) {
      throw new Error('Shadow comparison baseline binding mismatch.');
    }
    assertNodeSlideShadowComparisonBaselineBinding({
      comparison,
      baselinePatch,
      baselineTrace,
    });
    const collisions = await ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_stable_id', (index) => index.eq('id', comparison.id))
      .take(2);
    if (collisions.length > 0) {
      const existing = collisions.find(
        (candidate) =>
          candidate.deckId === comparison.deckId &&
          candidate.comparisonDigest === comparison.comparisonDigest,
      );
      if (existing) return existing;
      throw new Error('Shadow comparison ID collision.');
    }
    await ctx.db.insert('nodeslide_shadow_comparisons', comparison);

    const now = Date.now();
    const [expired, recent] = await Promise.all([
      ctx.db
        .query('nodeslide_shadow_comparisons')
        .withIndex('by_deck_expiry', (index) =>
          index.eq('deckId', args.deckId).lte('expiresAt', now),
        )
        .take(NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK),
      ctx.db
        .query('nodeslide_shadow_comparisons')
        .withIndex('by_deck_created', (index) => index.eq('deckId', args.deckId))
        .order('desc')
        .take(NODESLIDE_SHADOW_COMPARISON_LIMIT_PER_DECK + 1),
    ]);
    const deleteIds = new Set(nodeSlideShadowComparisonRetentionPlan([...expired, ...recent], now));
    for (const row of [...expired, ...recent]) {
      if (deleteIds.has(row.id)) await ctx.db.delete(row._id);
    }
    return comparison;
  },
});

const SHADOW_COMPARISON_PRUNE_BATCH_SIZE = 250;

export const pruneExpiredShadowComparisonsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const expired = await ctx.db
      .query('nodeslide_shadow_comparisons')
      .withIndex('by_expiry', (index) => index.lte('expiresAt', now))
      .take(SHADOW_COMPARISON_PRUNE_BATCH_SIZE);
    for (const row of expired) await ctx.db.delete(row._id);
    if (expired.length === SHADOW_COMPARISON_PRUNE_BATCH_SIZE) {
      await ctx.scheduler.runAfter(0, internal.nodeslide.pruneExpiredShadowComparisonsInternal, {});
    }
    return { deleted: expired.length, cutoff: now };
  },
});

export const consumePreviewQuota = internalMutation({
  args: {
    buckets: v.array(v.object({ key: v.string(), limit: v.number(), windowMs: v.number() })),
  },
  handler: async (ctx, { buckets }) => {
    await consumePreviewQuotaBuckets(ctx, buckets);
    return true;
  },
});

export const consumePreviewQuotaResult = internalMutation({
  args: {
    buckets: v.array(v.object({ key: v.string(), limit: v.number(), windowMs: v.number() })),
  },
  handler: async (ctx, { buckets }) => {
    try {
      await consumePreviewQuotaBuckets(ctx, buckets);
      return { ok: true as const };
    } catch (error) {
      if (error instanceof NodeSlidePreviewQuotaError) {
        return { ok: false as const, reason: 'quota_exceeded' as const };
      }
      throw error;
    }
  },
});

const NODESLIDE_AGENT_TELEMETRY_VERSION = 'nodeslide-otel/v1';
const NODESLIDE_AGENT_LEASE_MS = 5 * 60 * 1000;
const nodeslideAgentHandoffValidator = v.object({
  id: v.string(),
  parentId: v.optional(v.string()),
  from: v.string(),
  to: v.string(),
  status: v.union(
    v.literal('delegated'),
    v.literal('completed'),
    v.literal('failed'),
    v.literal('skipped'),
  ),
});

function agentTraceId(deckId: string, runId: string): string {
  return nodeslideIdDigest(`nodeslide-agent-trace\u001f${deckId}\u001f${runId}`);
}

function agentSpanId(traceId: string, label: string, sequence: number): string {
  return nodeslideIdDigest(`${traceId}\u001f${label}\u001f${sequence}`).slice(0, 16);
}

function agentOperation(
  status: Doc<'nodeslide_agent_runs'>['status'],
  activity?: 'memory_retrieval',
): {
  name: string;
  operationName: string;
  toolName?: string;
} {
  if (activity === 'memory_retrieval') {
    return {
      name: 'Retrieve relevant deck memory',
      operationName: 'execute_tool',
      toolName: 'memory_retrieval',
    };
  }
  switch (status) {
    case 'queued':
      return { name: 'Queue and authorize', operationName: 'agent.queue' };
    case 'researching':
      return {
        name: 'Search external references',
        operationName: 'execute_tool',
        toolName: 'web_search',
      };
    case 'planning':
      return { name: 'Plan bounded slide edit', operationName: 'chat' };
    case 'validating':
      return {
        name: 'Validate candidate',
        operationName: 'execute_tool',
        toolName: 'candidate_validation',
      };
    case 'awaiting_review':
      return {
        name: 'Await human approval',
        operationName: 'agent.await_approval',
      };
    default:
      return { name: 'Finalize agent run', operationName: 'agent.finalize' };
  }
}

export const beginAgentRunInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    idempotencyKey: v.string(),
    instruction: v.string(),
    provider: v.string(),
    model: v.string(),
    webResearch: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const idempotencyKey = requiredText(args.idempotencyKey, 'idempotency key', 160);
    const instruction = requiredText(args.instruction, 'instruction', 4000);
    const existing = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_idempotency', (query) =>
        query.eq('deckId', args.deckId).eq('idempotencyKey', idempotencyKey),
      )
      .first();
    if (existing) {
      if (existing.status === 'failed' && !existing.patchId && existing.attempt < 3) {
        const now = Date.now();
        const traceId = existing.otelTraceId ?? agentTraceId(args.deckId, existing.id);
        const sequence = existing.nextTelemetrySequence ?? 3;
        const attempt = existing.attempt + 1;
        const rootSpanId = agentSpanId(traceId, `invoke_agent_retry_${attempt}`, sequence);
        await ctx.db.insert('nodeslide_agent_spans', {
          id: nodeslideStableId('agent_span', existing.id, rootSpanId),
          deckId: args.deckId,
          runId: existing.id,
          traceId,
          spanId: rootSpanId,
          name: `Invoke NodeSlide agent (attempt ${attempt})`,
          operationName: 'invoke_agent',
          kind: 'internal',
          status: 'unset',
          startTime: now,
          provider: existing.provider,
          model: existing.model,
          attributes: [
            { key: 'gen_ai.operation.name', value: 'invoke_agent' },
            { key: 'nodeslide.run.attempt', value: attempt },
            { key: 'nodeslide.retry.reason', value: 'prior_attempt_failed' },
          ],
          sequence,
          createdAt: now,
          updatedAt: now,
        });
        await ctx.db.insert('nodeslide_agent_events', {
          id: nodeslideStableId('agent_event', existing.id, 'retry', String(attempt)),
          deckId: args.deckId,
          runId: existing.id,
          traceId,
          spanId: rootSpanId,
          name: 'agent.retry.started',
          severity: 'warn',
          timestamp: now,
          body: `Retry attempt ${attempt} started from the durable request boundary.`,
          attributes: [{ key: 'nodeslide.run.attempt', value: attempt }],
          sequence: sequence + 1,
        });
        await ctx.db.patch(existing._id, {
          status: 'queued',
          attempt,
          rootSpanId,
          checkpoint: 'queued',
          error: undefined,
          completedAt: undefined,
          updatedAt: now,
          lastHeartbeatAt: now,
          leaseExpiresAt: now + NODESLIDE_AGENT_LEASE_MS,
          nextTelemetrySequence: sequence + 2,
          otelExportStatus: 'pending',
          otelExportedAt: undefined,
          otelExportError: undefined,
        });
        await ctx.db.insert('nodeslide_agent_messages', {
          id: nodeslideStableId('agent_message', existing.id, 'retry', String(attempt)),
          deckId: args.deckId,
          runId: existing.id,
          role: 'system',
          content: `Retrying the same idempotent request (attempt ${attempt} of 3).`,
          createdAt: now,
        });
        const retried = await ctx.db.get(existing._id);
        if (!retried) throw new Error('Agent run retry could not be loaded.');
        const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = retried;
        return { created: true, run };
      }
      const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = existing;
      return { created: false, run };
    }
    const now = Date.now();
    const id = nodeslideStableId('agent_run', args.deckId, idempotencyKey);
    const otelTraceId = agentTraceId(args.deckId, id);
    const rootSpanId = agentSpanId(otelTraceId, 'invoke_agent', 1);
    const run = {
      id,
      deckId: args.deckId,
      ownerDigest: `actor_${nodeslideContentDigest(args.ownerAccessKey)}`,
      idempotencyKey,
      instruction,
      status: 'queued' as const,
      provider: requiredText(args.provider, 'provider', 80),
      model: requiredText(args.model, 'model', 180),
      webResearch: args.webResearch,
      attempt: 1,
      otelTraceId,
      rootSpanId,
      checkpoint: 'queued',
      lastHeartbeatAt: now,
      leaseExpiresAt: now + NODESLIDE_AGENT_LEASE_MS,
      nextTelemetrySequence: 3,
      telemetryVersion: NODESLIDE_AGENT_TELEMETRY_VERSION,
      otelExportStatus: 'pending' as const,
      createdAt: now,
      updatedAt: now,
    };
    await ctx.db.insert('nodeslide_agent_runs', run);
    await ctx.db.insert('nodeslide_agent_spans', {
      id: nodeslideStableId('agent_span', id, rootSpanId),
      deckId: args.deckId,
      runId: id,
      traceId: otelTraceId,
      spanId: rootSpanId,
      name: 'Invoke NodeSlide agent',
      operationName: 'invoke_agent',
      kind: 'internal',
      status: 'unset',
      startTime: now,
      provider: run.provider,
      model: run.model,
      attributes: [
        { key: 'gen_ai.operation.name', value: 'invoke_agent' },
        { key: 'gen_ai.provider.name', value: run.provider },
        { key: 'gen_ai.request.model', value: run.model },
        { key: 'nodeslide.web_research', value: run.webResearch },
        { key: 'nodeslide.run.attempt', value: 1 },
      ],
      sequence: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('nodeslide_agent_events', {
      id: nodeslideStableId('agent_event', id, 'request_accepted'),
      deckId: args.deckId,
      runId: id,
      traceId: otelTraceId,
      spanId: rootSpanId,
      name: 'agent.request.accepted',
      severity: 'info',
      timestamp: now,
      body: 'Agent request accepted and durably queued.',
      attributes: [{ key: 'nodeslide.checkpoint', value: 'queued' }],
      sequence: 2,
    });
    await ctx.db.insert('nodeslide_agent_messages', {
      id: nodeslideStableId('agent_message', id, 'user'),
      deckId: args.deckId,
      runId: id,
      role: 'user',
      content: instruction,
      createdAt: now,
    });
    const { ownerDigest: _ownerDigest, ...publicRun } = run;
    return { created: true, run: publicRun };
  },
});

export const getAgentRunInternal = internalQuery({
  args: { deckId: v.string(), ownerAccessKey: v.string(), runId: v.string() },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!row || row.deckId !== args.deckId) return null;
    const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = row;
    return run;
  },
});

export const getAgentTelemetryForExportInternal = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!row) return null;
    const spans = await ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_run_sequence', (query) => query.eq('runId', args.runId))
      .collect();
    const events = await ctx.db
      .query('nodeslide_agent_events')
      .withIndex('by_run_sequence', (query) => query.eq('runId', args.runId))
      .collect();
    const { _id, _creationTime, ownerDigest: _ownerDigest, ...run } = row;
    return {
      run,
      spans: spans.map(({ _id, _creationTime, ...span }) => span),
      events: events.map(({ _id, _creationTime, ...event }) => event),
    };
  },
});

export const markAgentTelemetryExportInternal = internalMutation({
  args: {
    runId: v.string(),
    status: v.union(v.literal('exported'), v.literal('skipped'), v.literal('failed')),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!row) return false;
    await ctx.db.patch(row._id, {
      otelExportStatus: args.status,
      otelExportedAt: Date.now(),
      ...(args.error
        ? {
            otelExportError: requiredText(args.error, 'OTLP export error', 300),
          }
        : {}),
    });
    return true;
  },
});

/**
 * Creates or advances one provider-backed assistant prose row. Every update is
 * a full prefix, so Convex queries deliver actual server-observed text deltas
 * rather than a client-side typewriter animation.
 */
export const writeAgentAssistantStreamInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    runId: v.string(),
    messageId: v.string(),
    content: v.string(),
    state: v.union(v.literal('streaming'), v.literal('complete'), v.literal('interrupted')),
    sourceIds: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const run = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!run || run.deckId !== args.deckId) throw new Error('Agent run not found.');
    const messageId = requiredText(args.messageId, 'stream message id', 180);
    const content = requiredAgentStreamText(args.content);
    const existing = await ctx.db
      .query('nodeslide_agent_messages')
      .withIndex('by_stable_id', (query) => query.eq('id', messageId))
      .unique();
    const now = Date.now();
    const terminalRun = ['completed', 'failed', 'cancelled'].includes(run.status);
    if (!existing) {
      if (args.state !== 'streaming') {
        throw new Error('An assistant stream must begin with a streaming prefix.');
      }
      if (terminalRun) {
        throw new Error('A terminal agent run cannot begin an assistant stream.');
      }
      await ctx.db.insert('nodeslide_agent_messages', {
        id: messageId,
        deckId: args.deckId,
        runId: args.runId,
        role: 'assistant',
        content,
        streamState: 'streaming',
        createdAt: now,
        updatedAt: now,
      });
    } else {
      if (
        existing.deckId !== args.deckId ||
        existing.runId !== args.runId ||
        existing.role !== 'assistant' ||
        !existing.streamState
      ) {
        throw new Error('Assistant stream identity collision.');
      }
      if (existing.streamState !== 'streaming') {
        if (existing.streamState === args.state && existing.content === content) return messageId;
        if (existing.streamState === 'complete' && args.state === 'interrupted') {
          await ctx.db.patch(existing._id, {
            content,
            streamState: 'interrupted',
            updatedAt: now,
          });
          return messageId;
        }
        throw new Error('A settled assistant stream is immutable.');
      }
      if (terminalRun && args.state !== 'interrupted') {
        throw new Error('A terminal agent run may only interrupt an open assistant stream.');
      }
      if (args.state === 'streaming' && !content.startsWith(existing.content)) {
        throw new Error('Assistant stream updates must extend the persisted prefix.');
      }
      await ctx.db.patch(existing._id, {
        content,
        streamState: args.state,
        ...(args.sourceIds ? { sourceIds: args.sourceIds.slice(0, 32) } : {}),
        updatedAt: now,
      });
    }
    if (!terminalRun) {
      await ctx.db.patch(run._id, {
        lastHeartbeatAt: now,
        leaseExpiresAt: now + NODESLIDE_AGENT_LEASE_MS,
      });
    }
    return messageId;
  },
});

export const advanceAgentRunInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    runId: v.string(),
    status: v.union(
      v.literal('researching'),
      v.literal('planning'),
      v.literal('validating'),
      v.literal('awaiting_review'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    patchId: v.optional(v.string()),
    traceId: v.optional(v.string()),
    error: v.optional(v.string()),
    message: v.optional(v.string()),
    role: v.optional(v.union(v.literal('assistant'), v.literal('tool'), v.literal('system'))),
    toolName: v.optional(v.string()),
    sourceIds: v.optional(v.array(v.string())),
    memoryIds: v.optional(v.array(v.string())),
    memoryDigests: v.optional(v.array(v.string())),
    activity: v.optional(v.literal('memory_retrieval')),
    /** B2 routing attribution: per-model span rows (planner/executor) may override the run model. */
    spanProvider: v.optional(v.string()),
    spanModel: v.optional(v.string()),
    /** A verified span from this run; used to make delegated work a real child span. */
    parentSpanId: v.optional(v.string()),
    handoff: v.optional(nodeslideAgentHandoffValidator),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const row = await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_stable_id', (query) => query.eq('id', args.runId))
      .unique();
    if (!row || row.deckId !== args.deckId) throw new Error('Agent run not found.');
    if (row.status === 'cancelled' && args.status !== 'cancelled') return null;
    const now = Date.now();
    const terminal = ['completed', 'failed', 'cancelled'].includes(args.status);
    const sequence = row.nextTelemetrySequence ?? 3;
    const traceId = row.otelTraceId ?? agentTraceId(args.deckId, args.runId);
    const rootSpanId = row.rootSpanId ?? agentSpanId(traceId, 'invoke_agent', 1);
    let parentSpanId = rootSpanId;
    let verifiedParentSpan: Doc<'nodeslide_agent_spans'> | null = null;
    if (args.parentSpanId) {
      const requestedParentSpanId = requiredText(args.parentSpanId, 'parent span id', 80);
      const parent = await ctx.db
        .query('nodeslide_agent_spans')
        .withIndex('by_stable_id', (query) =>
          query.eq('id', nodeslideStableId('agent_span', args.runId, requestedParentSpanId)),
        )
        .unique();
      if (!parent || parent.runId !== args.runId || parent.traceId !== traceId) {
        throw new Error('Agent child span parent is not part of this run.');
      }
      verifiedParentSpan = parent;
      parentSpanId = requestedParentSpanId;
    }
    if (args.handoff?.parentId && !args.parentSpanId) {
      throw new Error('A nested handoff requires its verified parent span.');
    }
    if (args.handoff && !args.message) {
      throw new Error('A handoff must have a durable thread message.');
    }
    const handoff = args.handoff
      ? {
          id: requiredText(args.handoff.id, 'handoff id', 180),
          ...(args.handoff.parentId
            ? { parentId: requiredText(args.handoff.parentId, 'parent handoff id', 180) }
            : {}),
          from: requiredText(args.handoff.from, 'handoff source', 180),
          to: requiredText(args.handoff.to, 'handoff destination', 180),
          status: args.handoff.status,
        }
      : undefined;
    if (handoff?.parentId) {
      const boundParentHandoffId = verifiedParentSpan?.attributes.find(
        (attribute) => attribute.key === 'nodeslide.handoff.id',
      )?.value;
      if (boundParentHandoffId !== handoff.parentId) {
        throw new Error('Nested handoff identity does not match its parent span.');
      }
    }
    const phase = agentOperation(row.status, args.activity);
    const phaseSpanId = agentSpanId(traceId, phase.operationName, sequence);
    const phaseStatus = args.status === 'failed' ? 'error' : 'ok';
    const spanProvider = args.spanProvider
      ? requiredText(args.spanProvider, 'span provider', 80)
      : row.provider;
    const spanModel = args.spanModel ? requiredText(args.spanModel, 'span model', 180) : row.model;
    await ctx.db.insert('nodeslide_agent_spans', {
      id: nodeslideStableId('agent_span', args.runId, phaseSpanId),
      deckId: args.deckId,
      runId: args.runId,
      traceId,
      spanId: phaseSpanId,
      parentSpanId,
      name: phase.name,
      operationName: phase.operationName,
      kind: phase.operationName === 'chat' ? 'client' : 'internal',
      status: phaseStatus,
      startTime: row.updatedAt,
      endTime: now,
      durationMs: Math.max(0, now - row.updatedAt),
      provider: spanProvider,
      model: spanModel,
      ...(phase.toolName
        ? { toolName: phase.toolName }
        : args.toolName
          ? { toolName: requiredText(args.toolName, 'tool name', 120) }
          : {}),
      ...(args.sourceIds ? { sourceIds: args.sourceIds.slice(0, 32) } : {}),
      attributes: [
        { key: 'gen_ai.operation.name', value: phase.operationName },
        { key: 'gen_ai.provider.name', value: spanProvider },
        { key: 'gen_ai.request.model', value: spanModel },
        { key: 'nodeslide.run.status.from', value: row.status },
        { key: 'nodeslide.run.status.to', value: args.status },
        { key: 'nodeslide.checkpoint', value: args.status },
        ...(args.sourceIds?.length
          ? [
              {
                key: 'nodeslide.source.ids',
                value: args.sourceIds.slice(0, 32).join(','),
              },
            ]
          : []),
        ...(args.memoryIds?.length
          ? [
              {
                key: 'nodeslide.memory.count',
                value: Math.min(6, args.memoryIds.length),
              },
              {
                key: 'nodeslide.memory.ids',
                value: args.memoryIds.slice(0, 6).join(','),
              },
            ]
          : []),
        ...(args.memoryDigests?.length
          ? [
              {
                key: 'nodeslide.memory.digests',
                value: args.memoryDigests.slice(0, 6).join(','),
              },
            ]
          : []),
        ...(handoff
          ? [
              { key: 'nodeslide.handoff.id', value: handoff.id },
              ...(handoff.parentId
                ? [{ key: 'nodeslide.handoff.parent_id', value: handoff.parentId }]
                : []),
              { key: 'nodeslide.handoff.from', value: handoff.from },
              { key: 'nodeslide.handoff.to', value: handoff.to },
              { key: 'nodeslide.handoff.status', value: handoff.status },
              { key: 'nodeslide.handoff.timing', value: 'checkpoint_projection' },
            ]
          : []),
      ],
      sequence,
      createdAt: now,
      updatedAt: now,
    });
    if (verifiedParentSpan) {
      // Keep the exported trace tree temporally valid. These are durable
      // post-call checkpoints (declared in the timing attribute), so the
      // parent must remain open through its projected child checkpoint.
      await ctx.db.patch(verifiedParentSpan._id, {
        endTime: now,
        durationMs: Math.max(0, now - verifiedParentSpan.startTime),
        updatedAt: now,
      });
    }
    await ctx.db.insert('nodeslide_agent_events', {
      id: nodeslideStableId('agent_event', args.runId, String(sequence + 1), args.status),
      deckId: args.deckId,
      runId: args.runId,
      traceId,
      spanId: phaseSpanId,
      name: `agent.status.${args.status}`,
      severity: args.status === 'failed' ? 'error' : 'info',
      timestamp: now,
      body:
        args.status === 'failed'
          ? 'Agent run failed without applying deck changes.'
          : `Durable checkpoint advanced to ${args.status}.`,
      attributes: [
        { key: 'nodeslide.checkpoint', value: args.status },
        { key: 'nodeslide.run.attempt', value: row.attempt },
        ...(args.memoryIds?.length
          ? [
              {
                key: 'nodeslide.memory.count',
                value: Math.min(6, args.memoryIds.length),
              },
            ]
          : []),
      ],
      sequence: sequence + 1,
    });
    await ctx.db.patch(row._id, {
      status: args.status,
      updatedAt: now,
      checkpoint: args.status,
      lastHeartbeatAt: now,
      leaseExpiresAt: terminal ? now : now + NODESLIDE_AGENT_LEASE_MS,
      nextTelemetrySequence: sequence + 2,
      telemetryVersion: NODESLIDE_AGENT_TELEMETRY_VERSION,
      otelTraceId: traceId,
      rootSpanId,
      ...(terminal ? { completedAt: now } : {}),
      ...(args.patchId ? { patchId: args.patchId } : {}),
      ...(args.traceId ? { traceId: args.traceId } : {}),
      ...(args.error ? { error: requiredText(args.error, 'run error', 600) } : {}),
    });
    if (terminal) {
      const root = await ctx.db
        .query('nodeslide_agent_spans')
        .withIndex('by_stable_id', (query) =>
          query.eq('id', nodeslideStableId('agent_span', args.runId, rootSpanId)),
        )
        .unique();
      if (root) {
        await ctx.db.patch(root._id, {
          status: args.status === 'failed' ? 'error' : 'ok',
          endTime: now,
          durationMs: Math.max(0, now - root.startTime),
          updatedAt: now,
        });
      }
      await ctx.scheduler.runAfter(0, internal.nodeslideTelemetry.exportRunOtlpInternal, {
        runId: args.runId,
      });
    }
    if (args.message) {
      const message = requiredText(args.message, 'run message', 4000);
      const role = args.role ?? 'system';
      await ctx.db.insert('nodeslide_agent_messages', {
        id: nodeslideStableId('agent_message', args.runId, role, String(now), message),
        deckId: args.deckId,
        runId: args.runId,
        role,
        content: message,
        ...(args.toolName ? { toolName: requiredText(args.toolName, 'tool name', 120) } : {}),
        ...(args.sourceIds ? { sourceIds: args.sourceIds.slice(0, 32) } : {}),
        ...(handoff ? { handoff } : {}),
        createdAt: now,
        updatedAt: now,
      });
    }
    return { runId: args.runId, spanId: phaseSpanId };
  },
});

/** Fails abandoned active runs honestly so a crashed action never spins forever in the UI. */
export const recoverStaleAgentRunsInternal = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const stale = await ctx.db
      .query('nodeslide_agent_runs')
      .filter((query) =>
        query.and(
          query.lt(query.field('leaseExpiresAt'), now),
          query.or(
            query.eq(query.field('status'), 'queued'),
            query.eq(query.field('status'), 'researching'),
            query.eq(query.field('status'), 'planning'),
            query.eq(query.field('status'), 'validating'),
          ),
        ),
      )
      .take(100);
    for (const run of stale) {
      const sequence = run.nextTelemetrySequence ?? 3;
      const traceId = run.otelTraceId ?? agentTraceId(run.deckId, run.id);
      const rootSpanId = run.rootSpanId ?? agentSpanId(traceId, 'invoke_agent', 1);
      const recoverySpanId = agentSpanId(traceId, 'stale_recovery', sequence);
      await ctx.db.insert('nodeslide_agent_spans', {
        id: nodeslideStableId('agent_span', run.id, recoverySpanId),
        deckId: run.deckId,
        runId: run.id,
        traceId,
        spanId: recoverySpanId,
        parentSpanId: rootSpanId,
        name: 'Recover expired worker lease',
        operationName: 'agent.recover',
        kind: 'internal',
        status: 'error',
        startTime: run.leaseExpiresAt ?? run.updatedAt,
        endTime: now,
        durationMs: Math.max(0, now - (run.leaseExpiresAt ?? run.updatedAt)),
        provider: run.provider,
        model: run.model,
        attributes: [
          { key: 'nodeslide.recovery.reason', value: 'worker_lease_expired' },
          {
            key: 'nodeslide.last_checkpoint',
            value: run.checkpoint ?? run.status,
          },
        ],
        sequence,
        createdAt: now,
        updatedAt: now,
      });
      await ctx.db.insert('nodeslide_agent_events', {
        id: nodeslideStableId('agent_event', run.id, 'worker_lease_expired'),
        deckId: run.deckId,
        runId: run.id,
        traceId,
        spanId: recoverySpanId,
        name: 'agent.worker_lease_expired',
        severity: 'error',
        timestamp: now,
        body: 'The worker lease expired. The run was failed without applying deck changes.',
        attributes: [
          {
            key: 'nodeslide.last_checkpoint',
            value: run.checkpoint ?? run.status,
          },
        ],
        sequence: sequence + 1,
      });
      await ctx.db.patch(run._id, {
        status: 'failed',
        checkpoint: 'failed',
        error: 'Worker lease expired before the run reached a safe checkpoint.',
        updatedAt: now,
        completedAt: now,
        lastHeartbeatAt: now,
        leaseExpiresAt: now,
        nextTelemetrySequence: sequence + 2,
      });
      const openAssistantStreams = await ctx.db
        .query('nodeslide_agent_messages')
        .withIndex('by_run_created', (query) => query.eq('runId', run.id))
        .filter((query) => query.eq(query.field('streamState'), 'streaming'))
        .take(32);
      for (const stream of openAssistantStreams) {
        await ctx.db.patch(stream._id, {
          streamState: 'interrupted',
          updatedAt: now,
        });
      }
      const root = await ctx.db
        .query('nodeslide_agent_spans')
        .withIndex('by_stable_id', (query) =>
          query.eq('id', nodeslideStableId('agent_span', run.id, rootSpanId)),
        )
        .unique();
      if (root) {
        await ctx.db.patch(root._id, {
          status: 'error',
          endTime: now,
          durationMs: Math.max(0, now - root.startTime),
          updatedAt: now,
        });
      }
      await ctx.scheduler.runAfter(0, internal.nodeslideTelemetry.exportRunOtlpInternal, {
        runId: run.id,
      });
      await ctx.db.insert('nodeslide_agent_messages', {
        id: nodeslideStableId('agent_message', run.id, 'worker_lease_expired'),
        deckId: run.deckId,
        runId: run.id,
        role: 'system',
        content: 'The worker stopped responding. No deck changes were applied; retry the request.',
        createdAt: now,
      });
    }
    return stale.length;
  },
});

export const attachWebSourcesInternal = internalMutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    sources: v.array(
      v.object({
        title: v.string(),
        url: v.string(),
        snippet: v.string(),
        provider: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const now = Date.now();
    const refs: Array<{ id: string; kind: 'source'; label: string }> = [];
    for (const input of args.sources.slice(0, 12)) {
      const normalized = normalizeWebSourceExcerpt(input);
      if (!normalized) continue;
      const { title, snippet, provider, url } = normalized;
      const snapshotDigest = nodeslideContentDigest(snippet);
      const id = nodeslideStableId('source_web', args.deckId, url);
      const existing = await ctx.db
        .query('nodeslide_sources')
        .withIndex('by_stable_id', (query) => query.eq('id', id))
        .unique();
      const source = {
        id,
        deckId: args.deckId,
        title,
        url,
        sourceType: 'url' as const,
        retrievedAt: existing?.retrievedAt ?? now,
        citation: snippet,
        license: 'Web source; verify reuse rights',
        format: 'web' as const,
        contentDigest: snapshotDigest,
        byteSize: new TextEncoder().encode(snippet).byteLength,
        provider,
        retention: 'public_snapshot' as const,
        status: 'ready' as const,
        lastRefreshedAt: now,
        snapshot: {
          kind: 'search_excerpt' as const,
          capturedAt: now,
          text: snippet,
          contentDigest: snapshotDigest,
        },
      };
      if (existing) await ctx.db.patch(existing._id, source);
      else await ctx.db.insert('nodeslide_sources', source);
      refs.push({ id, kind: 'source', label: `Web: ${title}` });
    }
    return refs;
  },
});

export const getAgentContextInternal = internalQuery({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, { deckId, ownerAccessKey }) => {
    await requireOwnerAccess(ctx, deckId, ownerAccessKey);
    return await loadNodeSlideWorkspace(ctx, deckId, Date.now());
  },
});

export const createFromBriefInternal = internalMutation({
  args: {
    deckId: v.string(),
    projectId: v.string(),
    clientSessionId: v.string(),
    ownerAccessKey: v.string(),
    title: v.string(),
    brief: nodeslideBriefValidator,
    attachments: v.optional(v.array(nodeslideBriefAttachmentValidator)),
    themeId: v.string(),
    route: v.union(v.literal('free'), v.literal('balanced'), v.literal('frontier')),
    plan: v.array(v.string()),
    spec: v.any(),
    traceSummary: v.string(),
    critiquePasses: v.optional(v.number()),
    critiqueDecision: v.optional(v.string()),
    critiqueReport: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    reasoningEffort: v.optional(nodeslideReasoningEffortValidator),
    costMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    if (!isOwnerAccessKey(args.ownerAccessKey))
      throw new Error('Invalid NodeSlide owner access key.');
    const existing = await findDeckRow(ctx, args.deckId);
    if (existing) {
      await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
      return await ownerWorkspaceResponse(ctx, args.deckId, args.ownerAccessKey, Date.now());
    }
    if (args.plan.length > 12) throw new Error('NodeSlide plans support at most 12 steps.');
    const built = buildBriefNodeSlide({
      deckId: args.deckId,
      projectId: args.projectId,
      title: args.title,
      brief: args.brief,
      themeId: args.themeId,
      rawSpec: args.spec,
      plan: args.plan,
      ...(args.attachments ? { attachments: args.attachments } : {}),
      now: Date.now(),
    });
    await createWorkspaceRows(ctx, {
      clientSessionId: args.clientSessionId,
      ownerAccessKey: args.ownerAccessKey,
      built,
      trace: {
        summary: args.traceSummary,
        context: [
          `Requested route: ${args.route}`,
          ...(args.attachments?.length
            ? [
                `Read ${args.attachments.length} user-supplied data source${args.attachments.length === 1 ? '' : 's'}`,
              ]
            : []),
          ...(args.critiquePasses !== undefined
            ? [
                `Self-critique: ${args.critiquePasses} pass${args.critiquePasses === 1 ? '' : 'es'}${args.critiqueDecision ? ` (${args.critiqueDecision})` : ''}`,
              ]
            : []),
          ...(args.critiqueReport
            ? [`Self-critique report: ${args.critiqueReport}`.slice(0, 500)]
            : []),
          'Persisted deterministic plan and deck specification',
        ],
        toolCalls: [
          'Planned six-to-eight slide narrative',
          'Built normalized deck',
          ...(args.critiquePasses === 2 ? ['Ran bounded self-critique revision'] : []),
          'Validated snapshot',
        ],
        ...(args.provider ? { provider: args.provider } : {}),
        ...(args.model ? { model: args.model } : {}),
        ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
        ...(args.costMicroUsd !== undefined ? { costMicroUsd: args.costMicroUsd } : {}),
        ...(args.inputTokens !== undefined ? { inputTokens: args.inputTokens } : {}),
        ...(args.outputTokens !== undefined ? { outputTokens: args.outputTokens } : {}),
      },
    });
    return await ownerWorkspaceResponse(ctx, args.deckId, args.ownerAccessKey, Date.now());
  },
});

export const proposeAgentPatchInternal = internalMutation({
  args: {
    ...internalAgentPatchArgs,
    instruction: v.string(),
    planningInputDigest: v.optional(v.string()),
    planningSnapshotDigest: v.optional(v.string()),
    shadowComparisonRequested: v.boolean(),
    shadowControlsDigest: v.optional(v.string()),
    shadowComparison: v.optional(nodeslideShadowComparisonValidator),
    traceSummary: v.string(),
    traceContext: v.array(v.string()),
    toolCalls: v.array(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    reasoningEffort: v.optional(nodeslideReasoningEffortValidator),
    costMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    if (args.toolCalls.length > 16) throw new Error('Too many agent tool calls recorded.');
    if (
      args.traceContext.length > 40 ||
      args.traceContext.some((line) => line.length === 0 || line.length > 500)
    ) {
      throw new Error('Agent trace context is invalid or exceeds bounds.');
    }
    const planningBindingsValid =
      /^turn_sha256:[0-9a-f]{64}$/.test(args.planningInputDigest ?? '') &&
      /^snap_sha256:[0-9a-f]{64}$/.test(args.planningSnapshotDigest ?? '');
    if (
      (args.shadowComparisonRequested &&
        (!planningBindingsValid ||
          !/^controls_sha256:[0-9a-f]{64}$/.test(args.shadowControlsDigest ?? ''))) ||
      (!args.shadowComparisonRequested &&
        (args.planningInputDigest !== undefined ||
          args.planningSnapshotDigest !== undefined ||
          args.shadowControlsDigest !== undefined))
    ) {
      throw new Error('Agent shadow comparison authorization binding is invalid.');
    }
    const proposal = await persistProposal(ctx, { ...args, source: 'agent' });
    const now = Date.now();
    const validation = proposal.patch.candidateValidation
      ? validationFromCandidateReceipt(proposal.patch.candidateValidation)
      : undefined;
    const shadowComparisonExpected = nodeSlideShadowComparisonExpected(
      args.shadowComparisonRequested,
      proposal.patch.status,
    );
    const trace = {
      id: args.traceId,
      deckId: args.deckId,
      patchId: args.id,
      status:
        proposal.patch.status === 'stale' ? ('failed' as const) : ('awaiting_review' as const),
      summary: args.traceSummary,
      plan: [
        'Read scoped deck context',
        'Draft bounded operations',
        'Validate clocks, scope, locks, and geometry',
        'Save proposal for review',
      ],
      context: [
        `Instruction: ${requiredText(args.instruction, 'instruction', 4000)}`,
        `Base deck version: ${args.baseDeckVersion}`,
        ...args.traceContext,
      ],
      toolCalls: args.toolCalls,
      guardrails: [
        'Explicit scope only',
        'Locked elements are immutable',
        'Fine-grained CAS before commit',
        'No provider secrets persisted',
      ],
      ...(args.planningInputDigest ? { planningInputDigest: args.planningInputDigest } : {}),
      ...(args.planningSnapshotDigest
        ? { planningSnapshotDigest: args.planningSnapshotDigest }
        : {}),
      shadowComparisonExpected,
      ...(args.shadowControlsDigest ? { shadowControlsDigest: args.shadowControlsDigest } : {}),
      ...(validation ? { validation } : {}),
      ...(proposal.patch.candidateDigest
        ? { candidateDigest: proposal.patch.candidateDigest }
        : {}),
      ...(args.provider ? { provider: args.provider } : {}),
      ...(args.model ? { model: args.model } : {}),
      ...(args.reasoningEffort ? { reasoningEffort: args.reasoningEffort } : {}),
      ...(args.costMicroUsd !== undefined ? { costMicroUsd: args.costMicroUsd } : {}),
      ...(args.inputTokens !== undefined ? { inputTokens: args.inputTokens } : {}),
      ...(args.outputTokens !== undefined ? { outputTokens: args.outputTokens } : {}),
      createdAt: now,
      ...(proposal.patch.status === 'stale' ? { completedAt: now } : {}),
    };
    await ctx.db.insert('nodeslide_traces', trace);
    if (args.shadowComparison) {
      try {
        assertNodeSlideShadowComparisonBounds(args.shadowComparison);
        assertNodeSlideShadowComparisonBaselineBinding({
          comparison: args.shadowComparison,
          baselinePatch: proposal.patch,
          baselineTrace: trace,
        });
        await ctx.scheduler.runAfter(0, internal.nodeslide.persistShadowComparisonInternal, {
          deckId: args.deckId,
          comparison: args.shadowComparison,
        });
      } catch {
        // The atomic trace marker remains as an observable missing-comparison
        // event. Shadow scheduling can never roll back the baseline proposal.
      }
    }
    return proposal;
  },
});

type AtomicVariationLink = {
  variation: Doc<'nodeslide_variations'>;
  patch: Doc<'nodeslide_patches'> | null;
};

async function requireAtomicVariationRow(
  ctx: MutationCtx,
  deckId: string,
  variationId: string,
): Promise<Doc<'nodeslide_variations'>> {
  const rows = await ctx.db
    .query('nodeslide_variations')
    .withIndex('by_stable_id', (index) => index.eq('id', variationId))
    .take(2);
  const row = rows.find((candidate) => candidate.deckId === deckId);
  if (!row) throw new NodeSlideVariationError('invalid_request', 'Variation is unavailable.');
  return row;
}

async function requireAtomicVariationBatch(
  ctx: MutationCtx,
  deckId: string,
  batchId: string,
): Promise<Doc<'nodeslide_variation_batches'>> {
  const rows = await ctx.db
    .query('nodeslide_variation_batches')
    .withIndex('by_stable_id', (index) => index.eq('id', batchId))
    .take(2);
  const row = rows.find((candidate) => candidate.deckId === deckId);
  if (!row) throw new NodeSlideVariationError('invalid_request', 'Variation batch is unavailable.');
  return row;
}

function atomicVariationPatchIds(variation: Doc<'nodeslide_variations'>): string[] {
  return [
    ...(variation.selectedPatchId ? [variation.selectedPatchId] : []),
    nodeslideStableId('patch_variation', variation.id),
    nodeslideStableId('patch_variation_scoped', variation.deckId, variation.id),
  ].filter((value, index, values) => values.indexOf(value) === index);
}

async function findAtomicVariationPatch(
  ctx: MutationCtx,
  variation: Doc<'nodeslide_variations'>,
): Promise<Doc<'nodeslide_patches'> | null> {
  for (const patchId of atomicVariationPatchIds(variation)) {
    const linked = await ctx.db
      .query('nodeslide_patches')
      .withIndex('by_stable_id', (index) => index.eq('id', patchId))
      .filter((query) =>
        query.and(
          query.eq(query.field('deckId'), variation.deckId),
          query.eq(query.field('traceId'), variation.id),
        ),
      )
      .first();
    if (linked) return linked;
  }
  return null;
}

async function allocateAtomicVariationPatchId(
  ctx: MutationCtx,
  variation: Doc<'nodeslide_variations'>,
): Promise<string> {
  const linked = await findAtomicVariationPatch(ctx, variation);
  if (linked) return linked.id;
  const candidates = [
    nodeslideStableId('patch_variation', variation.id),
    nodeslideStableId('patch_variation_scoped', variation.deckId, variation.id),
  ];
  for (const patchId of candidates) {
    const existing = await ctx.db
      .query('nodeslide_patches')
      .withIndex('by_stable_id', (index) => index.eq('id', patchId))
      .first();
    if (!existing) return patchId;
  }
  throw new NodeSlideVariationError(
    'generation_failed',
    'A tenant-scoped variation patch ID could not be allocated.',
  );
}

function atomicVariationPatchArgs(
  variation: Doc<'nodeslide_variations'>,
  ownerAccessKey: string,
  patchId: string,
): PatchMutationArgs {
  const axes = `${variation.axes.contentAngle}/${variation.axes.density}/${variation.axes.layoutArchetype}`;
  return {
    id: patchId,
    deckId: variation.deckId,
    ownerAccessKey,
    baseDeckVersion: variation.baseDeckVersion,
    baseSlideVersions: { [variation.slideId]: variation.baseSlideVersion },
    baseElementVersions: variation.baseElementVersions,
    scope: {
      kind: 'slide',
      deckId: variation.deckId,
      slideIds: [variation.slideId],
      operationMode: 'unrestricted',
    },
    operations: variation.operations,
    source: 'agent',
    summary: `Variation ${axes}: ${summarizeVariationOperations(variation.operations)}`.slice(
      0,
      500,
    ),
    traceId: variation.id,
  };
}

function atomicVariationPatchMatches(
  patch: Doc<'nodeslide_patches'>,
  variation: Doc<'nodeslide_variations'>,
): boolean {
  const expected = atomicVariationPatchArgs(variation, '', patch.id);
  return (
    patch.deckId === variation.deckId &&
    patch.traceId === variation.id &&
    patch.source === 'agent' &&
    patch.baseDeckVersion === variation.baseDeckVersion &&
    stableJson(patch.baseSlideVersions) === stableJson(expected.baseSlideVersions) &&
    stableJson(patch.baseElementVersions) === stableJson(variation.baseElementVersions) &&
    stableJson(patch.scope) === stableJson(expected.scope) &&
    stableJson(patch.operations) === stableJson(variation.operations)
  );
}

async function finalizeAtomicVariationSelection(
  ctx: MutationCtx,
  batch: Doc<'nodeslide_variation_batches'>,
  siblingRows: Doc<'nodeslide_variations'>[],
  linkedPatches: AtomicVariationLink[],
  winnerRow: Doc<'nodeslide_variations'>,
  selectedPatchId: string,
): Promise<void> {
  if (
    siblingRows.some(
      (variation) => variation.id !== winnerRow.id && variation.status === 'accepted',
    )
  ) {
    throw new NodeSlideVariationError(
      'generation_failed',
      'The variation batch contains conflicting accepted decisions.',
    );
  }
  const decidedAt = winnerRow.decidedAt ?? Date.now();
  const plannedVariations = siblingRows.map((variation) => {
    const mapped = atomicVariationFromRow(variation);
    return variation.id === winnerRow.id ? { ...mapped, status: 'ready' as const } : mapped;
  });
  const decision = planVariationAcceptance(
    plannedVariations,
    winnerRow.id,
    selectedPatchId,
    decidedAt,
  );
  for (const update of decision.updates) {
    const target = siblingRows.find((variation) => variation.id === update.id);
    if (!target) continue;
    await ctx.db.patch(target._id, {
      status: update.status,
      ...(update.selectedPatchId ? { selectedPatchId: update.selectedPatchId } : {}),
      decidedAt: update.decidedAt,
    });
  }
  for (const trace of decision.traces) await insertAtomicVariationDecision(ctx, trace);
  for (const link of linkedPatches) {
    if (link.variation.id !== winnerRow.id && link.patch?.status === 'ready') {
      await ctx.db.patch(link.patch._id, {
        status: 'rejected',
        updatedAt: decidedAt,
      });
    }
  }
  await ctx.db.patch(batch._id, {
    acceptingVariationId: undefined,
    acceptedVariationId: winnerRow.id,
  });
  await pruneAtomicVariationDecisions(ctx, winnerRow.deckId);
}

async function rejectAtomicVariation(
  ctx: MutationCtx,
  batch: Doc<'nodeslide_variation_batches'>,
  variation: Doc<'nodeslide_variations'>,
  reason: string,
): Promise<void> {
  const decision = planVariationRejection(atomicVariationFromRow(variation), reason, Date.now());
  if (decision.update && decision.trace) {
    await ctx.db.patch(variation._id, {
      status: 'rejected',
      decidedAt: decision.update.decidedAt,
    });
    await insertAtomicVariationDecision(ctx, decision.trace);
  }
  if (batch.acceptingVariationId) {
    await ctx.db.patch(batch._id, { acceptingVariationId: undefined });
  }
  await pruneAtomicVariationDecisions(ctx, variation.deckId);
}

async function markAtomicVariationStale(
  ctx: MutationCtx,
  batch: Doc<'nodeslide_variation_batches'>,
  variation: Doc<'nodeslide_variations'>,
  decidedAt = Date.now(),
): Promise<void> {
  await ctx.db.patch(variation._id, { status: 'stale', decidedAt });
  if (batch.acceptingVariationId) {
    await ctx.db.patch(batch._id, { acceptingVariationId: undefined });
  }
}

async function insertAtomicVariationDecision(
  ctx: MutationCtx,
  trace: VariationDecisionTrace,
): Promise<void> {
  let candidate = trace;
  const existingRows = await ctx.db
    .query('nodeslide_variation_decisions')
    .withIndex('by_stable_id', (index) => index.eq('id', trace.id))
    .take(2);
  const matching = existingRows.find(
    (row) =>
      row.deckId === trace.deckId &&
      row.variationId === trace.variationId &&
      row.eventName === trace.eventName,
  );
  if (matching) return;
  if (existingRows.length > 0) {
    candidate = {
      ...trace,
      id: nodeslideStableId('variation_decision_scoped', trace.deckId, trace.id),
    };
    const scopedRows = await ctx.db
      .query('nodeslide_variation_decisions')
      .withIndex('by_stable_id', (index) => index.eq('id', candidate.id))
      .take(2);
    if (
      scopedRows.some(
        (row) =>
          row.deckId !== trace.deckId ||
          row.variationId !== trace.variationId ||
          row.eventName !== trace.eventName,
      )
    ) {
      throw new NodeSlideVariationError('generation_failed', 'Decision trace ID collision.');
    }
    if (scopedRows.length > 0) return;
  }
  if (
    candidate.reason !== undefined &&
    (candidate.reason.length === 0 || candidate.reason.length > NODESLIDE_VARIATION_REASON_LIMIT)
  ) {
    throw new NodeSlideVariationError('generation_failed', 'Decision reason exceeds bounds.');
  }
  await ctx.db.insert('nodeslide_variation_decisions', candidate);
}

async function pruneAtomicVariationDecisions(ctx: MutationCtx, deckId: string): Promise<void> {
  const rows = await ctx.db
    .query('nodeslide_variation_decisions')
    .withIndex('by_deck_created', (index) => index.eq('deckId', deckId))
    .order('asc')
    .take(NODESLIDE_VARIATION_DECISION_LIMIT * 2 + 1);
  for (const row of rows.slice(0, Math.max(0, rows.length - NODESLIDE_VARIATION_DECISION_LIMIT))) {
    await ctx.db.delete(row._id);
  }
}

function atomicVariationFromRow(row: Doc<'nodeslide_variations'>): SlideVariation {
  return {
    schemaVersion: row.schemaVersion,
    id: row.id,
    batchId: row.batchId,
    deckId: row.deckId,
    slideId: row.slideId,
    baseDeckVersion: row.baseDeckVersion,
    baseSlideVersion: row.baseSlideVersion,
    baseElementVersions: row.baseElementVersions,
    axes: row.axes,
    origin: row.origin,
    ...(row.fallbackReason !== undefined ? { fallbackReason: row.fallbackReason } : {}),
    operations: row.operations,
    candidate: row.candidate,
    validation: row.validation,
    ...(row.judge !== undefined ? { judge: row.judge } : {}),
    status: row.status,
    ...(row.selectedPatchId !== undefined ? { selectedPatchId: row.selectedPatchId } : {}),
    createdAt: row.createdAt,
    ...(row.decidedAt !== undefined ? { decidedAt: row.decidedAt } : {}),
  };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

type ExactPatchCommand = Omit<
  PatchMutationArgs,
  'ownerAccessKey' | 'candidateDigest' | 'candidateValidation'
>;

function exactPatchCommand(value: ExactPatchCommand) {
  return {
    ...(value.id === undefined ? {} : { id: value.id }),
    deckId: value.deckId,
    baseDeckVersion: value.baseDeckVersion,
    baseSlideVersions: value.baseSlideVersions,
    baseElementVersions: value.baseElementVersions,
    scope: value.scope,
    operations: value.operations,
    source: value.source ?? 'human',
    summary: value.summary?.trim() || 'Scoped NodeSlide change.',
    ...(value.linkedCommentId ? { linkedCommentId: value.linkedCommentId } : {}),
    ...(value.traceId ? { traceId: value.traceId } : {}),
    proposalKind: value.proposalKind ?? 'edit',
    ...(value.parentPatchId === undefined ? {} : { parentPatchId: value.parentPatchId }),
    ...(value.affectedSlideIds === undefined ? {} : { affectedSlideIds: value.affectedSlideIds }),
    ...(value.affectedSlideDigest === undefined
      ? {}
      : { affectedSlideDigest: value.affectedSlideDigest }),
    ...(value.profileId === undefined ? {} : { profileId: value.profileId }),
    ...(value.profileDigest === undefined ? {} : { profileDigest: value.profileDigest }),
  };
}

function assertExactPatchCommandReplay(
  existing: Doc<'nodeslide_patches'>,
  requested: PatchMutationArgs,
): void {
  if (existing.deckId !== requested.deckId) throw new Error('Patch is unavailable.');
  if (stableJson(exactPatchCommand(existing)) !== stableJson(exactPatchCommand(requested))) {
    throw new Error(`Patch ID ${existing.id} is already bound to a different command.`);
  }
}

async function acceptPatchForOwner(
  ctx: MutationCtx,
  args: { deckId: string; ownerAccessKey: string; patchId: string },
) {
  await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
  const row = await findPatchRow(ctx, args.patchId);
  if (!row || row.deckId !== args.deckId) throw new Error(`Patch ${args.patchId} not found.`);
  if (row.status === 'accepted' || row.status === 'stale') {
    return {
      patch: patchFromRow(row),
      workspace: await loadNodeSlideWorkspace(ctx, row.deckId, Date.now()),
    };
  }
  if (row.status === 'rejected') throw new Error(`Patch ${args.patchId} was rejected.`);
  return await commitPatch(ctx, { ...row, ownerAccessKey: args.ownerAccessKey }, row);
}

async function rejectPatchForOwner(
  ctx: MutationCtx,
  args: { deckId: string; ownerAccessKey: string; patchId: string },
): Promise<DeckPatch | null> {
  await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
  const row = await findPatchRow(ctx, args.patchId);
  if (!row || row.deckId !== args.deckId) throw new Error(`Patch ${args.patchId} not found.`);
  if (row.status === 'accepted') throw new Error('Accepted patches cannot be rejected.');
  if (row.status !== 'rejected') {
    const now = Date.now();
    await ctx.db.patch(row._id, { status: 'rejected', updatedAt: now });
    await finishPatchTrace(ctx, row, now, 'cancelled');
  }
  const updated = await findPatchRow(ctx, args.patchId);
  return updated ? patchFromRow(updated) : null;
}

function normalizePackageHostPatch(args: {
  deckId: string;
  ownerAccessKey: string;
  patch: PackageHostPatchCommand;
}): PatchMutationArgs {
  if (args.patch.deckId !== args.deckId || args.patch.scope.deckId !== args.deckId) {
    throw new Error('The package patch is outside the authorized deck.');
  }
  return normalizeHumanPatchArgs({
    ...args.patch,
    deckId: args.deckId,
    ownerAccessKey: args.ownerAccessKey,
  });
}

function packageSnapshot(workspace: NodeSlideWorkspace): DeckSnapshot {
  return {
    deck: workspace.deck,
    slides: workspace.slides,
    elements: workspace.elements,
    sources: workspace.sources,
  };
}

function requirePackageWorkspace(workspace: NodeSlideWorkspace | null): NodeSlideWorkspace {
  if (!workspace) throw new Error('NodeSlide package workspace is unavailable.');
  return workspace;
}

async function packagePersistedPatchSnapshot(
  ctx: MutationCtx,
  patch: DeckPatch,
): Promise<DeckSnapshot> {
  if (patch.resultingDeckVersion === undefined) {
    throw new Error('Patch replay is missing its persisted deck version.');
  }
  const version = await findVersionRow(ctx, {
    deckId: patch.deckId,
    version: patch.resultingDeckVersion,
  });
  if (!version) {
    throw new Error('Patch replay is missing its immutable version.');
  }
  if (patch.status === 'accepted' && version.patchId !== patch.id) {
    throw new Error('Accepted patch replay has an invalid version binding.');
  }
  return version.snapshot;
}

async function packageAcceptedPatchReplay(
  ctx: MutationCtx,
  patch: DeckPatch,
  snapshot: DeckSnapshot,
) {
  if (patch.resultingDeckVersion === undefined) {
    throw new Error('Accepted patch replay is missing its resulting deck version.');
  }
  const previous = await findVersionRow(ctx, {
    deckId: patch.deckId,
    version: patch.resultingDeckVersion - 1,
  });
  if (!previous) {
    throw new Error('Accepted patch replay is missing its base version.');
  }
  const applied = applyDeckPatch(
    previous.snapshot,
    {
      baseDeckVersion: previous.snapshot.deck.version,
      scope: patch.scope,
      operations: patch.operations,
    },
    patch.updatedAt,
  );
  if (
    patch.candidateDigest === undefined ||
    nodeSlideCandidateDigest(snapshot) !== patch.candidateDigest
  ) {
    throw new Error('Accepted patch replay does not match its immutable version.');
  }
  return { ...applied, snapshot };
}

function packageHostPrincipalId(ownerAccessKey: string): string {
  return `anonymous-owner:${nodeslideIdDigest(ownerAccessKey)}`;
}

type PackageHostAuthorizationAction = Extract<
  NodeSlideRepositoryAuthorizationAction,
  'patch.apply' | 'proposal.create' | 'proposal.accept' | 'proposal.reject'
>;

function packageHostPrincipal(ownerAccessKey: string): NodeSlidePrincipal {
  return {
    userId: packageHostPrincipalId(ownerAccessKey),
    roles: ['owner'],
    permissions: [
      NODESLIDE_PERMISSIONS.read,
      NODESLIDE_PERMISSIONS.propose,
      NODESLIDE_PERMISSIONS.write,
      NODESLIDE_PERMISSIONS.approve,
      NODESLIDE_PERMISSIONS.manageAssets,
    ],
  };
}

function packageHostAuthorizationRequest(args: {
  action: PackageHostAuthorizationAction;
  patch: DeckPatch;
  principal: NodeSlidePrincipal;
}): NodeSlideRepositoryAuthorizationRequest {
  const base = {
    action: args.action,
    deckId: args.patch.deckId,
    principal: args.principal,
  };
  switch (args.action) {
    case 'patch.apply':
    case 'proposal.create':
      return { ...base, action: args.action, patch: args.patch };
    case 'proposal.accept':
    case 'proposal.reject':
      return { ...base, action: args.action, proposalId: args.patch.id };
  }
}

function packageHostReceipt(args: {
  ownerAccessKey: string;
  patch: DeckPatch;
  deckVersion: number;
  operation: PackageHostReceiptOperation;
  authorizationAction: PackageHostAuthorizationAction;
  recordedAt?: number;
}): PackageHostReceipt {
  const recordedAt = args.recordedAt ?? args.patch.updatedAt;
  const receiptId = nodeslideStableId(
    'repository_receipt',
    args.patch.deckId,
    args.patch.id,
    args.operation,
    String(args.deckVersion),
  );
  const principal = packageHostPrincipal(args.ownerAccessKey);
  const authorization = createNodeSlideAuthorizationReceipt(
    packageHostAuthorizationRequest({
      action: args.authorizationAction,
      patch: args.patch,
      principal,
    }),
    {
      issuer: 'nodeslide.convex.capability-host',
      policyId: 'anonymous-owner-capability',
      policyVersion: '1',
      evidenceId: receiptId,
    },
    {
      id: nodeslideStableId('repository_authorization', receiptId, args.authorizationAction),
      authorizedAt: recordedAt,
    },
  );
  return {
    id: receiptId,
    deckId: args.patch.deckId,
    deckVersion: args.deckVersion,
    operation: args.operation,
    principalId: principal.userId,
    patchId: args.patch.id,
    ...(args.patch.traceId === undefined ? {} : { traceId: args.patch.traceId }),
    recordedAt,
    attributes: {
      source: args.patch.source,
      status: args.patch.status,
      governancePath: 'existing_nodeslide_server',
    },
    authorization,
  };
}

async function persistPackageHostReceipt(
  ctx: MutationCtx,
  receipt: PackageHostReceipt,
): Promise<PackageHostReceipt> {
  const existingRows = await ctx.db
    .query('nodeslide_package_receipts')
    .withIndex('by_stable_id', (index) => index.eq('receiptId', receipt.id))
    .collect();
  if (existingRows.length > 1) {
    throw new Error('NodeSlide package receipt ID collision.');
  }
  const existing = existingRows[0];
  if (existing) {
    const persisted = existing.receipt as PackageHostReceipt;
    if (
      existing.deckId !== receipt.deckId ||
      existing.patchId !== receipt.patchId ||
      existing.principalId !== receipt.principalId ||
      existing.recordedAt !== receipt.recordedAt
    ) {
      throw new Error('NodeSlide package receipt ID collision.');
    }
    if (stableJson(persisted) === stableJson(receipt)) return persisted;
    if (!legacyPackageReceiptMatches(persisted, receipt)) {
      throw new Error('NodeSlide package receipt ID collision.');
    }
    await ctx.db.patch(existing._id, { receipt });
    return receipt;
  }
  await ctx.db.insert('nodeslide_package_receipts', {
    receiptId: receipt.id,
    deckId: receipt.deckId,
    ...(receipt.patchId === undefined ? {} : { patchId: receipt.patchId }),
    principalId: receipt.principalId,
    receipt,
    recordedAt: receipt.recordedAt,
  });
  return receipt;
}

function legacyPackageReceiptMatches(persisted: unknown, authorized: PackageHostReceipt): boolean {
  if (!persisted || typeof persisted !== 'object' || Array.isArray(persisted)) return false;
  if (Object.hasOwn(persisted, 'authorization')) return false;
  const legacy = Object.fromEntries(
    Object.entries(authorized).filter(([key]) => key !== 'authorization'),
  );
  return stableJson(persisted) === stableJson(legacy);
}

function packageSubmissionId(deckId: string, patchId: string): string {
  return nodeslideStableId('package_submission', deckId, patchId);
}

function packageCommandDigest(patch: ExactPatchCommand): string {
  return nodeslideContentDigest(stableJson(exactPatchCommand(patch)));
}

async function findPackageSubmission(
  ctx: MutationCtx,
  deckId: string,
  patchId: string,
): Promise<Doc<'nodeslide_package_submissions'> | null> {
  const expectedSubmissionId = packageSubmissionId(deckId, patchId);
  const coordinateRows = await ctx.db
    .query('nodeslide_package_submissions')
    .withIndex('by_deck_patch', (index) => index.eq('deckId', deckId).eq('patchId', patchId))
    .collect();
  const stableIdRows = await ctx.db
    .query('nodeslide_package_submissions')
    .withIndex('by_stable_id', (index) => index.eq('submissionId', expectedSubmissionId))
    .collect();
  if (coordinateRows.length > 1) {
    throw new Error(`Patch ID ${patchId} has duplicate package submission bindings.`);
  }
  if (stableIdRows.length > 1) {
    throw new Error(`Patch ID ${patchId} has a package submission ID collision.`);
  }
  const coordinateRow = coordinateRows[0];
  const stableIdRow = stableIdRows[0];
  if (coordinateRow && stableIdRow && coordinateRow._id !== stableIdRow._id) {
    throw new Error(`Patch ID ${patchId} has conflicting package submission bindings.`);
  }
  const row = coordinateRow ?? stableIdRow;
  if (row && row.submissionId !== expectedSubmissionId) {
    throw new Error(`Patch ID ${patchId} has a noncanonical package submission binding.`);
  }
  if (row && (row.deckId !== deckId || row.patchId !== patchId)) {
    throw new Error(`Patch ID ${patchId} has a conflicting package submission envelope.`);
  }
  return row ?? null;
}

async function packageReceiptRowsForPatch(
  ctx: MutationCtx,
  deckId: string,
  patchId: string,
): Promise<Doc<'nodeslide_package_receipts'>[]> {
  return await ctx.db
    .query('nodeslide_package_receipts')
    .withIndex('by_deck_patch', (index) => index.eq('deckId', deckId).eq('patchId', patchId))
    .collect();
}

async function packageReceiptRowById(
  ctx: MutationCtx,
  receiptId: string,
): Promise<Doc<'nodeslide_package_receipts'>> {
  const rows = await ctx.db
    .query('nodeslide_package_receipts')
    .withIndex('by_stable_id', (index) => index.eq('receiptId', receiptId))
    .collect();
  if (rows.length > 1) {
    throw new Error('NodeSlide package receipt ID collision.');
  }
  const row = rows[0];
  if (!row) throw new Error('NodeSlide package submission is missing its origin receipt.');
  return row;
}

function storedPackageReceipt(value: unknown): StoredPackageHostReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('NodeSlide package receipt is malformed.');
  }
  const receipt = value as Partial<StoredPackageHostReceipt>;
  if (
    typeof receipt.id !== 'string' ||
    typeof receipt.deckId !== 'string' ||
    typeof receipt.deckVersion !== 'number' ||
    !Number.isSafeInteger(receipt.deckVersion) ||
    receipt.deckVersion < 0 ||
    typeof receipt.operation !== 'string' ||
    ![
      'patch.applied',
      'proposal.created',
      'proposal.accepted',
      'proposal.rejected',
      'proposal.stale',
      'custom',
    ].includes(receipt.operation) ||
    typeof receipt.principalId !== 'string' ||
    typeof receipt.patchId !== 'string' ||
    typeof receipt.recordedAt !== 'number' ||
    !Number.isSafeInteger(receipt.recordedAt) ||
    receipt.recordedAt < 0 ||
    !receipt.attributes ||
    typeof receipt.attributes !== 'object' ||
    Array.isArray(receipt.attributes)
  ) {
    throw new Error('NodeSlide package receipt is malformed.');
  }
  return receipt as StoredPackageHostReceipt;
}

function packageReceiptPatch(patch: DeckPatch, receipt: StoredPackageHostReceipt): DeckPatch {
  const status = receipt.attributes['status'];
  const source = receipt.attributes['source'];
  if (
    (status !== 'draft' &&
      status !== 'ready' &&
      status !== 'accepted' &&
      status !== 'rejected' &&
      status !== 'stale') ||
    source !== patch.source ||
    receipt.attributes['governancePath'] !== 'existing_nodeslide_server'
  ) {
    throw new Error('NodeSlide package receipt does not match its patch provenance.');
  }
  const expectedStatus: Partial<Record<PackageHostReceiptOperation, DeckPatch['status']>> = {
    'patch.applied': 'accepted',
    'proposal.created': 'ready',
    'proposal.accepted': 'accepted',
    'proposal.rejected': 'rejected',
    'proposal.stale': 'stale',
    custom: 'stale',
  };
  if (expectedStatus[receipt.operation] !== status) {
    throw new Error('NodeSlide package receipt does not match its mutation status.');
  }
  return { ...patch, status, updatedAt: receipt.recordedAt };
}

function preflightStoredPackageReceiptRow(args: {
  row: Doc<'nodeslide_package_receipts'>;
  patch: DeckPatch;
  ownerAccessKey: string;
}): StoredPackageHostReceipt {
  const persisted = storedPackageReceipt(args.row.receipt);
  if (
    args.row.receiptId !== persisted.id ||
    args.row.deckId !== persisted.deckId ||
    args.row.patchId !== persisted.patchId ||
    args.row.principalId !== persisted.principalId ||
    args.row.recordedAt !== persisted.recordedAt ||
    persisted.deckId !== args.patch.deckId ||
    persisted.patchId !== args.patch.id ||
    persisted.principalId !== packageHostPrincipalId(args.ownerAccessKey)
  ) {
    throw new Error('NodeSlide package receipt does not match its stored binding.');
  }
  const canonicalId = nodeslideStableId(
    'repository_receipt',
    persisted.deckId,
    persisted.patchId,
    persisted.operation,
    String(persisted.deckVersion),
  );
  if (persisted.id !== canonicalId) {
    throw new Error('NodeSlide package receipt does not have its canonical stable ID.');
  }
  packageReceiptPatch(args.patch, persisted);
  return persisted;
}

async function authorizedPackageReceipt(
  ctx: MutationCtx,
  args: {
    row: Doc<'nodeslide_package_receipts'>;
    patch: DeckPatch;
    ownerAccessKey: string;
    authorizationAction: PackageHostAuthorizationAction;
  },
): Promise<PackageHostReceipt> {
  const persisted = preflightStoredPackageReceiptRow(args);
  const expected = packageHostReceipt({
    ownerAccessKey: args.ownerAccessKey,
    patch: packageReceiptPatch(args.patch, persisted),
    deckVersion: persisted.deckVersion,
    operation: persisted.operation,
    authorizationAction: args.authorizationAction,
    recordedAt: persisted.recordedAt,
  });
  return await persistPackageHostReceipt(ctx, expected);
}

function packageReceiptAuthorizationAction(
  receipt: StoredPackageHostReceipt,
): PackageHostAuthorizationAction | undefined {
  const action = receipt.authorization?.action;
  if (
    action === 'patch.apply' ||
    action === 'proposal.create' ||
    action === 'proposal.accept' ||
    action === 'proposal.reject'
  ) {
    return action;
  }
  return undefined;
}

async function inferLegacyPackageSubmission(
  ctx: MutationCtx,
  args: {
    patch: Doc<'nodeslide_patches'>;
    ownerAccessKey: string;
  },
): Promise<{
  kind: PackageSubmissionKind;
  originRow: Doc<'nodeslide_package_receipts'>;
}> {
  const rows = (await packageReceiptRowsForPatch(ctx, args.patch.deckId, args.patch.id)).sort(
    (left, right) => left._creationTime - right._creationTime,
  );
  const patch = patchFromRow(args.patch);
  const seenReceiptIds = new Set<string>();
  const receipts = rows.map((row) => {
    const receipt = preflightStoredPackageReceiptRow({
      row,
      patch,
      ownerAccessKey: args.ownerAccessKey,
    });
    if (seenReceiptIds.has(receipt.id)) {
      throw new Error('NodeSlide package receipt ID collision.');
    }
    seenReceiptIds.add(receipt.id);
    return { row, receipt };
  });
  const direct = receipts.filter(
    ({ receipt }) => receipt.operation === 'patch.applied' || receipt.operation === 'custom',
  );
  const proposal = receipts.filter(({ receipt }) => receipt.operation.startsWith('proposal.'));
  if (direct.length > 0 && proposal.length > 0) {
    throw new Error(`Patch ID ${args.patch.id} has conflicting package submission kinds.`);
  }
  if (direct.length > 0) {
    const expectedOperation = args.patch.status === 'accepted' ? 'patch.applied' : 'custom';
    const origin = direct.find(({ receipt }) => receipt.operation === expectedOperation);
    if (!origin) throw new Error(`Patch ${args.patch.id} has no valid direct submission receipt.`);
    return {
      kind: 'direct',
      originRow: origin.row,
    };
  }

  const created = proposal.find(({ receipt }) => receipt.operation === 'proposal.created');
  const staleCreation = proposal.find(
    ({ receipt }) =>
      receipt.operation === 'proposal.stale' &&
      (packageReceiptAuthorizationAction(receipt) === 'proposal.create' ||
        (receipt.authorization === undefined && created === undefined)),
  );
  const origin = created ?? staleCreation;
  if (!origin) {
    throw new Error(`Patch ${args.patch.id} has no package proposal creation receipt.`);
  }
  const terminalOperations = new Set(
    proposal
      .filter(({ row }) => row._id !== origin.row._id)
      .map(({ receipt }) => receipt.operation)
      .filter(
        (operation) =>
          operation === 'proposal.accepted' ||
          operation === 'proposal.rejected' ||
          operation === 'proposal.stale',
      ),
  );
  if (
    terminalOperations.size > 1 ||
    (origin.receipt.operation === 'proposal.stale' && terminalOperations.size > 0)
  ) {
    throw new Error(`Proposal ${args.patch.id} has conflicting terminal package receipts.`);
  }
  return {
    kind: 'proposal',
    originRow: origin.row,
  };
}

function assertPackageSubmissionRow(
  row: Doc<'nodeslide_package_submissions'>,
  args: {
    patch: DeckPatch;
    expectedKind: PackageSubmissionKind;
  },
): void {
  if (
    row.submissionId !== packageSubmissionId(args.patch.deckId, args.patch.id) ||
    row.deckId !== args.patch.deckId ||
    row.patchId !== args.patch.id ||
    row.commandDigest !== packageCommandDigest(args.patch)
  ) {
    throw new Error(`Patch ID ${args.patch.id} has a conflicting package submission binding.`);
  }
  if (row.kind !== args.expectedKind) {
    throw new Error(
      `Patch ID ${args.patch.id} is already bound to a ${row.kind} package submission.`,
    );
  }
  const resolutionFields = [
    row.resolutionDecision,
    row.resolutionStatus,
    row.resolutionDeckVersion,
    row.resolutionReceiptId,
    row.resolvedAt,
  ];
  const populatedResolutionFields = resolutionFields.filter((value) => value !== undefined).length;
  if (populatedResolutionFields !== 0 && populatedResolutionFields !== resolutionFields.length) {
    throw new Error(`Proposal ${args.patch.id} has an incomplete resolution binding.`);
  }
  if (row.kind === 'direct' && populatedResolutionFields !== 0) {
    throw new Error(`Direct patch ${args.patch.id} cannot carry a proposal resolution.`);
  }
}

function assertPackageOriginReceiptVersion(
  patch: DeckPatch,
  receipt: StoredPackageHostReceipt,
  kind: PackageSubmissionKind,
): void {
  const bindsSubmissionVersion =
    kind === 'direct' ||
    patch.status === 'ready' ||
    patch.status === 'draft' ||
    patch.status === 'rejected' ||
    (patch.status === 'stale' && receipt.operation === 'proposal.stale');
  if (!bindsSubmissionVersion) return;
  if (patch.resultingDeckVersion === undefined) {
    if (patch.status !== 'stale') {
      throw new Error(`Patch ID ${patch.id} is missing its package submission deck version.`);
    }
    return;
  }
  if (receipt.deckVersion !== patch.resultingDeckVersion) {
    throw new Error(`Patch ID ${patch.id} has a conflicting package origin deck version.`);
  }
}

async function persistPackageSubmission(
  ctx: MutationCtx,
  args: {
    patch: DeckPatch;
    kind: PackageSubmissionKind;
    originReceipt: PackageHostReceipt;
  },
): Promise<PackageSubmissionBinding> {
  const expected = {
    submissionId: packageSubmissionId(args.patch.deckId, args.patch.id),
    deckId: args.patch.deckId,
    patchId: args.patch.id,
    kind: args.kind,
    commandDigest: packageCommandDigest(args.patch),
    originReceiptId: args.originReceipt.id,
    submittedAt: args.originReceipt.recordedAt,
  };
  const existing = await findPackageSubmission(ctx, args.patch.deckId, args.patch.id);
  if (existing) {
    assertPackageSubmissionRow(existing, { patch: args.patch, expectedKind: args.kind });
    if (
      existing.originReceiptId !== expected.originReceiptId ||
      existing.submittedAt !== expected.submittedAt
    ) {
      throw new Error(`Patch ID ${args.patch.id} has a conflicting package origin receipt.`);
    }
    return { row: existing, originReceipt: args.originReceipt };
  }
  await ctx.db.insert('nodeslide_package_submissions', expected);
  const inserted = await findPackageSubmission(ctx, args.patch.deckId, args.patch.id);
  if (!inserted) throw new Error('NodeSlide package submission could not be persisted.');
  return { row: inserted, originReceipt: args.originReceipt };
}

async function requirePackageSubmission(
  ctx: MutationCtx,
  args: {
    patch: Doc<'nodeslide_patches'>;
    ownerAccessKey: string;
    expectedKind: PackageSubmissionKind;
  },
): Promise<PackageSubmissionBinding> {
  const patch = patchFromRow(args.patch);
  const existing = await findPackageSubmission(ctx, patch.deckId, patch.id);
  if (existing) {
    assertPackageSubmissionRow(existing, { patch, expectedKind: args.expectedKind });
    const originRow = await packageReceiptRowById(ctx, existing.originReceiptId);
    if (
      originRow.receiptId !== existing.originReceiptId ||
      originRow.recordedAt !== existing.submittedAt
    ) {
      throw new Error(`Patch ID ${patch.id} has a conflicting package origin receipt.`);
    }
    const storedOriginReceipt = preflightStoredPackageReceiptRow({
      row: originRow,
      patch,
      ownerAccessKey: args.ownerAccessKey,
    });
    assertPackageOriginReceiptVersion(patch, storedOriginReceipt, existing.kind);
    const originReceipt = await authorizedPackageReceipt(ctx, {
      row: originRow,
      patch,
      ownerAccessKey: args.ownerAccessKey,
      authorizationAction: existing.kind === 'direct' ? 'patch.apply' : 'proposal.create',
    });
    if (
      (existing.kind === 'direct' &&
        originReceipt.operation !== 'patch.applied' &&
        originReceipt.operation !== 'custom') ||
      (existing.kind === 'proposal' &&
        originReceipt.operation !== 'proposal.created' &&
        originReceipt.operation !== 'proposal.stale')
    ) {
      throw new Error(`Patch ID ${patch.id} has an invalid package origin receipt.`);
    }
    if (
      existing.originReceiptId !== originReceipt.id ||
      existing.submittedAt !== originReceipt.recordedAt
    ) {
      throw new Error(`Patch ID ${patch.id} has a conflicting package origin receipt.`);
    }
    return { row: existing, originReceipt };
  }
  const inferred = await inferLegacyPackageSubmission(ctx, {
    patch: args.patch,
    ownerAccessKey: args.ownerAccessKey,
  });
  if (inferred.kind !== args.expectedKind) {
    throw new Error(
      `Patch ID ${patch.id} is already bound to a ${inferred.kind} package submission.`,
    );
  }
  const storedOriginReceipt = preflightStoredPackageReceiptRow({
    row: inferred.originRow,
    patch,
    ownerAccessKey: args.ownerAccessKey,
  });
  assertPackageOriginReceiptVersion(patch, storedOriginReceipt, inferred.kind);
  const originReceipt = await authorizedPackageReceipt(ctx, {
    row: inferred.originRow,
    patch,
    ownerAccessKey: args.ownerAccessKey,
    authorizationAction: inferred.kind === 'direct' ? 'patch.apply' : 'proposal.create',
  });
  return await persistPackageSubmission(ctx, {
    patch,
    kind: inferred.kind,
    originReceipt,
  });
}

async function upgradeLegacyStalePatchVersion(
  ctx: MutationCtx,
  row: Doc<'nodeslide_patches'>,
  receipt: PackageHostReceipt,
): Promise<Doc<'nodeslide_patches'>> {
  if (row.status !== 'stale' || row.resultingDeckVersion !== undefined) return row;
  const version = await findVersionRow(ctx, {
    deckId: row.deckId,
    version: receipt.deckVersion,
  });
  if (!version || receipt.attributes['status'] !== 'stale') {
    throw new Error(`Stale patch ${row.id} is missing a safe immutable version binding.`);
  }
  await ctx.db.patch(row._id, { resultingDeckVersion: receipt.deckVersion });
  const upgraded = await findPatchRow(ctx, row.id);
  if (!upgraded || upgraded.deckId !== row.deckId) {
    throw new Error(`Stale patch ${row.id} could not be upgraded.`);
  }
  return upgraded;
}

async function immutablePackageResolutionSnapshot(
  ctx: MutationCtx,
  patch: DeckPatch,
  receipt: PackageHostReceipt,
): Promise<DeckSnapshot> {
  const version = await findVersionRow(ctx, {
    deckId: patch.deckId,
    version: receipt.deckVersion,
  });
  if (!version)
    throw new Error(`Proposal ${patch.id} is missing its immutable resolution version.`);
  if (patch.status === 'accepted' && version.patchId !== patch.id) {
    throw new Error(`Proposal ${patch.id} has an invalid accepted version binding.`);
  }
  if (
    patch.status === 'accepted' &&
    (patch.candidateDigest === undefined ||
      nodeSlideCandidateDigest(version.snapshot) !== patch.candidateDigest)
  ) {
    throw new Error(`Proposal ${patch.id} does not match its immutable candidate digest.`);
  }
  if (patch.status !== 'rejected' && patch.resultingDeckVersion !== receipt.deckVersion) {
    throw new Error(`Proposal ${patch.id} has a conflicting resolution version.`);
  }
  return version.snapshot;
}

async function persistPackageProposalResolution(
  ctx: MutationCtx,
  row: Doc<'nodeslide_package_submissions'>,
  decision: PackageProposalDecision,
  resolution: NodeSlideProposalResolution,
  resolvedAt: number,
): Promise<void> {
  const current = await findPackageSubmission(ctx, row.deckId, row.patchId);
  if (!current || current._id !== row._id || current.kind !== 'proposal') {
    throw new Error(`Proposal ${row.patchId} has an invalid package submission binding.`);
  }
  const expectedStatus = decision === 'reject' ? 'rejected' : resolution.status;
  if (
    resolution.status !== expectedStatus ||
    (decision === 'accept' && resolution.status === 'rejected') ||
    resolution.patch.id !== row.patchId ||
    resolution.patch.deckId !== row.deckId ||
    resolution.snapshot.deck.id !== row.deckId ||
    resolution.snapshot.deck.version !== resolution.receipt.deckVersion ||
    resolution.receipt.patchId !== row.patchId ||
    resolution.receipt.recordedAt !== resolvedAt
  ) {
    throw new Error(`Proposal ${row.patchId} has an invalid resolution result.`);
  }
  if (current.resolutionStatus !== undefined) {
    if (
      current.resolutionDecision !== decision ||
      current.resolutionStatus !== resolution.status ||
      current.resolutionDeckVersion !== resolution.receipt.deckVersion ||
      current.resolutionReceiptId !== resolution.receipt.id ||
      current.resolvedAt !== resolvedAt ||
      current.resolutionStatus !== resolution.patch.status
    ) {
      throw new Error(`Proposal ${row.patchId} already has a different resolution.`);
    }
    return;
  }
  if (
    current.resolutionDecision !== undefined ||
    current.resolutionDeckVersion !== undefined ||
    current.resolutionReceiptId !== undefined ||
    current.resolvedAt !== undefined
  ) {
    throw new Error(`Proposal ${row.patchId} has an incomplete resolution binding.`);
  }
  await ctx.db.patch(current._id, {
    resolutionDecision: decision,
    resolutionStatus: resolution.status,
    resolutionDeckVersion: resolution.receipt.deckVersion,
    resolutionReceiptId: resolution.receipt.id,
    resolvedAt,
  });
}

async function validateStoredPackageProposalResolution(
  ctx: MutationCtx,
  args: {
    submission: Doc<'nodeslide_package_submissions'>;
    patch: Doc<'nodeslide_patches'>;
    ownerAccessKey: string;
    decision: PackageProposalDecision;
  },
): Promise<NodeSlideProposalResolution> {
  if (
    args.submission.resolutionDecision === undefined ||
    args.submission.resolutionStatus === undefined ||
    args.submission.resolutionDeckVersion === undefined ||
    args.submission.resolutionReceiptId === undefined ||
    args.submission.resolvedAt === undefined
  ) {
    throw new Error(`Proposal ${args.patch.id} has an incomplete resolution binding.`);
  }
  if (args.submission.resolutionDecision !== args.decision) {
    throw new Error(
      `Proposal ${args.patch.id} is already resolved as ${args.submission.resolutionDecision}.`,
    );
  }
  const status = args.submission.resolutionStatus;
  const expectedStatus = args.decision === 'reject' ? 'rejected' : status;
  const patch = patchFromRow(args.patch);
  if (
    status !== expectedStatus ||
    (args.decision === 'accept' && status === 'rejected') ||
    patch.status !== status
  ) {
    throw new Error(`Proposal ${args.patch.id} has a conflicting stored resolution.`);
  }
  const expectedOperation =
    status === 'accepted'
      ? 'proposal.accepted'
      : status === 'rejected'
        ? 'proposal.rejected'
        : 'proposal.stale';
  const receiptRow = await packageReceiptRowById(ctx, args.submission.resolutionReceiptId);
  const receipt = await authorizedPackageReceipt(ctx, {
    row: receiptRow,
    patch,
    ownerAccessKey: args.ownerAccessKey,
    authorizationAction: args.decision === 'accept' ? 'proposal.accept' : 'proposal.reject',
  });
  if (
    receipt.operation !== expectedOperation ||
    receipt.deckVersion !== args.submission.resolutionDeckVersion ||
    receipt.recordedAt !== args.submission.resolvedAt
  ) {
    throw new Error(`Proposal ${args.patch.id} has a conflicting stored resolution receipt.`);
  }
  const snapshot = await immutablePackageResolutionSnapshot(ctx, patch, receipt);
  return { status, patch, snapshot, receipt };
}

async function packageExistingProposalResolution(
  ctx: MutationCtx,
  args: {
    submission: PackageSubmissionBinding;
    patch: Doc<'nodeslide_patches'>;
    ownerAccessKey: string;
    decision: PackageProposalDecision;
  },
): Promise<NodeSlideProposalResolution | null> {
  if (args.submission.row.resolutionStatus !== undefined) {
    return await validateStoredPackageProposalResolution(ctx, {
      submission: args.submission.row,
      patch: args.patch,
      ownerAccessKey: args.ownerAccessKey,
      decision: args.decision,
    });
  }
  if (args.submission.originReceipt.operation === 'proposal.stale') {
    throw new Error(`Proposal ${args.patch.id} cannot be resolved from status stale.`);
  }
  if (args.patch.status === 'ready' || args.patch.status === 'draft') return null;
  if (
    args.patch.status !== 'accepted' &&
    args.patch.status !== 'rejected' &&
    args.patch.status !== 'stale'
  ) {
    throw new Error(
      `Proposal ${args.patch.id} cannot be resolved from status ${args.patch.status}.`,
    );
  }
  const resolutionStatus = args.patch.status;

  const originalDecision: PackageProposalDecision =
    resolutionStatus === 'rejected' ? 'reject' : 'accept';
  if (originalDecision !== args.decision) {
    throw new Error(`Proposal ${args.patch.id} is already ${resolutionStatus}.`);
  }
  const expectedOperation: PackageHostReceiptOperation =
    resolutionStatus === 'accepted'
      ? 'proposal.accepted'
      : resolutionStatus === 'rejected'
        ? 'proposal.rejected'
        : 'proposal.stale';
  const receiptRows = (await packageReceiptRowsForPatch(ctx, args.patch.deckId, args.patch.id))
    .filter((row) => row.receiptId !== args.submission.originReceipt.id)
    .filter((row) => storedPackageReceipt(row.receipt).operation === expectedOperation)
    .sort((left, right) => left._creationTime - right._creationTime);
  const receiptRow = receiptRows[0];
  if (!receiptRow) {
    throw new Error(`Proposal ${args.patch.id} is missing its original resolution receipt.`);
  }
  const receipt = await authorizedPackageReceipt(ctx, {
    row: receiptRow,
    patch: patchFromRow(args.patch),
    ownerAccessKey: args.ownerAccessKey,
    authorizationAction: originalDecision === 'accept' ? 'proposal.accept' : 'proposal.reject',
  });
  const patchRow = await upgradeLegacyStalePatchVersion(ctx, args.patch, receipt);
  const patch = patchFromRow(patchRow);
  const snapshot = await immutablePackageResolutionSnapshot(ctx, patch, receipt);
  const resolution: NodeSlideProposalResolution = {
    status: resolutionStatus,
    patch,
    snapshot,
    receipt,
  };
  await persistPackageProposalResolution(
    ctx,
    args.submission.row,
    originalDecision,
    resolution,
    receipt.recordedAt,
  );
  return resolution;
}

function boundedPackageMetadata(value: unknown): Record<string, PackageJsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('NodeSlide package metadata must be an object.');
  }
  const encoded = JSON.stringify(value);
  if (encoded.length > PACKAGE_ASSET_METADATA_MAX_BYTES) {
    throw new Error(
      `NodeSlide package metadata supports at most ${PACKAGE_ASSET_METADATA_MAX_BYTES} bytes.`,
    );
  }
  assertPackageJsonValue(value);
  return structuredClone(value as Record<string, PackageJsonValue>);
}

function assertPackageJsonValue(value: unknown): asserts value is PackageJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) assertPackageJsonValue(item);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) assertPackageJsonValue(item);
    return;
  }
  throw new Error('NodeSlide package metadata must contain JSON values only.');
}

async function persistProposal(ctx: MutationCtx, args: PatchMutationArgs) {
  const deckRow = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
  assertPatchOperationCount(args.operations);
  assertPatchProfileReference(args);
  assertProposalMetadata(args);
  const existing = args.id ? await findPatchRow(ctx, args.id) : null;
  if (existing) {
    assertExactPatchCommandReplay(existing, args);
    return {
      patch: patchFromRow(existing),
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
    };
  }
  const snapshot = await requireSnapshot(ctx, args.deckId);
  const signatureProfile = await resolvePatchSignatureProfile(
    ctx,
    deckRow.projectId,
    args,
    snapshot,
  );
  const scopedComment = await commentForScope(ctx, args.scope);
  const input = patchInput(args);
  const errors = validateNodeSlidePatch(snapshot, input, scopedComment);
  if (errors.length) throw new Error(errors.join(' '));
  const cas = evaluateNodeSlideCas(snapshot, input);
  const now = Date.now();
  const id = args.id ?? nodeslideEventId('patch', now, args.deckId, args.summary ?? 'proposal');
  let boundArgs = { ...args, id };
  if (cas.canCommit) {
    const candidate = preflightNodeSlideCandidate(snapshot, boundArgs, signatureProfile, id, now);
    if (!candidate.validation.ok) {
      throw new Error(
        `The exact proposal candidate failed full validation: ${candidate.validation.issues.find((issue) => issue.severity === 'error')?.message ?? 'candidate invalid'}`,
      );
    }
    boundArgs = {
      ...boundArgs,
      candidateDigest: candidate.digest,
      candidateValidation: candidate.receipt,
    };
  }
  const row = patchRow(
    boundArgs,
    now,
    cas.canCommit ? 'ready' : 'stale',
    now,
    snapshot.deck.version,
  );
  await ctx.db.insert('nodeslide_patches', row);
  return {
    patch: row,
    workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
    rebased: cas.rebased,
    staleReasons: cas.reasons,
  };
}

async function commitPatch(
  ctx: MutationCtx,
  args: PatchMutationArgs,
  existing: Doc<'nodeslide_patches'> | null,
) {
  const deckRow = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
  assertPatchOperationCount(args.operations);
  assertPatchProfileReference(args);
  assertProposalMetadata(args);
  const persisted = existing ?? (args.id ? await findPatchRow(ctx, args.id) : null);
  if (persisted) {
    assertExactPatchCommandReplay(persisted, args);
    if (persisted.status === 'accepted' || persisted.status === 'stale') {
      return {
        patch: patchFromRow(persisted),
        workspace: await loadNodeSlideWorkspace(ctx, args.deckId, Date.now()),
        rebased: false,
        staleReasons: persisted.status === 'stale' ? ['The patch is stale.'] : undefined,
      };
    }
    if (persisted.status === 'rejected') {
      throw new Error(`Patch ${persisted.id} was rejected.`);
    }
  }
  const snapshot = await requireSnapshot(ctx, args.deckId);
  const signatureProfile = await resolvePatchSignatureProfile(
    ctx,
    deckRow.projectId,
    args,
    snapshot,
  );
  const scopedComment = await commentForScope(ctx, args.scope);
  const input = patchInput(args);
  const errors = validateNodeSlidePatch(snapshot, input, scopedComment);
  if (errors.length) throw new Error(errors.join(' '));
  const cas = evaluateNodeSlideCas(snapshot, input);
  const now = Date.now();
  const id =
    persisted?.id ??
    args.id ??
    nodeslideEventId('patch', now, args.deckId, args.summary ?? 'apply');
  if (!cas.canCommit) {
    const stale = patchRow(
      {
        ...args,
        id,
        ...(persisted?.candidateDigest === undefined
          ? {}
          : { candidateDigest: persisted.candidateDigest }),
        ...(persisted?.candidateValidation === undefined
          ? {}
          : { candidateValidation: persisted.candidateValidation }),
      },
      now,
      'stale',
      persisted?.createdAt,
      snapshot.deck.version,
    );
    if (persisted)
      await ctx.db.patch(persisted._id, {
        status: 'stale',
        resultingDeckVersion: snapshot.deck.version,
        updatedAt: now,
      });
    else await ctx.db.insert('nodeslide_patches', stale);
    if (persisted) await finishPatchTrace(ctx, persisted, now, 'failed');
    return {
      patch: stale,
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
      rebased: false,
      staleReasons: cas.reasons,
    };
  }
  const candidate = preflightNodeSlideCandidate(snapshot, args, signatureProfile, id, now);
  const hasPersistedBinding =
    persisted?.candidateDigest !== undefined || persisted?.candidateValidation !== undefined;
  const bindingMatches = candidateValidationBindingMatches({
    patchId: id,
    candidateDigest: candidate.digest,
    ...(persisted?.candidateDigest !== undefined
      ? { persistedDigest: persisted.candidateDigest }
      : {}),
    ...(persisted?.candidateValidation !== undefined
      ? { persistedReceipt: persisted.candidateValidation }
      : {}),
    validation: candidate.validation,
  });
  if (!candidate.validation.ok || (hasPersistedBinding && !bindingMatches)) {
    const stale = patchRow(
      {
        ...args,
        id,
        candidateDigest: candidate.digest,
        candidateValidation: candidate.receipt,
      },
      now,
      'stale',
      persisted?.createdAt,
      snapshot.deck.version,
    );
    if (persisted)
      await ctx.db.patch(persisted._id, {
        status: 'stale',
        resultingDeckVersion: snapshot.deck.version,
        candidateDigest: candidate.digest,
        candidateValidation: candidate.receipt,
        updatedAt: now,
      });
    else await ctx.db.insert('nodeslide_patches', stale);
    if (persisted) await finishPatchTrace(ctx, persisted, now, 'failed');
    return {
      patch: stale,
      workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
      rebased: false,
      staleReasons: [
        candidate.validation.ok
          ? 'The exact candidate no longer matches its preflight validation binding.'
          : 'The exact candidate failed full validation.',
      ],
    };
  }
  const appliedSnapshot = candidate.snapshot;
  const validation = candidate.validation;
  const persistedCandidateValidation = persisted?.candidateValidation ?? candidate.receipt;
  const accepted = patchRow(
    {
      ...args,
      id,
      candidateDigest: candidate.digest,
      candidateValidation: persistedCandidateValidation,
    },
    now,
    'accepted',
    persisted?.createdAt,
    appliedSnapshot.deck.version,
  );
  await writeNodeSlideSnapshot(ctx, snapshot, appliedSnapshot, now);
  if (persisted) {
    await ctx.db.patch(persisted._id, {
      status: 'accepted',
      resultingDeckVersion: appliedSnapshot.deck.version,
      ...(args.profileId !== undefined ? { profileId: args.profileId } : {}),
      ...(args.profileDigest !== undefined ? { profileDigest: args.profileDigest } : {}),
      candidateDigest: candidate.digest,
      candidateValidation: persistedCandidateValidation,
      updatedAt: now,
    });
  } else await ctx.db.insert('nodeslide_patches', accepted);
  await insertVersion(
    ctx,
    appliedSnapshot,
    args.summary ?? 'Applied patch',
    args.source ?? 'human',
    id,
    now,
  );
  await ctx.db.insert('nodeslide_validations', validation);
  if (args.linkedCommentId)
    await resolveLinkedComment(ctx, args.linkedCommentId, args.deckId, id, now);
  await finishPatchTrace(ctx, accepted, now, 'completed', validation);
  return {
    patch: accepted,
    workspace: await loadNodeSlideWorkspace(ctx, args.deckId, now),
    validation,
    rebased: cas.rebased,
  };
}

function normalizeHumanPatchArgs(args: HumanPatchMutationArgs): PatchMutationArgs {
  assertPatchOperationCount(args.operations);
  assertPatchProfileReference(args);
  const normalized: PatchMutationArgs = {
    ...(args.id !== undefined ? { id: args.id } : {}),
    deckId: args.deckId,
    ownerAccessKey: args.ownerAccessKey,
    baseDeckVersion: args.baseDeckVersion,
    baseSlideVersions: args.baseSlideVersions,
    baseElementVersions: args.baseElementVersions,
    scope: args.scope,
    operations: args.operations,
    source: 'human',
    summary: args.summary?.trim() || 'Applied scoped NodeSlide change.',
    ...(args.linkedCommentId !== undefined ? { linkedCommentId: args.linkedCommentId } : {}),
    ...(args.profileId !== undefined ? { profileId: args.profileId } : {}),
    ...(args.profileDigest !== undefined ? { profileDigest: args.profileDigest } : {}),
  };
  return normalized;
}

function assertPatchOperationCount(operations: readonly PatchOperation[]) {
  if (operations.length > MAX_PATCH_OPERATIONS) {
    throw new Error(`NodeSlide patches support at most ${MAX_PATCH_OPERATIONS} operations.`);
  }
}

function assertPatchProfileReference(
  args: Pick<PatchMutationArgs, 'profileId' | 'profileDigest'>,
): void {
  const hasProfileId = args.profileId !== undefined;
  const hasProfileDigest = args.profileDigest !== undefined;
  if (hasProfileId !== hasProfileDigest) {
    throw new Error('Patch signature profileId and profileDigest must appear together.');
  }
  if (!hasProfileId || !hasProfileDigest) return;
  if (!args.profileId || args.profileId.length > 240) {
    throw new Error('Patch signature profileId is invalid.');
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(args.profileDigest as string)) {
    throw new Error('Patch signature profileDigest is invalid.');
  }
}

async function resolvePatchSignatureProfile(
  ctx: { db: MutationCtx['db'] },
  tenantId: string,
  args: Pick<PatchMutationArgs, 'profileId' | 'profileDigest'>,
  snapshot: DeckSnapshot,
) {
  assertPatchProfileReference(args);
  if (args.profileId !== undefined && args.profileDigest !== undefined) {
    return await requireSignatureProfile(ctx, tenantId, args.profileId, args.profileDigest);
  }
  return await requireDeckSignatureProfile(ctx, tenantId, snapshot.deck);
}

function preflightNodeSlideCandidate(
  snapshot: DeckSnapshot,
  args: Pick<PatchMutationArgs, 'scope' | 'operations'>,
  signatureProfile: Awaited<ReturnType<typeof resolvePatchSignatureProfile>>,
  patchId: string,
  checkedAt: number,
) {
  const materialized = materializeNodeSlideCandidate(snapshot, args, checkedAt);
  const candidateSnapshot: DeckSnapshot = signatureProfile
    ? {
        ...materialized,
        deck: {
          ...materialized.deck,
          activeSignatureProfileId: signatureProfile.id,
          activeSignatureProfileDigest: signatureProfile.source.digest,
        },
      }
    : materialized;
  const digest = nodeSlideCandidateDigest(candidateSnapshot);
  const validation = validateNodeSlideSnapshot(
    candidateSnapshot,
    checkedAt,
    nodeSlideCandidateValidationId(patchId, digest),
    signatureProfile ? { signatureProfile } : {},
  );
  return {
    snapshot: candidateSnapshot,
    digest,
    validation,
    receipt: candidateValidationReceipt({
      patchId,
      candidateDigest: digest,
      validation,
    }),
  };
}

function patchInput(args: PatchMutationArgs): NodeSlidePatchInput {
  return {
    deckId: args.deckId,
    baseDeckVersion: args.baseDeckVersion,
    baseSlideVersions: args.baseSlideVersions,
    baseElementVersions: args.baseElementVersions,
    scope: args.scope,
    operations: args.operations,
  };
}

function patchRow(
  args: PatchMutationArgs,
  now: number,
  status: 'ready' | 'accepted' | 'stale',
  createdAt = now,
  resultingDeckVersion?: number,
): DeckPatch {
  assertPatchProfileReference(args);
  assertProposalMetadata(args);
  return {
    id: args.id ?? nodeslideEventId('patch', now, args.deckId, args.summary ?? 'patch'),
    deckId: args.deckId,
    baseDeckVersion: args.baseDeckVersion,
    baseSlideVersions: args.baseSlideVersions,
    baseElementVersions: args.baseElementVersions,
    ...(resultingDeckVersion !== undefined ? { resultingDeckVersion } : {}),
    scope: args.scope,
    operations: args.operations,
    source: args.source ?? 'human',
    status,
    summary: args.summary?.trim() || 'Scoped NodeSlide change.',
    ...(args.linkedCommentId ? { linkedCommentId: args.linkedCommentId } : {}),
    ...(args.traceId ? { traceId: args.traceId } : {}),
    ...(args.proposalKind !== undefined ? { proposalKind: args.proposalKind } : {}),
    ...(args.parentPatchId !== undefined ? { parentPatchId: args.parentPatchId } : {}),
    ...(args.affectedSlideIds !== undefined ? { affectedSlideIds: args.affectedSlideIds } : {}),
    ...(args.affectedSlideDigest !== undefined
      ? { affectedSlideDigest: args.affectedSlideDigest }
      : {}),
    ...(args.candidateDigest !== undefined ? { candidateDigest: args.candidateDigest } : {}),
    ...(args.candidateValidation !== undefined
      ? { candidateValidation: args.candidateValidation }
      : {}),
    ...(args.profileId !== undefined ? { profileId: args.profileId } : {}),
    ...(args.profileDigest !== undefined ? { profileDigest: args.profileDigest } : {}),
    createdAt,
    updatedAt: now,
  };
}

function assertProposalMetadata(
  args: Pick<
    PatchMutationArgs,
    'proposalKind' | 'parentPatchId' | 'affectedSlideIds' | 'affectedSlideDigest'
  >,
): void {
  const kind = args.proposalKind ?? 'edit';
  if (kind === 'edit') {
    if (
      args.parentPatchId !== undefined ||
      args.affectedSlideIds !== undefined ||
      args.affectedSlideDigest !== undefined
    ) {
      throw new Error('Only propagation proposals may carry propagation metadata.');
    }
    return;
  }
  if (
    !args.parentPatchId ||
    args.parentPatchId.length > 256 ||
    !args.affectedSlideIds ||
    args.affectedSlideIds.length === 0 ||
    args.affectedSlideIds.length > 64 ||
    new Set(args.affectedSlideIds).size !== args.affectedSlideIds.length ||
    !/^sha256:[0-9a-f]{64}$/.test(args.affectedSlideDigest ?? '')
  ) {
    throw new Error('Propagation proposal metadata is invalid or exceeds bounds.');
  }
}

async function createWorkspaceRows(
  ctx: MutationCtx,
  args: {
    clientSessionId: string;
    ownerAccessKey: string;
    built: ReturnType<typeof buildGoldenNodeSlide>;
    trace: {
      summary: string;
      context: string[];
      toolCalls: string[];
      provider?: string;
      model?: string;
      reasoningEffort?: import('../shared/nodeslide').NodeSlideReasoningEffort;
      costMicroUsd?: number;
      inputTokens?: number;
      outputTokens?: number;
    };
  },
) {
  if (!isOwnerAccessKey(args.ownerAccessKey))
    throw new Error('Invalid NodeSlide owner access key.');
  const { snapshot: builtSnapshot, plan, spec } = args.built;
  const snapshot: DeckSnapshot = {
    ...builtSnapshot,
    deck: { ...builtSnapshot.deck, shareSlug: createShareSlug() },
  };
  const now = snapshot.deck.createdAt;
  const projectRowId = await ctx.db.insert('projects', {
    clientSessionId: args.clientSessionId,
    title: snapshot.deck.title,
    domain: 'nodeslide',
    brief: snapshot.deck.brief,
    sourceType: 'prompt',
    starred: false,
    createdAt: now,
    updatedAt: now,
  });
  await insertNodeSlideSnapshot(ctx, {
    snapshot,
    projectRowId,
    clientSessionId: args.clientSessionId,
    ownerAccessKey: args.ownerAccessKey,
    plan,
    spec,
  });
  const validation = validateNodeSlideSnapshot(
    snapshot,
    now,
    nodeslideStableId('validation', snapshot.deck.id, 'initial'),
  );
  await ctx.db.insert('nodeslide_validations', validation);
  await insertVersion(ctx, snapshot, 'Initial deck', 'system', undefined, now);
  await ctx.db.insert('nodeslide_traces', {
    id: nodeslideStableId('trace', snapshot.deck.id, 'creation'),
    deckId: snapshot.deck.id,
    status: 'completed',
    summary: args.trace.summary,
    plan,
    context: args.trace.context,
    toolCalls: args.trace.toolCalls,
    guardrails: [
      'Normalized geometry',
      'Source-aware content',
      'Stable external IDs',
      'Deterministic validation',
    ],
    validation,
    ...(args.trace.provider ? { provider: args.trace.provider } : {}),
    ...(args.trace.model ? { model: args.trace.model } : {}),
    ...(args.trace.reasoningEffort ? { reasoningEffort: args.trace.reasoningEffort } : {}),
    ...(args.trace.costMicroUsd !== undefined ? { costMicroUsd: args.trace.costMicroUsd } : {}),
    ...(args.trace.inputTokens !== undefined ? { inputTokens: args.trace.inputTokens } : {}),
    ...(args.trace.outputTokens !== undefined ? { outputTokens: args.trace.outputTokens } : {}),
    createdAt: now,
    completedAt: now,
  });
}

async function insertVersion(
  ctx: MutationCtx,
  snapshot: DeckSnapshot,
  label: string,
  source: PatchSource,
  patchId: string | undefined,
  now: number,
) {
  await ctx.db.insert('nodeslide_versions', {
    id: nodeslideStableId('version', snapshot.deck.id, String(snapshot.deck.version)),
    deckId: snapshot.deck.id,
    version: snapshot.deck.version,
    label,
    source,
    ...(patchId ? { patchId } : {}),
    snapshot,
    createdAt: now,
  });
}

async function requireSnapshot(
  ctx: { db: MutationCtx['db'] },
  deckId: string,
): Promise<DeckSnapshot> {
  const snapshot = await loadNodeSlideSnapshot(ctx, deckId);
  if (!snapshot) throw new Error(`Deck ${deckId} not found.`);
  return snapshot;
}

async function migrateLegacyGoldenWorkspace(
  ctx: MutationCtx,
  deckId: string,
  canonical: DeckSnapshot,
  now: number,
): Promise<void> {
  const before = await loadNodeSlideSnapshot(ctx, deckId);
  if (!before) return;
  const repair = repairLegacyGoldenSnapshot(before, canonical);
  if (!repair.changed) return;

  const changedElementIds = new Set(
    repair.snapshot.elements.flatMap((element) => {
      const previous = before.elements.find((candidate) => candidate.id === element.id);
      return previous &&
        (previous.content !== element.content ||
          JSON.stringify(previous.math) !== JSON.stringify(element.math) ||
          JSON.stringify(previous.exportCapabilities) !==
            JSON.stringify(element.exportCapabilities) ||
          JSON.stringify(previous.bbox) !== JSON.stringify(element.bbox))
        ? [element.id]
        : [];
    }),
  );
  const changedSlideIds = new Set(
    repair.snapshot.elements
      .filter((element) => changedElementIds.has(element.id))
      .map((element) => element.slideId),
  );
  const after: DeckSnapshot = {
    ...repair.snapshot,
    deck: {
      ...repair.snapshot.deck,
      toolchainVersion: canonical.deck.toolchainVersion,
      version: before.deck.version + 1,
      updatedAt: now,
    },
    slides: repair.snapshot.slides.map((slide) =>
      changedSlideIds.has(slide.id) ? { ...slide, version: slide.version + 1 } : slide,
    ),
    elements: repair.snapshot.elements.map((element) =>
      changedElementIds.has(element.id) ? { ...element, version: element.version + 1 } : element,
    ),
  };
  const validation = await validateWithActiveSignature(ctx, after, now);
  await writeNodeSlideSnapshot(ctx, before, after, now);
  await insertVersion(ctx, after, 'Repaired legacy golden seed', 'system', undefined, now);
  await ctx.db.insert('nodeslide_validations', validation);
}

async function validateWithActiveSignature(
  ctx: { db: MutationCtx['db'] },
  snapshot: DeckSnapshot,
  checkedAt: number,
): Promise<ValidationResult> {
  const profileId = snapshot.deck.activeSignatureProfileId;
  const profileDigest = snapshot.deck.activeSignatureProfileDigest;
  if (profileId === undefined && profileDigest === undefined) {
    return validateNodeSlideSnapshot(snapshot, checkedAt);
  }
  const deckRow = await findDeckRow(ctx, snapshot.deck.id);
  if (!deckRow) throw new Error(`Deck ${snapshot.deck.id} not found.`);
  const signatureProfile = await requireDeckSignatureProfile(ctx, deckRow.projectId, snapshot.deck);
  if (!signatureProfile) throw new Error('Active signature profile identity/digest is incomplete.');
  return validateNodeSlideSnapshot(snapshot, checkedAt, undefined, {
    signatureProfile,
  });
}

async function ownerWorkspaceResponse(
  ctx: { db: MutationCtx['db'] },
  deckId: string,
  ownerAccessKey: string,
  now: number,
) {
  const workspace = await loadNodeSlideWorkspace(ctx, deckId, now);
  if (!workspace) throw new Error(`Deck ${deckId} not found.`);
  return {
    ...workspace,
    ownerAccessKey,
    shareSlug: workspace.deck.shareSlug ?? null,
  };
}

function isSecureShareSlug(value: string | undefined): value is string {
  return value !== undefined && /^share-[a-f0-9]{36}$/.test(value);
}

async function commentForScope(ctx: MutationCtx, scope: PatchScope): Promise<DeckComment | null> {
  if (scope.kind !== 'comment') return null;
  const row = await findCommentRow(ctx, scope.commentId);
  return row ? commentFromRow(row) : null;
}

async function resolveLinkedComment(
  ctx: MutationCtx,
  commentId: string,
  deckId: string,
  patchId: string,
  now: number,
) {
  const comment = await findCommentRow(ctx, commentId);
  if (!comment || comment.deckId !== deckId)
    throw new Error('Linked comment does not belong to this deck.');
  await ctx.db.patch(comment._id, {
    status: 'resolved',
    linkedPatchId: patchId,
    updatedAt: now,
  });
}

async function finishPatchTrace(
  ctx: MutationCtx,
  patch: Pick<DeckPatch, 'id' | 'deckId' | 'traceId'>,
  now: number,
  status: 'completed' | 'failed' | 'cancelled',
  validation?: ValidationResult,
): Promise<boolean> {
  if (!patch.traceId) return false;
  const trace = await ctx.db
    .query('nodeslide_traces')
    .withIndex('by_stable_deck_patch', (index) =>
      index
        .eq('id', patch.traceId as string)
        .eq('deckId', patch.deckId)
        .eq('patchId', patch.id),
    )
    .first();
  if (!trace || trace.deckId !== patch.deckId || trace.patchId !== patch.id) return false;
  await ctx.db.patch(trace._id, {
    status,
    ...(validation ? { validation } : {}),
    completedAt: now,
  });
  const run = (
    await ctx.db
      .query('nodeslide_agent_runs')
      .withIndex('by_deck_created', (query) => query.eq('deckId', patch.deckId))
      .order('desc')
      .take(100)
  ).find((candidate) => candidate.patchId === patch.id);
  if (run) {
    const runStatus =
      status === 'completed' ? 'completed' : status === 'cancelled' ? 'cancelled' : 'failed';
    const sequence = run.nextTelemetrySequence ?? 3;
    const otelTraceId = run.otelTraceId ?? agentTraceId(run.deckId, run.id);
    const rootSpanId = run.rootSpanId ?? agentSpanId(otelTraceId, 'invoke_agent', 1);
    const decisionSpanId = agentSpanId(otelTraceId, 'human_decision', sequence);
    await ctx.db.insert('nodeslide_agent_spans', {
      id: nodeslideStableId('agent_span', run.id, decisionSpanId),
      deckId: run.deckId,
      runId: run.id,
      traceId: otelTraceId,
      spanId: decisionSpanId,
      parentSpanId: rootSpanId,
      name: status === 'completed' ? 'Accept proposal' : 'Decline proposal',
      operationName: 'agent.human_decision',
      kind: 'internal',
      status: status === 'failed' ? 'error' : 'ok',
      startTime: now,
      endTime: now,
      durationMs: 0,
      provider: run.provider,
      model: run.model,
      attributes: [
        { key: 'nodeslide.human_decision', value: status },
        { key: 'nodeslide.patch.id', value: patch.id },
      ],
      sequence,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('nodeslide_agent_events', {
      id: nodeslideStableId('agent_event', run.id, 'human_decision', status),
      deckId: run.deckId,
      runId: run.id,
      traceId: otelTraceId,
      spanId: decisionSpanId,
      name: `agent.human_decision.${status}`,
      severity: status === 'failed' ? 'error' : 'info',
      timestamp: now,
      body:
        status === 'completed'
          ? 'Human accepted the validated proposal.'
          : 'Human declined or could not apply the proposal; the deck remains unchanged.',
      attributes: [{ key: 'nodeslide.human_decision', value: status }],
      sequence: sequence + 1,
    });
    await ctx.db.patch(run._id, {
      status: runStatus,
      checkpoint: runStatus,
      updatedAt: now,
      completedAt: now,
      lastHeartbeatAt: now,
      leaseExpiresAt: now,
      nextTelemetrySequence: sequence + 2,
    });
    const root = await ctx.db
      .query('nodeslide_agent_spans')
      .withIndex('by_stable_id', (query) =>
        query.eq('id', nodeslideStableId('agent_span', run.id, rootSpanId)),
      )
      .unique();
    if (root) {
      await ctx.db.patch(root._id, {
        status: status === 'failed' ? 'error' : 'ok',
        endTime: now,
        durationMs: Math.max(0, now - root.startTime),
        updatedAt: now,
      });
    }
    await ctx.scheduler.runAfter(0, internal.nodeslideTelemetry.exportRunOtlpInternal, {
      runId: run.id,
    });
    const content =
      status === 'completed'
        ? 'Accepted and applied as a new deck version.'
        : status === 'cancelled'
          ? 'Proposal declined. The deck remains unchanged.'
          : 'Proposal could not be applied. The deck remains unchanged.';
    const messageId = nodeslideStableId('agent_message', run.id, 'decision', status);
    const existingMessage = await ctx.db
      .query('nodeslide_agent_messages')
      .withIndex('by_stable_id', (query) => query.eq('id', messageId))
      .unique();
    if (!existingMessage) {
      await ctx.db.insert('nodeslide_agent_messages', {
        id: messageId,
        deckId: patch.deckId,
        runId: run.id,
        role: 'system',
        content,
        createdAt: now,
      });
    }
  }
  return true;
}

function validationAllowsPublication(
  snapshot: DeckSnapshot,
  validation: Doc<'nodeslide_validations'> | null,
): validation is Doc<'nodeslide_validations'> {
  return Boolean(
    validation &&
      validation.deckId === snapshot.deck.id &&
      validation.deckVersion === snapshot.deck.version &&
      validation.toolchainVersion === snapshot.deck.toolchainVersion &&
      validation.publishOk,
  );
}

async function prunePublicationHistory(ctx: MutationCtx, deckId: string): Promise<void> {
  const rows = await ctx.db
    .query('nodeslide_publications')
    .withIndex('by_deck_revision', (index) => index.eq('deckId', deckId))
    .order('desc')
    .take(NODESLIDE_WORKSPACE_LIMITS.publications + 1);
  for (const row of rows.slice(NODESLIDE_WORKSPACE_LIMITS.publications)) {
    await ctx.db.delete(row._id);
  }
}

function restoredSnapshot(current: DeckSnapshot, target: DeckSnapshot, now: number): DeckSnapshot {
  const currentSlides = new Map(current.slides.map((slide) => [slide.id, slide.version]));
  const currentElements = new Map(current.elements.map((element) => [element.id, element.version]));
  return {
    deck: {
      ...structuredClone(target.deck),
      id: current.deck.id,
      projectId: current.deck.projectId,
      createdAt: current.deck.createdAt,
      updatedAt: now,
      version: current.deck.version + 1,
      status: 'ready',
      ...(current.deck.shareSlug ? { shareSlug: current.deck.shareSlug } : {}),
    },
    slides: target.slides.map((slide) => ({
      ...structuredClone(slide),
      deckId: current.deck.id,
      version: Math.max(slide.version, currentSlides.get(slide.id) ?? 0) + 1,
    })),
    elements: target.elements.map((element) => ({
      ...structuredClone(element),
      visible: element.visible ?? true,
      version: Math.max(element.version, currentElements.get(element.id) ?? 0) + 1,
    })),
    sources: target.sources.map((source) => ({
      ...structuredClone(source),
      deckId: current.deck.id,
    })),
  };
}

function validateAnchor(snapshot: DeckSnapshot, anchor: CommentAnchor) {
  if (anchor.deckId !== snapshot.deck.id) throw new Error('Comment anchor deck mismatch.');
  if (anchor.type === 'deck') return;
  if (!snapshot.slides.some((slide) => slide.id === anchor.slideId))
    throw new Error('Comment anchor slide not found.');
  if (
    anchor.type === 'element' &&
    !snapshot.elements.some(
      (element) => element.id === anchor.elementId && element.slideId === anchor.slideId,
    )
  ) {
    throw new Error('Comment anchor element not found.');
  }
  if (anchor.type === 'bounding_box' && !isNormalizedBoundingBox(anchor.bbox)) {
    throw new Error('Comment bounding box must be normalized and in bounds.');
  }
}

function requiredText(value: string, label: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (!clean) throw new Error(`${label} is required.`);
  if (clean.length > max) throw new Error(`${label} exceeds ${max} characters.`);
  return clean;
}

function requiredAgentStreamText(value: string): string {
  if (!value.trim()) throw new Error('assistant stream content is required.');
  if (value.length > NODESLIDE_ASSISTANT_STREAM_CONTENT_LIMIT) {
    throw new Error(
      `assistant stream content exceeds ${NODESLIDE_ASSISTANT_STREAM_CONTENT_LIMIT} characters.`,
    );
  }
  // Preserve provider-observed whitespace exactly so each streaming mutation
  // can prove it extends the previously persisted prefix.
  return value;
}
