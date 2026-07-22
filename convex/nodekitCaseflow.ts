import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { type MutationCtx, type QueryCtx, mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';

const SCHEMA = {
  approval: 'nodekit.approval/v1',
  artifact: 'nodekit.artifact/v1',
  case: 'nodekit.case/v1',
  event: 'nodekit.caseflow-event/v1',
  exception: 'nodekit.exception/v1',
  proposal: 'nodekit.proposal/v1',
  receipt: 'nodekit.receipt/v1',
  run: 'nodekit.run/v1',
} as const;

const TERMINAL_RUN_STATUSES = new Set(['cancelled', 'completed', 'failed_safely']);
const MAX_TITLE = 200;
const MAX_JOB = 2_000;
const MAX_TEXT = 2_000;
const MAX_STAGE_TEXT = 160;
const MAX_STAGES = 32;

type DbCtx = QueryCtx | MutationCtx;
type IdentityScope = {
  subject: string;
  workspace: Doc<'nodekitCaseflowWorkspaces'>;
};
type OwnedRow = {
  workspaceId: Id<'nodekitCaseflowWorkspaces'>;
  ownerSubject: string;
};

function requiredText(value: unknown, label: string, maxLength: number): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`nodekit_caseflow_${label}_required`);
  if (normalized.length > maxLength) throw new Error(`nodekit_caseflow_${label}_too_long`);
  return normalized;
}

function optionalText(value: unknown, maxLength: number): string {
  const normalized = String(value ?? '').trim();
  if (normalized.length > maxLength) throw new Error('nodekit_caseflow_text_too_long');
  return normalized;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error('nodekit_caseflow_value_not_json');
  return serialized;
}

async function contentHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalJson(value)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function authenticatedSubject(ctx: DbCtx): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('nodekit_caseflow_unauthenticated');
  return requiredText(identity.subject, 'identity_subject', 512);
}

async function requireScope(
  ctx: DbCtx,
  workspaceId: Id<'nodekitCaseflowWorkspaces'>,
): Promise<IdentityScope> {
  const subject = await authenticatedSubject(ctx);
  const workspace = await ctx.db.get(workspaceId);
  if (!workspace || workspace.ownerSubject !== subject) {
    throw new Error('nodekit_caseflow_workspace_owner_mismatch');
  }
  return { subject, workspace };
}

function requireOwned<T extends OwnedRow>(scope: IdentityScope, row: T | null): T {
  if (
    !row ||
    String(row.workspaceId) !== String(scope.workspace._id) ||
    row.ownerSubject !== scope.subject
  ) {
    throw new Error('nodekit_caseflow_owner_scope_mismatch');
  }
  return row;
}

async function requireDeckBinding(ctx: DbCtx, scope: IdentityScope, deckId: string) {
  const binding = await ctx.db
    .query('nodekitCaseflowDeckBindings')
    .withIndex('by_workspace_deck', (q) =>
      q.eq('workspaceId', scope.workspace._id).eq('deckId', deckId),
    )
    .unique();
  return requireOwned(scope, binding);
}

async function emit(
  ctx: MutationCtx,
  scope: IdentityScope,
  input: {
    runId?: Id<'nodekitCaseflowRuns'>;
    aggregateType: string;
    aggregateId: string;
    eventType: string;
    payload?: unknown;
    occurredAt?: number;
  },
) {
  const previous = await ctx.db
    .query('nodekitCaseflowEvents')
    .withIndex('by_aggregate_sequence', (q) => q.eq('aggregateId', input.aggregateId))
    .order('desc')
    .first();
  return ctx.db.insert('nodekitCaseflowEvents', {
    workspaceId: scope.workspace._id,
    ownerSubject: scope.subject,
    runId: input.runId,
    schemaVersion: SCHEMA.event,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventType: input.eventType,
    sequence: (previous?.sequence ?? 0) + 1,
    payload: input.payload ?? {},
    occurredAt: input.occurredAt ?? Date.now(),
  });
}

function portableCase(row: Doc<'nodekitCaseflowCases'>) {
  return {
    caseId: String(row._id),
    createdAt: iso(row.createdAt),
    currentRunId: row.currentRunId ? String(row.currentRunId) : null,
    deckId: row.deckId,
    primaryJob: row.primaryJob,
    schemaVersion: row.schemaVersion,
    status: row.status,
    title: row.title,
    updatedAt: iso(row.updatedAt),
    workspaceId: String(row.workspaceId),
  };
}

