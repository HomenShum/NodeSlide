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
  type NodeSlideRepositoryErrorCode,
  type NodeSlideResolveProposalInput,
  type NodeSlideServerGovernanceDeclaration,
  type NodeSlideStoreReceiptInput,
  type NodeSlideStoredAsset,
  type NodeSlideTelemetryAdapter,
  type NodeSlideTelemetryRecord,
  createProductionRepositoryDescriptor,
} from '@nodeslide/backend';
import type { DeckPatch, DeckSnapshot, DeckVersion } from '@nodeslide/contracts';

export interface NodeSlideHttpAdapterConfig {
  baseUrl: string;
  governance: NodeSlideServerGovernanceDeclaration;
  /** Must derive credentials from trusted host state; the principal is never sent in JSON. */
  headersForPrincipal(principal: NodeSlidePrincipal): HeadersInit | Promise<HeadersInit>;
  /** Required only for backend-only telemetry endpoints. */
  systemHeaders?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  apiPrefix?: string;
  fetch?: typeof globalThis.fetch;
}

export interface NodeSlideHttpAdapters {
  repository: NodeSlideHttpRepository;
  assets: NodeSlideHttpAssetStore;
  telemetry: NodeSlideHttpTelemetryAdapter;
}

interface HttpAssetBody {
  reference: NodeSlideAssetReference;
  bytesBase64: string;
}

interface HttpErrorBody {
  error?: { code?: string; message?: string };
}

export function createNodeSlideHttpAdapters(
  config: NodeSlideHttpAdapterConfig,
): NodeSlideHttpAdapters {
  const transport = new NodeSlideHttpTransport(config);
  return {
    repository: new NodeSlideHttpRepository(transport, config.governance),
    assets: new NodeSlideHttpAssetStore(transport),
    telemetry: new NodeSlideHttpTelemetryAdapter(transport),
  };
}

export class NodeSlideHttpRepository implements NodeSlideRepository {
  readonly descriptor: NodeSlideRepositoryDescriptor;

  constructor(
    private readonly transport: NodeSlideHttpTransport,
    governance: NodeSlideServerGovernanceDeclaration,
  ) {
    this.descriptor = createProductionRepositoryDescriptor(
      'http',
      'NodeSlide hosted API',
      governance,
    );
  }

  async getDeck(input: NodeSlideGetDeckInput): Promise<DeckSnapshot | null> {
    return this.transport.principalRequest<DeckSnapshot>(
      input.principal,
      `/decks/${segment(input.deckId)}`,
      { method: 'GET' },
      true,
    );
  }

  async applyPatch(input: NodeSlideApplyPatchInput): Promise<NodeSlideApplyPatchResult> {
    return this.transport.requiredPrincipalRequest(
      input.principal,
      `/decks/${segment(input.deckId)}/patches:apply`,
      jsonRequest('POST', { patch: input.patch }),
    );
  }

  async createProposal(input: NodeSlideCreateProposalInput): Promise<DeckPatch> {
    return this.transport.requiredPrincipalRequest(
      input.principal,
      `/decks/${segment(input.deckId)}/proposals`,
      jsonRequest('POST', { patch: input.patch }),
    );
  }

  async resolveProposal(
    input: NodeSlideResolveProposalInput,
  ): Promise<NodeSlideProposalResolution> {
    return this.transport.requiredPrincipalRequest(
      input.principal,
      `/decks/${segment(input.deckId)}/proposals/${segment(input.proposalId)}:resolve`,
      jsonRequest('POST', { decision: input.decision }),
    );
  }

  async listVersions(input: NodeSlideListVersionsInput): Promise<DeckVersion[]> {
    const query =
      input.limit === undefined ? '' : `?limit=${encodeURIComponent(String(input.limit))}`;
    return this.transport.requiredPrincipalRequest(
      input.principal,
      `/decks/${segment(input.deckId)}/versions${query}`,
      { method: 'GET' },
    );
  }

  async storeReceipt(input: NodeSlideStoreReceiptInput): Promise<NodeSlideReceipt> {
    return this.transport.requiredPrincipalRequest(
      input.principal,
      `/decks/${segment(input.deckId)}/receipts`,
      jsonRequest('POST', { receipt: input.receipt }),
    );
  }
}

export class NodeSlideHttpAssetStore implements NodeSlideAssetStore {
  constructor(private readonly transport: NodeSlideHttpTransport) {}

  put(input: NodeSlidePutAssetInput): Promise<NodeSlideAssetReference> {
    return this.transport.requiredPrincipalRequest(
      input.principal,
      `/decks/${segment(input.deckId)}/assets`,
      jsonRequest('PUT', {
        ...(input.id === undefined ? {} : { id: input.id }),
        kind: input.kind,
        fileName: input.fileName,
        contentType: input.contentType,
        contentDigest: input.contentDigest,
        bytesBase64: bytesToBase64(input.bytes),
        metadata: input.metadata ?? {},
      }),
    );
  }

