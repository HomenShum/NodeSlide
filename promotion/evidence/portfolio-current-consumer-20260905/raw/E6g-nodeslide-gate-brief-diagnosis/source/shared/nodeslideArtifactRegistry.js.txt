/**
 * Canonical runtime registry for model/tool-authored NodeSlide artifacts.
 *
 * This module intentionally contains no Node-only APIs so the exact same
 * validator and registry run in Atlas scripts, Convex, and browser bundles.
 * Geometry is compiled separately into bounded, editable marks: this registry
 * declares whether the complete browser/PPTX materialization is native, a
 * semantic adapter, or an honest static/summary fallback.
 */

import { validateNodeSlideArtifactDepth } from './nodeslideSemanticIssues.js';

export const NODESLIDE_ARTIFACT_SPEC_VERSION = 'nodeslide.artifact-spec/v1';
export const NODESLIDE_LEGACY_AUTHORED_ARTIFACT_VERSION =
  'nodeslide.production-authored-artifact/v1';

export const NODESLIDE_CANONICAL_ARTIFACT_KINDS = [
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

export const NODESLIDE_CANONICAL_TRUTH_STATES = [
  'observed',
  'derived',
  'estimated',
  'illustrative',
  'missing',
  'not-run',
];

const SHA256_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;
const CREDENTIAL_URL_KEYS = new Set([
  'apikey',
  'accesskey',
  'accesskeyid',
  'accesstoken',
  'auth',
  'authorization',
  'authtoken',
  'clientsecret',
  'code',
  'credential',
  'googleaccessid',
  'idtoken',
  'jwt',
  'key',
  'keyid',
  'keypairid',
  'password',
  'passwd',
  'policy',
  'privatekey',
  'refreshtoken',
  'secret',
  'sessiontoken',
  'state',
  'sig',
  'signature',
  'signed',
  'signedurl',
  'token',
  'ticket',
  'subscriptionkey',
  'xamzcredential',
  'xamzsecuritytoken',
  'xamzsignature',
  'xgoogcredential',
  'xgoogsignature',
]);
const EMBEDDED_CREDENTIAL_ASSIGNMENT =
  /(?:^|[?&#;,])(?:api[_-]?key|access[_-]?token|auth(?:orization)?|credential|password|secret|sig(?:nature)?|token|x-amz-(?:credential|security-token|signature)|x-goog-(?:credential|signature))\s*=/iu;
const CREDENTIAL_VALUE_PREFIX =
  /^(?:bearer\s+|basic\s+|gh[opsu]_|github_pat_|sk-[A-Za-z0-9]|xox[baprs]-|AKIA[0-9A-Z]{12}|ASIA[0-9A-Z]{12})/iu;
const JWT_VALUE = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/u;
const OPAQUE_CREDENTIAL_VALUE = /^(?:[A-Za-z0-9_-]{32,}|[A-Za-z0-9+/]{32,}={0,2})$/u;
const CREDENTIAL_VALUE_MARKER =
  /^(?:api[_-]?key|access[_-]?token|auth(?:orization)?|credential|password|secret|sig(?:nature)?|token)[/:]/iu;
const MAX_CREDENTIAL_URL_DECODE_ROUNDS = 3;

export function isNodeSlideSha256Digest(value) {
  return typeof value === 'string' && SHA256_DIGEST_PATTERN.test(value);
}

/**
 * Canonical evidence media may only reuse an exact URL that the user supplied
 * in the source inventory. This syntax guard also keeps local/private targets
 * and credential-bearing URLs out of browser and PPTX renderers.
 */
export function isSafeNodeSlideArtifactSourceUrl(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 900 ||
    Array.from(value).some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 31 || code === 127 || /\s/u.test(character);
    })
  ) {
    return false;
  }
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.hostname.length === 0 ||
      parsed.hostname.length > 253
    ) {
      return false;
    }
    if (hasMalformedPercentEncoding(parsed.search) || hasMalformedPercentEncoding(parsed.hash)) {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal') ||
      isDisallowedIpv6Hostname(hostname)
    ) {
      return false;
    }
    const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/u);
    if (ipv4) {
      const octets = ipv4.slice(1).map(Number);
      if (octets.some((octet) => octet > 255)) return false;
      if (isDisallowedIpv4Address(octets)) return false;
    }
    const queryAndFragment = [
      ...parsed.searchParams.entries(),
      ...credentialFragmentEntries(parsed.hash),
    ];
    if (
      queryAndFragment.some(([key, credentialValue]) => {
        const decodedKey = decodeCredentialUrlComponent(key);
        const decodedValue = decodeCredentialUrlComponent(credentialValue);
        return (
          decodedKey === null ||
          decodedValue === null ||
          isCredentialUrlKey(decodedKey) ||
          isCredentialUrlValue(decodedValue)
        );
      })
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function isDisallowedIpv4Address(octets) {
  const [first = 0, second = 0] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    first >= 224
  );
}

function isDisallowedIpv6Hostname(hostname) {
  if (!hostname.includes(':')) return false;

  // Leading-zero IPv6 space contains unspecified, loopback, IPv4-compatible,
  // and IPv4-mapped literals. Reject the entire ambiguous space rather than
  // allowing alternate spellings to bypass the IPv4 private-range checks.
  if (hostname.startsWith('::')) return true;

  const firstHextetText = hostname.split(':', 1)[0];
  if (!/^[0-9a-f]{1,4}$/u.test(firstHextetText)) return true;
  const firstHextet = Number.parseInt(firstHextetText, 16);

  return (
    // Unique-local fc00::/7.
    (firstHextet & 0xfe00) === 0xfc00 ||
    // Link-local fe80::/10.
    (firstHextet & 0xffc0) === 0xfe80 ||
    // Deprecated site-local fec0::/10.
    (firstHextet & 0xffc0) === 0xfec0 ||
    // Multicast ff00::/8.
    (firstHextet & 0xff00) === 0xff00
  );
}

function decodeCredentialUrlComponent(value) {
  let decoded = value;
  for (let round = 0; round < MAX_CREDENTIAL_URL_DECODE_ROUNDS; round += 1) {
    if (!decoded.includes('%')) return decoded;
    if (hasMalformedPercentEncoding(decoded)) return null;
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) return decoded;
      decoded = next;
    } catch {
      return null;
    }
  }
  return decoded.includes('%') ? null : decoded;
}