function portableRun(row: Doc<'nodekitCaseflowRuns'>) {
  return {
    caseId: String(row.caseId),
    createdAt: iso(row.createdAt),
    currentStageId: row.currentStageId,
    generationId: row.generationId,
    nextAction: row.nextAction,
    nextActionOwner: row.nextActionOwner,
    runId: String(row._id),
    schemaVersion: row.schemaVersion,
    stages: row.stages,
    status: row.status,
    updatedAt: iso(row.updatedAt),
  };
}

async function portableArtifact(ctx: DbCtx, row: Doc<'nodekitCaseflowArtifacts'>) {
  const versions = await ctx.db
    .query('nodekitCaseflowArtifactVersions')
    .withIndex('by_artifact_version', (q) => q.eq('artifactId', row._id))
    .collect();
  return {
    artifactId: String(row._id),
    canonicalVersion: row.canonicalVersion,
    caseId: String(row.caseId),
    createdAt: iso(row.createdAt),
    deckId: row.deckId,
    domainArtifactRef: row.domainArtifactRef,
    kind: row.kind,
    runId: String(row.runId),
    schemaVersion: row.schemaVersion,
    title: row.title,
    updatedAt: iso(row.updatedAt),
    versions: versions.map((version) => ({
      content: version.content,
      contentHash: version.contentHash,
      createdAt: iso(version.createdAt),
      ...(version.proposalId ? { proposalId: String(version.proposalId) } : {}),
      version: version.version,
    })),
  };
}

function portableProposal(row: Doc<'nodekitCaseflowProposals'>) {
  return {
    artifactId: String(row.artifactId),
    baseVersion: row.baseVersion,
    createdAt: iso(row.createdAt),
    patch: row.patch,
    ...(row.patchId ? { patchId: row.patchId } : {}),
    proposalId: String(row._id),
    rationale: row.rationale,
    schemaVersion: row.schemaVersion,
    status: row.status,
  };
}

function portableApproval(row: Doc<'nodekitCaseflowApprovals'>) {
  return {
    approvalId: String(row._id),
    comment: row.comment,
    decidedAt: iso(row.decidedAt),
    decision: row.decision,
    ...(row.domainReceiptRef ? { domainReceiptRef: row.domainReceiptRef } : {}),
    proposalId: String(row.proposalId),
    schemaVersion: row.schemaVersion,
  };
}

function portableException(row: Doc<'nodekitCaseflowExceptions'>) {
  return {
    code: row.code,
    exceptionId: String(row._id),
    message: row.message,
    preservedState: row.preservedState,
    raisedAt: iso(row.raisedAt),
    resolution: row.resolution ?? null,
    runId: String(row.runId),
    schemaVersion: row.schemaVersion,
    status: row.status,
    ...(row.validationRef ? { validationRef: row.validationRef } : {}),
    ...(row.resolvedAt ? { resolvedAt: iso(row.resolvedAt) } : {}),
  };
}

function portableEvent(row: Doc<'nodekitCaseflowEvents'>) {
  return {
    actor: { type: 'user', id: row.ownerSubject },
    aggregateId: row.aggregateId,
    aggregateType: row.aggregateType,
    eventId: String(row._id),
    eventType: row.eventType,
    occurredAt: iso(row.occurredAt),
    payload: row.payload,
    schemaVersion: row.schemaVersion,
    sequence: row.sequence,
  };
}

function portableReceipt(row: Doc<'nodekitCaseflowReceipts'>) {
  return {
    ...(row.body as Record<string, unknown>),
    receiptHash: row.receiptHash,
    receiptId: String(row._id),
  };
}

async function ownedCase(ctx: DbCtx, scope: IdentityScope, caseId: Id<'nodekitCaseflowCases'>) {
  return requireOwned(scope, await ctx.db.get(caseId));
}

async function ownedRun(ctx: DbCtx, scope: IdentityScope, runId: Id<'nodekitCaseflowRuns'>) {
  return requireOwned(scope, await ctx.db.get(runId));
}

async function ownedArtifact(
  ctx: DbCtx,
  scope: IdentityScope,
  artifactId: Id<'nodekitCaseflowArtifacts'>,
) {
  return requireOwned(scope, await ctx.db.get(artifactId));
}

async function ownedProposal(
  ctx: DbCtx,
  scope: IdentityScope,
  proposalId: Id<'nodekitCaseflowProposals'>,
) {
  return requireOwned(scope, await ctx.db.get(proposalId));
}

async function ownedException(
  ctx: DbCtx,
  scope: IdentityScope,
  exceptionId: Id<'nodekitCaseflowExceptions'>,
) {
  return requireOwned(scope, await ctx.db.get(exceptionId));
}

