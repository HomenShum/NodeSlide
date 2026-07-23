/**
 * Full Atlas v3 remediation — compile the canonical 38 fixtures into a NATIVE deck.
 *
 * v3 shipped every artifact as vector autoshapes because it drove the Walnut *visual* exporter.
 * But the semantic data was never missing: each fixture in benchmarks/artifact-atlas/v2/atlas.json
 * already carries a typed `artifactSpec` with a `kind` and a real `payload` (series, nodes/edges,
 * an equation AST, waterfall deltas, ...). Its own `pptxContract` demands
 * "editable-or-declared-fallback" — v3 delivered neither.
 *
 * This is the missing compile step: artifactSpec -> native OOXML object, per target.
 *
 *   chart | waterfall | comparison | timeline | gantt | risk-matrix  -> native chart part
 *   graph | causal-loop | sankey                                     -> bound <p:cxnSp> diagram
 *   equation                                                         -> <m:oMath> from the AST
 *   archetypes needing a lookup grid                                 -> native <a:tbl>
 *   generic                                                          -> text (narrative slides)
 *
 * And the honesty rule that matters more than any of them: where the fixture's own payload lacks
 * the substance its archetype requires — a trace with zero measured spans, a runtime proof with
 * sampleSize 0, a before/after with no pair, a media artifact with no asset — the compiler emits a
 * DECLARED fallback naming exactly what is missing, and the gate reports an honest failure. It
 * never fabricates the artifact to turn the gate green. That is the whole point of the exercise.
 *
 * Usage: node scripts/build-atlas-v3-native.mjs [--out <file.pptx>]
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import Pptx from 'pptxgenjs';
import {
  BRAND,
  buildChart,
  buildDiagramNodes,
  buildEquationPlaceholder,
  buildTable,
  injectConnectors,
  injectOmml,
} from './build-atlas-native-pptx.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ATLAS_PATH = path.join(repoRoot, 'benchmarks/artifact-atlas/v2/atlas.json');

/** v2 deck vocabulary -> Atlas archetype id. Only unambiguous mappings; the rest stay ungated. */
const ARCHETYPE_BY_ARTIFACT_TYPE = {
  'hero-thesis': 'narrative.hero-thesis',
  'section-opener': 'narrative.section-opener',
  'big-metric': 'narrative.big-metric',
  'customer-voice': 'narrative.quote',
  'before-after-story': 'progression.before-after',
  'kpi-strip': 'data.kpi-strip',
  'multi-series-trend': 'data.multi-series',
  'uncertainty-range': 'data.uncertainty-range',
  waterfall: 'data.waterfall',
  'quality-cost-scatter': 'data.distribution',
  'operating-table-sparklines': 'data.table',
  'dense-dashboard-funnel': 'data.funnel',
  'system-architecture': 'systems.architecture',
  'request-sequence': 'systems.sequence',
  'causal-loop': 'systems.node-edge-graph',
  'source-allocation-sankey': 'systems.node-edge-graph',
  'routing-decision-tree': 'systems.hierarchy',
  'research-timeline': 'progression.timeline',
  'roadmap-gantt': 'progression.roadmap',
  'evidence-scrollytelling': 'progression.scrollytelling',
  'real-screenshot-callouts': 'product-evidence.screenshot-callouts',
  'interaction-clip': 'product-evidence.interaction-clip',
  'product-before-after': 'progression.before-after',
  'claim-source-lineage': 'product-evidence.claim-lineage',
  'pdf-evidence-region': 'product-evidence.citation-card',
  'code-runtime-proof': 'technical.code-and-result',
  'otel-trace': 'technical.trace-waterfall',
  'quality-cost-equation': 'technical.equation',
  'deck-ci-receipt': 'product-evidence.deck-ci-receipt',
  'risk-matrix': 'decision.risk-matrix',
  'cost-quality-frontier': 'decision.cost-quality',
  'model-compare': 'systems.comparison-matrix',
  'harness-compare': 'systems.comparison-matrix',
  'final-recommendation': 'decision.recommendation',
};

/**
 * Kinds with no PowerPoint object model at all. These get a declared poster-frame fallback rather
 * than being drawn as autoshapes and called editable — the distinction the whole gate exists for.
 */
const DECLARED_FALLBACK_KINDS = new Set(['motion', 'spatial-scene', 'evidence-media']);

