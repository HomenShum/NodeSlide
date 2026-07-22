import type { DeckBrief } from '../../shared/nodeslide';
import {
  NODESLIDE_ARTIFACT_GEOMETRY_VERSION,
  type NodeSlideNativeArtifactGeometry,
  compileNodeSlideNativeArtifactGeometry,
} from '../../shared/nodeslideArtifactGeometry.js';
import {
  NODESLIDE_ARTIFACT_COMPILER_REGISTRY,
  NODESLIDE_ARTIFACT_SPEC_VERSION,
  NODESLIDE_CANONICAL_ARTIFACT_KINDS,
  NODESLIDE_LEGACY_AUTHORED_ARTIFACT_VERSION,
  type NodeSlideArtifactExpression,
  type NodeSlideCanonicalArtifactIssue,
  type NodeSlideCanonicalArtifactKind,
  type NodeSlideCanonicalArtifactSpec,
  type NodeSlideCanonicalArtifactValidationOptions,
  type NodeSlideCanonicalTruthState,
  canonicalArtifactSchemaForKinds,
  isNodeSlideSha256Digest,
  isSafeNodeSlideArtifactSourceUrl,
  normalizeNodeSlideCanonicalArtifactSpec,
} from '../../shared/nodeslideArtifactRegistry.js';
import { nodeSlideArtifactDigest } from '../../shared/nodeslideArtifactSpec';
import type { NodeSlideDataAttachment } from '../../shared/nodeslideAttachments';
import type {
  NodeSlidePlannedChart,
  NodeSlidePlannedDiagram,
  NodeSlidePlannedFormula,
  NodeSlidePlannedImage,
} from './nodeslideSeed';

/** Legacy provider responses remain readable, but new prompts use the canonical version. */
export const NODESLIDE_AUTHORED_ARTIFACT_VERSION = NODESLIDE_LEGACY_AUTHORED_ARTIFACT_VERSION;
export const NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION = NODESLIDE_ARTIFACT_SPEC_VERSION;
export const NODESLIDE_AUTHORED_ARTIFACT_RECEIPT_VERSION =
  'nodeslide.production-authored-artifact-receipt/v2' as const;

export type NodeSlideAuthoredArtifactKind = NodeSlideCanonicalArtifactKind;
export type NodeSlideAuthoredArtifactSpec = NodeSlideCanonicalArtifactSpec;

export interface NodeSlideAuthoredArtifactReceipt {
  schemaVersion: typeof NODESLIDE_AUTHORED_ARTIFACT_RECEIPT_VERSION;
  authoredSpecVersion: typeof NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION;
  acceptedSpecVersion:
    | typeof NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION
    | typeof NODESLIDE_AUTHORED_ARTIFACT_VERSION;
  artifactId: string;
  kind: NodeSlideAuthoredArtifactKind;
  sourceRefs: string[];
  authoredSpecDigest: string;
  geometryVersion?: typeof NODESLIDE_ARTIFACT_GEOMETRY_VERSION;
  geometryDigest?: string;
  renderHandle: `nodeslide-render:sha256:${string}`;
  renderLineage: {
    baseInputDigest: string;
    candidateSpecDigest: string;
    materializationDigest: string;
    projectionDigest: string;
    baseImmutable: true;
  };
  typedRecovery: {
    status: 'not-required' | 'recovered';
    mode: 'none' | 'legacy-exact-normalization';
    operations: string[];
  };
  compiler: 'nodeslide-canonical-artifact-adapter/2.0.0';
  projection: {
    primitive: 'statement' | 'chart' | 'diagram' | 'image' | 'formula' | 'metric';
    mode: 'native' | 'semantic-adapter' | 'summary-fallback' | 'static-fallback';
    browserContract: 'semantic' | 'declared-static-fallback';
    pptxContract: 'editable' | 'declared-static-fallback';
    editability: 'native' | 'grouped-editable' | 'static-fallback';
    knownFidelityDifferences: string[];
  };
  repairIssues: [];
  status: 'passed';
  receiptDigest: string;
}