function hasMalformedPercentEncoding(value) {
  for (let index = value.indexOf('%'); index >= 0; index = value.indexOf('%', index + 1)) {
    if (!/^[0-9a-f]{2}$/iu.test(value.slice(index + 1, index + 3))) return true;
  }
  return false;
}

function credentialFragmentEntries(hash) {
  if (!hash || hash === '#') return [];
  const fragment = hash.slice(1).replace(/^\?/u, '');
  if (!fragment.includes('=') && !fragment.includes('&')) {
    return [['fragment', fragment]];
  }
  return [...new URLSearchParams(fragment).entries()];
}

function isCredentialUrlKey(value) {
  const normalized = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, '');
  return (
    CREDENTIAL_URL_KEYS.has(normalized) ||
    normalized.endsWith('token') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('signature') ||
    normalized.endsWith('credential')
  );
}

function isCredentialUrlValue(value) {
  const decoded = value.normalize('NFKC').trim();
  return (
    CREDENTIAL_VALUE_PREFIX.test(decoded) ||
    JWT_VALUE.test(decoded) ||
    OPAQUE_CREDENTIAL_VALUE.test(decoded) ||
    CREDENTIAL_VALUE_MARKER.test(decoded) ||
    EMBEDDED_CREDENTIAL_ASSIGNMENT.test(decoded)
  );
}

export const NODESLIDE_ARTIFACT_COMPILER_REGISTRY = Object.freeze({
  generic: compiler('statement', 'summary-fallback', 'grouped-editable', [
    'Generic semantic content is compiled as a labeled statement, not invented geometry.',
  ]),
  chart: compiler('chart', 'native', 'native', []),
  waterfall: compiler('chart', 'native', 'grouped-editable', []),
  sankey: compiler('diagram', 'native', 'grouped-editable', []),
  graph: compiler('diagram', 'native', 'grouped-editable', []),
  'causal-loop': compiler('diagram', 'semantic-adapter', 'grouped-editable', [
    'Loop membership and polarity are preserved as labels; curved loop routing is not claimed.',
  ]),
  timeline: compiler('diagram', 'semantic-adapter', 'grouped-editable', [
    'Ordered events remain editable; proportional temporal spacing is not claimed.',
  ]),
  gantt: compiler('diagram', 'native', 'grouped-editable', []),
  'evidence-media': compiler('image', 'summary-fallback', 'static-fallback', [
    'Digest-bound evidence without a resolvable media URL renders as an explicit placeholder.',
  ]),
  motion: compiler('diagram', 'static-fallback', 'static-fallback', [
    'Browser/PPTX use the declared static keyframe; animation is not claimed.',
  ]),
  comparison: compiler('chart', 'semantic-adapter', 'grouped-editable', [
    'The first compatible metric is charted; the complete cohort table remains in the spec.',
  ]),
  equation: compiler('formula', 'native', 'static-fallback', [
    'The equation is semantic in browser output and may use the declared PowerPoint fallback.',
  ]),
  'runtime-proof': compiler('metric', 'summary-fallback', 'grouped-editable', [
    'Runtime receipts compile to an explicit summary; no unprovided samples are plotted.',
  ]),
  trace: compiler('diagram', 'native', 'grouped-editable', []),
  'risk-matrix': compiler('diagram', 'native', 'grouped-editable', []),
  'spatial-scene': compiler('diagram', 'native', 'grouped-editable', []),
});

function compiler(primitive, mode, editability, knownFidelityDifferences) {
  return Object.freeze({
    primitive,
    mode,
    browserContract: mode === 'static-fallback' ? 'declared-static-fallback' : 'semantic',
    pptxContract: editability === 'static-fallback' ? 'declared-static-fallback' : 'editable',
    editability,
    knownFidelityDifferences: Object.freeze(knownFidelityDifferences),
  });
}

export function validateNodeSlideCanonicalArtifactSpec(value, options = {}) {
  const issues = [];
  if (!isRecord(value)) {
    return result(value, [issue('artifact_shape', 'ArtifactSpec must be an object.', '$')]);
  }
  if (value.schemaVersion !== NODESLIDE_ARTIFACT_SPEC_VERSION) {
    issues.push(
      issue(
        'artifact_schema_version',
        `Unsupported artifact schema version ${String(value.schemaVersion)}.`,
        '$.schemaVersion',
      ),
    );
  }
  if (!NODESLIDE_CANONICAL_ARTIFACT_KINDS.includes(value.kind)) {
    issues.push(
      issue('artifact_kind', `Unsupported artifact kind ${String(value.kind)}.`, '$.kind'),
    );
  }
  requiredString(value.id, 'artifact_identity', '$.id', issues, 120);
  requiredString(value.narrativeJob, 'artifact_identity', '$.narrativeJob', issues, 240);
  if (!Array.isArray(value.claimIds) || value.claimIds.some((claimId) => !requiredText(claimId)))
    issues.push(
      issue(
        'artifact_claim_binding',
        'claimIds must be an array of non-empty identifiers.',
        '$.claimIds',
      ),
    );
  if (!Array.isArray(value.sourceIds))
    issues.push(
      issue(
        'artifact_source_binding',
        'sourceIds must be present and exactly mirror provenance.sourceRefs.',
        '$.sourceIds',
      ),
    );

  const provenance = normalizeProvenance(value, issues, options);
  const sourceRefs = provenance?.sourceRefs ?? [];
  if (options.allowedSourceRefs) {
    const allowed = new Set(options.allowedSourceRefs);
    sourceRefs.forEach((sourceRef, index) => {
      if (!allowed.has(sourceRef)) {
        issues.push(
          issue(
            'artifact_source_binding',
            `Unknown source reference ${sourceRef}.`,
            `$.provenance.sourceRefs[${index}]`,
            'replace',
          ),
        );
      }
    });
  }
  if (!isRecord(value.payload)) {
    issues.push(issue('artifact_payload', 'Typed artifact payload is required.', '$.payload'));
  } else if (NODESLIDE_CANONICAL_ARTIFACT_KINDS.includes(value.kind)) {
    validatePayload(value.kind, value.payload, issues);
    validateCrossBindings(value, provenance, options, issues);
    issues.push(
      ...validateNodeSlideArtifactDepth(
        value,
        options.now === undefined ? {} : { now: options.now },
      ).map((entry) => issue(entry.code, entry.message, entry.path)),
    );
  }
  return result(value, issues, provenance);
}

