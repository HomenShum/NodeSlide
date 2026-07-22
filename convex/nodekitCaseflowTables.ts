import { defineTable } from 'convex/server';
import { v } from 'convex/values';

const runStatus = v.union(
  v.literal('active'),
  v.literal('blocked'),
  v.literal('cancelled'),
  v.literal('completed'),
  v.literal('failed_safely'),
);

const caseStatus = v.union(
  v.literal('ready'),
  v.literal('in_progress'),
  v.literal('cancelled'),
  v.literal('completed'),
  v.literal('failed_safely'),
);

const stageStatus = v.union(v.literal('pending'), v.literal('active'), v.literal('completed'));

/**
 * NodeKit lifecycle projection owned by the NodeSlide application.
 *
 * NodeSlide's existing deck repository/component remains authoritative for
 * deck validation, patch application, versions, assets, and domain receipts.
 * These rows provide the portable Caseflow lifecycle and explicit references
 * back to those domain records without duplicating the slide mutation engine.
 */
export const nodekitCaseflowTables = {
  nodekitCaseflowWorkspaces: defineTable({
    slug: v.string(),
    ownerSubject: v.string(),
    organizationId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_owner_slug', ['ownerSubject', 'slug'])
    .index('by_owner', ['ownerSubject', 'createdAt']),

  nodekitCaseflowDeckBindings: defineTable({
    workspaceId: v.id('nodekitCaseflowWorkspaces'),
    ownerSubject: v.string(),
    deckId: v.string(),
    /** Records how ownership was established. Bearer material is never stored. */
    bindingMethod: v.union(
      v.literal('authenticated_creation'),
      v.literal('preview_capability_claim'),
    ),
    createdAt: v.number(),
  })
    .index('by_workspace_deck', ['workspaceId', 'deckId'])
    .index('by_deck', ['deckId']),

  nodekitCaseflowCases: defineTable({
    workspaceId: v.id('nodekitCaseflowWorkspaces'),
    ownerSubject: v.string(),
    deckId: v.string(),
    schemaVersion: v.string(),
    title: v.string(),
    primaryJob: v.string(),
    status: caseStatus,
    currentRunId: v.optional(v.id('nodekitCaseflowRuns')),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_workspace_owner', ['workspaceId', 'ownerSubject', 'createdAt'])
    .index('by_deck', ['deckId', 'createdAt']),

  nodekitCaseflowRuns: defineTable({
    workspaceId: v.id('nodekitCaseflowWorkspaces'),
    ownerSubject: v.string(),
    caseId: v.id('nodekitCaseflowCases'),
    /** NodeSlide generation attempt mapped to a portable Caseflow run. */
    generationId: v.string(),
    schemaVersion: v.string(),
    status: runStatus,
    stages: v.array(
      v.object({
        id: v.string(),
        label: v.string(),
        owner: v.string(),
        status: stageStatus,
      }),
    ),
    currentStageId: v.string(),
    nextAction: v.string(),
    nextActionOwner: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_case', ['caseId', 'createdAt'])
    .index('by_workspace_owner', ['workspaceId', 'ownerSubject', 'createdAt']),

  nodekitCaseflowArtifacts: defineTable({
    workspaceId: v.id('nodekitCaseflowWorkspaces'),
    ownerSubject: v.string(),
    caseId: v.id('nodekitCaseflowCases'),
    runId: v.id('nodekitCaseflowRuns'),
    /** Stable NodeSlide deck identifier; the deck repository remains canonical. */
    deckId: v.string(),
    domainArtifactRef: v.string(),
    schemaVersion: v.string(),
    kind: v.string(),
    title: v.string(),
    canonicalVersion: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_run', ['runId', 'createdAt'])
    .index('by_workspace_owner', ['workspaceId', 'ownerSubject', 'createdAt'])
    .index('by_deck', ['deckId', 'createdAt']),

  nodekitCaseflowArtifactVersions: defineTable({
    artifactId: v.id('nodekitCaseflowArtifacts'),
    version: v.number(),
    content: v.any(),
    contentHash: v.string(),
    proposalId: v.optional(v.id('nodekitCaseflowProposals')),
    createdAt: v.number(),
  }).index('by_artifact_version', ['artifactId', 'version']),

  nodekitCaseflowProposals: defineTable({
    workspaceId: v.id('nodekitCaseflowWorkspaces'),
    ownerSubject: v.string(),
    artifactId: v.id('nodekitCaseflowArtifacts'),
    /** NodeSlide patch/proposal reference when the patch has a stable id. */
    patchId: v.optional(v.string()),
    schemaVersion: v.string(),
    baseVersion: v.number(),
    patch: v.any(),
    patchHash: v.string(),
    rationale: v.string(),
    status: v.union(
      v.literal('pending'),
      v.literal('accepted'),
      v.literal('rejected'),
      v.literal('conflicted'),
    ),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index('by_artifact', ['artifactId', 'createdAt'])
    .index('by_workspace_owner', ['workspaceId', 'ownerSubject', 'createdAt']),

  nodekitCaseflowApprovals: defineTable({
    workspaceId: v.id('nodekitCaseflowWorkspaces'),
    ownerSubject: v.string(),
    proposalId: v.id('nodekitCaseflowProposals'),
    /** Optional application receipt from NodeSlideRepository resolution. */
    domainReceiptRef: v.optional(v.string()),
    schemaVersion: v.string(),
    decision: v.union(v.literal('accepted'), v.literal('rejected')),
    comment: v.string(),
    decidedAt: v.number(),
  }).index('by_proposal', ['proposalId']),

  nodekitCaseflowExceptions: defineTable({
    workspaceId: v.id('nodekitCaseflowWorkspaces'),
    ownerSubject: v.string(),
    runId: v.id('nodekitCaseflowRuns'),
    /** NodeSlide candidate-validation result or issue bundle reference. */
    validationRef: v.optional(v.string()),
    schemaVersion: v.string(),
    code: v.string(),
    message: v.string(),
    preservedState: v.any(),
    status: v.union(v.literal('open'), v.literal('resolved')),
    resolution: v.optional(v.string()),
    raisedAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index('by_run_status', ['runId', 'status', 'raisedAt'])
    .index('by_workspace_owner', ['workspaceId', 'ownerSubject', 'raisedAt']),

  nodekitCaseflowEvents: defineTable({
    workspaceId: v.id('nodekitCaseflowWorkspaces'),
    ownerSubject: v.string(),
    runId: v.optional(v.id('nodekitCaseflowRuns')),
    schemaVersion: v.string(),
    aggregateType: v.string(),
    aggregateId: v.string(),
    eventType: v.string(),
    sequence: v.number(),
    payload: v.any(),
    occurredAt: v.number(),
  })
    .index('by_aggregate_sequence', ['aggregateId', 'sequence'])
    .index('by_run', ['runId', 'occurredAt'])
    .index('by_workspace_owner', ['workspaceId', 'ownerSubject', 'occurredAt']),

  nodekitCaseflowReceipts: defineTable({
    workspaceId: v.id('nodekitCaseflowWorkspaces'),
    ownerSubject: v.string(),
    runId: v.id('nodekitCaseflowRuns'),
    schemaVersion: v.string(),
    /** Exact canonical body hashed into receiptHash. */
    body: v.any(),
    receiptHash: v.string(),
    createdAt: v.number(),
  })
    .index('by_run', ['runId'])
    .index('by_workspace_owner', ['workspaceId', 'ownerSubject', 'createdAt']),
};
