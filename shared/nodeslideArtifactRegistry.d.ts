export const NODESLIDE_ARTIFACT_SPEC_VERSION: 'nodeslide.artifact-spec/v1';
export const NODESLIDE_LEGACY_AUTHORED_ARTIFACT_VERSION: 'nodeslide.production-authored-artifact/v1';

export const NODESLIDE_CANONICAL_ARTIFACT_KINDS: readonly [
  'generic',
  'chart',
  'waterfall',
  'sankey',
  'graph',
  'causal-loop',
  'timeline',
  'gantt',
  'evidence-media',
  'motion',
  'comparison',
  'equation',
  'runtime-proof',
  'trace',
  'risk-matrix',
  'spatial-scene',
];

export const NODESLIDE_CANONICAL_TRUTH_STATES: readonly [
  'observed',
  'derived',
  'estimated',
  'illustrative',
  'missing',
  'not-run',
];

export type NodeSlideCanonicalArtifactKind = (typeof NODESLIDE_CANONICAL_ARTIFACT_KINDS)[number];
export type NodeSlideCanonicalTruthState = (typeof NODESLIDE_CANONICAL_TRUTH_STATES)[number];

export interface NodeSlideCanonicalArtifactValidationOptions {
  now?: number;
  allowedSourceRefs?: readonly string[];
  allowedTruthStatesBySourceRef?: Readonly<Record<string, readonly NodeSlideCanonicalTruthState[]>>;
  allowedSourceUrlsBySourceRef?: Readonly<Record<string, string>>;
  allowedReceiptDigestsBySourceRef?: Readonly<Record<string, readonly string[]>>;
}

export interface NodeSlideCanonicalArtifactProvenance {
  truthState: NodeSlideCanonicalTruthState;
  rationale: string;
  sourceRefs: string[];
  status?: NodeSlideCanonicalTruthState;
  sourceDigest?: string;
  assumptions?: string[];
}

export interface NodeSlideCanonicalArtifactBase<K extends NodeSlideCanonicalArtifactKind, P> {
  schemaVersion: typeof NODESLIDE_ARTIFACT_SPEC_VERSION;
  id: string;
  kind: K;
  narrativeJob: string;
  claimIds: string[];
  sourceIds: string[];
  provenance: NodeSlideCanonicalArtifactProvenance;
  payload: P;
  accessibility?: Record<string, unknown>;
  browserContract?: string;
  pptxContract?: string;
  specDigest?: string;
  [key: string]: unknown;
}

export interface NodeSlideArtifactExpression {
  op: 'value' | 'add' | 'subtract' | 'multiply' | 'divide';
  name?: string;
  args?: NodeSlideArtifactExpression[];
}

export type NodeSlideGenericArtifactSpec = NodeSlideCanonicalArtifactBase<
  'generic',
  Record<string, unknown> & { label?: string; displayValue?: string }
>;
export type NodeSlideChartArtifactSpec = NodeSlideCanonicalArtifactBase<
  'chart',
  {
    unit: string;
    xAxis: { labels: string[] };
    yAxis: { min: number; max: number };
    missingValuePolicy?: string;
    series: Array<{
      id: string;
      values: Array<number | null>;
      status?: string;
      uncertainty?: { lower: Array<number | null>; upper: Array<number | null> };
    }>;
  }
>;
export type NodeSlideWaterfallArtifactSpec = NodeSlideCanonicalArtifactBase<
  'waterfall',
  {
    unit: string;
    baseline: number;
    deltas: Array<{ label: string; value: number }>;
    final: number;
    tolerance?: number;
  }
>;
export type NodeSlideSankeyArtifactSpec = NodeSlideCanonicalArtifactBase<
  'sankey',
  {
    unit: string;
    tolerance?: number;
    nodes: Array<{ id: string; label?: string; layer?: string }>;
    links: Array<{ source: string; target: string; value: number }>;
  }
>;
export type NodeSlideGraphArtifactSpec = NodeSlideCanonicalArtifactBase<
  'graph',
  {
    directed?: boolean;
    graphKind?: 'process' | 'architecture' | 'timeline';
    direction?: 'horizontal' | 'vertical';
    nodes: Array<{
      id: string;
      label?: string;
      kind?: 'step' | 'system' | 'decision' | 'milestone';
    }>;
    edges: Array<{ id?: string; from: string; to: string; directed?: boolean; label?: string }>;
  }
>;
export type NodeSlideCausalLoopArtifactSpec = NodeSlideCanonicalArtifactBase<
  'causal-loop',
  Omit<NodeSlideGraphArtifactSpec['payload'], 'edges'> & {
    loops: Array<{
      id: string;
      type: 'reinforcing' | 'balancing';
      edgeIds: string[];
    }>;
    edges: Array<{
      id: string;
      from: string;
      to: string;
      directed: true;
      polarity: '+' | '-';
      label?: string;
    }>;
  }
>;
export interface NodeSlideArtifactInterval {
  id: string;
  label?: string;
  start: number;
  end: number;
}
export type NodeSlideTimelineArtifactSpec = NodeSlideCanonicalArtifactBase<
  'timeline',
  { unit: string; events: NodeSlideArtifactInterval[] }
>;
export type NodeSlideGanttArtifactSpec = NodeSlideCanonicalArtifactBase<
  'gantt',
  {
    unit: string;
    tasks: Array<NodeSlideArtifactInterval & { confidence: number; dependsOn?: string[] }>;
  }
