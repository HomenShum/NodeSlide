import { type ComponentApi, createNodeKitCaseflowClient } from '@homenshum/nodekit/convex-caseflow';
import { v } from 'convex/values';
import { components } from './_generated/api';
import type { Doc } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx, mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { nodeslideIdDigest } from './lib/nodeslideIds';

const componentApi = (components as unknown as { nodekitCaseflow: ComponentApi<'nodekitCaseflow'> })
  .nodekitCaseflow;
const caseflow = createNodeKitCaseflowClient(componentApi);

type DbCtx = QueryCtx | MutationCtx;
type Binding = Doc<'nodeslide_nodekit_bindings'>;

const actorFor = (subject: string) => ({ id: subject, type: 'human' as const });

function requiredText(value: unknown, label: string, maxLength = 2_000): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`nodeslide_nodekit_${label}_required`);
  if (normalized.length > maxLength) throw new Error(`nodeslide_nodekit_${label}_too_long`);
  return normalized;
}

async function authenticatedSubject(ctx: DbCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('nodeslide_nodekit_unauthenticated');
  return requiredText(identity.subject, 'identity_subject', 512);
}

async function bindingForDeck(ctx: DbCtx, deckId: string): Promise<Binding> {
  const subject = await authenticatedSubject(ctx);
  const binding = await ctx.db
    .query('nodeslide_nodekit_bindings')
    .withIndex('by_deck', (q) => q.eq('deckId', deckId))
    .unique();
  if (!binding || binding.ownerSubject !== subject) {
    throw new Error('nodeslide_nodekit_owner_scope_mismatch');
  }
  return binding;
}

async function requireGeneration(ctx: DbCtx, deckId: string, generationId?: string) {
  if (!generationId) return;
  const run = await ctx.db
    .query('nodeslide_agent_runs')
    .withIndex('by_stable_id', (q) => q.eq('id', generationId))
    .unique();
  if (!run || run.deckId !== deckId) throw new Error('nodeslide_nodekit_generation_scope_mismatch');
}

async function requirePatch(ctx: DbCtx, deckId: string, patchId: string) {
  const patch = await ctx.db
    .query('nodeslide_patches')
    .withIndex('by_stable_id', (q) => q.eq('id', patchId))
    .unique();
  if (!patch || patch.deckId !== deckId) throw new Error('nodeslide_nodekit_patch_scope_mismatch');
  return patch;
}

async function requireValidation(ctx: DbCtx, deckId: string, validationRef?: string) {
  if (!validationRef) return;
  const validation = await ctx.db
    .query('nodeslide_validations')
    .withIndex('by_stable_id', (q) => q.eq('id', validationRef))
    .unique();
  if (!validation || validation.deckId !== deckId) {
    throw new Error('nodeslide_nodekit_validation_scope_mismatch');
  }
}

async function requireDomainReceipt(ctx: DbCtx, deckId: string, receiptId?: string) {
  if (!receiptId) return;
  const receipt = await ctx.db
    .query('nodeslide_package_receipts')
    .withIndex('by_stable_id', (q) => q.eq('receiptId', receiptId))
    .unique();
  if (!receipt || receipt.deckId !== deckId) {
    throw new Error('nodeslide_nodekit_domain_receipt_scope_mismatch');
  }
}

/**
 * One-time bridge from NodeSlide's existing preview owner capability to an
 * authenticated component scope. The bearer is verified and then discarded.
 */
export const bindAuthenticatedDeck = mutation({
  args: { deckId: v.string(), ownerAccessKey: v.string() },
  handler: async (ctx, args) => {
    const subject = await authenticatedSubject(ctx);
    const deckId = requiredText(args.deckId, 'deck_id', 256);
    await requireOwnerAccess(ctx, deckId, args.ownerAccessKey);
    const existing = await ctx.db
      .query('nodeslide_nodekit_bindings')
      .withIndex('by_deck', (q) => q.eq('deckId', deckId))
      .unique();
    if (existing) {
      if (existing.ownerSubject !== subject) {
        throw new Error('nodeslide_nodekit_deck_already_bound');
      }
      return { deckId, scopeKey: existing.scopeKey, reused: true };
    }
    const now = Date.now();
    const scopeKey = `nodeslide_${nodeslideIdDigest(
      ['nodekit-caseflow-v1', subject, deckId].join('\u001f'),
    )}`;
    await ctx.db.insert('nodeslide_nodekit_bindings', {
      deckId,
      ownerSubject: subject,
      scopeKey,
      createdAt: now,
      updatedAt: now,
    });
    return { deckId, scopeKey, reused: false };
  },
});

const deckArg = { deckId: v.string() };

