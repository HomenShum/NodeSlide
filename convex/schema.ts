import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { nodeslideExecutionTraceFields } from './lib/nodeslideExecutionTraceValidator';
import { NODESLIDE_JOB_PHASES, NODESLIDE_JOB_STATUSES } from './lib/nodeslideJobState';
import {
  nodeslideJobRenderRepairSummaryValidator,
  nodeslideJobRoutingReceiptValidator,
} from './lib/nodeslideJobValidators';
import { nodeslideShadowComparisonFields } from './lib/nodeslideShadowComparisonValidator';
import {
  nodeslideArtifactCompilationReceiptValidator,
  nodeslideAuthoredArtifactBindingValidator,
  nodeslideBoundingBoxValidator,
  nodeslideBriefValidator,
  nodeslideCandidateValidationReceiptValidator,
  nodeslideChartDataValidator,
  nodeslideClaimSourceBindingValidator,
  nodeslideCommentAnchorValidator,
  nodeslideCursorValidator,
  nodeslideElementStyleValidator,
  nodeslideElementValidator,
  nodeslideExportCapabilityValidator,
  nodeslideImageDataValidator,
  nodeslideMathDataValidator,
  nodeslidePatchOperationValidator,
  nodeslidePatchScopeValidator,
  nodeslidePatchSourceValidator,
  nodeslidePatchStatusValidator,
  nodeslideProposalOriginValidator,
  nodeslideSlideArchetypeValidator,
  nodeslideSnapshotValidator,
  nodeslideSourceBindingStatusValidator,
  nodeslideStoredArtifactBindingValidator,
  nodeslideThemeValidator,
  nodeslideValidationIssueValidator,
  nodeslideValidationResultValidator,
  nodeslideVariationAxesValidator,
  nodeslideVariationCandidateValidator,
  nodeslideVariationDecisionEventValidator,
  nodeslideVariationJudgeReceiptValidator,
  nodeslideVariationOriginValidator,
  nodeslideVariationStatusValidator,
  nodeslideVersionClockValidator,
  nodeslideVideoDataValidator,
} from './lib/nodeslideValidators';

const nodeslidePreferenceEventTypeValidator = v.union(
  v.literal('variation_generated'),
  v.literal('variation_selected'),
  v.literal('variation_rejected'),
  v.literal('patch_accepted'),
  v.literal('patch_modified'),
  v.literal('patch_declined'),
  v.literal('export_completed'),
);

const nodeslidePreferenceScopeValidator = v.union(
  v.object({ kind: v.literal('deck'), deckId: v.string() }),
  v.object({ kind: v.literal('slide'), deckId: v.string(), slideId: v.string() }),
  v.object({
    kind: v.literal('element'),
    deckId: v.string(),
    slideId: v.string(),
    elementId: v.string(),
  }),
);

const nodeslidePreferenceProvenanceValidator = v.object({
  deckVersion: v.number(),
  sourceEventId: v.optional(v.string()),
  variationId: v.optional(v.string()),
  variationBatchId: v.optional(v.string()),
  patchId: v.optional(v.string()),
  traceId: v.optional(v.string()),
  exportId: v.optional(v.string()),
  profileId: v.optional(v.string()),
});

const nodeslidePreferenceContentAngleValidator = v.union(
  v.literal('data_led'),
  v.literal('narrative_led'),
  v.literal('balanced'),
);
const nodeslidePreferenceDensityValidator = v.union(
  v.literal('executive'),
  v.literal('detail'),
  v.literal('balanced'),
);
const nodeslidePreferenceLayoutValidator = v.union(
  v.literal('headline'),
  v.literal('split'),
  v.literal('evidence'),
  v.literal('comparison'),
);
const nodeslidePreferenceAttributesValidator = v.union(
  v.object({
    contentAngle: nodeslidePreferenceContentAngleValidator,
    density: nodeslidePreferenceDensityValidator,
    layoutArchetype: nodeslidePreferenceLayoutValidator,
    origin: v.union(v.literal('free_route'), v.literal('deterministic_fallback')),
  }),
  v.object({
    contentAngle: nodeslidePreferenceContentAngleValidator,
    density: nodeslidePreferenceDensityValidator,
    layoutArchetype: nodeslidePreferenceLayoutValidator,
  }),
  v.object({ color: v.optional(v.string()), font: v.optional(v.string()) }),
  v.object({
    color: v.optional(v.string()),
    font: v.optional(v.string()),
    supersededColor: v.optional(v.string()),
    supersededFont: v.optional(v.string()),
  }),
  v.object({}),
  v.object({
    exportFormat: v.union(v.literal('html'), v.literal('pptx'), v.literal('pdf'), v.literal('png')),
  }),
);

const nodeslidePreferenceRejectionCodeValidator = v.union(
  v.literal('invalid_event_schema'),
  v.literal('invalid_signal_schema'),
  v.literal('attribute_limit_exceeded'),
  v.literal('attribute_not_allowed'),
  v.literal('attribute_value_invalid'),
  v.literal('missing_provenance'),
  v.literal('provenance_unresolvable'),
  v.literal('provenance_chain_invalid'),
  v.literal('agent_trace_missing'),
  v.literal('source_event_invalid'),
  v.literal('export_without_accepted_change'),
  v.literal('value_not_derivable'),
  v.literal('contradicted_by_later_event'),
  v.literal('sibling_axis_selected'),
  v.literal('superseded_by_later_event'),
  v.literal('conflicting_event_id'),
);
const nodeslidePreferenceEvaluatorCheckValidator = v.object({
  passed: v.boolean(),
  rejectionCodes: v.array(nodeslidePreferenceRejectionCodeValidator),
});
const nodeslidePreferenceSignalValidator = v.object({
  id: v.string(),
  tenantId: v.string(),
  actorId: v.string(),
  polarity: v.union(v.literal('positive'), v.literal('negative')),
  scope: nodeslidePreferenceScopeValidator,
  dimension: v.union(
    v.literal('content_angle'),
    v.literal('density'),
    v.literal('layout_archetype'),
    v.literal('color'),
    v.literal('font'),
    v.literal('workflow'),
  ),
  value: v.string(),
  confidence: v.number(),
  evidenceEventIds: v.array(v.string()),
  evaluator: v.object({
    evaluatorVersion: v.literal('nodeslide.preference-evaluator/v1'),
    passed: v.boolean(),
    checks: v.object({
      schema: nodeslidePreferenceEvaluatorCheckValidator,
      provenance: nodeslidePreferenceEvaluatorCheckValidator,
      hallucination: nodeslidePreferenceEvaluatorCheckValidator,
    }),
    rejectionCodes: v.array(nodeslidePreferenceRejectionCodeValidator),
    inputEventIds: v.array(v.string()),
  }),
  createdAt: v.number(),
});

// All cost fields stored as integer micro-cents (1 USD = 1_000_000 micro-cents)
// to dodge floating-point drift on summation. UI converts back to USD on read.

export const RUN_STATUSES = [
  'queued',
  'generating',
  'decomposing',
  'verifying',
  'iterating',
  'done',
  'failed',
] as const;

export const PARITY_STATUSES = [
  'verified',
  'needs_review',
  'needs_iteration',
  'failed',
  'unavailable',
] as const;

