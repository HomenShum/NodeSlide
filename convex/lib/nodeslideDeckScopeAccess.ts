/**
 * Deck-scoped delegated authority.
 *
 * This is the flat-model rewrite of parity-studio's `convex/lib/nodeslideScopeAccess.ts`
 * (DECOUPLING_PLAN §8 D1). Parity scoped authority to a workspace -> project ->
 * deck hierarchy. NodeSlide has no workspaces and no projects: a deck is the
 * root of its own authority, held by `nodeslide_decks.ownerAccessKey`. So the
 * policy is keyed by `deckId`, and the sub-deck narrowing that parity spent a
 * `projectScope` on is expressed with the mechanism this repo already has —
 * `agentPolicy.scopes.memoryScopeKeys`, which `nodeSlideMemoryScopeKey` already
 * canonicalizes for `deck`, `session`, and `run` scopes.
 *
 * Audit note — the port manifest records ten of these WORKSPACE -> DECK renames
 * but not the last six, so a symbol audit reports them MISSING. They are the
 * same D1 rewrite, one-for-one:
 *
 *   NODESLIDE_WORKSPACE_ACCESS_POLICY_VERSION  -> NODESLIDE_DECK_ACCESS_POLICY_VERSION
 *   NODESLIDE_WORKSPACE_ROLES                  -> NODESLIDE_DECK_ROLES
 *   NODESLIDE_WORKSPACE_CAPABILITIES           -> NODESLIDE_DECK_CAPABILITIES
 *   NODESLIDE_WORKSPACE_ROLE_CAPABILITY_MATRIX -> NODESLIDE_DECK_ROLE_CAPABILITY_MATRIX
 *   NodeSlideWorkspaceAccessPolicyError        -> NodeSlideDeckAccessPolicyError
 *
 * The sixth, `NodeSlideWorkspaceProjectScope`, has no counterpart on purpose:
 * it is parity's sub-deck narrowing inside a project, and this repo expresses
 * that with `agentPolicy.scopes.memoryScopeKeys` as described above. Adding it
 * back would reintroduce the project tier the flat rewrite removed.
 *
 * What this module is for: the deck owner holds a bearer key that can do
 * everything. Handing that key to an agent is the whole risk. A grant carries a
 * policy that can only ever *narrow* — never elevate a role, never cross to
 * another deck, never widen the nested agent authority. This module is the
 * algebra; `convex/nodeslideDeckGrants.ts` is the storage and the gate.
 */

import {
  type NodeSlideAccessPolicy,
  narrowNodeSlideAccessPolicy,
  normalizeNodeSlideAccessPolicy,
} from '../../shared/nodeslideAccessPolicy';
import { nodeslideContentDigest } from './nodeslideIds';

/**
 * The one definition of how a grant bearer token maps to its stored digest.
 * It lives here rather than in `nodeslideDeckGrants.ts` because two callers
 * need it (`nodeslideDeckGrants` mints and verifies, `nodeslideScopedMemory`
 * verifies) and two copies of a digest recipe that must agree byte-for-byte is
 * a fail-silent bug: the second copy drifting turns every grant-authorized
 * memory read into a denial that looks like an authorization decision.
 */
export function nodeSlideDeckGrantTokenDigest(token: string): string {
  return nodeslideContentDigest(`nodeslide-deck-grant${token}`);
}

export const NODESLIDE_DECK_ACCESS_POLICY_VERSION = 'nodeslide.deck-access-policy/v1' as const;

export const NODESLIDE_DECK_ROLES = ['owner', 'editor', 'viewer'] as const;
export type NodeSlideDeckRole = (typeof NODESLIDE_DECK_ROLES)[number];

/**
 * Structural authority over the deck and its grants. Agent authority (models,
 * tools, memory, web, budget) lives in the nested `agentPolicy` and is
 * deliberately not mirrored here: two lists of the same capability drift.
 */
export const NODESLIDE_DECK_CAPABILITIES = [
  'deck:read',
  'job:create',
  'grant:issue',
  'grant:revoke',
] as const;
export type NodeSlideDeckCapability = (typeof NODESLIDE_DECK_CAPABILITIES)[number];

