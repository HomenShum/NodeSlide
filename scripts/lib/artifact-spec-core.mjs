import { createHash } from 'node:crypto';

export const ARTIFACT_SPEC_SCHEMA_VERSION = 'nodeslide.artifact-spec/v1';
export const ARTIFACT_RECEIPT_SCHEMA_VERSION = 'nodeslide.artifact-receipt/v2';

export const ARTIFACT_SPEC_KINDS = [
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

export function artifactSpecEnvelope(artifact, kind, payload) {
  const spec = {
    schemaVersion: ARTIFACT_SPEC_SCHEMA_VERSION,
    id: artifact.id,
    kind,
    narrativeJob: artifact.narrativeJob,
    claimIds: artifact.allowedClaims.map((_, index) => `${artifact.id}:claim:${index + 1}`),
    sourceIds: artifact.evidence.map((source) => source.sourceId),
    provenance: {
      status: 'derived',
      sourceDigest: digest(artifact.evidence),
      assumptions: [],
    },
    browserContract: 'semantic-and-visual',
    pptxContract: 'editable-or-declared-fallback',
    accessibility: artifact.accessibility,
    payload,
  };
  return { ...spec, specDigest: digest(spec) };
}

export function validateArtifactSpec(spec) {
  const issues = [];
  if (spec?.schemaVersion !== ARTIFACT_SPEC_SCHEMA_VERSION)
    issues.push(issue('artifact_schema_version', 'error', 'Unknown artifact spec version.'));
  if (!ARTIFACT_SPEC_KINDS.includes(spec?.kind))
    issues.push(issue('artifact_kind', 'error', 'Artifact kind is not supported.'));
  if (!nonEmpty(spec?.id)) issues.push(issue('artifact_id', 'error', 'Artifact ID is required.'));
  if (!Array.isArray(spec?.sourceIds) || spec.sourceIds.length === 0)
    issues.push(
      issue('artifact_source_binding', 'error', 'At least one source binding is required.'),
    );
  if (!spec?.payload || typeof spec.payload !== 'object')
    issues.push(issue('artifact_payload', 'error', 'Typed artifact payload is required.'));
  else validatePayload(spec, issues);
  return {
    ok: !issues.some((entry) => entry.severity === 'error'),
    issues,
    specDigest: spec?.specDigest ?? digest(spec),
  };
}

function validatePayload(spec, issues) {
  const payload = spec.payload;
  if (spec.kind === 'chart') validateChart(payload, issues);
  if (spec.kind === 'waterfall') validateWaterfall(payload, issues);
  if (spec.kind === 'sankey') validateSankey(payload, issues);
  if (spec.kind === 'graph') validateGraph(payload, issues);
  if (spec.kind === 'causal-loop') validateCausalLoop(payload, issues);
  if (spec.kind === 'timeline' || spec.kind === 'gantt')
    validateTimeline(payload, issues, spec.kind);
  if (spec.kind === 'evidence-media') validateEvidence(payload, issues);
  if (spec.kind === 'motion') validateMotion(payload, issues);
  if (spec.kind === 'comparison') validateComparison(payload, issues);
  if (spec.kind === 'equation') validateEquation(payload, issues);
  if (spec.kind === 'runtime-proof') validateRuntime(payload, issues);
  if (spec.kind === 'trace') validateTrace(payload, issues);
  if (spec.kind === 'risk-matrix') validateRisk(payload, issues);
  if (spec.kind === 'spatial-scene') validateSpatial(payload, issues);
}

function validateChart(payload, issues) {
  if (!nonEmpty(payload.unit))
    issues.push(issue('chart_unit_missing', 'error', 'Chart unit is required.'));
  if (!payload.xAxis?.labels?.length)
    issues.push(issue('chart_axis_labels_missing', 'error', 'X-axis labels are required.'));
  if (
    !finite(payload.yAxis?.min) ||
    !finite(payload.yAxis?.max) ||
    payload.yAxis.max <= payload.yAxis.min
  )
    issues.push(issue('chart_scale_invalid', 'error', 'A finite increasing Y scale is required.'));
  if (!Array.isArray(payload.series) || payload.series.length === 0)
    issues.push(issue('chart_series_missing', 'error', 'At least one series is required.'));
}

function validateWaterfall(payload, issues) {
  const baseline = Number(payload.baseline);
  const deltas = Array.isArray(payload.deltas) ? payload.deltas : [];
  const final = Number(payload.final);
  const calculated = baseline + deltas.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0);
  if (
    ![baseline, final, calculated].every(finite) ||
    Math.abs(calculated - final) > (payload.tolerance ?? 0.001)
  )
    issues.push(
      issue('waterfall_reconciliation', 'error', 'Baseline plus deltas must equal final.'),
    );
  if (!nonEmpty(payload.unit))
    issues.push(issue('chart_unit_missing', 'error', 'Waterfall unit is required.'));
  if (new Set(deltas.map((entry) => entry.label)).size !== deltas.length)
    issues.push(issue('waterfall_label_binding', 'error', 'Every delta needs a unique label.'));
}

