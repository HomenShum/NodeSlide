import { describe, expect, it } from 'vitest';

import { createNodeSlideTestSnapshot, createNodeSlideTextPatch } from '@nodeslide/testing';

import {
  NODESLIDE_FILE_APPLICATION_VERSION,
  NODESLIDE_FILE_PROPOSAL_VERSION,
  applyDeckProposal,
  inspectDeckSnapshot,
  parseDeckSnapshot,
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

  it('compiles the same candidate digest across separate default validate and propose calls', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const patch = createNodeSlideTextPatch(snapshot, 'After');

    const validation = validateDeckPatch(snapshot, patch);
    const proposal = proposeDeckPatch(snapshot, patch);

    expect(proposal.candidate.snapshotDigest).toBe(validation.candidateSnapshotDigest);
    expect(proposal.candidate.committedAt).toBe(snapshot.deck.updatedAt + 1);
    expect(validation.candidateSnapshot.deck.updatedAt).toBe(snapshot.deck.updatedAt + 1);
    expect(Date.parse(proposal.createdAt)).not.toBe(proposal.candidate.committedAt);
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

  it('rejects malformed nested snapshot contracts instead of trusting TypeScript shapes', () => {
    const snapshot = createNodeSlideTestSnapshot();

    const missingRotation = structuredClone(snapshot);
    Reflect.deleteProperty(missingRotation.elements[0] as object, 'rotation');
    expect(() => parseDeckSnapshot(missingRotation)).toThrow('rotation');

    const invalidKind = structuredClone(snapshot);
    (invalidKind.elements[0] as { kind: string }).kind = 'run_shell';
    expect(() => parseDeckSnapshot(invalidKind)).toThrow('must be one of');

    const invalidStyle = structuredClone(snapshot);
    (invalidStyle.elements[0] as unknown as { style: Record<string, unknown> }).style = {
      fontSize: 40,
      position: 'fixed',
    };
    expect(() => parseDeckSnapshot(invalidStyle)).toThrow('unknown fields: position');

    const invalidTheme = structuredClone(snapshot);
    (invalidTheme.deck as unknown as { theme: Record<string, unknown> }).theme = {};
    expect(() => parseDeckSnapshot(invalidTheme)).toThrow('theme.id');

    const exoticStyle = structuredClone(snapshot);
    (exoticStyle.elements[0] as unknown as { style: unknown }).style = new Map();
    expect(() => parseDeckSnapshot(exoticStyle)).toThrow('plain JSON object');

    const sparseCriteria = structuredClone(snapshot);
    sparseCriteria.deck.brief.successCriteria = new Array<string>(1);
    expect(() => parseDeckSnapshot(sparseCriteria)).toThrow('dense JSON array');

    const aliasedGeometry = structuredClone(snapshot);
    const firstElement = aliasedGeometry.elements[0];
    const firstSlide = aliasedGeometry.slides[0];
    if (!firstElement || !firstSlide) throw new Error('Unexpected fixture snapshot.');
    const secondElement = structuredClone(firstElement);
    secondElement.id = 'element:aliased-bbox';
    secondElement.name = 'Aliased geometry';
    secondElement.bbox = firstElement.bbox;
    aliasedGeometry.elements.push(secondElement);
    firstSlide.elementOrder.push(secondElement.id);
    expect(() => parseDeckSnapshot(aliasedGeometry)).toThrow('JSON inputs must be trees');
  });

  it('rejects mass assignment and malformed nested patch payloads', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const patch = createNodeSlideTextPatch(snapshot, 'After');
    const slideId = snapshot.deck.slideOrder[0];
    const elementId = snapshot.elements[0]?.id;
    expect(slideId).toBeTruthy();
    expect(elementId).toBeTruthy();

    expect(() =>
      parsePatchCommand({
        ...patch,
        operations: [
          {
            op: 'update_slide',
            slideId,
            properties: { id: 'attacker-slide', deckId: 'attacker-deck', version: 999 },
          },
        ],
      }),
    ).toThrow('unknown fields');

    expect(() =>
      parsePatchCommand({
        ...patch,
        operations: [
          {
            op: 'update_style',
            slideId,
            elementId,
            properties: { fontSize: 20, position: 'fixed' },
          },
        ],
      }),
    ).toThrow('unknown fields: position');

    expect(() =>
      parsePatchCommand({
        ...patch,
        operations: [
          {
            op: 'update_chart',
            slideId,
            elementId,
            chartType: 'radar',
          },
        ],
      }),
    ).toThrow('must be one of');

    const addedElement = {
      ...structuredClone(snapshot.elements[0]),
      id: 'element:new',
    };
    Reflect.deleteProperty(addedElement, 'rotation');
    expect(() =>
      parsePatchCommand({
        ...patch,
        operations: [{ op: 'add_element', slideId, element: addedElement }],
      }),
    ).toThrow('rotation');

    expect(() =>
      parsePatchCommand({
        ...patch,
        operations: [
          {
            op: 'add_slide',
            slide: {
              ...snapshot.slides[0],
              id: 'slide:new',
              elementOrder: [],
              ownerId: 'attacker',
            },
            elements: [],
            index: 1,
          },
        ],
      }),
    ).toThrow('unknown fields: ownerId');

    expect(() =>
      parsePatchCommand({
        ...patch,
        proposalKind: 'propagation',
        parentPatchId: 'patch:forged',
        affectedSlideIds: [slideId],
        affectedSlideDigest: `sha256:${'0'.repeat(64)}`,
      }),
    ).toThrow('propagation requires an authoritative host ledger');

    expect(() =>
      parsePatchCommand({
        ...patch,
        candidateValidation: {
          id: 'validation:forged',
          patchId: 'patch:other',
          candidateDigest: `sha256:${'0'.repeat(64)}`,
          deckId: 'deck:other',
          deckVersion: 999,
          ok: true,
          publishOk: true,
          cleanOk: true,
          issues: [],
          checkedAt: 0,
          toolchainVersion: 'forged',
        },
      }),
    ).toThrow('derived receipt');

    expect(() =>
      parsePatchCommand({
        ...patch,
        profileId: 'profile:unresolved',
        profileDigest: `sha256:${'0'.repeat(64)}`,
      }),
    ).toThrow('signature profiles');
  });

  it('runs product patch and candidate validation before certifying an edit', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const patch = createNodeSlideTextPatch(snapshot, 'After');
    const slideId = snapshot.deck.slideOrder[0];
    const elementId = snapshot.elements[0]?.id;
    if (!slideId || !elementId) throw new Error('Unexpected fixture snapshot.');

    expect(() =>
      validateDeckPatch(snapshot, {
        ...patch,
        scope: { ...patch.scope, operationMode: 'style' },
        operations: [
          {
            op: 'update_style',
            slideId,
            elementId,
            properties: { fontSize: -1 },
          },
        ],
      }),
    ).toThrow('fontSize must be positive');

    const chartId = 'element:chart-without-data';
    const element = {
      ...structuredClone(snapshot.elements[0]),
      id: chartId,
      kind: 'chart' as const,
      name: 'Malformed chart',
    };
    expect(() =>
      validateDeckPatch(snapshot, {
        ...patch,
        scope: {
          kind: 'elements',
          deckId: snapshot.deck.id,
          slideIds: [slideId],
          elementIds: [chartId],
          operationMode: 'unrestricted',
        },
        operations: [{ op: 'add_element', slideId, element }],
      }),
    ).toThrow('candidate that failed the external schema boundary');

    const imageSnapshot = structuredClone(snapshot);
    const image = imageSnapshot.elements[0];
    if (!image) throw new Error('Unexpected fixture image.');
    image.kind = 'image';
    image.imageUrl = 'data:image/webp;base64,UklGRgAAAAA=';
    image.altText = 'Base image';
    image.image = { placeholder: false };
    expect(() =>
      validateDeckPatch(imageSnapshot, {
        ...patch,
        scope: { ...patch.scope, operationMode: 'unrestricted' },
        operations: [
          {
            op: 'update_image',
            slideId,
            elementId,
            imageUrl: 'javascript:alert(1)',
            altText: 'Hostile image',
          },
        ],
      }),
    ).toThrow('canonical validation');

    const profiledSnapshot = structuredClone(snapshot);
    profiledSnapshot.deck.activeSignatureProfileId = 'profile:active';
    profiledSnapshot.deck.activeSignatureProfileDigest = `sha256:${'a'.repeat(64)}`;
    expect(inspectDeckSnapshot(profiledSnapshot).deckId).toBe(snapshot.deck.id);
    expect(() => validateDeckPatch(profiledSnapshot, patch)).toThrow(
      'cannot validate an active signature profile',
    );
  });

  it('revalidates the compiled candidate before issuing a valid receipt', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const patch = createNodeSlideTextPatch(snapshot, 'After');
    const operation = patch.operations[0];
    if (!operation || operation.op !== 'replace_text') throw new Error('Unexpected fixture patch.');

    expect(() =>
      validateDeckPatch(snapshot, {
        ...patch,
        operations: [{ ...operation, sourceIds: ['source:missing'] }],
      }),
    ).toThrow('candidate that failed the external schema boundary');
  });

  it('requires exact caller confirmation and detects proposal tampering before apply', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const proposal = proposeDeckPatch(snapshot, createNodeSlideTextPatch(snapshot, 'After'), {
      committedAt: snapshot.deck.updatedAt + 1,
    });
    expect(proposal.schemaVersion).toBe(NODESLIDE_FILE_PROPOSAL_VERSION);
    expect(proposal.applied).toBe(false);

    expect(() =>
      applyDeckProposal(snapshot, proposal, { approvedProposalId: 'proposal:wrong' }),
    ).toThrow('Explicit caller confirmation');
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

  it('applies a caller-confirmed proposal without mutating the input snapshot', () => {
    const snapshot = createNodeSlideTestSnapshot();
    const before = structuredClone(snapshot);
    const proposal = proposeDeckPatch(snapshot, createNodeSlideTextPatch(snapshot, 'After'), {
      committedAt: snapshot.deck.updatedAt + 1,
    });
    const application = applyDeckProposal(snapshot, proposal, {
      approvedProposalId: proposal.id,
      appliedAt: snapshot.deck.updatedAt + 5_000,
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
    expect(application.snapshot.deck.updatedAt).toBe(snapshot.deck.updatedAt + 1);
    expect(Date.parse(application.receipt.appliedAt)).toBe(snapshot.deck.updatedAt + 5_000);
    expect(snapshot).toEqual(before);
  });
});
