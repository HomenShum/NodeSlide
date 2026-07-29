/**
 * Deck-scoped delegated grants.
 *
 * Flat-model rewrite of parity-studio's `convex/nodeslideWorkspaceAccess.ts`
 * (DECOUPLING_PLAN §8 D1). Parity rooted authority in a workspace row and
 * bootstrapped it with `createWorkspace`, which minted the first owner token.
 * NodeSlide has no workspace to bootstrap: the root of trust already exists as
 * `nodeslide_decks.ownerAccessKey`, so `issueGrant` is authorized by the owner
 * key directly and `createWorkspace` has nothing left to do.
 *
 * What survives is the part that was never about workspaces: a deck owner can
 * hand an agent an expiring, narrowed bearer token instead of the owner key
 * itself, and can revoke it. `authorizeEditJobInternal` is the exchange point —
 * it converts a grant token into the owner key inside a trusted internal query,
 * so the owner capability never crosses the wire to the delegate.
 */

import { v } from 'convex/values';
import { nodeSlideAgentModel } from '../shared/nodeslide';
import type { NodeSlideAccessPolicy } from '../shared/nodeslideAccessPolicy';
import type { Doc } from './_generated/dataModel';
import type { MutationCtx, QueryCtx } from './_generated/server';
import { internalQuery, mutation, query } from './_generated/server';
import { requireOwnerAccess } from './lib/nodeslideAccess';
import { findDeckRow } from './lib/nodeslideData';
import {
  type NodeSlideDeckAccessPolicy,
  type NodeSlideDeckCapability,
  type NodeSlideDeckRole,
  evaluateNodeSlideDeckAccess,
  isNodeSlideDeckAccessPolicy,
  narrowNodeSlideDeckAccessPolicy,
  nodeSlideDeckCapabilitiesForRole,
  nodeSlideDeckGrantTokenDigest,
  normalizeNodeSlideDeckAccessPolicy,
} from './lib/nodeslideDeckScopeAccess';
import { nodeslideEventId } from './lib/nodeslideIds';
import { nodeslideEditProposalJobRequestFields } from './lib/nodeslideJobValidators';

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAX_GRANT_LIFETIME_MS = 365 * 24 * 60 * 60 * 1_000;
const LIST_LIMIT = 128;
const ACCESS_DENIED = 'NodeSlide deck grant access denied.';

type ReadCtx = Pick<QueryCtx, 'db'> | Pick<MutationCtx, 'db'>;

export interface NodeSlideDeckGrantSummary {
  readonly id: string;
  readonly deckId: string;
  readonly role: NodeSlideDeckRole;
  readonly policy: NodeSlideDeckAccessPolicy;
  readonly parentGrantId?: string;
  readonly status: 'active' | 'expired' | 'revoked';
  readonly expiresAt: number;
  readonly createdAt: number;
  readonly revokedAt?: number;
}

export interface NodeSlideGrantedDeckSummary {
  readonly id: string;
  readonly title: string;
  readonly status: 'draft' | 'validating' | 'ready' | 'published';
  readonly version: number;
}

const deckRoleValidator = v.union(v.literal('owner'), v.literal('editor'), v.literal('viewer'));

/**
 * Root issuance. The deck owner key is the ceiling, so the requested policy is
 * narrowed against a synthesised full-owner policy carrying the same agent
 * authority — the owner cannot grant agent authority they did not name, and a
 * role/capability above the requested role's ceiling is rejected by
 * normalization before it reaches storage.
 */
export const issueGrant = mutation({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.string(),
    role: deckRoleValidator,
    capabilities: v.array(v.string()),
    agentPolicy: v.any(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const deck = await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    assertExpiry(args.expiresAt, now);
    const ceiling = normalizeNodeSlideDeckAccessPolicy({
      deckId: deck.id,
      role: 'owner',
      capabilities: nodeSlideDeckCapabilitiesForRole('owner'),
      agentPolicy: args.agentPolicy,
    });
    const requested = normalizeNodeSlideDeckAccessPolicy({
      deckId: deck.id,
      role: args.role,
      capabilities: args.capabilities,
      agentPolicy: args.agentPolicy,
    });
    const policy = narrowNodeSlideDeckAccessPolicy(ceiling, requested);
    return await insertGrant(ctx, { deckId: deck.id, policy, expiresAt: args.expiresAt, now });
  },
});

