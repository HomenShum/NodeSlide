import type { NodeBookArtifactSurfaceProps } from '@nodebook/react';

import type { Slide, SlideElement } from '../../../../shared/nodeslide';

const MAX_NODEBOOK_GRAPH_NODES = 200;
const MAX_NODEBOOK_GRAPH_EDGES = 400;
const MAX_NODEBOOK_GRAPH_BYTES = 64 * 1024;

export type NodeBookGraphProjection =
  | { status: 'none' }
  | { status: 'invalid'; artifactId: string; message: string }
  | {
      status: 'ready';
      graphKind: 'process' | 'architecture' | 'timeline';
      artifact: NodeBookArtifactSurfaceProps;
    };

function boundedLabel(value: string, fallback: string, max = 500): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return (normalized || fallback).slice(0, max);
}

/**
 * Read-only host projection. NodeSlide remains canonical; NodeBook receives a bounded,
 * deterministic diagram snapshot for the graph artifact containing the primary selection.
 */
export function projectSelectedGraphToNodeBook(
  slide: Slide,
  slideElements: readonly SlideElement[],
  selectedElements: readonly SlideElement[],
): NodeBookGraphProjection {
  const selected = selectedElements.at(-1);
  const selectedBinding = selected?.artifactBinding;
  if (!selected || !selectedBinding || selected.slideId !== slide.id) return { status: 'none' };

  const artifactId = selectedBinding.artifactId;
  const graphKind = selectedBinding.graphKind;
  const members: SlideElement[] = [];
  const nodeMembers: SlideElement[] = [];
  const edgeMembers: SlideElement[] = [];
  for (const element of slideElements) {
    const binding = element.artifactBinding;
    if (element.slideId !== slide.id || binding?.artifactId !== artifactId) continue;
    if (binding.graphKind !== graphKind) {
      return {
        status: 'invalid',
        artifactId,
        message: 'This artifact mixes graph kinds, so NodeBook will not render a misleading view.',
      };
    }
    members.push(element);
    if (binding.role === 'graph-node') {
      nodeMembers.push(element);
      if (nodeMembers.length > MAX_NODEBOOK_GRAPH_NODES) {
        return {
          status: 'invalid',
          artifactId,
          message: `This graph exceeds the ${MAX_NODEBOOK_GRAPH_NODES}-node preview bound.`,
        };
      }
    } else {
      edgeMembers.push(element);
      if (edgeMembers.length > MAX_NODEBOOK_GRAPH_EDGES) {
        return {
          status: 'invalid',
          artifactId,
          message: `This graph exceeds the ${MAX_NODEBOOK_GRAPH_EDGES}-edge preview bound.`,
        };
      }
    }
  }
  if (nodeMembers.length === 0) {
    return { status: 'invalid', artifactId, message: 'This graph has no bound nodes.' };
  }

  const orderedNodes = [...nodeMembers].sort((left, right) => {
    const leftId = left.artifactBinding?.role === 'graph-node' ? left.artifactBinding.nodeId : '';
    const rightId =
      right.artifactBinding?.role === 'graph-node' ? right.artifactBinding.nodeId : '';
    return leftId.localeCompare(rightId) || left.id.localeCompare(right.id);
  });
  const projectedIds = new Map<string, string>();
  const nodes = orderedNodes.map((element, index) => {
    const binding = element.artifactBinding;
    if (!binding || binding.role !== 'graph-node') throw new Error('unreachable graph node');
    if (projectedIds.has(binding.nodeId)) return null;
    const projectedId = `n-${String(index + 1).padStart(3, '0')}`;
    projectedIds.set(binding.nodeId, projectedId);
    return {
      id: projectedId,
      label: boundedLabel(element.content ?? element.name, element.name),
      sourceBindingId: element.id.slice(0, 2_048),
    };
  });
  if (nodes.some((node) => node === null)) {
    return { status: 'invalid', artifactId, message: 'This graph contains duplicate node IDs.' };
  }

  const edges = edgeMembers
    .map((element) => {
      const binding = element.artifactBinding;
      if (!binding || binding.role !== 'graph-edge') throw new Error('unreachable graph edge');
      return { element, binding };
    })
    .sort(
      (left, right) =>
        left.binding.from.localeCompare(right.binding.from) ||
        left.binding.to.localeCompare(right.binding.to) ||
        left.element.id.localeCompare(right.element.id),
    )
    .map(({ binding }, index) => {
      const from = projectedIds.get(binding.from);
      const to = projectedIds.get(binding.to);
      if (!from || !to) return null;
      return {
        id: `e-${String(index + 1).padStart(3, '0')}`,
        from,
        to,
        ...(binding.label ? { label: boundedLabel(binding.label, '', 200) } : {}),
      };
    });
  if (edges.some((edge) => edge === null)) {
    return {
      status: 'invalid',
      artifactId,
      message: 'This graph contains an edge whose endpoint is missing.',
    };
  }

  const payload = JSON.stringify({
    schemaVersion: 'nodekit.diagram/v1',
    diagramType: 'flow',
    title: boundedLabel(slide.title, 'NodeSlide graph'),
    nodes,
    edges,
    groups: [],
    layout: {
      direction: graphKind === 'architecture' ? 'TB' : 'LR',
      seed: 'nodeslide-nodebook-projection-v1',
    },
  });
  if (new TextEncoder().encode(payload).byteLength > MAX_NODEBOOK_GRAPH_BYTES) {
    return {
      status: 'invalid',
      artifactId,
      message: 'This graph exceeds the 64 KiB NodeBook preview payload bound.',
    };
  }

  return {
    status: 'ready',
    graphKind,
    artifact: {
      artifactId: `nodeslide:${slide.deckId}:${slide.id}:${artifactId}`,
      kind: 'flow',
      format: 'structured-json',
      payload,
      title: boundedLabel(`${slide.title} ? ${graphKind}`, 'NodeSlide graph'),
      version: Math.max(slide.version, ...members.map((element) => element.version)),
    },
  };
}