export const ensureWorkspace = mutation({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const subject = await authenticatedSubject(ctx);
    const slug = requiredText(args.slug, 'workspace_slug', 128);
    const existing = await ctx.db
      .query('nodekitCaseflowWorkspaces')
      .withIndex('by_owner_slug', (q) => q.eq('ownerSubject', subject).eq('slug', slug))
      .unique();
    if (existing) return { workspaceId: String(existing._id), reused: true };
    const identity = await ctx.auth.getUserIdentity();
    const organizationId =
      typeof (identity as Record<string, unknown> | null)?.['organization_id'] === 'string'
        ? String((identity as Record<string, unknown>)['organization_id'])
        : undefined;
    const now = Date.now();
    const workspaceId = await ctx.db.insert('nodekitCaseflowWorkspaces', {
      slug,
      ownerSubject: subject,
      ...(organizationId ? { organizationId } : {}),
      createdAt: now,
      updatedAt: now,
    });
    return { workspaceId: String(workspaceId), reused: false };
  },
});

/**
 * One-time bridge for the current anonymous preview workspace. The bearer
 * capability is checked here and is never persisted. Every normal Caseflow
 * operation after this point authorizes exclusively through ctx.auth.
 */
export const bootstrapPreviewDeckBinding = mutation({
  args: {
    workspaceId: v.id('nodekitCaseflowWorkspaces'),
    deckId: v.string(),
    ownerAccessKey: v.string(),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    const existing = await ctx.db
      .query('nodekitCaseflowDeckBindings')
      .withIndex('by_workspace_deck', (q) =>
        q.eq('workspaceId', scope.workspace._id).eq('deckId', deck.id),
      )
      .unique();
    if (existing) {
      requireOwned(scope, existing);
      return { bindingId: String(existing._id), deckId: existing.deckId, reused: true };
    }
    const crossWorkspace = await ctx.db
      .query('nodekitCaseflowDeckBindings')
      .withIndex('by_deck', (q) => q.eq('deckId', deck.id))
      .first();
    if (crossWorkspace) throw new Error('nodekit_caseflow_deck_already_bound');
    const bindingId = await ctx.db.insert('nodekitCaseflowDeckBindings', {
      workspaceId: scope.workspace._id,
      ownerSubject: scope.subject,
      deckId: deck.id,
      bindingMethod: 'preview_capability_claim',
      createdAt: Date.now(),
    });
    return { bindingId: String(bindingId), deckId: deck.id, reused: false };
  },
});

const workspaceArg = { workspaceId: v.id('nodekitCaseflowWorkspaces') };

export const createCase = mutation({
  args: {
    ...workspaceArg,
    deckId: v.string(),
    title: v.string(),
    primaryJob: v.string(),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const binding = await requireDeckBinding(ctx, scope, args.deckId);
    const now = Date.now();
    const caseId = await ctx.db.insert('nodekitCaseflowCases', {
      workspaceId: scope.workspace._id,
      ownerSubject: scope.subject,
      deckId: binding.deckId,
      schemaVersion: SCHEMA.case,
      title: requiredText(args.title, 'case_title', MAX_TITLE),
      primaryJob: requiredText(args.primaryJob, 'primary_job', MAX_JOB),
      status: 'ready',
      createdAt: now,
      updatedAt: now,
    });
    const row = await ctx.db.get(caseId);
    if (!row) throw new Error('nodekit_caseflow_case_insert_failed');
    await emit(ctx, scope, {
      aggregateType: 'case',
      aggregateId: String(caseId),
      eventType: 'case.created',
      payload: portableCase(row),
      occurredAt: now,
    });
    return portableCase(row);
  },
});

const stageValidator = v.object({
  id: v.optional(v.string()),
  label: v.optional(v.string()),
  owner: v.optional(v.string()),
});