export interface NodeSlideAuthoredArtifactMaterialization {
  chart?: NodeSlidePlannedChart;
  diagram?: NodeSlidePlannedDiagram;
  formula?: NodeSlidePlannedFormula;
  image?: NodeSlidePlannedImage;
  metric?: string;
  metricLabel?: string;
}

export interface NodeSlideAuthoredArtifactCompilation {
  spec: NodeSlideAuthoredArtifactSpec;
  planned: NodeSlideAuthoredArtifactMaterialization;
  geometry?: NodeSlideNativeArtifactGeometry;
  receipt: NodeSlideAuthoredArtifactReceipt;
}

export interface NodeSlideAuthoredArtifactSourceInventoryItem {
  ref: string;
  label: string;
  kind: 'brief' | 'success-criteria' | 'attachment' | 'link' | 'runtime-receipt';
  evidenceClass: 'instruction' | 'criteria' | 'immutable-upload' | 'unfetched-link' | 'receipt';
  allowedTruthStates: readonly NodeSlideCanonicalTruthState[];
  url?: string;
  receiptDigests?: readonly string[];
}

const NON_MEASURED_TRUTH_STATES = [
  'derived',
  'illustrative',
  'missing',
  'not-run',
] as const satisfies readonly NodeSlideCanonicalTruthState[];

const IMMUTABLE_EVIDENCE_TRUTH_STATES = [
  'observed',
  'derived',
  'estimated',
  'illustrative',
  'missing',
  'not-run',
] as const satisfies readonly NodeSlideCanonicalTruthState[];

export class NodeSlideAuthoredArtifactValidationError extends Error {
  readonly issues: readonly NodeSlideCanonicalArtifactIssue[];

  constructor(issues: readonly NodeSlideCanonicalArtifactIssue[]) {
    const first = issues[0];
    super(
      `NodeSlide authored ArtifactSpec failed [${first?.code ?? 'artifact_shape'}] at ${first?.path ?? '$'}: ${first?.message ?? 'invalid artifact'}`,
    );
    this.name = 'NodeSlideAuthoredArtifactValidationError';
    this.issues = issues;
  }
}

export function nodeSlideAuthoredArtifactSourceInventory(
  brief: DeckBrief,
  attachments: readonly NodeSlideDataAttachment[] = [],
): NodeSlideAuthoredArtifactSourceInventoryItem[] {
  return [
    {
      ref: 'brief:prompt',
      label: 'Creation brief',
      kind: 'brief',
      evidenceClass: 'instruction',
      allowedTruthStates: NON_MEASURED_TRUTH_STATES,
    },
    {
      ref: 'brief:success-criteria',
      label: 'Brief success criteria',
      kind: 'success-criteria',
      evidenceClass: 'criteria',
      allowedTruthStates: NON_MEASURED_TRUTH_STATES,
    },
    ...attachments.map((attachment, index) => ({
      ref: `attachment:${index + 1}`,
      label: attachment.title,
      kind: 'attachment' as const,
      evidenceClass: 'immutable-upload' as const,
      allowedTruthStates: IMMUTABLE_EVIDENCE_TRUTH_STATES,
    })),
    ...nodeSlideAuthoredArtifactLinkedUrls(brief.prompt).map((url, index) => ({
      ref: `link:${index + 1}`,
      label: url,
      kind: 'link' as const,
      evidenceClass: 'unfetched-link' as const,
      allowedTruthStates: NON_MEASURED_TRUTH_STATES,
      url,
    })),
  ];
}

