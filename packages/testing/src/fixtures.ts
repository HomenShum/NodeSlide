import {
  NODESLIDE_PERMISSIONS,
  type NodeSlideAuthorize,
  type NodeSlidePatchCommand,
  type NodeSlidePermission,
  type NodeSlidePrincipal,
  type NodeSlideRepositoryAuthorizationAction,
  NodeSlideRepositoryError,
} from '@nodeslide/backend';
import {
  type DeckSnapshot,
  NODESLIDE_SCHEMA_VERSION,
  NODESLIDE_TOOLCHAIN_VERSION,
} from '@nodeslide/contracts';

export const NODESLIDE_TEST_PRINCIPAL: NodeSlidePrincipal = {
  userId: 'user:test-owner',
  organizationId: 'organization:test',
  roles: ['owner'],
  permissions: [
    NODESLIDE_PERMISSIONS.read,
    NODESLIDE_PERMISSIONS.propose,
    NODESLIDE_PERMISSIONS.write,
    NODESLIDE_PERMISSIONS.approve,
    NODESLIDE_PERMISSIONS.manageAssets,
  ],
};

function permissionForTestAuthorizationAction(
  action: NodeSlideRepositoryAuthorizationAction,
): NodeSlidePermission {
  switch (action) {
    case 'deck.read':
    case 'versions.list':
      return NODESLIDE_PERMISSIONS.read;
    case 'proposal.create':
      return NODESLIDE_PERMISSIONS.propose;
    case 'proposal.accept':
    case 'proposal.reject':
      return NODESLIDE_PERMISSIONS.approve;
    case 'patch.apply':
    case 'receipt.store':
      return NODESLIDE_PERMISSIONS.write;
  }
}

/** Deterministic host policy for package tests; production hosts supply their own. */
export const authorizeNodeSlideTestPrincipal: NodeSlideAuthorize = (request) => {
  const requiredPermission = permissionForTestAuthorizationAction(request.action);
  if (!request.principal.permissions.includes(requiredPermission)) {
    throw new NodeSlideRepositoryError(
      'forbidden',
      `The test principal lacks ${requiredPermission}.`,
    );
  }
  const resourceId =
    request.action === 'patch.apply' || request.action === 'proposal.create'
      ? request.patch.id
      : request.action === 'proposal.accept' || request.action === 'proposal.reject'
        ? request.proposalId
        : request.action === 'receipt.store'
          ? request.receipt.id
          : request.deckId;
  return {
    issuer: '@nodeslide/testing',
    policyId: 'testing.permission-map',
    policyVersion: '1',
    evidenceId: `test-policy:${request.action}:${resourceId}`,
  };
};

export function createNodeSlideTestSnapshot(
  deckId = 'deck:test',
  timestamp = 1_700_000_000_000,
): DeckSnapshot {
  const slideId = `${deckId}:slide:1`;
  const titleId = `${slideId}:title`;
  return {
    deck: {
      schemaVersion: NODESLIDE_SCHEMA_VERSION,
      toolchainVersion: NODESLIDE_TOOLCHAIN_VERSION,
      id: deckId,
      projectId: 'project:test',
      title: 'Injectable NodeSlide fixture',
      brief: {
        prompt: 'Prove the portable NodeSlide repository contract.',
        audience: 'NodeSlide integrators',
        purpose: 'Conformance testing',
        successCriteria: ['A proposal stays unapplied until acceptance.'],
      },
      theme: {
        id: 'test-theme',
        name: 'Test theme',
        mode: 'light',
        colors: {
          canvas: '#ffffff',
          ink: '#111111',
          muted: '#666666',
          accent: '#3155d9',
          accentSoft: '#e9edff',
          insight: '#dfe9d8',
          insightInk: '#1e3b2b',
          trace: '#10213f',
          border: '#d9d9d2',
        },
        typography: {
          display: 'Aptos Display',
          body: 'Aptos',
          data: 'Aptos Mono',
        },
        defaultRadius: 8,
        spacingUnit: 8,
      },
      slideOrder: [slideId],
      version: 1,
      status: 'ready',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    slides: [
      {
        id: slideId,
        deckId,
        title: 'Portable boundary',
        background: '#ffffff',
        elementOrder: [titleId],
        version: 1,
      },
    ],
    elements: [
      {
        id: titleId,
        slideId,
        name: 'Title',
        kind: 'text',
        role: 'title',
        bbox: { x: 0.08, y: 0.12, width: 0.7, height: 0.18 },
        rotation: 0,
        content: 'Before',
        style: { color: '#111111', fontSize: 40, fontWeight: 700 },
        sourceIds: [],
        locked: false,
        exportCapabilities: ['web_native', 'pptx_editable'],
        version: 1,
      },
    ],
    sources: [],
  };
}

export function createNodeSlideTextPatch(
  snapshot: DeckSnapshot,
  text: string,
  id = `patch:${snapshot.deck.id}:${snapshot.deck.version}`,
): NodeSlidePatchCommand {
  const slideId = snapshot.deck.slideOrder[0];
  if (!slideId) throw new Error('The NodeSlide test fixture requires one slide.');
  const slide = snapshot.slides.find((candidate) => candidate.id === slideId);
  const elementId = slide?.elementOrder[0];
  if (!slide || !elementId) throw new Error('The NodeSlide test fixture requires one element.');
  const element = snapshot.elements.find((candidate) => candidate.id === elementId);
  if (!element) throw new Error('The NodeSlide test fixture element is unavailable.');
  return {
    id,
    deckId: snapshot.deck.id,
    baseDeckVersion: snapshot.deck.version,
    baseSlideVersions: { [slide.id]: slide.version },
    baseElementVersions: { [element.id]: element.version },
    scope: {
      kind: 'elements',
      deckId: snapshot.deck.id,
      slideIds: [slide.id],
      elementIds: [element.id],
      operationMode: 'copy',
    },
    operations: [
      {
        op: 'replace_text',
        slideId: slide.id,
        elementId: element.id,
        text,
      },
    ],
    source: 'agent',
    summary: `Replace the fixture title with ${text}.`,
  };
}
