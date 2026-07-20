import { describe, expect, it } from 'vitest';

import { createNodeSlideTestSnapshot, createNodeSlideTextPatch } from '@nodeslide/testing';

import {
  NODESLIDE_FILE_APPLICATION_VERSION,
  NODESLIDE_FILE_PROPOSAL_VERSION,
  applyDeckProposal,
  inspectDeckSnapshot,
  parsePatchCommand,
  proposeDeckPatch,
  validateDeckPatch,
} from './index';

describe('NodeSlide external-agent boundary', () => {
  it('inspects a canonical DeckSnapshot without changing it', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const before = structuredClone(snapshot);
    expect(inspectDeckSnapshot(snapshot)).toMatchObject({
      schemaVersion: 'nodeslide.slidelang/v1',
      deckId: 'deck:test',
      version: 1,
      counts: { slides: 1, elements: 1, sources: 0 },
    });
    expect(snapshot).toEqual(before);
  });

  it('preflights an exact version-pinned patch through the canonical engine', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const validation = validateDeckPatch(snapshot, createNodeSlideTextPatch(snapshot, 'After'), {
      committedAt: snapshot.deck.updatedAt + 1,
    });
    expect(validation).toMatchObject({
      valid: true,
      baseDeckVersion: 1,
      candidateDeckVersion: 2,
      affectedSlideIds: ['deck:test:slide:1'],
      affectedElementIds: ['deck:test:slide:1:title'],
    });
    expect(validation.candidateSnapshot.elements[0]?.content).toBe('After');
  });

  it('fails closed when any deck, slide, or element clock is stale', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const staleDeck = { ...createNodeSlideTextPatch(snapshot, 'After'), baseDeckVersion: 0 };
    expect(() => validateDeckPatch(snapshot, staleDeck)).toThrow('pinned to deck version 0');

    const staleElement = {
      ...createNodeSlideTextPatch(snapshot, 'After'),
      baseElementVersions: { 'deck:test:slide:1:title': 0 },
    };
    expect(() => validateDeckPatch(snapshot, staleElement)).toThrow('pinned to version 0');
  });

  it('rejects unknown operation fields and operation kinds', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const patch = createNodeSlideTextPatch(snapshot, 'After');
    expect(() =>
      parsePatchCommand({
        ...patch,
        operations: [{ ...patch.operations[0], bypassValidation: true }],
      }),
    ).toThrow('unknown fields');
    expect(() => parsePatchCommand({ ...patch, operations: [{ op: 'run_shell' }] })).toThrow(
      'must be one of',
    );
  });

  it('requires an exact proposal ID and detects proposal tampering before apply', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const proposal = proposeDeckPatch(snapshot, createNodeSlideTextPatch(snapshot, 'After'), {
      committedAt: snapshot.deck.updatedAt + 1,
    });
    expect(proposal.schemaVersion).toBe(NODESLIDE_FILE_PROPOSAL_VERSION);
    expect(proposal.applied).toBe(false);

    expect(() =>
      applyDeckProposal(snapshot, proposal, { approvedProposalId: 'proposal:wrong' }),
    ).toThrow('Explicit approval');
    expect(() =>
      applyDeckProposal(
        snapshot,
        {
          ...proposal,
          candidate: {
            ...proposal.candidate,
            snapshotDigest: `sha256:${'0'.repeat(64)}`,
          },
        },
        { approvedProposalId: proposal.id },
      ),
    ).toThrow('candidate binding');
  });

  it('applies a reviewed proposal without mutating the input snapshot', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const before = structuredClone(snapshot);
    const proposal = proposeDeckPatch(snapshot, createNodeSlideTextPatch(snapshot, 'After'), {
      committedAt: snapshot.deck.updatedAt + 1,
    });
    const application = applyDeckProposal(snapshot, proposal, {
      approvedProposalId: proposal.id,
      appliedAt: snapshot.deck.updatedAt + 2,
    });
    expect(application.schemaVersion).toBe(NODESLIDE_FILE_APPLICATION_VERSION);
    expect(application.snapshot.deck.version).toBe(2);
    expect(application.snapshot.elements[0]?.content).toBe('After');
    expect(application.receipt).toMatchObject({
      proposalId: proposal.id,
      approval: 'exact_proposal_id',
      baseDeckVersion: 1,
      resultingDeckVersion: 2,
    });
    expect(snapshot).toEqual(before);
  });
});
