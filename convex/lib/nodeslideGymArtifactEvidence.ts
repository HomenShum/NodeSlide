import type { DeckSnapshot, SourceRecord } from '../../shared/nodeslide';
import {
  NODESLIDE_CANONICAL_ARTIFACT_KINDS,
  type NodeSlideCanonicalArtifactKind,
  type NodeSlideCanonicalArtifactSpec,
  normalizeNodeSlideCanonicalArtifactSpec,
} from '../../shared/nodeslideArtifactRegistry.js';
import { nodeSlideArtifactDigest } from '../../shared/nodeslideArtifactSpec';
import {
  type NodeSlideAuthoredArtifactReceipt,
  nodeSlideAuthoredArtifactReceiptLineageMatches,
} from './nodeslideAuthoredArtifact';
import { nodeslideContentDigest } from './nodeslideIds';

export const NODESLIDE_GYM_ARTIFACT_EVIDENCE_SCHEMA = 'nodeslide.gym-artifact-evidence/v1' as const;

export interface NodeSlideGymArtifactEvidenceReceipt {
  schemaVersion: typeof NODESLIDE_GYM_ARTIFACT_EVIDENCE_SCHEMA;
  status: 'passed' | 'failed';
  issueCodes: string[];
  normalizedSpec?: NodeSlideCanonicalArtifactSpec & { specDigest: string };
  sourceSpecDigest?: string;
  persistedBindingDigest?: string;
  projectedSpecDigest?: string;
  sourceMappingDigest?: string;
  redactionPolicy: 'bounded-kind-projection-v1';
  userVisible: false;
  mutationApplied: false;
  receiptDigest: string;
}

/**
 * Projects one exact persisted authored spec into the content-minimized Gym
 * schema. The source spec and compiler receipt must match an immutable
 * rendered binding first. Free-text identity, narrative, provenance, labels,
 * URLs, and unproven source aliases are never returned. A projected source id
 * must be either an authored source ref or a typed identity found inside the
 * exact digest-verified persisted attachment bound to the rendered artifact.
 */