const nodeslidePublishedDeckValidator = v.object({
  schemaVersion: v.literal('nodeslide.slidelang/v1'),
  toolchainVersion: v.string(),
  id: v.string(),
  title: v.string(),
  theme: nodeslideThemeValidator,
  slideOrder: v.array(v.string()),
  version: v.number(),
  status: v.literal('published'),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const nodeslidePublishedSlideValidator = v.object({
  id: v.string(),
  deckId: v.string(),
  title: v.string(),
  section: v.optional(v.string()),
  background: v.string(),
  elementOrder: v.array(v.string()),
  version: v.number(),
});

const nodeslidePublishedSourceValidator = v.object({
  id: v.string(),
  deckId: v.string(),
  title: v.string(),
  url: v.optional(v.string()),
  sourceType: v.literal('url'),
  retrievedAt: v.number(),
  citation: v.string(),
  license: v.optional(v.string()),
});

const nodeslidePublishedSnapshotValidator = v.object({
  deck: nodeslidePublishedDeckValidator,
  slides: v.array(nodeslidePublishedSlideValidator),
  elements: v.array(nodeslideElementValidator),
  sources: v.array(nodeslidePublishedSourceValidator),
});

/*
 * ---------------------------------------------------------------------------
 * Durable agent-session validators.
 *
 * These describe the server-owned state machine behind `convex/nodeslideSessions.ts`.
 * Every field is a digest, a counter, or a safe descriptor: the raw prompt, the
 * provider credential, and the consent grant have no column here by design, so a
 * dump of these tables cannot reconstruct what the author typed.
 * ---------------------------------------------------------------------------
 */

const nodeslideDurableRequestBindingValidator = v.object({
  schemaVersion: v.literal('nodeslide.request-binding/v2'),
  requestDigest: v.string(),
  capabilityDigest: v.string(),
});

const nodeslideDurableCapabilityMetadataValidator = v.object({
  schemaVersion: v.literal('nodeslide.capability-digest/v2'),
  capabilityDigest: v.string(),
  provider: v.optional(v.string()),
  model: v.optional(v.string()),
  scopes: v.array(v.string()),
  egress: v.union(
    v.literal('none'),
    v.literal('model'),
    v.literal('web'),
    v.literal('model_and_web'),
  ),
  hasSecret: v.boolean(),
  hasConsent: v.boolean(),
  attachmentCount: v.number(),
  consentDigest: v.optional(v.string()),
  attachmentsDigest: v.optional(v.string()),
});

const nodeslideDurableJobStatusValidator = v.union(
  v.literal('queued'),
  v.literal('running'),
  v.literal('retrying'),
  v.literal('paused'),
  v.literal('awaiting_review'),
  v.literal('succeeded'),
  v.literal('failed'),
  v.literal('cancelled'),
  v.literal('rejected'),
  v.literal('stale'),
);

const nodeslideDurableLeaseValidator = v.object({
  leaseId: v.string(),
  workerId: v.string(),
  attempt: v.number(),
  egressEpoch: v.number(),
  issuedAt: v.number(),
  expiresAt: v.number(),
});

const nodeslideDurableJobValidator = v.object({
  jobId: v.string(),
  requestBinding: nodeslideDurableRequestBindingValidator,
  status: nodeslideDurableJobStatusValidator,
  attempt: v.number(),
  retryCount: v.number(),
  resumeCount: v.number(),
  maxAttempts: v.number(),
  lease: v.optional(nodeslideDurableLeaseValidator),
  reason: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
  completedAt: v.optional(v.number()),
});

const nodeslideDurableJobEventValidator = v.object({
  schemaVersion: v.literal('nodeslide.durable-session/v2'),
  sequence: v.number(),
  stateVersion: v.number(),
  jobId: v.string(),
  kind: v.union(
    v.literal('enqueued'),
    v.literal('claimed'),
    v.literal('transitioned'),
    v.literal('retried'),
    v.literal('resumed'),
    v.literal('paused'),
    v.literal('egress_rotated'),
    v.literal('stale_fenced'),
  ),
  fromStatus: v.union(v.null(), nodeslideDurableJobStatusValidator),
  toStatus: nodeslideDurableJobStatusValidator,
  requestBinding: nodeslideDurableRequestBindingValidator,
  egressEpoch: v.number(),
  attempt: v.number(),
  occurredAt: v.number(),
  leaseId: v.optional(v.string()),
  reason: v.optional(v.string()),
  eventDigest: v.string(),
});

const nodeslideDurableJournalBindingValidator = v.object({
  schemaVersion: v.literal('nodeslide.request-binding/v2'),
  sessionId: v.string(),
  jobId: v.string(),
  requestDigest: v.string(),
  capabilityDigest: v.string(),
  egressEpoch: v.number(),
  attempt: v.number(),
});

const nodeslideEvidenceBoxValidator = v.object({
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
  page: v.optional(v.number()),
  pageCount: v.optional(v.number()),
});

const nodeslideEvidenceViewportValidator = v.object({
  width: v.number(),
  height: v.number(),
});

const nodeslideClaimEvidenceRegionValidator = v.object({
  x: v.number(),
  y: v.number(),
  w: v.number(),
  h: v.number(),
  page: v.optional(v.number()),
  pageCount: v.optional(v.number()),
});

const nodeslideSyncObjectLinkValidator = v.object({
  kind: v.union(v.literal('deck'), v.literal('slide'), v.literal('element')),
  localId: v.string(),
  remoteId: v.string(),
  semanticFingerprint: v.string(),
  localSlideId: v.optional(v.string()),
  remoteSlideId: v.optional(v.string()),
});

export default defineSchema({
  projects: defineTable({
    clientSessionId: v.optional(v.string()),
    title: v.string(),
    domain: v.optional(v.union(v.literal('parity'), v.literal('nodeslide'))),
    brief: v.optional(nodeslideBriefValidator),
    sourceType: v.optional(
      v.union(
        v.literal('prompt'),
        v.literal('image'),
        v.literal('zip'),
        v.literal('platform-route'),
        v.literal('unknown'),
      ),
    ),
    starred: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_session_updated', ['clientSessionId', 'updatedAt'])
    .index('by_updated', ['updatedAt']),

  nodeslide_decks: defineTable({
    id: v.string(),
    projectId: v.string(),
    projectRowId: v.id('projects'),
    clientSessionId: v.string(),
    schemaVersion: v.literal('nodeslide.slidelang/v1'),
    toolchainVersion: v.string(),
    title: v.string(),
    brief: nodeslideBriefValidator,
    theme: nodeslideThemeValidator,
    slideOrder: v.array(v.string()),
    version: v.number(),
    status: v.union(
      v.literal('draft'),
      v.literal('validating'),
      v.literal('ready'),
      v.literal('published'),
    ),
    activeSignatureProfileId: v.optional(v.string()),
    activeSignatureProfileDigest: v.optional(v.string()),
    // D9 governance: when true, publishing needs an approver sign-off bound to the
    // exact current version. Optional so existing rows stay valid (additive field).
    publishApprovalRequired: v.optional(v.boolean()),
    // Optional so deployed anonymous-session rows can be claimed lazily.
    ownerAccessKey: v.optional(v.string()),
    shareSlug: v.optional(v.string()),
    productionProbeCleanupDigest: v.optional(v.string()),
    productionProbeExpiresAt: v.optional(v.number()),
    plan: v.array(v.string()),
    spec: v.any(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_session_updated', ['clientSessionId', 'updatedAt'])
    .index('by_share_slug', ['shareSlug'])
    .index('by_production_probe_cleanup', ['productionProbeCleanupDigest'])
    .index('by_production_probe_expiry', ['productionProbeExpiresAt'])
    .index('by_project_row', ['projectRowId']),

  nodeslide_slides: defineTable({
    id: v.string(),
    deckId: v.string(),
    title: v.string(),
    section: v.optional(v.string()),
    notes: v.optional(v.string()),
    // Optional: rows materialized before layout archetypes existed omit it.
    archetype: v.optional(nodeslideSlideArchetypeValidator),
    background: v.string(),
    elementOrder: v.array(v.string()),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck', ['deckId'])
    .index('by_deck_id', ['deckId', 'id']),

  nodeslide_elements: defineTable({
    id: v.string(),
    deckId: v.string(),
    slideId: v.string(),
    name: v.string(),
    kind: v.union(
      v.literal('text'),
      v.literal('shape'),
      v.literal('image'),
      v.literal('chart'),
      v.literal('math'),
      v.literal('video'),
      v.literal('connector'),
    ),
    role: v.optional(v.string()),
    bbox: nodeslideBoundingBoxValidator,
    rotation: v.number(),
    content: v.optional(v.string()),
    style: nodeslideElementStyleValidator,
    chart: v.optional(nodeslideChartDataValidator),
    math: v.optional(nodeslideMathDataValidator),
    video: v.optional(nodeslideVideoDataValidator),
    image: v.optional(nodeslideImageDataValidator),
    imageUrl: v.optional(v.string()),
    altText: v.optional(v.string()),
    sourceIds: v.array(v.string()),
    locked: v.boolean(),
    visible: v.optional(v.boolean()),
    groupId: v.optional(v.string()),
    artifactBinding: v.optional(nodeslideStoredArtifactBindingValidator),
    authoredArtifactBinding: v.optional(nodeslideAuthoredArtifactBindingValidator),
    exportCapabilities: v.array(nodeslideExportCapabilityValidator),
    version: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck', ['deckId'])
    .index('by_deck_id', ['deckId', 'id'])
    .index('by_slide', ['slideId']),

  nodeslide_patches: defineTable({
    id: v.string(),
    deckId: v.string(),
    // Present only on proposals produced by a durable job; see the by_job index.
    jobId: v.optional(v.string()),
    baseDeckVersion: v.number(),
    baseSlideVersions: nodeslideVersionClockValidator,
    baseElementVersions: nodeslideVersionClockValidator,
    resultingDeckVersion: v.optional(v.number()),
    scope: nodeslidePatchScopeValidator,
    operations: v.array(nodeslidePatchOperationValidator),
    source: nodeslidePatchSourceValidator,
    status: nodeslidePatchStatusValidator,
    summary: v.string(),
    linkedCommentId: v.optional(v.string()),
    traceId: v.optional(v.string()),
    proposalKind: v.optional(v.union(v.literal('edit'), v.literal('propagation'))),
    parentPatchId: v.optional(v.string()),
    affectedSlideIds: v.optional(v.array(v.string())),
    affectedSlideDigest: v.optional(v.string()),
    candidateDigest: v.optional(v.string()),
    candidateValidation: v.optional(nodeslideCandidateValidationReceiptValidator),
    profileId: v.optional(v.string()),
    profileDigest: v.optional(v.string()),
    // Authorship of the operations, carried from the planner receipt. Optional because rows
    // written before proposal-authorship provenance genuinely do not know; the surfaces render
    // that absence as `unattributed` rather than as a missing attribute.
    origin: v.optional(nodeslideProposalOriginValidator),
    fallbackReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_status', ['deckId', 'status'])
    .index('by_deck_status_created', ['deckId', 'status', 'createdAt'])
    // Set by the job runner when a proposal is produced by a durable job rather
    // than by a synchronous action; optional because a direct proposeEdit call
    // has no job. by_job is how the runner resolves its own proposal on replay.
    .index('by_job', ['jobId']),

  nodeslide_variation_batches: defineTable({
    id: v.string(),
    deckId: v.string(),
    slideId: v.string(),
    requestedCount: v.literal(3),
    status: v.union(v.literal('generating'), v.literal('ready'), v.literal('failed')),
    origin: nodeslideVariationOriginValidator,
    fallbackReason: v.optional(v.string()),
    variationIds: v.array(v.string()),
    elapsedMs: v.number(),
    acceptingVariationId: v.optional(v.string()),
    acceptedVariationId: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_slide_created', ['deckId', 'slideId', 'createdAt']),

  nodeslide_variations: defineTable({
    schemaVersion: v.literal('nodeslide.variation/v1'),
    id: v.string(),
    batchId: v.string(),
    deckId: v.string(),
    slideId: v.string(),
    baseDeckVersion: v.number(),
    baseSlideVersion: v.number(),
    baseElementVersions: nodeslideVersionClockValidator,
    axes: nodeslideVariationAxesValidator,
    origin: nodeslideVariationOriginValidator,
    fallbackReason: v.optional(v.string()),
    operations: v.array(nodeslidePatchOperationValidator),
    candidate: nodeslideVariationCandidateValidator,
    validation: nodeslideValidationResultValidator,
    judge: v.optional(nodeslideVariationJudgeReceiptValidator),
    status: nodeslideVariationStatusValidator,
    selectedPatchId: v.optional(v.string()),
    createdAt: v.number(),
    decidedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_batch', ['batchId'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_slide_created', ['deckId', 'slideId', 'createdAt']),

  nodeslide_variation_decisions: defineTable({
    id: v.string(),
    eventName: nodeslideVariationDecisionEventValidator,
    deckId: v.string(),
    slideId: v.string(),
    batchId: v.string(),
    variationId: v.string(),
    deckVersion: v.number(),
    traceId: v.string(),
    axes: nodeslideVariationAxesValidator,
    origin: nodeslideVariationOriginValidator,
    reason: v.optional(v.string()),
    selectedPatchId: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_variation', ['variationId'])
    .index('by_batch', ['batchId'])
    .index('by_deck_created', ['deckId', 'createdAt']),

  nodeslide_comments: defineTable({
    id: v.string(),
    deckId: v.string(),
    parentId: v.optional(v.string()),
    anchor: nodeslideCommentAnchorValidator,
    authorId: v.string(),
    authorName: v.string(),
    text: v.string(),
    status: v.union(v.literal('open'), v.literal('resolved'), v.literal('dismissed')),
    linkedPatchId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_status_created', ['deckId', 'status', 'createdAt'])
    .index('by_parent', ['parentId']),

  nodeslide_versions: defineTable({
    id: v.string(),
    deckId: v.string(),
    version: v.number(),
    label: v.string(),
    source: nodeslidePatchSourceValidator,
    patchId: v.optional(v.string()),
    snapshot: nodeslideSnapshotValidator,
    createdAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_version', ['deckId', 'version']),

  /**
   * Durable package-port receipts and assets for the existing app host. These
   * tables do not duplicate deck state; package mutations still execute the
   * authoritative nodeslide_* commit path and only persist port-specific
   * envelopes that the monolith did not previously need.
   */
  nodeslide_package_receipts: defineTable({
    receiptId: v.string(),
    deckId: v.string(),
    patchId: v.optional(v.string()),
    principalId: v.string(),
    receipt: v.any(),
    recordedAt: v.number(),
  })
    .index('by_stable_id', ['receiptId'])
    .index('by_deck_patch', ['deckId', 'patchId'])
    .index('by_deck_recorded', ['deckId', 'recordedAt']),

  /**
   * Package mutation identity and proposal-resolution ledger. Patch rows are
   * shared with the app, so this table records whether a package patch ID was
   * submitted directly or as a proposal and binds resolution coordinates to
   * the authoritative patch, version, and receipt rows.
   */
  nodeslide_package_submissions: defineTable({
    submissionId: v.string(),
    deckId: v.string(),
    patchId: v.string(),
    kind: v.union(v.literal('direct'), v.literal('proposal')),
    commandDigest: v.string(),
    originReceiptId: v.string(),
    submittedAt: v.number(),
    resolutionDecision: v.optional(v.union(v.literal('accept'), v.literal('reject'))),
    resolutionStatus: v.optional(
      v.union(v.literal('accepted'), v.literal('rejected'), v.literal('stale')),
    ),
    resolutionDeckVersion: v.optional(v.number()),
    resolutionReceiptId: v.optional(v.string()),
    resolvedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['submissionId'])
    .index('by_deck_patch', ['deckId', 'patchId']),

  nodeslide_package_assets: defineTable({
    assetId: v.string(),
    deckId: v.string(),
    reference: v.any(),
    bytes: v.bytes(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['assetId'])
    .index('by_deck_created', ['deckId', 'createdAt']),

  nodeslide_sources: defineTable({
    id: v.string(),
    deckId: v.string(),
    title: v.string(),
    url: v.optional(v.string()),
    sourceType: v.union(
      v.literal('internal'),
      v.literal('url'),
      v.literal('document'),
      v.literal('spreadsheet'),
      v.literal('note'),
    ),
    retrievedAt: v.number(),
    citation: v.string(),
    license: v.optional(v.string()),
    format: v.optional(
      v.union(
        v.literal('csv'),
        v.literal('json'),
        v.literal('txt'),
        v.literal('md'),
        v.literal('pdf'),
        v.literal('web'),
      ),
    ),
    contentDigest: v.optional(v.string()),
    byteSize: v.optional(v.number()),
    rowCount: v.optional(v.number()),
    columns: v.optional(v.array(v.string())),
    provider: v.optional(v.string()),
    retention: v.optional(v.union(v.literal('until_deleted'), v.literal('public_snapshot'))),
    status: v.optional(v.union(v.literal('ready'), v.literal('refreshing'), v.literal('failed'))),
    lastRefreshedAt: v.optional(v.number()),
    snapshot: v.optional(
      v.object({
        kind: v.literal('search_excerpt'),
        capturedAt: v.number(),
        text: v.string(),
        contentDigest: v.string(),
      }),
    ),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck', ['deckId']),

  /**
   * Append-only, content-addressed snapshots of exact source evidence.
   *
   * A `nodeslide_sources` row is mutable — its status and preview move as the
   * source is refreshed — which makes it useless as the thing a historical
   * citation points at. This table holds the immutable half, so a receipt
   * written six months ago still resolves to the exact bytes it was written
   * about. Deck-scoped: the revision carries the citation text itself.
   */
  nodeslide_source_revisions: defineTable({
    id: v.string(),
    schema: v.literal('nodeslide.source-revision/v1'),
    revisionDigest: v.string(),
    ownerDigest: v.string(),
    deckId: v.string(),
    sourceId: v.string(),
    title: v.string(),
    url: v.optional(v.string()),
    sourceType: v.union(
      v.literal('internal'),
      v.literal('url'),
      v.literal('document'),
      v.literal('spreadsheet'),
      v.literal('note'),
    ),
    retrievedAt: v.number(),
    citation: v.string(),
    license: v.optional(v.string()),
    format: v.optional(
      v.union(
        v.literal('csv'),
        v.literal('json'),
        v.literal('txt'),
        v.literal('md'),
        v.literal('pdf'),
        v.literal('web'),
      ),
    ),
    contentDigest: v.string(),
    byteSize: v.optional(v.number()),
    rowCount: v.optional(v.number()),
    columns: v.optional(v.array(v.string())),
    provider: v.optional(v.string()),
    retention: v.optional(v.union(v.literal('until_deleted'), v.literal('public_snapshot'))),
    predecessorRevisionId: v.optional(v.string()),
    predecessorRevisionDigest: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_owner_created', ['ownerDigest', 'createdAt'])
    .index('by_source_created', ['sourceId', 'createdAt'])
    .index('by_source_content_digest', ['sourceId', 'contentDigest']),

  /** Opt-in polling state kept separate so unchanged checks never stale deck candidates. */
  nodeslide_source_refresh_schedules: defineTable({
    id: v.string(),
    deckId: v.string(),
    sourceId: v.string(),
    ownerDigest: v.string(),
    enabled: v.boolean(),
    intervalMinutes: v.number(),
    nextRunAt: v.number(),
    status: v.union(
      v.literal('ready'),
      v.literal('checking'),
      v.literal('backoff'),
      v.literal('disabled'),
    ),
    lastSemanticDigest: v.string(),
    leaseId: v.optional(v.string()),
    leaseExpiresAt: v.optional(v.number()),
    failureCount: v.number(),
    checksInWindow: v.optional(v.number()),
    windowStartedAt: v.optional(v.number()),
    lastCheckedAt: v.optional(v.number()),
    lastChangedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_source', ['deckId', 'sourceId'])
    .index('by_due', ['enabled', 'nextRunAt'])
    .index('by_deck_updated', ['deckId', 'updatedAt']),

  /** Review work created by source monitoring; never an executable patch by itself. */
  nodeslide_source_refresh_proposals: defineTable({
    id: v.string(),
    deckId: v.string(),
    sourceId: v.string(),
    ownerDigest: v.string(),
    scheduleId: v.string(),
    status: v.union(
      v.literal('ready'),
      v.literal('prepared'),
      v.literal('dismissed'),
      v.literal('converted'),
      v.literal('stale'),
    ),
    baseDeckVersion: v.number(),
    baseSnapshotDigest: v.string(),
    beforeRevisionId: v.string(),
    afterRevisionId: v.string(),
    afterRevisionDigest: v.string(),
    planDigest: v.string(),
    planJson: v.string(),
    deckCiDigest: v.string(),
    affectedSlideIds: v.array(v.string()),
    affectedElementIds: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_status_created', ['deckId', 'status', 'createdAt'])
    .index('by_source_created', ['sourceId', 'createdAt']),

  /**
   * One web-evidence capture run: what URL was visited, for what goal, and the
   * digest of what came back. Deck-scoped — the goal text is the user's own
   * question and the capture is retained evidence about this deck's claims.
   */
  nodeslide_evidence_captures: defineTable({
    id: v.string(),
    deckId: v.string(),
    runId: v.string(),
    traceId: v.string(),
    spanId: v.string(),
    parentSpanId: v.string(),
    sourceId: v.string(),
    /** Optional only for rows created before immutable revision binding shipped. */
    sourceRevisionId: v.optional(v.string()),
    sourceRevisionDigest: v.optional(v.string()),
    captureDigest: v.optional(v.string()),
    url: v.string(),
    goal: v.string(),
    provider: v.string(),
    status: v.union(v.literal('ready'), v.literal('failed'), v.literal('expired')),
    error: v.optional(v.string()),
    contentDigest: v.optional(v.string()),
    stepCount: v.number(),
    screenshotCount: v.number(),
    pdfCount: v.number(),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_run_created', ['runId', 'createdAt'])
    .index('by_trace_span', ['traceId', 'spanId'])
    .index('by_source_created', ['sourceId', 'createdAt'])
    .index('by_expiry', ['expiresAt']),

  /**
   * The individual steps of a capture, including the stored screenshot or PDF.
   * Deck-scoped for the same reason as the capture, and additionally because
   * the attachments are stored objects the erasure has to be able to find.
   */
  nodeslide_evidence_steps: defineTable({
    id: v.string(),
    captureId: v.string(),
    deckId: v.string(),
    runId: v.string(),
    traceId: v.string(),
    spanId: v.string(),
    sequence: v.number(),
    phase: v.string(),
    label: v.string(),
    status: v.union(v.literal('ok'), v.literal('warning'), v.literal('error')),
    detail: v.optional(v.string()),
    attachmentKind: v.optional(v.union(v.literal('screenshot'), v.literal('pdf'))),
    screenshotStorageId: v.optional(v.id('_storage')),
    pdfStorageId: v.optional(v.id('_storage')),
    box: v.optional(nodeslideEvidenceBoxValidator),
    /** Optional only for legacy rows. Missing scope is treated as source-level, never claim-level. */
    regionScope: v.optional(v.union(v.literal('source'), v.literal('claim'))),
    selector: v.optional(v.string()),
    quote: v.optional(v.string()),
    viewport: v.optional(nodeslideEvidenceViewportValidator),
    contentDigest: v.optional(v.string()),
    attachmentDigest: v.optional(v.string()),
    evidenceStepDigest: v.optional(v.string()),
    startedAt: v.number(),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_capture_sequence', ['captureId', 'sequence'])
    .index('by_run_sequence', ['runId', 'sequence'])
    .index('by_trace_span_sequence', ['traceId', 'spanId', 'sequence'])
    .index('by_deck_created', ['deckId', 'createdAt']),

  /** Append-only claim-to-region custody receipts. Ambiguous geometry is never stored here. */
  nodeslide_claim_evidence_receipts: defineTable({
    id: v.string(),
    receiptId: v.string(),
    schema: v.literal('nodeslide.claim-evidence-receipt/v1'),
    receiptDigest: v.string(),
    ownerDigest: v.string(),
    deckId: v.string(),
    patchId: v.string(),
    traceId: v.optional(v.string()),
    slideId: v.string(),
    elementId: v.string(),
    claimDigest: v.string(),
    sourceRevisionId: v.string(),
    sourceRevisionDigest: v.string(),
    captureId: v.string(),
    captureDigest: v.string(),
    evidenceStepId: v.string(),
    evidenceStepDigest: v.string(),
    attachmentKind: v.union(v.literal('screenshot'), v.literal('pdf')),
    attachmentDigest: v.string(),
    region: nodeslideClaimEvidenceRegionValidator,
    createdAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_owner_created', ['ownerDigest', 'createdAt'])
    .index('by_patch_created', ['patchId', 'createdAt'])
    .index('by_claim_created', ['claimDigest', 'createdAt'])
    .index('by_source_revision_created', ['sourceRevisionId', 'createdAt']),

  /**
   * Owner-approved file uploads, quarantined until the owner releases them.
   * Deck-scoped: the row carries the file name and the digest of its bytes,
   * and `storageId` points at the stored object, so erasing the deck has to
   * take the metadata with it (the blob itself is deleted by deleteUpload).
   */
  nodeslide_uploads: defineTable({
    id: v.string(),
    deckId: v.string(),
    clientSessionId: v.string(),
    fileName: v.string(),
    format: v.union(
      v.literal('csv'),
      v.literal('json'),
      v.literal('txt'),
      v.literal('md'),
      v.literal('pdf'),
      v.literal('docx'),
      v.literal('xlsx'),
      v.literal('png'),
      v.literal('jpeg'),
      v.literal('webp'),
      v.literal('gif'),
      v.literal('pptx'),
    ),
    contentType: v.string(),
    byteSize: v.number(),
    contentDigest: v.string(),
    idempotencyKey: v.string(),
    requestFingerprint: v.string(),
    storageId: v.optional(v.id('_storage')),
    lifecycleStatus: v.union(v.literal('awaiting_upload'), v.literal('registered')),
    securityStatus: v.union(v.literal('pending'), v.literal('approved'), v.literal('rejected')),
    quarantineStatus: v.union(v.literal('quarantined'), v.literal('released')),
    createdAt: v.number(),
    updatedAt: v.number(),
    registeredAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    rejectedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_updated', ['deckId', 'updatedAt'])
    .index('by_deck_idempotency', ['deckId', 'idempotencyKey'])
    .index('by_storage', ['storageId']),

  nodeslide_agent_runs: defineTable({
    id: v.string(),
    deckId: v.string(),
    // Links this durable run to the server-authoritative cost ledger when enabled.
    budgetId: v.optional(v.string()),
    ownerDigest: v.string(),
    idempotencyKey: v.string(),
    instruction: v.string(),
    status: v.union(
      v.literal('queued'),
      v.literal('researching'),
      v.literal('planning'),
      v.literal('validating'),
      v.literal('awaiting_review'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    provider: v.string(),
    model: v.string(),
    webResearch: v.boolean(),
    attempt: v.number(),
    otelTraceId: v.optional(v.string()),
    rootSpanId: v.optional(v.string()),
    checkpoint: v.optional(v.string()),
    lastHeartbeatAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    nextTelemetrySequence: v.optional(v.number()),
    telemetryVersion: v.optional(v.string()),
    otelExportStatus: v.optional(
      v.union(
        v.literal('pending'),
        v.literal('exported'),
        v.literal('skipped'),
        v.literal('failed'),
      ),
    ),
    otelExportedAt: v.optional(v.number()),
    otelExportError: v.optional(v.string()),
    patchId: v.optional(v.string()),
    traceId: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_idempotency', ['deckId', 'idempotencyKey'])
    .index('by_deck_status_updated', ['deckId', 'status', 'updatedAt']),

  nodeslide_agent_messages: defineTable({
    id: v.string(),
    deckId: v.string(),
    runId: v.string(),
    role: v.union(
      v.literal('user'),
      v.literal('assistant'),
      v.literal('tool'),
      v.literal('system'),
    ),
    content: v.string(),
    toolName: v.optional(v.string()),
    sourceIds: v.optional(v.array(v.string())),
    streamState: v.optional(
      v.union(v.literal('streaming'), v.literal('complete'), v.literal('interrupted')),
    ),
    handoff: v.optional(
      v.object({
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
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_run_created', ['runId', 'createdAt']),

  nodeslide_agent_memories: defineTable({
    id: v.string(),
    deckId: v.string(),
    category: v.union(
      v.literal('preference'),
      v.literal('fact'),
      v.literal('decision'),
      v.literal('instruction'),
      v.literal('context'),
    ),
    content: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
    source: v.union(v.literal('user'), v.literal('agent')),
    sourceRunId: v.optional(v.string()),
    contentDigest: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    useCount: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_updated', ['deckId', 'updatedAt'])
    .index('by_deck_status_updated', ['deckId', 'status', 'updatedAt']),

  nodeslide_agent_spans: defineTable({
    id: v.string(),
    deckId: v.string(),
    runId: v.string(),
    traceId: v.string(),
    spanId: v.string(),
    parentSpanId: v.optional(v.string()),
    name: v.string(),
    operationName: v.string(),
    kind: v.union(v.literal('internal'), v.literal('client')),
    status: v.union(v.literal('unset'), v.literal('ok'), v.literal('error')),
    startTime: v.number(),
    endTime: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    toolName: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costMicroUsd: v.optional(v.number()),
    sourceIds: v.optional(v.array(v.string())),
    attributes: v.array(
      v.object({ key: v.string(), value: v.union(v.string(), v.number(), v.boolean()) }),
    ),
    sequence: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_run_sequence', ['runId', 'sequence'])
    .index('by_trace_sequence', ['traceId', 'sequence'])
    .index('by_deck_created', ['deckId', 'createdAt']),

  nodeslide_agent_events: defineTable({
    id: v.string(),
    deckId: v.string(),
    runId: v.string(),
    traceId: v.string(),
    spanId: v.string(),
    name: v.string(),
    severity: v.union(v.literal('info'), v.literal('warn'), v.literal('error')),
    timestamp: v.number(),
    body: v.string(),
    attributes: v.array(
      v.object({ key: v.string(), value: v.union(v.string(), v.number(), v.boolean()) }),
    ),
    sequence: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_run_sequence', ['runId', 'sequence'])
    .index('by_trace_sequence', ['traceId', 'sequence'])
    .index('by_deck_timestamp', ['deckId', 'timestamp']),

  nodeslide_validations: defineTable({
    id: v.string(),
    deckId: v.string(),
    deckVersion: v.number(),
    ok: v.boolean(),
    publishOk: v.boolean(),
    cleanOk: v.boolean(),
    issues: v.array(nodeslideValidationIssueValidator),
    checkedAt: v.number(),
    toolchainVersion: v.string(),
    artifactCompilation: v.optional(nodeslideArtifactCompilationReceiptValidator),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_checked', ['deckId', 'checkedAt'])
    .index('by_deck_version', ['deckId', 'deckVersion'])
    .index('by_deck_version_checked', ['deckId', 'deckVersion', 'checkedAt']),

  nodeslide_traces: defineTable({
    id: v.string(),
    deckId: v.string(),
    patchId: v.optional(v.string()),
    status: v.union(
      v.literal('planning'),
      v.literal('working'),
      v.literal('awaiting_review'),
      v.literal('completed'),
      v.literal('failed'),
      v.literal('cancelled'),
    ),
    summary: v.string(),
    plan: v.array(v.string()),
    context: v.array(v.string()),
    toolCalls: v.array(v.string()),
    guardrails: v.array(v.string()),
    planningInputDigest: v.optional(v.string()),
    planningSnapshotDigest: v.optional(v.string()),
    shadowComparisonExpected: v.optional(v.boolean()),
    shadowControlsDigest: v.optional(v.string()),
    validation: v.optional(nodeslideValidationResultValidator),
    candidateDigest: v.optional(v.string()),
    provider: v.optional(v.string()),
    model: v.optional(v.string()),
    reasoningEffort: v.optional(
      v.union(
        v.literal('low'),
        v.literal('medium'),
        v.literal('high'),
        v.literal('xhigh'),
        v.literal('max'),
      ),
    ),
    costMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    sourceBindingStatus: v.optional(nodeslideSourceBindingStatusValidator),
    claimSourceBindings: v.optional(v.array(nodeslideClaimSourceBindingValidator)),
    // Authorship, alongside provider/model rather than derived from them: a fallback run still
    // reports the provider it CALLED, so `provider` cannot answer "who wrote these operations".
    origin: v.optional(nodeslideProposalOriginValidator),
    fallbackReason: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_status_created', ['deckId', 'status', 'createdAt'])
    .index('by_patch', ['patchId'])
    .index('by_stable_deck_patch', ['id', 'deckId', 'patchId'])
    // Admission-time route availability reads the newest traces across all decks:
    // the signal is 'did this route fail recently anywhere', which is deliberately
    // not deck-scoped. Without a createdAt-leading index that read is a table scan.
    .index('by_created', ['createdAt']),

  nodeslide_execution_traces: defineTable(nodeslideExecutionTraceFields)
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_session', ['deckId', 'sessionId'])
    .index('by_deck_expiry', ['deckId', 'expiresAt'])
    .index('by_expiry', ['expiresAt'])
    .index('by_status_created', ['status', 'createdAt']),

  nodeslide_shadow_comparisons: defineTable(nodeslideShadowComparisonFields)
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_expiry', ['deckId', 'expiresAt'])
    .index('by_expiry', ['expiresAt'])
    .index('by_baseline_patch', ['baselinePatchId']),

  nodeslide_exports: defineTable({
    id: v.string(),
    deckId: v.string(),
    deckVersion: v.number(),
    kind: v.union(v.literal('html'), v.literal('pptx'), v.literal('pdf'), v.literal('png')),
    status: v.union(
      v.literal('queued'),
      v.literal('rendering'),
      v.literal('ready'),
      v.literal('failed'),
    ),
    capabilityWarnings: v.array(v.string()),
    fileName: v.optional(v.string()),
    url: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_deck_status_created', ['deckId', 'status', 'createdAt']),

  /**
   * The client-visible link between one deck and one remote presentation.
   * Deck-scoped, so it dies with the deck: the object mapping names every local
   * slide and element that was ever pushed, which is deck content by any
   * reading. `lastMutationKey` / `lastMutationFingerprint` make the mutations
   * idempotent without a second table.
   */
  nodeslide_sync_connections: defineTable({
    id: v.string(),
    deckId: v.string(),
    provider: v.literal('google_slides'),
    remotePresentationId: v.string(),
    remoteRevision: v.string(),
    lastSyncedDeckVersion: v.number(),
    objectMapping: v.array(nodeslideSyncObjectLinkValidator),
    status: v.union(
      v.literal('active'),
      v.literal('syncing'),
      v.literal('conflict'),
      v.literal('error'),
      v.literal('disconnected'),
    ),
    connectionVersion: v.number(),
    lastMutationKey: v.string(),
    lastMutationFingerprint: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastSyncedAt: v.number(),
    disconnectedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_provider', ['deckId', 'provider'])
    .index('by_provider_remote', ['provider', 'remotePresentationId']),

  /**
   * One in-flight Google OAuth authorization per attempt. The row holds the
   * PKCE verifier as ciphertext and nothing else that identifies the user, and
   * it is consumed on the callback. `deckId` is required so the row is erased
   * with the deck: an abandoned authorization is still a record that a
   * particular deck was pointed at Google.
   */
  nodeslide_oauth_sessions: defineTable({
    stateDigest: v.string(),
    deckId: v.string(),
    provider: v.literal('google_slides'),
    codeVerifierCiphertext: v.string(),
    returnTo: v.string(),
    expiresAt: v.number(),
    createdAt: v.number(),
    consumedAt: v.optional(v.number()),
  })
    .index('by_state_digest', ['stateDigest'])
    .index('by_deck_created', ['deckId', 'createdAt']),

  /**
   * The stored Google grant for one deck: access and refresh tokens as
   * ciphertext, plus the scopes Google actually returned. Deck-scoped on
   * purpose — tokens are user data, so erasing the deck must erase the grant.
   * The `*Ciphertext` field names also make the export layer withhold them.
   */
  nodeslide_oauth_credentials: defineTable({
    deckId: v.string(),
    provider: v.literal('google_slides'),
    accessTokenCiphertext: v.string(),
    refreshTokenCiphertext: v.optional(v.string()),
    accessTokenExpiresAt: v.number(),
    scopes: v.array(v.string()),
    tokenType: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_deck_provider', ['deckId', 'provider'])
    .index('by_updated', ['updatedAt']),

  /** Server-only Google Slides baseline, review, execution, and verification state. */
  nodeslide_google_sync_states: defineTable({
    id: v.string(),
    deckId: v.string(),
    remotePresentationId: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('planning'),
      v.literal('awaiting_pull_review'),
      v.literal('awaiting_push_review'),
      v.literal('executing'),
      v.literal('verifying'),
      v.literal('conflict'),
      v.literal('error'),
    ),
    stateVersion: v.number(),
    baselineJson: v.string(),
    baselineDigest: v.string(),
    baselineRemoteRevision: v.string(),
    pendingDirection: v.optional(v.union(v.literal('inbound'), v.literal('outbound'))),
    pendingPlanJson: v.optional(v.string()),
    pendingPlanDigest: v.optional(v.string()),
    pendingPatchId: v.optional(v.string()),
    lastReceiptJson: v.optional(v.string()),
    lastReceiptDigest: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck', ['deckId'])
    .index('by_remote', ['remotePresentationId']),

  /**
   * Server-owned linked-PPTX baseline and review/finalization state. Deck-scoped
   * because every JSON column here is a serialized view of the deck itself —
   * the baseline, the pending plan, and the verified remote snapshot all carry
   * slide and element content, so the link cannot outlive the deck.
   */
  nodeslide_pptx_sync_links: defineTable({
    id: v.string(),
    deckId: v.string(),
    remoteArtifactId: v.string(),
    status: v.union(
      v.literal('active'),
      v.literal('awaiting_review'),
      v.literal('awaiting_outbound_verification'),
      v.literal('ready_to_finalize'),
      v.literal('conflict'),
    ),
    stateVersion: v.number(),
    baselineJson: v.string(),
    baselineDigest: v.string(),
    baselineLocalDeckVersion: v.number(),
    baselineRemotePackageDigest: v.string(),
    pendingPlanJson: v.optional(v.string()),
    pendingPlanDigest: v.optional(v.string()),
    pendingLocalJson: v.optional(v.string()),
    pendingLocalDigest: v.optional(v.string()),
    pendingRemoteJson: v.optional(v.string()),
    pendingRemoteDigest: v.optional(v.string()),
    verifiedRemoteJson: v.optional(v.string()),
    verifiedRemoteDigest: v.optional(v.string()),
    verifiedRemotePackageDigest: v.optional(v.string()),
    lastFinalizationDigest: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck', ['deckId'])
    .index('by_remote_artifact', ['remoteArtifactId']),

  nodeslide_publications: defineTable({
    id: v.string(),
    deckId: v.string(),
    shareSlug: v.string(),
    revision: v.number(),
    deckVersion: v.number(),
    validationId: v.string(),
    status: v.union(v.literal('active'), v.literal('superseded'), v.literal('revoked')),
    snapshot: nodeslidePublishedSnapshotValidator,
    publishedAt: v.number(),
    supersededAt: v.optional(v.number()),
    supersededById: v.optional(v.string()),
    revokedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_revision', ['deckId', 'revision'])
    .index('by_share_slug_revision', ['shareSlug', 'revision']),

  /**
   * D9 approver capabilities: the token is returned exactly once at issue time and only
   * its digest persists — holding the token IS the approver role. Revoked rows are
   * retained (never deleted) so a past sign-off stays attributable in audits; a hard
   * per-deck row cap keeps every read of this table bounded by construction.
   */
  nodeslide_publish_approvers: defineTable({
    id: v.string(),
    deckId: v.string(),
    tokenDigest: v.string(),
    label: v.string(),
    issuedAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_deck', ['deckId'])
    .index('by_token_digest', ['tokenDigest']),

  /** Append-only approver sign-offs bound to an exact deck version + validation. */
  nodeslide_publish_approvals: defineTable({
    id: v.string(),
    deckId: v.string(),
    deckVersion: v.number(),
    validationId: v.string(),
    approverId: v.string(),
    approvedAt: v.number(),
  }).index('by_deck_version', ['deckId', 'deckVersion']),

  nodeslide_preference_events: defineTable({
    schemaVersion: v.literal('nodeslide.preference/v1'),
    id: v.string(),
    tenantId: v.string(),
    actorId: v.string(),
    deckId: v.string(),
    type: nodeslidePreferenceEventTypeValidator,
    scope: nodeslidePreferenceScopeValidator,
    provenance: nodeslidePreferenceProvenanceValidator,
    attributes: nodeslidePreferenceAttributesValidator,
    occurredAt: v.number(),
    recordedAt: v.number(),
    processedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_tenant_actor_recorded', ['tenantId', 'actorId', 'recordedAt'])
    .index('by_tenant_deck_recorded', ['tenantId', 'deckId', 'recordedAt'])
    .index('by_deck_recorded', ['deckId', 'recordedAt']),

  nodeslide_signature_profiles: defineTable({
    id: v.string(),
    tenantId: v.string(),
    profileId: v.string(),
    sourceDigest: v.string(),
    sourceKind: v.union(
      v.literal('pptx'),
      v.literal('pdf'),
      v.literal('screenshot'),
      v.literal('taste_pack'),
    ),
    name: v.string(),
    confidence: v.union(v.literal('high'), v.literal('medium'), v.literal('low')),
    warningCount: v.number(),
    profileJson: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_tenant_profile', ['tenantId', 'profileId'])
    .index('by_tenant_updated', ['tenantId', 'updatedAt']),

  nodeslide_taste_profiles: defineTable({
    schemaVersion: v.literal('nodeslide.preference/v1'),
    id: v.string(),
    tenantId: v.string(),
    actorId: v.string(),
    signals: v.array(nodeslidePreferenceSignalValidator),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_tenant_actor', ['tenantId', 'actorId']),

  /**
   * Content-free deletion tombstones authenticate idempotent cleanup after the
   * deck/project rows are gone. They contain only one-way target/principal
   * bindings and cannot recover workspace IDs, content, or bearer keys.
   */
  nodeslide_retention_tombstones: defineTable({
    schemaVersion: v.literal('nodeslide.retention-tombstone/v1'),
    targetBindingDigest: v.string(),
    principalBindingDigest: v.string(),
    cleanupTicketDigest: v.string(),
    createdAt: v.number(),
  }).index('by_target_binding', ['targetBindingDigest']),

  nodeslide_rate_limits: defineTable({
    key: v.string(),
    windowStart: v.number(),
    count: v.number(),
    updatedAt: v.number(),
  }).index('by_key_window', ['key', 'windowStart']),

  nodeslide_presence: defineTable({
    id: v.string(),
    deckId: v.string(),
    sessionId: v.string(),
    displayName: v.string(),
    color: v.string(),
    slideId: v.optional(v.string()),
    elementIds: v.array(v.string()),
    cursor: v.optional(nodeslideCursorValidator),
    lastSeenAt: v.number(),
    expiresAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_deck_session', ['deckId', 'sessionId'])
    .index('by_deck_expiry', ['deckId', 'expiresAt']),

  /**
   * Delegated, expiring capabilities over ONE deck. The deck owner key is the
   * root of trust; a grant is how an agent gets a narrowed slice of it without
   * ever seeing `nodeslide_decks.ownerAccessKey`.
   *
   * `deckId` is required, not optional, and that is the point: it makes the
   * row deck-owned, so the derived erasure contract takes it with the deck. A
   * grant that outlived its deck would be a live bearer capability pointing at
   * nothing — or worse, at a recycled id.
   */
  nodeslide_deck_grants: defineTable({
    id: v.string(),
    deckId: v.string(),
    role: v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer')),
    /** Only the digest is stored; the bearer token never lands in a row. */
    tokenDigest: v.string(),
    policy: v.any(),
    parentGrantId: v.optional(v.string()),
    expiresAt: v.number(),
    createdAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_deck_created', ['deckId', 'createdAt'])
    .index('by_stable_id', ['id'])
    .index('by_token_digest', ['tokenDigest']),

  /** Append-only issue/revoke trail for deck grants. Deck-owned, so erasable. */
  nodeslide_deck_grant_events: defineTable({
    id: v.string(),
    deckId: v.string(),
    grantId: v.string(),
    actorGrantId: v.optional(v.string()),
    kind: v.union(v.literal('issued'), v.literal('revoked')),
    occurredAt: v.number(),
  })
    .index('by_deck_occurred', ['deckId', 'occurredAt'])
    .index('by_stable_id', ['id'])
    .index('by_grant', ['grantId']),

  /**
   * Agent memory partitioned below the deck: `deck` > `session`. This is the
   * flat-model replacement for parity-studio's workspace > project > deck
   * memory hierarchy — rooted at the deck instead of at a tenant, and using
   * the `deck`/`session` scope keys that `nodeSlideMemoryScopeKey` already
   * canonicalizes.
   *
   * `deckId` is required on every row regardless of scope kind, so a
   * session-scoped memory cannot survive the deck it was learned on. Both
   * scope identifiers are derived from the authoritative deck row
   * (`id`, `clientSessionId`) and never from caller input.
   */
  nodeslide_scoped_memories: defineTable({
    id: v.string(),
    schemaVersion: v.literal('nodeslide.scoped-memory/v1'),
    scopeKind: v.union(v.literal('deck'), v.literal('session')),
    scopeKey: v.string(),
    deckId: v.string(),
    sessionId: v.optional(v.string()),
    category: v.union(
      v.literal('preference'),
      v.literal('fact'),
      v.literal('decision'),
      v.literal('instruction'),
      v.literal('context'),
    ),
    content: v.string(),
    contentDigest: v.string(),
    bindingDigest: v.string(),
    status: v.union(v.literal('active'), v.literal('archived')),
    source: v.union(v.literal('user'), v.literal('agent')),
    sourceRunId: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastUsedAt: v.optional(v.number()),
    useCount: v.number(),
  })
    .index('by_deck_updated', ['deckId', 'updatedAt'])
    .index('by_stable_id', ['id'])
    .index('by_scope_digest', ['scopeKey', 'contentDigest'])
    .index('by_scope_status_updated', ['scopeKey', 'status', 'updatedAt']),

  /*
   * -------------------------------------------------------------------------
   * Durable job runner and agent-session state.
   *
   * ERASURE NOTE — none of the eight tables below carries a `deckId` column, so
   * none of them is reachable by the schema-derived scan in
   * `convex/lib/nodeslideErasureContract.ts`. That is not an oversight and it is
   * not a claim that they hold no user data: they do. A `create_deck` job has no
   * deck until it succeeds, so a required `deckId` would have to be fabricated at
   * enqueue time, and a fabricated scope column is worse than an honest one that
   * is missing. They are reached instead by the two-hop derivation
   * deck -> nodeslide_agent_jobs.resultDeckId -> session/journal/budget, which is
   * implemented in `nodeslideRetention.ts` and asserted by its scenario test.
   * Each one therefore carries an explicit `NODESLIDE_ERASURE_EXCLUSIONS` entry
   * with reason `derived_scope`, and that reason is itself covered by a guard
   * test that fails if a `derived_scope` table is not in the derived sweep.
   * -------------------------------------------------------------------------
   */

  nodeslide_agent_jobs: defineTable({
    id: v.string(),
    kind: v.union(v.literal('create_deck'), v.literal('edit_proposal')),
    clientSessionId: v.string(),
    admissionQuotaSubject: v.string(),
    ownerDigest: v.string(),
    executionDigest: v.string(),
    idempotencyKey: v.string(),
    requestDigest: v.string(),
    userRequestDigest: v.optional(v.string()),
    status: v.union(...NODESLIDE_JOB_STATUSES.map((status) => v.literal(status))),
    phase: v.union(...NODESLIDE_JOB_PHASES.map((phase) => v.literal(phase))),
    progress: v.number(),
    attempt: v.number(),
    maxAttempts: v.number(),
    workflowId: v.optional(v.string()),
    streamId: v.string(),
    resultDeckId: v.optional(v.string()),
    resultPatchId: v.optional(v.string()),
    resultCandidateDigest: v.optional(v.string()),
    conversationRunId: v.optional(v.string()),
    // Budget ownership is intentionally optional until provider/job wiring lands.
    budgetId: v.optional(v.string()),
    routingReceipt: v.optional(nodeslideJobRoutingReceiptValidator),
    renderRepair: v.optional(nodeslideJobRenderRepairSummaryValidator),
    memoryIds: v.array(v.string()),
    memoryDigests: v.optional(v.array(v.string())),
    error: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_session_idempotency', ['clientSessionId', 'idempotencyKey'])
    .index('by_status_updated', ['status', 'updatedAt'])
    .index('by_result_deck', ['resultDeckId']),

  /**
   * Canonical server-owned state for a durable agent session. Request and
   * capability material is represented only by irreversible digests and safe
   * descriptors; raw prompts, credentials, and consent grants are never stored.
   */
  nodeslide_durable_sessions: defineTable({
    id: v.string(),
    schemaVersion: v.literal('nodeslide.durable-session/v2'),
    requestBinding: nodeslideDurableRequestBindingValidator,
    requestDigest: v.string(),
    capabilityDigest: v.string(),
    capability: nodeslideDurableCapabilityMetadataValidator,
    stateVersion: v.number(),
    egressEpoch: v.number(),
    activeJobId: v.union(v.null(), v.string()),
    jobs: v.record(v.string(), nodeslideDurableJobValidator),
    eventSequence: v.number(),
    transitionSequence: v.number(),
    lastTransitionDigest: v.optional(v.string()),
    stateDigest: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index('by_stable_id', ['id'])
    .index('by_binding', ['requestDigest', 'capabilityDigest'])
    .index('by_updated', ['updatedAt']),

  /** Immutable, hash-chained command outcomes for durable session recovery. */
  nodeslide_durable_session_events: defineTable({
    sessionId: v.string(),
    transitionSequence: v.number(),
    commandId: v.string(),
    commandDigest: v.string(),
    commandKind: v.union(
      v.literal('enqueue'),
      v.literal('claim'),
      v.literal('resume'),
      v.literal('retry'),
      v.literal('transition'),
      v.literal('rotate_egress'),
    ),
    stateVersion: v.number(),
    eventSequence: v.number(),
    egressEpoch: v.number(),
    requestBinding: nodeslideDurableRequestBindingValidator,
    jobId: v.optional(v.string()),
    event: v.optional(nodeslideDurableJobEventValidator),
    previousTransitionDigest: v.optional(v.string()),
    transitionDigest: v.string(),
    occurredAt: v.number(),
  })
    .index('by_session_sequence', ['sessionId', 'transitionSequence'])
    .index('by_session_command', ['sessionId', 'commandId'])
    .index('by_session_job', ['sessionId', 'jobId']),

  /**
   * Safe model/web receipts for an exact job attempt and egress epoch. Entries
   * contain digests and accounting metadata only; no prompts, URLs, or results.
   */
  nodeslide_durable_job_journal_entries: defineTable({
    sessionId: v.string(),
    jobId: v.string(),
    egressEpoch: v.number(),
    attempt: v.number(),
    sequence: v.number(),
    entryId: v.string(),
    kind: v.union(v.literal('model'), v.literal('web')),
    binding: nodeslideDurableJournalBindingValidator,
    requestDigest: v.string(),
    capabilityDigest: v.string(),
    provider: v.string(),
    model: v.optional(v.string()),
    operation: v.string(),
    inputDigest: v.optional(v.string()),
    outputDigest: v.optional(v.string()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    queryDigest: v.optional(v.string()),
    urlDigest: v.optional(v.string()),
    resultDigest: v.optional(v.string()),
    resultCount: v.optional(v.number()),
    entryInputDigest: v.string(),
    previousEntryDigest: v.optional(v.string()),
    entryDigest: v.string(),
    journalDigest: v.string(),
    createdAt: v.number(),
  })
    .index('by_binding_sequence', ['sessionId', 'jobId', 'egressEpoch', 'attempt', 'sequence'])
    .index('by_binding_entry', ['sessionId', 'jobId', 'egressEpoch', 'attempt', 'entryId']),

  /**
   * Internal model-result replay payloads written in the same transaction as
   * their model journal receipt. `payloadJson` is canonical JSON for the
   * provider result envelope only; model inputs, prompts, and secrets are not
   * accepted by the writer and have no column in this table.
   */
  nodeslide_durable_model_result_replays: defineTable({
    schemaVersion: v.literal('nodeslide.model-result-replay/v1'),
    sessionId: v.string(),
    jobId: v.string(),
    callIdDigest: v.string(),
    requestDigest: v.string(),
    capabilityDigest: v.string(),
    egressEpoch: v.number(),
    attempt: v.number(),
    binding: nodeslideDurableJournalBindingValidator,
    outputDigest: v.string(),
    payloadJson: v.string(),
    payloadBytes: v.number(),
    createdAt: v.number(),
  }).index('by_exact_binding', [
    'sessionId',
    'jobId',
    'callIdDigest',
    'requestDigest',
    'capabilityDigest',
    'egressEpoch',
    'attempt',
  ]),

  /** Monetary ledger for one job or run, in micro-USD. */
  nodeslide_run_budgets: defineTable({
    id: v.string(),
    version: v.literal('nodeslide.budget-ledger/v1'),
    status: v.union(v.literal('open'), v.literal('finalized')),
    budget: v.object({
      version: v.literal('nodeslide.run-budget/v1'),
      enforcement: v.literal('hard'),
      maxCostUsd: v.number(),
      maxCostMicroUsd: v.number(),
      maxInputTokens: v.number(),
      maxOutputTokens: v.number(),
      maxDurationMs: v.number(),
      maxIterations: v.number(),
      maxToolCalls: v.number(),
    }),
    configDigest: v.string(),
    actualMicroUsd: v.number(),
    reservedMicroUsd: v.number(),
    unreconciledMicroUsd: v.number(),
    accumulated: v.object({
      inputTokens: v.number(),
      outputTokens: v.number(),
      elapsedMs: v.number(),
      iterations: v.number(),
      toolCalls: v.number(),
    }),
    receiptDigests: v.record(v.string(), v.string()),
    accountingStateDigest: v.string(),
    revision: v.number(),
    eventSequence: v.number(),
    lastEventDigest: v.string(),
    stateDigest: v.string(),
    finalizeDigest: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
    finalizedAt: v.optional(v.number()),
  })
    .index('by_stable_id', ['id'])
    .index('by_status_updated', ['status', 'updatedAt']),

  /** A deterministic call record, keyed by (budgetId, callId). */
  nodeslide_billable_calls: defineTable({
    budgetId: v.string(),
    callId: v.string(),
    version: v.literal('nodeslide.billable-call/v1'),
    status: v.union(
      v.literal('reserved'),
      v.literal('unreconciled'),
      v.literal('settled'),
      v.literal('released'),
    ),
    model: v.string(),
    pricingDigest: v.string(),
    quoteMicroUsd: v.number(),
    estimatedInputTokens: v.number(),
    requestedMaxOutputTokens: v.number(),
    providerSafeOutputTokenCeiling: v.number(),
    providerTimeoutMs: v.number(),
    reservationDigest: v.string(),
    terminalOperationDigest: v.optional(v.string()),
    receiptDigest: v.optional(v.string()),
    actualMicroUsd: v.optional(v.number()),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    elapsedMs: v.optional(v.number()),
    iterations: v.optional(v.number()),
    toolCalls: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    settledAt: v.optional(v.number()),
    releasedAt: v.optional(v.number()),
    timeoutCapturedAt: v.optional(v.number()),
  })
    .index('by_budget_call', ['budgetId', 'callId'])
    .index('by_budget_status', ['budgetId', 'status']),

  /** Immutable audit chain for every applied budget state transition. */
  nodeslide_budget_events: defineTable({
    budgetId: v.string(),
    callId: v.optional(v.string()),
    version: v.literal('nodeslide.budget-event/v1'),
    sequence: v.number(),
    revision: v.number(),
    kind: v.union(
      v.literal('created'),
      v.literal('reserved'),
      v.literal('settled'),
      v.literal('timeout_captured'),
      v.literal('released'),
      v.literal('finalized'),
    ),
    operationDigest: v.string(),
    status: v.union(v.literal('open'), v.literal('finalized')),
    actualDeltaMicroUsd: v.number(),
    reservedDeltaMicroUsd: v.number(),
    unreconciledDeltaMicroUsd: v.number(),
    actualMicroUsd: v.number(),
    reservedMicroUsd: v.number(),
    unreconciledMicroUsd: v.number(),
    capMicroUsd: v.number(),
    accountingStateDigest: v.string(),
    budgetStateCoreDigest: v.string(),
    previousEventDigest: v.optional(v.string()),
    eventDigest: v.string(),
    createdAt: v.number(),
  })
    .index('by_budget_sequence', ['budgetId', 'sequence'])
    .index('by_budget_call', ['budgetId', 'callId']),
});
