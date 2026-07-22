import { describe, expect, it } from 'vitest';
import {
  buildBriefNodeSlide,
  buildGoldenNodeSlide,
  deterministicBriefSpec,
} from '../convex/lib/nodeslideSeed';
import type { DeckSnapshot } from './nodeslide';
import {
  NODESLIDE_LEGACY_ARTIFACT_BINDING_VERSION,
  NODESLIDE_PRODUCTION_ARTIFACT_BINDING_VERSION,
  NODESLIDE_PRODUCTION_ARTIFACT_SPEC_VERSION,
  compileNodeSlideArtifactSpecs,
  createNodeSlideArtifactShadowReceipt,
  migrateNodeSlideProductionArtifactBinding,
  nodeSlideArtifactCompilationReceiptLineageMatches,
  nodeSlideArtifactDigest,
  validateNodeSlideArtifactSpec,
} from './nodeslideArtifactSpec';

const NOW = 1_700_000_000_000;

function snapshot(): DeckSnapshot {
  return buildGoldenNodeSlide('artifact-spec-test', NOW).snapshot;
}

describe('production ArtifactSpec compiler', () => {
  it('uses canonical SHA-256 receipts across runtimes', () => {
    expect(nodeSlideArtifactDigest({})).toBe(
      'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
    );
  });

  it('covers every element and binds a deterministic fail-closed receipt', () => {
    const first = compileNodeSlideArtifactSpecs(snapshot());
    const second = compileNodeSlideArtifactSpecs(snapshot());

    expect(first.receipt.status).toBe('passed');
    expect(first.receipt.coveredElementCount).toBe(snapshot().elements.length);
    expect(first.receipt.artifactCount).toBeGreaterThan(0);
    expect(first.receipt.receiptDigest).toBe(second.receipt.receiptDigest);
    expect(first.receipt.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(
      first.specs.every(
        (spec) => spec.schemaVersion === NODESLIDE_PRODUCTION_ARTIFACT_SPEC_VERSION,
      ),
    ).toBe(true);
    expect(NODESLIDE_PRODUCTION_ARTIFACT_SPEC_VERSION).not.toBe('nodeslide.artifact-spec/v1');
    expect(
      nodeSlideArtifactCompilationReceiptLineageMatches(first.receipt, first.receipt.deckBinding),
    ).toBe(true);
    expect(
      nodeSlideArtifactCompilationReceiptLineageMatches(
        { ...first.receipt, receiptDigest: `sha256:${'0'.repeat(64)}` },
        first.receipt.deckBinding,
      ),
    ).toBe(false);
    expect(
      nodeSlideArtifactCompilationReceiptLineageMatches(first.receipt, {
        ...first.receipt.deckBinding,
        deckDigest: `sha256:${'0'.repeat(64)}`,
      }),
    ).toBe(false);
  });

  it('retains graph direction and endpoint bindings from production materialization', () => {
    const brief = {
      prompt: 'Explain a typed two-step process.',
      audience: 'Operators',
      purpose: 'make the handoff explicit',
      successCriteria: ['Show the directed handoff'],
    };
    const rawSpec = deterministicBriefSpec('Typed graph', brief);
    const first = rawSpec.slides[0];
    if (!first) throw new Error('Deterministic slide unavailable.');
    const {
      chart: _chart,
      formula: _formula,
      image: _image,
      video: _video,
      ...firstWithoutPrimaryArtifact
    } = first;
    rawSpec.slides[0] = {
      ...firstWithoutPrimaryArtifact,
      diagram: {
        kind: 'process',
        direction: 'horizontal',
        nodes: [
          { id: 'plan', label: 'Plan', kind: 'step' },
          { id: 'ship', label: 'Ship', kind: 'milestone' },
        ],
        edges: [{ from: 'plan', to: 'ship', label: 'approved' }],
      },
    };
    const built = buildBriefNodeSlide({
      deckId: 'deck-artifact-graph',
      projectId: 'project-artifact-graph',
      title: 'Typed graph',
      brief,
      themeId: 'quiet-precision',
      rawSpec,
      now: NOW,
    });
    const compilation = compileNodeSlideArtifactSpecs(built.snapshot);
    const graphs = compilation.specs.filter((spec) => spec.kind === 'graph');

    expect(graphs.length).toBeGreaterThan(0);
    expect(graphs.every((graph) => graph.payload.directed)).toBe(true);
    expect(
      graphs.every((graph) =>
        graph.payload.edges.every(
          (edge) =>
            graph.payload.nodes.some((node) => node.id === edge.from) &&
            graph.payload.nodes.some((node) => node.id === edge.to),
        ),
      ),
    ).toBe(true);
  });

  it('projects statement, comparison, and metric visual grammars as typed families', () => {
    const brief = {
      prompt: 'Build a varied operating review with a statement, comparison, and metric.',
      audience: 'Operators',
      purpose: 'make the operating choices clear',
      successCriteria: ['Use varied, editable visual grammar'],
    };
    const rawSpec = {
      title: 'Varied operating review',
      narrative: ['Frame', 'Compare', 'Measure', 'Act'],
      slides: [
        {
          title: 'Frame',
          section: 'Opening',
          headline: 'One decision changes the operating model.',
          body: 'The opening lands one editorial statement before the detail.',
          bullets: ['Context', 'Decision', 'Outcome'],
        },
        {
          title: 'Compare',
          section: 'Options',
          headline: 'Three choices can be scanned side by side.',
          body: 'Each column keeps one bounded comparison point.',
          bullets: ['Fast setup', 'Balanced control', 'Deep customization'],
        },
        {
          title: 'Measure',
          section: 'Signal',
          headline: 'A primary metric carries the slide.',
          body: 'The value is retained as a typed, editable metric.',
          bullets: ['Current', 'Target', 'Owner'],
          metric: '42%',
          metricLabel: 'Activation rate',
        },
        {
          title: 'Evidence',
          section: 'Signal',
          headline: 'Evidence remains editable.',
          body: 'The chart is source bound.',
          bullets: ['Baseline', 'Current', 'Target'],
          chart: { labels: ['Baseline', 'Current', 'Target'], values: [24, 42, 60], unit: '%' },
        },
        {
          title: 'Action',
          section: 'Plan',
          headline: 'The plan stays concrete.',
          body: 'Owners can edit each action.',
          bullets: ['Instrument', 'Review', 'Adapt'],
        },
        {
          title: 'Close',
          section: 'Decision',
          headline: 'Choose the next bounded experiment.',
          body: 'The close returns to one editorial statement.',
          bullets: ['Owner', 'Date', 'Success gate'],
        },
      ],
    };
    const built = buildBriefNodeSlide({
      deckId: 'deck-artifact-variety',
      projectId: 'project-artifact-variety',
      title: rawSpec.title,
      brief,
      themeId: 'quiet-precision',
      rawSpec,
      now: NOW,
    });
    const compilation = compileNodeSlideArtifactSpecs(built.snapshot);
    const kinds = new Set(compilation.specs.map((spec) => spec.kind));

    expect(compilation.receipt.status).toBe('passed');
    expect([...kinds]).toEqual(
      expect.arrayContaining(['statement', 'comparison', 'metric', 'chart']),
    );
    expect(
      compilation.specs.some(
        (spec) => spec.kind === 'comparison' && spec.payload.columns.length === 3,
      ),
    ).toBe(true);
    expect(
      compilation.specs.some(
        (spec) => spec.kind === 'metric' && spec.payload.displayValue === '42%',
      ),
    ).toBe(true);
  });

  it('fails a malformed chart with a stable semantic issue code', () => {
    const compilation = compileNodeSlideArtifactSpecs(snapshot());
    const chart = compilation.specs.find((spec) => spec.kind === 'chart');
    expect(chart?.kind).toBe('chart');
    if (!chart || chart.kind !== 'chart') throw new Error('Golden deck chart unavailable.');
    const malformed = {
      ...chart,
      payload: {
        ...chart.payload,
        series: [{ name: 'Signal', values: [1] }],
      },
    };

    expect(validateNodeSlideArtifactSpec(malformed)).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'artifact_chart_shape' })]),
    );
    expect(
      validateNodeSlideArtifactSpec({
        ...chart,
        schemaVersion: 'nodeslide.artifact-spec/v1',
      } as unknown as typeof chart),
    ).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'artifact_schema_version' })]),
    );
    expect(
      validateNodeSlideArtifactSpec({
        ...chart,
        kind: 'sankey',
      } as unknown as typeof chart),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'artifact_kind' })]));
    expect(
      validateNodeSlideArtifactSpec({
        ...chart,
        provenance: {
          truthState: 'promoted',
          rationale: 'A model cannot promote provenance.',
          sourceIds: chart.sourceIds,
        },
      } as unknown as typeof chart),
    ).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'artifact_provenance' })]));
  });

  it('keeps observed, estimated, and not-run truth states explicit', () => {
    const observedSnapshot = snapshot();
    for (const source of observedSnapshot.sources) {
      source.title = 'Observed production measurement';
      source.citation = 'Measured from the production event log.';
      source.status = 'ready';
    }
    const observed = compileNodeSlideArtifactSpecs(observedSnapshot).specs.find(
      (spec) => spec.kind === 'chart',
    );
    expect(observed?.provenance.truthState).toBe('observed');

    const estimatedSnapshot = structuredClone(observedSnapshot);
    for (const source of estimatedSnapshot.sources) source.citation = 'Estimated forecast for Q4.';
    const estimated = compileNodeSlideArtifactSpecs(estimatedSnapshot).specs.find(
      (spec) => spec.kind === 'chart',
    );
    expect(estimated?.provenance.truthState).toBe('estimated');

    const notRunSnapshot = structuredClone(observedSnapshot);
    for (const source of notRunSnapshot.sources) source.citation = 'Experiment not run yet.';
    const notRun = compileNodeSlideArtifactSpecs(notRunSnapshot).specs.find(
      (spec) => spec.kind === 'chart',
    );
    expect(notRun?.provenance.truthState).toBe('not-run');
  });

  it('migrates only the legacy storage binding and rejects unknown versions', () => {
    const legacy = {
      schemaVersion: NODESLIDE_LEGACY_ARTIFACT_BINDING_VERSION,
      artifactId: 'artifact:process',
      role: 'graph-edge',
      graphKind: 'process',
      from: 'plan',
      to: 'ship',
      label: 'approved',
    } as const;

    expect(migrateNodeSlideProductionArtifactBinding(legacy)).toEqual({
      ...legacy,
      schemaVersion: NODESLIDE_PRODUCTION_ARTIFACT_BINDING_VERSION,
    });
    expect(() =>
      migrateNodeSlideProductionArtifactBinding({
        ...legacy,
        schemaVersion: 'nodeslide.production-artifact-binding/v2',
      }),
    ).toThrowError(
      'NodeSlide production artifact binding migration failed [artifact_binding_version]: unsupported schema version nodeslide.production-artifact-binding/v2.',
    );
  });

  it('creates an anonymized, immutable, user-invisible shadow receipt', () => {
    const compilation = compileNodeSlideArtifactSpecs(snapshot()).receipt;
    const first = createNodeSlideArtifactShadowReceipt(compilation);
    const second = createNodeSlideArtifactShadowReceipt(compilation);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 'nodeslide.artifact-shadow-receipt/v1',
      userVisible: false,
      mutationApplied: false,
      anonymized: true,
      status: 'passed',
      compilationReceiptDigest: compilation.receiptDigest,
      authoredBindingCount: 0,
      canonicalArtifactCount: 0,
      canonicalKindCounts: [],
      canonicalArtifacts: [],
      preservedIntentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(JSON.stringify(first)).not.toContain(snapshot().deck.id);
    expect(first.receiptDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('proves preserved authored intent in shadow without exposing identity or content', () => {
    const bound = snapshot();
    const chart = bound.elements.find((element) => element.kind === 'chart');
    if (!chart) throw new Error('Golden deck chart unavailable.');
    const artifactId = 'private-authored-chart-id';
    const narrativeJob = 'Private authored narrative text';
    chart.authoredArtifactBinding = {
      schemaVersion: 'nodeslide.authored-artifact-binding/v1',
      artifactId,
      kind: 'chart',
      narrativeJob,
      truthState: 'observed',
      rationale: 'Private provenance rationale',
      claimIds: ['private:claim'],
      sourceIds: [...chart.sourceIds],
      specDigest: `sha256:${'a'.repeat(64)}`,
      projection: {
        primitive: 'chart',
        mode: 'native',
        browserContract: 'semantic',
        pptxContract: 'editable',
        editability: 'native',
        knownFidelityDifferences: [],
      },
    };
    const compilation = compileNodeSlideArtifactSpecs(bound).receipt;
    const receipt = createNodeSlideArtifactShadowReceipt(compilation, bound);
    expect(receipt).toMatchObject({
      status: 'passed',
      authoredBindingCount: 1,
      canonicalArtifactCount: 1,
      canonicalKindCounts: [{ kind: 'chart', count: 1 }],
      canonicalArtifacts: [
        {
          kind: 'chart',
          specDigest: `sha256:${'a'.repeat(64)}`,
          bindingDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
        },
      ],
      preservedIntentDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    const serialized = JSON.stringify(receipt);
    expect(serialized).not.toContain(artifactId);
    expect(serialized).not.toContain(narrativeJob);
    expect(serialized).not.toContain('private:claim');
  });

  it('emits stable blocking issues for missing evidence, visual starvation, and excess density', () => {
    const unbound = structuredClone(snapshot());
    const chart = unbound.elements.find((element) => element.kind === 'chart');
    if (!chart?.chart) throw new Error('Golden deck chart unavailable.');
    chart.sourceIds = [];
    const { sourceId: _sourceId, ...chartWithoutSource } = chart.chart;
    chart.chart = chartWithoutSource;
    expect(compileNodeSlideArtifactSpecs(unbound).receipt).toMatchObject({
      status: 'failed',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'artifact_claim_evidence_binding', severity: 'error' }),
      ]),
    });

    const proseOnly = structuredClone(snapshot());
    proseOnly.elements = proseOnly.elements
      .filter((element) => !['chart', 'math', 'image', 'video'].includes(element.kind))
      .map((element) => (element.role === 'metric' ? { ...element, role: 'body' } : element));
    const retainedIds = new Set(proseOnly.elements.map((element) => element.id));
    for (const slide of proseOnly.slides) {
      slide.elementOrder = slide.elementOrder.filter((elementId) => retainedIds.has(elementId));
    }
    expect(compileNodeSlideArtifactSpecs(proseOnly).receipt).toMatchObject({
      status: 'failed',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'artifact_visual_coverage', severity: 'error' }),
      ]),
    });

    const dense = structuredClone(snapshot());
    const text = dense.elements.find((element) => element.kind === 'text');
    if (!text) throw new Error('Golden deck text unavailable.');
    text.content = 'x'.repeat(2_401);
    expect(compileNodeSlideArtifactSpecs(dense).receipt).toMatchObject({
      status: 'failed',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'artifact_density_limit', severity: 'error' }),
      ]),
    });
  });
});
