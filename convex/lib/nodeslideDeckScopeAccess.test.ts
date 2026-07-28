import { describe, expect, it } from 'vitest';
import {
  nodeSlideMemoryScopeKey,
  normalizeNodeSlideAccessPolicy,
} from '../../shared/nodeslideAccessPolicy';
import {
  NODESLIDE_DECK_CAPABILITIES,
  NODESLIDE_DECK_ROLES,
  NODESLIDE_DECK_ROLE_CAPABILITY_MATRIX,
  NodeSlideDeckAccessPolicyError,
  evaluateNodeSlideDeckAccess,
  isNodeSlideDeckAccessPolicy,
  narrowNodeSlideDeckAccessPolicy,
  nodeSlideDeckCapabilitiesForRole,
  normalizeNodeSlideDeckAccessPolicy,
} from './nodeslideDeckScopeAccess';

const DECK_A = 'deck-a';
const DECK_B = 'deck-b';

const deckScopeKey = nodeSlideMemoryScopeKey({ kind: 'deck', deckId: DECK_A });
const sessionScopeKey = nodeSlideMemoryScopeKey({
  kind: 'session',
  deckId: DECK_A,
  sessionId: 'session-1',
});

const agentPolicy = normalizeNodeSlideAccessPolicy({
  role: 'planner',
  capabilities: ['deck:read', 'source:read', 'proposal:create'],
  scopes: {
    deckIds: [DECK_A, DECK_B],
    sourceIds: ['source-a', 'source-b'],
    providerIds: [],
    modelIds: [],
    toolIds: [],
    memoryScopeKeys: [deckScopeKey, sessionScopeKey],
  },
  budget: {
    maxCostMicroUsd: 1_000,
    maxInputTokens: 1_000,
    maxOutputTokens: 500,
    maxDurationMs: 10_000,
    maxIterations: 3,
    maxToolCalls: 2,
  },
});