>;
export type NodeSlideEvidenceMediaArtifactSpec = NodeSlideCanonicalArtifactBase<
  'evidence-media',
  {
    mimeType: 'application/pdf' | 'image/png' | 'image/jpeg' | 'text/html';
    digest: string;
    claimId: string;
    sourceUrl?: string;
    page?: number;
    region?: { x: number; y: number; width: number; height: number };
    captureVersion?: string;
    altText?: string;
  }
>;
export type NodeSlideMotionArtifactSpec = NodeSlideCanonicalArtifactBase<
  'motion',
  {
    states: Array<{ id: string; label?: string }>;
    transition?: string;
    staticFallbackStateId: string;
  }
>;
export type NodeSlideComparisonArtifactSpec = NodeSlideCanonicalArtifactBase<
  'comparison',
  {
    comparisonType?: string;
    metrics: Array<{ id: string; unit: string }>;
    cohorts: Array<{
      id: string;
      label?: string;
      status: string;
      plotted?: boolean;
      values: Record<string, number>;
    }>;
  }
>;
export type NodeSlideEquationArtifactSpec = NodeSlideCanonicalArtifactBase<
  'equation',
  {
    expression: NodeSlideArtifactExpression;
    values: Record<string, number>;
    result: number;
    tolerance?: number;
    rounding?: number;
    renderedExpression?: string;
    syntax?: 'plain' | 'latex';
  }
>;
export type NodeSlideRuntimeProofArtifactSpec = NodeSlideCanonicalArtifactBase<
  'runtime-proof',
  { sampleSize: number; unit: string; receiptDigest?: string; status: string }
>;
export type NodeSlideTraceArtifactSpec = NodeSlideCanonicalArtifactBase<
  'trace',
  {
    traceId: string;
    spans: Array<{ spanId: string; parentSpanId?: string; label?: string }>;
    status: string;
  }
>;
export type NodeSlideRiskMatrixArtifactSpec = NodeSlideCanonicalArtifactBase<
  'risk-matrix',
  {
    likelihoodAxis: { low: string; high: string };
    impactAxis: { low: string; high: string };
    risks: Array<{ id: string; label?: string; likelihood: number; impact: number }>;
  }
>;
export type NodeSlideSpatialSceneArtifactSpec = NodeSlideCanonicalArtifactBase<
  'spatial-scene',
  {
    viewports: Array<{
      id: string;
      level?: number;
      selectedNodeId?: string;
      sourceIds?: string[];
    }>;
  }
>;

export type NodeSlideCanonicalArtifactSpec =
  | NodeSlideGenericArtifactSpec
  | NodeSlideChartArtifactSpec
  | NodeSlideWaterfallArtifactSpec
  | NodeSlideSankeyArtifactSpec
  | NodeSlideGraphArtifactSpec
  | NodeSlideCausalLoopArtifactSpec
  | NodeSlideTimelineArtifactSpec
  | NodeSlideGanttArtifactSpec
  | NodeSlideEvidenceMediaArtifactSpec
  | NodeSlideMotionArtifactSpec
  | NodeSlideComparisonArtifactSpec
  | NodeSlideEquationArtifactSpec
  | NodeSlideRuntimeProofArtifactSpec
  | NodeSlideTraceArtifactSpec
  | NodeSlideRiskMatrixArtifactSpec
  | NodeSlideSpatialSceneArtifactSpec;

export interface NodeSlideCanonicalArtifactIssue {
  code: string;
  severity: 'error';
  message: string;
  path: string;
  repair: { operation: 'replace' | 'remove'; path: string };
}

export interface NodeSlideArtifactCompilerDescriptor {
  primitive: 'statement' | 'chart' | 'diagram' | 'image' | 'formula' | 'metric';
  mode: 'native' | 'semantic-adapter' | 'summary-fallback' | 'static-fallback';
  browserContract: 'semantic' | 'declared-static-fallback';
  pptxContract: 'editable' | 'declared-static-fallback';
  editability: 'native' | 'grouped-editable' | 'static-fallback';
  knownFidelityDifferences: string[];
}

export const NODESLIDE_ARTIFACT_COMPILER_REGISTRY: Readonly<
  Record<NodeSlideCanonicalArtifactKind, NodeSlideArtifactCompilerDescriptor>
>;

export function isNodeSlideSha256Digest(value: unknown): value is string;
export function isSafeNodeSlideArtifactSourceUrl(value: unknown): value is string;

export function validateNodeSlideCanonicalArtifactSpec(
  value: unknown,
  options?: NodeSlideCanonicalArtifactValidationOptions,
): {
  ok: boolean;
  issues: NodeSlideCanonicalArtifactIssue[];
  kind?: unknown;
  provenance: NodeSlideCanonicalArtifactProvenance | null;
  sourceRefs: string[];
};

export function normalizeNodeSlideCanonicalArtifactSpec(
  value: unknown,
  options?: NodeSlideCanonicalArtifactValidationOptions,
): ReturnType<typeof validateNodeSlideCanonicalArtifactSpec> & {
  spec: NodeSlideCanonicalArtifactSpec | null;
};

export function canonicalArtifactSchemaForKinds(
  kinds?: readonly NodeSlideCanonicalArtifactKind[],
): Record<string, unknown>;

export function evaluateNodeSlideArtifactExpression(
  expression: NodeSlideArtifactExpression,
  values: Record<string, number>,
): number;