export function nodeSlideAuthoredArtifactValidationOptions(
  inventory: readonly NodeSlideAuthoredArtifactSourceInventoryItem[],
): NodeSlideCanonicalArtifactValidationOptions {
  return {
    allowedSourceRefs: inventory.map((source) => source.ref),
    allowedTruthStatesBySourceRef: Object.fromEntries(
      inventory.map((source) => [source.ref, source.allowedTruthStates]),
    ),
    allowedSourceUrlsBySourceRef: Object.fromEntries(
      inventory.flatMap((source) => (source.url ? [[source.ref, source.url]] : [])),
    ),
    allowedReceiptDigestsBySourceRef: Object.fromEntries(
      inventory.flatMap((source) =>
        source.receiptDigests && source.receiptDigests.length > 0
          ? [[source.ref, source.receiptDigests]]
          : [],
      ),
    ),
  };
}

export function nodeSlideAuthoredArtifactLinkedUrls(prompt: string): string[] {
  return [
    ...new Set(
      (prompt.match(/https:\/\/[^\s<>()]+/gu) ?? []).map((url) =>
        url.replace(/[.,;:!?]+$/u, '').slice(0, 900),
      ),
    ),
  ]
    .filter(isSafeNodeSlideArtifactSourceUrl)
    .slice(0, 8);
}

/**
 * Keep the schema slice small by default, then add only advanced families the
 * brief actually names. Every registry family is still available when a task
 * calls for it, without asking a small model to learn the whole universe.
 */
export function nodeSlideAuthoredArtifactKindsForBrief(
  brief: DeckBrief,
): NodeSlideCanonicalArtifactKind[] {
  const text = `${brief.prompt} ${brief.purpose} ${brief.successCriteria.join(' ')}`.toLowerCase();
  const kinds = new Set<NodeSlideCanonicalArtifactKind>([
    'generic',
    'chart',
    'graph',
    'equation',
    'evidence-media',
    'comparison',
  ]);
  const rules: Array<[NodeSlideCanonicalArtifactKind, RegExp]> = [
    ['waterfall', /\bwaterfall\b/u],
    ['sankey', /\bsankey\b|\bflow (?:volume|quantity)\b/u],
    ['causal-loop', /\bcausal(?: loop)?\b|\breinforcing loop\b|\bbalancing loop\b/u],
    ['timeline', /\btimeline\b|\bchronolog/u],
    ['gantt', /\bgantt\b|\bproject schedule\b/u],
    ['motion', /\banimat|\bmotion\b|\bstate transition\b/u],
    ['runtime-proof', /\bruntime\b|\blatency\b|\bbenchmark\b/u],
    ['trace', /\btrace\b|\bspan\b|\bobservability\b/u],
    ['risk-matrix', /\brisk matrix\b|\blikelihood.{0,20}impact\b/u],
    ['spatial-scene', /\bspatial\b|\bviewport\b|\bmap view\b/u],
  ];
  for (const [kind, pattern] of rules) if (pattern.test(text)) kinds.add(kind);
  return NODESLIDE_CANONICAL_ARTIFACT_KINDS.filter((kind) => kinds.has(kind));
}

export function nodeSlideAuthoredArtifactJsonSchema(
  kinds: readonly NodeSlideCanonicalArtifactKind[],
  allowedSourceRefs: readonly string[],
): Record<string, unknown> {
  const schema = canonicalArtifactSchemaForKinds(kinds) as {
    oneOf: Array<{
      properties: {
        provenance: { properties: { sourceRefs: { items: Record<string, unknown> } } };
        sourceIds: { items: Record<string, unknown> };
      };
    }>;
  };
  for (const variant of schema.oneOf) {
    variant.properties.provenance.properties.sourceRefs.items = {
      enum: [...allowedSourceRefs],
    };
    variant.properties.sourceIds.items = { enum: [...allowedSourceRefs] };
  }
  return schema;
}

/**
 * Validates canonical intent before geometry, resolves source refs, and then
 * adapts it deterministically to an existing SlideLang primitive. Unsupported
 * native geometry is never invented: the registry declares the exact fallback.
 */
