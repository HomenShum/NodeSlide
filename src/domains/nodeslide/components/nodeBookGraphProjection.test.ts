import { describe, expect, it } from 'vitest';

import type { Slide, SlideElement } from '../../../../shared/nodeslide';
import { projectSelectedGraphToNodeBook } from './nodeBookGraphProjection';

const slide: Slide = {
  id: 'slide-architecture',
  deckId: 'deck-risk-review',
  title: 'Risk committee evidence flow',
  background: '#ffffff',
  elementOrder: [],
  version: 7,
};

function graphElement(
  id: string,
  binding: NonNullable<SlideElement['artifactBinding']>,
  content = id,
): SlideElement {
  return {
    id,
    slideId: slide.id,
    name: content,
    kind: binding.role === 'graph-node' ? 'shape' : 'connector',
    bbox: { x: 0, y: 0, width: 0.1, height: 0.1 },
    rotation: 0,
    content,
    style: {},
    sourceIds: [],
    locked: false,
    exportCapabilities: [],
    version: 3,
    artifactBinding: binding,
  } as SlideElement;
}

function node(id: string, nodeId = id): SlideElement {
  return graphElement(id, {
    schemaVersion: 'nodeslide.production-artifact-binding/v1',
    artifactId: 'architecture-1',
    role: 'graph-node',
    graphKind: 'architecture',
    nodeId,
    nodeKind: 'system',
  });
}

function edge(id: string, from: string, to: string): SlideElement {
  return graphElement(id, {
    schemaVersion: 'nodeslide.production-artifact-binding/v1',
    artifactId: 'architecture-1',
    role: 'graph-edge',
    graphKind: 'architecture',
    from,
    to,
    label: 'grounds',
  });
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Scenario fixture is incomplete');
  return value;
}

describe('NodeSlide graph projection into shared NodeBook', () => {
  it('lets an analyst inspect the same canonical graph as a deterministic structured diagram', () => {
    const elements = [node('claim'), edge('grounds', 'evidence', 'claim'), node('evidence')];
    const first = projectSelectedGraphToNodeBook(slide, elements, [required(elements[0])]);
    const reordered = projectSelectedGraphToNodeBook(slide, [...elements].reverse(), [
      required(elements[0]),
    ]);

    expect(first.status).toBe('ready');
    expect(reordered.status).toBe('ready');
    if (first.status !== 'ready' || reordered.status !== 'ready') return;
    expect(first.artifact.payload).toBe(reordered.artifact.payload);
    expect(JSON.parse(first.artifact.payload)).toMatchObject({
      schemaVersion: 'nodekit.diagram/v1',
      diagramType: 'flow',
      layout: { direction: 'TB', seed: 'nodeslide-nodebook-projection-v1' },
    });
    expect(first.artifact.version).toBe(7);
  });

  it('keeps an ordinary text selection on the existing Design inspector path', () => {
    const { artifactBinding: _binding, ...ordinaryFields } = node('ordinary');
    const ordinary = ordinaryFields as SlideElement;
    expect(projectSelectedGraphToNodeBook(slide, [ordinary], [ordinary])).toEqual({
      status: 'none',
    });
  });

  it('fails closed when a collaborator leaves an edge pointing at a deleted node', () => {
    const elements = [node('claim'), edge('orphan', 'missing', 'claim')];
    expect(projectSelectedGraphToNodeBook(slide, elements, [required(elements[0])])).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('endpoint is missing'),
    });
  });

  it('rejects an agent burst beyond the 200-node preview bound without truncating silently', () => {
    const elements = Array.from({ length: 201 }, (_, index) =>
      node(`node-${String(index).padStart(3, '0')}`),
    );
    expect(projectSelectedGraphToNodeBook(slide, elements, [required(elements[0])])).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('200-node'),
    });
  });

  it('rejects a collaborator burst at the 401st edge before sorting or rendering', () => {
    const nodes = [node('source'), node('target')];
    const edges = Array.from({ length: 401 }, (_, index) =>
      edge(`edge-${String(index).padStart(3, '0')}`, 'source', 'target'),
    );
    expect(
      projectSelectedGraphToNodeBook(slide, [...nodes, ...edges], [required(nodes[0])]),
    ).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('400-edge'),
    });
  });

  it('aborts a hostile accumulated deck before scanning or sorting beyond the 201st matching node', () => {
    const boundedPrefix = Array.from({ length: 201 }, (_, index) =>
      node(`hostile-${String(index).padStart(3, '0')}`),
    );
    const mustNotBeRead = {
      get slideId(): string {
        throw new Error('projection scanned beyond its rejection bound');
      },
    } as SlideElement;
    const hostile = [...boundedPrefix, mustNotBeRead, ...Array(9_798).fill(mustNotBeRead)];
    expect(
      projectSelectedGraphToNodeBook(slide, hostile, [required(boundedPrefix[0])]),
    ).toMatchObject({
      status: 'invalid',
      message: expect.stringContaining('200-node'),
    });
  });

  it('scopes identical slide and artifact IDs to different host-owned decks', () => {
    const elements = [node('evidence'), node('claim'), edge('grounds', 'evidence', 'claim')];
    const first = projectSelectedGraphToNodeBook(slide, elements, [required(elements[0])]);
    const second = projectSelectedGraphToNodeBook(
      { ...slide, deckId: 'deck-independent-review' },
      elements,
      [required(elements[0])],
    );
    expect(first.status).toBe('ready');
    expect(second.status).toBe('ready');
    if (first.status !== 'ready' || second.status !== 'ready') return;
    expect(first.artifact.artifactId).not.toBe(second.artifact.artifactId);
  });
});