export function buildNodeSlideGymArtifactEvidence(args: {
  storedSpec: unknown;
  snapshot: Pick<DeckSnapshot, 'elements' | 'sources'>;
  artifactKind: string;
  claimIds: readonly string[];
  sourceIds: readonly string[];
}): NodeSlideGymArtifactEvidenceReceipt {
  const artifactKind = NODESLIDE_CANONICAL_ARTIFACT_KINDS.includes(
    args.artifactKind as NodeSlideCanonicalArtifactKind,
  )
    ? (args.artifactKind as NodeSlideCanonicalArtifactKind)
    : null;
  const claimIds = uniqueBounded(args.claimIds);
  const sourceIds = uniqueBounded(args.sourceIds);
  if (!artifactKind || claimIds.length === 0 || sourceIds.length === 0)
    return failed(['gym_projection_request_invalid']);

  const storedSlides =
    isRecord(args.storedSpec) && Array.isArray(args.storedSpec['slides'])
      ? args.storedSpec['slides']
      : [];
  const matches: Array<{
    spec: NodeSlideCanonicalArtifactSpec;
    receipt: NodeSlideAuthoredArtifactReceipt;
    binding: NonNullable<DeckSnapshot['elements'][number]['authoredArtifactBinding']>;
  }> = [];
  for (const slide of storedSlides) {
    if (!isRecord(slide)) continue;
    const spec = slide['authoredArtifactSpec'] as NodeSlideCanonicalArtifactSpec | undefined;
    const receipt = slide['authoredArtifactCompilation'] as
      | NodeSlideAuthoredArtifactReceipt
      | undefined;
    if (!spec || !receipt || spec.kind !== artifactKind) continue;
    if (!sameStrings(spec.claimIds, claimIds)) continue;
    if (!nodeSlideAuthoredArtifactReceiptLineageMatches(spec, receipt))
      return failed(['gym_source_receipt_lineage_invalid']);
    const resolvedSourceIds = resolveAuthoredSourceRefs(args.snapshot.sources, spec.sourceIds);
    if (!resolvedSourceIds) return failed(['gym_authored_source_resolution_failed']);
    const renderedElements = args.snapshot.elements.filter((element) => {
      const binding = element.authoredArtifactBinding;
      return Boolean(
        binding &&
          (binding.artifactId === spec.id ||
            binding.specDigest === receipt.authoredSpecDigest ||
            element.artifactBinding?.artifactId === spec.id),
      );
    });
    if (renderedElements.length === 0) return failed(['gym_persisted_binding_missing']);
    if (
      renderedElements.some(
        (element) =>
          !element.authoredArtifactBinding ||
          !authoredBindingExactlyMatches(
            element.authoredArtifactBinding,
            spec,
            receipt,
            resolvedSourceIds,
          ) ||
          !sameOrderedStrings(element.sourceIds, resolvedSourceIds),
      )
    )
      return failed(['gym_persisted_binding_invalid']);
    const bindings = renderedElements.flatMap((element) =>
      element.authoredArtifactBinding ? [element.authoredArtifactBinding] : [],
    );
    const firstBinding = bindings[0];
    if (!firstBinding) return failed(['gym_persisted_binding_missing']);
    if (
      bindings.some(
        (binding) => digestAuthoredBinding(binding) !== digestAuthoredBinding(firstBinding),
      )
    )
      return failed(['gym_persisted_binding_ambiguous']);
    const boundSources = resolvedSourceIds.flatMap((sourceId) => {
      const source = args.snapshot.sources.find((entry) => entry.id === sourceId);
      return source ? [source] : [];
    });
    const provenSourceIds = new Set([
      ...spec.sourceIds,
      ...boundSources.flatMap((source) => provenNodeGymSourceIds(source)),
    ]);
    if (!sourceIds.every((sourceId) => provenSourceIds.has(sourceId)))
      return failed(['gym_source_identity_unproven']);
    matches.push({ spec, receipt, binding: firstBinding });
  }
  if (matches.length !== 1)
    return failed([matches.length === 0 ? 'gym_exact_spec_missing' : 'gym_exact_spec_ambiguous']);

  const match = matches[0];
  if (!match) return failed(['gym_exact_spec_missing']);
  const { spec, receipt, binding } = match;
  const payload = projectPayload(artifactKind, spec.payload, claimIds);
  if (!payload) return failed(['gym_payload_projection_unsupported']);
  const projected = {
    schemaVersion: 'nodeslide.artifact-spec/v1',
    id: `gym-artifact-${receipt.authoredSpecDigest.slice(-20)}`,
    kind: artifactKind,
    narrativeJob: `Gym ${artifactKind} evidence projection.`,
    claimIds,
    sourceIds,
    provenance: {
      truthState: spec.provenance.truthState,
      rationale: 'Owner-authorized digest-bound Gym projection; free text redacted.',
      sourceRefs: sourceIds,
    },
    payload,
  };
  const normalized = normalizeNodeSlideCanonicalArtifactSpec(projected);
  if (!normalized.ok || !normalized.spec) return failed(['gym_projected_spec_invalid']);
  const projectedSpecDigest = nodeSlideArtifactDigest(normalized.spec);
  const persistedBindingDigest = digestAuthoredBinding(binding);
  const sourceMappingDigest = nodeSlideArtifactDigest({
    sourceSpecDigest: receipt.authoredSpecDigest,
    authoredSourceRefs: [...spec.sourceIds],
    persistedSourceBindingDigest: nodeSlideArtifactDigest([...binding.sourceIds]),
    projectedSourceIds: sourceIds,
  });
  const normalizedSpec = { ...normalized.spec, specDigest: projectedSpecDigest.slice(7) };
  const unsigned: Omit<NodeSlideGymArtifactEvidenceReceipt, 'receiptDigest'> = {
    schemaVersion: NODESLIDE_GYM_ARTIFACT_EVIDENCE_SCHEMA,
    status: 'passed',
    issueCodes: [],
    normalizedSpec,
    sourceSpecDigest: receipt.authoredSpecDigest,
    persistedBindingDigest,
    projectedSpecDigest,
    sourceMappingDigest,
    redactionPolicy: 'bounded-kind-projection-v1',
    userVisible: false,
    mutationApplied: false,
  };
  return { ...unsigned, receiptDigest: nodeSlideArtifactDigest(unsigned) };
}