function validateSankey(payload, issues) {
  const nodes = new Set((payload.nodes ?? []).map((node) => node.id));
  const balance = new Map([...nodes].map((id) => [id, { in: 0, out: 0 }]));
  for (const link of payload.links ?? []) {
    if (
      !nodes.has(link.source) ||
      !nodes.has(link.target) ||
      !finite(link.value) ||
      link.value < 0
    ) {
      issues.push(
        issue(
          'sankey_link_invalid',
          'error',
          'Every Sankey link needs valid nodes and a non-negative value.',
        ),
      );
      continue;
    }
    balance.get(link.source).out += link.value;
    balance.get(link.target).in += link.value;
  }
  for (const node of payload.nodes ?? []) {
    const value = balance.get(node.id);
    if (
      node.layer !== 'source' &&
      node.layer !== 'sink' &&
      Math.abs(value.in - value.out) > (payload.tolerance ?? 0.001)
    )
      issues.push(issue('sankey_conservation', 'error', `Flow is not conserved at ${node.id}.`));
  }
  if (!nonEmpty(payload.unit))
    issues.push(issue('chart_unit_missing', 'error', 'Sankey unit is required.'));
}

function validateGraph(payload, issues) {
  const nodes = new Set((payload.nodes ?? []).map((node) => node.id));
  for (const edge of payload.edges ?? []) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to))
      issues.push(issue('graph_edge_reference', 'error', 'Graph edge references an unknown node.'));
    if (payload.directed && edge.directed !== true)
      issues.push(
        issue('graph_direction_missing', 'error', 'Directed graphs require directed edges.'),
      );
  }
}

function validateCausalLoop(payload, issues) {
  validateGraph({ ...payload, directed: true }, issues);
  const edgeIds = new Set((payload.edges ?? []).map((edge) => edge.id));
  for (const edge of payload.edges ?? []) {
    if (!['+', '-'].includes(edge.polarity))
      issues.push(
        issue('causal_polarity_invalid', 'error', 'Causal edges require + or - polarity.'),
      );
  }
  for (const loop of payload.loops ?? []) {
    if (
      !['reinforcing', 'balancing'].includes(loop.type) ||
      !loop.edgeIds?.every((id) => edgeIds.has(id))
    )
      issues.push(
        issue('causal_loop_invalid', 'error', 'Loops require a type and valid edge membership.'),
      );
  }
}

function validateTimeline(payload, issues, kind) {
  const items = payload.tasks ?? payload.events ?? [];
  for (const item of items) {
    if (!finite(item.start) || !finite(item.end) || item.end < item.start)
      issues.push(
        issue('timeline_interval_invalid', 'error', 'Timeline intervals must be ordered.'),
      );
    if (kind === 'gantt' && !finite(item.confidence))
      issues.push(issue('gantt_confidence_missing', 'error', 'Gantt tasks require confidence.'));
  }
  if (kind === 'gantt') {
    const ids = new Set(items.map((item) => item.id));
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const item of items) {
      if ((item.dependsOn ?? []).some((id) => !ids.has(id)))
        issues.push(
          issue(
            'gantt_dependency_invalid',
            'error',
            'Gantt dependency references an unknown task.',
          ),
        );
      if (
        (item.dependsOn ?? []).some((id) => {
          const dependency = byId.get(id);
          return dependency && item.start < dependency.end;
        })
      )
        issues.push(
          issue(
            'gantt_dependency_precedence',
            'error',
            'A dependent Gantt task cannot begin before its dependency ends.',
          ),
        );
    }
  }
}

function validateEvidence(payload, issues) {
  if (!['application/pdf', 'image/png', 'image/jpeg', 'text/html'].includes(payload.mimeType))
    issues.push(issue('evidence_mime_mismatch', 'error', 'Evidence MIME type is unsupported.'));
  if (!nonEmpty(payload.digest) || !nonEmpty(payload.claimId))
    issues.push(
      issue('evidence_binding_missing', 'error', 'Evidence digest and claim binding are required.'),
    );
  if (payload.mimeType === 'application/pdf' && (!finite(payload.page) || !payload.region))
    issues.push(issue('pdf_region_missing', 'error', 'PDF evidence requires a page and region.'));
}

function validateMotion(payload, issues) {
  if (!Array.isArray(payload.states) || payload.states.length < 2)
    issues.push(
      issue('motion_states_missing', 'error', 'Motion artifacts require at least two states.'),
    );
  if (!nonEmpty(payload.staticFallbackStateId))
    issues.push(issue('motion_fallback_missing', 'error', 'A static fallback state is required.'));
}

