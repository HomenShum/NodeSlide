import type { DeckSnapshot, ElementKind, SlideElement } from './nodeslide';
import {
  NODESLIDE_CANONICAL_ARTIFACT_KINDS,
  type NodeSlideArtifactCompilerDescriptor,
  type NodeSlideCanonicalArtifactKind,
  isNodeSlideSha256Digest,
} from './nodeslideArtifactRegistry.js';
/*
 * The compiler registry itself owns canonical authoring. This file remains a
 * distinct post-materialization projection and export receipt.
 */

export const NODESLIDE_PRODUCTION_ARTIFACT_SPEC_VERSION =
  'nodeslide.production-artifact-spec/v1' as const;
export const NODESLIDE_PRODUCTION_ARTIFACT_BINDING_VERSION =
  'nodeslide.production-artifact-binding/v1' as const;
export const NODESLIDE_LEGACY_ARTIFACT_BINDING_VERSION = 'nodeslide.artifact-binding/v1' as const;
export const NODESLIDE_ARTIFACT_COMPILATION_RECEIPT_VERSION =
  'nodeslide.production-artifact-compilation-receipt/v1' as const;
export const NODESLIDE_ARTIFACT_SHADOW_RECEIPT_VERSION =
  'nodeslide.artifact-shadow-receipt/v1' as const;
export const NODESLIDE_AUTHORED_ARTIFACT_BINDING_VERSION =
  'nodeslide.authored-artifact-binding/v1' as const;

export const NODESLIDE_ARTIFACT_TRUTH_STATES = [
  'observed',
  'derived',
  'estimated',
  'illustrative',
  'missing',
  'not-run',
] as const;

export const NODESLIDE_PRODUCTION_ARTIFACT_KINDS = [
  'generic',
  'metric',
  'comparison',
  'statement',
  'chart',
  'graph',
  'equation',
  'evidence-media',
] as const;

export type NodeSlideArtifactTruthState = (typeof NODESLIDE_ARTIFACT_TRUTH_STATES)[number];

export interface NodeSlideArtifactProvenance {
  truthState: NodeSlideArtifactTruthState;
  rationale: string;
  sourceIds: string[];
}

/** Immutable semantic intent attached to the materialized primary primitive. */
export interface NodeSlideAuthoredArtifactBinding {
  schemaVersion: typeof NODESLIDE_AUTHORED_ARTIFACT_BINDING_VERSION;
  artifactId: string;
  kind: NodeSlideCanonicalArtifactKind;
  narrativeJob: string;
  truthState: NodeSlideArtifactTruthState;
  rationale: string;
  claimIds: string[];
  sourceIds: string[];
  specDigest: string;
  projection: NodeSlideArtifactCompilerDescriptor;
}

export type NodeSlideArtifactBinding =
  | {
      schemaVersion: typeof NODESLIDE_PRODUCTION_ARTIFACT_BINDING_VERSION;
      artifactId: string;
      role: 'graph-node';
      graphKind: 'process' | 'architecture' | 'timeline';
      nodeId: string;
      nodeKind?: 'step' | 'system' | 'decision' | 'milestone';
    }
  | {
      schemaVersion: typeof NODESLIDE_PRODUCTION_ARTIFACT_BINDING_VERSION;
      artifactId: string;
      role: 'graph-edge';
      graphKind: 'process' | 'architecture' | 'timeline';
      from: string;
      to: string;
      label?: string;
    };

export type NodeSlideLegacyArtifactBinding =
  | (Omit<Extract<NodeSlideArtifactBinding, { role: 'graph-node' }>, 'schemaVersion'> & {
      schemaVersion: typeof NODESLIDE_LEGACY_ARTIFACT_BINDING_VERSION;
    })
  | (Omit<Extract<NodeSlideArtifactBinding, { role: 'graph-edge' }>, 'schemaVersion'> & {
      schemaVersion: typeof NODESLIDE_LEGACY_ARTIFACT_BINDING_VERSION;
    });

const GRAPH_KINDS = ['process', 'architecture', 'timeline'] as const;
const GRAPH_NODE_KINDS = ['step', 'system', 'decision', 'milestone'] as const;
const NATIVE_GEOMETRY_ARTIFACT_KINDS = [
  'waterfall',
  'sankey',
  'gantt',
  'risk-matrix',
  'trace',
  'spatial-scene',
] as const satisfies readonly NodeSlideCanonicalArtifactKind[];

interface NodeSlideArtifactRuntimeRecord extends Record<string, unknown> {
  schemaVersion?: unknown;
  artifactId?: unknown;
  role?: unknown;
  graphKind?: unknown;
  nodeId?: unknown;
  nodeKind?: unknown;
  from?: unknown;
  to?: unknown;
  label?: unknown;
  truthState?: unknown;
  rationale?: unknown;
  sourceIds?: unknown;
}

function isRecord(value: unknown): value is NodeSlideArtifactRuntimeRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalizes the short-lived, development-only binding version into the
 * production namespace. Public mutations accept only the production version;
 * this migration exists solely so already-stored development rows remain
 * readable while they are naturally rewritten.
 */
export function migrateNodeSlideProductionArtifactBinding(
  value: unknown,
): NodeSlideArtifactBinding {
  if (!isRecord(value)) {
    throw new Error(
      'NodeSlide production artifact binding migration failed [artifact_binding_shape]: binding must be an object.',
    );
  }
  if (
    value.schemaVersion !== NODESLIDE_PRODUCTION_ARTIFACT_BINDING_VERSION &&
    value.schemaVersion !== NODESLIDE_LEGACY_ARTIFACT_BINDING_VERSION
  ) {
    throw new Error(
      `NodeSlide production artifact binding migration failed [artifact_binding_version]: unsupported schema version ${String(value.schemaVersion)}.`,
    );
  }
  if (
    typeof value.artifactId !== 'string' ||
    value.artifactId.length === 0 ||
    !GRAPH_KINDS.includes(value.graphKind as (typeof GRAPH_KINDS)[number])
  ) {
    throw new Error(
      'NodeSlide production artifact binding migration failed [artifact_binding_shape]: artifactId and graphKind are required.',
    );
  }
  const schemaVersion = NODESLIDE_PRODUCTION_ARTIFACT_BINDING_VERSION;
  const graphKind = value.graphKind as (typeof GRAPH_KINDS)[number];
  if (value.role === 'graph-node') {
    if (
      typeof value.nodeId !== 'string' ||
      value.nodeId.length === 0 ||
      (value.nodeKind !== undefined &&
        !GRAPH_NODE_KINDS.includes(value.nodeKind as (typeof GRAPH_NODE_KINDS)[number]))
    ) {
      throw new Error(
        'NodeSlide production artifact binding migration failed [artifact_binding_shape]: graph-node requires a valid nodeId and optional nodeKind.',
      );
    }
    return {
      schemaVersion,
      artifactId: value.artifactId,
      role: 'graph-node',
      graphKind,
      nodeId: value.nodeId,
      ...(value.nodeKind !== undefined
        ? { nodeKind: value.nodeKind as (typeof GRAPH_NODE_KINDS)[number] }
        : {}),
    };
  }
  if (value.role === 'graph-edge') {
    if (
      typeof value.from !== 'string' ||
      value.from.length === 0 ||
      typeof value.to !== 'string' ||
      value.to.length === 0 ||
      (value.label !== undefined && typeof value.label !== 'string')
    ) {
      throw new Error(
        'NodeSlide production artifact binding migration failed [artifact_binding_shape]: graph-edge requires valid endpoints and an optional label.',
      );
    }
    return {
      schemaVersion,
      artifactId: value.artifactId,
      role: 'graph-edge',
      graphKind,
      from: value.from,
      to: value.to,
      ...(value.label !== undefined ? { label: value.label } : {}),
    };
  }
  throw new Error(
    'NodeSlide production artifact binding migration failed [artifact_binding_shape]: unsupported binding role.',
  );
}