export const NODESLIDE_DECK_ROLE_CAPABILITY_MATRIX = {
  owner: ['deck:read', 'job:create', 'grant:issue', 'grant:revoke'],
  editor: ['deck:read', 'job:create'],
  viewer: ['deck:read'],
} as const satisfies Record<NodeSlideDeckRole, readonly NodeSlideDeckCapability[]>;

export interface NodeSlideDeckAccessPolicy {
  readonly schemaVersion: typeof NODESLIDE_DECK_ACCESS_POLICY_VERSION;
  readonly deckId: string;
  readonly role: NodeSlideDeckRole;
  readonly capabilities: readonly NodeSlideDeckCapability[];
  /** Provider/tool/memory authority is independent and can only narrow on delegation. */
  readonly agentPolicy: NodeSlideAccessPolicy;
}

export interface NodeSlideDeckAccessRequest {
  readonly deckId: string;
  readonly capability: NodeSlideDeckCapability;
}

export type NodeSlideDeckAccessDecision =
  | { readonly allowed: true; readonly reason: 'allowed' }
  | {
      readonly allowed: false;
      readonly reason: 'invalid_policy' | 'deck_mismatch' | 'capability_denied';
    };

export class NodeSlideDeckAccessPolicyError extends Error {
  readonly code = 'invalid_nodeslide_deck_access_policy' as const;

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`Invalid NodeSlide deck access policy ${field}: ${message}`);
    this.name = 'NodeSlideDeckAccessPolicyError';
  }
}

const POLICY_KEYS = new Set(['schemaVersion', 'deckId', 'role', 'capabilities', 'agentPolicy']);
const ROLE_SET = new Set<string>(NODESLIDE_DECK_ROLES);
const CAPABILITY_SET = new Set<string>(NODESLIDE_DECK_CAPABILITIES);

export function normalizeNodeSlideDeckAccessPolicy(input: unknown): NodeSlideDeckAccessPolicy {
  const policy = record('root', input);
  rejectUnknown('root', policy, POLICY_KEYS);
  if (
    policy['schemaVersion'] !== undefined &&
    policy['schemaVersion'] !== NODESLIDE_DECK_ACCESS_POLICY_VERSION
  ) {
    throw invalid('schemaVersion', 'unsupported contract version');
  }
  const deckId = descriptor('deckId', policy['deckId']);
  const role = deckRole(policy['role']);
  const capabilities = normalizeCapabilities(policy['capabilities'], role);
  const agentPolicy = normalizeNodeSlideAccessPolicy(policy['agentPolicy']);
  return {
    schemaVersion: NODESLIDE_DECK_ACCESS_POLICY_VERSION,
    deckId,
    role,
    capabilities,
    agentPolicy,
  };
}

export function isNodeSlideDeckAccessPolicy(input: unknown): input is NodeSlideDeckAccessPolicy {
  try {
    return structurallyEqual(input, normalizeNodeSlideDeckAccessPolicy(input));
  } catch {
    return false;
  }
}

/** Intersects role, capability, and nested agent authority. Never widens. */
export function narrowNodeSlideDeckAccessPolicy(
  parentInput: unknown,
  requestedInput: unknown,
): NodeSlideDeckAccessPolicy {
  const parent = normalizeNodeSlideDeckAccessPolicy(parentInput);
  const requested = normalizeNodeSlideDeckAccessPolicy(requestedInput);
  if (parent.deckId !== requested.deckId) {
    throw invalid('deckId', 'cannot delegate across decks');
  }
  if (roleRank(requested.role) > roleRank(parent.role)) {
    throw invalid('role', 'cannot elevate a delegated role');
  }
  return {
    schemaVersion: NODESLIDE_DECK_ACCESS_POLICY_VERSION,
    deckId: parent.deckId,
    role: requested.role,
    capabilities: intersection(parent.capabilities, requested.capabilities),
    agentPolicy: narrowNodeSlideAccessPolicy(parent.agentPolicy, requested.agentPolicy),
  };
}