export function compileNodeSlideAuthoredArtifact(
  value: unknown,
  options: NodeSlideCanonicalArtifactValidationOptions = {},
): NodeSlideAuthoredArtifactCompilation {
  const acceptedSpecVersion = readSchemaVersion(value);
  const normalized = normalizeNodeSlideCanonicalArtifactSpec(value, options);
  if (!normalized.ok || !normalized.spec) {
    throw new NodeSlideAuthoredArtifactValidationError(normalized.issues);
  }
  const spec = normalized.spec;
  const geometry = compileNodeSlideNativeArtifactGeometry(spec, {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });
  const registryProjection = NODESLIDE_ARTIFACT_COMPILER_REGISTRY[spec.kind];
  const materialization = compileCanonicalPayload(spec);
  const projection = materialization.projection ?? registryProjection;
  const planned = materialization.planned;
  const authoredSpecDigest = nodeSlideArtifactDigest(spec);
  const renderLineage = {
    baseInputDigest: nodeSlideArtifactDigest(value),
    candidateSpecDigest: authoredSpecDigest,
    materializationDigest: nodeSlideArtifactDigest({ planned, geometry }),
    projectionDigest: nodeSlideArtifactDigest(projection),
    baseImmutable: true as const,
  };
  const typedRecovery = typedRecoveryFor(value, acceptedSpecVersion);
  const renderHandle = `nodeslide-render:${nodeSlideArtifactDigest({
    artifactId: spec.id,
    kind: spec.kind,
    ...renderLineage,
  })}` as NodeSlideAuthoredArtifactReceipt['renderHandle'];
  const unsigned: Omit<NodeSlideAuthoredArtifactReceipt, 'receiptDigest'> = {
    schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_RECEIPT_VERSION,
    authoredSpecVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
    acceptedSpecVersion,
    artifactId: spec.id,
    kind: spec.kind,
    sourceRefs: [...spec.provenance.sourceRefs],
    authoredSpecDigest,
    ...(geometry
      ? {
          geometryVersion: NODESLIDE_ARTIFACT_GEOMETRY_VERSION,
          geometryDigest: nodeSlideArtifactDigest(geometry),
        }
      : {}),
    renderHandle,
    renderLineage,
    typedRecovery,
    compiler: 'nodeslide-canonical-artifact-adapter/2.0.0',
    projection,
    repairIssues: [],
    status: 'passed',
  };
  const receipt = { ...unsigned, receiptDigest: nodeSlideArtifactDigest(unsigned) };
  if (!nodeSlideAuthoredArtifactReceiptLineageMatches(spec, receipt, value)) {
    throw new Error('NodeSlide authored ArtifactSpec receipt failed its internal lineage check.');
  }
  return {
    spec,
    planned,
    ...(geometry ? { geometry } : {}),
    receipt,
  };
}

