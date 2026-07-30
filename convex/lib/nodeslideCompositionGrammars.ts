/**
 * Executable composition grammars for NodeSlide slide materialization.
 *
 * Each grammar is a self-contained builder that decides which elements exist
 * and where they go. A slide may omit body copy, bullets, rails, rules,
 * labels, and footers when the composition does not need them. Grammars are
 * NOT parameter presets over one element tree — they produce materially
 * different element sets and silhouettes.
 */
import type { BoundingBox, SlideElement, ThemeSpec } from '../../shared/nodeslide';
import {
  NODESLIDE_AUTHORED_ARTIFACT_BINDING_VERSION,
  type NodeSlideAuthoredArtifactBinding,
} from '../../shared/nodeslideArtifactSpec';
import { estimateTextHeight, resolveCollisions } from '../../shared/nodeslideLayoutMetrics';
import { nodeslideStableId } from './nodeslideIds';
import type { NodeSlidePlannedSlide } from './nodeslideSeed';
import type { NodeSlideStorySpec } from './nodeslideStoryContext';

const EDITABLE_CAPABILITIES = ['web_native', 'pptx_editable', 'google_importable'] as const;
const STATIC_MATH_CAPABILITIES = [
  'web_native',
  'pptx_static_fallback',
  'google_importable',
] as const;

export type CompositionGrammarId =
  | 'full-bleed-thesis'
  | 'asymmetric-editorial'
  | 'process-canvas'
  | 'evidence-dossier'
  | 'metric-stage'
  | 'comparison-field'
  | 'sparse-transition';

export interface GrammarBuildContext {
  deckId: string;
  slideId: string;
  planned: NodeSlidePlannedSlide;
  index: number;
  total: number;
  theme: ThemeSpec;
  sourceBriefId: string;
  sourceEvidenceId: string;
  linkedSourceIds: string[];
  authoredSourceIdByRef: ReadonlyMap<string, string>;
  storySpec?: NodeSlideStorySpec;
}

export interface GrammarBuildResult {
  elements: SlideElement[];
  grammarId: CompositionGrammarId;
}

function box(x: number, y: number, width: number, height: number): BoundingBox {
  const snap = (value: number) => Math.round(value * 10_000) / 10_000;
  return { x: snap(x), y: snap(y), width: snap(width), height: snap(height) };
}

function makeElement(
  ctx: GrammarBuildContext,
  key: string,
  value: Omit<SlideElement, 'id' | 'slideId' | 'version'>,
): SlideElement {
  return {
    ...value,
    id: nodeslideStableId('element', ctx.slideId, key),
    slideId: ctx.slideId,
    version: 1,
  };
}

function fitTextFontSize(
  content: string,
  preferred: number,
  minimum: number,
  lineHeight: number,
  width: number,
  maxHeight: number,
): number {
  for (let fontSize = preferred; fontSize >= minimum; fontSize -= 1) {
    if (estimateTextHeight(content, fontSize, lineHeight, width) <= maxHeight) return fontSize;
  }
  return minimum;
}

function resolveGeometryCollisions(elements: SlideElement[], slideTitle: string): void {
  const collidable = elements.filter(
    (candidate) =>
      candidate.kind !== 'shape' &&
      candidate.kind !== 'connector' &&
      candidate.role !== 'footer' &&
      candidate.role !== 'page_number',
  );
  const resolution = resolveCollisions(
    collidable.map((candidate) => ({ id: candidate.id, bbox: candidate.bbox })),
  );
  if (!resolution.resolved) {
    const nameById = new Map(elements.map((candidate) => [candidate.id, candidate.name]));
    const pairs = resolution.remaining
      .map(
        (pair) =>
          `${nameById.get(pair.first) ?? pair.first} × ${
            nameById.get(pair.second) ?? pair.second
          } (${Math.round(pair.overlapRatio * 100)}%)`,
      )
      .join('; ');
    throw new Error(
      `NodeSlide layout: unresolved element collision on slide "${slideTitle}": ${pairs}`,
    );
  }
  if (resolution.nudged.length > 0) {
    for (const candidate of elements) {
      const resolvedBox = resolution.boxes.get(candidate.id);
      if (resolvedBox) candidate.bbox = resolvedBox;
    }
  }
}

function evidenceSourceIds(ctx: GrammarBuildContext): string[] {
  const authored = ctx.planned.authoredArtifactCompilation?.sourceRefs.map((ref) => {
    const id = ctx.authoredSourceIdByRef.get(ref);
    if (!id) {
      throw new Error(
        `NodeSlide authored ArtifactSpec failed [artifact_source_binding]: unresolved source reference ${ref}.`,
      );
    }
    return id;
  });
  return (
    authored ?? (ctx.linkedSourceIds.length > 0 ? ctx.linkedSourceIds : [ctx.sourceEvidenceId])
  );
}

function authoredArtifactBinding(
  ctx: GrammarBuildContext,
): NodeSlideAuthoredArtifactBinding | undefined {
  const { planned } = ctx;
  if (!planned.authoredArtifactSpec || !planned.authoredArtifactCompilation) return undefined;
  const sourceIds = evidenceSourceIds(ctx);
  return {
    schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_BINDING_VERSION,
    artifactId: planned.authoredArtifactSpec.id,
    kind: planned.authoredArtifactSpec.kind,
    narrativeJob: planned.authoredArtifactSpec.narrativeJob,
    truthState: planned.authoredArtifactSpec.provenance.truthState,
    rationale: planned.authoredArtifactSpec.provenance.rationale,
    claimIds: [...planned.authoredArtifactSpec.claimIds],
    sourceIds,
    specDigest: planned.authoredArtifactCompilation.authoredSpecDigest,
    projection: {
      ...planned.authoredArtifactCompilation.projection,
      knownFidelityDifferences: [
        ...planned.authoredArtifactCompilation.projection.knownFidelityDifferences,
      ],
    },
  };
}