function projectPayload(
  kind: NodeSlideCanonicalArtifactKind,
  payload: unknown,
  claimIds: readonly string[],
): Record<string, unknown> | null {
  if (!isRecord(payload)) return null;
  switch (kind) {
    case 'chart': {
      const series = Array.isArray(payload['series']) ? payload['series'] : [];
      const labels =
        isRecord(payload['xAxis']) && Array.isArray(payload['xAxis']['labels'])
          ? payload['xAxis']['labels']
          : [];
      return {
        unit: 'unit',
        xAxis: { labels: labels.map((_, index) => `category-${index + 1}`) },
        yAxis: numericRange(payload['yAxis']),
        series: series.map((entry, index) => ({
          id: `series-${index + 1}`,
          values:
            isRecord(entry) && Array.isArray(entry['values']) ? numericArray(entry['values']) : [],
        })),
        ...(typeof payload['missingValuePolicy'] === 'string'
          ? { missingValuePolicy: payload['missingValuePolicy'] }
          : {}),
      };
    }
    case 'waterfall':
      return {
        unit: 'unit',
        baseline: finite(payload['baseline']),
        deltas: (Array.isArray(payload['deltas']) ? payload['deltas'] : []).map((entry, index) => ({
          label: `delta-${index + 1}`,
          value: isRecord(entry) ? finite(entry['value']) : Number.NaN,
        })),
        final: finite(payload['final']),
        ...(Number.isFinite(payload['tolerance']) ? { tolerance: payload['tolerance'] } : {}),
      };
    case 'causal-loop': {
      const nodes = Array.isArray(payload['nodes']) ? payload['nodes'].filter(isRecord) : [];
      const nodeMap = new Map(
        nodes.map((node, index) => [String(node['id']), `node-${index + 1}`]),
      );
      const edges = Array.isArray(payload['edges']) ? payload['edges'].filter(isRecord) : [];
      const edgeMap = new Map(
        edges.map((edge, index) => [String(edge['id']), `edge-${index + 1}`]),
      );
      return {
        nodes: nodes.map((_, index) => ({ id: `node-${index + 1}`, label: `Node ${index + 1}` })),
        edges: edges.map((edge, index) => ({
          id: `edge-${index + 1}`,
          from: nodeMap.get(String(edge['from'])) ?? 'invalid-node',
          to: nodeMap.get(String(edge['to'])) ?? 'invalid-node',
          directed: true,
          polarity: edge['polarity'],
        })),
        loops: (Array.isArray(payload['loops']) ? payload['loops'].filter(isRecord) : []).map(
          (loop, index) => ({
            id: `loop-${index + 1}`,
            type: loop['type'],
            edgeIds: Array.isArray(loop['edgeIds'])
              ? loop['edgeIds'].map((id) => edgeMap.get(String(id)) ?? 'invalid-edge')
              : [],
          }),
        ),
      };
    }
    case 'comparison': {
      const metrics = Array.isArray(payload['metrics']) ? payload['metrics'].filter(isRecord) : [];
      const metricMap = new Map(
        metrics.map((metric, index) => [String(metric['id']), `metric-${index + 1}`]),
      );
      return {
        metrics: metrics.map((_, index) => ({ id: `metric-${index + 1}`, unit: 'unit' })),
        cohorts: (Array.isArray(payload['cohorts']) ? payload['cohorts'].filter(isRecord) : []).map(
          (cohort, index) => ({
            id: `cohort-${index + 1}`,
            status: cohort['status'],
            plotted: cohort['plotted'],
            values: Object.fromEntries(
              Object.entries(isRecord(cohort['values']) ? cohort['values'] : {}).flatMap(
                ([metricId, value]) => {
                  const projectedMetricId = metricMap.get(metricId);
                  return projectedMetricId && Number.isFinite(value)
                    ? [[projectedMetricId, value]]
                    : [];
                },
              ),
            ),
          }),
        ),
      };
    }
    case 'equation': {
      const values = isRecord(payload['values']) ? payload['values'] : {};
      const valueMap = new Map(
        Object.keys(values)
          .sort()
          .map((name, index) => [name, `value_${index + 1}`]),
      );
      return {
        expression: projectExpression(payload['expression'], valueMap),
        values: Object.fromEntries(
          [...valueMap].map(([name, projected]) => [projected, finite(values[name])]),
        ),
        result: finite(payload['result']),
        ...(Number.isFinite(payload['tolerance']) ? { tolerance: payload['tolerance'] } : {}),
      };
    }
    case 'evidence-media':
      return {
        mimeType: payload['mimeType'],
        digest: payload['digest'],
        claimId: claimIds[0],
        altText: 'Redacted bounded evidence.',
        ...(Number.isInteger(payload['page']) ? { page: payload['page'] } : {}),
        ...(isRecord(payload['region'])
          ? {
              region: Object.fromEntries(
                Object.entries(payload['region']).filter(([, value]) => Number.isFinite(value)),
              ),
            }
          : {}),
      };
    default:
      return null;
  }
}

