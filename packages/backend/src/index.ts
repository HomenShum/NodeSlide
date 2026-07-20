import type {
  CandidateValidationReceipt,
  DeckPatch,
  DeckSnapshot,
  DeckVersion,
  NodeSlideProposalKind,
  OperationMode,
  PatchOperation,
  PatchScope,
  PatchSource,
} from '@nodeslide/contracts';

/** Host-authenticated identity normalized before it enters NodeSlide. */
export interface NodeSlidePrincipal {
  userId: string;
  organizationId?: string;
  roles: readonly string[];
  permissions: readonly string[];
}

export const NODESLIDE_PERMISSIONS = {
  read: 'nodeslide:read',
  propose: 'nodeslide:propose',
  write: 'nodeslide:write',
  approve: 'nodeslide:approve',
  export: 'nodeslide:export',
  publish: 'nodeslide:publish',
  rollback: 'nodeslide:rollback',
  manageAssets: 'nodeslide:assets',
} as const;

export type NodeSlidePermission =
  (typeof NODESLIDE_PERMISSIONS)[keyof typeof NODESLIDE_PERMISSIONS];

/** Host auth is resolved before repository calls; packages never import an auth vendor. */
export interface NodeSlidePrincipalAdapter<HostContext = unknown> {
  resolvePrincipal(context: HostContext): Promise<NodeSlidePrincipal | null>;
}

export type NodeSlideRepositoryAction =
  | 'deck.read'
  | 'deck.propose'
  | 'deck.mutate'
  | 'proposal.resolve'
  | 'versions.read'
  | 'deck.export'
  | 'deck.publish'
  | 'deck.rollback'
  | 'assets.manage';

export interface NodeSlideAuthorizationRequest {
  principal: NodeSlidePrincipal;
  deckId: string;
  action: NodeSlideRepositoryAction;
}

export interface NodeSlideAuthorizationAdapter {
  authorize(request: NodeSlideAuthorizationRequest): Promise<void>;
}

const ACTION_PERMISSION: Readonly<Record<NodeSlideRepositoryAction, NodeSlidePermission>> = {
  'deck.read': NODESLIDE_PERMISSIONS.read,
  'deck.propose': NODESLIDE_PERMISSIONS.propose,
  'deck.mutate': NODESLIDE_PERMISSIONS.write,
  'proposal.resolve': NODESLIDE_PERMISSIONS.approve,
  'versions.read': NODESLIDE_PERMISSIONS.read,
  'deck.export': NODESLIDE_PERMISSIONS.export,
  'deck.publish': NODESLIDE_PERMISSIONS.publish,
  'deck.rollback': NODESLIDE_PERMISSIONS.rollback,
  'assets.manage': NODESLIDE_PERMISSIONS.manageAssets,
};

/** Default-deny permission adapter suitable for test stores and server adapters. */
export const explicitPermissionAuthorization: NodeSlideAuthorizationAdapter = {
  async authorize({ principal, action }) {
    const permission = ACTION_PERMISSION[action];
    if (!principal.permissions.includes(permission)) {
      throw new NodeSlideRepositoryError(
        'forbidden',
        `Principal ${principal.userId} lacks required permission ${permission}.`,
      );
    }
  },
};

export type NodeSlideApprovalMode = 'auto_commit' | 'proposal_required';

export interface NodeSlideApprovalPolicy {
  /** Unspecified modes fail closed to proposal_required. */
  byOperationMode: Partial<Record<OperationMode, NodeSlideApprovalMode>>;
  /** Hosts may require approval for specific operations regardless of mode. */
  alwaysRequireProposalFor?: readonly PatchOperation['op'][];
}

export function nodeSlideApprovalModeForPatch(
  policy: NodeSlideApprovalPolicy,
  patch: Pick<NodeSlidePatchCommand, 'operations' | 'scope'>,
): NodeSlideApprovalMode {
  const forced = new Set(policy.alwaysRequireProposalFor ?? []);
  if (patch.operations.some((operation) => forced.has(operation.op))) return 'proposal_required';
  return policy.byOperationMode[patch.scope.operationMode] ?? 'proposal_required';
}

export type NodeSlideMutationInvariant =
  | 'mutation_authority'
  | 'version_cas'
  | 'candidate_validation'
  | 'trace_lineage'
  | 'source_authorization'
  | 'rollback';

export type NodeSlideInvariantEnforcement = 'server' | 'in_process_test';