  async get(input: NodeSlideGetAssetInput): Promise<NodeSlideStoredAsset | null> {
    const body = await this.transport.principalRequest<HttpAssetBody>(
      input.principal,
      `/decks/${segment(input.deckId)}/assets/${segment(input.assetId)}`,
      { method: 'GET' },
      true,
    );
    return body ? { reference: body.reference, bytes: base64ToBytes(body.bytesBase64) } : null;
  }

  delete(input: NodeSlideDeleteAssetInput): Promise<boolean> {
    return this.transport.requiredPrincipalRequest(
      input.principal,
      `/decks/${segment(input.deckId)}/assets/${segment(input.assetId)}`,
      { method: 'DELETE' },
    );
  }
}

export class NodeSlideHttpTelemetryAdapter implements NodeSlideTelemetryAdapter {
  constructor(private readonly transport: NodeSlideHttpTransport) {}

  async record(event: NodeSlideTelemetryRecord): Promise<void> {
    await this.transport.requiredSystemRequest('/telemetry', jsonRequest('POST', { event }));
  }

  async flush(): Promise<void> {
    await this.transport.requiredSystemRequest('/telemetry:flush', jsonRequest('POST', {}));
  }
}

export class NodeSlideHttpTransport {
  readonly #baseUrl: string;
  readonly #apiPrefix: string;
  readonly #fetch: typeof globalThis.fetch;

  constructor(private readonly config: NodeSlideHttpAdapterConfig) {
    if (!config.baseUrl.trim()) throw new Error('NodeSlide HTTP baseUrl is required.');
    this.#baseUrl = config.baseUrl.endsWith('/') ? config.baseUrl : `${config.baseUrl}/`;
    this.#apiPrefix = (config.apiPrefix ?? 'v1').replace(/^\/+|\/+$/g, '');
    this.#fetch = config.fetch ?? globalThis.fetch;
    if (!this.#fetch) throw new Error('NodeSlide HTTP adapter requires a fetch implementation.');
  }

  async requiredPrincipalRequest<T>(
    principal: NodeSlidePrincipal,
    path: string,
    init: RequestInit,
  ): Promise<T> {
    const result = await this.principalRequest<T>(principal, path, init);
    if (result === null)
      throw new NodeSlideRepositoryError('not_found', 'NodeSlide resource not found.');
    return result;
  }

  async principalRequest<T>(
    principal: NodeSlidePrincipal,
    path: string,
    init: RequestInit,
    allowNotFound = false,
  ): Promise<T | null> {
    const headers = await this.config.headersForPrincipal(principal);
    return this.#request(path, init, headers, allowNotFound);
  }

  async requiredSystemRequest<T>(path: string, init: RequestInit): Promise<T> {
    const source = this.config.systemHeaders;
    if (!source) {
      throw new NodeSlideRepositoryError(
        'forbidden',
        'This HTTP adapter has no system credentials for receipt or telemetry writes.',
      );
    }
    const headers = typeof source === 'function' ? await source() : source;
    const result = await this.#request<T>(path, init, headers, false);
    if (result === null)
      throw new NodeSlideRepositoryError('not_found', 'NodeSlide resource not found.');
    return result;
  }

  async #request<T>(
    path: string,
    init: RequestInit,
    authHeaders: HeadersInit,
    allowNotFound: boolean,
  ): Promise<T | null> {
    const headers = new Headers(authHeaders);
    headers.set('accept', 'application/json');
    if (init.body !== undefined && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    const response = await this.#fetch(
      new URL(`${this.#apiPrefix}/${path.replace(/^\/+/, '')}`, this.#baseUrl),
      { ...init, headers },
    );
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) throw await httpError(response);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }
}

function jsonRequest(method: string, value: unknown): RequestInit {
  return { method, body: JSON.stringify(value) };
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

async function httpError(response: Response): Promise<NodeSlideRepositoryError> {
  let body: HttpErrorBody | null = null;
  try {
    body = (await response.json()) as HttpErrorBody;
  } catch {
    // The status mapping below remains fail-closed when the server returns non-JSON.
  }
  const code = repositoryErrorCode(body?.error?.code, response.status);
  const message = body?.error?.message ?? `NodeSlide HTTP request failed with ${response.status}.`;
  return new NodeSlideRepositoryError(code, message);
}

function repositoryErrorCode(
  value: string | undefined,
  status: number,
): NodeSlideRepositoryErrorCode {
  if (
    value === 'not_found' ||
    value === 'conflict' ||
    value === 'forbidden' ||
    value === 'invalid_state'
  ) {
    return value;
  }
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 401 || status === 403) return 'forbidden';
  return 'invalid_state';
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
