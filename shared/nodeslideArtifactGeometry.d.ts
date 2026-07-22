export const NODESLIDE_ARTIFACT_GEOMETRY_VERSION: 'nodeslide.artifact-geometry/v1';

export type NodeSlideNativeArtifactGeometryKind =
  | 'waterfall'
  | 'sankey'
  | 'gantt'
  | 'risk-matrix'
  | 'trace'
  | 'spatial-scene';

export interface NodeSlideArtifactGeometryFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NodeSlideArtifactGeometryPoint {
  x: number;
  y: number;
}

interface NodeSlideArtifactGeometryBase<K extends NodeSlideNativeArtifactGeometryKind, M> {
  schemaVersion: typeof NODESLIDE_ARTIFACT_GEOMETRY_VERSION;
  artifactId: string;
  kind: K;
  frame: NodeSlideArtifactGeometryFrame;
  marks: M;
}

export interface NodeSlideWaterfallGeometryMarks {
  domain: { min: number; max: number; unit: string };
  bars: Array<{
    id: string;
    label: string;
    value: number;
    unit: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  connectors: Array<{
    id: string;
    from: NodeSlideArtifactGeometryPoint;
    to: NodeSlideArtifactGeometryPoint;
  }>;
}

export interface NodeSlideSankeyGeometryMarks {
  unit: string;
  nodes: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  links: Array<{
    id: string;
    source: string;
    target: string;
    value: number;
    width: number;
    from: NodeSlideArtifactGeometryPoint | null;
    to: NodeSlideArtifactGeometryPoint | null;
  }>;
}

export interface NodeSlideGanttGeometryMarks {
  domain: { min: number; max: number; unit: string };
  tasks: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    width: number;
    height: number;
    confidence: number;
    opacity: number;
  }>;
  dependencies: Array<{
    dependencyId: string;
    taskId: string;
    from: NodeSlideArtifactGeometryPoint | null;
    to: NodeSlideArtifactGeometryPoint | null;
  }>;
}

export interface NodeSlideRiskGeometryMarks {
  likelihoodAxis: { low: string; high: string };
  impactAxis: { low: string; high: string };
  risks: Array<{
    id: string;
    label: string;
    x: number;
    y: number;
    radius: number;
    likelihood: number;
    impact: number;
  }>;
}

export interface NodeSlideTraceGeometryMarks {
  domain: { min: number; max: number; unit: 'ms' };
  spans: Array<{
    spanId: string;
    parentSpanId: string | null;
    startMs: number | null;
    endMs: number | null;
    durationMs: number | null;
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export interface NodeSlideSpatialGeometryMarks {
  viewports: Array<{
    id: string;
    level?: number;
    x: number;
    y: number;
    width: number;
    height: number;
    selectedNodeId: string | null;
  }>;
}

export interface NodeSlideNativeArtifactGeometryByKind {
  waterfall: NodeSlideArtifactGeometryBase<'waterfall', NodeSlideWaterfallGeometryMarks>;
  sankey: NodeSlideArtifactGeometryBase<'sankey', NodeSlideSankeyGeometryMarks>;
  gantt: NodeSlideArtifactGeometryBase<'gantt', NodeSlideGanttGeometryMarks>;
  'risk-matrix': NodeSlideArtifactGeometryBase<'risk-matrix', NodeSlideRiskGeometryMarks>;
  trace: NodeSlideArtifactGeometryBase<'trace', NodeSlideTraceGeometryMarks>;
  'spatial-scene': NodeSlideArtifactGeometryBase<'spatial-scene', NodeSlideSpatialGeometryMarks>;
}

export type NodeSlideNativeArtifactGeometry =
  NodeSlideNativeArtifactGeometryByKind[NodeSlideNativeArtifactGeometryKind];

export function compileNodeSlideNativeArtifactGeometry<
  K extends NodeSlideNativeArtifactGeometryKind,
>(
  spec: { id: string; kind: K; payload: Record<string, unknown> } & Record<string, unknown>,
  frame?: NodeSlideArtifactGeometryFrame,
): NodeSlideNativeArtifactGeometryByKind[K];

export function compileNodeSlideNativeArtifactGeometry(
  spec: Record<string, unknown>,
  frame?: NodeSlideArtifactGeometryFrame,
): NodeSlideNativeArtifactGeometry | null;