function validateComparison(payload, issues) {
  const observed = (payload.cohorts ?? []).filter((cohort) => cohort.status === 'observed');
  for (const cohort of observed) {
    for (const metric of payload.metrics ?? []) {
      if (!finite(cohort.values?.[metric.id]))
        issues.push(
          issue(
            'comparison_observed_value_missing',
            'error',
            `${cohort.id} lacks observed ${metric.id}.`,
          ),
        );
    }
  }
  if (
    (payload.cohorts ?? []).some(
      (cohort) => cohort.status !== 'observed' && cohort.plotted === true,
    )
  )
    issues.push(
      issue(
        'comparison_unobserved_plotted',
        'error',
        'Unobserved cohorts cannot be plotted as measured.',
      ),
    );
}

function validateEquation(payload, issues) {
  const evaluated = evaluateExpression(payload.expression, payload.values ?? {});
  if (
    !finite(evaluated) ||
    !finite(payload.result) ||
    Math.abs(evaluated - payload.result) > (payload.tolerance ?? 0.0001)
  )
    issues.push(
      issue(
        'equation_evaluation_mismatch',
        'error',
        'Displayed result does not match the expression AST.',
      ),
    );
}

function validateRuntime(payload, issues) {
  if (payload.status === 'illustrative-not-measured') {
    issues.push(
      issue(
        'runtime_receipt_unbound',
        'warning',
        'Runtime panel is explicitly illustrative and cannot support a measured claim.',
      ),
    );
    return;
  }
  if (
    !Number.isInteger(payload.sampleSize) ||
    payload.sampleSize < 2 ||
    !nonEmpty(payload.receiptDigest)
  )
    issues.push(
      issue(
        'runtime_receipt_unbound',
        'error',
        'Runtime statistics require repeated samples and a receipt digest.',
      ),
    );
}

function validateTrace(payload, issues) {
  if (payload.status === 'illustrative-not-observed')
    issues.push(
      issue(
        'trace_receipt_unbound',
        'warning',
        'Illustrative trace is not observed production evidence.',
      ),
    );
  if (!nonEmpty(payload.traceId) || !(payload.spans ?? []).every((span) => nonEmpty(span.spanId)))
    issues.push(issue('trace_identity_missing', 'error', 'Trace and span IDs are required.'));
}

function validateRisk(payload, issues) {
  if (
    !nonEmpty(payload.likelihoodAxis?.low) ||
    !nonEmpty(payload.likelihoodAxis?.high) ||
    !nonEmpty(payload.impactAxis?.low) ||
    !nonEmpty(payload.impactAxis?.high)
  )
    issues.push(issue('risk_axis_labels_missing', 'error', 'Risk axes require low/high anchors.'));
}

function validateSpatial(payload, issues) {
  if (
    !(payload.viewports ?? []).some(
      (viewport) => viewport.selectedNodeId && viewport.sourceIds?.length,
    )
  )
    issues.push(
      issue(
        'spatial_state_unproven',
        'error',
        'A spatial scene needs a selected, source-bound viewport state.',
      ),
    );
}

export function evaluateExpression(expression, values) {
  if (expression?.op === 'value') return Number(values[expression.name]);
  const args = (expression?.args ?? []).map((arg) => evaluateExpression(arg, values));
  if (args.some((value) => !finite(value))) return Number.NaN;
  if (expression?.op === 'add') return args.reduce((sum, value) => sum + value, 0);
  if (expression?.op === 'multiply') return args.reduce((product, value) => product * value, 1);
  if (expression?.op === 'divide') return args[0] / args[1];
  return Number.NaN;
}

export function buildArtifactReceipt({ spec, validation, stages = {}, metadata = {} }) {
  const hardStages = ['spec', 'semantic', 'evidence', 'browser', 'pptx', 'accessibility'];
  const normalizedStages = Object.fromEntries(
    hardStages.map((stage) => [stage, stages[stage] ?? { status: 'not_run', issues: [] }]),
  );
  const eligible =
    validation.ok && hardStages.every((stage) => normalizedStages[stage].status === 'passed');
  const receipt = {
    schemaVersion: ARTIFACT_RECEIPT_SCHEMA_VERSION,
    artifactId: spec.id,
    specDigest: spec.specDigest,
    stages: normalizedStages,
    humanPreference: stages.humanPreference ?? { status: 'pending' },
    status: eligible ? 'eligible' : 'provisional',
    metadata,
  };
  return { ...receipt, receiptDigest: digest(receipt) };
}

function issue(code, severity, message) {
  return { code, severity, message };
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

export function digest(value) {
  return createHash('sha256').update(stableSerialize(value)).digest('hex');
}

function stableSerialize(value) {
  return JSON.stringify(canonical(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical(value[key])]),
  );
}