export const startRun = mutation({
  args: {
    ...workspaceArg,
    caseId: v.id('nodekitCaseflowCases'),
    generationId: v.optional(v.string()),
    stages: v.array(stageValidator),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const caseRow = await ownedCase(ctx, scope, args.caseId);
    if (caseRow.currentRunId) {
      const current = await ctx.db.get(caseRow.currentRunId);
      if (current && !TERMINAL_RUN_STATUSES.has(current.status)) return portableRun(current);
    }
    if (args.stages.length === 0) throw new Error('nodekit_caseflow_run_stages_required');
    if (args.stages.length > MAX_STAGES) throw new Error('nodekit_caseflow_too_many_stages');
    const seen = new Set<string>();
    const stages = args.stages.map((stage, index) => {
      const id = requiredText(stage.id ?? `stage-${index + 1}`, 'stage_id', MAX_STAGE_TEXT);
      if (seen.has(id)) throw new Error('nodekit_caseflow_duplicate_stage_id');
      seen.add(id);
      return {
        id,
        label: requiredText(
          stage.label ?? stage.id ?? `Stage ${index + 1}`,
          'stage_label',
          MAX_STAGE_TEXT,
        ),
        owner: optionalText(stage.owner ?? 'system', MAX_STAGE_TEXT) || 'system',
        status: (index === 0 ? 'active' : 'pending') as 'active' | 'pending',
      };
    });
    const generationId =
      optionalText(args.generationId, 256) || `nodekit:generation:${String(caseRow._id)}`;
    if (args.generationId) {
      const domainRun = await ctx.db
        .query('nodeslide_agent_runs')
        .withIndex('by_stable_id', (q) => q.eq('id', generationId))
        .unique();
      if (!domainRun || domainRun.deckId !== caseRow.deckId) {
        throw new Error('nodekit_caseflow_generation_scope_mismatch');
      }
    }
    const now = Date.now();
    const runId = await ctx.db.insert('nodekitCaseflowRuns', {
      workspaceId: scope.workspace._id,
      ownerSubject: scope.subject,
      caseId: caseRow._id,
      generationId,
      schemaVersion: SCHEMA.run,
      status: 'active',
      stages,
      currentStageId: stages[0].id,
      nextAction: stages[0].label,
      nextActionOwner: stages[0].owner,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch(caseRow._id, { currentRunId: runId, status: 'in_progress', updatedAt: now });
    const run = await ctx.db.get(runId);
    if (!run) throw new Error('nodekit_caseflow_run_insert_failed');
    await emit(ctx, scope, {
      runId,
      aggregateType: 'run',
      aggregateId: String(runId),
      eventType: 'run.started',
      payload: portableRun(run),
      occurredAt: now,
    });
    await emit(ctx, scope, {
      runId,
      aggregateType: 'run',
      aggregateId: String(runId),
      eventType: 'stage.entered',
      payload: { stageId: run.currentStageId },
      occurredAt: now,
    });
    return portableRun(run);
  },
});

export const enterStage = mutation({
  args: {
    ...workspaceArg,
    runId: v.id('nodekitCaseflowRuns'),
    stageId: v.string(),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const run = await ownedRun(ctx, scope, args.runId);
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error(`nodekit_caseflow_run_terminal:${run.status}`);
    }
    const targetIndex = run.stages.findIndex((stage) => stage.id === args.stageId);
    if (targetIndex < 0) throw new Error('nodekit_caseflow_stage_not_found');
    const stages = run.stages.map((stage, index) => ({
      ...stage,
      status: (index < targetIndex ? 'completed' : index === targetIndex ? 'active' : 'pending') as
        | 'completed'
        | 'active'
        | 'pending',
    }));
    const nextAction =
      optionalText(args.nextAction ?? stages[targetIndex].label, MAX_STAGE_TEXT) ||
      stages[targetIndex].label;
    const nextActionOwner =
      optionalText(args.nextActionOwner ?? stages[targetIndex].owner, MAX_STAGE_TEXT) ||
      stages[targetIndex].owner;
    const now = Date.now();
    await ctx.db.patch(run._id, {
      stages,
      currentStageId: args.stageId,
      nextAction,
      nextActionOwner,
      updatedAt: now,
    });
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: 'run',
      aggregateId: String(run._id),
      eventType: 'stage.entered',
      payload: { stageId: args.stageId, nextAction, nextActionOwner },
      occurredAt: now,
    });
    const updated = await ctx.db.get(run._id);
    if (!updated) throw new Error('nodekit_caseflow_run_missing_after_stage');
    return portableRun(updated);
  },
});

