// @vitest-environment jsdom
import {
  MemoryNodeSlideRepository,
  NODESLIDE_TEST_PRINCIPAL,
  authorizeNodeSlideTestPrincipal,
  createNodeSlideTestSnapshot,
  createNodeSlideTextPatch,
} from '@nodeslide/testing';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  createNodeSlideProposalReviewModel,
  nodeSlideStudioPermissionsForPrincipal,
  normalizeNodeSlideSelection,
  useNodeSlideRepositoryController,
} from './index';

describe('@nodeslide/react-headless', () => {
  it('loads and mutates only from authoritative repository results', async () => {
    const snapshot = createNodeSlideTestSnapshot();
    const repository = new MemoryNodeSlideRepository({
      snapshots: [snapshot],
      authorize: authorizeNodeSlideTestPrincipal,
    });
    const { result } = renderHook(() =>
      useNodeSlideRepositoryController({
        repository,
        deckId: snapshot.deck.id,
        principal: NODESLIDE_TEST_PRINCIPAL,
      }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => {
      await result.current.applyPatch(createNodeSlideTextPatch(snapshot, 'Headless accepted'));
    });
    expect(result.current.snapshot?.deck.version).toBe(2);
    expect(result.current.snapshot?.elements[0]?.content).toBe('Headless accepted');
  });

  it('derives fail-closed proposal and principal state', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const proposal = {
      ...createNodeSlideTextPatch(snapshot, 'Preview'),
      status: 'accepted' as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const model = createNodeSlideProposalReviewModel({
      currentSnapshot: snapshot,
      proposal,
      activeSlideId: snapshot.deck.slideOrder[0] ?? '',
    });
    expect(model.blockReason).toBe('terminal_proposal');
    expect(model.actionsDisabled).toBe(true);
    expect(
      normalizeNodeSlideSelection(snapshot, { slideId: 'unknown', elementIds: ['unknown'] }),
    ).toEqual({ slideId: null, elementIds: [] });
    expect(nodeSlideStudioPermissionsForPrincipal(NODESLIDE_TEST_PRINCIPAL)).toMatchObject({
      canRead: true,
      canPatch: true,
      canApprove: true,
    });
  });
});
