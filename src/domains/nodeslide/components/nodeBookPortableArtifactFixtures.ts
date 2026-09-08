import type { NodeBookArtifact } from '@nodebook/contracts';

export type NodeBookPortableArtifactFixture = Pick<
  NodeBookArtifact,
  'artifactId' | 'format' | 'kind' | 'payload' | 'title'
>;

export const NODEBOOK_PORTABLE_ARTIFACT_FIXTURES = [
  {
    artifactId: 'portable-mindmap',
    kind: 'mindmap',
    format: 'structured-json',
    title: 'Mind map',
    payload: JSON.stringify({
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
  },
  {
    artifactId: 'portable-flow',
    kind: 'flow',
    format: 'structured-json',
    title: 'Structured flow',
    payload: JSON.stringify({
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
  },
  {
    artifactId: 'portable-chart',
    kind: 'chart',
    format: 'vega-lite-json',
    title: 'Vega-Lite chart',
    payload: JSON.stringify({
      data: { values: [{ label: 'Proof', value: 8 }] },
      mark: 'bar',
      encoding: {
        x: { field: 'label', type: 'nominal' },
        y: { field: 'value', type: 'quantitative' },
      },
    }),
  },
  {
    artifactId: 'portable-drawio',
    kind: 'drawio',
    format: 'drawio-xml',
    title: 'Draw.io diagram',
    payload:
      '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="a" value="Evidence" vertex="1" parent="1"><mxGeometry x="20" y="20" width="120" height="50"/></mxCell></root></mxGraphModel>',
  },
  {
    artifactId: 'portable-mermaid',
    kind: 'mermaid',
    format: 'mermaid',
    title: 'Mermaid diagram',
    payload: 'flowchart LR\nEvidence-->Decision',
  },
  {
    artifactId: 'portable-infographic',
    kind: 'infographic',
    format: 'infographic-json',
    title: 'Infographic',
    payload: JSON.stringify({
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
  },
] as const satisfies readonly NodeBookPortableArtifactFixture[];