export const createArtifact = mutation({
  args: {
    ...workspaceArg,
    caseId: v.id('nodekitCaseflowCases'),
    runId: v.id('nodekitCaseflowRuns'),
    kind: v.optional(v.string()),
    title: v.string(),
    content: v.any(),
    domainArtifactRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const [caseRow, run] = await Promise.all([
      ownedCase(ctx, scope, args.caseId),
      ownedRun(ctx, scope, args.runId),
    ]);
    if (String(run.caseId) !== String(caseRow._id)) {
      throw new Error('nodekit_caseflow_run_case_mismatch');
    }
    const now = Date.now();
    const artifactId = await ctx.db.insert('nodekitCaseflowArtifacts', {
      workspaceId: scope.workspace._id,
      ownerSubject: scope.subject,
      caseId: caseRow._id,
      runId: run._id,
      deckId: caseRow.deckId,
      domainArtifactRef:
        optionalText(args.domainArtifactRef, 512) || `nodeslide:deck:${caseRow.deckId}`,
      schemaVersion: SCHEMA.artifact,
      kind: optionalText(args.kind ?? 'presentation', 128) || 'presentation',
      title: requiredText(args.title, 'artifact_title', MAX_TITLE),
      canonicalVersion: 1,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.insert('nodekitCaseflowArtifactVersions', {
      artifactId,
      version: 1,
      content: args.content,
      contentHash: await contentHash(args.content),
      createdAt: now,
    });
    const artifact = await ctx.db.get(artifactId);
    if (!artifact) throw new Error('nodekit_caseflow_artifact_insert_failed');
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: 'artifact',
      aggregateId: String(artifactId),
      eventType: 'artifact.created',
      payload: { artifactId: String(artifactId), deckId: caseRow.deckId, version: 1 },
      occurredAt: now,
    });
    return portableArtifact(ctx, artifact);
  },
});

export const createProposal = mutation({
  args: {
    ...workspaceArg,
    artifactId: v.id('nodekitCaseflowArtifacts'),
    baseVersion: v.number(),
    patch: v.any(),
    patchId: v.optional(v.string()),
    rationale: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const artifact = await ownedArtifact(ctx, scope, args.artifactId);
    if (!Number.isSafeInteger(args.baseVersion) || args.baseVersion < 1) {
      throw new Error('nodekit_caseflow_base_version_invalid');
    }
    if (args.baseVersion !== artifact.canonicalVersion) {
      throw new Error(
        `proposal base version ${args.baseVersion} is stale; canonical version is ${artifact.canonicalVersion}`,
      );
    }
    const inferredPatchId =
      args.patch &&
      typeof args.patch === 'object' &&
      typeof (args.patch as Record<string, unknown>)['id'] === 'string'
        ? String((args.patch as Record<string, unknown>)['id'])
        : undefined;
    const patchId = optionalText(args.patchId ?? inferredPatchId, 256) || undefined;
    if (patchId) {
      const domainPatch = await ctx.db
        .query('nodeslide_patches')
        .withIndex('by_stable_id', (q) => q.eq('id', patchId))
        .unique();
      if (!domainPatch || domainPatch.deckId !== artifact.deckId) {
        throw new Error('nodekit_caseflow_patch_scope_mismatch');
      }
    }
    const now = Date.now();
    const proposalId = await ctx.db.insert('nodekitCaseflowProposals', {
      workspaceId: scope.workspace._id,
      ownerSubject: scope.subject,
      artifactId: artifact._id,
      ...(patchId ? { patchId } : {}),
      schemaVersion: SCHEMA.proposal,
      baseVersion: args.baseVersion,
      patch: args.patch,
      patchHash: await contentHash(args.patch),
      rationale: optionalText(args.rationale, MAX_TEXT),
      status: 'pending',
      createdAt: now,
    });
    const proposal = await ctx.db.get(proposalId);
    if (!proposal) throw new Error('nodekit_caseflow_proposal_insert_failed');
    await emit(ctx, scope, {
      runId: artifact.runId,
      aggregateType: 'proposal',
      aggregateId: String(proposalId),
      eventType: 'proposal.created',
      payload: portableProposal(proposal),
      occurredAt: now,
    });
    return portableProposal(proposal);
  },
});