export const createCase = mutation({
  args: { ...deckArg, title: v.string(), primaryJob: v.string() },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    if (binding.caseId) {
      const existing = await caseflow.getCase(ctx, {
        caseId: binding.caseId,
        scopeKey: binding.scopeKey,
      });
      if (existing) return existing;
    }
    const created = await caseflow.createCase(ctx, {
      actor: actorFor(binding.ownerSubject),
      primaryJob: args.primaryJob,
      scopeKey: binding.scopeKey,
      title: args.title,
    });
    await ctx.db.patch(binding._id, { caseId: created.caseId, updatedAt: Date.now() });
    return created;
  },
});

export const updateCaseInput = mutation({
  args: {
    ...deckArg,
    caseId: v.string(),
    title: v.optional(v.string()),
    primaryJob: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    return caseflow.updateCaseInput(ctx, {
      actor: actorFor(binding.ownerSubject),
      caseId: args.caseId,
      scopeKey: binding.scopeKey,
      ...(args.title === undefined ? {} : { title: args.title }),
      ...(args.primaryJob === undefined ? {} : { primaryJob: args.primaryJob }),
    });
  },
});

export const startRun = mutation({
  args: {
    ...deckArg,
    caseId: v.string(),
    generationId: v.optional(v.string()),
    stages: v.array(v.object({ id: v.string(), label: v.string(), owner: v.string() })),
  },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    await requireGeneration(ctx, args.deckId, args.generationId);
    const run = await caseflow.startRun(ctx, {
      actor: actorFor(binding.ownerSubject),
      caseId: args.caseId,
      scopeKey: binding.scopeKey,
      stages: args.stages,
    });
    await ctx.db.patch(binding._id, { currentRunId: run.runId, updatedAt: Date.now() });
    return run;
  },
});

export const enterStage = mutation({
  args: {
    ...deckArg,
    runId: v.string(),
    stageId: v.string(),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    return caseflow.enterStage(ctx, {
      actor: actorFor(binding.ownerSubject),
      runId: args.runId,
      scopeKey: binding.scopeKey,
      stageId: args.stageId,
      ...(args.nextAction === undefined ? {} : { nextAction: args.nextAction }),
      ...(args.nextActionOwner === undefined ? {} : { nextActionOwner: args.nextActionOwner }),
      ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
    });
  },
});

export const createArtifact = mutation({
  args: {
    ...deckArg,
    caseId: v.string(),
    runId: v.string(),
    title: v.optional(v.string()),
    generationId: v.optional(v.string()),
    domainArtifactRef: v.optional(v.string()),
    content: v.any(),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    await requireGeneration(ctx, args.deckId, args.generationId);
    if (
      !args.content ||
      typeof args.content !== 'object' ||
      Array.isArray(args.content) ||
      (args.content as { deckId?: unknown }).deckId !== args.deckId
    ) {
      throw new Error('nodeslide_nodekit_artifact_deck_binding_required');
    }
    const artifactContent = args.content as {
      domainArtifactRef?: unknown;
      generationId?: unknown;
    };
    if (
      (args.domainArtifactRef && artifactContent.domainArtifactRef !== args.domainArtifactRef) ||
      (args.generationId && artifactContent.generationId !== args.generationId)
    ) {
      throw new Error('nodeslide_nodekit_artifact_domain_reference_mismatch');
    }
    const artifact = await caseflow.createArtifact(ctx, {
      actor: actorFor(binding.ownerSubject),
      caseId: args.caseId,
      content: args.content,
      kind: 'presentation',
      runId: args.runId,
      scopeKey: binding.scopeKey,
      title: args.title ?? 'NodeSlide deck',
      ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
    });
    await ctx.db.patch(binding._id, { artifactId: artifact.artifactId, updatedAt: Date.now() });
    return artifact;
  },
});

export const createProposal = mutation({
  args: {
    ...deckArg,
    artifactId: v.string(),
    baseVersion: v.number(),
    patchId: v.string(),
    rationale: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    const patch = await requirePatch(ctx, args.deckId, args.patchId);
    const patchCommand = Object.fromEntries(
      Object.entries(patch).filter(
        ([key]) => !['_id', '_creationTime', 'status', 'createdAt', 'updatedAt'].includes(key),
      ),
    );
    return caseflow.createProposal(ctx, {
      actor: actorFor(binding.ownerSubject),
      artifactId: args.artifactId,
      baseVersion: args.baseVersion,
      patch: patchCommand,
      rationale: args.rationale ?? 'Review the bounded NodeSlide deck patch.',
      scopeKey: binding.scopeKey,
      ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
    });
  },
});