interface NodeSlideArtifactSpecBase {
  schemaVersion: typeof NODESLIDE_PRODUCTION_ARTIFACT_SPEC_VERSION;
  id: string;
  slideId: string;
  kind:
    | 'generic'
    | 'metric'
    | 'comparison'
    | 'statement'
    | 'chart'
    | 'graph'
    | 'equation'
    | 'evidence-media';
  narrativeJob: string;
  elementIds: string[];
  claimIds: string[];
  sourceIds: string[];
  dataDigest: string;
  sourceDigest: string;
  locale: 'en-US';
  readingOrder: string[];
  editability: 'native' | 'grouped-editable' | 'static-fallback';
  browserContract: 'native';
  pptxContract: 'native' | 'static-fallback';
  pdfContract: 'static';
  accessibility: {
    label: string;
    altText?: string;
  };
  missingness: string[];
  assumptions: string[];
  knownFidelityDifferences: string[];
  provenance: NodeSlideArtifactProvenance;
}

export interface NodeSlideGenericArtifactSpec extends NodeSlideArtifactSpecBase {
  kind: 'generic';
  payload: {
    elementKind: ElementKind;
    role?: string;
    contentPresent: boolean;
    bounds: { x: number; y: number; width: number; height: number };
  };
}

export interface NodeSlideChartArtifactSpec extends NodeSlideArtifactSpecBase {
  kind: 'chart';
  payload: {
    chartType: string;
    labels: string[];
    series: { name: string; values: number[] }[];
    unit?: string;
    axes: {
      x: { scale: 'category'; domain: string[] };
      y: { scale: 'linear'; unit?: string };
    };
  };
}

export interface NodeSlideMetricArtifactSpec extends NodeSlideArtifactSpecBase {
  kind: 'metric';
  payload: {
    displayValue: string;
    numericValue?: number;
    label: string;
    emphasis: 'primary';
    bounds: { x: number; y: number; width: number; height: number };
  };
}

export interface NodeSlideComparisonArtifactSpec extends NodeSlideArtifactSpecBase {
  kind: 'comparison';
  payload: {
    layout: 'columns';
    columns: {
      label: string;
      elementId: string;
      bounds: { x: number; y: number; width: number; height: number };
    }[];
  };
}

export interface NodeSlideStatementArtifactSpec extends NodeSlideArtifactSpecBase {
  kind: 'statement';
  payload: {
    layout: 'editorial-statement';
    headline: string;
    supportingText?: string;
    points: string[];
  };
}

export interface NodeSlideGraphArtifactSpec extends NodeSlideArtifactSpecBase {
  kind: 'graph';
  payload: {
    graphKind: 'process' | 'architecture' | 'timeline';
    directed: true;
    nodes: {
      id: string;
      label: string;
      kind?: 'step' | 'system' | 'decision' | 'milestone';
      elementId: string;
    }[];
    edges: { from: string; to: string; label?: string; elementId: string }[];
  };
}

export interface NodeSlideEquationArtifactSpec extends NodeSlideArtifactSpecBase {
  kind: 'equation';
  payload: {
    expression: string;
    display: string;
    syntax: 'plain' | 'latex';
    variables: { label: string; value: number; unit?: string }[];
    evaluation: 'not-run';
  };
}

export interface NodeSlideEvidenceMediaArtifactSpec extends NodeSlideArtifactSpecBase {
  kind: 'evidence-media';
  payload: {
    mediaType: 'image' | 'video';
    sourceUrl?: string;
    placeholder: boolean;
    altText: string;
    credit?: string;
  };
}

export type NodeSlideArtifactSpec =
  | NodeSlideGenericArtifactSpec
  | NodeSlideMetricArtifactSpec
  | NodeSlideComparisonArtifactSpec
  | NodeSlideStatementArtifactSpec
  | NodeSlideChartArtifactSpec
  | NodeSlideGraphArtifactSpec
  | NodeSlideEquationArtifactSpec
  | NodeSlideEvidenceMediaArtifactSpec;

export interface NodeSlideArtifactIssue {
  code:
    | 'artifact_schema_version'
    | 'artifact_kind'
    | 'artifact_identity'
    | 'artifact_element_binding'
    | 'artifact_source_binding'
    | 'artifact_chart_shape'
    | 'artifact_graph_shape'
    | 'artifact_equation_shape'
    | 'artifact_media_shape'
    | 'artifact_metric_shape'
    | 'artifact_comparison_shape'
    | 'artifact_statement_shape'
    | 'artifact_provenance'
    | 'artifact_authored_binding'
    | 'artifact_snapshot_coverage'
    | 'artifact_visual_coverage'
    | 'artifact_claim_evidence_binding'
    | 'artifact_density_limit';
  severity: 'error' | 'warning';
  message: string;
  artifactId?: string;
  slideId?: string;
  elementId?: string;
}

export interface NodeSlideArtifactCompilationReceipt {
  schemaVersion: typeof NODESLIDE_ARTIFACT_COMPILATION_RECEIPT_VERSION;
  deckBinding: {
    deckDigest: string;
    deckVersion: number;
  };
  specSetDigest: string;
  artifactCount: number;
  coveredElementCount: number;
  stages: {
    normalize: { status: 'passed' | 'failed'; issueCodes: string[] };
    semantic: { status: 'passed' | 'failed'; issueCodes: string[] };
    compile: { status: 'passed' | 'failed'; issueCodes: string[] };
  };
  issues: NodeSlideArtifactIssue[];
  status: 'passed' | 'failed';
  compiler: 'nodeslide-artifact-compiler/1.0.0';
  receiptDigest: string;
}

export interface NodeSlideArtifactCompilation {
  specs: NodeSlideArtifactSpec[];
  receipt: NodeSlideArtifactCompilationReceipt;
}