export function normalizeNodeSlideCanonicalArtifactSpec(value, options = {}) {
  const migrated = migrateLegacy(value);
  const validation = validateNodeSlideCanonicalArtifactSpec(migrated, options);
  if (!validation.ok) return { ...validation, spec: null };
  const spec = {
    ...migrated,
    schemaVersion: NODESLIDE_ARTIFACT_SPEC_VERSION,
    id: migrated.id.trim(),
    narrativeJob: migrated.narrativeJob.trim(),
    claimIds: uniqueStrings(migrated.claimIds ?? []),
    sourceIds: validation.sourceRefs,
    provenance: {
      truthState: validation.provenance.truthState,
      rationale: validation.provenance.rationale,
      sourceRefs: validation.sourceRefs,
      // Retain Atlas v1 compatibility while making the canonical fields
      // explicit for production and external tool consumers.
      status: validation.provenance.truthState,
      ...(validation.provenance.sourceDigest
        ? { sourceDigest: validation.provenance.sourceDigest }
        : {}),
      assumptions: validation.provenance.assumptions,
    },
    payload: canonicalize(migrated.payload),
  };
  const { specDigest: _suppliedDigest, ...specWithoutDigest } = spec;
  return { ...validation, spec: canonicalize(specWithoutDigest) };
}

export function canonicalArtifactSchemaForKinds(kinds = NODESLIDE_CANONICAL_ARTIFACT_KINDS) {
  const selected = [...new Set(kinds)].filter((kind) =>
    NODESLIDE_CANONICAL_ARTIFACT_KINDS.includes(kind),
  );
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://nodeslide.vercel.app/schemas/nodeslide.artifact-spec.v1.json',
    title: 'NodeSlide ArtifactSpec v1',
    oneOf: selected.map((kind) => ({
      type: 'object',
      additionalProperties: true,
      required: [
        'schemaVersion',
        'id',
        'kind',
        'narrativeJob',
        'claimIds',
        'sourceIds',
        'provenance',
        'payload',
      ],
      properties: {
        schemaVersion: { const: NODESLIDE_ARTIFACT_SPEC_VERSION },
        id: { type: 'string', minLength: 1, maxLength: 120 },
        kind: { const: kind },
        narrativeJob: { type: 'string', minLength: 1, maxLength: 240 },
        claimIds: { type: 'array', items: { type: 'string' } },
        sourceIds: { type: 'array', items: { type: 'string' } },
        provenance: provenanceSchema(),
        payload: payloadSchemas[kind],
      },
    })),
  };
}

function provenanceSchema() {
  return {
    type: 'object',
    additionalProperties: true,
    required: ['truthState', 'rationale', 'sourceRefs'],
    properties: {
      truthState: { enum: NODESLIDE_CANONICAL_TRUTH_STATES },
      rationale: { type: 'string', minLength: 1, maxLength: 320 },
      sourceRefs: {
        type: 'array',
        maxItems: 8,
        items: { type: 'string', minLength: 1, maxLength: 160 },
      },
      sourceDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
    },
  };
}

const string = { type: 'string', minLength: 1 };
const number = { type: 'number' };
const nodeSchema = {
  type: 'object',
  required: ['id'],
  properties: { id: string, label: { type: 'string' }, layer: { type: 'string' } },
};
const intervalSchema = {
  type: 'object',
  required: ['id', 'start', 'end'],
  properties: { id: string, label: { type: 'string' }, start: number, end: number },
};

const payloadSchemas = {
  generic: { type: 'object' },
  chart: {
    type: 'object',
    required: ['unit', 'xAxis', 'yAxis', 'series'],
    properties: {
      unit: string,
      xAxis: {
        type: 'object',
        required: ['labels'],
        properties: { labels: { type: 'array', minItems: 1, items: string } },
      },
      yAxis: {
        type: 'object',
        required: ['min', 'max'],
        properties: { min: number, max: number },
      },
      series: { type: 'array', minItems: 1, items: { type: 'object' } },
    },
  },
  waterfall: {
    type: 'object',
    required: ['unit', 'baseline', 'deltas', 'final'],
    properties: {
      unit: string,
      baseline: number,
      final: number,
      deltas: { type: 'array', minItems: 1, items: { type: 'object' } },
    },
  },
  sankey: {
    type: 'object',
    required: ['unit', 'nodes', 'links'],
    properties: {
      unit: string,
      nodes: { type: 'array', minItems: 2, items: nodeSchema },
      links: { type: 'array', minItems: 1, items: { type: 'object' } },
    },
  },
  graph: graphSchema(),
  'causal-loop': {
    ...graphSchema(),
    required: ['nodes', 'edges', 'loops'],
    properties: {
      ...graphSchema().properties,
      loops: { type: 'array', minItems: 1, items: { type: 'object' } },
    },
  },
  timeline: {
    type: 'object',
    required: ['unit', 'events'],
    properties: {
      unit: string,
      events: { type: 'array', minItems: 1, items: intervalSchema },
    },
  },
  gantt: {
    type: 'object',
    required: ['unit', 'tasks'],
    properties: {
      unit: string,
      tasks: { type: 'array', minItems: 1, items: intervalSchema },
    },
  },
  'evidence-media': {
    type: 'object',
    required: ['mimeType', 'digest', 'claimId'],
    properties: {
      mimeType: string,
      digest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
      claimId: string,
      sourceUrl: { type: 'string', pattern: '^https://', maxLength: 900 },
    },
  },
  motion: {
    type: 'object',
    required: ['states', 'staticFallbackStateId'],
    properties: {
      states: { type: 'array', minItems: 2, items: { type: 'object' } },
      staticFallbackStateId: string,
    },
  },
  comparison: {
    type: 'object',
    required: ['metrics', 'cohorts'],
    properties: {
      metrics: { type: 'array', minItems: 1, items: { type: 'object' } },
      cohorts: { type: 'array', minItems: 2, items: { type: 'object' } },
    },
  },
  equation: {
    type: 'object',
    required: ['expression', 'values', 'result'],
    properties: { expression: { type: 'object' }, values: { type: 'object' }, result: number },
  },
  'runtime-proof': {
    type: 'object',
    required: ['sampleSize', 'unit', 'status'],
    properties: {
      sampleSize: { type: 'integer' },
      unit: string,
      status: string,
      receiptDigest: { type: 'string', pattern: '^sha256:[0-9a-f]{64}$' },
    },
  },
  trace: {
    type: 'object',
    required: ['traceId', 'spans', 'status'],
    properties: {
      traceId: string,
      spans: { type: 'array', items: { type: 'object' } },
      status: string,
    },
  },
  'risk-matrix': {
    type: 'object',
    required: ['likelihoodAxis', 'impactAxis', 'risks'],
    properties: {
      likelihoodAxis: { type: 'object' },
      impactAxis: { type: 'object' },
      risks: { type: 'array' },
    },
  },
  'spatial-scene': {
    type: 'object',
    required: ['viewports'],
    properties: { viewports: { type: 'array', minItems: 1, items: { type: 'object' } } },
  },
};