export interface NodeSlideRepositoryDescriptor {
  adapter: 'memory' | 'convex' | 'http' | 'custom';
  name: string;
  invariants: Readonly<Record<NodeSlideMutationInvariant, NodeSlideInvariantEnforcement>>;
}

export const NODESLIDE_REQUIRED_MUTATION_INVARIANTS: readonly NodeSlideMutationInvariant[] = [
  'mutation_authority',
  'version_cas',
  'candidate_validation',
  'trace_lineage',
  'source_authorization',
  'rollback',
];

export const NODESLIDE_GOVERNANCE_CONTRACT_VERSION = 'nodeslide.governance/v1' as const;

/** A server adapter must make this explicit and pass conformance before release. */
export interface NodeSlideServerGovernanceDeclaration {
  version: typeof NODESLIDE_GOVERNANCE_CONTRACT_VERSION;
  enforced: Readonly<Record<NodeSlideMutationInvariant, true>>;
}

export function createProductionRepositoryDescriptor(
  adapter: 'convex' | 'http' | 'custom',
  name: string,
  declaration: NodeSlideServerGovernanceDeclaration,
): NodeSlideRepositoryDescriptor {
  if (declaration.version !== NODESLIDE_GOVERNANCE_CONTRACT_VERSION) {
    throw new NodeSlideRepositoryError(
      'invalid_state',
      `Unsupported governance declaration ${String(declaration.version)}.`,
    );
  }
  const invariants = Object.fromEntries(
    NODESLIDE_REQUIRED_MUTATION_INVARIANTS.map((invariant) => {
      if (declaration.enforced[invariant] !== true) {
        throw new NodeSlideRepositoryError(
          'invalid_state',
          `${name} did not declare server enforcement for ${invariant}.`,
        );
      }
      return [invariant, 'server'];
    }),
  ) as Record<NodeSlideMutationInvariant, NodeSlideInvariantEnforcement>;
  return { adapter, name, invariants };
}

