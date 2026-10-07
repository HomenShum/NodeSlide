import type {
  NodeBookArtifact,
  NodeBookFailure,
  NodeBookMutationResult,
} from '@nodebook/contracts';
import {
  MAX_SURFACE_ARTIFACTS,
  MAX_SURFACE_NODES,
  type NodeBookSurfaceRepository,
  type NodeBookSurfaceSnapshot,
} from '@nodebook/model';
import { NodeBookProvider, NodeBookSurface } from '@nodebook/react';
import { Component, type ReactNode, useMemo } from 'react';
import '@nodebook/react/styles.css';

import type { NodeSlideWorkspace } from '../../../../shared/nodeslide';
import { sha256Hex } from '../signature/packs/encoding';
import { projectSelectedGraphToNodeBook } from './nodeBookGraphProjection';

function readOnlyFailure(errorCode: string, message: string): NodeBookFailure {
  return { status: 'forbidden', errorCode, message, retryable: false };
}

function boundedLabel(value: string | undefined, fallback: string): string {
  return (value?.replace(/\s+/gu, ' ').trim() || fallback).slice(0, 500);
}

function requiredBucket<T>(value: T | undefined, errorCode: string): T {
  if (value === undefined) throw new Error(errorCode);
  return value;
}

/** Projects the canonical deck graph; NodeSlide keeps identity, writes, review, and CAS ownership. */
export function projectNodeSlideWorkspaceToNodeBook(
  workspace: NodeSlideWorkspace,
  portableArtifacts: readonly NodeBookArtifact[] = [],
): NodeBookSurfaceSnapshot {
  const rootId = `deck:${workspace.deck.id}`;
  const slides = [...workspace.slides].sort(
    (left, right) =>
      workspace.deck.slideOrder.indexOf(left.id) - workspace.deck.slideOrder.indexOf(right.id) ||
      left.id.localeCompare(right.id),
  );
  if (slides.some((slide) => slide.deckId !== workspace.deck.id)) {
    throw new Error('NODESLIDE_NODEBOOK_DECK_SCOPE_MISMATCH');
  }
  const slideIds = new Set(slides.map((slide) => slide.id));
  if (workspace.elements.some((element) => !slideIds.has(element.slideId))) {
    throw new Error('NODESLIDE_NODEBOOK_ELEMENT_SCOPE_MISMATCH');
  }
  if (
    1 + slides.length + workspace.elements.length + portableArtifacts.length >
    MAX_SURFACE_NODES
  ) {
    throw new Error('NODESLIDE_NODEBOOK_NODE_LIMIT');
  }
  if (
    portableArtifacts.some(
      (artifact) => artifact.workspaceId !== workspace.deck.id || artifact.rootId !== rootId,
    )
  ) {
    throw new Error('NODESLIDE_NODEBOOK_PORTABLE_ARTIFACT_SCOPE_MISMATCH');
  }

  const elementsBySlide = new Map(
    slides.map((slide) => [slide.id, [] as typeof workspace.elements]),
  );
  for (const element of workspace.elements) {
    requiredBucket(
      elementsBySlide.get(element.slideId),
      'NODESLIDE_NODEBOOK_ELEMENT_SCOPE_MISMATCH',
    ).push(element);
  }

  const artifacts: NodeBookSurfaceSnapshot['artifacts'][number][] = [];
  const artifactByElementId = new Map<string, string>();
  for (const slide of slides) {
    const slideElements = requiredBucket(
      elementsBySlide.get(slide.id),
      'NODESLIDE_NODEBOOK_SLIDE_BUCKET_MISSING',
    );
    const representatives = new Map<string, (typeof slideElements)[number]>();
    for (const element of slideElements) {
      const binding = element.artifactBinding;
      if (binding?.role === 'graph-node' && !representatives.has(binding.artifactId)) {
        representatives.set(binding.artifactId, element);
      }
    }
    if (artifacts.length + representatives.size > MAX_SURFACE_ARTIFACTS) {
      throw new Error('NODESLIDE_NODEBOOK_ARTIFACT_LIMIT');
    }
    for (const representative of representatives.values()) {
      const projection = projectSelectedGraphToNodeBook(slide, slideElements, [representative]);
      if (projection.status !== 'ready') continue;
      const contentHash = sha256Hex(projection.artifact.payload);
      artifacts.push({
        workspaceId: workspace.deck.id,
        rootId,
        artifactId: projection.artifact.artifactId,
        kind: projection.artifact.kind,
        format: projection.artifact.format,
        title: projection.artifact.title,
        canonicalVersion: projection.artifact.version,
        contentHash,
        payload: projection.artifact.payload,
      });
      artifactByElementId.set(representative.id, projection.artifact.artifactId);
    }
  }
  const nativeArtifactIds = new Set(artifacts.map((artifact) => artifact.artifactId));
  if (
    portableArtifacts.some((artifact) => nativeArtifactIds.has(artifact.artifactId)) ||
    new Set(portableArtifacts.map((artifact) => artifact.artifactId)).size !==
      portableArtifacts.length
  ) {
    throw new Error('NODESLIDE_NODEBOOK_ARTIFACT_ID_CONFLICT');
  }
  if (artifacts.length + portableArtifacts.length > MAX_SURFACE_ARTIFACTS) {
    throw new Error('NODESLIDE_NODEBOOK_ARTIFACT_LIMIT');
  }
  artifacts.push(...portableArtifacts);

  const orderedElements = slides.flatMap((slide) =>
    [
      ...requiredBucket(elementsBySlide.get(slide.id), 'NODESLIDE_NODEBOOK_SLIDE_BUCKET_MISSING'),
    ].sort(
      (left, right) =>
        slide.elementOrder.indexOf(left.id) - slide.elementOrder.indexOf(right.id) ||
        left.id.localeCompare(right.id),
    ),
  );
  return {
    workspaceId: workspace.deck.id,
    rootId,
    canonicalVersion: Math.max(
      workspace.deck.version,
      ...slides.map((slide) => slide.version),
      ...orderedElements.map((element) => element.version),
      ...portableArtifacts.map((artifact) => artifact.canonicalVersion),
    ),
    nodes: [
      {
        id: rootId,
        version: Math.max(1, workspace.deck.version),
        content: [{ type: 'text', value: boundedLabel(workspace.deck.title, 'Untitled deck') }],
        accessMode: 'read',
        isPublic: false,
      },
      ...slides.map((slide) => ({
        id: `slide:${slide.id}`,
        version: Math.max(1, slide.version),
        content: [{ type: 'text' as const, value: boundedLabel(slide.title, 'Untitled slide') }],
        accessMode: 'read' as const,
        isPublic: false,
      })),
      ...orderedElements.map((element) => ({
        id: `element:${element.id}`,
        version: Math.max(1, element.version),
        content: [
          {
            type: 'text' as const,
            value: boundedLabel(
              element.content ?? element.name,
              element.name || 'Untitled element',
            ),
          },
        ],
        accessMode: 'read' as const,
        isPublic: false,
        artifactId: artifactByElementId.get(element.id),
      })),
      ...portableArtifacts.map((artifact, index) => ({
        id: `nodebook-portable:${String(index).padStart(4, '0')}`,
        version: Math.max(1, artifact.canonicalVersion),
        content: [
          { type: 'text' as const, value: boundedLabel(artifact.title, 'Untitled artifact') },
        ],
        accessMode: 'read' as const,
        isPublic: false,
        artifactId: artifact.artifactId,
      })),
    ],
    relations: [
      ...slides.map((slide, index) => ({
        id: `deck-slide:${slide.id}`,
        version: 1,
        fromId: rootId,
        toId: `slide:${slide.id}`,
        relationTypeId: 'contains',
        isPublic: false,
        orderKey: String(index).padStart(6, '0'),
      })),
      ...orderedElements.map((element, index) => ({
        id: `slide-element:${element.id}`,
        version: 1,
        fromId: `slide:${element.slideId}`,
        toId: `element:${element.id}`,
        relationTypeId: 'contains',
        isPublic: false,
        orderKey: String(index).padStart(6, '0'),
      })),
      ...portableArtifacts.map((_, index) => ({
        id: `deck-portable:${String(index).padStart(4, '0')}`,
        version: 1,
        fromId: rootId,
        toId: `nodebook-portable:${String(index).padStart(4, '0')}`,
        relationTypeId: 'contains',
        isPublic: false,
        orderKey: `portable-${String(index).padStart(6, '0')}`,
      })),
    ],
    artifacts,
  };
}

