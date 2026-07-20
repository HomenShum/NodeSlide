import type {
  CandidateValidationReceipt,
  DeckPatch,
  DeckSnapshot,
  DeckVersion,
  NodeSlideProposalKind,
  PatchOperation,
  PatchScope,
  PatchSource,
} from '../../../shared/nodeslide';

/** Host-authenticated identity normalized before it enters NodeSlide. */
export interface NodeSlidePrincipal {
  userId: string;
  organizationId?: string;
  roles: readonly string[];
  permissions: readonly string[];
}

export type NodeSlideJsonValue =
  | string
  | number
  | boolean
  | null
  | NodeSlideJsonValue[]
  | { [key: string]: NodeSlideJsonValue };

export interface NodeSlideAuthorizedDeckRequest {
  deckId: string;
  principal: NodeSlidePrincipal;
}

/**
 * Command form of a patch. Persistence-owned status and timestamps are not
 * accepted from the caller.
 */
export interface NodeSlidePatchCommand {
  id: string;
  deckId: string;
  baseDeckVersion: number;
  baseSlideVersions: Record<string, number>;
  baseElementVersions: Record<string, number>;
  scope: PatchScope;
  operations: PatchOperation[];
  source: PatchSource;
  summary: string;
  linkedCommentId?: string;
  traceId?: string;
  proposalKind?: NodeSlideProposalKind;
  parentPatchId?: string;
  affectedSlideIds?: string[];
  affectedSlideDigest?: string;
  candidateDigest?: string;
  candidateValidation?: CandidateValidationReceipt;
  profileId?: string;
  profileDigest?: string;
}

export interface NodeSlideGetDeckInput extends NodeSlideAuthorizedDeckRequest {}

export interface NodeSlideApplyPatchInput extends NodeSlideAuthorizedDeckRequest {
  patch: NodeSlidePatchCommand;
}

export interface NodeSlideCreateProposalInput extends NodeSlideAuthorizedDeckRequest {
  patch: NodeSlidePatchCommand;
}

export type NodeSlideProposalDecision = 'accept' | 'reject';

export interface NodeSlideResolveProposalInput extends NodeSlideAuthorizedDeckRequest {
  proposalId: string;
  decision: NodeSlideProposalDecision;
}

export interface NodeSlideListVersionsInput extends NodeSlideAuthorizedDeckRequest {
  limit?: number;
}

export type NodeSlideReceiptOperation =
  | 'patch.applied'
  | 'proposal.created'
  | 'proposal.accepted'
  | 'proposal.rejected'
  | 'proposal.stale'
  | 'custom';

/** Portable receipt envelope. Backend-specific proof may be carried in attributes. */
export interface NodeSlideReceipt {
  id: string;
  deckId: string;
  deckVersion: number;
  operation: NodeSlideReceiptOperation;
  principalId: string;
  patchId?: string;
  traceId?: string;
  recordedAt: number;
  attributes: Record<string, NodeSlideJsonValue>;
}

export interface NodeSlideApplyPatchResult {
  patch: DeckPatch;
  snapshot: DeckSnapshot;
  affectedSlideIds: string[];
  affectedElementIds: string[];
  receipt: NodeSlideReceipt;
}

export type NodeSlideProposalResolution =
  | {
      status: 'accepted';
      patch: DeckPatch;
      snapshot: DeckSnapshot;
      receipt: NodeSlideReceipt;
    }
  | {
      status: 'rejected' | 'stale';
      patch: DeckPatch;
      snapshot: DeckSnapshot;
      receipt: NodeSlideReceipt;
    };

/**
 * Persistence boundary for an injectable NodeSlide host. Implementations may
 * use Convex, HTTP, Postgres, or an in-memory test store.
 */
export interface NodeSlideRepository {
  getDeck(input: NodeSlideGetDeckInput): Promise<DeckSnapshot | null>;
  applyPatch(input: NodeSlideApplyPatchInput): Promise<NodeSlideApplyPatchResult>;
  createProposal(input: NodeSlideCreateProposalInput): Promise<DeckPatch>;
  resolveProposal(input: NodeSlideResolveProposalInput): Promise<NodeSlideProposalResolution>;
  listVersions(input: NodeSlideListVersionsInput): Promise<DeckVersion[]>;
  storeReceipt(receipt: NodeSlideReceipt): Promise<void>;
}

export type NodeSlideAssetKind = 'image' | 'video' | 'document' | 'data' | 'export' | 'other';

export interface NodeSlideAssetReference {
  id: string;
  deckId: string;
  kind: NodeSlideAssetKind;
  fileName: string;
  contentType: string;
  byteSize: number;
  contentDigest: string;
  createdAt: number;
  url?: string;
  metadata: Record<string, NodeSlideJsonValue>;
}

export interface NodeSlideStoredAsset {
  reference: NodeSlideAssetReference;
  bytes: Uint8Array;
}

export interface NodeSlidePutAssetInput extends NodeSlideAuthorizedDeckRequest {
  id?: string;
  kind: NodeSlideAssetKind;
  fileName: string;
  contentType: string;
  contentDigest: string;
  bytes: Uint8Array;
  metadata?: Record<string, NodeSlideJsonValue>;
}

export interface NodeSlideGetAssetInput extends NodeSlideAuthorizedDeckRequest {
  assetId: string;
}

export interface NodeSlideDeleteAssetInput extends NodeSlideAuthorizedDeckRequest {
  assetId: string;
}

export interface NodeSlideAssetStore {
  put(input: NodeSlidePutAssetInput): Promise<NodeSlideAssetReference>;
  get(input: NodeSlideGetAssetInput): Promise<NodeSlideStoredAsset | null>;
  delete(input: NodeSlideDeleteAssetInput): Promise<boolean>;
}

export type NodeSlideTelemetrySeverity = 'debug' | 'info' | 'warn' | 'error';

export interface NodeSlideTelemetryRecord {
  name: string;
  timestamp: number;
  severity: NodeSlideTelemetrySeverity;
  deckId?: string;
  runId?: string;
  traceId?: string;
  attributes: Record<string, NodeSlideJsonValue>;
}

export interface NodeSlideTelemetryAdapter {
  record(event: NodeSlideTelemetryRecord): Promise<void>;
  flush?(): Promise<void>;
}

export type NodeSlideRepositoryErrorCode = 'not_found' | 'conflict' | 'forbidden' | 'invalid_state';

export class NodeSlideRepositoryError extends Error {
  readonly code: NodeSlideRepositoryErrorCode;

  constructor(code: NodeSlideRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'NodeSlideRepositoryError';
    this.code = code;
  }
}