function graphSchema() {
  return {
    type: 'object',
    required: ['nodes', 'edges'],
    properties: {
      nodes: { type: 'array', minItems: 2, items: nodeSchema },
      edges: { type: 'array', minItems: 1, items: { type: 'object' } },
    },
  };
}

function validatePayload(kind, payload, issues) {
  if (kind === 'generic') {
    if (Object.keys(payload).length === 0)
      issues.push(issue('artifact_generic_shape', 'Generic payload cannot be empty.', '$.payload'));
    return;
  }
  if (kind === 'chart') return validateChart(payload, issues);
  if (kind === 'waterfall') return validateWaterfall(payload, issues);
  if (kind === 'sankey') return validateSankey(payload, issues);
  if (kind === 'graph') return validateGraph(payload, issues, false);
  if (kind === 'causal-loop') return validateCausalLoop(payload, issues);
  if (kind === 'timeline' || kind === 'gantt') return validateTimeline(payload, issues, kind);
  if (kind === 'evidence-media') return validateEvidence(payload, issues);
  if (kind === 'motion') return validateMotion(payload, issues);
  if (kind === 'comparison') return validateComparison(payload, issues);
  if (kind === 'equation') return validateEquation(payload, issues);
  if (kind === 'runtime-proof') return validateRuntime(payload, issues);
  if (kind === 'trace') return validateTrace(payload, issues);
  if (kind === 'risk-matrix') return validateRisk(payload, issues);
  if (kind === 'spatial-scene') return validateSpatial(payload, issues);
}

function validateChart(payload, issues) {
  requiredString(payload.unit, 'chart_unit_missing', '$.payload.unit', issues, 32);
  const labels = payload.xAxis?.labels;
  if (!stringArray(labels, 1))
    issues.push(
      issue('chart_axis_labels_missing', 'X-axis labels are required.', '$.payload.xAxis.labels'),
    );
  if (
    !finite(payload.yAxis?.min) ||
    !finite(payload.yAxis?.max) ||
    payload.yAxis.max <= payload.yAxis.min
  )
    issues.push(
      issue('chart_scale_invalid', 'A finite increasing Y scale is required.', '$.payload.yAxis'),
    );
  if (!Array.isArray(payload.series) || payload.series.length === 0) {
    issues.push(
      issue('chart_series_missing', 'At least one series is required.', '$.payload.series'),
    );
    return;
  }
  payload.series.forEach((series, index) => {
    if (
      !isRecord(series) ||
      !stringArray(labels, 1) ||
      !Array.isArray(series.values) ||
      series.values.length !== labels.length ||
      series.values.some((value) => value !== null && !finite(value))
    )
      issues.push(
        issue(
          'chart_series_alignment',
          'Series values must be finite and align with labels.',
          `$.payload.series[${index}].values`,
        ),
      );
  });
}

function validateWaterfall(payload, issues) {
  requiredString(payload.unit, 'chart_unit_missing', '$.payload.unit', issues, 32);
  const deltas = Array.isArray(payload.deltas) ? payload.deltas : [];
  const baseline = Number(payload.baseline);
  const final = Number(payload.final);
  if (
    deltas.length === 0 ||
    deltas.some((entry) => !isRecord(entry) || !requiredText(entry.label) || !finite(entry.value))
  )
    issues.push(
      issue(
        'waterfall_delta_shape',
        'Waterfall deltas require labels and finite values.',
        '$.payload.deltas',
      ),
    );
  const calculated =
    baseline + deltas.reduce((sum, entry) => sum + (finite(entry?.value) ? entry.value : 0), 0);
  if (
    ![baseline, final, calculated].every(finite) ||
    Math.abs(calculated - final) > (finite(payload.tolerance) ? payload.tolerance : 0.001)
  )
    issues.push(
      issue(
        'waterfall_reconciliation',
        'Baseline plus deltas must equal final.',
        '$.payload.final',
        'replace',
      ),
    );
  const labels = deltas.map((entry) => entry?.label).filter(requiredText);
  if (new Set(labels).size !== labels.length)
    issues.push(
      issue('waterfall_label_binding', 'Every delta needs a unique label.', '$.payload.deltas'),
    );
}

