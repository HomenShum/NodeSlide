import {
  NODESLIDE_ARTIFACT_SPEC_VERSION,
  type NodeSlideCanonicalArtifactKind,
} from './nodeslideArtifactRegistry.js';

export const canonicalArtifactPayloadFixtures: Record<
  NodeSlideCanonicalArtifactKind,
  Record<string, unknown>
> = {
  generic: { label: 'Decision', displayValue: 'GO' },
  chart: {
    unit: '%',
    xAxis: { labels: ['A', 'B'] },
    yAxis: { min: 0, max: 100 },
    series: [{ id: 'activation', values: [42, 61] }],
  },
  waterfall: {
    unit: 'points',
    baseline: 50,
    deltas: [
      { label: 'Quality', value: 10 },
      { label: 'Repair', value: 5 },
    ],
    final: 65,
    tolerance: 0,
  },
  sankey: {
    unit: 'claims',
    nodes: [
      { id: 'source', label: 'Source', layer: 'source' },
      { id: 'review', label: 'Review', layer: 'middle' },
      { id: 'accepted', label: 'Accepted', layer: 'sink' },
    ],
    links: [
      { source: 'source', target: 'review', value: 8 },
      { source: 'review', target: 'accepted', value: 8 },
    ],
  },
  graph: {
    directed: true,
    graphKind: 'architecture',
    direction: 'horizontal',
    nodes: [
      { id: 'model', label: 'Model', kind: 'system' },
      { id: 'compiler', label: 'Compiler', kind: 'system' },
    ],
    edges: [{ id: 'edge-1', from: 'model', to: 'compiler', directed: true }],
  },
  'causal-loop': {
    nodes: [
      { id: 'trust', label: 'Trust' },
      { id: 'reuse', label: 'Reuse' },
    ],
    edges: [
      { id: 'edge-1', from: 'trust', to: 'reuse', directed: true, polarity: '+' },
      { id: 'edge-2', from: 'reuse', to: 'trust', directed: true, polarity: '+' },
    ],
    loops: [{ id: 'R1', type: 'reinforcing', edgeIds: ['edge-1', 'edge-2'] }],
  },
  timeline: {
    unit: 'day',
    events: [
      { id: 'brief', label: 'Brief', start: 1, end: 1 },
      { id: 'publish', label: 'Publish', start: 3, end: 3 },
    ],
  },
  gantt: {
    unit: 'week',
    tasks: [
      { id: 'spec', label: 'Spec', start: 1, end: 2, confidence: 0.9, dependsOn: [] },
      {
        id: 'proof',
        label: 'Proof',
        start: 2,
        end: 3,
        confidence: 0.8,
        dependsOn: ['spec'],
      },
    ],
  },
  'evidence-media': {
    mimeType: 'image/png',
    digest: `sha256:${'e'.repeat(64)}`,
    claimId: 'claim:evidence-media',
    altText: 'Bound screenshot evidence',
  },
  motion: {
    states: [
      { id: 'before', label: 'Before' },
      { id: 'after', label: 'After' },
    ],
    transition: 'step',
    staticFallbackStateId: 'after',
  },
  comparison: {
    metrics: [{ id: 'quality', unit: 'score' }],
    cohorts: [
      { id: 'a', status: 'observed', plotted: true, values: { quality: 72 } },
      { id: 'b', status: 'observed', plotted: true, values: { quality: 84 } },
    ],
  },
  equation: {
    expression: {
      op: 'divide',
      args: [
        { op: 'value', name: 'wins' },
        { op: 'value', name: 'runs' },
      ],
    },
    values: { wins: 8, runs: 10 },
    result: 0.8,
  },
  'runtime-proof': {
    sampleSize: 0,
    unit: 'ms',
    status: 'illustrative-not-measured',
  },
  trace: {
    traceId: 'trace-1',
    status: 'derived',
    spans: [
      { spanId: 'request', label: 'Request' },
      { spanId: 'compile', parentSpanId: 'request', label: 'Compile' },
    ],
  },
  'risk-matrix': {
    likelihoodAxis: { low: 'rare', high: 'likely' },
    impactAxis: { low: 'minor', high: 'critical' },
    risks: [{ id: 'stale', label: 'Stale socket', likelihood: 2, impact: 4 }],
  },
  'spatial-scene': {
    viewports: [
      { id: 'whole', level: 1 },
      {
        id: 'selected',
        level: 2,
        selectedNodeId: 'compiler',
        sourceIds: ['brief:prompt'],
      },
    ],
  },
};

export function canonicalArtifactFixture(kind: NodeSlideCanonicalArtifactKind) {
  return {
    schemaVersion: NODESLIDE_ARTIFACT_SPEC_VERSION,
    id: `fixture-${kind}`,
    kind,
    narrativeJob: `Prove ${kind} without inventing geometry.`,
    claimIds: [`claim:${kind}`],
    sourceIds: ['brief:prompt'],
    provenance: {
      truthState: 'derived' as const,
      rationale: 'The bounded creation brief supplies this fixture.',
      sourceRefs: ['brief:prompt'],
    },
    payload: canonicalArtifactPayloadFixtures[kind],
  };
}