/** Prevents a test-only or partially governed adapter from being labeled production-ready. */
export function assertProductionNodeSlideRepository(
  repository: Pick<NodeSlideRepository, 'descriptor'>,
): void {
  const missing = NODESLIDE_REQUIRED_MUTATION_INVARIANTS.filter(
    (invariant) => repository.descriptor.invariants[invariant] !== 'server',
  );
  if (missing.length > 0) {
    throw new NodeSlideRepositoryError(
      'invalid_state',
      `${repository.descriptor.name} is not production-governed: ${missing.join(', ')}.`,
    );
  }
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

export const NODESLIDE_AUTHORIZATION_RECEIPT_VERSION = 'nodeslide.authorization/v1' as const;

export type NodeSlideRepositoryAuthorizationAction =
  | 'deck.read'
  | 'patch.apply'
  | 'proposal.create'
  | 'proposal.accept'
  | 'proposal.reject'
  | 'versions.list'
  | 'receipt.store';

export type NodeSlideAuthorizationResource =
  | { kind: 'deck'; id: string }
  | { kind: 'patch'; id: string }
  | { kind: 'proposal'; id: string }
  | { kind: 'receipt'; id: string };

export type NodeSlideRepositoryAuthorizationRequest =
  | (NodeSlideAuthorizedDeckRequest & { action: 'deck.read' })
  | (NodeSlideAuthorizedDeckRequest & {
      action: 'patch.apply' | 'proposal.create';
      patch: Readonly<NodeSlidePatchCommand>;
    })
  | (NodeSlideAuthorizedDeckRequest & {
      action: 'proposal.accept' | 'proposal.reject';
      proposalId: string;
    })
  | (NodeSlideAuthorizedDeckRequest & {
      action: 'versions.list';
      limit?: number;
    })
  | (NodeSlideAuthorizedDeckRequest & {
      action: 'receipt.store';
      receipt: Readonly<NodeSlideReceiptDraft>;
    });

/**
 * Opaque proof metadata issued by the host's server-side authorization policy.
 * Credentials, JWTs, ActorProofs, and other bearer material must never be put
 * in this envelope; `evidenceId` is an audit-row reference only.
 */
export interface NodeSlideAuthorizationEvidence {
  issuer: string;
  policyId: string;
  policyVersion: string;
  evidenceId?: string;
}

export type NodeSlideAuthorize = (
  request: Readonly<NodeSlideRepositoryAuthorizationRequest>,
) => NodeSlideAuthorizationEvidence | Promise<NodeSlideAuthorizationEvidence>;

export interface NodeSlideAuthorizationReceipt {
  schemaVersion: typeof NODESLIDE_AUTHORIZATION_RECEIPT_VERSION;
  id: string;
  principalId: string;
  organizationId?: string;
  deckId: string;
  action: NodeSlideRepositoryAuthorizationAction;
  resource: NodeSlideAuthorizationResource;
  authorizedAt: number;
  evidence: NodeSlideAuthorizationEvidence;
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

export interface NodeSlideReceiptBody {
  id: string;
  deckId: string;
  deckVersion: number;
  patchId?: string;
  traceId?: string;
  recordedAt: number;
  attributes: Record<string, NodeSlideJsonValue>;
}

export type NodeSlideCustomReceiptId = `custom-receipt:${string}`;

/** Caller-supplied custom receipt. Canonical mutation operations are repository-only. */
export interface NodeSlideReceiptDraft extends NodeSlideReceiptBody {
  id: NodeSlideCustomReceiptId;
  operation: 'custom';
}

/** Portable receipt envelope bound to host authorization evidence. */
export interface NodeSlideReceipt extends NodeSlideReceiptBody {
  operation: NodeSlideReceiptOperation;
  principalId: string;
  authorization: NodeSlideAuthorizationReceipt;
}

export interface NodeSlideStoreReceiptInput extends NodeSlideAuthorizedDeckRequest {
  receipt: NodeSlideReceiptDraft;
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
  readonly descriptor: NodeSlideRepositoryDescriptor;
  getDeck(input: NodeSlideGetDeckInput): Promise<DeckSnapshot | null>;
  applyPatch(input: NodeSlideApplyPatchInput): Promise<NodeSlideApplyPatchResult>;
  createProposal(input: NodeSlideCreateProposalInput): Promise<DeckPatch>;
  resolveProposal(input: NodeSlideResolveProposalInput): Promise<NodeSlideProposalResolution>;
  listVersions(input: NodeSlideListVersionsInput): Promise<DeckVersion[]>;
  storeReceipt(input: NodeSlideStoreReceiptInput): Promise<NodeSlideReceipt>;
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

const PRINCIPAL_KEYS = new Set(['userId', 'organizationId', 'roles', 'permissions']);
const AUTHORIZATION_EVIDENCE_KEYS = new Set(['issuer', 'policyId', 'policyVersion', 'evidenceId']);
const MAX_PRINCIPAL_LIST_ITEMS = 64;
const MAX_IDENTIFIER_LENGTH = 256;
const MAX_POLICY_VERSION_LENGTH = 64;

function containsControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function plainRecord(
  value: unknown,
  label: string,
  allowedKeys: ReadonlySet<string>,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const captured: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) {
      throw new TypeError(`${label} contains an unknown field.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError(`${label}.${key} must be a data property.`);
    }
    captured[key] = descriptor.value;
  }
  return captured;
}

function boundedString(value: unknown, label: string, maxLength = MAX_IDENTIFIER_LENGTH): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maxLength ||
    value !== value.trim() ||
    containsControlCharacter(value)
  ) {
    throw new TypeError(`${label} must be a bounded canonical string.`);
  }
  return value;
}

function boundedStringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new TypeError(`${label} must be a plain array.`);
  }
  const captured = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') {
      throw new TypeError(`${label} must be a dense array without extra properties.`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError(`${label}.${key} must be a data property.`);
    }
    captured.set(key, descriptor.value);
  }
  const length = captured.get('length');
  if (typeof length !== 'number' || !Number.isSafeInteger(length) || length < 0) {
    throw new TypeError(`${label}.length must be a non-negative integer.`);
  }
  if (length > MAX_PRINCIPAL_LIST_ITEMS) {
    throw new TypeError(`${label} exceeds the item limit.`);
  }
  if (captured.size !== length + 1) {
    throw new TypeError(`${label} must be a dense array without extra properties.`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < length; index += 1) {
    if (!captured.has(String(index))) {
      throw new TypeError(`${label} must be a dense array.`);
    }
    const item = boundedString(captured.get(String(index)), `${label}[${index}]`);
    if (seen.has(item)) throw new TypeError(`${label} must not contain duplicates.`);
    seen.add(item);
    result.push(item);
  }
  return Object.freeze(result);
}

/**
 * Runtime validation for the vendor-neutral principal shape. Authentication
 * still belongs to the host; this parser only prevents ambiguous or hostile
 * values from crossing the repository boundary.
 */
export function parseNodeSlidePrincipal(value: unknown): NodeSlidePrincipal {
  const record = plainRecord(value, 'NodeSlide principal', PRINCIPAL_KEYS);
  if (!Object.hasOwn(record, 'userId')) {
    throw new TypeError('NodeSlide principal.userId is required.');
  }
  if (!Object.hasOwn(record, 'roles') || !Object.hasOwn(record, 'permissions')) {
    throw new TypeError('NodeSlide principal roles and permissions are required.');
  }
  const organizationId = Object.hasOwn(record, 'organizationId')
    ? boundedString(record['organizationId'], 'NodeSlide principal.organizationId')
    : undefined;
  return Object.freeze({
    userId: boundedString(record['userId'], 'NodeSlide principal.userId'),
    ...(organizationId === undefined ? {} : { organizationId }),
    roles: boundedStringList(record['roles'], 'NodeSlide principal.roles'),
    permissions: boundedStringList(record['permissions'], 'NodeSlide principal.permissions'),
  });
}

export function parseNodeSlideAuthorizationEvidence(
  value: unknown,
): NodeSlideAuthorizationEvidence {
  const record = plainRecord(
    value,
    'NodeSlide authorization evidence',
    AUTHORIZATION_EVIDENCE_KEYS,
  );
  for (const key of ['issuer', 'policyId', 'policyVersion'] as const) {
    if (!Object.hasOwn(record, key)) {
      throw new TypeError(`NodeSlide authorization evidence.${key} is required.`);
    }
  }
  const evidenceId = Object.hasOwn(record, 'evidenceId')
    ? boundedString(record['evidenceId'], 'NodeSlide authorization evidence.evidenceId')
    : undefined;
  return Object.freeze({
    issuer: boundedString(record['issuer'], 'NodeSlide authorization evidence.issuer'),
    policyId: boundedString(record['policyId'], 'NodeSlide authorization evidence.policyId'),
    policyVersion: boundedString(
      record['policyVersion'],
      'NodeSlide authorization evidence.policyVersion',
      MAX_POLICY_VERSION_LENGTH,
    ),
    ...(evidenceId === undefined ? {} : { evidenceId }),
  });
}

const AUTHORIZATION_REQUEST_KEYS = new Set([
  'action',
  'deckId',
  'principal',
  'patch',
  'proposalId',
  'limit',
  'receipt',
]);

interface CapturedAuthorizationRequest {
  action: NodeSlideRepositoryAuthorizationAction;
  deckId: string;
  principal: unknown;
  resource: NodeSlideAuthorizationResource;
}

function assertAuthorizationRequestKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new TypeError('NodeSlide authorization request contains an invalid field.');
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) {
      throw new TypeError(`NodeSlide authorization request.${key} is required.`);
    }
  }
}

function capturedDataProperties(
  value: unknown,
  label: string,
  keys: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object.`);
  }
  const captured: Record<string, unknown> = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !('value' in descriptor)) {
      throw new TypeError(`${label}.${key} must be a data property.`);
    }
    captured[key] = descriptor.value;
  }
  return captured;
}