function projectExpression(value: unknown, names: ReadonlyMap<string, string>): unknown {
  if (!isRecord(value) || typeof value['op'] !== 'string') return value;
  if (value['op'] === 'value')
    return { op: 'value', name: names.get(String(value['name'])) ?? 'invalid' };
  return {
    op: value['op'],
    args: Array.isArray(value['args'])
      ? value['args'].map((argument) => projectExpression(argument, names))
      : [],
  };
}

function numericRange(value: unknown): { min: number; max: number } {
  return isRecord(value)
    ? { min: finite(value['min']), max: finite(value['max']) }
    : { min: Number.NaN, max: Number.NaN };
}

function numericArray(value: readonly unknown[]): Array<number | null> {
  return value.map((entry) => (entry === null ? null : finite(entry)));
}

function finite(value: unknown): number {
  return Number.isFinite(value) ? Number(value) : Number.NaN;
}

function authoredBindingExactlyMatches(
  binding: NonNullable<DeckSnapshot['elements'][number]['authoredArtifactBinding']>,
  spec: NodeSlideCanonicalArtifactSpec,
  receipt: NodeSlideAuthoredArtifactReceipt,
  resolvedSourceIds: readonly string[],
): boolean {
  return (
    binding.schemaVersion === 'nodeslide.authored-artifact-binding/v1' &&
    binding.artifactId === spec.id &&
    binding.kind === spec.kind &&
    binding.narrativeJob === spec.narrativeJob &&
    binding.truthState === spec.provenance.truthState &&
    binding.rationale === spec.provenance.rationale &&
    sameOrderedStrings(binding.claimIds, spec.claimIds) &&
    sameOrderedStrings(binding.sourceIds, resolvedSourceIds) &&
    binding.specDigest === receipt.authoredSpecDigest &&
    nodeSlideArtifactDigest(binding.projection) === nodeSlideArtifactDigest(receipt.projection)
  );
}

function resolveAuthoredSourceRefs(
  sources: readonly SourceRecord[],
  sourceRefs: readonly string[],
): string[] | null {
  const briefSources = sources.filter((source) => source.sourceType === 'internal');
  const evidenceSources = sources.filter(
    (source) =>
      source.sourceType === 'note' &&
      (source.title === 'Brief success criteria' || source.title === 'Golden workflow scenario'),
  );
  const attachments = sources.filter(
    (source) =>
      source.license === 'User supplied' &&
      source.format !== undefined &&
      source.contentDigest !== undefined,
  );
  const links = sources.filter(
    (source) =>
      source.sourceType === 'url' &&
      source.license?.startsWith('User-supplied linked evidence') === true,
  );
  const resolved: string[] = [];
  for (const sourceRef of sourceRefs) {
    let source: SourceRecord | undefined;
    if (sourceRef === 'brief:prompt') source = briefSources[0];
    else if (sourceRef === 'brief:success-criteria') source = evidenceSources[0];
    else {
      const attachment = sourceRef.match(/^attachment:(\d+)$/u);
      const link = sourceRef.match(/^link:(\d+)$/u);
      if (attachment) source = attachments[Number(attachment[1]) - 1];
      else if (link) source = links[Number(link[1]) - 1];
    }
    if (!source || source.deckId !== sources[0]?.deckId) return null;
    if (!resolved.includes(source.id)) resolved.push(source.id);
  }
  return resolved.length > 0 ? resolved : null;
}