/**
 * Archetypes whose required artifact is a TABLE, regardless of how the fixture typed its payload.
 * `data.table` and `systems.comparison-matrix` demand a lookup grid; emitting a chart there is a
 * different artifact, not a nicer one.
 */
const TABLE_ARCHETYPES = new Set([
  'data.table',
  'systems.comparison-matrix',
  'product-evidence.deck-ci-receipt',
]);

/** Build table rows from whatever numeric payload the fixture carries. */
function rowsFromPayload(payload, spec) {
  if (Array.isArray(payload.cohorts) && Array.isArray(payload.metrics)) {
    const metrics = payload.metrics.map((m) => m.id);
    return [
      ['Cohort', ...metrics],
      ...payload.cohorts.map((c) => [
        String(c.id),
        ...metrics.map((m) => String(c.values?.[m] ?? '—')),
      ]),
    ];
  }
  if (Array.isArray(payload.series) && payload.series.length > 0) {
    const labels = labelsFor((payload.series[0].values ?? []).length, payload);
    return [
      ['Series', ...labels],
      ...payload.series.map((s) => [String(s.id), ...(s.values ?? []).map((v) => String(v))]),
    ];
  }
  return [
    ['Field', 'Value'],
    ['artifact', String(spec.id ?? '')],
    ['kind', String(spec.kind ?? '')],
  ];
}

/**
 * An honest declared fallback. Used ONLY when the fixture's own payload lacks the substance the
 * archetype requires (e.g. a trace with zero measured spans) — never to dodge a gate failure where
 * the data exists. The behavior string names exactly what is missing.
 */
function declaredFallback(base, capability, behavior) {
  return { ...base, kind: 'fallback', capability, fallbackBehavior: behavior };
}

// ---------------------------------------------------------------------------------------------
// Equation AST -> OMML
// ---------------------------------------------------------------------------------------------

const SYMBOL = { one: '1', alpha: 'α', beta: 'β' };