function validateSankey(payload, issues) {
  requiredString(payload.unit, 'chart_unit_missing', '$.payload.unit', issues, 32);
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const links = Array.isArray(payload.links) ? payload.links : [];
  const ids = new Set(
    nodes.flatMap((node) => (isRecord(node) && requiredText(node.id) ? [node.id] : [])),
  );
  if (ids.size !== nodes.length || ids.size < 2)
    issues.push(
      issue('sankey_node_invalid', 'Sankey nodes require unique IDs.', '$.payload.nodes'),
    );
  const balance = new Map([...ids].map((id) => [id, { in: 0, out: 0 }]));
  links.forEach((link, index) => {
    if (
      !isRecord(link) ||
      !ids.has(link.source) ||
      !ids.has(link.target) ||
      !finite(link.value) ||
      link.value < 0
    ) {
      issues.push(
        issue(
          'sankey_link_invalid',
          'Every Sankey link needs valid nodes and a non-negative value.',
          `$.payload.links[${index}]`,
        ),
      );
      return;
    }
    balance.get(link.source).out += link.value;
    balance.get(link.target).in += link.value;
  });
  nodes.forEach((node, index) => {
    if (!isRecord(node) || !ids.has(node.id)) return;
    const value = balance.get(node.id);
    if (
      node.layer !== 'source' &&
      node.layer !== 'sink' &&
      Math.abs(value.in - value.out) > (finite(payload.tolerance) ? payload.tolerance : 0.001)
    )
      issues.push(
        issue(
          'sankey_conservation',
          `Flow is not conserved at ${node.id}.`,
          `$.payload.nodes[${index}]`,
        ),
      );
  });
}