export interface NodeSlideArtifactShadowReceipt {
  schemaVersion: typeof NODESLIDE_ARTIFACT_SHADOW_RECEIPT_VERSION;
  userVisible: false;
  mutationApplied: false;
  anonymized: true;
  deckBindingDigest: string;
  compilationReceiptDigest: string;
  specSetDigest: string;
  artifactCount: number;
  coveredElementCount: number;
  /** Rendered elements carrying canonical pre-geometry intent (may repeat per graph). */
  authoredBindingCount: number;
  /** Unique canonical authored artifacts, deduplicated by spec digest. */
  canonicalArtifactCount: number;
  canonicalKindCounts: { kind: NodeSlideCanonicalArtifactKind; count: number }[];
  /** Content-free per-spec handles, recomputed from exact persisted authored bindings. */
  canonicalArtifacts: {
    kind: NodeSlideCanonicalArtifactKind;
    specDigest: string;
    bindingDigest: string;
  }[];
  /** Content-free digest proving preserved id/narrative/claims/sources/provenance bindings. */
  preservedIntentDigest: string;
  status: 'passed' | 'failed';
  issueCodes: string[];
  receiptDigest: string;
}

export function compileNodeSlideArtifactSpecs(
  snapshot: DeckSnapshot,
): NodeSlideArtifactCompilation {
  const sourceById = new Map(snapshot.sources.map((source) => [source.id, source]));
  const claimedElements = new Set<string>();
  const specs: NodeSlideArtifactSpec[] = [];
  const issues: NodeSlideArtifactIssue[] = [];

  const nativeGroups = new Map<string, SlideElement[]>();
  for (const element of snapshot.elements) {
    const authored = element.authoredArtifactBinding;
    if (
      !authored ||
      !NATIVE_GEOMETRY_ARTIFACT_KINDS.includes(
        authored.kind as (typeof NATIVE_GEOMETRY_ARTIFACT_KINDS)[number],
      )
    ) {
      continue;
    }
    const key = `${element.slideId}\u001f${authored.specDigest}`;
    const group = nativeGroups.get(key) ?? [];
    group.push(element);
    nativeGroups.set(key, group);
  }
  for (const elements of nativeGroups.values()) {
    const first = elements[0];
    const authored = first?.authoredArtifactBinding;
    const spec = authoredNativeGeometrySpec(elements, sourceById);
    specs.push(spec);
    const groupIds = unique(
      elements.flatMap((element) => (element.groupId ? [element.groupId] : [])),
    );
    const bindingMismatch = elements.some(
      (element) =>
        !authored ||
        element.authoredArtifactBinding?.artifactId !== authored.artifactId ||
        element.authoredArtifactBinding?.kind !== authored.kind ||
        element.authoredArtifactBinding?.specDigest !== authored.specDigest ||
        element.authoredArtifactBinding?.projection.mode !== 'native',
    );
    if (bindingMismatch || groupIds.length !== 1 || groupIds[0] === undefined) {
      issues.push({
        code: 'artifact_element_binding',
        severity: 'error',
        message:
          'Native authored marks must share one artifact identity, native projection, digest, and editable group.',
        artifactId: spec.id,
        slideId: spec.slideId,
      });
    }
    for (const element of elements) claimedElements.add(element.id);
  }

  const graphGroups = new Map<string, SlideElement[]>();
  for (const element of snapshot.elements) {
    if (!element.artifactBinding) continue;
    const key = `${element.slideId}\u001f${element.artifactBinding.artifactId}`;
    const group = graphGroups.get(key) ?? [];
    group.push(element);
    graphGroups.set(key, group);
  }
  for (const elements of graphGroups.values()) {
    const firstBinding = elements[0]?.artifactBinding;
    const firstAuthoredBinding = elements[0]?.authoredArtifactBinding;
    const bindingMismatch = elements.some((element) => {
      const binding = element.artifactBinding;
      return (
        !binding ||
        binding.graphKind !== firstBinding?.graphKind ||
        element.authoredArtifactBinding?.specDigest !== firstAuthoredBinding?.specDigest ||
        (binding.role === 'graph-node' && element.kind !== 'shape') ||
        (binding.role === 'graph-edge' && element.kind !== 'connector')
      );
    });
    const spec = graphSpec(elements, sourceById);
    specs.push(spec);
    if (bindingMismatch) {
      issues.push({
        code: 'artifact_element_binding',
        severity: 'error',
        message: 'Graph bindings must agree on kind and match shape/connector element roles.',
        artifactId: spec.id,
        slideId: spec.slideId,
      });
    }
    for (const element of elements) claimedElements.add(element.id);
  }

  for (const slide of snapshot.slides) {
    const available = snapshot.elements.filter(
      (element) => element.slideId === slide.id && !claimedElements.has(element.id),
    );
    if (slide.archetype === 'comparison') {
      const columns = available.filter(
        (element) => element.kind === 'text' && element.role === 'bullet',
      );
      if (columns.length >= 2) {
        specs.push(comparisonSpec(slide.id, columns, sourceById));
        for (const element of columns) claimedElements.add(element.id);
      }
    } else if (slide.archetype === 'statement') {
      const statementElements = available.filter(
        (element) =>
          element.kind === 'text' &&
          ['title', 'headline', 'body', 'bullet'].includes(element.role ?? ''),
      );
      if (statementElements.length >= 2) {
        specs.push(statementSpec(slide.id, statementElements, sourceById));
        for (const element of statementElements) claimedElements.add(element.id);
      }
    }
  }

  for (const element of snapshot.elements) {
    if (claimedElements.has(element.id)) continue;
    specs.push(elementSpec(element, sourceById));
    claimedElements.add(element.id);
  }

  specs.sort(
    (left, right) => left.slideId.localeCompare(right.slideId) || left.id.localeCompare(right.id),
  );
  issues.push(...specs.flatMap((spec) => validateNodeSlideArtifactSpec(spec)));
  for (const spec of specs) {
    if (spec.kind === 'chart' && spec.sourceIds.length === 0) {
      issues.push({
        code: 'artifact_claim_evidence_binding',
        severity: 'error',
        message: `${spec.kind} artifact must retain at least one canonical evidence source.`,
        artifactId: spec.id,
        slideId: spec.slideId,
        ...(spec.elementIds[0] ? { elementId: spec.elementIds[0] } : {}),
      });
    }
  }
  if (snapshot.slides.length >= 6) {
    const nativeVisualSlideIds = new Set(
      snapshot.elements.flatMap((element) => {
        const kind = element.authoredArtifactBinding?.kind;
        return kind &&
          NATIVE_GEOMETRY_ARTIFACT_KINDS.includes(
            kind as (typeof NATIVE_GEOMETRY_ARTIFACT_KINDS)[number],
          )
          ? [element.slideId]
          : [];
      }),
    );
    const visualSlideCount = new Set(
      specs.flatMap((spec) =>
        spec.kind === 'chart' ||
        spec.kind === 'graph' ||
        spec.kind === 'equation' ||
        spec.kind === 'metric' ||
        spec.kind === 'comparison' ||
        (spec.kind === 'evidence-media' && !spec.payload.placeholder) ||
        nativeVisualSlideIds.has(spec.slideId)
          ? [spec.slideId]
          : [],
      ),
    ).size;
    if (visualSlideCount < 2) {
      issues.push({
        code: 'artifact_visual_coverage',
        severity: 'error',
        message: `A ${snapshot.slides.length}-slide production deck requires meaningful typed visuals on at least 2 slides; found ${visualSlideCount}.`,
      });
    }
  }
  for (const slide of snapshot.slides) {
    const elements = snapshot.elements.filter((element) => element.slideId === slide.id);
    const textCharacters = elements.reduce(
      (total, element) => total + (element.content?.trim().length ?? 0),
      0,
    );
    if (elements.length > 24 || textCharacters > 2_400) {
      issues.push({
        code: 'artifact_density_limit',
        severity: 'error',
        message: `Slide exceeds the bounded artifact density contract (${elements.length} elements, ${textCharacters} text characters).`,
        slideId: slide.id,
      });
    }
  }
  for (const spec of specs) {
    for (const sourceId of spec.sourceIds) {
      if (!sourceById.has(sourceId)) {
        issues.push({
          code: 'artifact_source_binding',
          severity: 'error',
          message: `Artifact source ${sourceId} is not present in the compiled snapshot.`,
          artifactId: spec.id,
          slideId: spec.slideId,
        });
      }
    }
  }
  for (const element of snapshot.elements) {
    const binding = element.artifactBinding;
    if (
      binding &&
      (binding.schemaVersion !== NODESLIDE_PRODUCTION_ARTIFACT_BINDING_VERSION ||
        !binding.artifactId ||
        !['process', 'architecture', 'timeline'].includes(binding.graphKind))
    ) {
      issues.push({
        code: 'artifact_element_binding',
        severity: 'error',
        message: 'Element has an unsupported or incomplete artifact binding.',
        artifactId: binding.artifactId,
        slideId: element.slideId,
        elementId: element.id,
      });
    }
    const authored = element.authoredArtifactBinding;
    if (authored) {
      const sourceIds = unique(element.sourceIds);
      const boundSourceIds = unique(authored.sourceIds);
      if (
        authored.schemaVersion !== NODESLIDE_AUTHORED_ARTIFACT_BINDING_VERSION ||
        !authored.artifactId.trim() ||
        !authored.narrativeJob.trim() ||
        !authored.rationale.trim() ||
        !Array.isArray(authored.claimIds) ||
        authored.claimIds.some((claimId) => !claimId.trim()) ||
        !NODESLIDE_ARTIFACT_TRUTH_STATES.includes(authored.truthState) ||
        !/^sha256:[0-9a-f]{64}$/u.test(authored.specDigest) ||
        sourceIds.join('\u001f') !== boundSourceIds.join('\u001f') ||
        (binding !== undefined && binding.artifactId !== authored.artifactId)
      ) {
        issues.push({
          code: 'artifact_authored_binding',
          severity: 'error',
          message:
            'Authored artifact binding must preserve identity, narrative, provenance, digest, and exact rendered source bindings.',
          artifactId: authored.artifactId,
          slideId: element.slideId,
          elementId: element.id,
        });
      }
    }
  }
  if (claimedElements.size !== snapshot.elements.length) {
    issues.push({
      code: 'artifact_snapshot_coverage',
      severity: 'error',
      message: 'Artifact compilation did not cover every slide element.',
    });
  }
  const issueCodes = [...new Set(issues.map((issue) => issue.code))].sort();
  const hasErrors = issues.some((issue) => issue.severity === 'error');
  // Validation can materialize the same semantic candidate at different wall-clock
  // instants (proposal preflight versus acceptance). Bind the receipt to content and
  // version, not the commit timestamp; the version remains explicit alongside it.
  const deckDigest = digest({
    ...snapshot,
    deck: { ...snapshot.deck, updatedAt: 0 },
  });
  const specSetDigest = digest(specs);
  const unsigned: Omit<NodeSlideArtifactCompilationReceipt, 'receiptDigest'> = {
    schemaVersion: NODESLIDE_ARTIFACT_COMPILATION_RECEIPT_VERSION,
    deckBinding: { deckDigest, deckVersion: snapshot.deck.version },
    specSetDigest,
    artifactCount: specs.length,
    coveredElementCount: claimedElements.size,
    stages: {
      normalize: { status: hasErrors ? 'failed' : 'passed', issueCodes },
      semantic: { status: hasErrors ? 'failed' : 'passed', issueCodes },
      compile: { status: hasErrors ? 'failed' : 'passed', issueCodes },
    },
    issues,
    status: hasErrors ? 'failed' : 'passed',
    compiler: 'nodeslide-artifact-compiler/1.0.0',
  };
  return { specs, receipt: { ...unsigned, receiptDigest: digest(unsigned) } };
}

