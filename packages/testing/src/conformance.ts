import {
  NODESLIDE_AUTHORIZATION_RECEIPT_VERSION,
  type NodeSlidePatchCommand,
  type NodeSlidePrincipal,
  type NodeSlideProposalResolution,
  type NodeSlideRepository,
} from '@nodeslide/backend';
import type { DeckSnapshot } from '@nodeslide/contracts';

export interface NodeSlideRepositoryConformanceInput {
  repository: NodeSlideRepository;
  principal: NodeSlidePrincipal;
  initialSnapshot: DeckSnapshot;
  proposal: NodeSlidePatchCommand;
}

export interface NodeSlideRepositoryConformanceResult {
  proposalVersion: number;
  acceptedVersion: number;
  versionCount: number;
  receiptId: string;
  resolution: NodeSlideProposalResolution;
}

/**
 * Framework-neutral smoke contract that every repository adapter can execute.
 * It verifies the central governance invariant: proposing never mutates, while
 * accepting advances the authoritative version exactly once.
 */
export async function runNodeSlideRepositoryConformance(
  input: NodeSlideRepositoryConformanceInput,
): Promise<NodeSlideRepositoryConformanceResult> {
  for (const invariant of [
    'mutation_authority',
    'version_cas',
    'candidate_validation',
    'trace_lineage',
    'source_authorization',
    'rollback',
  ] as const) {
    if (!input.repository.descriptor.invariants[invariant]) {
      throw new Error(`Conformance failed: adapter omitted ${invariant} enforcement.`);
    }
  }
  const before = await input.repository.getDeck({
    deckId: input.initialSnapshot.deck.id,
    principal: input.principal,
  });
  if (!before) throw new Error('Conformance failed: seeded deck was not found.');
  if (before.deck.version !== input.initialSnapshot.deck.version) {
    throw new Error('Conformance failed: seeded deck version changed before the test.');
  }

  const proposal = await input.repository.createProposal({
    deckId: before.deck.id,
    principal: input.principal,
    patch: input.proposal,
  });
  const afterProposal = await input.repository.getDeck({
    deckId: before.deck.id,
    principal: input.principal,
  });
  if (!afterProposal || afterProposal.deck.version !== before.deck.version) {
    throw new Error('Conformance failed: creating a proposal mutated the authoritative deck.');
  }

  const resolution = await input.repository.resolveProposal({
    deckId: before.deck.id,
    principal: input.principal,
    proposalId: proposal.id,
    decision: 'accept',
  });
  if (resolution.status !== 'accepted') {
    throw new Error(`Conformance failed: current proposal resolved as ${resolution.status}.`);
  }
  if (resolution.snapshot.deck.version !== before.deck.version + 1) {
    throw new Error('Conformance failed: accepted proposal did not advance exactly one version.');
  }
  const { receipt } = resolution;
  if (
    receipt.operation !== 'proposal.accepted' ||
    receipt.principalId !== input.principal.userId ||
    receipt.deckId !== before.deck.id ||
    receipt.deckVersion !== resolution.snapshot.deck.version ||
    receipt.patchId !== proposal.id ||
    receipt.traceId !== proposal.traceId ||
    !Number.isSafeInteger(receipt.recordedAt) ||
    receipt.recordedAt < 0 ||
    receipt.authorization.schemaVersion !== NODESLIDE_AUTHORIZATION_RECEIPT_VERSION ||
    receipt.authorization.principalId !== receipt.principalId ||
    receipt.authorization.organizationId !== input.principal.organizationId ||
    receipt.authorization.deckId !== receipt.deckId ||
    receipt.authorization.action !== 'proposal.accept' ||
    receipt.authorization.resource.kind !== 'proposal' ||
    receipt.authorization.resource.id !== proposal.id ||
    !Number.isSafeInteger(receipt.authorization.authorizedAt) ||
    receipt.authorization.authorizedAt < 0 ||
    receipt.authorization.id.length === 0 ||
    receipt.authorization.evidence.issuer.length === 0 ||
    receipt.authorization.evidence.policyId.length === 0 ||
    receipt.authorization.evidence.policyVersion.length === 0
  ) {
    throw new Error('Conformance failed: acceptance receipt is not bound to host authorization.');
  }

  const versions = await input.repository.listVersions({
    deckId: before.deck.id,
    principal: input.principal,
  });
  if (!versions.some((version) => version.version === resolution.snapshot.deck.version)) {
    throw new Error('Conformance failed: the accepted version was not persisted.');
  }

  return {
    proposalVersion: afterProposal.deck.version,
    acceptedVersion: resolution.snapshot.deck.version,
    versionCount: versions.length,
    receiptId: resolution.receipt.id,
    resolution,
  };
}
