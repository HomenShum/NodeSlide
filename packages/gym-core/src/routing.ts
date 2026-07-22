export const NODE_GYM_ROUTING_RECEIPT_SCHEMA_VERSION = 'nodekit.gym-routing-approval/v1' as const;
export const NODE_GYM_ROUTE_PROPOSAL_SCHEMA_VERSION = 'nodekit.gym-route-proposal/v1' as const;

export interface NodeGymChampionRoute {
  taskClass: string;
  model: string;
  harness: string;
  evidenceDigest: string;
  eligible: boolean;
  evaluatedAt: number;
  expiresAt: number;
  maxCostMicroUsd: number;
}

export interface NodeGymRoutingApprovalReceipt {
  schemaVersion: typeof NODE_GYM_ROUTING_RECEIPT_SCHEMA_VERSION;
  receiptDigest: string;
  proposalDigest: string;
  taskClass: string;
  model: string;
  harness: string;
  evidenceDigest: string;
  approvedBy: string;
  approvedAt: number;
  expiresAt: number;
  status: 'approved' | 'revoked';
  autoApply: false;
}

export type NodeGymUnsignedRoutingApprovalReceipt = Omit<
  NodeGymRoutingApprovalReceipt,
  'receiptDigest'
>;

export interface NodeGymRouteCircuit {
  routeKey: string;
  state: 'closed' | 'open';
  consecutiveFailures: number;
  openedAt?: number;
}

export interface NodeGymTrustedProductionApprovalContext {
  proposal: Readonly<NodeGymChampionRoute>;
  approval: Readonly<NodeGymRoutingApprovalReceipt>;
  expectedProposalDigest: string;
  expectedReceiptDigest: string;
}

/**
 * Product/server code supplies this boundary from trusted approval storage or a
 * signature verifier. Returning anything except literal true rejects production
 * routing. Gym core intentionally owns no authority or signing key.
 */
export type NodeGymTrustedProductionApprovalVerifier = (
  context: NodeGymTrustedProductionApprovalContext,
) => boolean;

/**
 * Binds an approval to the complete evaluated route proposal rather than only
 * its display identity. This digest is integrity metadata; the caller must still
 * obtain and persist the approval through its explicit authorized boundary.
 */
export function nodeGymChampionRouteProposalDigest(proposal: NodeGymChampionRoute): string {
  assertValidChampionProposal(proposal);
  return sha256Digest(
    JSON.stringify([
      NODE_GYM_ROUTE_PROPOSAL_SCHEMA_VERSION,
      proposal.taskClass,
      proposal.model,
      proposal.harness,
      proposal.evidenceDigest,
      proposal.eligible,
      proposal.evaluatedAt,
      proposal.expiresAt,
      proposal.maxCostMicroUsd,
    ]),
  );
}

/** Recomputes the digest over every authorization-relevant receipt field. */
export function nodeGymRoutingApprovalReceiptDigest(
  receipt: NodeGymUnsignedRoutingApprovalReceipt,
): string {
  assertValidUnsignedApproval(receipt);
  return sha256Digest(
    JSON.stringify([
      receipt.schemaVersion,
      receipt.proposalDigest,
      receipt.taskClass,
      receipt.model,
      receipt.harness,
      receipt.evidenceDigest,
      receipt.approvedBy,
      receipt.approvedAt,
      receipt.expiresAt,
      receipt.status,
      receipt.autoApply,
    ]),
  );
}

/**
 * Creates canonical integrity metadata for an explicit approval decision. This
 * helper cannot grant authority: only server-owned approved receipt storage may
 * supply the result to production route selection.
 */
export function buildNodeGymRoutingApprovalReceipt(input: {
  proposal: NodeGymChampionRoute;
  approvedBy: string;
  approvedAt: number;
  expiresAt: number;
  status: 'approved' | 'revoked';
}): NodeGymRoutingApprovalReceipt {
  if (
    input.status === 'approved' &&
    (!input.proposal.eligible ||
      input.approvedAt < input.proposal.evaluatedAt ||
      input.expiresAt > input.proposal.expiresAt)
  )
    throw new Error('NodeGym routing approval exceeds its evaluated proposal boundary.');
  const unsigned: NodeGymUnsignedRoutingApprovalReceipt = {
    schemaVersion: NODE_GYM_ROUTING_RECEIPT_SCHEMA_VERSION,
    proposalDigest: nodeGymChampionRouteProposalDigest(input.proposal),
    taskClass: input.proposal.taskClass,
    model: input.proposal.model,
    harness: input.proposal.harness,
    evidenceDigest: input.proposal.evidenceDigest,
    approvedBy: input.approvedBy,
    approvedAt: input.approvedAt,
    expiresAt: input.expiresAt,
    status: input.status,
    autoApply: false,
  };
  return { ...unsigned, receiptDigest: nodeGymRoutingApprovalReceiptDigest(unsigned) };
}

