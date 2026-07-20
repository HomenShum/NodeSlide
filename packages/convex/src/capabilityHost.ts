import {
  type NodeSlideApplyPatchInput,
  type NodeSlideApplyPatchResult,
  type NodeSlideAssetReference,
  type NodeSlideAssetStore,
  type NodeSlideCreateProposalInput,
  type NodeSlideDeleteAssetInput,
  type NodeSlideGetAssetInput,
  type NodeSlideGetDeckInput,
  type NodeSlideListVersionsInput,
  type NodeSlidePrincipal,
  type NodeSlideProposalResolution,
  type NodeSlidePutAssetInput,
  type NodeSlideReceipt,
  type NodeSlideRepository,
  type NodeSlideRepositoryDescriptor,
  NodeSlideRepositoryError,
  type NodeSlideResolveProposalInput,
  type NodeSlideServerGovernanceDeclaration,
  type NodeSlideStoreReceiptInput,
  type NodeSlideStoredAsset,
  type NodeSlideTelemetryAdapter,
  createProductionRepositoryDescriptor,
} from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot, DeckVersion } from '@nodeslide/contracts';
import type { ConvexHttpClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';

type QueryReference<Args extends Record<string, unknown>, Result> = FunctionReference<
  'query',
  'public',
  Args,
  Result
>;
type MutationReference<Args extends Record<string, unknown>, Result> = FunctionReference<
  'mutation',
  'public',
  Args,
  Result
>;

type OwnerAuthorization = { deckId: string; ownerAccessKey: string };

/** Public host mutations accept only human-owned patch fields. */
export type NodeSlideCapabilityHostPatch = Pick<
  NodeSlideApplyPatchInput['patch'],
  | 'deckId'
  | 'baseDeckVersion'
  | 'baseSlideVersions'
  | 'baseElementVersions'
  | 'scope'
  | 'operations'
> &
  Partial<
    Pick<
      NodeSlideApplyPatchInput['patch'],
      'id' | 'summary' | 'linkedCommentId' | 'profileId' | 'profileDigest'
    >
  >;

export type NodeSlideCapabilityApplyResult =
  | { status: 'accepted'; result: NodeSlideApplyPatchResult }
  | {
      status: 'stale';
      patch: DeckPatch;
      snapshot: DeckSnapshot;
      receipt: NodeSlideReceipt;
      reasons: string[];
    };

export interface NodeSlideCapabilityConvexReferences {
  getDeck: QueryReference<OwnerAuthorization, DeckSnapshot | null>;
  applyPatch: MutationReference<
    OwnerAuthorization & { patch: NodeSlideCapabilityHostPatch },
    NodeSlideCapabilityApplyResult
  >;
  createProposal: MutationReference<
    OwnerAuthorization & { patch: NodeSlideCapabilityHostPatch },
    { patch: DeckPatch; receipt: NodeSlideReceipt }
  >;
  resolveProposal: MutationReference<
    OwnerAuthorization & {
      proposalId: string;
      decision: NodeSlideResolveProposalInput['decision'];
    },
    NodeSlideProposalResolution
  >;
  listVersions: QueryReference<OwnerAuthorization & { limit?: number }, DeckVersion[]>;
  putAsset: MutationReference<
    OwnerAuthorization & {
      id?: string;
      kind: NodeSlidePutAssetInput['kind'];
      fileName: string;
      contentType: string;
      contentDigest: string;
      bytes: ArrayBuffer;
      metadata: NonNullable<NodeSlidePutAssetInput['metadata']>;
    },
    NodeSlideAssetReference
  >;
  getAsset: QueryReference<
    OwnerAuthorization & { assetId: string },
    { reference: NodeSlideAssetReference; bytes: ArrayBuffer } | null
  >;
  deleteAsset: MutationReference<OwnerAuthorization & { assetId: string }, boolean>;
}

export interface NodeSlideCapabilityConvexAdapterConfig {
  client: Pick<ConvexHttpClient, 'query' | 'mutation'>;
  references: NodeSlideCapabilityConvexReferences;
  governance: NodeSlideServerGovernanceDeclaration;
  /**
   * Resolves the app's server-issued bearer capability. The serialized
   * NodeSlidePrincipal is intentionally never sent to Convex; the server
   * derives the authoritative principal from this capability.
   */
  resolveOwnerAccessKey(principal: NodeSlidePrincipal, deckId: string): string | Promise<string>;
}

export interface NodeSlideCapabilityConvexAdapters {
  repository: NodeSlideCapabilityConvexRepository;
  assets: NodeSlideCapabilityConvexAssetStore;
  telemetry: NodeSlideTelemetryAdapter;
}

export function createNodeSlideCapabilityConvexAdapters(
  config: NodeSlideCapabilityConvexAdapterConfig,
): NodeSlideCapabilityConvexAdapters {
  return {
    repository: new NodeSlideCapabilityConvexRepository(config),
    assets: new NodeSlideCapabilityConvexAssetStore(config),
    telemetry: { record: async () => undefined },
  };
}

/**
 * Production adapter for NodeSlide's anonymous-owner deployment. It is kept
 * separate from the auth-session adapter because a bearer capability is a
 * request credential, not a client-asserted principal.
 */
export class NodeSlideCapabilityConvexRepository implements NodeSlideRepository {
  readonly descriptor: NodeSlideRepositoryDescriptor;

  constructor(private readonly config: NodeSlideCapabilityConvexAdapterConfig) {
    this.descriptor = createProductionRepositoryDescriptor(
      'convex',
      'NodeSlide capability-authenticated Convex host',
      config.governance,
    );
  }

  async getDeck(input: NodeSlideGetDeckInput): Promise<DeckSnapshot | null> {
    const authorization = await this.#authorization(input.principal, input.deckId);
    return this.config.client.query(this.config.references.getDeck, authorization);
  }

  async applyPatch(input: NodeSlideApplyPatchInput): Promise<NodeSlideApplyPatchResult> {
    const authorization = await this.#authorization(input.principal, input.deckId);
    const response = await this.config.client.mutation(this.config.references.applyPatch, {
      ...authorization,
      patch: capabilityHostPatch(input.patch),
    });
    if (response.status === 'stale') {
      throw new NodeSlideRepositoryError(
        'conflict',
        response.reasons[0] ?? `Patch ${response.patch.id} is stale.`,
      );
    }
    return response.result;
  }

  async createProposal(input: NodeSlideCreateProposalInput): Promise<DeckPatch> {
    const authorization = await this.#authorization(input.principal, input.deckId);
    const response = await this.config.client.mutation(this.config.references.createProposal, {
      ...authorization,
      patch: capabilityHostPatch(input.patch),
    });
    return response.patch;
  }

  async resolveProposal(
    input: NodeSlideResolveProposalInput,
  ): Promise<NodeSlideProposalResolution> {
    const authorization = await this.#authorization(input.principal, input.deckId);
    return this.config.client.mutation(this.config.references.resolveProposal, {
      ...authorization,
      proposalId: input.proposalId,
      decision: input.decision,
    });
  }

  async listVersions(input: NodeSlideListVersionsInput): Promise<DeckVersion[]> {
    const authorization = await this.#authorization(input.principal, input.deckId);
    return this.config.client.query(this.config.references.listVersions, {
      ...authorization,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }

  async storeReceipt(input: NodeSlideStoreReceiptInput): Promise<NodeSlideReceipt> {
    throw new NodeSlideRepositoryError(
      'forbidden',
      `Receipt ${input.receipt.id} was not produced by the server mutation path.`,
    );
  }

  async #authorization(principal: NodeSlidePrincipal, deckId: string): Promise<OwnerAuthorization> {
    const ownerAccessKey = await this.config.resolveOwnerAccessKey(principal, deckId);
    assertOwnerAccessKey(ownerAccessKey);
    return { deckId, ownerAccessKey };
  }
}

export class NodeSlideCapabilityConvexAssetStore implements NodeSlideAssetStore {
  constructor(private readonly config: NodeSlideCapabilityConvexAdapterConfig) {}

  async put(input: NodeSlidePutAssetInput): Promise<NodeSlideAssetReference> {
    const authorization = await this.#authorization(input.principal, input.deckId);
    return this.config.client.mutation(this.config.references.putAsset, {
      ...authorization,
      ...(input.id === undefined ? {} : { id: input.id }),
      kind: input.kind,
      fileName: input.fileName,
      contentType: input.contentType,
      contentDigest: input.contentDigest,
      bytes: exactArrayBuffer(input.bytes),
      metadata: input.metadata ?? {},
    });
  }

  async get(input: NodeSlideGetAssetInput): Promise<NodeSlideStoredAsset | null> {
    const authorization = await this.#authorization(input.principal, input.deckId);
    const value = await this.config.client.query(this.config.references.getAsset, {
      ...authorization,
      assetId: input.assetId,
    });
    return value
      ? { reference: value.reference, bytes: new Uint8Array(value.bytes.slice(0)) }
      : null;
  }

  async delete(input: NodeSlideDeleteAssetInput): Promise<boolean> {
    const authorization = await this.#authorization(input.principal, input.deckId);
    return this.config.client.mutation(this.config.references.deleteAsset, {
      ...authorization,
      assetId: input.assetId,
    });
  }

  async #authorization(principal: NodeSlidePrincipal, deckId: string): Promise<OwnerAuthorization> {
    const ownerAccessKey = await this.config.resolveOwnerAccessKey(principal, deckId);
    assertOwnerAccessKey(ownerAccessKey);
    return { deckId, ownerAccessKey };
  }
}

function assertOwnerAccessKey(value: string): void {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new NodeSlideRepositoryError('forbidden', 'NodeSlide owner access is unavailable.');
  }
}

function capabilityHostPatch(
  patch: NodeSlideApplyPatchInput['patch'],
): NodeSlideCapabilityHostPatch {
  return {
    id: patch.id,
    deckId: patch.deckId,
    baseDeckVersion: patch.baseDeckVersion,
    baseSlideVersions: patch.baseSlideVersions,
    baseElementVersions: patch.baseElementVersions,
    scope: patch.scope,
    operations: patch.operations,
    summary: patch.summary,
    ...(patch.linkedCommentId === undefined ? {} : { linkedCommentId: patch.linkedCommentId }),
    ...(patch.profileId === undefined ? {} : { profileId: patch.profileId }),
    ...(patch.profileDigest === undefined ? {} : { profileDigest: patch.profileDigest }),
  };
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