export const decideProposal = mutation({
  args: {
    ...deckArg,
    proposalId: v.string(),
    decision: v.union(v.literal('accepted'), v.literal('rejected')),
    comment: v.optional(v.string()),
    domainReceiptRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    await requireDomainReceipt(ctx, args.deckId, args.domainReceiptRef);
    const comment = [
      args.domainReceiptRef ? `NodeSlide receipt: ${args.domainReceiptRef}` : '',
      args.comment?.trim() ?? '',
    ]
      .filter(Boolean)
      .join(' | ');
    return caseflow.decideProposal(ctx, {
      actor: actorFor(binding.ownerSubject),
      decision: args.decision,
      proposalId: args.proposalId,
      scopeKey: binding.scopeKey,
      ...(comment ? { comment } : {}),
    });
  },
});

export const raiseException = mutation({
  args: {
    ...deckArg,
    runId: v.string(),
    code: v.optional(v.string()),
    message: v.optional(v.string()),
    preservedState: v.optional(v.any()),
    validationRef: v.optional(v.string()),
    idempotencyKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    await requireValidation(ctx, args.deckId, args.validationRef);
    return caseflow.raiseException(ctx, {
      actor: actorFor(binding.ownerSubject),
      code: args.code ?? 'nodeslide_validation_attention',
      message: args.message ?? 'NodeSlide validation requires attention.',
      preservedState: {
        schemaVersion: 'nodeslide.exception-state/v1',
        deckId: args.deckId,
        validationRef: args.validationRef ?? null,
        state: args.preservedState ?? null,
      },
      runId: args.runId,
      scopeKey: binding.scopeKey,
      ...(args.idempotencyKey === undefined ? {} : { idempotencyKey: args.idempotencyKey }),
    });
  },
});

export const resolveException = mutation({
  args: {
    ...deckArg,
    exceptionId: v.string(),
    resolution: v.optional(v.string()),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    return caseflow.resolveException(ctx, {
      actor: actorFor(binding.ownerSubject),
      exceptionId: args.exceptionId,
      scopeKey: binding.scopeKey,
      ...(args.resolution === undefined ? {} : { resolution: args.resolution }),
      ...(args.nextAction === undefined ? {} : { nextAction: args.nextAction }),
      ...(args.nextActionOwner === undefined ? {} : { nextActionOwner: args.nextActionOwner }),
    });
  },
});

export const completeRun = mutation({
  args: { ...deckArg, runId: v.string() },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    return caseflow.completeRun(ctx, {
      actor: actorFor(binding.ownerSubject),
      runId: args.runId,
      scopeKey: binding.scopeKey,
    });
  },
});

export const cancelRun = mutation({
  args: { ...deckArg, runId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    return caseflow.cancelRun(ctx, {
      actor: actorFor(binding.ownerSubject),
      runId: args.runId,
      scopeKey: binding.scopeKey,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
    });
  },
});

export const failRunSafely = mutation({
  args: { ...deckArg, runId: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    return caseflow.failRunSafely(ctx, {
      actor: actorFor(binding.ownerSubject),
      runId: args.runId,
      scopeKey: binding.scopeKey,
      ...(args.reason === undefined ? {} : { reason: args.reason }),
    });
  },
});

/** A product-facing projection for the one authoritative deck case. */
export const snapshot = query({
  args: deckArg,
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    const [caseRow, run, artifact, receipt, pending] = await Promise.all([
      binding.caseId
        ? caseflow.getCase(ctx, { caseId: binding.caseId, scopeKey: binding.scopeKey })
        : null,
      binding.currentRunId
        ? caseflow.getRun(ctx, { runId: binding.currentRunId, scopeKey: binding.scopeKey })
        : null,
      binding.artifactId
        ? caseflow.getArtifact(ctx, {
            artifactId: binding.artifactId,
            scopeKey: binding.scopeKey,
          })
        : null,
      binding.currentRunId
        ? caseflow.getReceiptForRun(ctx, {
            runId: binding.currentRunId,
            scopeKey: binding.scopeKey,
          })
        : null,
      caseflow.listPendingApprovals(ctx, { scopeKey: binding.scopeKey, limit: 100 }),
    ]);
    const events = run
      ? await caseflow.getTimeline(ctx, {
          aggregateId: run.runId,
          aggregateType: 'run',
          limit: 100,
          scopeKey: binding.scopeKey,
        })
      : [];
    return {
      approvals: [],
      artifacts: artifact ? [artifact] : [],
      cases: caseRow ? [caseRow] : [],
      events,
      exceptions: [],
      proposals: pending,
      receipts: receipt ? [receipt] : [],
      runs: run ? [run] : [],
    };
  },
});

export const getReceipt = query({
  args: { ...deckArg, runId: v.string() },
  handler: async (ctx, args) => {
    const binding = await bindingForDeck(ctx, args.deckId);
    return caseflow.getReceiptForRun(ctx, { runId: args.runId, scopeKey: binding.scopeKey });
  },
});