/**
 * Verifies the self-digest and exact candidate/version ancestry of a runtime
 * compilation receipt. The current architecture compares this server-owned
 * receipt with a freshly recomputed validation; it does not treat a digest as
 * a signature or accept a model-authored receipt on its own.
 */
export function nodeSlideArtifactCompilationReceiptLineageMatches(
  receipt: NodeSlideArtifactCompilationReceipt | undefined,
  expected: { deckDigest: string; deckVersion: number },
): boolean {
  if (!receipt) return false;
  const { receiptDigest, ...unsigned } = receipt;
  const expectedStatus = receipt.issues.some((entry) => entry.severity === 'error')
    ? 'failed'
    : 'passed';
  const issueCodes = [...new Set(receipt.issues.map((entry) => entry.code))].sort();
  return (
    receipt.schemaVersion === NODESLIDE_ARTIFACT_COMPILATION_RECEIPT_VERSION &&
    receipt.compiler === 'nodeslide-artifact-compiler/1.0.0' &&
    isNodeSlideSha256Digest(receipt.deckBinding.deckDigest) &&
    receipt.deckBinding.deckDigest === expected.deckDigest &&
    Number.isSafeInteger(receipt.deckBinding.deckVersion) &&
    receipt.deckBinding.deckVersion === expected.deckVersion &&
    isNodeSlideSha256Digest(receipt.specSetDigest) &&
    Number.isSafeInteger(receipt.artifactCount) &&
    receipt.artifactCount >= 0 &&
    Number.isSafeInteger(receipt.coveredElementCount) &&
    receipt.coveredElementCount >= 0 &&
    receipt.status === expectedStatus &&
    Object.values(receipt.stages).every(
      (stage) =>
        stage.status === expectedStatus &&
        stage.issueCodes.join('\u001f') === issueCodes.join('\u001f'),
    ) &&
    isNodeSlideSha256Digest(receiptDigest) &&
    receiptDigest === digest(unsigned)
  );
}

