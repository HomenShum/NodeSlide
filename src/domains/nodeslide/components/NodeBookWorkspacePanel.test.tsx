import type { NodeBookArtifact } from '@nodebook/contracts';
import { createNodeBookSurfaceModel } from '@nodebook/model';
import { loadArtifactPlugin } from '@nodebook/react';
// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildGoldenNodeSlide } from '../../../../convex/lib/nodeslideSeed';
import type { NodeSlideWorkspace, SlideElement } from '../../../../shared/nodeslide';
import { sha256Hex } from '../signature/packs/encoding';
import {
  NodeSlideNodeBookWorkspacePanel,
  projectNodeSlideWorkspaceToNodeBook,
} from './NodeBookWorkspacePanel';

afterEach(cleanup);
beforeAll(() => {
  Object.defineProperty(SVGElement.prototype, 'getComputedTextLength', {
    configurable: true,
    value() {
      return (this.textContent?.length ?? 0) * 7;
    },
  });
  Object.defineProperty(SVGElement.prototype, 'getBBox', {
    configurable: true,
    value() {
      return { x: 0, y: 0, width: (this.textContent?.length ?? 0) * 7, height: 16 };
    },
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value() {
      return { measureText: (value: string) => ({ width: value.length * 7 }) };
    },
  });
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Scenario fixture is incomplete');
  return value;
}

function workspaceFixture(): NodeSlideWorkspace {
  const { snapshot } = buildGoldenNodeSlide('nodebook-workspace-proof', 1_000);
  const slide = required(snapshot.slides[0]);
  const members = snapshot.elements.slice(0, 3).map((element) => structuredClone(element));
  const [first, second, edge] = members as [SlideElement, SlideElement, SlideElement];
  first.slideId = slide.id;
  first.kind = 'shape';
  first.content = 'Evidence';
  first.artifactBinding = {
    schemaVersion: 'nodeslide.production-artifact-binding/v1',
    artifactId: 'decision-flow',
    role: 'graph-node',
    graphKind: 'process',
    nodeId: 'evidence',
  };
  second.slideId = slide.id;
  second.kind = 'shape';
  second.content = 'Decision';
  second.artifactBinding = {
    schemaVersion: 'nodeslide.production-artifact-binding/v1',
    artifactId: 'decision-flow',
    role: 'graph-node',
    graphKind: 'process',
    nodeId: 'decision',
  };
  edge.slideId = slide.id;
  edge.kind = 'connector';
  edge.artifactBinding = {
    schemaVersion: 'nodeslide.production-artifact-binding/v1',
    artifactId: 'decision-flow',
    role: 'graph-edge',
    graphKind: 'process',
    from: 'evidence',
    to: 'decision',
  };
  return {
    ...snapshot,
    elements: members,
    comments: [],
    patches: [],
    versions: [],
    traces: [],
    validations: [],
    exports: [],
    presence: [],
    publication: null,
  };
}

describe('NodeSlide full shared NodeBook workspace', () => {
  it('lets a reviewer navigate deck ? slide ? elements and render the canonical graph artifact', async () => {
    const workspace = workspaceFixture();
    const snapshot = projectNodeSlideWorkspaceToNodeBook(workspace);
    const model = createNodeBookSurfaceModel(snapshot);
    expect(model.childrenOf(`deck:${workspace.deck.id}`)).toHaveLength(workspace.slides.length);
    expect(model.snapshot.artifacts).toHaveLength(1);
    expect(model.snapshot.artifacts[0]).toMatchObject({ kind: 'flow', format: 'structured-json' });

    const view = render(<NodeSlideNodeBookWorkspacePanel workspace={workspace} />);
    expect(view.container.querySelector('[data-nodebook-host="nodeslide-workspace"]')).toBeTruthy();
    expect(view.container.querySelector('[data-nodebook-surface="workspace"]')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    const graphNode = view.container.querySelector<HTMLButtonElement>(
      `[data-nodebook-node-id="element:${required(workspace.elements[0]).id}"]`,
    );
    expect(graphNode).toBeTruthy();
    required(graphNode ?? undefined).click();
    await waitFor(() =>
      expect(view.container.querySelector('[data-nodebook-artifact-rendered] svg')).toBeTruthy(),
    );
  });

  it('fails closed for a foreign slide or production-scale node overflow', () => {
    const foreign = workspaceFixture();
    foreign.slides[0] = { ...required(foreign.slides[0]), deckId: 'another-deck' };
    expect(() => projectNodeSlideWorkspaceToNodeBook(foreign)).toThrow(
      'NODESLIDE_NODEBOOK_DECK_SCOPE_MISMATCH',
    );

    const overflow = workspaceFixture();
    const base = required(overflow.elements[0]);
    const { artifactBinding: _artifactBinding, ...ordinaryBase } = base;
    overflow.elements = Array.from({ length: 4_999 }, (_, index) => ({
      ...ordinaryBase,
      id: `scale-element-${index}`,
    }));
    expect(() => projectNodeSlideWorkspaceToNodeBook(overflow)).toThrow(
      'NODESLIDE_NODEBOOK_NODE_LIMIT',
    );
  });

  it('contains a foreign deck projection as an honest inspector alert instead of crashing NodeSlide', () => {
    const foreign = workspaceFixture();
    foreign.slides[0] = { ...required(foreign.slides[0]), deckId: 'another-deck' };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const view = render(<NodeSlideNodeBookWorkspacePanel workspace={foreign} />);
    expect(view.getByRole('alert').textContent).toContain('NODESLIDE_NODEBOOK_DECK_SCOPE_MISMATCH');
    expect(view.container.querySelector('[data-nodebook-host-error]')).toBeTruthy();
    consoleError.mockRestore();
  });

  it('projects a near-limit sustained deck without losing slide ownership', () => {
    const workspace = workspaceFixture();
    const seedSlide = required(workspace.slides[0]);
    workspace.slides = Array.from({ length: 100 }, (_, index) => ({
      ...seedSlide,
      id: `scale-slide-${index}`,
      deckId: workspace.deck.id,
      elementOrder: [],
    }));
    const base = required(workspace.elements[0]);
    const { artifactBinding: _artifactBinding, ...ordinaryBase } = base;
    workspace.elements = Array.from({ length: 4_899 }, (_, index) => {
      const slide = required(workspace.slides[index % workspace.slides.length]);
      const element = { ...ordinaryBase, id: `scale-element-${index}`, slideId: slide.id };
      slide.elementOrder.push(element.id);
      return element;
    });
    const snapshot = projectNodeSlideWorkspaceToNodeBook(workspace);
    expect(snapshot.nodes).toHaveLength(5_000);
    expect(snapshot.relations).toHaveLength(4_999);
    expect(new Set(snapshot.nodes.slice(101).map((node) => node.id)).size).toBe(4_899);
  });

  it('renders all six portable NodeBook visual kinds inside the real NodeSlide host mount', async () => {
    const workspace = workspaceFixture();
    const rootId = `deck:${workspace.deck.id}`;
    const sources = [
      [
        'mindmap',
        'structured-json',
        JSON.stringify({
          schemaVersion: 'nodekit.diagram/v1',
          diagramType: 'mindmap',
          nodes: [
            { id: 'root', label: 'Decision' },
            { id: 'proof', label: 'Proof', parentId: 'root' },
          ],
          edges: [{ id: 'edge', from: 'root', to: 'proof' }],
          groups: [],
          layout: { direction: 'LR', seed: 'proof' },
        }),
      ],
      [
        'flow',
        'structured-json',
        JSON.stringify({
          schemaVersion: 'nodekit.diagram/v1',
          diagramType: 'flow',
          nodes: [
            { id: 'draft', label: 'Draft' },
            { id: 'review', label: 'Review' },
          ],
          edges: [{ id: 'edge', from: 'draft', to: 'review' }],
          groups: [],
          layout: { direction: 'LR', seed: 'proof' },
        }),
      ],
      [
        'chart',
        'vega-lite-json',
        JSON.stringify({
          data: { values: [{ label: 'Proof', value: 8 }] },
          mark: 'bar',
          encoding: {
            x: { field: 'label', type: 'nominal' },
            y: { field: 'value', type: 'quantitative' },
          },
        }),
      ],
      [
        'drawio',
        'drawio-xml',
        '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Evidence" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="50"/></mxCell></root></mxGraphModel>',
      ],
      ['mermaid', 'mermaid', 'flowchart LR\nEvidence-->Decision'],
      [
        'infographic',
        'infographic-json',
        JSON.stringify({
          schemaVersion: 'nodekit.infographic/v1',
          canvas: { width: 960, columns: 2 },
          theme: {
            background: '#f8fafc',
            surface: '#ffffff',
            text: '#0f172a',
            muted: '#64748b',
            accent: '#2563eb',
          },
          title: 'Evidence brief',
          sections: [{ id: 'metric', type: 'metric', title: 'Reviewed', value: 42 }],
        }),
      ],
    ] as const;
    // The six plugins are independent and the scenario is explicitly bounded to
    // the portable-format contract, so warm them concurrently like a host would.
    const portableArtifacts: NodeBookArtifact[] = await Promise.all(
      sources.map(async ([kind, format, payload]) => {
        const canonical = await (await loadArtifactPlugin(kind)).validatePayload(payload);
        return {
          workspaceId: workspace.deck.id,
          rootId,
          artifactId: `portable-${kind}`,
          kind,
          format,
          title: `Portable ${kind}`,
          canonicalVersion: 1,
          contentHash: sha256Hex(canonical),
          payload,
        };
      }),
    );
    const view = render(
      <NodeSlideNodeBookWorkspacePanel
        workspace={workspace}
        portableArtifacts={portableArtifacts}
      />,
    );
    expect(
      projectNodeSlideWorkspaceToNodeBook(workspace, portableArtifacts).artifacts.map(
        (artifact) => artifact.kind,
      ),
    ).toEqual(
      expect.arrayContaining(['mindmap', 'flow', 'chart', 'drawio', 'mermaid', 'infographic']),
    );
    for (let index = 0; index < portableArtifacts.length; index += 1) {
      required(
        view.container.querySelector<HTMLButtonElement>(
          `[data-nodebook-node-id="nodebook-portable:${String(index).padStart(4, '0')}"]`,
        ) ?? undefined,
      ).click();
      await waitFor(
        () =>
          expect(
            view.container.querySelector(
              `[data-nodebook-artifact-kind="${required(portableArtifacts[index]).kind}"] [data-nodebook-artifact-rendered] svg`,
            ),
          ).toBeTruthy(),
        { timeout: 15_000 },
      );
    }
  }, 60_000);
});