export function nodeSlideAuthoredArtifactReceiptLineageMatches(
  spec: NodeSlideAuthoredArtifactSpec,
  receipt: NodeSlideAuthoredArtifactReceipt,
  baseInput?: unknown,
): boolean {
  const { receiptDigest, ...unsigned } = receipt;
  const materialization = compileCanonicalPayload(spec);
  const expectedGeometry = compileNodeSlideNativeArtifactGeometry(spec, {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });
  const expectedGeometryDigest = expectedGeometry
    ? nodeSlideArtifactDigest(expectedGeometry)
    : undefined;
  const expectedProjection =
    materialization.projection ?? NODESLIDE_ARTIFACT_COMPILER_REGISTRY[spec.kind];
  const expectedMaterializationDigest = nodeSlideArtifactDigest({
    planned: materialization.planned,
    geometry: expectedGeometry,
  });
  const expectedProjectionDigest = nodeSlideArtifactDigest(expectedProjection);
  const expectedRenderHandle = `nodeslide-render:${nodeSlideArtifactDigest({
    artifactId: spec.id,
    kind: spec.kind,
    ...receipt.renderLineage,
  })}`;
  return (
    receipt.schemaVersion === NODESLIDE_AUTHORED_ARTIFACT_RECEIPT_VERSION &&
    receipt.authoredSpecVersion === NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION &&
    [NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION, NODESLIDE_AUTHORED_ARTIFACT_VERSION].includes(
      receipt.acceptedSpecVersion,
    ) &&
    receipt.artifactId === spec.id &&
    receipt.kind === spec.kind &&
    receipt.sourceRefs.join('\u001f') === spec.provenance.sourceRefs.join('\u001f') &&
    isNodeSlideSha256Digest(receipt.authoredSpecDigest) &&
    receipt.authoredSpecDigest === nodeSlideArtifactDigest(spec) &&
    (expectedGeometry
      ? receipt.geometryVersion === NODESLIDE_ARTIFACT_GEOMETRY_VERSION &&
        receipt.geometryDigest === expectedGeometryDigest &&
        isNodeSlideSha256Digest(receipt.geometryDigest)
      : receipt.geometryVersion === undefined && receipt.geometryDigest === undefined) &&
    isNodeSlideSha256Digest(receipt.renderLineage.baseInputDigest) &&
    (baseInput === undefined ||
      receipt.renderLineage.baseInputDigest === nodeSlideArtifactDigest(baseInput)) &&
    receipt.renderLineage.candidateSpecDigest === receipt.authoredSpecDigest &&
    receipt.renderLineage.materializationDigest === expectedMaterializationDigest &&
    receipt.renderLineage.projectionDigest === expectedProjectionDigest &&
    receipt.renderLineage.baseImmutable === true &&
    receipt.renderHandle === expectedRenderHandle &&
    /^nodeslide-render:sha256:[0-9a-f]{64}$/u.test(receipt.renderHandle) &&
    typedRecoveryMatches(receipt, baseInput) &&
    nodeSlideArtifactDigest(receipt.projection) === nodeSlideArtifactDigest(expectedProjection) &&
    receipt.compiler === 'nodeslide-canonical-artifact-adapter/2.0.0' &&
    receipt.repairIssues.length === 0 &&
    receipt.status === 'passed' &&
    isNodeSlideSha256Digest(receiptDigest) &&
    receiptDigest === nodeSlideArtifactDigest(unsigned)
  );
}

const LEGACY_RECOVERY_OPERATIONS = {
  chart: 'legacy.chart.labels-values-to-axis-series',
  graph: 'legacy.graph.directed-edge-normalization',
  equation: 'legacy.equation.expression-to-ast',
  metric: 'legacy.metric-to-generic',
} as const;

function typedRecoveryFor(
  baseInput: unknown,
  acceptedSpecVersion: NodeSlideAuthoredArtifactReceipt['acceptedSpecVersion'],
): NodeSlideAuthoredArtifactReceipt['typedRecovery'] {
  if (acceptedSpecVersion === NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION) {
    return { status: 'not-required', mode: 'none', operations: [] };
  }
  const kind =
    typeof baseInput === 'object' && baseInput !== null && !Array.isArray(baseInput)
      ? (baseInput as Record<string, unknown>)['kind']
      : undefined;
  const operation =
    typeof kind === 'string' && Object.hasOwn(LEGACY_RECOVERY_OPERATIONS, kind)
      ? LEGACY_RECOVERY_OPERATIONS[kind as keyof typeof LEGACY_RECOVERY_OPERATIONS]
      : 'legacy.schema-version-only';
  return {
    status: 'recovered',
    mode: 'legacy-exact-normalization',
    operations: [operation],
  };
}

function typedRecoveryMatches(
  receipt: NodeSlideAuthoredArtifactReceipt,
  baseInput: unknown,
): boolean {
  if (baseInput !== undefined) {
    return (
      nodeSlideArtifactDigest(receipt.typedRecovery) ===
      nodeSlideArtifactDigest(typedRecoveryFor(baseInput, receipt.acceptedSpecVersion))
    );
  }
  if (receipt.acceptedSpecVersion === NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION) {
    return (
      receipt.typedRecovery.status === 'not-required' &&
      receipt.typedRecovery.mode === 'none' &&
      receipt.typedRecovery.operations.length === 0
    );
  }
  const allowed = new Set<string>([
    ...Object.values(LEGACY_RECOVERY_OPERATIONS),
    'legacy.schema-version-only',
  ]);
  return (
    receipt.typedRecovery.status === 'recovered' &&
    receipt.typedRecovery.mode === 'legacy-exact-normalization' &&
    receipt.typedRecovery.operations.length === 1 &&
    allowed.has(receipt.typedRecovery.operations[0] ?? '')
  );
}