function capturedPatchResource(
  value: unknown,
  label: string,
  deckId: string,
  kind: 'patch' | 'proposal',
): NodeSlideAuthorizationResource {
  const patch = capturedDataProperties(value, label, ['id', 'deckId', 'scope']);
  const patchDeckId = boundedString(patch['deckId'], `${label}.deckId`);
  const scope = capturedDataProperties(patch['scope'], `${label}.scope`, ['deckId']);
  const scopeDeckId = boundedString(scope['deckId'], `${label}.scope.deckId`);
  if (patchDeckId !== deckId || scopeDeckId !== deckId) {
    throw new TypeError(`${label} deck scope must match the authorization request.deckId.`);
  }
  return {
    kind,
    id: boundedString(patch['id'], `${label}.id`),
  };
}

function capturedReceiptResource(
  value: unknown,
  label: string,
  deckId: string,
): NodeSlideAuthorizationResource {
  const receipt = capturedDataProperties(value, label, ['id', 'deckId']);
  if (boundedString(receipt['deckId'], `${label}.deckId`) !== deckId) {
    throw new TypeError(`${label}.deckId must match the authorization request.deckId.`);
  }
  return {
    kind: 'receipt',
    id: boundedString(receipt['id'], `${label}.id`),
  };
}

function captureAuthorizationRequest(request: unknown): CapturedAuthorizationRequest {
  const record = plainRecord(
    request,
    'NodeSlide authorization request',
    AUTHORIZATION_REQUEST_KEYS,
  );
  const action = record['action'];
  const baseKeys = ['action', 'deckId', 'principal'] as const;
  const deckId = boundedString(record['deckId'], 'NodeSlide authorization request.deckId');
  let resource: NodeSlideAuthorizationResource;
  switch (action) {
    case 'patch.apply':
      assertAuthorizationRequestKeys(record, [...baseKeys, 'patch']);
      return {
        action,
        deckId,
        principal: record['principal'],
        resource: capturedPatchResource(
          record['patch'],
          'NodeSlide authorization request.patch',
          deckId,
          'patch',
        ),
      };
    case 'proposal.create':
      assertAuthorizationRequestKeys(record, [...baseKeys, 'patch']);
      resource = capturedPatchResource(
        record['patch'],
        'NodeSlide authorization request.patch',
        deckId,
        'proposal',
      );
      break;
    case 'proposal.accept':
    case 'proposal.reject':
      assertAuthorizationRequestKeys(record, [...baseKeys, 'proposalId']);
      resource = {
        kind: 'proposal',
        id: boundedString(record['proposalId'], 'NodeSlide authorization request.proposalId'),
      };
      break;
    case 'receipt.store':
      assertAuthorizationRequestKeys(record, [...baseKeys, 'receipt']);
      resource = capturedReceiptResource(
        record['receipt'],
        'NodeSlide authorization request.receipt',
        deckId,
      );
      break;
    case 'deck.read':
      assertAuthorizationRequestKeys(record, baseKeys);
      resource = {
        kind: 'deck',
        id: boundedString(record['deckId'], 'NodeSlide authorization request.deckId'),
      };
      break;
    case 'versions.list':
      assertAuthorizationRequestKeys(record, baseKeys, ['limit']);
      if (
        Object.hasOwn(record, 'limit') &&
        (typeof record['limit'] !== 'number' || !Number.isFinite(record['limit']))
      ) {
        throw new TypeError('NodeSlide authorization request.limit must be finite.');
      }
      resource = {
        kind: 'deck',
        id: boundedString(record['deckId'], 'NodeSlide authorization request.deckId'),
      };
      break;
    default:
      throw new TypeError('NodeSlide authorization request.action is invalid.');
  }
  return {
    action,
    deckId,
    principal: record['principal'],
    resource,
  };
}