export function selectNodeGymGovernedRoute(input: {
  taskClass: string;
  champions: NodeGymChampionRoute[];
  approvalReceipts: NodeGymRoutingApprovalReceipt[];
  circuits: NodeGymRouteCircuit[];
  fallback: { model: string; harness: string };
  now: number;
  metadataMaxAgeMs: number;
  perRouteCostCapMicroUsd: number;
  mode: 'shadow' | 'production';
  verifyTrustedProductionApproval?: NodeGymTrustedProductionApprovalVerifier;
}) {
  const selectedChampion = input.champions.find(
    (entry) => entry.taskClass === input.taskClass && entry.eligible,
  );
  const champion = selectedChampion ? { ...selectedChampion } : undefined;
  const blockers: string[] = [];
  if (!champion) blockers.push('eligible_champion_missing');
  if (champion) {
    if (!isDigest(champion.evidenceDigest)) blockers.push('champion_evidence_digest_invalid');
    if (
      !Number.isFinite(champion.evaluatedAt) ||
      champion.evaluatedAt > input.now ||
      input.now - champion.evaluatedAt > input.metadataMaxAgeMs ||
      champion.expiresAt <= input.now
    )
      blockers.push('champion_metadata_stale');
    if (
      !Number.isInteger(champion.maxCostMicroUsd) ||
      champion.maxCostMicroUsd < 0 ||
      champion.maxCostMicroUsd > input.perRouteCostCapMicroUsd
    )
      blockers.push('route_budget_exceeded');
    const routeKey = `${champion.model}::${champion.harness}`;
    if (input.circuits.find((entry) => entry.routeKey === routeKey)?.state !== 'closed')
      blockers.push('route_circuit_open');
    if (input.mode === 'production') {
      const selectedApproval = input.approvalReceipts.find(
        (entry) =>
          entry.taskClass === champion.taskClass &&
          entry.model === champion.model &&
          entry.harness === champion.harness &&
          entry.evidenceDigest === champion.evidenceDigest,
      );
      const approval = selectedApproval ? { ...selectedApproval } : undefined;
      if (!approval) blockers.push('routing_approval_missing');
      else {
        const verification = verifiedRoutingApproval(approval, champion, input.now);
        if (!verification) {
          blockers.push('routing_approval_invalid');
        } else if (!input.verifyTrustedProductionApproval) {
          blockers.push('routing_approval_authority_missing');
        } else if (
          !trustedProductionApproval(input.verifyTrustedProductionApproval, verification)
        ) {
          blockers.push('routing_approval_untrusted');
        }
      }
    }
  }
  if (!champion || blockers.length > 0)
    return {
      mode: 'fallback' as const,
      ...input.fallback,
      userVisible: input.mode === 'production',
      blockers: [...new Set(blockers)].sort(),
      routingMutationApplied: false as const,
    };
  return {
    mode: input.mode,
    model: champion.model,
    harness: champion.harness,
    userVisible: input.mode === 'production',
    blockers: [],
    evidenceDigest: champion.evidenceDigest,
    routingMutationApplied: input.mode === 'production',
  } as const;
}

export function nodeGymEscalationDecision(input: {
  evidenceStatus: 'supported' | 'missing' | 'conflicting';
  semanticIssueCodes: string[];
  consecutiveFailures: number;
  ambiguityScore: number;
  ambiguityThreshold?: number;
  repeatFailureThreshold?: number;
}) {
  const reasons = [];
  const ambiguityThreshold = input.ambiguityThreshold ?? 0.5;
  const repeatFailureThreshold = input.repeatFailureThreshold ?? 2;
  if (input.evidenceStatus !== 'supported') reasons.push('unsupported_or_conflicting_evidence');
  if (input.semanticIssueCodes.length > 0) reasons.push('semantic_validation_failure');
  if (input.consecutiveFailures >= repeatFailureThreshold) reasons.push('repeated_failure');
  if (!Number.isFinite(input.ambiguityScore) || input.ambiguityScore >= ambiguityThreshold)
    reasons.push('typed_ambiguity');
  return {
    decision: reasons.length ? ('escalate' as const) : ('continue-bounded' as const),
    reasons: [...new Set(reasons)].sort(),
    routingMutationApplied: false as const,
  };
}

function isDigest(value: string) {
  return /^sha256:[a-f0-9]{64}$/u.test(String(value).trim().toLowerCase());
}

