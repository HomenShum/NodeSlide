export const NODESLIDE_SEMANTIC_ISSUE_CATALOG_VERSION = 'nodeslide.semantic-issue-catalog/v1';

const VISUAL_FAMILIES = new Set([
  'chart',
  'waterfall',
  'sankey',
  'graph',
  'causal-loop',
  'timeline',
  'gantt',
  'comparison',
  'runtime-proof',
  'trace',
  'risk-matrix',
  'spatial-scene',
]);

export function validateNodeSlideArtifactDepth(spec, options = {}) {
  const issues = [];
  if (!spec || typeof spec !== 'object') return issues;
  if (spec.kind === 'equation') validateUnitAlgebra(spec.payload, issues);
  if (spec.kind === 'graph' || spec.kind === 'causal-loop')
    validateGraphDepth(spec.payload, issues);
  if (spec.kind === 'chart') validateChartDepth(spec.payload, issues);
  if (spec.kind === 'evidence-media') validateEvidenceDepth(spec.payload, options, issues);
  if (spec.kind === 'runtime-proof') validateRuntimeDepth(spec.payload, issues);
  if (spec.kind === 'trace') validateTraceDepth(spec.payload, issues);
  if (VISUAL_FAMILIES.has(spec.kind)) validateRedundantEncoding(spec.payload, issues);
  return issues;
}

export function validateNodeSlideDeckRhythm(slides, options = {}) {
  const issues = [];
  if (!Array.isArray(slides) || slides.length === 0) return issues;
  const maxConsecutiveText = options.maxConsecutiveText ?? 2;
  const maxSameComposition = options.maxSameComposition ?? 2;
  const minimumArchetypes = Math.min(options.minimumArchetypes ?? 5, slides.length);
  let textRun = 0;
  for (let index = 0; index < slides.length; index += 1) {
    const slide = slides[index] ?? {};
    textRun = slide.textDominant === true ? textRun + 1 : 0;
    if (textRun > maxConsecutiveText)
      issues.push(
        issue(
          'deck_rhythm_text_run',
          `More than ${maxConsecutiveText} consecutive slides are text-dominant.`,
          `$.slides[${index}]`,
        ),
      );
  }
  const signatures = slides.map((slide) => slide?.compositionSignature).filter(nonEmpty);
  const counts = countValues(signatures);
  for (const [signature, count] of counts)
    if (count > maxSameComposition)
      issues.push(
        issue(
          'deck_rhythm_composition_repetition',
          `Composition ${signature} repeats ${count} times.`,
          '$.slides',
        ),
      );
  const archetypes = new Set(slides.map((slide) => slide?.archetype).filter(nonEmpty));
  if (archetypes.size < minimumArchetypes)
    issues.push(
      issue(
        'deck_rhythm_archetype_variety',
        `Deck has ${archetypes.size} archetypes; ${minimumArchetypes} are required.`,
        '$.slides',
      ),
    );
  const jobs = slides.map((slide) => slide?.narrativeJob).filter(nonEmpty);
  if (new Set(jobs).size !== jobs.length)
    issues.push(
      issue(
        'deck_narrative_job_repetition',
        'Every slide requires a distinct narrative job.',
        '$.slides',
      ),
    );
  slides.forEach((slide, index) => {
    if (!nonEmpty(slide?.dominantArtifact))
      issues.push(
        issue(
          'deck_dominant_artifact_missing',
          'Every slide requires one dominant visual artifact.',
          `$.slides[${index}].dominantArtifact`,
        ),
      );
  });
  return deduplicateIssues(issues);
}

function validateUnitAlgebra(payload, issues) {
  if (!payload || typeof payload !== 'object') return;
  const symbolUnits = payload.symbolUnits;
  const resultUnit = payload.resultUnit;
  if (symbolUnits === undefined && resultUnit === undefined) return;
  if (!symbolUnits || typeof symbolUnits !== 'object') {
    issues.push(
      issue(
        'equation_unit_missing',
        'Unit-aware equations require a symbolUnits map.',
        '$.payload.symbolUnits',
      ),
    );
    return;
  }
  const result = expressionDimension(
    payload.expression,
    symbolUnits,
    issues,
    '$.payload.expression',
  );
  if (!nonEmpty(resultUnit))
    issues.push(
      issue(
        'equation_result_unit_missing',
        'Unit-aware equations require resultUnit.',
        '$.payload.resultUnit',
      ),
    );
  else if (result && canonicalDimension(resultUnit) !== dimensionKey(result))
    issues.push(
      issue(
        'equation_result_unit_mismatch',
        `Expression dimension ${dimensionKey(result)} does not match ${resultUnit}.`,
        '$.payload.resultUnit',
      ),
    );
}