export function validateNodeSlideArtifactSpec(
  spec: NodeSlideArtifactSpec,
): NodeSlideArtifactIssue[] {
  const issues: NodeSlideArtifactIssue[] = [];
  const add = (code: NodeSlideArtifactIssue['code'], message: string, elementId?: string) =>
    issues.push({
      code,
      severity: 'error',
      message,
      artifactId: spec.id,
      slideId: spec.slideId,
      ...(elementId ? { elementId } : {}),
    });
  if (spec.schemaVersion !== NODESLIDE_PRODUCTION_ARTIFACT_SPEC_VERSION) {
    add(
      'artifact_schema_version',
      `Unsupported artifact schema version ${String(spec.schemaVersion)}.`,
    );
  }
  if (!spec.id || !spec.slideId || spec.elementIds.length === 0) {
    add('artifact_identity', 'Artifact id, slide id, and element bindings are required.');
  }
  if (new Set(spec.elementIds).size !== spec.elementIds.length) {
    add('artifact_element_binding', 'Artifact element bindings must be unique.');
  }
  if (spec.sourceIds.some((sourceId) => !sourceId)) {
    add('artifact_source_binding', 'Artifact source bindings cannot be empty.');
  }
  const runtimeKind = spec.kind as string;
  if (
    !NODESLIDE_PRODUCTION_ARTIFACT_KINDS.includes(
      runtimeKind as (typeof NODESLIDE_PRODUCTION_ARTIFACT_KINDS)[number],
    )
  ) {
    add('artifact_kind', `Unsupported production artifact kind ${runtimeKind}.`);
    return issues;
  }
  const runtimeProvenance = spec.provenance as unknown;
  if (
    !isRecord(runtimeProvenance) ||
    !NODESLIDE_ARTIFACT_TRUTH_STATES.includes(
      runtimeProvenance.truthState as NodeSlideArtifactTruthState,
    ) ||
    typeof runtimeProvenance.rationale !== 'string' ||
    runtimeProvenance.rationale.trim().length === 0 ||
    !Array.isArray(runtimeProvenance.sourceIds) ||
    runtimeProvenance.sourceIds.some((sourceId) => typeof sourceId !== 'string') ||
    unique(runtimeProvenance.sourceIds as string[]).join('\u001f') !==
      unique(spec.sourceIds).join('\u001f') ||
    (runtimeProvenance.truthState === 'observed' && spec.sourceIds.length === 0)
  ) {
    add(
      'artifact_provenance',
      'Artifact provenance requires a supported truth state, rationale, and exact source binding; observed artifacts require evidence.',
    );
  }
  if (spec.kind === 'chart') {
    if (
      spec.payload.labels.length === 0 ||
      spec.payload.series.length === 0 ||
      spec.payload.series.some(
        (series) =>
          !series.name ||
          series.values.length !== spec.payload.labels.length ||
          series.values.some((value) => !Number.isFinite(value)),
      )
    ) {
      add('artifact_chart_shape', 'Chart labels and finite series values must align exactly.');
    }
  } else if (spec.kind === 'graph') {
    const nodeIds = new Set(spec.payload.nodes.map((node) => node.id));
    if (
      !['process', 'architecture', 'timeline'].includes(spec.payload.graphKind) ||
      spec.payload.nodes.length < 2 ||
      nodeIds.size !== spec.payload.nodes.length ||
      spec.payload.edges.length === 0 ||
      spec.payload.edges.some(
        (edge) => !nodeIds.has(edge.from) || !nodeIds.has(edge.to) || edge.from === edge.to,
      )
    ) {
      add('artifact_graph_shape', 'Directed graph nodes and edges must be unique and fully bound.');
    }
  } else if (spec.kind === 'equation') {
    if (
      !spec.payload.expression.trim() ||
      !spec.payload.display.trim() ||
      spec.payload.variables.some(
        (variable) => !variable.label.trim() || !Number.isFinite(variable.value),
      )
    ) {
      add(
        'artifact_equation_shape',
        'Equation source, display, and finite variables are required.',
      );
    }
  } else if (spec.kind === 'evidence-media') {
    if (!spec.payload.altText.trim()) {
      add(
        'artifact_media_shape',
        'Media requires alt text; source URLs identify evidence but are never render URLs.',
      );
    }
  } else if (spec.kind === 'metric') {
    if (
      !spec.payload.displayValue.trim() ||
      !spec.payload.label.trim() ||
      (spec.payload.numericValue !== undefined && !Number.isFinite(spec.payload.numericValue))
    ) {
      add('artifact_metric_shape', 'Metric requires a display value, label, and finite value.');
    }
  } else if (spec.kind === 'comparison') {
    if (
      spec.payload.columns.length < 2 ||
      new Set(spec.payload.columns.map((column) => column.elementId)).size !==
        spec.payload.columns.length ||
      spec.payload.columns.some((column) => !column.label.trim())
    ) {
      add(
        'artifact_comparison_shape',
        'Comparison requires at least two uniquely bound, labeled columns.',
      );
    }
  } else if (spec.kind === 'statement') {
    if (!spec.payload.headline.trim()) {
      add('artifact_statement_shape', 'Statement requires a non-empty headline.');
    }
  }
  return issues;
}

export function assertNodeSlideArtifactCompilation(
  snapshot: DeckSnapshot,
): NodeSlideArtifactCompilationReceipt {
  const receipt = compileNodeSlideArtifactSpecs(snapshot).receipt;
  if (receipt.status === 'failed') {
    const first = receipt.issues.find((issue) => issue.severity === 'error');
    throw new Error(
      `NodeSlide ArtifactSpec compilation failed [${first?.code ?? 'artifact_snapshot_coverage'}]: ${first?.message ?? 'unknown artifact error'}`,
    );
  }
  return receipt;
}