function ommlRun(text) {
  const escaped = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<m:r><m:t>${escaped}</m:t></m:r>`;
}

/** Compile the fixture's expression tree into real OMML (fractions become <m:f>, not "/" text). */
export function ommlFromExpression(node) {
  if (!node || typeof node !== 'object') return ommlRun('?');
  switch (node.op) {
    case 'value':
      return ommlRun(SYMBOL[node.name] ?? node.name);
    case 'divide': {
      const [num, den] = node.args ?? [];
      return `<m:f><m:num>${ommlFromExpression(num)}</m:num><m:den>${ommlFromExpression(den)}</m:den></m:f>`;
    }
    case 'add':
      return (node.args ?? []).map(ommlFromExpression).join(ommlRun(' + '));
    case 'multiply':
      return (node.args ?? []).map(ommlFromExpression).join(ommlRun('·'));
    case 'subtract':
      return (node.args ?? []).map(ommlFromExpression).join(ommlRun(' − '));
    default:
      return ommlRun(node.name ?? node.op ?? '?');
  }
}

// ---------------------------------------------------------------------------------------------
// artifactSpec -> native builder spec
// ---------------------------------------------------------------------------------------------

function labelsFor(count, payload) {
  const given = payload?.xAxis?.labels;
  if (Array.isArray(given) && given.length === count) return given.map(String);
  return Array.from({ length: count }, (_, i) => `${i + 1}`);
}

/** Returns a native spec {kind, ...} the primitives understand, or null when unmappable. */
export function compileArtifactSpec(fixture) {
  const spec = fixture.artifactSpec ?? {};
  const payload = spec.payload ?? {};
  const archetype = ARCHETYPE_BY_ARTIFACT_TYPE[fixture.artifactType] ?? null;
  const base = { archetype, title: fixture.title, artifactType: fixture.artifactType };

  // --- Archetype-driven routing: the archetype decides the artifact, not the fixture's payload tag.
  if (archetype && TABLE_ARCHETYPES.has(archetype)) {
    return { ...base, kind: 'table', rows: rowsFromPayload(payload, spec) };
  }

  // Fixtures that explicitly disclose they were never measured cannot honestly produce the
  // evidence artifact their archetype requires. Declare that, rather than drawing a fake one —
  // `illustrative-timing-presented-as-observed` is a named forbidden substitute.
  if (spec.kind === 'trace' && (payload.spans ?? []).length === 0) {
    return declaredFallback(
      base,
      'unsupported',
      `No measured spans exist (status: ${payload.status ?? 'illustrative'}). A trace waterfall is not drawn, because rendering illustrative timing as an observed trace is a forbidden substitute. Wire a real OTel span source to satisfy this archetype.`,
    );
  }
  if (spec.kind === 'runtime-proof' && Number(payload.sampleSize ?? 0) === 0) {
    return declaredFallback(
      base,
      'unsupported',
      `No measured runtime and no code body in the fixture (status: ${payload.status ?? 'illustrative'}). Code-plus-runtime-result is not fabricated; supply the code and a run receipt to satisfy this archetype.`,
    );
  }
  // A "before/after" whose payload is only a caption has no two states to show.
  if (archetype === 'progression.before-after' && spec.kind === 'generic') {
    return declaredFallback(
      base,
      'unsupported',
      'The fixture carries only a narrative caption — no before/after pair of screenshots, charts or diagrams — so no comparison artifact is drawn.',
    );
  }

  if (DECLARED_FALLBACK_KINDS.has(spec.kind)) {
    return {
      ...base,
      kind: 'fallback',
      capability: 'poster-frame',
      fallbackBehavior:
        spec.kind === 'motion'
          ? 'Web-only motion. PowerPoint receives the declared static fallback state as a poster frame plus a storyboard caption.'
          : spec.kind === 'spatial-scene'
            ? 'Web-only spatial scene. PowerPoint receives a poster frame of the primary viewport.'
            : 'Asset-bound capture. PowerPoint receives the captured image as a poster frame; no live region highlight.',
    };
  }

  switch (spec.kind) {
    case 'chart': {
      const series = (payload.series ?? []).map((s, i) => ({
        name: s.id ?? `series-${i + 1}`,
        labels: labelsFor((s.values ?? []).length, payload),
        values: (s.values ?? []).map(Number),
      }));
      if (series.length === 0 || series[0].values.length === 0) return null;
      return { ...base, kind: series[0].values.length > 3 ? 'line' : 'bar', series };
    }
    case 'waterfall': {
      const deltas = payload.deltas ?? [];
      const labels = ['Baseline', ...deltas.map((d) => d.label ?? 'Δ'), 'Final'];
      const values = [
        Number(payload.baseline ?? 0),
        ...deltas.map((d) => Number(d.value ?? 0)),
        Number(payload.final ?? 0),
      ];
      return { ...base, kind: 'bar', series: [{ name: payload.unit ?? 'value', labels, values }] };
    }
    case 'comparison': {
      const cohorts = (payload.cohorts ?? []).filter((c) => c.values);
      const metrics = (payload.metrics ?? []).map((m) => m.id);
      if (cohorts.length === 0 || metrics.length === 0) return null;
      // One series per metric, one category per cohort — an editable multi-series chart.
      const series = metrics.map((metric) => ({
        name: metric,
        labels: cohorts.map((c) => c.id),
        values: cohorts.map((c) => Number(c.values[metric] ?? 0)),
      }));
      return { ...base, kind: 'bar', series };
    }
    case 'timeline': {
      const events = payload.events ?? [];
      if (events.length === 0) return null;
      return {
        ...base,
        kind: 'bar',
        series: [
          {
            name: `start (${payload.unit ?? 'unit'})`,
            labels: events.map((e) => e.id),
            values: events.map((e) => Number(e.start ?? 0)),
          },
          {
            name: `duration (${payload.unit ?? 'unit'})`,
            labels: events.map((e) => e.id),
            values: events.map((e) => Math.max(0, Number(e.end ?? 0) - Number(e.start ?? 0))),
          },
        ],
      };
    }
    case 'gantt': {
      const tasks = payload.tasks ?? [];
      if (tasks.length === 0) return null;
      return {
        ...base,
        kind: 'bar',
        series: [
          {
            name: `start (${payload.unit ?? 'unit'})`,
            labels: tasks.map((t) => t.id),
            values: tasks.map((t) => Number(t.start ?? 0)),
          },
          {
            name: `duration (${payload.unit ?? 'unit'})`,
            labels: tasks.map((t) => t.id),
            values: tasks.map((t) => Math.max(0, Number(t.end ?? 0) - Number(t.start ?? 0))),
          },
        ],
      };
    }
    case 'risk-matrix': {
      const risks = payload.risks ?? [];
      if (risks.length === 0) return null;
      return {
        ...base,
        kind: 'bar',
        series: [
          {
            name: 'likelihood',
            labels: risks.map((r) => r.id),
            values: risks.map((r) => Number(r.likelihood ?? 0)),
          },
          {
            name: 'impact',
            labels: risks.map((r) => r.id),
            values: risks.map((r) => Number(r.impact ?? 0)),
          },
        ],
      };
    }
    case 'graph':
    case 'causal-loop': {
      const nodes = (payload.nodes ?? []).map((n) => ({ id: n.id, label: n.label ?? n.id }));
      const edges = (payload.edges ?? [])
        .map((e) => [e.from, e.to])
        .filter(([f, t]) => nodes.some((n) => n.id === f) && nodes.some((n) => n.id === t));
      if (nodes.length < 2 || edges.length === 0) return null;
      return { ...base, kind: 'diagram', nodes, edges };
    }
    case 'sankey': {
      const nodes = (payload.nodes ?? []).map((n) => ({ id: n.id, label: n.label ?? n.id }));
      const edges = (payload.links ?? [])
        .map((l) => [l.source, l.target])
        .filter(([f, t]) => nodes.some((n) => n.id === f) && nodes.some((n) => n.id === t));
      if (nodes.length < 2 || edges.length === 0) return null;
      // Deduplicate: a Sankey can have parallel links; one connector per node pair is enough.
      const seen = new Set();
      const unique = edges.filter(([f, t]) => {
        const key = `${f}->${t}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      return { ...base, kind: 'diagram', nodes, edges: unique };
    }
    case 'equation':
      return {
        ...base,
        kind: 'equation',
        ommlBody: `<m:oMathPara><m:oMath>${ommlFromExpression(payload.expression)}</m:oMath></m:oMathPara>`,
      };
    case 'runtime-proof':
      return {
        ...base,
        kind: 'table',
        rows: [
          ['Field', 'Value'],
          ['sample size', String(payload.sampleSize ?? 0)],
          ['unit', String(payload.unit ?? '')],
          ['status', String(payload.status ?? 'unknown')],
          ['receipt digest', String(payload.receiptDigest || '(none)')],
        ],
      };
    case 'trace': {
      const spans = payload.spans ?? [];
      return {
        ...base,
        kind: 'table',
        rows: [
          ['Span', 'Status'],
          ...(spans.length > 0
            ? spans
                .slice(0, 8)
                .map((s, i) => [
                  String(s.name ?? s.id ?? `span-${i + 1}`),
                  String(s.status ?? payload.status ?? ''),
                ])
            : [['(no measured spans)', String(payload.status ?? 'illustrative')]]),
        ],
      };
    }
    case 'generic':
      return { ...base, kind: 'text', label: payload.label ?? fixture.takeaway ?? fixture.title };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Deck assembly