/**
 * Reads only typed source identifiers from the exact digest-verified bounded
 * attachment persisted by the UI executor. Arbitrary strings elsewhere in a
 * citation are not treated as identities.
 */
function provenNodeGymSourceIds(source: SourceRecord): string[] {
  if (!source.contentDigest || !source.citation.startsWith('Uploaded file: ')) return [];
  const separator = source.citation.indexOf('\n');
  if (separator < 0) return [];
  const content = source.citation.slice(separator + 1);
  if (nodeslideContentDigest(content) !== source.contentDigest) return [];
  if (
    source.byteSize !== undefined &&
    new TextEncoder().encode(content).byteLength !== source.byteSize
  )
    return [];
  const jsonStart = content.indexOf('{');
  if (jsonStart < 0) return [];
  let context: unknown;
  try {
    context = JSON.parse(content.slice(jsonStart));
  } catch {
    return [];
  }
  const identities = new Set<string>();
  collectTypedSourceIds(context, '', identities);
  return [...identities].sort();
}

function collectTypedSourceIds(value: unknown, key: string, identities: Set<string>): void {
  if (Array.isArray(value)) {
    if (key === 'sourceIds' || key === 'immutableSourceIds') {
      for (const entry of value)
        if (typeof entry === 'string' && entry.trim()) identities.add(entry);
      return;
    }
    if (key === 'sources' || key === 'sourceDigests' || key === 'sourceSummaries') {
      for (const entry of value)
        if (isRecord(entry) && typeof entry['id'] === 'string' && entry['id'].trim())
          identities.add(entry['id']);
    }
    for (const entry of value) collectTypedSourceIds(entry, '', identities);
    return;
  }
  if (!isRecord(value)) return;
  for (const [childKey, entry] of Object.entries(value))
    collectTypedSourceIds(entry, childKey, identities);
}

function digestAuthoredBinding(
  binding: NonNullable<DeckSnapshot['elements'][number]['authoredArtifactBinding']>,
): string {
  return nodeSlideArtifactDigest({
    artifactId: binding.artifactId,
    kind: binding.kind,
    narrativeJob: binding.narrativeJob,
    truthState: binding.truthState,
    rationale: binding.rationale,
    claimIds: [...binding.claimIds].sort(),
    sourceIds: [...binding.sourceIds].sort(),
    specDigest: binding.specDigest,
    projection: binding.projection,
  });
}

function failed(issueCodes: string[]): NodeSlideGymArtifactEvidenceReceipt {
  const unsigned: Omit<NodeSlideGymArtifactEvidenceReceipt, 'receiptDigest'> = {
    schemaVersion: NODESLIDE_GYM_ARTIFACT_EVIDENCE_SCHEMA,
    status: 'failed',
    issueCodes: [...new Set(issueCodes)].sort(),
    redactionPolicy: 'bounded-kind-projection-v1',
    userVisible: false,
    mutationApplied: false,
  };
  return { ...unsigned, receiptDigest: nodeSlideArtifactDigest(unsigned) };
}

function uniqueBounded(values: readonly string[]): string[] {
  if (!Array.isArray(values) || values.length > 32) return [];
  const normalized = [...new Set(values.map((value) => value.trim()))].sort();
  return normalized.every((value) => value.length > 0 && value.length <= 160) ? normalized : [];
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return uniqueBounded(left).join('\u001f') === uniqueBounded(right).join('\u001f');
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
