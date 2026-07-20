import type { DeckSnapshot } from '../../../shared/nodeslide';
import type {
  NodeSlidePatchCommand,
  NodeSlidePrincipal,
  NodeSlideProposalResolution,
  NodeSlideRepository,
} from '../../backend/src';

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