function verifiedRoutingApproval(
  approval: NodeGymRoutingApprovalReceipt,
  champion: NodeGymChampionRoute,
  now: number,
): NodeGymTrustedProductionApprovalContext | null {
  try {
    const { receiptDigest, ...unsigned } = approval;
    const expectedProposalDigest = nodeGymChampionRouteProposalDigest(champion);
    const expectedReceiptDigest = nodeGymRoutingApprovalReceiptDigest(unsigned);
    const valid =
      approval.schemaVersion === NODE_GYM_ROUTING_RECEIPT_SCHEMA_VERSION &&
      approval.proposalDigest === expectedProposalDigest &&
      approval.taskClass === champion.taskClass &&
      approval.model === champion.model &&
      approval.harness === champion.harness &&
      approval.evidenceDigest === champion.evidenceDigest &&
      approval.status === 'approved' &&
      approval.autoApply === false &&
      approval.approvedAt >= champion.evaluatedAt &&
      approval.approvedAt <= now &&
      approval.expiresAt <= champion.expiresAt &&
      approval.expiresAt > now &&
      isDigest(receiptDigest) &&
      receiptDigest === expectedReceiptDigest;
    if (!valid) return null;
    return Object.freeze({
      proposal: Object.freeze({ ...champion }),
      approval: Object.freeze({ ...approval }),
      expectedProposalDigest,
      expectedReceiptDigest,
    });
  } catch {
    return null;
  }
}

function trustedProductionApproval(
  verifier: NodeGymTrustedProductionApprovalVerifier,
  context: NodeGymTrustedProductionApprovalContext,
): boolean {
  try {
    return verifier(context) === true;
  } catch {
    return false;
  }
}

function assertValidChampionProposal(proposal: NodeGymChampionRoute): void {
  if (
    !proposal.taskClass.trim() ||
    !proposal.model.trim() ||
    !proposal.harness.trim() ||
    !isDigest(proposal.evidenceDigest) ||
    typeof proposal.eligible !== 'boolean' ||
    !Number.isSafeInteger(proposal.evaluatedAt) ||
    !Number.isSafeInteger(proposal.expiresAt) ||
    proposal.expiresAt <= proposal.evaluatedAt ||
    !Number.isSafeInteger(proposal.maxCostMicroUsd) ||
    proposal.maxCostMicroUsd < 0
  )
    throw new Error('NodeGym route proposal is invalid.');
}

function assertValidUnsignedApproval(receipt: NodeGymUnsignedRoutingApprovalReceipt): void {
  if (
    receipt.schemaVersion !== NODE_GYM_ROUTING_RECEIPT_SCHEMA_VERSION ||
    !isDigest(receipt.proposalDigest) ||
    !receipt.taskClass.trim() ||
    !receipt.model.trim() ||
    !receipt.harness.trim() ||
    !isDigest(receipt.evidenceDigest) ||
    !receipt.approvedBy.trim() ||
    !Number.isSafeInteger(receipt.approvedAt) ||
    !Number.isSafeInteger(receipt.expiresAt) ||
    receipt.expiresAt <= receipt.approvedAt ||
    (receipt.status !== 'approved' && receipt.status !== 'revoked') ||
    receipt.autoApply !== false
  )
    throw new Error('NodeGym routing approval receipt is invalid.');
}

const SHA256_INITIAL_STATE = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
] as const;

const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function sha256Digest(value: string): string {
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = bytes.length * 8;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
  view.setUint32(paddedLength - 4, bitLength >>> 0, false);

  const state: number[] = [...SHA256_INITIAL_STATE];
  const words = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1)
      words[index] = view.getUint32(offset + index * 4, false);
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15] ?? 0;
      const before2 = words[index - 2] ?? 0;
      const sigma0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ (before15 >>> 3);
      const sigma1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ (before2 >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e ?? 0, 6) ^ rotateRight(e ?? 0, 11) ^ rotateRight(e ?? 0, 25);
      const choose = ((e ?? 0) & (f ?? 0)) ^ (~(e ?? 0) & (g ?? 0));
      const temporary1 =
        ((h ?? 0) + sum1 + choose + (SHA256_ROUND_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>>
        0;
      const sum0 = rotateRight(a ?? 0, 2) ^ rotateRight(a ?? 0, 13) ^ rotateRight(a ?? 0, 22);
      const majority = ((a ?? 0) & (b ?? 0)) ^ ((a ?? 0) & (c ?? 0)) ^ ((b ?? 0) & (c ?? 0));
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = ((d ?? 0) + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = ((state[0] ?? 0) + (a ?? 0)) >>> 0;
    state[1] = ((state[1] ?? 0) + (b ?? 0)) >>> 0;
    state[2] = ((state[2] ?? 0) + (c ?? 0)) >>> 0;
    state[3] = ((state[3] ?? 0) + (d ?? 0)) >>> 0;
    state[4] = ((state[4] ?? 0) + (e ?? 0)) >>> 0;
    state[5] = ((state[5] ?? 0) + (f ?? 0)) >>> 0;
    state[6] = ((state[6] ?? 0) + (g ?? 0)) >>> 0;
    state[7] = ((state[7] ?? 0) + (h ?? 0)) >>> 0;
  }
  return `sha256:${state.map((value) => value.toString(16).padStart(8, '0')).join('')}`;
}

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}