function compileCanonicalPayload(spec: NodeSlideCanonicalArtifactSpec): {
  planned: NodeSlideAuthoredArtifactMaterialization;
  projection?: NodeSlideAuthoredArtifactReceipt['projection'];
} {
  switch (spec.kind) {
    case 'generic': {
      const displayValue = asNonEmptyString(spec.payload.displayValue) ?? 'Typed artifact';
      const label = asNonEmptyString(spec.payload.label) ?? spec.narrativeJob;
      return { planned: { metric: displayValue.slice(0, 24), metricLabel: label.slice(0, 100) } };
    }
    case 'chart': {
      const series = spec.payload.series[0];
      const values = series?.values ?? [];
      if (values.some((value) => value === null)) {
        const measuredValueCount = values.filter((value) => value !== null).length;
        return {
          planned: {
            metric: `${measuredValueCount}/${values.length} values`,
            metricLabel: `Chart summary — missing values follow ${spec.payload.missingValuePolicy ?? 'an undeclared policy'}`,
          },
          projection: summaryProjection('chart', [
            'Null values remain explicit in the spec; the current chart primitive uses an honest summary fallback.',
          ]),
        };
      }
      return {
        planned: {
          chart: {
            labels: spec.payload.xAxis.labels.slice(0, 8),
            values: values.filter((value): value is number => value !== null).slice(0, 8),
            unit: spec.payload.unit.slice(0, 16),
          },
        },
      };
    }
    case 'waterfall':
      return {
        planned: {
          chart: {
            labels: ['Baseline', ...spec.payload.deltas.map((delta) => delta.label), 'Final'].slice(
              0,
              8,
            ),
            values: [
              spec.payload.baseline,
              ...spec.payload.deltas.map((delta) => delta.value),
              spec.payload.final,
            ].slice(0, 8),
            unit: spec.payload.unit.slice(0, 16),
          },
        },
      };
    case 'sankey':
      return {
        planned: {
          diagram: diagram(
            'architecture',
            spec.payload.nodes.map((node) => ({ id: node.id, label: node.label ?? node.id })),
            spec.payload.links.map((link) => ({
              from: link.source,
              to: link.target,
              label: `${link.value} ${spec.payload.unit}`.slice(0, 64),
            })),
          ),
        },
      };
    case 'graph':
      return {
        planned: {
          diagram: diagram(
            spec.payload.graphKind ?? 'architecture',
            spec.payload.nodes.map((node) => ({
              id: node.id,
              label: node.label ?? node.id,
              ...(node.kind ? { kind: node.kind } : {}),
            })),
            spec.payload.edges.map((edge) => ({
              from: edge.from,
              to: edge.to,
              ...(edge.label ? { label: edge.label } : {}),
            })),
            spec.payload.direction,
          ),
        },
      };
    case 'causal-loop':
      return {
        planned: {
          diagram: diagram(
            'architecture',
            spec.payload.nodes.map((node) => ({ id: node.id, label: node.label ?? node.id })),
            spec.payload.edges.map((edge) => ({
              from: edge.from,
              to: edge.to,
              label: `${edge.polarity}${edge.label ? ` ${edge.label}` : ''}`.slice(0, 64),
            })),
          ),
        },
      };
    case 'timeline': {
      const events = [...spec.payload.events].sort(
        (left, right) => left.start - right.start || left.id.localeCompare(right.id),
      );
      return {
        planned: {
          diagram: diagram(
            'timeline',
            events.map((event) => ({
              id: event.id,
              label: `${event.label ?? event.id} (${event.start}-${event.end} ${spec.payload.unit})`,
              kind: 'milestone',
            })),
            events.slice(1).map((event, index) => ({
              from: (events[index] as (typeof events)[number]).id,
              to: event.id,
            })),
          ),
        },
      };
    }
    case 'gantt':
      return {
        planned: {
          diagram: diagram(
            'timeline',
            spec.payload.tasks.map((task) => ({
              id: task.id,
              label: `${task.label ?? task.id} (${task.start}-${task.end} ${spec.payload.unit}; ${Math.round(task.confidence * 100)}%)`,
              kind: 'milestone',
            })),
            spec.payload.tasks.flatMap((task) =>
              (task.dependsOn ?? []).map((dependency) => ({
                from: dependency,
                to: task.id,
                label: 'depends on',
              })),
            ),
          ),
        },
      };
    case 'evidence-media':
      return {
        planned: {
          image: {
            altText:
              spec.payload.altText ??
              `Evidence ${spec.payload.claimId}; ${spec.payload.mimeType}; digest ${spec.payload.digest.slice(0, 18)}`,
            caption: spec.payload.sourceUrl
              ? `Evidence source bound to ${spec.payload.claimId}; remote media is not loaded automatically.`
              : `Evidence placeholder — ${spec.payload.mimeType} digest is bound, but no renderable URL was supplied.`,
          },
        },
      };
    case 'motion': {
      const states = spec.payload.states;
      return {
        planned: {
          diagram: diagram(
            'process',
            states.map((state) => ({
              id: state.id,
              label: `${state.label ?? state.id}${state.id === spec.payload.staticFallbackStateId ? ' [static]' : ''}`,
            })),
            states.slice(1).map((state, index) => ({
              from: (states[index] as (typeof states)[number]).id,
              to: state.id,
              ...(spec.payload.transition ? { label: spec.payload.transition } : {}),
            })),
          ),
        },
      };
    }
    case 'comparison': {
      const metric = spec.payload.metrics[0];
      const cohorts = spec.payload.cohorts.filter(
        (cohort) => metric && Number.isFinite(cohort.values[metric.id]),
      );
      if (metric && cohorts.length >= 2) {
        return {
          planned: {
            chart: {
              labels: cohorts.slice(0, 8).map((cohort) => cohort.label ?? cohort.id),
              values: cohorts.slice(0, 8).map((cohort) => cohort.values[metric.id] as number),
              unit: metric.unit.slice(0, 16),
            },
          },
        };
      }
      return {
        planned: {
          metric: `${cohorts.length} cohorts`,
          metricLabel: `${metric?.id ?? 'Comparison'} — no compatible plotted metric`,
        },
        projection: summaryProjection('comparison', [
          'No metric had at least two finite cohort values; an explicit summary is used.',
        ]),
      };
    }
    case 'equation': {
      const expression = expressionToText(spec.payload.expression);
      return {
        planned: {
          formula: {
            expression,
            display: spec.payload.renderedExpression ?? `${expression} = ${spec.payload.result}`,
            syntax: spec.payload.syntax ?? 'plain',
            variables: Object.entries(spec.payload.values).map(([label, value]) => ({
              label,
              value,
            })),
          },
        },
      };
    }
    case 'runtime-proof':
      return {
        planned: {
          metric: `${spec.payload.sampleSize} samples`,
          metricLabel:
            spec.payload.status === 'illustrative-not-measured'
              ? `Runtime ${spec.payload.unit} — illustrative, not measured`
              : `Runtime proof · ${spec.payload.unit} · receipt bound`,
        },
      };
    case 'trace': {
      if (spec.payload.spans.length >= 2) {
        const spanIds = new Set(spec.payload.spans.map((span) => span.spanId));
        return {
          planned: {
            diagram: diagram(
              'process',
              spec.payload.spans.slice(0, 7).map((span) => ({
                id: span.spanId,
                label: span.label ?? span.spanId,
              })),
              spec.payload.spans.slice(0, 7).flatMap((span, index) => {
                const parent = span.parentSpanId;
                if (parent && spanIds.has(parent)) return [{ from: parent, to: span.spanId }];
                if (index === 0) return [];
                return [
                  {
                    from: (spec.payload.spans[index - 1] as (typeof spec.payload.spans)[number])
                      .spanId,
                    to: span.spanId,
                  },
                ];
              }),
            ),
          },
        };
      }
      return {
        planned: {
          metric: `${spec.payload.spans.length} spans`,
          metricLabel: `Trace ${spec.payload.status} — no timing geometry claimed`,
        },
        projection: summaryProjection('trace', [
          'Fewer than two spans were supplied; an explicit trace summary is used.',
        ]),
      };
    }
    case 'risk-matrix':
      return {
        planned: {
          metric: `${spec.payload.risks.length} risks`,
          metricLabel: `${spec.payload.likelihoodAxis.low}→${spec.payload.likelihoodAxis.high} likelihood · ${spec.payload.impactAxis.low}→${spec.payload.impactAxis.high} impact`,
        },
      };
    case 'spatial-scene': {
      const viewports = spec.payload.viewports.slice(0, 7);
      return {
        planned: {
          diagram: diagram(
            'architecture',
            viewports.map((viewport) => ({
              id: viewport.id,
              label: `${viewport.id}${viewport.selectedNodeId ? ` · ${viewport.selectedNodeId}` : ''}`,
            })),
            viewports.slice(1).map((viewport, index) => ({
              from: (viewports[index] as (typeof viewports)[number]).id,
              to: viewport.id,
              label: 'viewport',
            })),
            'vertical',
          ),
        },
      };
    }
  }
}