export function createNodeSlideAuthorizationReceipt(
  request: NodeSlideRepositoryAuthorizationRequest,
  evidence: unknown,
  issued: { id: string; authorizedAt: number },
): NodeSlideAuthorizationReceipt {
  const capturedRequest = captureAuthorizationRequest(request);
  const issuedRecord = plainRecord(
    issued,
    'NodeSlide authorization receipt issuance',
    new Set(['id', 'authorizedAt']),
  );
  if (!Object.hasOwn(issuedRecord, 'id') || !Object.hasOwn(issuedRecord, 'authorizedAt')) {
    throw new TypeError('NodeSlide authorization receipt issuance fields are required.');
  }
  const principal = parseNodeSlidePrincipal(capturedRequest.principal);
  const id = boundedString(issuedRecord['id'], 'NodeSlide authorization receipt.id');
  const authorizedAt = issuedRecord['authorizedAt'];
  if (typeof authorizedAt !== 'number' || !Number.isSafeInteger(authorizedAt) || authorizedAt < 0) {
    throw new TypeError(
      'NodeSlide authorization receipt.authorizedAt must be a timestamp integer.',
    );
  }
  const resource = Object.freeze(capturedRequest.resource);
  return Object.freeze({
    schemaVersion: NODESLIDE_AUTHORIZATION_RECEIPT_VERSION,
    id,
    principalId: principal.userId,
    ...(principal.organizationId === undefined ? {} : { organizationId: principal.organizationId }),
    deckId: capturedRequest.deckId,
    action: capturedRequest.action,
    resource,
    authorizedAt,
    evidence: parseNodeSlideAuthorizationEvidence(evidence),
  });
}