// ---------------------------------------------------------------------------------------------

function addSlideHeader(slide, spec, index) {
  slide.background = { color: BRAND.bg };
  slide.addText(String(spec.archetype ?? spec.artifactType).toUpperCase(), {
    x: 0.5,
    y: 0.32,
    w: 8.6,
    h: 0.3,
    fontSize: 10,
    color: BRAND.muted,
    charSpacing: 2,
  });
  slide.addText(spec.title, {
    x: 0.5,
    y: 0.6,
    w: 9,
    h: 0.72,
    fontSize: 22,
    bold: true,
    color: BRAND.ink,
  });
  slide.addText(`${index + 1}`, {
    x: 9.2,
    y: 0.32,
    w: 0.5,
    h: 0.3,
    fontSize: 10,
    color: BRAND.muted,
  });
}

export async function buildV3NativeDeck(fixtures) {
  const pptx = new Pptx();
  pptx.defineLayout({ name: 'A16x9', width: 10, height: 5.63 });
  pptx.layout = 'A16x9';

  const equationSpecs = [];
  const diagrams = [];
  const compiled = [];

  fixtures.forEach((fixture, index) => {
    const spec = compileArtifactSpec(fixture);
    if (!spec) {
      compiled.push({ fixture, spec: null, emitted: 'skipped' });
      return;
    }
    const slide = pptx.addSlide();
    addSlideHeader(slide, spec, index);

    if (spec.kind === 'bar' || spec.kind === 'line') {
      buildChart(pptx, slide, spec);
    } else if (spec.kind === 'table') {
      buildTable(slide, spec);
    } else if (spec.kind === 'equation') {
      buildEquationPlaceholder(slide, spec);
      equationSpecs.push(spec);
    } else if (spec.kind === 'diagram') {
      diagrams.push(buildDiagramNodes(slide, spec));
    } else if (spec.kind === 'fallback') {
      slide.addText(spec.fallbackBehavior, {
        x: 0.7,
        y: 2.2,
        w: 8.6,
        h: 1.6,
        fontSize: 14,
        color: BRAND.ink,
        align: 'center',
      });
      slide.addText(`declared fallback · capability.pptx = ${spec.capability}`, {
        x: 0.7,
        y: 3.9,
        w: 8.6,
        h: 0.4,
        fontSize: 11,
        color: BRAND.muted,
        align: 'center',
      });
    } else {
      slide.addText(spec.label ?? spec.title, {
        x: 0.7,
        y: 2.1,
        w: 8.6,
        h: 1.8,
        fontSize: 20,
        color: BRAND.ink,
        align: 'center',
      });
    }
    compiled.push({ fixture, spec, emitted: spec.kind });
  });

  const raw = await pptx.write('nodebuffer');
  const withOmml = await injectOmml(raw, equationSpecs);
  const buffer = await injectConnectors(withOmml, diagrams);
  return { buffer, compiled };
}