function expressionDimension(expression, symbolUnits, issues, path) {
  if (!expression || typeof expression !== 'object') return null;
  if (expression.op === 'value') {
    const unit = symbolUnits[expression.name];
    if (!nonEmpty(unit)) {
      issues.push(
        issue(
          'equation_symbol_unit_missing',
          `No unit is declared for ${String(expression.name)}.`,
          path,
        ),
      );
      return null;
    }
    return parseDimension(unit);
  }
  if (expression.op === 'literal') return parseDimension(expression.unit ?? '1');
  const args = Array.isArray(expression.args) ? expression.args : [];
  const dimensions = args.map((entry, index) =>
    expressionDimension(entry, symbolUnits, issues, `${path}.args[${index}]`),
  );
  if (dimensions.some((entry) => entry === null)) return null;
  if (expression.op === 'add' || expression.op === 'subtract') {
    const [first, ...rest] = dimensions;
    if (!first || rest.some((entry) => dimensionKey(entry) !== dimensionKey(first))) {
      issues.push(
        issue(
          'equation_unit_mismatch',
          'Addition and subtraction require dimensionally identical operands.',
          path,
        ),
      );
      return null;
    }
    return first;
  }
  if (expression.op === 'multiply')
    return dimensions.reduce((accumulator, entry) => combineDimensions(accumulator, entry, 1), {});
  if (expression.op === 'divide' && dimensions.length === 2)
    return combineDimensions(dimensions[0], dimensions[1], -1);
  return dimensions[0] ?? parseDimension('1');
}

function validateGraphDepth(payload, issues) {
  if (!payload || typeof payload !== 'object') return;
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  const adjacency = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) if (adjacency.has(edge?.from)) adjacency.get(edge.from).push(edge.to);
  const requirements = Array.isArray(payload.requiredReachability)
    ? payload.requiredReachability
    : nonEmpty(payload.rootId)
      ? nodes
          .filter((node) => node.id !== payload.rootId)
          .map((node) => ({ from: payload.rootId, to: node.id }))
      : [];
  requirements.forEach((requirement, index) => {
    if (!reachable(adjacency, requirement?.from, requirement?.to))
      issues.push(
        issue(
          'graph_reachability_missing',
          `No directed path exists from ${String(requirement?.from)} to ${String(requirement?.to)}.`,
          `$.payload.requiredReachability[${index}]`,
        ),
      );
  });
  for (let left = 0; left < edges.length; left += 1) {
    for (let right = left + 1; right < edges.length; right += 1) {
      const a = edges[left];
      const b = edges[right];
      if ([a?.from, a?.to].some((id) => id === b?.from || id === b?.to)) continue;
      const a1 = nodes.find((node) => node.id === a?.from)?.position;
      const a2 = nodes.find((node) => node.id === a?.to)?.position;
      const b1 = nodes.find((node) => node.id === b?.from)?.position;
      const b2 = nodes.find((node) => node.id === b?.to)?.position;
      if ([a1, a2, b1, b2].every(point) && segmentsCross(a1, a2, b1, b2))
        issues.push(
          issue(
            'graph_edge_crossing',
            `Edges ${String(a?.id ?? left)} and ${String(b?.id ?? right)} cross.`,
            '$.payload.edges',
          ),
        );
    }
  }
}