describe('NodeSlide deck scope access', () => {
  it('keeps the deck role matrix exhaustive and viewer read-only', () => {
    expect(Object.keys(NODESLIDE_DECK_ROLE_CAPABILITY_MATRIX).sort()).toEqual(
      [...NODESLIDE_DECK_ROLES].sort(),
    );
    const known = new Set<string>(NODESLIDE_DECK_CAPABILITIES);
    for (const role of NODESLIDE_DECK_ROLES) {
      const capabilities = nodeSlideDeckCapabilitiesForRole(role);
      expect(capabilities.every((capability) => known.has(capability))).toBe(true);
      expect(new Set(capabilities).size).toBe(capabilities.length);
    }
    expect(nodeSlideDeckCapabilitiesForRole('viewer')).toEqual(['deck:read']);
    expect(nodeSlideDeckCapabilitiesForRole('editor')).not.toContain('grant:issue');
    expect(nodeSlideDeckCapabilitiesForRole('editor')).not.toContain('grant:revoke');
  });

  it('carries no workspace or project vocabulary into the deck-scoped contract', () => {
    // The flat model has exactly one scoping axis. If a workspace or project
    // capability ever reappears here, the workspace layer is growing back.
    for (const capability of NODESLIDE_DECK_CAPABILITIES) {
      expect(capability.startsWith('workspace:')).toBe(false);
      expect(capability.startsWith('project:')).toBe(false);
    }
    const normalized = policy({ role: 'owner' }) as unknown as Record<string, unknown>;
    expect(Object.keys(normalized).sort()).toEqual([
      'agentPolicy',
      'capabilities',
      'deckId',
      'role',
      'schemaVersion',
    ]);
    expect(() =>
      normalizeNodeSlideDeckAccessPolicy({
        deckId: DECK_A,
        role: 'owner',
        projectScope: { kind: 'workspace' },
        capabilities: nodeSlideDeckCapabilitiesForRole('owner'),
        agentPolicy,
      }),
    ).toThrow(NodeSlideDeckAccessPolicyError);
  });

  it('narrows role, capabilities, agent scopes, and every budget component', () => {
    const parent = policy({ role: 'owner' });
    const requested = policy({
      role: 'viewer',
      capabilities: ['deck:read'],
      agentPolicy: normalizeNodeSlideAccessPolicy({
        ...agentPolicy,
        capabilities: ['deck:read', 'source:read'],
        scopes: {
          ...agentPolicy.scopes,
          deckIds: [DECK_B, 'deck-c'],
          sourceIds: ['source-b'],
          memoryScopeKeys: [sessionScopeKey],
        },
        budget: {
          maxCostMicroUsd: 2_000,
          maxInputTokens: 500,
          maxOutputTokens: 1_000,
          maxDurationMs: 5_000,
          maxIterations: 5,
          maxToolCalls: 1,
        },
      }),
    });
    const narrowed = narrowNodeSlideDeckAccessPolicy(parent, requested);

    expect(narrowed).toMatchObject({
      deckId: DECK_A,
      role: 'viewer',
      capabilities: ['deck:read'],
      agentPolicy: {
        capabilities: ['deck:read', 'source:read'],
        scopes: {
          deckIds: [DECK_B],
          sourceIds: ['source-b'],
          // Sub-deck narrowing rides on memoryScopeKeys, which is where the
          // flat model expresses what parity spent a projectScope on.
          memoryScopeKeys: [sessionScopeKey],
        },
        budget: {
          maxCostMicroUsd: 1_000,
          maxInputTokens: 500,
          maxOutputTokens: 500,
          maxDurationMs: 5_000,
          maxIterations: 3,
          maxToolCalls: 1,
        },
      },
    });
    expect(narrowed.agentPolicy.scopes.memoryScopeKeys).not.toContain(deckScopeKey);
    expect(isNodeSlideDeckAccessPolicy(narrowed)).toBe(true);
  });

  it('fails closed for deck mismatch, malformed policy, and escalation', () => {
    const viewer = policy({ role: 'viewer', capabilities: ['deck:read'] });
    expect(
      evaluateNodeSlideDeckAccess(viewer, { deckId: DECK_A, capability: 'deck:read' }),
    ).toEqual({ allowed: true, reason: 'allowed' });
    expect(
      evaluateNodeSlideDeckAccess(viewer, { deckId: DECK_B, capability: 'deck:read' }),
    ).toEqual({ allowed: false, reason: 'deck_mismatch' });
    expect(
      evaluateNodeSlideDeckAccess(viewer, { deckId: DECK_A, capability: 'grant:issue' }),
    ).toEqual({ allowed: false, reason: 'capability_denied' });
    expect(
      evaluateNodeSlideDeckAccess(
        { ...viewer, extra: true },
        { deckId: DECK_A, capability: 'deck:read' },
      ),
    ).toEqual({ allowed: false, reason: 'invalid_policy' });
    expect(() =>
      narrowNodeSlideDeckAccessPolicy(policy({ role: 'editor' }), policy({ role: 'owner' })),
    ).toThrow(NodeSlideDeckAccessPolicyError);
  });

  it('rejects cross-deck delegation and capabilities above the role ceiling', () => {
    expect(() =>
      narrowNodeSlideDeckAccessPolicy(
        policy({ role: 'owner' }),
        policy({ deckId: DECK_B, role: 'viewer', capabilities: ['deck:read'] }),
      ),
    ).toThrow('cannot delegate across decks');
    expect(() =>
      normalizeNodeSlideDeckAccessPolicy({
        deckId: DECK_A,
        role: 'viewer',
        capabilities: ['deck:read', 'grant:issue'],
        agentPolicy,
      }),
    ).toThrow('grant:issue is outside the viewer role ceiling');
  });
});

function policy(
  overrides: Partial<{
    deckId: string;
    role: 'owner' | 'editor' | 'viewer';
    capabilities: readonly string[];
    agentPolicy: typeof agentPolicy;
  }> = {},
) {
  const role = overrides.role ?? 'owner';
  return normalizeNodeSlideDeckAccessPolicy({
    deckId: overrides.deckId ?? DECK_A,
    role,
    capabilities: overrides.capabilities ?? nodeSlideDeckCapabilitiesForRole(role),
    agentPolicy: overrides.agentPolicy ?? agentPolicy,
  });
}