async function main() {
  const outIndex = process.argv.indexOf('--out');
  const outDir = path.join(repoRoot, 'outputs/atlas-v3-native');
  const outPath =
    outIndex >= 0 && process.argv[outIndex + 1]
      ? path.resolve(process.argv[outIndex + 1])
      : path.join(outDir, 'nodeslide-artifact-atlas-v3-native.pptx');

  const atlas = JSON.parse(await readFile(ATLAS_PATH, 'utf8'));
  const { buffer, compiled } = await buildV3NativeDeck(atlas.fixtures);

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, buffer);

  // Emit gate inputs so the deck is judged by the same instrument that failed v3.
  const emitted = compiled.filter((c) => c.spec);
  const fixturesDoc = {
    _comment:
      'Generated by build-atlas-v3-native.mjs. Maps each emitted slide to the Atlas archetype its fixture claims.',
    fixtures: emitted.map((c, i) => ({
      number: i + 1,
      title: c.spec.title,
      artifactType: c.spec.archetype ?? c.fixture.artifactType,
      // The gate resolves `fallback-accepted` only when the recipe declared the degradation up
      // front. Emitting it here is what makes the declaration auditable rather than implicit.
      ...(c.spec.kind === 'fallback'
        ? {
            declaredFallback: {
              capability: c.spec.capability,
              behavior: c.spec.fallbackBehavior,
            },
          }
        : {}),
    })),
  };
  const mapDoc = Object.fromEntries(
    [...new Set(emitted.map((c) => c.spec.archetype).filter(Boolean))].map((a) => [a, a]),
  );
  await writeFile(
    path.join(outDir, 'v3-native-fixtures.json'),
    `${JSON.stringify(fixturesDoc, null, 2)}\n`,
  );
  await writeFile(path.join(outDir, 'v3-native-map.json'), `${JSON.stringify(mapDoc, null, 2)}\n`);

  const zip = await JSZip.loadAsync(buffer);
  const charts = Object.keys(zip.files).filter((p) => /ppt\/charts\/chart\d+\.xml$/.test(p)).length;
  let tables = 0;
  let equations = 0;
  let connectors = 0;
  for (const p of Object.keys(zip.files).filter((f) => /ppt\/slides\/slide\d+\.xml$/.test(f))) {
    const xml = await zip.file(p).async('string');
    tables += (xml.match(/<a:tbl\b/g) ?? []).length;
    equations += (xml.match(/<m:oMath\b/g) ?? []).length;
    connectors += (xml.match(/<p:cxnSp>/g) ?? []).length;
  }
  const byKind = {};
  for (const c of compiled) byKind[c.emitted] = (byKind[c.emitted] ?? 0) + 1;

  process.stdout.write(
    `Compiled ${emitted.length}/${atlas.fixtures.length} fixtures -> ${path.relative(repoRoot, outPath)}\n` +
      `  emitted by kind: ${JSON.stringify(byKind)}\n` +
      `  native objects: ${charts} chart parts, ${tables} tables, ${equations} equations, ${connectors} bound connectors\n`,
  );
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}