function validateChartDepth(payload, issues) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.series)) return;
  payload.series.forEach((series, seriesIndex) => {
    const values = Array.isArray(series?.values) ? series.values : [];
    if (values.some((value) => value === null) && !nonEmpty(payload.missingValuePolicy))
      issues.push(
        issue(
          'chart_missing_value_policy_missing',
          'Null chart values require an explicit missingValuePolicy.',
          `$.payload.series[${seriesIndex}].values`,
        ),
      );
    if (!series?.uncertainty) return;
    const lower = series.uncertainty.lower;
    const upper = series.uncertainty.upper;
    if (
      !Array.isArray(lower) ||
      !Array.isArray(upper) ||
      lower.length !== values.length ||
      upper.length !== values.length
    ) {
      issues.push(
        issue(
          'chart_uncertainty_alignment',
          'Uncertainty bounds must align with every series value.',
          `$.payload.series[${seriesIndex}].uncertainty`,
        ),
      );
      return;
    }
    values.forEach((value, index) => {
      if (value === null) {
        if (lower[index] !== null || upper[index] !== null)
          issues.push(
            issue(
              'chart_uncertainty_missing_value_mismatch',
              'A missing value cannot carry measured uncertainty bounds.',
              `$.payload.series[${seriesIndex}].uncertainty`,
            ),
          );
        return;
      }
      if (
        !finite(lower[index]) ||
        !finite(upper[index]) ||
        lower[index] > value ||
        upper[index] < value
      )
        issues.push(
          issue(
            'chart_uncertainty_invalid',
            'Every measured value must lie inside finite lower and upper bounds.',
            `$.payload.series[${seriesIndex}].uncertainty`,
          ),
        );
    });
  });
}

function validateEvidenceDepth(payload, options, issues) {
  if (!payload || typeof payload !== 'object') return;
  if (payload.captureContract === undefined) return;
  const contract = payload.captureContract;
  const now = options.now ?? Date.now();
  if (
    !finite(contract?.capturedAt) ||
    !finite(contract?.maxAgeMs) ||
    contract.maxAgeMs <= 0 ||
    now - contract.capturedAt > contract.maxAgeMs
  )
    issues.push(
      issue(
        'evidence_capture_stale',
        'Captured evidence is outside its declared freshness window.',
        '$.payload.captureContract',
      ),
    );
  if (
    nonEmpty(contract?.domSelector) &&
    (!rect(contract?.domBounds) || contract.domBounds.width <= 0 || contract.domBounds.height <= 0)
  )
    issues.push(
      issue(
        'evidence_dom_bounds_invalid',
        'A DOM selector requires finite positive capture bounds.',
        '$.payload.captureContract.domBounds',
      ),
    );
  if (nonEmpty(contract?.ocrText) && !isDigest(contract?.ocrTextDigest))
    issues.push(
      issue(
        'evidence_ocr_binding_missing',
        'OCR text requires a sha256 digest binding.',
        '$.payload.captureContract.ocrTextDigest',
      ),
    );
  if (
    nonEmpty(contract?.expectedProductVersion) &&
    contract.productVersion !== contract.expectedProductVersion
  )
    issues.push(
      issue(
        'evidence_product_version_mismatch',
        'Captured product version does not match the claimed version.',
        '$.payload.captureContract.productVersion',
      ),
    );
}

function validateRuntimeDepth(payload, issues) {
  if (!payload || typeof payload !== 'object' || payload.status === 'illustrative-not-measured')
    return;
  if (!Array.isArray(payload.samples)) return;
  if (
    payload.samples.length !== payload.sampleSize ||
    payload.samples.some((value) => !finite(value))
  )
    issues.push(
      issue(
        'runtime_raw_sample_mismatch',
        'Raw samples must be finite and match sampleSize.',
        '$.payload.samples',
      ),
    );
  const expected = aggregate(payload.samples, payload.aggregation?.kind);
  if (
    !finite(expected) ||
    !finite(payload.aggregation?.value) ||
    Math.abs(expected - payload.aggregation.value) > 1e-9
  )
    issues.push(
      issue(
        'runtime_aggregation_mismatch',
        'Displayed runtime aggregation must reproduce from raw samples.',
        '$.payload.aggregation',
      ),
    );
  if (!isDigest(payload.environmentDigest))
    issues.push(
      issue(
        'runtime_environment_binding_missing',
        'Measured runtime proof requires an environment digest.',
        '$.payload.environmentDigest',
      ),
    );
}

