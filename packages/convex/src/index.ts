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
  type NodeSlideStoredAsset,
  type NodeSlideTelemetryAdapter,
  type NodeSlideTelemetryRecord,
  createProductionRepositoryDescriptor,
} from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot, DeckVersion } from '@nodeslide/contracts';
import type { ConvexHttpClient } from 'convex/browser';
import type { FunctionReference } from 'convex/server';

export * from './capabilityHost';

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

export interface NodeSlideConvexReferences {
  getDeck: QueryReference<{ deckId: string }, DeckSnapshot | null>;
  applyPatch: MutationReference<
    { deckId: string; patch: NodeSlideApplyPatchInput['patch'] },
    NodeSlideApplyPatchResult
  >;
  createProposal: MutationReference<
    { deckId: string; patch: NodeSlideCreateProposalInput['patch'] },
    DeckPatch
  >;
  resolveProposal: MutationReference<
    { deckId: string; proposalId: string; decision: NodeSlideResolveProposalInput['decision'] },
    NodeSlideProposalResolution
  >;
  listVersions: QueryReference<{ deckId: string; limit?: number }, DeckVersion[]>;
  putAsset: MutationReference<
    {
      deckId: string;
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
    { deckId: string; assetId: string },
    { reference: NodeSlideAssetReference; bytes: ArrayBuffer } | null
  >;
  deleteAsset: MutationReference<{ deckId: string; assetId: string }, boolean>;
  recordTelemetry?: MutationReference<{ event: NodeSlideTelemetryRecord }, null>;
}

export interface NodeSlideConvexAdapterConfig {
  client: Pick<ConvexHttpClient, 'query' | 'mutation'>;
  references: NodeSlideConvexReferences;
  governance: NodeSlideServerGovernanceDeclaration;
  /** Confirms that the client session represents the supplied host principal. */
  bindPrincipal(principal: NodeSlidePrincipal): void | Promise<void>;
  /** Receipt storage is server-only; browser function references are never used for it. */
  storeReceipt?: (receipt: NodeSlideReceipt) => Promise<void>;
}

export interface NodeSlideConvexAdapters {
  repository: NodeSlideConvexRepository;
  assets: NodeSlideConvexAssetStore;
  telemetry: NodeSlideConvexTelemetryAdapter;
}

export function createNodeSlideConvexAdapters(
  config: NodeSlideConvexAdapterConfig,
): NodeSlideConvexAdapters {
  return {
    repository: new NodeSlideConvexRepository(config),
    assets: new NodeSlideConvexAssetStore(config),
    telemetry: new NodeSlideConvexTelemetryAdapter(config),
  };
}

export class NodeSlideConvexRepository implements NodeSlideRepository {
  readonly descriptor: NodeSlideRepositoryDescriptor;

  constructor(private readonly config: NodeSlideConvexAdapterConfig) {
    this.descriptor = createProductionRepositoryDescriptor(
      'convex',
      'NodeSlide Convex component',
      config.governance,
    );
  }

  async getDeck(input: NodeSlideGetDeckInput): Promise<DeckSnapshot | null> {
    await this.config.bindPrincipal(input.principal);
    return this.config.client.query(this.config.references.getDeck, { deckId: input.deckId });
  }

  async applyPatch(input: NodeSlideApplyPatchInput): Promise<NodeSlideApplyPatchResult> {
    await this.config.bindPrincipal(input.principal);
    return this.config.client.mutation(this.config.references.applyPatch, {
      deckId: input.deckId,
      patch: input.patch,
    });
  }

  async createProposal(input: NodeSlideCreateProposalInput): Promise<DeckPatch> {
    await this.config.bindPrincipal(input.principal);
    return this.config.client.mutation(this.config.references.createProposal, {
      deckId: input.deckId,
      patch: input.patch,
    });
  }

  async resolveProposal(
    input: NodeSlideResolveProposalInput,
  ): Promise<NodeSlideProposalResolution> {
    await this.config.bindPrincipal(input.principal);
    return this.config.client.mutation(this.config.references.resolveProposal, {
      deckId: input.deckId,
      proposalId: input.proposalId,
      decision: input.decision,
    });
  }

  async listVersions(input: NodeSlideListVersionsInput): Promise<DeckVersion[]> {
    await this.config.bindPrincipal(input.principal);
    return this.config.client.query(this.config.references.listVersions, {
      deckId: input.deckId,
      ...(input.limit === undefined ? {} : { limit: input.limit }),
    });
  }

  async storeReceipt(receipt: NodeSlideReceipt): Promise<void> {
    if (!this.config.storeReceipt) {
      throw new NodeSlideRepositoryError(
        'forbidden',
        'Convex receipt storage requires a server-only callback.',
      );
    }
    await this.config.storeReceipt(receipt);
  }
}

export class NodeSlideConvexAssetStore implements NodeSlideAssetStore {
  constructor(private readonly config: NodeSlideConvexAdapterConfig) {}

  async put(input: NodeSlidePutAssetInput): Promise<NodeSlideAssetReference> {
    await this.config.bindPrincipal(input.principal);
    return this.config.client.mutation(this.config.references.putAsset, {
      deckId: input.deckId,
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
    await this.config.bindPrincipal(input.principal);
    const result = await this.config.client.query(this.config.references.getAsset, {
      deckId: input.deckId,
      assetId: input.assetId,
    });
    return result
      ? { reference: result.reference, bytes: new Uint8Array(result.bytes.slice(0)) }
      : null;
  }

  async delete(input: NodeSlideDeleteAssetInput): Promise<boolean> {
    await this.config.bindPrincipal(input.principal);
    return this.config.client.mutation(this.config.references.deleteAsset, {
      deckId: input.deckId,
      assetId: input.assetId,
    });
  }
}

export class NodeSlideConvexTelemetryAdapter implements NodeSlideTelemetryAdapter {
  constructor(private readonly config: NodeSlideConvexAdapterConfig) {}

  async record(event: NodeSlideTelemetryRecord): Promise<void> {
    const reference = this.config.references.recordTelemetry;
    if (!reference) return;
    await this.config.client.mutation(reference, { event });
  }
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