/** Evaluates only complete canonical policies and otherwise denies without throwing. */
export function evaluateNodeSlideDeckAccess(
  policyInput: unknown,
  request: NodeSlideDeckAccessRequest,
): NodeSlideDeckAccessDecision {
  if (!isNodeSlideDeckAccessPolicy(policyInput)) {
    return { allowed: false, reason: 'invalid_policy' };
  }
  const policy = policyInput;
  if (request.deckId !== policy.deckId) {
    return { allowed: false, reason: 'deck_mismatch' };
  }
  if (
    !CAPABILITY_SET.has(request.capability) ||
    !policy.capabilities.includes(request.capability)
  ) {
    return { allowed: false, reason: 'capability_denied' };
  }
  return { allowed: true, reason: 'allowed' };
}

export function nodeSlideDeckCapabilitiesForRole(input: unknown): NodeSlideDeckCapability[] {
  const role = deckRole(input);
  return [...NODESLIDE_DECK_ROLE_CAPABILITY_MATRIX[role]].sort();
}

function normalizeCapabilities(input: unknown, role: NodeSlideDeckRole): NodeSlideDeckCapability[] {
  const values = strictArray('capabilities', input);
  const roleCapabilities = new Set<string>(NODESLIDE_DECK_ROLE_CAPABILITY_MATRIX[role]);
  const result = new Set<NodeSlideDeckCapability>();
  for (const value of values) {
    if (typeof value !== 'string' || !CAPABILITY_SET.has(value)) {
      throw invalid('capabilities', `unknown capability ${JSON.stringify(value)}`);
    }
    if (!roleCapabilities.has(value)) {
      throw invalid('capabilities', `${value} is outside the ${role} role ceiling`);
    }
    result.add(value as NodeSlideDeckCapability);
  }
  return [...result].sort();
}

function roleRank(role: NodeSlideDeckRole): number {
  if (role === 'owner') return 3;
  if (role === 'editor') return 2;
  return 1;
}

function deckRole(value: unknown): NodeSlideDeckRole {
  if (typeof value !== 'string' || !ROLE_SET.has(value)) {
    throw invalid('role', 'unknown or missing role');
  }
  return value as NodeSlideDeckRole;
}

function descriptor(field: string, value: unknown): string {
  if (typeof value !== 'string') throw invalid(field, 'expected a string');
  const clean = value.replace(/\s+/gu, ' ').trim();
  if (!clean || clean.length > 256) throw invalid(field, 'expected 1 through 256 characters');
  return clean;
}

function strictArray(field: string, input: unknown): readonly unknown[] {
  if (!Array.isArray(input) || Object.getOwnPropertySymbols(input).length > 0) {
    throw invalid(field, 'expected an array');
  }
  if (Object.getOwnPropertyNames(input).length !== input.length + 1) {
    throw invalid(field, 'expected a dense array without custom fields');
  }
  for (let index = 0; index < input.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(input, index)) {
      throw invalid(field, 'expected a dense array without custom fields');
    }
  }
  return input;
}

function record(field: string, input: unknown): Record<string, unknown> {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.getOwnPropertySymbols(input).length > 0
  ) {
    throw invalid(field, 'expected a plain object');
  }
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalid(field, 'expected a plain object');
  }
  return input as Record<string, unknown>;
}

function rejectUnknown(
  field: string,
  input: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.getOwnPropertyNames(input)) {
    if (!allowed.has(key)) throw invalid(`${field}.${key}`, 'unknown field');
  }
}

function intersection<T extends string>(left: readonly T[], right: readonly T[]): T[] {
  const allowed = new Set(left);
  return right.filter((value) => allowed.has(value));
}

function invalid(field: string, message: string): NodeSlideDeckAccessPolicyError {
  return new NodeSlideDeckAccessPolicyError(field, message);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return (
      left.length === right.length &&
      left.every((value, index) => structurallyEqual(value, right[index]))
    );
  }
  if (
    typeof left === 'object' &&
    left !== null &&
    !Array.isArray(left) &&
    typeof right === 'object' &&
    right !== null &&
    !Array.isArray(right)
  ) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      structurallyEqual(leftKeys, rightKeys) &&
      leftKeys.every((key) => structurallyEqual(leftRecord[key], rightRecord[key]))
    );
  }
  return false;
}
