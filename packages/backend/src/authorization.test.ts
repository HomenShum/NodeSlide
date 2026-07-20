import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_AUTHORIZATION_RECEIPT_VERSION,
  createNodeSlideAuthorizationReceipt,
  parseNodeSlideAuthorizationEvidence,
  parseNodeSlidePrincipal,
} from './index';

const principal = {
  userId: 'user:reviewer',
  organizationId: 'organization:test',
  roles: ['reviewer'],
  permissions: ['nodeslide:read', 'nodeslide:write'],
};

describe('NodeSlide host authorization boundary', () => {
  it('returns a canonical frozen copy of a valid host principal', () => {
    const parsed = parseNodeSlidePrincipal(principal);

    expect(parsed).toEqual(principal);
    expect(parsed).not.toBe(principal);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.roles)).toBe(true);
    expect(Object.isFrozen(parsed.permissions)).toBe(true);
  });

  it('rejects ambiguous, hostile, or unbounded principal values', () => {
    expect(() => parseNodeSlidePrincipal({ ...principal, hostAuthVerified: true })).toThrow(
      'unknown field',
    );
    expect(() =>
      parseNodeSlidePrincipal({
        ...principal,
        roles: ['reviewer', 'reviewer'],
      }),
    ).toThrow('duplicates');
    expect(() => parseNodeSlidePrincipal({ ...principal, permissions: new Array(1) })).toThrow(
      'dense array',
    );
    expect(() =>
      parseNodeSlidePrincipal({
        ...principal,
        roles: Array.from({ length: 65 }, (_, i) => `r${i}`),
      }),
    ).toThrow('item limit');

    const inherited = Object.assign(Object.create({ trusted: true }), principal);
    expect(() => parseNodeSlidePrincipal(inherited)).toThrow('plain object');

    const accessor = { ...principal } as Record<string, unknown>;
    Object.defineProperty(accessor, 'userId', {
      enumerable: true,
      get: () => 'user:forged',
    });
    expect(() => parseNodeSlidePrincipal(accessor)).toThrow('data property');
  });

  it('accepts audit references but rejects extra credential-bearing evidence fields', () => {
    expect(
      parseNodeSlideAuthorizationEvidence({
        issuer: 'noderoom',
        policyId: 'room-membership',
        policyVersion: '2026-07-20',
        evidenceId: 'membership-audit:123',
      }),
    ).toEqual({
      issuer: 'noderoom',
      policyId: 'room-membership',
      policyVersion: '2026-07-20',
      evidenceId: 'membership-audit:123',
    });
    expect(() =>
      parseNodeSlideAuthorizationEvidence({
        issuer: 'noderoom',
        policyId: 'room-membership',
        policyVersion: '1',
        token: 'must-not-cross-the-boundary',
      }),
    ).toThrow('unknown field');
  });

  it('binds an acceptance receipt to the exact reviewer, deck, action, and proposal', () => {
    const receipt = createNodeSlideAuthorizationReceipt(
      {
        action: 'proposal.accept',
        deckId: 'deck:quarterly',
        principal,
        proposalId: 'proposal:exact-candidate',
      },
      {
        issuer: 'noderoom',
        policyId: 'room-reviewer',
        policyVersion: '3',
        evidenceId: 'authorization-row:456',
      },
      { id: 'authorization:456', authorizedAt: 1_721_430_000_000 },
    );

    expect(receipt).toEqual({
      schemaVersion: NODESLIDE_AUTHORIZATION_RECEIPT_VERSION,
      id: 'authorization:456',
      principalId: principal.userId,
      organizationId: principal.organizationId,
      deckId: 'deck:quarterly',
      action: 'proposal.accept',
      resource: { kind: 'proposal', id: 'proposal:exact-candidate' },
      authorizedAt: 1_721_430_000_000,
      evidence: {
        issuer: 'noderoom',
        policyId: 'room-reviewer',
        policyVersion: '3',
        evidenceId: 'authorization-row:456',
      },
    });
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.resource)).toBe(true);
    expect(Object.isFrozen(receipt.evidence)).toBe(true);
  });

  it('rejects unknown runtime authorization actions', () => {
    expect(() =>
      createNodeSlideAuthorizationReceipt(
        {
          action: 'proposal.approve',
          deckId: 'deck:quarterly',
          principal,
          proposalId: 'proposal:exact-candidate',
        } as never,
        {
          issuer: 'noderoom',
          policyId: 'room-reviewer',
          policyVersion: '3',
        },
        { id: 'authorization:invalid', authorizedAt: 1_721_430_000_000 },
      ),
    ).toThrow('request.action is invalid');
  });

  it('rejects authorization resources scoped to a different deck', () => {
    for (const action of ['patch.apply', 'proposal.create'] as const) {
      expect(() =>
        createNodeSlideAuthorizationReceipt(
          {
            action,
            deckId: 'deck:quarterly',
            principal,
            patch: {
              id: 'proposal:cross-deck',
              deckId: 'deck:other',
              scope: { deckId: 'deck:quarterly' },
            } as never,
          },
          { issuer: 'noderoom', policyId: 'room-reviewer', policyVersion: '3' },
          {
            id: `authorization:${action}:patch-deck`,
            authorizedAt: 1_721_430_000_000,
          },
        ),
      ).toThrow('deck scope must match');

      expect(() =>
        createNodeSlideAuthorizationReceipt(
          {
            action,
            deckId: 'deck:quarterly',
            principal,
            patch: {
              id: 'proposal:cross-scope',
              deckId: 'deck:quarterly',
              scope: { deckId: 'deck:other' },
            } as never,
          },
          { issuer: 'noderoom', policyId: 'room-reviewer', policyVersion: '3' },
          {
            id: `authorization:${action}:scope-deck`,
            authorizedAt: 1_721_430_000_000,
          },
        ),
      ).toThrow('deck scope must match');
    }

    expect(() =>
      createNodeSlideAuthorizationReceipt(
        {
          action: 'receipt.store',
          deckId: 'deck:quarterly',
          principal,
          receipt: {
            id: 'custom-receipt:audit',
            deckId: 'deck:other',
          } as never,
        },
        { issuer: 'noderoom', policyId: 'room-reviewer', policyVersion: '3' },
        { id: 'authorization:receipt-deck', authorizedAt: 1_721_430_000_000 },
      ),
    ).toThrow('deckId must match');
  });

  it('rejects accessor-backed request and issuance fields instead of rereading them', () => {
    const request = {
      deckId: 'deck:quarterly',
      principal,
      proposalId: 'proposal:exact-candidate',
    } as Record<string, unknown>;
    Object.defineProperty(request, 'action', {
      enumerable: true,
      get: () => 'proposal.accept',
    });
    expect(() =>
      createNodeSlideAuthorizationReceipt(
        request as never,
        { issuer: 'noderoom', policyId: 'room-reviewer', policyVersion: '3' },
        {
          id: 'authorization:request-accessor',
          authorizedAt: 1_721_430_000_000,
        },
      ),
    ).toThrow('action must be a data property');

    const issued = { id: 'authorization:issued-accessor' } as Record<string, unknown>;
    Object.defineProperty(issued, 'authorizedAt', {
      enumerable: true,
      get: () => 1_721_430_000_000,
    });
    expect(() =>
      createNodeSlideAuthorizationReceipt(
        {
          action: 'proposal.accept',
          deckId: 'deck:quarterly',
          principal,
          proposalId: 'proposal:exact-candidate',
        },
        { issuer: 'noderoom', policyId: 'room-reviewer', policyVersion: '3' },
        issued as never,
      ),
    ).toThrow('authorizedAt must be a data property');
  });
});