export const decideProposal = mutation({
  args: {
    ...workspaceArg,
    proposalId: v.id('nodekitCaseflowProposals'),
    decision: v.union(v.literal('accepted'), v.literal('rejected')),
    comment: v.optional(v.string()),
    domainReceiptRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const proposal = await ownedProposal(ctx, scope, args.proposalId);
    const artifact = await ownedArtifact(ctx, scope, proposal.artifactId);
    const domainReceiptRef = optionalText(args.domainReceiptRef, 256) || undefined;
    if (domainReceiptRef) {
      const domainReceipt = await ctx.db
        .query('nodeslide_package_receipts')
        .withIndex('by_stable_id', (q) => q.eq('receiptId', domainReceiptRef))
        .unique();
      if (!domainReceipt || domainReceipt.deckId !== artifact.deckId) {
        throw new Error('nodekit_caseflow_domain_receipt_scope_mismatch');
      }
    }
    if (proposal.status !== 'pending') {
      const approval = await ctx.db
        .query('nodekitCaseflowApprovals')
        .withIndex('by_proposal', (q) => q.eq('proposalId', proposal._id))
        .unique();
      const matches =
        approval?.decision === args.decision &&
        (proposal.status === args.decision ||
          (proposal.status === 'conflicted' && args.decision === 'accepted'));
      if (!approval || !matches) throw new Error(`proposal is already ${proposal.status}`);
      return {
        approval: portableApproval(approval),
        artifact: await portableArtifact(ctx, artifact),
        proposal: portableProposal(proposal),
        reused: true,
      };
    }
    const now = Date.now();
    const approvalId = await ctx.db.insert('nodekitCaseflowApprovals', {
      workspaceId: scope.workspace._id,
      ownerSubject: scope.subject,
      proposalId: proposal._id,
      ...(domainReceiptRef ? { domainReceiptRef } : {}),
      schemaVersion: SCHEMA.approval,
      decision: args.decision,
      comment: optionalText(args.comment, MAX_TEXT),
      decidedAt: now,
    });
    if (args.decision === 'accepted' && proposal.baseVersion !== artifact.canonicalVersion) {
      await ctx.db.patch(proposal._id, { status: 'conflicted', decidedAt: now });
      await emit(ctx, scope, {
        runId: artifact.runId,
        aggregateType: 'proposal',
        aggregateId: String(proposal._id),
        eventType: 'proposal.conflicted',
        payload: { canonicalVersion: artifact.canonicalVersion },
        occurredAt: now,
      });
    } else {
      await ctx.db.patch(proposal._id, { status: args.decision, decidedAt: now });
      if (args.decision === 'accepted') {
        const nextVersion = artifact.canonicalVersion + 1;
        await ctx.db.patch(artifact._id, { canonicalVersion: nextVersion, updatedAt: now });
        await ctx.db.insert('nodekitCaseflowArtifactVersions', {
          artifactId: artifact._id,
          version: nextVersion,
          content: proposal.patch,
          contentHash: proposal.patchHash,
          proposalId: proposal._id,
          createdAt: now,
        });
        await emit(ctx, scope, {
          runId: artifact.runId,
          aggregateType: 'artifact',
          aggregateId: String(artifact._id),
          eventType: 'artifact.version_created',
          payload: { proposalId: String(proposal._id), version: nextVersion },
          occurredAt: now,
        });
      }
      await emit(ctx, scope, {
        runId: artifact.runId,
        aggregateType: 'proposal',
        aggregateId: String(proposal._id),
        eventType: `proposal.${args.decision}`,
        payload: { approvalId: String(approvalId), domainReceiptRef },
        occurredAt: now,
      });
    }
    const [approval, updatedArtifact, updatedProposal] = await Promise.all([
      ctx.db.get(approvalId),
      ctx.db.get(artifact._id),
      ctx.db.get(proposal._id),
    ]);
    if (!approval || !updatedArtifact || !updatedProposal) {
      throw new Error('nodekit_caseflow_decision_missing');
    }
    return {
      approval: portableApproval(approval),
      artifact: await portableArtifact(ctx, updatedArtifact),
      proposal: portableProposal(updatedProposal),
      reused: false,
    };
  },
});

export const raiseException = mutation({
  args: {
    ...workspaceArg,
    runId: v.id('nodekitCaseflowRuns'),
    code: v.string(),
    message: v.string(),
    preservedState: v.any(),
    validationRef: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const run = await ownedRun(ctx, scope, args.runId);
    const caseRow = await ownedCase(ctx, scope, run.caseId);
    const validationRef = optionalText(args.validationRef, 256) || undefined;
    if (validationRef) {
      const validation = await ctx.db
        .query('nodeslide_validations')
        .withIndex('by_stable_id', (q) => q.eq('id', validationRef))
        .unique();
      if (!validation || validation.deckId !== caseRow.deckId) {
        throw new Error('nodekit_caseflow_validation_scope_mismatch');
      }
    }
    const now = Date.now();
    const exceptionId = await ctx.db.insert('nodekitCaseflowExceptions', {
      workspaceId: scope.workspace._id,
      ownerSubject: scope.subject,
      runId: run._id,
      ...(validationRef ? { validationRef } : {}),
      schemaVersion: SCHEMA.exception,
      code: requiredText(args.code, 'exception_code', 256),
      message: requiredText(args.message, 'exception_message', MAX_TEXT),
      preservedState: args.preservedState,
      status: 'open',
      raisedAt: now,
    });
    await ctx.db.patch(run._id, {
      status: 'blocked',
      nextAction: 'Resolve exception',
      nextActionOwner: 'user',
      updatedAt: now,
    });
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: 'run',
      aggregateId: String(run._id),
      eventType: 'exception.raised',
      payload: { code: args.code, exceptionId: String(exceptionId), validationRef },
      occurredAt: now,
    });
    const exception = await ctx.db.get(exceptionId);
    if (!exception) throw new Error('nodekit_caseflow_exception_insert_failed');
    return portableException(exception);
  },
});