/**
 * Chained issuance from an existing grant that holds `grant:issue`. The parent
 * grant is the ceiling: role cannot rise, capabilities and agent authority can
 * only intersect, and the child cannot outlive the parent.
 */
export const delegateGrant = mutation({
  args: {
    deckId: v.string(),
    token: v.string(),
    role: v.union(v.literal('editor'), v.literal('viewer')),
    capabilities: v.array(v.string()),
    agentPolicy: v.any(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const issuer = await requireGrant(ctx, args.deckId, args.token, now, 'grant:issue');
    assertExpiry(args.expiresAt, now);
    if (args.expiresAt > issuer.row.expiresAt) throw new Error(ACCESS_DENIED);
    const requested = normalizeNodeSlideDeckAccessPolicy({
      deckId: args.deckId,
      role: args.role,
      capabilities: args.capabilities,
      agentPolicy: args.agentPolicy,
    });
    const policy = narrowNodeSlideDeckAccessPolicy(issuer.policy, requested);
    return await insertGrant(ctx, {
      deckId: args.deckId,
      policy,
      expiresAt: args.expiresAt,
      now,
      parentGrantId: issuer.row.id,
      actorGrantId: issuer.row.id,
    });
  },
});

/**
 * Revocation is authorized by the deck owner key OR by a grant holding
 * `grant:revoke`. A grant can never revoke itself out of an audit trail: the
 * event row records who did it.
 */
export const revokeGrant = mutation({
  args: {
    deckId: v.string(),
    grantId: v.string(),
    ownerAccessKey: v.optional(v.string()),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<NodeSlideDeckGrantSummary> => {
    const now = Date.now();
    const actor = await requireOwnerOrGrant(ctx, args, now, 'grant:revoke');
    const target = await findGrantById(ctx, args.grantId);
    if (!target || target.deckId !== args.deckId) throw new Error(ACCESS_DENIED);
    assertStoredGrant(target);
    if (target.revokedAt !== undefined) return grantSummary(target, now);
    await ctx.db.patch(target._id, { revokedAt: now });
    await insertGrantEvent(ctx, {
      deckId: args.deckId,
      grantId: target.id,
      ...(actor ? { actorGrantId: actor } : {}),
      kind: 'revoked',
      occurredAt: now,
    });
    return grantSummary({ ...target, revokedAt: now }, now);
  },
});

/**
 * Every grant on one deck. This is the deck-keyed rewrite of parity's
 * "list every grant in the workspace"; the workspace version has no meaning
 * here, but a deck owner still has to be able to see what they handed out
 * before they can revoke it.
 */
export const listGrants = query({
  args: {
    deckId: v.string(),
    ownerAccessKey: v.optional(v.string()),
    token: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<NodeSlideDeckGrantSummary[]> => {
    const now = Date.now();
    await requireOwnerOrGrant(ctx, args, now, 'grant:issue');
    const rows = await ctx.db
      .query('nodeslide_deck_grants')
      .withIndex('by_deck_created', (index) => index.eq('deckId', args.deckId))
      .order('desc')
      .take(LIST_LIMIT);
    return rows.map((row) => {
      assertStoredGrant(row);
      return grantSummary(row, now);
    });
  },
});

/** Reads the deck through a grant token, never exposing the owner key. */
export const getGrantedDeck = query({
  args: { deckId: v.string(), token: v.string() },
  handler: async (ctx, args): Promise<NodeSlideGrantedDeckSummary> => {
    await requireGrant(ctx, args.deckId, args.token, Date.now(), 'deck:read');
    const deck = await findDeckRow(ctx, args.deckId);
    if (!deck) throw new Error(ACCESS_DENIED);
    return { id: deck.id, title: deck.title, status: deck.status, version: deck.version };
  },
});

/**
 * The token-for-owner-key exchange. Runs as an internal query so the owner
 * capability is only ever returned inside the trusted boundary; the delegate
 * holds a grant token and never sees `ownerAccessKey`.
 *
 * NOTE: the public `startEditProposal` action that consumed this in parity is
 * NOT ported — it calls `api.nodeslideJobs.startEditProposal`, and
 * `convex/nodeslideJobs.ts` does not exist in this repo yet. That is a missing
 * module, not a missing workspace.
 */
export const authorizeEditJobInternal = internalQuery({
  args: {
    deckId: v.string(),
    token: v.string(),
    providerMode: nodeslideEditProposalJobRequestFields.providerMode,
    providerModel: nodeslideEditProposalJobRequestFields.providerModel,
    maxCostUsd: v.optional(v.number()),
    webResearch: v.optional(v.boolean()),
    memoryMode: nodeslideEditProposalJobRequestFields.memoryMode,
  },
  handler: async (ctx, args) => {
    const grant = await requireGrant(ctx, args.deckId, args.token, Date.now(), 'job:create');
    const deck = await findDeckRow(ctx, args.deckId);
    if (!deck?.ownerAccessKey) throw new Error(ACCESS_DENIED);
    const policy = grant.policy.agentPolicy;
    if (
      !policy.capabilities.includes('proposal:create') ||
      !policy.capabilities.includes('deck:read') ||
      !policy.scopes.deckIds.includes(args.deckId)
    ) {
      throw new Error(ACCESS_DENIED);
    }
    if (args.providerMode && args.providerMode !== 'deterministic') {
      if (!args.providerModel || !policy.capabilities.includes('model:invoke')) {
        throw new Error(ACCESS_DENIED);
      }
      const route = nodeSlideAgentModel(args.providerModel);
      if (
        !policy.scopes.modelIds.includes(args.providerModel) ||
        !policy.scopes.providerIds.includes(route.provider)
      ) {
        throw new Error(ACCESS_DENIED);
      }
    }
    if (args.webResearch && !policy.capabilities.includes('web:read')) {
      throw new Error(ACCESS_DENIED);
    }
    if (args.memoryMode === 'relevant' && !policy.capabilities.includes('memory:read')) {
      throw new Error(ACCESS_DENIED);
    }
    const requestedMicroUsd = Math.ceil((args.maxCostUsd ?? 1) * 1_000_000);
    if (requestedMicroUsd > policy.budget.maxCostMicroUsd) throw new Error(ACCESS_DENIED);
    return { ownerAccessKey: deck.ownerAccessKey, grantId: grant.row.id };
  },
});

async function insertGrant(
  ctx: Pick<MutationCtx, 'db'>,
  args: {
    deckId: string;
    policy: NodeSlideDeckAccessPolicy;
    expiresAt: number;
    now: number;
    parentGrantId?: string;
    actorGrantId?: string;
  },
): Promise<{ grant: NodeSlideDeckGrantSummary; token: string }> {
  const { token, tokenDigest } = await createUniqueGrantToken(ctx);
  const grantId = nodeslideEventId('nsgrant', args.now, args.deckId, tokenDigest);
  const grant = {
    id: grantId,
    deckId: args.deckId,
    role: args.policy.role,
    tokenDigest,
    policy: structuredClone(args.policy) as Doc<'nodeslide_deck_grants'>['policy'],
    ...(args.parentGrantId ? { parentGrantId: args.parentGrantId } : {}),
    expiresAt: args.expiresAt,
    createdAt: args.now,
  };
  await ctx.db.insert('nodeslide_deck_grants', grant);
  await insertGrantEvent(ctx, {
    deckId: args.deckId,
    grantId,
    ...(args.actorGrantId ? { actorGrantId: args.actorGrantId } : {}),
    kind: 'issued',
    occurredAt: args.now,
  });
  return { grant: grantSummary(grant, args.now), token };
}

/**
 * The deck owner key and a `grant:*`-bearing token are the two ways to reach
 * grant administration. Returns the acting grant id when a token was used, so
 * the audit trail can name it, and `null` for the owner key.
 */
async function requireOwnerOrGrant(
  ctx: ReadCtx,
  args: { deckId: string; ownerAccessKey?: string; token?: string },
  now: number,
  capability: NodeSlideDeckCapability,
): Promise<string | null> {
  if (args.ownerAccessKey !== undefined) {
    await requireOwnerAccess(ctx, args.deckId, args.ownerAccessKey);
    return null;
  }
  if (args.token === undefined) throw new Error(ACCESS_DENIED);
  const grant = await requireGrant(ctx, args.deckId, args.token, now, capability);
  return grant.row.id;
}

async function requireGrant(
  ctx: ReadCtx,
  deckId: string,
  tokenInput: string,
  now: number,
  capability: NodeSlideDeckCapability,
): Promise<{ row: Doc<'nodeslide_deck_grants'>; policy: NodeSlideDeckAccessPolicy }> {
  if (!boundedId(deckId) || !TOKEN_PATTERN.test(tokenInput) || !Number.isFinite(now)) {
    throw new Error(ACCESS_DENIED);
  }
  const row = await ctx.db
    .query('nodeslide_deck_grants')
    .withIndex('by_token_digest', (index) =>
      index.eq('tokenDigest', nodeSlideDeckGrantTokenDigest(tokenInput)),
    )
    .unique();
  if (!row || row.deckId !== deckId || row.revokedAt !== undefined || now >= row.expiresAt) {
    throw new Error(ACCESS_DENIED);
  }
  const policy = assertStoredGrant(row);
  const decision = evaluateNodeSlideDeckAccess(policy, { deckId, capability });
  if (!decision.allowed) throw new Error(ACCESS_DENIED);
  return { row, policy };
}

/** A stored policy that disagrees with its own row is not trusted, it is denied. */
function assertStoredGrant(row: Doc<'nodeslide_deck_grants'>): NodeSlideDeckAccessPolicy {
  if (!isNodeSlideDeckAccessPolicy(row.policy)) throw new Error(ACCESS_DENIED);
  if (row.policy.deckId !== row.deckId || row.policy.role !== row.role) {
    throw new Error(ACCESS_DENIED);
  }
  return row.policy;
}

async function findGrantById(
  ctx: ReadCtx,
  grantId: string,
): Promise<Doc<'nodeslide_deck_grants'> | null> {
  if (!boundedId(grantId)) return null;
  return await ctx.db
    .query('nodeslide_deck_grants')
    .withIndex('by_stable_id', (index) => index.eq('id', grantId))
    .unique();
}

async function createUniqueGrantToken(
  ctx: ReadCtx,
): Promise<{ token: string; tokenDigest: string }> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const token = randomToken();
    const tokenDigest = nodeSlideDeckGrantTokenDigest(token);
    const existing = await ctx.db
      .query('nodeslide_deck_grants')
      .withIndex('by_token_digest', (index) => index.eq('tokenDigest', tokenDigest))
      .unique();
    if (!existing) return { token, tokenDigest };
  }
  throw new Error('Unable to create NodeSlide deck grant.');
}

async function insertGrantEvent(
  ctx: Pick<MutationCtx, 'db'>,
  event: {
    deckId: string;
    grantId: string;
    actorGrantId?: string;
    kind: 'issued' | 'revoked';
    occurredAt: number;
  },
): Promise<void> {
  await ctx.db.insert('nodeslide_deck_grant_events', {
    id: nodeslideEventId(
      'nsgrant_event',
      event.occurredAt,
      event.grantId,
      event.kind,
      event.actorGrantId ?? 'owner',
    ),
    ...event,
  });
}

function grantSummary(
  grant: Omit<Doc<'nodeslide_deck_grants'>, '_id' | '_creationTime'>,
  now: number,
): NodeSlideDeckGrantSummary {
  return {
    id: grant.id,
    deckId: grant.deckId,
    role: grant.role,
    policy: structuredClone(grant.policy) as NodeSlideDeckAccessPolicy,
    ...(grant.parentGrantId ? { parentGrantId: grant.parentGrantId } : {}),
    status:
      grant.revokedAt !== undefined ? 'revoked' : now >= grant.expiresAt ? 'expired' : 'active',
    expiresAt: grant.expiresAt,
    createdAt: grant.createdAt,
    ...(grant.revokedAt !== undefined ? { revokedAt: grant.revokedAt } : {}),
  };
}

function boundedId(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function assertExpiry(expiresAt: number, now: number): void {
  if (
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > MAX_GRANT_LIFETIME_MS
  ) {
    throw new Error('Invalid NodeSlide deck grant expiry.');
  }
}

function randomToken(): string {
  const bytes = new Uint8Array(TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
}

export type { NodeSlideAccessPolicy };