export function createNodeSlideArtifactShadowReceipt(
  compilation: NodeSlideArtifactCompilationReceipt,
  snapshot?: Pick<DeckSnapshot, 'elements'>,
): NodeSlideArtifactShadowReceipt {
  const authoredBindings = (snapshot?.elements ?? []).flatMap((element) =>
    element.authoredArtifactBinding ? [element.authoredArtifactBinding] : [],
  );
  const uniqueAuthored = [
    ...new Map(authoredBindings.map((binding) => [binding.specDigest, binding] as const)).values(),
  ].sort(
    (left, right) =>
      left.kind.localeCompare(right.kind) || left.specDigest.localeCompare(right.specDigest),
  );
  const canonicalKindCounts = NODESLIDE_CANONICAL_ARTIFACT_KINDS.flatMap((kind) => {
    const count = uniqueAuthored.filter((binding) => binding.kind === kind).length;
    return count > 0 ? [{ kind, count }] : [];
  });
  const canonicalArtifacts = uniqueAuthored.map((binding) => ({
    kind: binding.kind,
    specDigest: binding.specDigest,
    bindingDigest: digest({
      artifactId: binding.artifactId,
      kind: binding.kind,
      narrativeJob: binding.narrativeJob,
      truthState: binding.truthState,
      rationale: binding.rationale,
      claimIds: [...binding.claimIds].sort(),
      sourceIds: [...binding.sourceIds].sort(),
      specDigest: binding.specDigest,
      projection: binding.projection,
    }),
  }));
  const preservedIntentDigest = digest(
    uniqueAuthored.map((binding) => ({
      artifactId: binding.artifactId,
      kind: binding.kind,
      narrativeJob: binding.narrativeJob,
      truthState: binding.truthState,
      rationale: binding.rationale,
      claimIds: [...binding.claimIds].sort(),
      sourceIds: [...binding.sourceIds].sort(),
      specDigest: binding.specDigest,
      projection: binding.projection,
    })),
  );
  const unsigned: Omit<NodeSlideArtifactShadowReceipt, 'receiptDigest'> = {
    schemaVersion: NODESLIDE_ARTIFACT_SHADOW_RECEIPT_VERSION,
    userVisible: false,
    mutationApplied: false,
    anonymized: true,
    deckBindingDigest: digest({
      deckDigest: compilation.deckBinding.deckDigest,
      deckVersion: compilation.deckBinding.deckVersion,
    }),
    compilationReceiptDigest: compilation.receiptDigest,
    specSetDigest: compilation.specSetDigest,
    artifactCount: compilation.artifactCount,
    coveredElementCount: compilation.coveredElementCount,
    authoredBindingCount: authoredBindings.length,
    canonicalArtifactCount: uniqueAuthored.length,
    canonicalKindCounts,
    canonicalArtifacts,
    preservedIntentDigest,
    status: compilation.status,
    issueCodes: [...new Set(compilation.issues.map((issue) => issue.code))].sort(),
  };
  return { ...unsigned, receiptDigest: digest(unsigned) };
}

function elementSpec(
  element: SlideElement,
  sourceById: Map<string, DeckSnapshot['sources'][number]>,
): NodeSlideArtifactSpec {
  const base = baseSpec(element, sourceById);
  if (element.kind === 'text' && element.role === 'metric') {
    const displayValue = element.content?.trim() ?? '';
    const numericToken = displayValue.replace(/,/gu, '').match(/[-+]?\d+(?:\.\d+)?/u)?.[0];
    const numericValue = numericToken === undefined ? undefined : Number(numericToken);
    const payload: NodeSlideMetricArtifactSpec['payload'] = {
      displayValue,
      ...(numericValue !== undefined && Number.isFinite(numericValue) ? { numericValue } : {}),
      label: element.name,
      emphasis: 'primary',
      bounds: { ...element.bbox },
    };
    return { ...base, kind: 'metric', dataDigest: digest(payload), payload };
  }
  if (element.kind === 'chart' && element.chart) {
    const payload: NodeSlideChartArtifactSpec['payload'] = {
      chartType: element.chart.chartType,
      labels: [...element.chart.labels],
      series: element.chart.series.map((series) => ({
        name: series.name,
        values: [...series.values],
      })),
      ...(element.chart.unit ? { unit: element.chart.unit } : {}),
      axes: {
        x: { scale: 'category', domain: [...element.chart.labels] },
        y: {
          scale: 'linear',
          ...(element.chart.unit ? { unit: element.chart.unit } : {}),
        },
      },
    };
    return {
      ...base,
      kind: 'chart',
      dataDigest: digest(payload),
      missingness: element.chart.unit ? [] : ['unit'],
      payload,
    };
  }
  if (element.kind === 'math' && element.math) {
    const payload: NodeSlideEquationArtifactSpec['payload'] = {
      expression: element.math.expression,
      display: element.math.display ?? element.content ?? element.math.expression,
      syntax: element.math.syntax ?? 'plain',
      variables: (element.math.variables ?? []).map((variable) => ({ ...variable })),
      evaluation: 'not-run',
    };
    return {
      ...base,
      kind: 'equation',
      dataDigest: digest(payload),
      assumptions: ['Expression evaluation is not claimed by the production compiler.'],
      payload,
    };
  }
  if (element.kind === 'image' || element.kind === 'video') {
    const placeholder = element.kind === 'image' ? (element.image?.placeholder ?? true) : false;
    const sourceUrl = element.kind === 'image' ? element.imageUrl : element.video?.url;
    const payload: NodeSlideEvidenceMediaArtifactSpec['payload'] = {
      mediaType: element.kind,
      ...(sourceUrl ? { sourceUrl } : {}),
      placeholder,
      altText: element.altText ?? element.video?.title ?? '',
      ...(element.image?.credit ? { credit: element.image.credit } : {}),
    };
    return {
      ...base,
      kind: 'evidence-media',
      dataDigest: digest(payload),
      editability: placeholder ? 'native' : 'static-fallback',
      pptxContract: placeholder ? 'native' : 'static-fallback',
      provenance: placeholder
        ? artifactProvenance('missing', base.sourceIds, 'Media source is an explicit placeholder.')
        : base.provenance,
      missingness: placeholder ? ['media-source'] : [],
      payload,
    };
  }
  const payload: NodeSlideGenericArtifactSpec['payload'] = {
    elementKind: element.kind,
    ...(element.role ? { role: element.role } : {}),
    contentPresent: Boolean(element.content?.trim()),
    bounds: { ...element.bbox },
  };
  return { ...base, kind: 'generic', dataDigest: digest(payload), payload };
}

function comparisonSpec(
  slideId: string,
  elements: SlideElement[],
  sourceById: Map<string, DeckSnapshot['sources'][number]>,
): NodeSlideComparisonArtifactSpec {
  const ordered = readingOrder(elements);
  const payload: NodeSlideComparisonArtifactSpec['payload'] = {
    layout: 'columns',
    columns: ordered.map((element) => ({
      label: element.content?.trim() ?? element.name,
      elementId: element.id,
      bounds: { ...element.bbox },
    })),
  };
  return {
    ...multiElementBaseSpec(`artifact:${slideId}:comparison`, elements, sourceById),
    kind: 'comparison',
    narrativeJob: 'Compare parallel choices or evidence in a scannable column composition.',
    dataDigest: digest(payload),
    accessibility: { label: 'Column comparison' },
    payload,
  };
}