function validateGraph(payload, issues, causal) {
  const nodes = Array.isArray(payload.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  const ids = new Set(
    nodes.flatMap((node) => (isRecord(node) && requiredText(node.id) ? [node.id] : [])),
  );
  if (ids.size !== nodes.length || ids.size < 2)
    issues.push(
      issue('graph_node_shape', 'Graph nodes require at least two unique IDs.', '$.payload.nodes'),
    );
  if (edges.length === 0)
    issues.push(
      issue('graph_edge_missing', 'Graph requires at least one edge.', '$.payload.edges'),
    );
  edges.forEach((edge, index) => {
    if (!isRecord(edge) || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to)
      issues.push(
        issue(
          'graph_edge_reference',
          'Graph edge references an unknown or identical node.',
          `$.payload.edges[${index}]`,
        ),
      );
    if ((payload.directed === true || causal) && edge?.directed !== true)
      issues.push(
        issue(
          'graph_direction_missing',
          'Directed graphs require directed edges.',
          `$.payload.edges[${index}].directed`,
        ),
      );
  });
}

function validateCausalLoop(payload, issues) {
  validateGraph(payload, issues, true);
  const edges = Array.isArray(payload.edges) ? payload.edges : [];
  const edgeIds = new Set(
    edges.flatMap((edge) => (isRecord(edge) && requiredText(edge.id) ? [edge.id] : [])),
  );
  edges.forEach((edge, index) => {
    if (!isRecord(edge) || !['+', '-'].includes(edge.polarity))
      issues.push(
        issue(
          'causal_polarity_invalid',
          'Causal edges require + or - polarity.',
          `$.payload.edges[${index}].polarity`,
        ),
      );
  });
  if (!Array.isArray(payload.loops) || payload.loops.length === 0) {
    issues.push(
      issue('causal_loop_invalid', 'At least one explicit loop is required.', '$.payload.loops'),
    );
    return;
  }
  payload.loops.forEach((loop, index) => {
    if (
      !isRecord(loop) ||
      !['reinforcing', 'balancing'].includes(loop.type) ||
      !Array.isArray(loop.edgeIds) ||
      !loop.edgeIds.every((id) => edgeIds.has(id))
    )
      issues.push(
        issue(
          'causal_loop_invalid',
          'Loops require a type and valid edge membership.',
          `$.payload.loops[${index}]`,
        ),
      );
  });
}

function validateTimeline(payload, issues, kind) {
  const field = kind === 'gantt' ? 'tasks' : 'events';
  const items = Array.isArray(payload[field]) ? payload[field] : [];
  if (items.length === 0)
    issues.push(
      issue(
        'timeline_items_missing',
        `${kind} requires at least one interval.`,
        `$.payload.${field}`,
      ),
    );
  const ids = new Set(
    items.flatMap((item) => (isRecord(item) && requiredText(item.id) ? [item.id] : [])),
  );
  const byId = new Map(
    items.flatMap((item) => (isRecord(item) && requiredText(item.id) ? [[item.id, item]] : [])),
  );
  items.forEach((item, index) => {
    if (!isRecord(item) || !finite(item.start) || !finite(item.end) || item.end < item.start)
      issues.push(
        issue(
          'timeline_interval_invalid',
          'Timeline intervals must be ordered.',
          `$.payload.${field}[${index}]`,
        ),
      );
    if (
      kind === 'gantt' &&
      (!finite(item?.confidence) || item.confidence < 0 || item.confidence > 1)
    )
      issues.push(
        issue(
          'gantt_confidence_missing',
          'Gantt confidence must be between 0 and 1.',
          `$.payload.tasks[${index}].confidence`,
        ),
      );
    if (kind === 'gantt' && Array.isArray(item?.dependsOn)) {
      item.dependsOn.forEach((dependencyId, dependencyIndex) => {
        const dependency = byId.get(dependencyId);
        if (!ids.has(dependencyId))
          issues.push(
            issue(
              'gantt_dependency_invalid',
              'Gantt dependency references an unknown task.',
              `$.payload.tasks[${index}].dependsOn[${dependencyIndex}]`,
            ),
          );
        else if (finite(item.start) && finite(dependency?.end) && item.start < dependency.end)
          issues.push(
            issue(
              'gantt_dependency_precedence',
              'A dependent task cannot begin before its dependency ends.',
              `$.payload.tasks[${index}].start`,
              'replace',
            ),
          );
      });
    }
  });
}

function validateEvidence(payload, issues) {
  if (!['application/pdf', 'image/png', 'image/jpeg', 'text/html'].includes(payload.mimeType))
    issues.push(
      issue('evidence_mime_mismatch', 'Evidence MIME type is unsupported.', '$.payload.mimeType'),
    );
  if (!isNodeSlideSha256Digest(payload.digest) || !requiredText(payload.claimId))
    issues.push(
      issue(
        'evidence_binding_missing',
        'Evidence requires a lowercase sha256:<64 hex> digest and claim binding.',
        '$.payload',
      ),
    );
  if (
    payload.mimeType === 'application/pdf' &&
    (!finite(payload.page) || !isRecord(payload.region))
  )
    issues.push(
      issue('pdf_region_missing', 'PDF evidence requires a page and region.', '$.payload.region'),
    );
}

function validateMotion(payload, issues) {
  const states = Array.isArray(payload.states) ? payload.states : [];
  const stateIds = new Set(
    states.flatMap((state) => (isRecord(state) && requiredText(state.id) ? [state.id] : [])),
  );
  if (states.length < 2 || stateIds.size !== states.length)
    issues.push(
      issue(
        'motion_states_missing',
        'Motion artifacts require two uniquely identified states.',
        '$.payload.states',
      ),
    );
  if (!requiredText(payload.staticFallbackStateId) || !stateIds.has(payload.staticFallbackStateId))
    issues.push(
      issue(
        'motion_fallback_missing',
        'Static fallback must reference a declared state.',
        '$.payload.staticFallbackStateId',
        'replace',
      ),
    );
}

function validateComparison(payload, issues) {
  const metrics = Array.isArray(payload.metrics) ? payload.metrics : [];
  const cohorts = Array.isArray(payload.cohorts) ? payload.cohorts : [];
  if (metrics.length === 0 || cohorts.length < 2)
    issues.push(
      issue(
        'comparison_shape',
        'Comparison requires a metric and at least two cohorts.',
        '$.payload',
      ),
    );
  cohorts.forEach((cohort, cohortIndex) => {
    if (!isRecord(cohort)) return;
    metrics.forEach((metric, metricIndex) => {
      if (!isRecord(metric) || !requiredText(metric.id)) return;
      if (cohort.status === 'observed' && !finite(cohort.values?.[metric.id]))
        issues.push(
          issue(
            'comparison_observed_value_missing',
            `${String(cohort.id)} lacks observed ${metric.id}.`,
            `$.payload.cohorts[${cohortIndex}].values.${metric.id}`,
            'replace',
          ),
        );
    });
    if (cohort.status !== 'observed' && cohort.plotted === true)
      issues.push(
        issue(
          'comparison_unobserved_plotted',
          'Unobserved cohorts cannot be plotted as measured.',
          `$.payload.cohorts[${cohortIndex}].plotted`,
          'remove',
        ),
      );
  });
}

function validateEquation(payload, issues) {
  if (!isRecord(payload.expression) || !isRecord(payload.values) || !finite(payload.result)) {
    issues.push(
      issue(
        'equation_shape',
        'Equation requires an expression AST, values, and finite result.',
        '$.payload',
      ),
    );
    return;
  }
  const evaluated = evaluateNodeSlideArtifactExpression(payload.expression, payload.values);
  if (
    !finite(evaluated) ||
    Math.abs(evaluated - payload.result) > (finite(payload.tolerance) ? payload.tolerance : 0.0001)
  )
    issues.push(
      issue(
        'equation_evaluation_mismatch',
        'Displayed result does not match the expression AST.',
        '$.payload.result',
        'replace',
      ),
    );
}

function validateRuntime(payload, issues) {
  if (payload.status === 'illustrative-not-measured') return;
  if (
    !Number.isInteger(payload.sampleSize) ||
    payload.sampleSize < 2 ||
    !isNodeSlideSha256Digest(payload.receiptDigest)
  )
    issues.push(
      issue(
        'runtime_receipt_unbound',
        'Runtime statistics require repeated samples and a lowercase sha256:<64 hex> receipt digest.',
        '$.payload.receiptDigest',
      ),
    );
}

function validateCrossBindings(value, provenance, options, issues) {
  if (!provenance || !isRecord(value.payload)) return;
  const claimIds = uniqueStrings(value.claimIds);
  const sourceRefs = provenance.sourceRefs;
  if (value.kind === 'evidence-media') {
    if (!claimIds.includes(value.payload.claimId)) {
      issues.push(
        issue(
          'evidence_claim_unbound',
          'Evidence payload.claimId must reference one of the artifact claimIds.',
          '$.payload.claimId',
          'replace',
        ),
      );
    }
    if (value.payload.sourceUrl !== undefined) {
      const sourceUrl = value.payload.sourceUrl;
      if (!isSafeNodeSlideArtifactSourceUrl(sourceUrl)) {
        issues.push(
          issue(
            'evidence_source_url_unsafe',
            'Evidence sourceUrl must be a bounded public HTTPS URL without credentials.',
            '$.payload.sourceUrl',
            'remove',
          ),
        );
      }
      const urlBindings = options.allowedSourceUrlsBySourceRef;
      if (
        typeof sourceUrl !== 'string' ||
        !sourceRefs.some((sourceRef) => urlBindings?.[sourceRef] === sourceUrl)
      ) {
        issues.push(
          issue(
            'evidence_source_url_unbound',
            'Evidence sourceUrl must exactly match an authorized URL for one of its sourceRefs.',
            '$.payload.sourceUrl',
            'replace',
          ),
        );
      }
    }
  }
  if (value.kind === 'runtime-proof' && value.payload.status !== 'illustrative-not-measured') {
    const receiptDigest = value.payload.receiptDigest;
    const receiptBindings = options.allowedReceiptDigestsBySourceRef;
    if (
      !isNodeSlideSha256Digest(receiptDigest) ||
      !sourceRefs.some((sourceRef) => (receiptBindings?.[sourceRef] ?? []).includes(receiptDigest))
    ) {
      issues.push(
        issue(
          'runtime_receipt_lineage',
          'Measured runtime proof must cite a sourceRef carrying the exact receipt digest.',
          '$.payload.receiptDigest',
          'replace',
        ),
      );
    }
  }
  if (value.kind === 'spatial-scene' && Array.isArray(value.payload.viewports)) {
    value.payload.viewports.forEach((viewport, viewportIndex) => {
      if (!isRecord(viewport) || !Array.isArray(viewport.sourceIds)) return;
      viewport.sourceIds.forEach((sourceId, sourceIndex) => {
        if (!sourceRefs.includes(sourceId)) {
          issues.push(
            issue(
              'spatial_source_unbound',
              'Viewport sourceIds must be present in the artifact source bindings.',
              `$.payload.viewports[${viewportIndex}].sourceIds[${sourceIndex}]`,
              'replace',
            ),
          );
        }
      });
    });
  }
}

function validateTrace(payload, issues) {
  if (
    !requiredText(payload.traceId) ||
    !Array.isArray(payload.spans) ||
    !payload.spans.every((span) => isRecord(span) && requiredText(span.spanId))
  )
    issues.push(
      issue('trace_identity_missing', 'Trace and span IDs are required.', '$.payload.spans'),
    );
}

function validateRisk(payload, issues) {
  if (
    !requiredText(payload.likelihoodAxis?.low) ||
    !requiredText(payload.likelihoodAxis?.high) ||
    !requiredText(payload.impactAxis?.low) ||
    !requiredText(payload.impactAxis?.high)
  )
    issues.push(
      issue('risk_axis_labels_missing', 'Risk axes require low/high anchors.', '$.payload'),
    );
  if (
    !Array.isArray(payload.risks) ||
    payload.risks.length === 0 ||
    payload.risks.some(
      (risk) =>
        !isRecord(risk) ||
        !requiredText(risk.id) ||
        !finite(risk.likelihood) ||
        !finite(risk.impact),
    )
  )
    issues.push(
      issue(
        'risk_item_shape',
        'Risks require identity and finite likelihood/impact.',
        '$.payload.risks',
      ),
    );
}

function validateSpatial(payload, issues) {
  if (
    !Array.isArray(payload.viewports) ||
    !payload.viewports.some(
      (viewport) =>
        isRecord(viewport) &&
        requiredText(viewport.selectedNodeId) &&
        stringArray(viewport.sourceIds, 1),
    )
  )
    issues.push(
      issue(
        'spatial_state_unproven',
        'A spatial scene needs a selected, source-bound viewport state.',
        '$.payload.viewports',
      ),
    );
}

export function evaluateNodeSlideArtifactExpression(expression, values) {
  if (!isRecord(expression)) return Number.NaN;
  if (expression.op === 'value') return Number(values?.[expression.name]);
  const args = Array.isArray(expression.args)
    ? expression.args.map((argument) => evaluateNodeSlideArtifactExpression(argument, values))
    : [];
  if (args.some((value) => !finite(value))) return Number.NaN;
  if (expression.op === 'add') return args.reduce((sum, value) => sum + value, 0);
  if (expression.op === 'multiply') return args.reduce((product, value) => product * value, 1);
  if (expression.op === 'subtract' && args.length === 2) return args[0] - args[1];
  if (expression.op === 'divide' && args.length === 2 && args[1] !== 0) return args[0] / args[1];
  return Number.NaN;
}

function migrateLegacy(value) {
  if (!isRecord(value) || value.schemaVersion !== NODESLIDE_LEGACY_AUTHORED_ARTIFACT_VERSION)
    return value;
  const sourceRefs = Array.isArray(value.provenance?.sourceRefs) ? value.provenance.sourceRefs : [];
  const legacyBase = {
    ...value,
    schemaVersion: NODESLIDE_ARTIFACT_SPEC_VERSION,
    claimIds: Array.isArray(value.claimIds) ? value.claimIds : [],
    sourceIds: sourceRefs,
  };
  if (value.kind === 'chart' && isRecord(value.payload) && Array.isArray(value.payload.labels)) {
    const values = Array.isArray(value.payload.values) ? value.payload.values : [];
    const finiteValues = values.filter(finite);
    const min = finiteValues.length > 0 ? Math.min(0, ...finiteValues) : 0;
    const max = finiteValues.length > 0 ? Math.max(1, ...finiteValues) : 1;
    return {
      ...legacyBase,
      payload: {
        unit: requiredText(value.payload.unit) ? value.payload.unit : 'unspecified',
        xAxis: { labels: value.payload.labels },
        yAxis: { min, max: max === min ? min + 1 : max },
        series: [{ id: 'series-1', values }],
      },
    };
  }
  if (value.kind === 'graph' && isRecord(value.payload)) {
    return {
      ...legacyBase,
      payload: {
        directed: true,
        graphKind: value.payload.graphKind,
        direction: value.payload.direction,
        nodes: value.payload.nodes,
        edges: Array.isArray(value.payload.edges)
          ? value.payload.edges.map((edge, index) =>
              isRecord(edge)
                ? { id: edge.id ?? `edge-${index + 1}`, directed: true, ...edge }
                : edge,
            )
          : value.payload.edges,
      },
    };
  }
  if (value.kind === 'equation' && isRecord(value.payload)) {
    const values = Object.fromEntries(
      (Array.isArray(value.payload.variables) ? value.payload.variables : []).flatMap((variable) =>
        isRecord(variable) && requiredText(variable.label) && finite(variable.value)
          ? [[variable.label, variable.value]]
          : [],
      ),
    );
    return {
      ...legacyBase,
      payload: {
        expression: parseLegacyExpression(value.payload.expression, values),
        values,
        result: evaluateLegacyExpression(value.payload.expression, values),
        tolerance: 0.0001,
        renderedExpression: value.payload.display,
        syntax: value.payload.syntax,
        legacyExpression: value.payload.expression,
        variables: value.payload.variables,
      },
    };
  }
  if (value.kind === 'metric' && isRecord(value.payload)) {
    return {
      ...legacyBase,
      kind: 'generic',
      payload: {
        label: value.payload.label,
        displayValue: value.payload.displayValue,
        legacyKind: 'metric',
      },
    };
  }
  return legacyBase;
}

function parseLegacyExpression(expression, values) {
  const source = String(expression ?? '')
    .split('=')
    .at(-1)
    ?.trim()
    .replace(/×/gu, '*')
    .replace(/÷/gu, '/');
  if (!source) return { op: 'value', name: '__legacy_unparsed__', source: expression };
  const tokens = source.match(/[A-Za-z_][A-Za-z0-9_]*|(?:\d+(?:\.\d+)?|\.\d+)|[()+\-*/]/gu);
  if (!tokens || tokens.join('') !== source.replace(/\s+/gu, ''))
    return { op: 'value', name: '__legacy_unparsed__', source: expression };
  let position = 0;
  let literalIndex = 0;
  const primary = () => {
    const token = tokens[position];
    if (token === '(') {
      position += 1;
      const nested = additive();
      if (tokens[position] !== ')') throw new Error('unclosed expression');
      position += 1;
      return nested;
    }
    if (token === '-') {
      position += 1;
      literalIndex += 1;
      const name = `__literal_${literalIndex}`;
      values[name] = -1;
      return { op: 'multiply', args: [{ op: 'value', name }, primary()] };
    }
    if (token && /^\d|^\./u.test(token)) {
      position += 1;
      literalIndex += 1;
      const name = `__literal_${literalIndex}`;
      values[name] = Number(token);
      return { op: 'value', name };
    }
    if (token && Object.hasOwn(values, token)) {
      position += 1;
      return { op: 'value', name: token };
    }
    throw new Error('unknown expression symbol');
  };
  const multiplicative = () => {
    let left = primary();
    while (tokens[position] === '*' || tokens[position] === '/') {
      const operator = tokens[position];
      position += 1;
      left = { op: operator === '*' ? 'multiply' : 'divide', args: [left, primary()] };
    }
    return left;
  };
  const additive = () => {
    let left = multiplicative();
    while (tokens[position] === '+' || tokens[position] === '-') {
      const operator = tokens[position];
      position += 1;
      left = { op: operator === '+' ? 'add' : 'subtract', args: [left, multiplicative()] };
    }
    return left;
  };
  try {
    const parsed = additive();
    return position === tokens.length
      ? parsed
      : { op: 'value', name: '__legacy_unparsed__', source: expression };
  } catch {
    return { op: 'value', name: '__legacy_unparsed__', source: expression };
  }
}

function evaluateLegacyExpression(expression, values) {
  return evaluateNodeSlideArtifactExpression(parseLegacyExpression(expression, values), values);
}

function normalizeProvenance(value, issues, options) {
  const provenance = isRecord(value.provenance) ? value.provenance : null;
  if (!provenance) {
    issues.push(issue('artifact_provenance', 'Artifact provenance is required.', '$.provenance'));
    return null;
  }
  const truthState = provenance.truthState ?? provenance.status;
  if (!NODESLIDE_CANONICAL_TRUTH_STATES.includes(truthState))
    issues.push(
      issue(
        'artifact_provenance_truth_state',
        `Unsupported truth state ${String(truthState)}.`,
        '$.provenance.truthState',
        'replace',
      ),
    );
  const sourceRefs = uniqueStrings(provenance.sourceRefs ?? value.sourceIds ?? []);
  if (!Array.isArray(provenance.sourceRefs) && !Array.isArray(value.sourceIds))
    issues.push(
      issue(
        'artifact_source_binding',
        'Artifact source bindings are required.',
        '$.provenance.sourceRefs',
      ),
    );
  if (
    Array.isArray(provenance.sourceRefs) &&
    Array.isArray(value.sourceIds) &&
    uniqueStrings(provenance.sourceRefs).join('\u001f') !==
      uniqueStrings(value.sourceIds).join('\u001f')
  )
    issues.push(
      issue(
        'artifact_source_binding',
        'sourceIds and provenance.sourceRefs must match exactly.',
        '$.provenance.sourceRefs',
        'replace',
      ),
    );
  if (sourceRefs.some((sourceRef) => !requiredText(sourceRef)))
    issues.push(
      issue(
        'artifact_source_binding',
        'Source references cannot be empty.',
        '$.provenance.sourceRefs',
      ),
    );
  if (['observed', 'estimated'].includes(truthState) && sourceRefs.length === 0)
    issues.push(
      issue(
        'artifact_provenance_evidence',
        `${truthState} provenance requires a source reference.`,
        '$.provenance.sourceRefs',
      ),
    );
  const truthBindings = options.allowedTruthStatesBySourceRef;
  if (truthBindings && NODESLIDE_CANONICAL_TRUTH_STATES.includes(truthState)) {
    sourceRefs.forEach((sourceRef, index) => {
      if (!(truthBindings[sourceRef] ?? []).includes(truthState)) {
        issues.push(
          issue(
            'artifact_provenance_evidence_class',
            `Source reference ${sourceRef} cannot support ${truthState} provenance.`,
            `$.provenance.sourceRefs[${index}]`,
            'replace',
          ),
        );
      }
    });
  }
  if (!requiredText(provenance.rationale))
    issues.push(
      issue(
        'artifact_provenance_rationale',
        'Provenance rationale is required and cannot be inferred by the compiler.',
        '$.provenance.rationale',
        'replace',
      ),
    );
  const rationale = requiredText(provenance.rationale) ? provenance.rationale.trim() : '';
  if (rationale.length > 320)
    issues.push(
      issue(
        'artifact_provenance_rationale',
        'Provenance rationale exceeds 320 characters.',
        '$.provenance.rationale',
        'replace',
      ),
    );
  if (provenance.sourceDigest !== undefined && !isNodeSlideSha256Digest(provenance.sourceDigest)) {
    issues.push(
      issue(
        'artifact_digest_format',
        'provenance.sourceDigest must use lowercase sha256:<64 hex>.',
        '$.provenance.sourceDigest',
        'remove',
      ),
    );
  }
  return {
    truthState,
    rationale,
    sourceRefs,
    assumptions: uniqueStrings(provenance.assumptions ?? value.assumptions ?? []),
    ...(requiredText(provenance.sourceDigest) ? { sourceDigest: provenance.sourceDigest } : {}),
  };
}

function result(value, issues, provenance = null) {
  return {
    ok: !issues.some((entry) => entry.severity === 'error'),
    issues,
    kind: isRecord(value) ? value.kind : undefined,
    provenance,
    sourceRefs: provenance?.sourceRefs ?? [],
  };
}

function issue(code, message, path, operation = 'replace') {
  return { code, severity: 'error', message, path, repair: { operation, path } };
}

function requiredString(value, code, path, issues, max) {
  if (!requiredText(value) || value.trim().length > max)
    issues.push(issue(code, `Expected 1-${max} characters.`, path));
}

function requiredText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function stringArray(value, min = 0) {
  return Array.isArray(value) && value.length >= min && value.every(requiredText);
}

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function uniqueStrings(value) {
  return Array.isArray(value)
    ? [
        ...new Set(value.filter((entry) => typeof entry === 'string').map((entry) => entry.trim())),
      ].sort()
    : [];
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  );
}