function validateTraceDepth(payload, issues) {
  if (!payload || typeof payload !== 'object' || payload.status !== 'observed') return;
  if (!isDigest(payload.rawReceiptDigest))
    issues.push(
      issue(
        'trace_raw_receipt_missing',
        'Observed traces require a raw receipt digest.',
        '$.payload.rawReceiptDigest',
      ),
    );
  const spans = Array.isArray(payload.spans) ? payload.spans : [];
  const ids = new Set(spans.map((span) => span?.spanId));
  spans.forEach((span, index) => {
    if (
      !finite(span?.startMs) ||
      !finite(span?.endMs) ||
      span.endMs < span.startMs ||
      (nonEmpty(span?.parentSpanId) && !ids.has(span.parentSpanId))
    )
      issues.push(
        issue(
          'trace_span_timing_invalid',
          'Observed spans require ordered timing and valid parent lineage.',
          `$.payload.spans[${index}]`,
        ),
      );
  });
}

function validateRedundantEncoding(payload, issues) {
  const encoding = payload?.visualEncoding;
  if (encoding === undefined) return;
  if (
    encoding?.primary === 'color' &&
    (!Array.isArray(encoding?.redundant) || encoding.redundant.filter(nonEmpty).length === 0)
  )
    issues.push(
      issue(
        'visual_encoding_color_only',
        'Color encoding requires a redundant label, shape, pattern, position, or line style.',
        '$.payload.visualEncoding.redundant',
      ),
    );
}

function parseDimension(value) {
  const normalized = String(value).trim();
  if (normalized === '1' || normalized === '%' || normalized === 'ratio') return {};
  const result = {};
  for (const part of normalized.split('*')) {
    const [numerator, ...denominators] = part.split('/');
    addDimension(result, numerator, 1);
    for (const entry of denominators) addDimension(result, entry, -1);
  }
  return result;
}

function addDimension(target, token, sign) {
  const match = String(token)
    .trim()
    .match(/^([a-zA-Z%_-]+)(?:\^(-?\d+))?$/u);
  if (!match || ['1', '%', 'ratio'].includes(match[1])) return;
  const exponent = sign * Number(match[2] ?? 1);
  target[match[1].toLowerCase()] = (target[match[1].toLowerCase()] ?? 0) + exponent;
  if (target[match[1].toLowerCase()] === 0) delete target[match[1].toLowerCase()];
}

function combineDimensions(left, right, rightSign) {
  const result = { ...left };
  for (const [unit, exponent] of Object.entries(right)) {
    result[unit] = (result[unit] ?? 0) + rightSign * exponent;
    if (result[unit] === 0) delete result[unit];
  }
  return result;
}

function canonicalDimension(value) {
  return dimensionKey(parseDimension(value));
}

function dimensionKey(value) {
  const entries = Object.entries(value)
    .filter(([, exponent]) => exponent !== 0)
    .sort();
  if (entries.length === 0) return '1';
  return entries.map(([unit, exponent]) => `${unit}^${exponent}`).join('*');
}

function reachable(adjacency, from, to) {
  if (!adjacency.has(from) || !adjacency.has(to)) return false;
  const queue = [from];
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (current === to) return true;
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(adjacency.get(current) ?? []));
  }
  return false;
}

function point(value) {
  return value && finite(value.x) && finite(value.y);
}

function segmentsCross(a, b, c, d) {
  const orientation = (p, q, r) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
  return (
    orientation(a, b, c) !== orientation(a, b, d) && orientation(c, d, a) !== orientation(c, d, b)
  );
}

function aggregate(values, kind) {
  if (!Array.isArray(values) || values.length === 0 || values.some((value) => !finite(value)))
    return Number.NaN;
  const sorted = [...values].sort((left, right) => left - right);
  if (kind === 'mean') return values.reduce((sum, value) => sum + value, 0) / values.length;
  if (kind === 'median') {
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }
  if (kind === 'p95') return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
  return Number.NaN;
}

function rect(value) {
  return value && [value.x, value.y, value.width, value.height].every(finite);
}

function countValues(values) {
  const result = new Map();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
}

function deduplicateIssues(issues) {
  return [...new Map(issues.map((entry) => [`${entry.code}:${entry.path}`, entry])).values()];
}

function issue(code, message, path) {
  return { code, severity: 'error', message, path, repair: 'replace' };
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function isDigest(value) {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/u.test(value);
}