function statementSpec(
  slideId: string,
  elements: SlideElement[],
  sourceById: Map<string, DeckSnapshot['sources'][number]>,
): NodeSlideStatementArtifactSpec {
  const ordered = readingOrder(elements);
  const headline =
    ordered
      .find((element) => element.role === 'title' || element.role === 'headline')
      ?.content?.trim() ?? '';
  const supportingText = ordered.find((element) => element.role === 'body')?.content?.trim();
  const payload: NodeSlideStatementArtifactSpec['payload'] = {
    layout: 'editorial-statement',
    headline,
    ...(supportingText ? { supportingText } : {}),
    points: ordered.flatMap((element) =>
      element.role === 'bullet' && element.content?.trim() ? [element.content.trim()] : [],
    ),
  };
  return {
    ...multiElementBaseSpec(`artifact:${slideId}:statement`, elements, sourceById),
    kind: 'statement',
    narrativeJob: 'Land one editorial statement with bounded supporting context.',
    dataDigest: digest(payload),
    accessibility: { label: headline || 'Editorial statement' },
    payload,
  };
}

function multiElementBaseSpec(
  id: string,
  elements: SlideElement[],
  sourceById: Map<string, DeckSnapshot['sources'][number]>,
): Omit<NodeSlideGenericArtifactSpec, 'kind' | 'payload'> {
  const first = elements[0] as SlideElement;
  const sourceIds = unique(
    elements.flatMap((element) => [
      ...element.sourceIds,
      ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
      ...(element.math?.sourceId ? [element.math.sourceId] : []),
      ...(element.image?.sourceId ? [element.image.sourceId] : []),
    ]),
  );
  const staticFallback = elements.some((element) =>
    element.exportCapabilities.includes('pptx_static_fallback'),
  );
  return {
    schemaVersion: NODESLIDE_PRODUCTION_ARTIFACT_SPEC_VERSION,
    id,
    slideId: first.slideId,
    narrativeJob: first.name,
    elementIds: elements.map((element) => element.id).sort(),
    claimIds: sourceIds.map((sourceId) => `claim:${sourceId}`),
    sourceIds,
    dataDigest: '',
    sourceDigest: digest(sourceIds.map((sourceId) => sourceById.get(sourceId) ?? sourceId)),
    locale: 'en-US',
    readingOrder: readingOrder(elements).map((element) => element.id),
    editability: staticFallback ? 'static-fallback' : 'grouped-editable',
    browserContract: 'native',
    pptxContract: staticFallback ? 'static-fallback' : 'native',
    pdfContract: 'static',
    accessibility: { label: first.name },
    missingness: [],
    assumptions: [],
    knownFidelityDifferences: staticFallback
      ? ['PowerPoint uses the declared static fallback.']
      : [],
    provenance: provenance(sourceIds, sourceById),
  };
}

function authoredNativeGeometrySpec(
  elements: SlideElement[],
  sourceById: Map<string, DeckSnapshot['sources'][number]>,
): NodeSlideGenericArtifactSpec {
  const first = elements[0] as SlideElement;
  const authored = first.authoredArtifactBinding as NodeSlideAuthoredArtifactBinding;
  const base = multiElementBaseSpec(authored.artifactId, elements, sourceById);
  const left = Math.min(...elements.map((element) => element.bbox.x));
  const top = Math.min(...elements.map((element) => element.bbox.y));
  const right = Math.max(...elements.map((element) => element.bbox.x + element.bbox.width));
  const bottom = Math.max(...elements.map((element) => element.bbox.y + element.bbox.height));
  const payload: NodeSlideGenericArtifactSpec['payload'] = {
    elementKind: first.kind,
    role: `artifact_native_${authored.kind}`,
    contentPresent: elements.some((element) => Boolean(element.content?.trim())),
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
  };
  return {
    ...base,
    id: authored.artifactId,
    narrativeJob: authored.narrativeJob,
    claimIds: [...authored.claimIds],
    sourceIds: [...authored.sourceIds],
    dataDigest: digest({ authoredSpecDigest: authored.specDigest, payload }),
    sourceDigest: digest(
      authored.sourceIds.map((sourceId) => sourceById.get(sourceId) ?? sourceId),
    ),
    editability: authored.projection.editability,
    pptxContract: authored.projection.pptxContract === 'editable' ? 'native' : 'static-fallback',
    accessibility: { label: `${authored.kind} artifact` },
    knownFidelityDifferences: [...authored.projection.knownFidelityDifferences],
    provenance: artifactProvenance(authored.truthState, authored.sourceIds, authored.rationale),
    kind: 'generic',
    payload,
  };
}

function readingOrder(elements: SlideElement[]): SlideElement[] {
  return [...elements].sort(
    (left, right) =>
      left.bbox.y - right.bbox.y || left.bbox.x - right.bbox.x || left.id.localeCompare(right.id),
  );
}

function graphSpec(
  elements: SlideElement[],
  sourceById: Map<string, DeckSnapshot['sources'][number]>,
): NodeSlideGraphArtifactSpec {
  const first = elements[0] as SlideElement;
  const binding = first.artifactBinding as NodeSlideArtifactBinding;
  const authored = first.authoredArtifactBinding;
  const sourceIds = unique(elements.flatMap((element) => element.sourceIds));
  const payload: NodeSlideGraphArtifactSpec['payload'] = {
    graphKind: binding.graphKind,
    directed: true,
    nodes: elements.flatMap((element) => {
      const candidate = element.artifactBinding;
      return candidate?.role === 'graph-node'
        ? [
            {
              id: candidate.nodeId,
              label: element.content ?? element.name,
              ...(candidate.nodeKind ? { kind: candidate.nodeKind } : {}),
              elementId: element.id,
            },
          ]
        : [];
    }),
    edges: elements.flatMap((element) => {
      const candidate = element.artifactBinding;
      return candidate?.role === 'graph-edge'
        ? [
            {
              from: candidate.from,
              to: candidate.to,
              ...(candidate.label ? { label: candidate.label } : {}),
              elementId: element.id,
            },
          ]
        : [];
    }),
  };
  return {
    schemaVersion: NODESLIDE_PRODUCTION_ARTIFACT_SPEC_VERSION,
    id: binding.artifactId,
    slideId: first.slideId,
    kind: 'graph',
    narrativeJob: authored?.narrativeJob ?? 'Communicate an explicit directed relationship.',
    elementIds: elements.map((element) => element.id).sort(),
    claimIds: authored?.claimIds ?? sourceIds.map((sourceId) => `claim:${sourceId}`),
    sourceIds,
    dataDigest: digest(payload),
    sourceDigest: digest(sourceIds.map((sourceId) => sourceById.get(sourceId) ?? sourceId)),
    locale: 'en-US',
    readingOrder: payload.nodes.map((node) => node.elementId),
    editability: authored?.projection.editability ?? 'grouped-editable',
    browserContract: 'native',
    pptxContract: 'native',
    pdfContract: 'static',
    accessibility: { label: `Directed ${payload.graphKind} diagram` },
    missingness: [],
    assumptions: [],
    knownFidelityDifferences: authored ? [...authored.projection.knownFidelityDifferences] : [],
    provenance: authored
      ? artifactProvenance(authored.truthState, sourceIds, authored.rationale)
      : provenance(sourceIds, sourceById),
    payload,
  };
}