export const resolveException = mutation({
  args: {
    ...workspaceArg,
    exceptionId: v.id('nodekitCaseflowExceptions'),
    resolution: v.optional(v.string()),
    nextAction: v.optional(v.string()),
    nextActionOwner: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const exception = await ownedException(ctx, scope, args.exceptionId);
    const run = await ownedRun(ctx, scope, exception.runId);
    if (exception.status === 'resolved') {
      return { exception: portableException(exception), run: portableRun(run), reused: true };
    }
    const now = Date.now();
    const resolution = optionalText(args.resolution ?? 'resolved', MAX_TEXT) || 'resolved';
    const nextAction =
      optionalText(args.nextAction ?? 'Continue run', MAX_STAGE_TEXT) || 'Continue run';
    const nextActionOwner =
      optionalText(args.nextActionOwner ?? 'system', MAX_STAGE_TEXT) || 'system';
    await ctx.db.patch(exception._id, { status: 'resolved', resolution, resolvedAt: now });
    await ctx.db.patch(run._id, { status: 'active', nextAction, nextActionOwner, updatedAt: now });
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: 'run',
      aggregateId: String(run._id),
      eventType: 'exception.resolved',
      payload: { exceptionId: String(exception._id), resolution },
      occurredAt: now,
    });
    const [updatedException, updatedRun] = await Promise.all([
      ctx.db.get(exception._id),
      ctx.db.get(run._id),
    ]);
    if (!updatedException || !updatedRun) throw new Error('nodekit_caseflow_resolution_missing');
    return {
      exception: portableException(updatedException),
      run: portableRun(updatedRun),
      reused: false,
    };
  },
});

export const completeRun = mutation({
  args: { ...workspaceArg, runId: v.id('nodekitCaseflowRuns') },
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const run = await ownedRun(ctx, scope, args.runId);
    if (run.status === 'completed') {
      const receipt = await ctx.db
        .query('nodekitCaseflowReceipts')
        .withIndex('by_run', (q) => q.eq('runId', run._id))
        .unique();
      if (!receipt) throw new Error('nodekit_caseflow_completed_run_missing_receipt');
      return { receipt: portableReceipt(receipt), run: portableRun(run), reused: true };
    }
    if (TERMINAL_RUN_STATUSES.has(run.status)) {
      throw new Error(`nodekit_caseflow_run_terminal:${run.status}`);
    }
    const openException = await ctx.db
      .query('nodekitCaseflowExceptions')
      .withIndex('by_run_status', (q) => q.eq('runId', run._id).eq('status', 'open'))
      .first();
    if (openException) throw new Error('nodekit_caseflow_run_has_unresolved_exceptions');
    const caseRow = await ownedCase(ctx, scope, run.caseId);
    const now = Date.now();
    await ctx.db.patch(run._id, {
      status: 'completed',
      nextAction: 'Review receipt',
      nextActionOwner: 'user',
      stages: run.stages.map((stage) => ({ ...stage, status: 'completed' as const })),
      updatedAt: now,
    });
    await ctx.db.patch(caseRow._id, { status: 'completed', updatedAt: now });
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: 'run',
      aggregateId: String(run._id),
      eventType: 'run.completed',
      payload: {},
      occurredAt: now,
    });
    const artifacts = await ctx.db
      .query('nodekitCaseflowArtifacts')
      .withIndex('by_run', (q) => q.eq('runId', run._id))
      .collect();
    const proposalGroups = await Promise.all(
      artifacts.map((artifact) =>
        ctx.db
          .query('nodekitCaseflowProposals')
          .withIndex('by_artifact', (q) => q.eq('artifactId', artifact._id))
          .collect(),
      ),
    );
    const proposals = proposalGroups.flat();
    const approvalGroups = await Promise.all(
      proposals.map((proposal) =>
        ctx.db
          .query('nodekitCaseflowApprovals')
          .withIndex('by_proposal', (q) => q.eq('proposalId', proposal._id))
          .collect(),
      ),
    );
    const exceptions = await ctx.db
      .query('nodekitCaseflowExceptions')
      .withIndex('by_run_status', (q) => q.eq('runId', run._id))
      .collect();
    const events = await ctx.db
      .query('nodekitCaseflowEvents')
      .withIndex('by_run', (q) => q.eq('runId', run._id))
      .collect();
    const receiptBody = {
      applicationRefs: {
        deckIds: [...new Set(artifacts.map((artifact) => artifact.deckId))],
        domainArtifactRefs: artifacts.map((artifact) => artifact.domainArtifactRef),
        domainReceiptRefs: approvalGroups
          .flat()
          .flatMap((approval) => (approval.domainReceiptRef ? [approval.domainReceiptRef] : [])),
        generationIds: [run.generationId],
        patchIds: proposals.flatMap((proposal) => (proposal.patchId ? [proposal.patchId] : [])),
        validationRefs: exceptions.flatMap((exception) =>
          exception.validationRef ? [exception.validationRef] : [],
        ),
      },
      artifactIds: artifacts.map((artifact) => String(artifact._id)),
      caseId: String(caseRow._id),
      eventIds: events.map((event) => String(event._id)),
      generatedAt: iso(now),
      proposalIds: proposals.map((proposal) => String(proposal._id)),
      runId: String(run._id),
      schemaVersion: SCHEMA.receipt,
      status: 'completed' as const,
    };
    const receiptId = await ctx.db.insert('nodekitCaseflowReceipts', {
      workspaceId: scope.workspace._id,
      ownerSubject: scope.subject,
      runId: run._id,
      schemaVersion: SCHEMA.receipt,
      body: receiptBody,
      receiptHash: await contentHash(receiptBody),
      createdAt: now,
    });
    const receipt = await ctx.db.get(receiptId);
    if (!receipt) throw new Error('nodekit_caseflow_receipt_insert_failed');
    await emit(ctx, scope, {
      runId: run._id,
      aggregateType: 'run',
      aggregateId: String(run._id),
      eventType: 'receipt.created',
      payload: { receiptId: String(receiptId), receiptHash: receipt.receiptHash },
      occurredAt: now,
    });
    const updatedRun = await ctx.db.get(run._id);
    if (!updatedRun) throw new Error('nodekit_caseflow_run_missing_after_completion');
    return { receipt: portableReceipt(receipt), run: portableRun(updatedRun), reused: false };
  },
});

