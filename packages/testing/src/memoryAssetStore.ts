import {
  type NodeSlideAssetReference,
  type NodeSlideAssetStore,
  type NodeSlideDeleteAssetInput,
  type NodeSlideGetAssetInput,
  type NodeSlidePrincipal,
  type NodeSlidePutAssetInput,
  NodeSlideRepositoryError,
  type NodeSlideStoredAsset,
} from '../../backend/src';

export type MemoryNodeSlideAssetAction = 'put' | 'get' | 'delete';

export interface MemoryNodeSlideAssetStoreOptions {
  now?: () => number;
  authorize?: (
    principal: NodeSlidePrincipal,
    deckId: string,
    action: MemoryNodeSlideAssetAction,
  ) => void | Promise<void>;
}

function cloneAsset(asset: NodeSlideStoredAsset): NodeSlideStoredAsset {
  return {
    reference: structuredClone(asset.reference),
    bytes: new Uint8Array(asset.bytes),
  };
}

export class MemoryNodeSlideAssetStore implements NodeSlideAssetStore {
  readonly #assets = new Map<string, NodeSlideStoredAsset>();
  readonly #now: () => number;
  readonly #authorize: NonNullable<MemoryNodeSlideAssetStoreOptions['authorize']>;
  #sequence = 0;

  constructor(options: MemoryNodeSlideAssetStoreOptions = {}) {
    this.#now = options.now ?? (() => Date.now());
    this.#authorize = options.authorize ?? (() => undefined);
  }

  async put(input: NodeSlidePutAssetInput): Promise<NodeSlideAssetReference> {
    await this.#authorize(input.principal, input.deckId, 'put');
    this.#sequence += 1;
    const id = input.id ?? `asset:${input.deckId}:${this.#sequence}`;
    const existing = this.#assets.get(id);
    if (existing && existing.reference.deckId !== input.deckId) {
      throw new NodeSlideRepositoryError('forbidden', `Asset ${id} belongs to another deck.`);
    }
    const reference: NodeSlideAssetReference = {
      id,
      deckId: input.deckId,
      kind: input.kind,
      fileName: input.fileName,
      contentType: input.contentType,
      byteSize: input.bytes.byteLength,
      contentDigest: input.contentDigest,
      createdAt: existing?.reference.createdAt ?? this.#now(),
      metadata: structuredClone(input.metadata ?? {}),
    };
    this.#assets.set(id, { reference, bytes: new Uint8Array(input.bytes) });
    return structuredClone(reference);
  }

  async get(input: NodeSlideGetAssetInput): Promise<NodeSlideStoredAsset | null> {
    await this.#authorize(input.principal, input.deckId, 'get');
    const asset = this.#assets.get(input.assetId);
    if (!asset || asset.reference.deckId !== input.deckId) return null;
    return cloneAsset(asset);
  }

  async delete(input: NodeSlideDeleteAssetInput): Promise<boolean> {
    await this.#authorize(input.principal, input.deckId, 'delete');
    const asset = this.#assets.get(input.assetId);
    if (!asset || asset.reference.deckId !== input.deckId) return false;
    return this.#assets.delete(input.assetId);
  }
}