class NodeBookHostErrorBoundary extends Component<
  {
    resetWorkspace: NodeSlideWorkspace;
    resetArtifacts: readonly NodeBookArtifact[];
    children: ReactNode;
  },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidUpdate(
    previous: Readonly<{
      resetWorkspace: NodeSlideWorkspace;
      resetArtifacts: readonly NodeBookArtifact[];
    }>,
  ) {
    if (
      (previous.resetWorkspace !== this.props.resetWorkspace ||
        previous.resetArtifacts !== this.props.resetArtifacts) &&
      this.state.error
    )
      this.setState({ error: null });
  }
  render() {
    if (this.state.error)
      return (
        <div
          role="alert"
          data-nodebook-host-error
        >{`NodeBook preview unavailable: ${this.state.error.message.slice(0, 300)}`}</div>
      );
    return this.props.children;
  }
}

function NodeSlideNodeBookWorkspacePanelInner({
  workspace,
  portableArtifacts,
}: { workspace: NodeSlideWorkspace; portableArtifacts: readonly NodeBookArtifact[] }) {
  const snapshot = useMemo(
    () => projectNodeSlideWorkspaceToNodeBook(workspace, portableArtifacts),
    [portableArtifacts, workspace],
  );
  const repository = useMemo<NodeBookSurfaceRepository>(
    () => ({
      async loadSurface(input) {
        if (input.workspaceId !== workspace.deck.id || input.rootId !== snapshot.rootId) {
          return readOnlyFailure(
            'NODESLIDE_NODEBOOK_SCOPE_MISMATCH',
            'The requested NodeBook surface does not belong to this deck.',
          );
        }
        return snapshot;
      },
      subscribeSurface() {
        return () => {};
      },
      async applySurfaceTransaction(): Promise<NodeBookMutationResult> {
        return readOnlyFailure(
          'NODESLIDE_NODEBOOK_READ_ONLY',
          'Edit through NodeSlide so deck CAS, validation, and review remain authoritative.',
        );
      },
    }),
    [snapshot, workspace.deck.id],
  );
  return (
    <div data-nodebook-host="nodeslide-workspace" data-nodebook-workspace-id={workspace.deck.id}>
      <NodeBookProvider
        scope={{ workspaceId: workspace.deck.id, rootId: snapshot.rootId }}
        repository={repository}
        initialSnapshot={snapshot}
      >
        <NodeBookSurface />
      </NodeBookProvider>
    </div>
  );
}

export function NodeSlideNodeBookWorkspacePanel({
  workspace,
  portableArtifacts = [],
}: { workspace: NodeSlideWorkspace; portableArtifacts?: readonly NodeBookArtifact[] }) {
  return (
    <NodeBookHostErrorBoundary resetWorkspace={workspace} resetArtifacts={portableArtifacts}>
      <NodeSlideNodeBookWorkspacePanelInner
        workspace={workspace}
        portableArtifacts={portableArtifacts}
      />
    </NodeBookHostErrorBoundary>
  );
}