function baseSpec(
  element: SlideElement,
  sourceById: Map<string, DeckSnapshot['sources'][number]>,
): Omit<NodeSlideGenericArtifactSpec, 'kind' | 'payload'> {
  const sourceIds = unique([
    ...element.sourceIds,
    ...(element.chart?.sourceId ? [element.chart.sourceId] : []),
    ...(element.math?.sourceId ? [element.math.sourceId] : []),
    ...(element.image?.sourceId ? [element.image.sourceId] : []),
  ]);
  const staticFallback = element.exportCapabilities.includes('pptx_static_fallback');
  const authored = element.authoredArtifactBinding;
  return {
    schemaVersion: NODESLIDE_PRODUCTION_ARTIFACT_SPEC_VERSION,
    id: authored?.artifactId ?? `artifact:${element.id}`,
    slideId: element.slideId,
    narrativeJob: authored?.narrativeJob ?? element.name,
    elementIds: [element.id],
    claimIds: authored?.claimIds ?? sourceIds.map((sourceId) => `claim:${sourceId}`),
    sourceIds,
    dataDigest: '',
    sourceDigest: digest(sourceIds.map((sourceId) => sourceById.get(sourceId) ?? sourceId)),
    locale: 'en-US',
    readingOrder: [element.id],
    editability:
      authored?.projection.editability ?? (staticFallback ? 'static-fallback' : 'native'),
    browserContract: 'native',
    pptxContract: staticFallback ? 'static-fallback' : 'native',
    pdfContract: 'static',
    accessibility: {
      label: element.name,
      ...(element.altText ? { altText: element.altText } : {}),
    },
    missingness: [],
    assumptions: [],
    knownFidelityDifferences: authored
      ? [...authored.projection.knownFidelityDifferences]
      : staticFallback
        ? ['PowerPoint uses the declared static fallback.']
        : [],
    provenance: authored
      ? artifactProvenance(authored.truthState, sourceIds, authored.rationale)
      : provenance(sourceIds, sourceById),
  };
}

function provenance(
  sourceIds: string[],
  sourceById: Map<string, DeckSnapshot['sources'][number]>,
): NodeSlideArtifactProvenance {
  if (sourceIds.length === 0) {
    return artifactProvenance(
      'derived',
      sourceIds,
      'Artifact is deterministically derived from authored deck structure without an evidence claim.',
    );
  }
  const sources = sourceIds.map((sourceId) => sourceById.get(sourceId));
  if (sources.some((source) => source === undefined || source.status === 'failed')) {
    return artifactProvenance(
      'missing',
      sourceIds,
      'At least one bound evidence source is unavailable or failed.',
    );
  }
  const evidenceText = sources
    .map((source) => `${source?.title ?? ''} ${source?.citation ?? ''}`)
    .join(' ');
  if (/\bnot[- ]run\b|\bunrun\b|\bnot measured\b|\bpending measurement\b/iu.test(evidenceText)) {
    return artifactProvenance(
      'not-run',
      sourceIds,
      'Bound evidence explicitly states that the measurement or run has not occurred.',
    );
  }
  if (
    /illustrative|example data|replace with measured|not for (?:external )?publication/iu.test(
      evidenceText,
    )
  ) {
    return artifactProvenance(
      'illustrative',
      sourceIds,
      'Bound evidence is explicitly labeled illustrative or unsuitable as an observed result.',
    );
  }
  if (/\bestimat(?:e|ed|ion)\b|\bforecast\b|\bprojection\b|\bmodeled\b/iu.test(evidenceText)) {
    return artifactProvenance(
      'estimated',
      sourceIds,
      'Bound evidence explicitly labels the value as estimated, forecast, projected, or modeled.',
    );
  }
  if (
    /\bobserved\b|\bmeasured\b|\bactual production\b/iu.test(evidenceText) ||
    sources.every(
      (source) =>
        source?.snapshot !== undefined ||
        ((source?.sourceType === 'document' || source?.sourceType === 'spreadsheet') &&
          source.contentDigest !== undefined),
    )
  ) {
    return artifactProvenance(
      'observed',
      sourceIds,
      'Bound evidence is an immutable capture/upload or explicitly identified as an observed measurement.',
    );
  }
  return artifactProvenance(
    'derived',
    sourceIds,
    'Sources are bound, but they do not establish an observed measurement; production truth remains derived.',
  );
}

function artifactProvenance(
  truthState: NodeSlideArtifactTruthState,
  sourceIds: string[],
  rationale: string,
): NodeSlideArtifactProvenance {
  return { truthState, rationale, sourceIds: unique(sourceIds) };
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function digest(value: unknown): string {
  return `sha256:${sha256Hex(canonicalJson(value))}`;
}

/** Public for cross-runtime receipt verification and known-vector tests. */
export function nodeSlideArtifactDigest(value: unknown): string {
  return digest(value);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

// Small synchronous SHA-256 implementation shared by Convex and browser export.
// Receipts therefore bind to identical bytes without relying on an async Web Crypto call.
function sha256Hex(value: string): string {
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const bytes = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const bitLength = BigInt(bytes.length) * 8n;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 1 - index] = Number((bitLength >> BigInt(index * 8)) & 0xffn);
  }
  const state = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const words = new Uint32Array(64);
  const rotate = (word: number, amount: number) => (word >>> amount) | (word << (32 - amount));
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] =
        ((padded[start] ?? 0) << 24) |
        ((padded[start + 1] ?? 0) << 16) |
        ((padded[start + 2] ?? 0) << 8) |
        (padded[start + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const left = words[index - 15] ?? 0;
      const right = words[index - 2] ?? 0;
      const sigma0 = rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3);
      const sigma1 = rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10);
      words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = state as [
      number,
      number,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choice + (constants[index] ?? 0) + (words[index] ?? 0)) >>> 0;
      const sum0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = ((state[0] ?? 0) + a) >>> 0;
    state[1] = ((state[1] ?? 0) + b) >>> 0;
    state[2] = ((state[2] ?? 0) + c) >>> 0;
    state[3] = ((state[3] ?? 0) + d) >>> 0;
    state[4] = ((state[4] ?? 0) + e) >>> 0;
    state[5] = ((state[5] ?? 0) + f) >>> 0;
    state[6] = ((state[6] ?? 0) + g) >>> 0;
    state[7] = ((state[7] ?? 0) + h) >>> 0;
  }
  return state.map((word) => word.toString(16).padStart(8, '0')).join('');
}