function storyContinuityElements(ctx: GrammarBuildContext): SlideElement[] {
  if (!ctx.storySpec) return [];
  const storyBeat = ctx.storySpec.revealPacing[ctx.index];
  if (!storyBeat) return [];
  const elements: SlideElement[] = [];
  const motifKind = ctx.storySpec.visualMetaphor.kind;
  const continuityProgress = (ctx.index + 1) / Math.max(1, ctx.total);
  const markerProgress = Math.min(0.82, 0.82 * continuityProgress);
  const markerSize = motifKind === 'signal' ? 0.012 + 0.012 * (storyBeat.intensity / 100) : 0.016;
  elements.push(
    makeElement(ctx, 'story-continuity-motif', {
      name: `Story continuity · ${ctx.storySpec.sceneContinuity.motif}`,
      kind: 'shape',
      role: `story_motif_${ctx.storySpec.visualMetaphor.kind}`,
      bbox: box(0.07, 0.115, Math.max(0.08, 0.82 * continuityProgress), 0.008),
      rotation: 0,
      style: {
        fill: ctx.theme.colors.accent,
        opacity: Math.max(0.28, storyBeat.intensity / 100),
        radius: 999,
      },
      altText: `${ctx.storySpec.sceneContinuity.progression[ctx.index]}; emotional intensity ${storyBeat.intensity} of 100`,
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  elements.push(
    makeElement(ctx, 'story-continuity-marker', {
      name: `Story transformation · ${ctx.storySpec.visualMetaphor.transformation}`,
      kind: 'shape',
      role: `story_motif_${motifKind}_marker`,
      bbox:
        motifKind === 'threshold'
          ? box(0.884, 0.097, 0.006, 0.044)
          : box(
              Math.min(0.876, 0.07 + markerProgress - markerSize / 2),
              0.111 - markerSize / 2,
              markerSize,
              markerSize,
            ),
      rotation: 0,
      style: {
        fill: motifKind === 'threshold' ? ctx.theme.colors.insightInk : ctx.theme.colors.accent,
        opacity: Math.max(0.38, storyBeat.intensity / 100),
        radius: motifKind === 'threshold' ? 3 : 999,
      },
      altText:
        motifKind === 'threshold'
          ? `Decision threshold; the story signal has reached ${Math.round(continuityProgress * 100)} percent of the gate`
          : `${ctx.storySpec.visualMetaphor.subject}; transformation progress ${Math.round(continuityProgress * 100)} percent`,
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  return elements;
}

function footerElements(ctx: GrammarBuildContext): SlideElement[] {
  return [
    makeElement(ctx, 'footer', {
      name: 'Deck footer',
      kind: 'text',
      role: 'footer',
      bbox: box(0.07, 0.93, 0.72, 0.035),
      rotation: 0,
      content: 'NODESLIDE  ·  SOURCE-AWARE  ·  EDITABLE',
      style: {
        color: ctx.theme.colors.muted,
        fontFamily: ctx.theme.typography.data,
        fontSize: 10,
        fontWeight: 550,
        letterSpacing: 1.1,
      },
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
    makeElement(ctx, 'page-number', {
      name: 'Page number',
      kind: 'text',
      role: 'page_number',
      bbox: box(0.88, 0.92, 0.06, 0.05),
      rotation: 0,
      content: String(ctx.index + 1).padStart(2, '0'),
      style: {
        color: ctx.theme.colors.accent,
        fontFamily: ctx.theme.typography.data,
        fontSize: 13,
        fontWeight: 700,
        textAlign: 'right',
      },
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  ];
}

function sectionLabel(ctx: GrammarBuildContext, x: number, y: number, width: number): SlideElement {
  return makeElement(ctx, 'section', {
    name: 'Section label',
    kind: 'text',
    role: 'section',
    bbox: box(x, y, width, 0.05),
    rotation: 0,
    content: ctx.planned.section.toUpperCase(),
    style: {
      color: ctx.theme.colors.accent,
      fontFamily: ctx.theme.typography.data,
      fontSize: 15,
      fontWeight: 650,
      letterSpacing: 1.3,
    },
    sourceIds: [],
    locked: false,
    exportCapabilities: [...EDITABLE_CAPABILITIES],
  });
}

function buildChartElement(
  ctx: GrammarBuildContext,
  x: number,
  y: number,
  width: number,
  height: number,
): SlideElement {
  const { planned, theme } = ctx;
  const chart = planned.chart;
  if (!chart)
    return makeElement(ctx, 'chart-placeholder', {
      name: 'Chart',
      kind: 'text',
      role: 'evidence',
      content: '',
      bbox: box(x, y, width, height),
      rotation: 0,
      style: {
        fill: theme.colors.accentSoft,
        color: theme.colors.insightInk,
        fontSize: 10,
        fontFamily: theme.typography.body,
        fontWeight: 400,
        lineHeight: 1.2,
        textAlign: 'center',
        verticalAlign: 'middle',
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    });
  const labels = chart.labels.slice(0, 8);
  const values = chart.values.slice(0, labels.length);
  const binding = authoredArtifactBinding(ctx);
  return makeElement(ctx, 'chart', {
    name: 'Evidence chart',
    kind: 'chart',
    role: 'evidence',
    bbox: box(x, y, width, height),
    rotation: 0,
    style: {
      fill: theme.colors.accentSoft,
      color: theme.colors.ink,
      radius: theme.defaultRadius,
      padding: 14,
    },
    chart: {
      chartType: 'bar',
      labels,
      series: [{ name: 'Signal', values, color: theme.colors.accent }],
      ...(chart.unit ? { unit: chart.unit } : {}),
      sourceId: evidenceSourceIds(ctx)[0] ?? ctx.sourceEvidenceId,
    },
    sourceIds: evidenceSourceIds(ctx),
    ...(binding ? { authoredArtifactBinding: binding } : {}),
    locked: false,
    exportCapabilities: [...EDITABLE_CAPABILITIES],
  });
}

function buildMetricElement(
  ctx: GrammarBuildContext,
  x: number,
  y: number,
  width: number,
  height: number,
  fontSize: number,
): SlideElement {
  const { planned, theme } = ctx;
  const binding = authoredArtifactBinding(ctx);
  return makeElement(ctx, 'metric', {
    name: 'Primary metric',
    kind: 'text',
    role: 'metric',
    bbox: box(x, y, width, height),
    rotation: 0,
    content: planned.metric ?? '',
    style: {
      color: theme.colors.insightInk,
      fill: theme.colors.insight,
      fontFamily: theme.typography.data,
      fontSize,
      fontWeight: 720,
      lineHeight: 1,
      padding: 20,
      radius: theme.defaultRadius,
    },
    sourceIds: evidenceSourceIds(ctx),
    ...(binding ? { authoredArtifactBinding: binding } : {}),
    locked: false,
    exportCapabilities: [...EDITABLE_CAPABILITIES],
  });
}

function buildFormulaElement(
  ctx: GrammarBuildContext,
  x: number,
  y: number,
  width: number,
  height: number,
): SlideElement {
  const { planned, theme } = ctx;
  const binding = authoredArtifactBinding(ctx);
  return makeElement(ctx, 'formula', {
    name: 'Editable formula',
    kind: 'math',
    role: 'formula',
    bbox: box(x, y, width, height),
    rotation: 0,
    content: planned.formula?.display ?? '',
    style: {
      fill: theme.colors.insight,
      color: theme.colors.insightInk,
      fontFamily: theme.typography.data,
      fontSize: 30,
      fontWeight: 720,
      lineHeight: 1.15,
      padding: 20,
      radius: theme.defaultRadius,
      textAlign: 'center',
      verticalAlign: 'middle',
    },
    math: {
      expression: planned.formula?.expression ?? '',
      display: planned.formula?.display ?? '',
      variables: planned.formula?.variables ?? [],
      syntax: planned.formula?.syntax ?? 'plain',
      displayMode: 'block',
      ...(planned.formula?.description ? { description: planned.formula.description } : {}),
      sourceId: evidenceSourceIds(ctx)[0] ?? ctx.sourceEvidenceId,
    },
    sourceIds: evidenceSourceIds(ctx),
    ...(binding ? { authoredArtifactBinding: binding } : {}),
    locked: false,
    exportCapabilities:
      (planned.formula?.syntax ?? 'plain') === 'latex'
        ? [...STATIC_MATH_CAPABILITIES]
        : [...EDITABLE_CAPABILITIES],
  });
}

function buildImageElement(
  ctx: GrammarBuildContext,
  x: number,
  y: number,
  width: number,
  height: number,
): { element: SlideElement; credit: SlideElement } | undefined {
  const { planned, theme } = ctx;
  if (!planned.image) return undefined;
  const imageUrl = planned.image.imageUrl ?? planned.image.url;
  const hasEmbeddedAsset = Boolean(imageUrl?.startsWith('data:image/'));
  const credit =
    planned.image.credit ?? planned.image.caption ?? 'Credit required before external publication';
  const binding = authoredArtifactBinding(ctx);
  const element = makeElement(ctx, 'image', {
    name: 'Editable image',
    kind: 'image',
    role: 'image',
    bbox: box(x, y, width, height),
    rotation: 0,
    style: {
      fill: theme.colors.accentSoft,
      stroke: theme.colors.border,
      strokeWidth: 2,
      color: theme.colors.muted,
      radius: theme.defaultRadius,
    },
    image: {
      placeholder: !hasEmbeddedAsset,
      credit,
      sourceId: evidenceSourceIds(ctx)[0] ?? ctx.sourceEvidenceId,
    },
    ...(hasEmbeddedAsset && imageUrl ? { imageUrl } : {}),
    altText: planned.image.altText,
    sourceIds: evidenceSourceIds(ctx),
    ...(binding ? { authoredArtifactBinding: binding } : {}),
    locked: false,
    exportCapabilities: hasEmbeddedAsset
      ? ['web_native', 'pptx_static_fallback', 'google_importable']
      : [...EDITABLE_CAPABILITIES],
  });
  const creditElement = makeElement(ctx, 'image-credit', {
    name: 'Image credit',
    kind: 'text',
    role: 'caption',
    bbox: box(x, y + height + 0.01, width, 0.05),
    rotation: 0,
    content: planned.image.caption
      ? planned.image.caption
      : `${hasEmbeddedAsset ? 'Image credit' : 'Replace image before external use'} · ${credit}`,
    style: {
      color: theme.colors.muted,
      fontFamily: ctx.theme.typography.body,
      fontSize: 14,
      fontWeight: 520,
      lineHeight: 1.2,
      textAlign: 'center',
    },
    sourceIds: evidenceSourceIds(ctx),
    locked: false,
    exportCapabilities: [...EDITABLE_CAPABILITIES],
  });
  return { element, credit: creditElement };
}

function layoutDiagramNodes(
  diagram: NonNullable<NodeSlidePlannedSlide['diagram']>,
  x: number,
  y: number,
  width: number,
  height: number,
): Array<{ id: string; x: number; y: number; width: number; height: number }> {
  const crossCuttingHubId = diagramCrossCuttingHubId(diagram);
  if (crossCuttingHubId) {
    const sequenceNodes = diagram.nodes.filter((node) => node.id !== crossCuttingHubId);
    const gapX = sequenceNodes.length > 1 ? 0.012 : 0;
    const hubHeight = Math.min(0.1, height * 0.24);
    const sequenceY = y + hubHeight + 0.045;
    const sequenceHeight = Math.min(0.14, Math.max(0.08, height - hubHeight - 0.08));
    const sequenceWidth =
      (width - gapX * Math.max(0, sequenceNodes.length - 1)) / Math.max(1, sequenceNodes.length);
    const sequenceIndexById = new Map(sequenceNodes.map((node, index) => [node.id, index]));
    return diagram.nodes.map((node) => {
      if (node.id === crossCuttingHubId) {
        return { id: node.id, x, y, width, height: hubHeight };
      }
      const index = sequenceIndexById.get(node.id) ?? 0;
      return {
        id: node.id,
        x: x + index * (sequenceWidth + gapX),
        y: sequenceY,
        width: sequenceWidth,
        height: sequenceHeight,
      };
    });
  }
  const count = diagram.nodes.length;
  const columns =
    diagram.direction === 'vertical' ? (count > 4 ? 2 : 1) : Math.min(count, count > 4 ? 4 : 3);
  const rows = Math.ceil(count / columns);
  const gapX = columns > 1 ? 0.025 : 0;
  const gapY = rows > 1 ? 0.035 : 0;
  const nodeWidth = (width - gapX * (columns - 1)) / columns;
  const nodeHeight = Math.min(0.14, (height - gapY * (rows - 1)) / rows);
  const usedHeight = nodeHeight * rows + gapY * (rows - 1);
  const startY = y + Math.max(0, (height - usedHeight) / 2);
  return diagram.nodes.map((node, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return {
      id: node.id,
      x: x + column * (nodeWidth + gapX),
      y: startY + row * (nodeHeight + gapY),
      width: nodeWidth,
      height: nodeHeight,
    };
  });
}

function diagramCrossCuttingHubId(
  diagram: NonNullable<NodeSlidePlannedSlide['diagram']>,
): string | undefined {
  const crossCuttingSignal = /(?:govern|oversight|cross[-\s]?cutting|guardrail|policy)/i;
  return diagram.nodes.find((node) => {
    const outgoing = diagram.edges.filter((edge) => edge.from === node.id);
    if (outgoing.length < Math.min(2, Math.max(1, diagram.nodes.length - 2))) return false;
    return (
      crossCuttingSignal.test(node.label) ||
      outgoing.every((edge) => crossCuttingSignal.test(edge.label ?? ''))
    );
  })?.id;
}

function diagramNodeFontSize(label: string, width: number): number {
  const normalized = label.trim().replace(/\s+/g, ' ');
  const longestWord = Math.max(1, ...normalized.split(' ').map((word) => word.length));
  const preferred = normalized.length > 15 ? 12 : normalized.length > 9 ? 13 : 14;
  const usablePoints = Math.max(1, width * 13.333 * 72 - 16);
  return Math.max(10, Math.min(preferred, Math.floor(usablePoints / (longestWord * 0.56))));
}

function buildDiagramElements(
  ctx: GrammarBuildContext,
  diagram: NonNullable<NodeSlidePlannedSlide['diagram']>,
  x: number,
  y: number,
  width: number,
  height: number,
): SlideElement[] {
  const { theme } = ctx;
  const elements: SlideElement[] = [];
  const positions = layoutDiagramNodes(diagram, x, y, width, height);
  const positionsById = new Map(positions.map((p) => [p.id, p]));
  const evidenceIds = evidenceSourceIds(ctx);
  const binding = authoredArtifactBinding(ctx);
  const diagramArtifactId = binding?.artifactId ?? nodeslideStableId('artifact_graph', ctx.slideId);
  const crossCuttingHubId = diagramCrossCuttingHubId(diagram);
  diagram.edges.forEach((edge, edgeIndex) => {
    const from = positionsById.get(edge.from);
    const to = positionsById.get(edge.to);
    if (!from || !to) return;
    if (edge.from === crossCuttingHubId) return;
    if (edge.label && /(?:feedback|loop|cycle)/i.test(edge.label)) {
      elements.push(
        makeElement(ctx, `diagram-feedback-${edgeIndex + 1}`, {
          name: `Diagram feedback: ${edge.label}`,
          kind: 'text',
          role: 'diagram_feedback',
          bbox: box(
            Math.min(from.x, to.x),
            Math.min(0.84, Math.max(from.y + from.height, to.y + to.height) + 0.014),
            Math.max(0.12, Math.max(from.x + from.width, to.x + to.width) - Math.min(from.x, to.x)),
            0.036,
          ),
          rotation: 0,
          content: `↺ ${edge.label}`,
          style: {
            color: theme.colors.trace,
            fontFamily: theme.typography.data,
            fontSize: 14,
            fontWeight: 650,
            letterSpacing: 0.8,
            textAlign: 'center',
          },
          sourceIds: evidenceIds,
          ...(binding ? { authoredArtifactBinding: binding } : {}),
          locked: false,
          exportCapabilities: [...EDITABLE_CAPABILITIES],
        }),
      );
      return;
    }
    const fromCenter = { x: from.x + from.width / 2, y: from.y + from.height / 2 };
    const toCenter = { x: to.x + to.width / 2, y: to.y + to.height / 2 };
    const deltaX = toCenter.x - fromCenter.x;
    const deltaY = toCenter.y - fromCenter.y;
    const distance = Math.max(0.02, Math.hypot(deltaX, deltaY));
    elements.push(
      makeElement(ctx, `diagram-edge-${edgeIndex + 1}`, {
        name: edge.label ? `Diagram edge: ${edge.label}` : 'Diagram edge',
        kind: 'connector',
        role: 'diagram_edge',
        bbox: box(
          (fromCenter.x + toCenter.x) / 2 - distance / 2,
          (fromCenter.y + toCenter.y) / 2 - 0.012,
          distance,
          0.024,
        ),
        rotation: (Math.atan2(deltaY, deltaX) * 180) / Math.PI,
        style: { color: theme.colors.trace, strokeWidth: 2 },
        artifactBinding: {
          schemaVersion: 'nodeslide.production-artifact-binding/v1',
          artifactId: diagramArtifactId,
          role: 'graph-edge',
          graphKind: diagram.kind,
          from: edge.from,
          to: edge.to,
          ...(edge.label ? { label: edge.label } : {}),
        },
        sourceIds: evidenceIds,
        ...(binding ? { authoredArtifactBinding: binding } : {}),
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  });
  positions.forEach((position, nodeIndex) => {
    const node = diagram.nodes[nodeIndex];
    if (!node) return;
    const isCrossCuttingHub = node.id === crossCuttingHubId;
    const nodeKind =
      node.kind ?? (/\b(?:gate|approve|decision)\b/i.test(node.label) ? 'decision' : 'step');
    elements.push(
      makeElement(ctx, `diagram-node-${node.id}`, {
        name: `Diagram node: ${node.label}`,
        kind: 'shape',
        role: isCrossCuttingHub ? 'diagram_cross_cutting' : `diagram_${nodeKind}`,
        bbox: box(position.x, position.y, position.width, position.height),
        rotation: 0,
        content: node.label,
        style: {
          fill:
            isCrossCuttingHub || nodeKind === 'decision' || nodeKind === 'milestone'
              ? theme.colors.insight
              : theme.colors.accentSoft,
          stroke:
            isCrossCuttingHub || nodeKind === 'decision'
              ? theme.colors.accent
              : theme.colors.border,
          strokeWidth: isCrossCuttingHub || nodeKind === 'decision' ? 2 : 1,
          color: theme.colors.ink,
          fontFamily: theme.typography.body,
          fontSize: isCrossCuttingHub ? 15 : diagramNodeFontSize(node.label, position.width),
          fontWeight: 650,
          lineHeight: 1.15,
          padding: isCrossCuttingHub ? 12 : 8,
          radius: theme.defaultRadius,
          textAlign: 'center',
          verticalAlign: 'middle',
        },
        artifactBinding: {
          schemaVersion: 'nodeslide.production-artifact-binding/v1',
          artifactId: diagramArtifactId,
          role: 'graph-node',
          graphKind: diagram.kind,
          nodeId: node.id,
          ...(node.kind ? { nodeKind: node.kind } : {}),
        },
        sourceIds: evidenceIds,
        ...(binding ? { authoredArtifactBinding: binding } : {}),
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  });
  return elements;
}

export { box as grammarBox, resolveGeometryCollisions };

// ============================================================================
// GRAMMAR 1: full-bleed-thesis
// A large centered headline dominates the canvas. Minimal decoration.
// No body, no bullets, no accent rail. Vast negative space.
// ============================================================================

function buildFullBleedThesis(ctx: GrammarBuildContext): GrammarBuildResult {
  const { planned, theme } = ctx;
  const elements: SlideElement[] = [];
  const isOpening = ctx.index === 0;
  const fontSize = isOpening ? 64 : 52;
  const headlineWidth = 0.86;
  const headlineHeight = Math.min(
    0.4,
    Math.max(0.2, estimateTextHeight(planned.headline, fontSize, 1.02, headlineWidth)),
  );
  const headlineY = 0.5 - headlineHeight / 2;
  elements.push(
    makeElement(ctx, 'headline', {
      name: 'Headline',
      kind: 'text',
      role: isOpening ? 'title' : 'headline',
      bbox: box(0.07, headlineY, headlineWidth, headlineHeight),
      rotation: 0,
      content: planned.headline,
      style: {
        color: theme.colors.ink,
        fontFamily: theme.typography.display,
        fontSize,
        fontWeight: 620,
        lineHeight: 1.02,
        letterSpacing: -1.2,
      },
      sourceIds: [ctx.sourceBriefId],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  elements.push(
    makeElement(ctx, 'accent-underline', {
      name: 'Accent underline',
      kind: 'shape',
      role: 'decoration',
      bbox: box(0.07, headlineY + headlineHeight + 0.02, 0.12, 0.006),
      rotation: 0,
      style: { fill: theme.colors.accent, radius: 999 },
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  elements.push(sectionLabel(ctx, 0.07, 0.06, 0.4));
  elements.push(...storyContinuityElements(ctx));
  elements.push(...footerElements(ctx));
  resolveGeometryCollisions(elements, planned.title);
  return { elements, grammarId: 'full-bleed-thesis' };
}

// ============================================================================
// GRAMMAR 2: asymmetric-editorial
// Headline upper-left, body lower-left; right two-thirds is negative space
// or a single large visual. Deliberately off-balance.
// ============================================================================

function buildAsymmetricEditorial(ctx: GrammarBuildContext): GrammarBuildResult {
  const { planned, theme } = ctx;
  const elements: SlideElement[] = [];
  const claimSourceIds = [ctx.sourceBriefId, ...ctx.linkedSourceIds];
  const hasVisual = Boolean(planned.chart || planned.formula || planned.image);
  const mediaOnLeft = ctx.index % 2 === 1;
  elements.push(sectionLabel(ctx, 0.07, 0.065, 0.4));
  const headlineFontSize = 42;
  const headlineWidth = hasVisual ? (mediaOnLeft ? 0.42 : 0.52) : 0.86;
  const headlineX = hasVisual && mediaOnLeft ? 0.5 : 0.07;
  const headlineHeight = Math.min(
    0.3,
    Math.max(0.18, estimateTextHeight(planned.headline, headlineFontSize, 1.05, headlineWidth)),
  );
  elements.push(
    makeElement(ctx, 'headline', {
      name: 'Headline',
      kind: 'text',
      role: 'headline',
      bbox: box(headlineX, 0.16, headlineWidth, headlineHeight),
      rotation: 0,
      content: planned.headline,
      style: {
        color: theme.colors.ink,
        fontFamily: theme.typography.display,
        fontSize: headlineFontSize,
        fontWeight: 620,
        lineHeight: 1.05,
        letterSpacing: -0.6,
      },
      sourceIds: [ctx.sourceBriefId],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  const bodyY = 0.16 + headlineHeight + 0.06;
  const isChartDominant = planned.chart !== undefined;
  const bodyWidth = hasVisual
    ? mediaOnLeft
      ? isChartDominant
        ? 0.34
        : 0.42
      : isChartDominant
        ? 0.3
        : 0.42
    : 0.79;
  const bodyX = hasVisual && mediaOnLeft ? (isChartDominant ? 0.58 : 0.5) : 0.07;
  const bodyMaxHeight = Math.min(0.2, 0.85 - bodyY);
  const bodyFontSize = fitTextFontSize(planned.body, 18, 14, 1.35, bodyWidth, bodyMaxHeight);
  const bodyHeight = Math.min(
    bodyMaxHeight,
    Math.max(0.15, estimateTextHeight(planned.body, bodyFontSize, 1.35, bodyWidth)),
  );
  elements.push(
    makeElement(ctx, 'body', {
      name: 'Body copy',
      kind: 'text',
      role: 'body',
      bbox: box(bodyX, bodyY, bodyWidth, bodyHeight),
      rotation: 0,
      content: planned.body,
      style: {
        color: theme.colors.muted,
        fontFamily: theme.typography.body,
        fontSize: bodyFontSize,
        fontWeight: 430,
        lineHeight: 1.35,
      },
      sourceIds: claimSourceIds,
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  if (hasVisual) {
    const visualX = mediaOnLeft ? 0.06 : isChartDominant ? 0.42 : 0.55;
    const visualY = 0.16;
    const visualWidth = isChartDominant ? 0.5 : 0.38;
    const visualHeight = 0.65;
    if (planned.chart) {
      elements.push(buildChartElement(ctx, visualX, visualY, visualWidth, visualHeight));
    } else if (planned.formula) {
      elements.push(buildFormulaElement(ctx, visualX, visualY + 0.1, visualWidth, 0.3));
    } else if (planned.image) {
      const img = buildImageElement(ctx, visualX, visualY, visualWidth, visualHeight);
      if (img) {
        elements.push(img.element);
        elements.push(img.credit);
      }
    }
  }
  // Bullet elements below body when present
  const bulletTexts = planned.bullets
    .slice(0, 3)
    .map((bullet, bulletIndex) => `0${bulletIndex + 1}  ${bullet}`);
  const bulletFontSize = hasVisual ? 14 : 17;
  const bulletX = hasVisual ? (mediaOnLeft ? (isChartDominant ? 0.58 : 0.5) : 0.07) : 0.59;
  const bulletWidth = hasVisual
    ? mediaOnLeft
      ? isChartDominant
        ? 0.34
        : 0.42
      : isChartDominant
        ? 0.3
        : 0.42
    : 0.33;
  const bulletStackStart = bodyY + bodyHeight + 0.02;
  let bulletCursor = bulletStackStart;
  bulletTexts.forEach((content, bulletIndex) => {
    const bulletHeight = Math.max(
      0.031,
      estimateTextHeight(content, bulletFontSize, 1.2, bulletWidth),
    );
    elements.push(
      makeElement(ctx, `bullet-${bulletIndex + 1}`, {
        name: `Key point ${bulletIndex + 1}`,
        kind: 'text',
        role: 'bullet',
        bbox: box(bulletX, bulletCursor, bulletWidth, bulletHeight),
        rotation: 0,
        content,
        style: {
          color: theme.colors.ink,
          fontFamily: theme.typography.body,
          fontSize: bulletFontSize,
          fontWeight: 560,
          lineHeight: 1.2,
        },
        sourceIds: claimSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
    bulletCursor += bulletHeight + 0.03;
  });
  elements.push(...storyContinuityElements(ctx));
  elements.push(...footerElements(ctx));
  resolveGeometryCollisions(elements, planned.title);
  return { elements, grammarId: 'asymmetric-editorial' };
}

// ============================================================================
// GRAMMAR 3: process-canvas
// Headline strip at top, diagram fills the rest of the canvas.
// No body prose. The process IS the content.
// ============================================================================

function buildProcessCanvas(ctx: GrammarBuildContext): GrammarBuildResult {
  const { planned, theme } = ctx;
  const elements: SlideElement[] = [];
  elements.push(sectionLabel(ctx, 0.07, 0.06, 0.4));
  const headlineFontSize = 32;
  const headlineWidth = 0.82;
  const headlineHeight = Math.min(
    0.12,
    Math.max(0.08, estimateTextHeight(planned.headline, headlineFontSize, 1.1, headlineWidth)),
  );
  elements.push(
    makeElement(ctx, 'headline', {
      name: 'Headline',
      kind: 'text',
      role: 'headline',
      bbox: box(0.07, 0.14, headlineWidth, headlineHeight),
      rotation: 0,
      content: planned.headline,
      style: {
        color: theme.colors.ink,
        fontFamily: theme.typography.display,
        fontSize: headlineFontSize,
        fontWeight: 600,
        lineHeight: 1.1,
      },
      sourceIds: [ctx.sourceBriefId],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  if (planned.diagram) {
    const diagramY = 0.14 + headlineHeight + 0.05;
    const diagramHeight = 0.85 - diagramY;
    elements.push(
      ...buildDiagramElements(ctx, planned.diagram, 0.07, diagramY, 0.86, diagramHeight),
    );
  } else if (planned.chart) {
    const chartY = 0.14 + headlineHeight + 0.05;
    elements.push(buildChartElement(ctx, 0.07, chartY, 0.86, 0.85 - chartY));
  }
  // Body copy below the diagram for context
  const diagramBottom = planned.diagram
    ? 0.14 +
      headlineHeight +
      0.05 +
      Math.min(0.24, (0.85 - 0.14 - headlineHeight - 0.05) * 0.24) +
      0.045 +
      0.14
    : 0.14 + headlineHeight + 0.05 + 0.55;
  const bodyY = Math.max(0.14 + headlineHeight + 0.05, diagramBottom + 0.03);
  const bodyFontSize = fitTextFontSize(planned.body, 16, 14, 1.35, 0.79, 0.85 - bodyY);
  const bodyHeight = Math.min(
    0.85 - bodyY,
    Math.max(0.11, estimateTextHeight(planned.body, bodyFontSize, 1.35, 0.79)),
  );
  elements.push(
    makeElement(ctx, 'body', {
      name: 'Body copy',
      kind: 'text',
      role: 'body',
      bbox: box(0.07, bodyY, 0.79, bodyHeight),
      rotation: 0,
      content: planned.body,
      style: {
        color: theme.colors.muted,
        fontFamily: theme.typography.body,
        fontSize: bodyFontSize,
        fontWeight: 430,
        lineHeight: 1.35,
      },
      sourceIds: [ctx.sourceBriefId, ...ctx.linkedSourceIds],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  elements.push(...storyContinuityElements(ctx));
  elements.push(...footerElements(ctx));
  resolveGeometryCollisions(elements, planned.title);
  return { elements, grammarId: 'process-canvas' };
}

// ============================================================================
// GRAMMAR 4: evidence-dossier
// Headline at top, 2-3 evidence cards in a row. No body prose.
// Each card carries one numbered claim with its sources.
// ============================================================================

function buildEvidenceDossier(ctx: GrammarBuildContext): GrammarBuildResult {
  const { planned, theme } = ctx;
  const elements: SlideElement[] = [];
  const claimSourceIds = [ctx.sourceBriefId, ...ctx.linkedSourceIds];
  elements.push(sectionLabel(ctx, 0.07, 0.065, 0.4));
  const headlineFontSize = 36;
  const headlineWidth = 0.79;
  const headlineHeight = Math.min(
    0.16,
    Math.max(0.1, estimateTextHeight(planned.headline, headlineFontSize, 1.05, headlineWidth)),
  );
  elements.push(
    makeElement(ctx, 'headline', {
      name: 'Headline',
      kind: 'text',
      role: 'headline',
      bbox: box(0.07, 0.15, headlineWidth, headlineHeight),
      rotation: 0,
      content: planned.headline,
      style: {
        color: theme.colors.ink,
        fontFamily: theme.typography.display,
        fontSize: headlineFontSize,
        fontWeight: 620,
        lineHeight: 1.05,
        letterSpacing: -0.4,
      },
      sourceIds: [ctx.sourceBriefId],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  const bullets = planned.bullets.slice(0, 3);
  const cardY = 0.15 + headlineHeight + 0.06;
  const cardHeight = Math.min(0.32, 0.88 - cardY);
  const cardGap = 0.025;
  const cardWidth = (0.86 - cardGap * (bullets.length - 1)) / Math.max(1, bullets.length);
  bullets.forEach((bullet, index) => {
    const cardX = 0.07 + index * (cardWidth + cardGap);
    elements.push(
      makeElement(ctx, `evidence-card-${index + 1}`, {
        name: `Evidence card ${index + 1}`,
        kind: 'shape',
        role: 'evidence_card',
        bbox: box(cardX, cardY, cardWidth, cardHeight),
        rotation: 0,
        style: {
          fill: theme.colors.insight,
          stroke: theme.colors.border,
          strokeWidth: 1,
          radius: theme.defaultRadius,
        },
        sourceIds: claimSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
    const cardTextFontSize = fitTextFontSize(
      bullet,
      16,
      13,
      1.25,
      cardWidth - 0.04,
      cardHeight - 0.04,
    );
    elements.push(
      makeElement(ctx, `evidence-card-text-${index + 1}`, {
        name: `Evidence ${index + 1}`,
        kind: 'text',
        role: 'bullet',
        bbox: box(cardX + 0.02, cardY + 0.02, cardWidth - 0.04, cardHeight - 0.04),
        rotation: 0,
        content: `0${index + 1}  ${bullet}`,
        style: {
          color: theme.colors.insightInk,
          fontFamily: theme.typography.body,
          fontSize: cardTextFontSize,
          fontWeight: 560,
          lineHeight: 1.25,
        },
        sourceIds: claimSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  });
  if (planned.chart && bullets.length === 0) {
    elements.push(buildChartElement(ctx, 0.07, cardY, 0.86, cardHeight));
  }
  if (planned.metric && bullets.length <= 1) {
    elements.push(buildMetricElement(ctx, 0.07, cardY, 0.86, cardHeight, 48));
  }
  elements.push(...storyContinuityElements(ctx));
  elements.push(...footerElements(ctx));
  resolveGeometryCollisions(elements, planned.title);
  return { elements, grammarId: 'evidence-dossier' };
}

// ============================================================================
// GRAMMAR 5: metric-stage
// Giant metric centered on canvas, label below. No body, no bullets.
// The number IS the slide.
// ============================================================================

function buildMetricStage(ctx: GrammarBuildContext): GrammarBuildResult {
  const { planned, theme } = ctx;
  const elements: SlideElement[] = [];
  elements.push(sectionLabel(ctx, 0.07, 0.065, 0.4));
  const headlineFontSize = 24;
  const headlineWidth = 0.72;
  const headlineHeight = Math.min(
    0.1,
    Math.max(0.06, estimateTextHeight(planned.headline, headlineFontSize, 1.1, headlineWidth)),
  );
  elements.push(
    makeElement(ctx, 'headline', {
      name: 'Headline',
      kind: 'text',
      role: 'headline',
      bbox: box(0.14, 0.16, headlineWidth, headlineHeight),
      rotation: 0,
      content: planned.headline,
      style: {
        color: theme.colors.muted,
        fontFamily: theme.typography.body,
        fontSize: headlineFontSize,
        fontWeight: 560,
        lineHeight: 1.1,
        textAlign: 'center',
      },
      sourceIds: [ctx.sourceBriefId],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  let metricBottom = 0.55;
  if (planned.metric) {
    const metricText = planned.metric;
    const metricFontSize = metricText.length > 14 ? 40 : 46;
    const metricWidth = 0.6;
    const metricHeight = Math.min(
      0.22,
      Math.max(0.22, estimateTextHeight(metricText, metricFontSize, 1, metricWidth) + 0.06),
    );
    const metricX = 0.5 - metricWidth / 2;
    const metricY = 0.28;
    elements.push(
      buildMetricElement(ctx, metricX, metricY, metricWidth, metricHeight, metricFontSize),
    );
    metricBottom = metricY + metricHeight;
    if (planned.metricLabel) {
      elements.push(
        makeElement(ctx, 'metric-label', {
          name: 'Metric label',
          kind: 'text',
          role: 'caption',
          bbox: box(0.14, metricBottom + 0.02, 0.72, 0.08),
          rotation: 0,
          content: planned.metricLabel,
          style: {
            color: theme.colors.muted,
            fontFamily: theme.typography.body,
            fontSize: 16,
            fontWeight: 500,
            lineHeight: 1.25,
            textAlign: 'center',
          },
          sourceIds: evidenceSourceIds(ctx),
          locked: false,
          exportCapabilities: [...EDITABLE_CAPABILITIES],
        }),
      );
      metricBottom += 0.1;
    }
  }
  if (planned.chart) {
    elements.push(buildChartElement(ctx, 0.14, 0.6, 0.72, 0.28));
  }
  // Body copy below metric
  const bodyY = metricBottom + 0.04;
  const bodyFontSize = fitTextFontSize(planned.body, 18, 14, 1.35, 0.79, 0.85 - bodyY);
  const bodyHeight = Math.min(
    0.85 - bodyY,
    Math.max(0.17, estimateTextHeight(planned.body, bodyFontSize, 1.35, 0.79)),
  );
  elements.push(
    makeElement(ctx, 'body', {
      name: 'Body copy',
      kind: 'text',
      role: 'body',
      bbox: box(0.07, bodyY, 0.79, bodyHeight),
      rotation: 0,
      content: planned.body,
      style: {
        color: theme.colors.muted,
        fontFamily: theme.typography.body,
        fontSize: bodyFontSize,
        fontWeight: 430,
        lineHeight: 1.35,
      },
      sourceIds: [ctx.sourceBriefId, ...ctx.linkedSourceIds],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  // Bullet elements below body
  const bulletTexts = planned.bullets
    .slice(0, 3)
    .map((bullet, bulletIndex) => `0${bulletIndex + 1}  ${bullet}`);
  const bulletFontSize = 14;
  const bulletX = 0.07;
  const bulletWidth = 0.79;
  const bulletStackStart = bodyY + bodyHeight + 0.02;
  let bulletCursor = bulletStackStart;
  bulletTexts.forEach((content, bulletIndex) => {
    const bulletHeight = Math.max(
      0.031,
      estimateTextHeight(content, bulletFontSize, 1.2, bulletWidth),
    );
    elements.push(
      makeElement(ctx, `bullet-${bulletIndex + 1}`, {
        name: `Key point ${bulletIndex + 1}`,
        kind: 'text',
        role: 'bullet',
        bbox: box(bulletX, bulletCursor, bulletWidth, bulletHeight),
        rotation: 0,
        content,
        style: {
          color: theme.colors.ink,
          fontFamily: theme.typography.body,
          fontSize: bulletFontSize,
          fontWeight: 560,
          lineHeight: 1.2,
        },
        sourceIds: [ctx.sourceBriefId, ...ctx.linkedSourceIds],
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
    bulletCursor += bulletHeight + 0.03;
  });
  elements.push(...storyContinuityElements(ctx));
  elements.push(...footerElements(ctx));
  resolveGeometryCollisions(elements, planned.title);
  return { elements, grammarId: 'metric-stage' };
}

// ============================================================================
// GRAMMAR 6: comparison-field
// 2-3 vertical columns with dividers, each with a number and text.
// No shared body above the columns.
// ============================================================================

function buildComparisonField(ctx: GrammarBuildContext): GrammarBuildResult {
  const { planned, theme } = ctx;
  const elements: SlideElement[] = [];
  const claimSourceIds = [ctx.sourceBriefId, ...ctx.linkedSourceIds];
  elements.push(sectionLabel(ctx, 0.07, 0.065, 0.4));
  const headlineFontSize = 36;
  const headlineWidth = 0.79;
  const headlineHeight = Math.min(
    0.14,
    Math.max(0.08, estimateTextHeight(planned.headline, headlineFontSize, 1.05, headlineWidth)),
  );
  elements.push(
    makeElement(ctx, 'headline', {
      name: 'Headline',
      kind: 'text',
      role: 'headline',
      bbox: box(0.07, 0.15, headlineWidth, headlineHeight),
      rotation: 0,
      content: planned.headline,
      style: {
        color: theme.colors.ink,
        fontFamily: theme.typography.display,
        fontSize: headlineFontSize,
        fontWeight: 620,
        lineHeight: 1.05,
        letterSpacing: -0.4,
      },
      sourceIds: [ctx.sourceBriefId],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  const bullets = planned.bullets.slice(0, 3);
  const colY = 0.15 + headlineHeight + 0.06;
  const colHeight = Math.min(0.42, 0.88 - colY);
  const colGap = 0.03;
  const colWidth = (0.86 - colGap * (bullets.length - 1)) / Math.max(1, bullets.length);
  bullets.forEach((bullet, index) => {
    const colX = 0.07 + index * (colWidth + colGap);
    if (index > 0) {
      elements.push(
        makeElement(ctx, `col-divider-${index}`, {
          name: `Column divider ${index}`,
          kind: 'shape',
          role: 'decoration',
          bbox: box(colX - colGap / 2, colY, 0.002, colHeight),
          rotation: 0,
          style: { fill: theme.colors.border, radius: 0 },
          sourceIds: [],
          locked: true,
          exportCapabilities: [...EDITABLE_CAPABILITIES],
        }),
      );
    }
    elements.push(
      makeElement(ctx, `col-number-${index + 1}`, {
        name: `Column ${index + 1} number`,
        kind: 'text',
        role: 'section',
        bbox: box(colX, colY, colWidth, 0.08),
        rotation: 0,
        content: `0${index + 1}`,
        style: {
          color: theme.colors.accent,
          fontFamily: theme.typography.data,
          fontSize: 22,
          fontWeight: 720,
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
    const colTextFontSize = fitTextFontSize(bullet, 17, 14, 1.3, colWidth - 0.02, colHeight - 0.1);
    elements.push(
      makeElement(ctx, `col-text-${index + 1}`, {
        name: `Column ${index + 1} text`,
        kind: 'text',
        role: 'bullet',
        bbox: box(colX, colY + 0.08, colWidth, colHeight - 0.08),
        rotation: 0,
        content: bullet,
        style: {
          color: theme.colors.ink,
          fontFamily: theme.typography.body,
          fontSize: colTextFontSize,
          fontWeight: 540,
          lineHeight: 1.3,
        },
        sourceIds: claimSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  });
  if (planned.chart && bullets.length <= 2) {
    elements.push(buildChartElement(ctx, 0.07, colY + colHeight + 0.03, 0.86, 0.2));
  }
  elements.push(...storyContinuityElements(ctx));
  elements.push(...footerElements(ctx));
  resolveGeometryCollisions(elements, planned.title);
  return { elements, grammarId: 'comparison-field' };
}

// ============================================================================
// GRAMMAR 8: sparse-transition
// Large section number in the corner, minimal text. Mostly empty canvas.
// Used for chapter transitions and breathing room.
// ============================================================================

function buildSparseTransition(ctx: GrammarBuildContext): GrammarBuildResult {
  const { planned, theme } = ctx;
  const elements: SlideElement[] = [];
  elements.push(
    makeElement(ctx, 'section-number', {
      name: 'Section number',
      kind: 'text',
      role: 'section',
      bbox: box(0.07, 0.08, 0.3, 0.2),
      rotation: 0,
      content: String(ctx.index + 1).padStart(2, '0'),
      style: {
        color: theme.colors.accent,
        fontFamily: theme.typography.display,
        fontSize: 120,
        fontWeight: 720,
        lineHeight: 1,
        letterSpacing: -3,
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  elements.push(
    makeElement(ctx, 'section-label', {
      name: 'Section label',
      kind: 'text',
      role: 'section',
      bbox: box(0.07, 0.3, 0.5, 0.05),
      rotation: 0,
      content: ctx.planned.section.toUpperCase(),
      style: {
        color: theme.colors.muted,
        fontFamily: theme.typography.data,
        fontSize: 14,
        fontWeight: 650,
        letterSpacing: 1.5,
      },
      sourceIds: [],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  const headlineFontSize = 40;
  const headlineWidth = 0.72;
  const headlineHeight = Math.min(
    0.2,
    Math.max(0.1, estimateTextHeight(planned.headline, headlineFontSize, 1.05, headlineWidth)),
  );
  elements.push(
    makeElement(ctx, 'headline', {
      name: 'Headline',
      kind: 'text',
      role: 'headline',
      bbox: box(0.07, 0.6, headlineWidth, headlineHeight),
      rotation: 0,
      content: planned.headline,
      style: {
        color: theme.colors.ink,
        fontFamily: theme.typography.display,
        fontSize: headlineFontSize,
        fontWeight: 620,
        lineHeight: 1.05,
        letterSpacing: -0.6,
      },
      sourceIds: [ctx.sourceBriefId],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  elements.push(
    makeElement(ctx, 'accent-line', {
      name: 'Accent line',
      kind: 'shape',
      role: 'decoration',
      bbox: box(0.07, 0.58, 0.06, 0.006),
      rotation: 0,
      style: { fill: theme.colors.accent, radius: 999 },
      sourceIds: [],
      locked: true,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  elements.push(...storyContinuityElements(ctx));
  elements.push(...footerElements(ctx));
  resolveGeometryCollisions(elements, planned.title);
  return { elements, grammarId: 'sparse-transition' };
}

// ============================================================================
// FALLBACK: tension/contrast field
// Two opposing blocks for before/after, current/target, or tension pairs.
// ============================================================================

function buildTensionContrastField(ctx: GrammarBuildContext): GrammarBuildResult {
  const { planned, theme } = ctx;
  const elements: SlideElement[] = [];
  const claimSourceIds = [ctx.sourceBriefId, ...ctx.linkedSourceIds];
  elements.push(sectionLabel(ctx, 0.07, 0.065, 0.4));
  const headlineFontSize = 38;
  const headlineWidth = 0.79;
  const headlineHeight = Math.min(
    0.16,
    Math.max(0.1, estimateTextHeight(planned.headline, headlineFontSize, 1.05, headlineWidth)),
  );
  elements.push(
    makeElement(ctx, 'headline', {
      name: 'Headline',
      kind: 'text',
      role: 'headline',
      bbox: box(0.07, 0.15, headlineWidth, headlineHeight),
      rotation: 0,
      content: planned.headline,
      style: {
        color: theme.colors.ink,
        fontFamily: theme.typography.display,
        fontSize: headlineFontSize,
        fontWeight: 620,
        lineHeight: 1.05,
      },
      sourceIds: [ctx.sourceBriefId],
      locked: false,
      exportCapabilities: [...EDITABLE_CAPABILITIES],
    }),
  );
  const blockY = 0.15 + headlineHeight + 0.06;
  const blockHeight = Math.min(0.3, 0.88 - blockY);
  const blockGap = 0.04;
  const blockWidth = (0.86 - blockGap) / 2;
  const bullets = planned.bullets.slice(0, 2);
  const labels = ['Current', 'Target'];
  bullets.forEach((bullet, index) => {
    const blockX = 0.07 + index * (blockWidth + blockGap);
    elements.push(
      makeElement(ctx, `tension-block-${index + 1}`, {
        name: `${labels[index]} state`,
        kind: 'shape',
        role: 'evidence_card',
        bbox: box(blockX, blockY, blockWidth, blockHeight),
        rotation: 0,
        style: {
          fill: index === 0 ? theme.colors.accentSoft : theme.colors.insight,
          stroke: theme.colors.border,
          strokeWidth: 1,
          radius: theme.defaultRadius,
        },
        sourceIds: claimSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
    elements.push(
      makeElement(ctx, `tension-label-${index + 1}`, {
        name: labels[index] ?? '',
        kind: 'text',
        role: 'section',
        bbox: box(blockX + 0.02, blockY + 0.02, blockWidth - 0.04, 0.04),
        rotation: 0,
        content: (labels[index] ?? '').toUpperCase(),
        style: {
          color: index === 0 ? theme.colors.accent : theme.colors.insightInk,
          fontFamily: theme.typography.data,
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: 1.2,
        },
        sourceIds: [],
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
    const textFontSize = fitTextFontSize(bullet, 16, 13, 1.3, blockWidth - 0.04, blockHeight - 0.1);
    elements.push(
      makeElement(ctx, `tension-text-${index + 1}`, {
        name: `${labels[index]} detail`,
        kind: 'text',
        role: 'bullet',
        bbox: box(blockX + 0.02, blockY + 0.08, blockWidth - 0.04, blockHeight - 0.1),
        rotation: 0,
        content: bullet,
        style: {
          color: theme.colors.ink,
          fontFamily: theme.typography.body,
          fontSize: textFontSize,
          fontWeight: 540,
          lineHeight: 1.3,
        },
        sourceIds: claimSourceIds,
        locked: false,
        exportCapabilities: [...EDITABLE_CAPABILITIES],
      }),
    );
  });
  elements.push(...storyContinuityElements(ctx));
  elements.push(...footerElements(ctx));
  resolveGeometryCollisions(elements, planned.title);
  return { elements, grammarId: 'evidence-dossier' };
}

// ============================================================================
// DISPATCH
// ============================================================================

export function dispatchCompositionGrammar(
  archetype: string,
  ctx: GrammarBuildContext,
): GrammarBuildResult {
  const { planned } = ctx;
  const hasDiagram = planned.diagram !== undefined;
  const hasChart = planned.chart !== undefined;
  const hasMetric = planned.metric !== undefined;
  const hasFormula = planned.formula !== undefined;
  const hasImage = planned.image !== undefined;
  const hasVideo = planned.video !== undefined;
  const bulletCount = planned.bullets.length;
  const isOpening = ctx.index === 0;
  const isTransition = planned.section.toLowerCase().includes('transition');

  // Qualitative fallbacks: when quantitative evidence fails, preserve
  // narrative with non-quantitative compositions.
  const isQuarantinedQuantitative =
    planned.headline.includes('release gate stays closed') ||
    planned.body.includes('does not invent a quantitative outlook');

  if (isQuarantinedQuantitative && bulletCount >= 2) {
    return buildTensionContrastField(ctx);
  }

  // Archetype-driven defaults
  if (isOpening && !hasDiagram && !hasChart && !hasMetric) return buildFullBleedThesis(ctx);
  if (isTransition) return buildSparseTransition(ctx);
  if (hasMetric && !hasChart && !hasDiagram) return buildMetricStage(ctx);
  if (hasChart && !hasDiagram) return buildAsymmetricEditorial(ctx);
  if (hasDiagram) return buildProcessCanvas(ctx);
  if (hasFormula) return buildAsymmetricEditorial(ctx);
  if (hasImage || hasVideo) return buildAsymmetricEditorial(ctx);
  if (bulletCount >= 2 && archetype === 'comparison') return buildComparisonField(ctx);
  if (bulletCount >= 2) return buildEvidenceDossier(ctx);
  return buildAsymmetricEditorial(ctx);
}