export const snapshot = query({
  args: workspaceArg,
  handler: async (ctx, args) => {
    const scope = await requireScope(ctx, args.workspaceId);
    const [cases, runs, artifacts, proposals, exceptions, events, receipts] = await Promise.all([
      ctx.db
        .query('nodekitCaseflowCases')
        .withIndex('by_workspace_owner', (q) =>
          q.eq('workspaceId', scope.workspace._id).eq('ownerSubject', scope.subject),
        )
        .collect(),
      ctx.db
        .query('nodekitCaseflowRuns')
        .withIndex('by_workspace_owner', (q) =>
          q.eq('workspaceId', scope.workspace._id).eq('ownerSubject', scope.subject),
        )
        .collect(),
      ctx.db
        .query('nodekitCaseflowArtifacts')
        .withIndex('by_workspace_owner', (q) =>
          q.eq('workspaceId', scope.workspace._id).eq('ownerSubject', scope.subject),
        )
        .collect(),
      ctx.db
        .query('nodekitCaseflowProposals')
        .withIndex('by_workspace_owner', (q) =>
          q.eq('workspaceId', scope.workspace._id).eq('ownerSubject', scope.subject),
        )
        .collect(),
      ctx.db
        .query('nodekitCaseflowExceptions')
        .withIndex('by_workspace_owner', (q) =>
          q.eq('workspaceId', scope.workspace._id).eq('ownerSubject', scope.subject),
        )
        .collect(),
      ctx.db
        .query('nodekitCaseflowEvents')
        .withIndex('by_workspace_owner', (q) =>
          q.eq('workspaceId', scope.workspace._id).eq('ownerSubject', scope.subject),
        )
        .collect(),
      ctx.db
        .query('nodekitCaseflowReceipts')
        .withIndex('by_workspace_owner', (q) =>
          q.eq('workspaceId', scope.workspace._id).eq('ownerSubject', scope.subject),
        )
        .collect(),
    ]);
    const approvalGroups = await Promise.all(
      proposals.map((proposal) =>
        ctx.db
          .query('nodekitCaseflowApprovals')
          .withIndex('by_proposal', (q) => q.eq('proposalId', proposal._id))
          .collect(),
      ),
    );
    return {
      approvals: approvalGroups.flat().map(portableApproval),
      artifacts: await Promise.all(artifacts.map((artifact) => portableArtifact(ctx, artifact))),
      cases: cases.map(portableCase),
      events: events.map(portableEvent),
      exceptions: exceptions.map(portableException),
      proposals: proposals.map(portableProposal),
      receipts: receipts.map(portableReceipt),
      runs: runs.map(portableRun),
    };
  },
});