function diagram(
  kind: NodeSlidePlannedDiagram['kind'],
  nodes: NodeSlidePlannedDiagram['nodes'],
  edges: NodeSlidePlannedDiagram['edges'],
  direction: NodeSlidePlannedDiagram['direction'] = 'horizontal',
): NodeSlidePlannedDiagram {
  return {
    kind,
    direction,
    nodes: nodes.slice(0, 7).map((node) => ({ ...node, label: node.label.slice(0, 80) })),
    edges: edges
      .filter(
        (edge) =>
          nodes.some((node) => node.id === edge.from) &&
          nodes.some((node) => node.id === edge.to) &&
          edge.from !== edge.to,
      )
      .slice(0, 10),
  };
}

function summaryProjection(
  kind: NodeSlideCanonicalArtifactKind,
  differences: string[],
): NodeSlideAuthoredArtifactReceipt['projection'] {
  const base = NODESLIDE_ARTIFACT_COMPILER_REGISTRY[kind];
  return {
    ...base,
    primitive: 'metric',
    mode: 'summary-fallback',
    browserContract: 'semantic',
    pptxContract: 'editable',
    editability: 'grouped-editable',
    knownFidelityDifferences: [...base.knownFidelityDifferences, ...differences],
  };
}

function expressionToText(expression: NodeSlideArtifactExpression): string {
  if (expression.op === 'value') return expression.name ?? '?';
  const args = expression.args ?? [];
  if (expression.op === 'add') return `(${args.map(expressionToText).join(' + ')})`;
  if (expression.op === 'multiply') return `(${args.map(expressionToText).join(' × ')})`;
  if (expression.op === 'subtract')
    return `(${expressionToText(args[0] as NodeSlideArtifactExpression)} - ${expressionToText(args[1] as NodeSlideArtifactExpression)})`;
  return `(${expressionToText(args[0] as NodeSlideArtifactExpression)} / ${expressionToText(args[1] as NodeSlideArtifactExpression)})`;
}

function readSchemaVersion(
  value: unknown,
): NodeSlideAuthoredArtifactReceipt['acceptedSpecVersion'] {
  const version =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)['schemaVersion']
      : undefined;
  if (
    version === NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION ||
    version === NODESLIDE_AUTHORED_ARTIFACT_VERSION
  ) {
    return version;
  }
  return NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
