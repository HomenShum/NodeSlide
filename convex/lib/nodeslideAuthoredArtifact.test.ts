import { describe, expect, it } from 'vitest';
import { NODESLIDE_ARTIFACT_GEOMETRY_VERSION } from '../../shared/nodeslideArtifactGeometry.js';
import { canonicalArtifactFixture } from '../../shared/nodeslideArtifactRegistry.fixtures';
import {
  NODESLIDE_ARTIFACT_COMPILER_REGISTRY,
  NODESLIDE_CANONICAL_ARTIFACT_KINDS,
} from '../../shared/nodeslideArtifactRegistry.js';
import { compileNodeSlideArtifactSpecs } from '../../shared/nodeslideArtifactSpec';
import {
  NODESLIDE_AUTHORED_ARTIFACT_VERSION,
  NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
  NodeSlideAuthoredArtifactValidationError,
  compileNodeSlideAuthoredArtifact,
  nodeSlideAuthoredArtifactJsonSchema,
  nodeSlideAuthoredArtifactKindsForBrief,
  nodeSlideAuthoredArtifactLinkedUrls,
  nodeSlideAuthoredArtifactReceiptLineageMatches,
  nodeSlideAuthoredArtifactSourceInventory,
  nodeSlideAuthoredArtifactValidationOptions,
} from './nodeslideAuthoredArtifact';
import { buildBriefNodeSlide } from './nodeslideSeed';

const provenance = {
  truthState: 'derived',
  rationale: 'Values are supplied by the bounded creation brief.',
  sourceRefs: ['brief:success-criteria'],
} as const;

const nativeGeometryKinds = [
  'waterfall',
  'sankey',
  'gantt',
  'risk-matrix',
  'trace',
  'spatial-scene',
] as const;

describe('model-authored production ArtifactSpec adapter', () => {
  it('never persists credential-bearing links extracted from the creation brief', () => {
    const safeUrl = 'https://evidence.example.com/capture.png?page=2';
    const credentialUrl = 'https://evidence.example.com/private.png?api_key=do-not-persist';
    const signedUrl =
      'https://evidence.example.com/signed.png?X-Amz-Credential=scope&X-Amz-Signature=secret';
    const doubleEncodedUrl =
      'https://evidence.example.com/nested.png?next=token%253Ddo-not-persist';
    const prompt = `Use ${safeUrl}, ignore ${credentialUrl}, and never retain ${signedUrl} or ${doubleEncodedUrl}.`;

    expect(nodeSlideAuthoredArtifactLinkedUrls(prompt)).toEqual([safeUrl]);
    const inventory = nodeSlideAuthoredArtifactSourceInventory({
      prompt,
      audience: 'Reviewers',
      purpose: 'verify safe source extraction',
      successCriteria: ['Do not persist credentials'],
    });
    expect(inventory.flatMap((source) => (source.url ? [source.url] : []))).toEqual([safeUrl]);
    expect(JSON.stringify(inventory)).not.toContain('do-not-persist');
    expect(JSON.stringify(inventory)).not.toContain('X-Amz-Signature');
    expect(JSON.stringify(inventory)).not.toContain('token%253D');
  });

  it('offers all 16 kinds through relevant brief-scoped schemas, not by default', () => {
    const defaultKinds = nodeSlideAuthoredArtifactKindsForBrief({
      prompt: 'Create a concise decision deck.',
      audience: 'Operators',
      purpose: 'choose a path',
      successCriteria: ['Make the comparison explicit'],
    });
    expect(defaultKinds).toEqual([
      'generic',
      'chart',
      'graph',
      'evidence-media',
      'comparison',
      'equation',
    ]);
    const allKinds = nodeSlideAuthoredArtifactKindsForBrief({
      prompt:
        'Use a waterfall, Sankey, causal loop, timeline, Gantt, animation state transition, runtime latency benchmark, trace spans, risk matrix, and spatial viewport.',
      audience: 'Engineers',
      purpose: 'exercise every advanced artifact',
      successCriteria: ['Keep fallbacks honest'],
    });
    expect(allKinds).toEqual(NODESLIDE_CANONICAL_ARTIFACT_KINDS);
    const schema = nodeSlideAuthoredArtifactJsonSchema(allKinds, ['brief:prompt']) as {
      oneOf: Array<{
        properties: {
          kind: { const: string };
          sourceIds: { items: { enum: string[] } };
        };
      }>;
    };
    expect(schema.oneOf.map((variant) => variant.properties.kind.const)).toEqual(allKinds);
    expect(
      schema.oneOf.every(
        (variant) => variant.properties.sourceIds.items.enum[0] === 'brief:prompt',
      ),
    ).toBe(true);
  });

  it('compiles every canonical family to a declared primitive or honest fallback', () => {
    for (const kind of NODESLIDE_CANONICAL_ARTIFACT_KINDS) {
      const compilation = compileNodeSlideAuthoredArtifact(canonicalArtifactFixture(kind), {
        allowedSourceRefs: ['brief:prompt'],
      });
      expect(Object.keys(compilation.planned).length).toBeGreaterThan(0);
      expect(compilation.spec).toMatchObject({
        schemaVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
        kind,
      });
      expect(compilation.receipt).toMatchObject({
        authoredSpecVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
        acceptedSpecVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
        kind,
        status: 'passed',
        repairIssues: [],
        projection: expect.objectContaining({
          mode: NODESLIDE_ARTIFACT_COMPILER_REGISTRY[kind].mode,
        }),
        typedRecovery: { status: 'not-required', mode: 'none', operations: [] },
      });
      if (nativeGeometryKinds.includes(kind as (typeof nativeGeometryKinds)[number])) {
        expect(compilation.geometry).toMatchObject({
          schemaVersion: NODESLIDE_ARTIFACT_GEOMETRY_VERSION,
          artifactId: `fixture-${kind}`,
          kind,
        });
        expect(compilation.receipt).toMatchObject({
          geometryVersion: NODESLIDE_ARTIFACT_GEOMETRY_VERSION,
          geometryDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
          projection: {
            mode: 'native',
            editability: 'grouped-editable',
            pptxContract: 'editable',
          },
        });
        expect(
          nodeSlideAuthoredArtifactReceiptLineageMatches(compilation.spec, {
            ...compilation.receipt,
            geometryDigest: `sha256:${'0'.repeat(64)}`,
          }),
        ).toBe(false);
      } else {
        expect(compilation.geometry).toBeUndefined();
        expect(compilation.receipt.geometryDigest).toBeUndefined();
      }
    }
  });

  it('compiles a bounded typed chart deterministically', () => {
    const spec = {
      schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
      id: 'activation-chart',
      kind: 'chart',
      narrativeJob: 'Compare activation from baseline to target.',
      provenance,
      payload: {
        labels: ['Baseline', 'Current', 'Target'],
        values: [24, 42, 60],
        unit: '%',
      },
    };
    const first = compileNodeSlideAuthoredArtifact(spec);
    const second = compileNodeSlideAuthoredArtifact(spec);

    expect(first).toEqual(second);
    expect(first.planned.chart).toEqual({
      labels: ['Baseline', 'Current', 'Target'],
      values: [24, 42, 60],
      unit: '%',
    });
    expect(first.receipt).toMatchObject({
      kind: 'chart',
      status: 'passed',
      authoredSpecDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      renderHandle: expect.stringMatching(/^nodeslide-render:sha256:[0-9a-f]{64}$/u),
      renderLineage: {
        baseInputDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        candidateSpecDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        materializationDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        projectionDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
        baseImmutable: true,
      },
      typedRecovery: {
        status: 'recovered',
        mode: 'legacy-exact-normalization',
        operations: ['legacy.chart.labels-values-to-axis-series'],
      },
      receiptDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
    });
    expect(nodeSlideAuthoredArtifactReceiptLineageMatches(first.spec, first.receipt)).toBe(true);
    expect(
      nodeSlideAuthoredArtifactReceiptLineageMatches(first.spec, {
        ...first.receipt,
        authoredSpecDigest: `sha256:${'0'.repeat(64)}`,
      }),
    ).toBe(false);
    expect(
      nodeSlideAuthoredArtifactReceiptLineageMatches(first.spec, {
        ...first.receipt,
        renderLineage: {
          ...first.receipt.renderLineage,
          materializationDigest: `sha256:${'0'.repeat(64)}`,
        },
      }),
    ).toBe(false);
  });

  it('keeps legacy equation JSON compatible without evaluating provider code', () => {
    const compilation = compileNodeSlideAuthoredArtifact({
      schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
      id: 'legacy-ratio',
      kind: 'equation',
      narrativeJob: 'Calculate an observed ratio.',
      provenance,
      payload: {
        expression: 'wins / runs',
        display: '8 / 10 = 0.8',
        variables: [
          { label: 'wins', value: 8 },
          { label: 'runs', value: 10 },
        ],
      },
    });
    expect(compilation.spec).toMatchObject({
      schemaVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
      kind: 'equation',
      payload: { result: 0.8 },
    });
    expect(compilation.planned.formula).toMatchObject({
      expression: '(wins / runs)',
      display: '8 / 10 = 0.8',
    });
    expect(compilation.receipt.acceptedSpecVersion).toBe(NODESLIDE_AUTHORED_ARTIFACT_VERSION);
    expect(compilation.receipt.typedRecovery).toEqual({
      status: 'recovered',
      mode: 'legacy-exact-normalization',
      operations: ['legacy.equation.expression-to-ast'],
    });
  });

  it('materializes all six native geometry families as grouped editable production elements', () => {
    const slides = nativeGeometryKinds.map((kind, index) => ({
      title: `Native ${index + 1}`,
      section: 'Native geometry',
      headline: `Inspect ${kind}`,
      body: 'The authored spec remains source-bound and editable.',
      bullets: ['Typed', 'Proportional', 'Exportable'],
      artifactSpec: canonicalArtifactFixture(kind),
    }));
    const built = buildBriefNodeSlide({
      deckId: 'deck-native-artifacts',
      projectId: 'project-native-artifacts',
      title: 'Native artifact families',
      brief: {
        prompt:
          'Use a waterfall, Sankey, Gantt project schedule, trace spans, risk matrix, and spatial viewport.',
        audience: 'Artifact reviewers',
        purpose: 'verify native production materialization',
        successCriteria: ['Keep every geometry family editable and source-bound'],
      },
      themeId: 'quiet-precision',
      rawSpec: {
        title: 'Native artifact families',
        narrative: ['Compile', 'Materialize', 'Export'],
        slides,
      },
      now: 1_700_000_000_000,
    });

    for (const [index, kind] of nativeGeometryKinds.entries()) {
      const slide = built.snapshot.slides[index];
      if (!slide) throw new Error(`Missing native ${kind} slide.`);
      const nativeElements = built.snapshot.elements.filter(
        (element) => element.slideId === slide.id && element.authoredArtifactBinding?.kind === kind,
      );
      expect(nativeElements.length).toBeGreaterThan(1);
      expect(
        nativeElements.every((element) => element.groupId === nativeElements[0]?.groupId),
      ).toBe(true);
      expect(nativeElements[0]?.groupId).toBeTruthy();
      expect(
        nativeElements.every(
          (element) =>
            element.exportCapabilities.includes('web_native') &&
            element.exportCapabilities.includes('pptx_editable') &&
            element.authoredArtifactBinding?.artifactId === `fixture-${kind}`,
        ),
      ).toBe(true);
      expect(built.spec.slides[index]?.authoredArtifactCompilation).toMatchObject({
        kind,
        geometryVersion: NODESLIDE_ARTIFACT_GEOMETRY_VERSION,
        geometryDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u),
      });
    }

    const waterfallBars = built.snapshot.elements.filter(
      (element) => element.role === 'artifact_waterfall_bar',
    );
    const quality = waterfallBars.find((element) => element.name === 'Waterfall bar: Quality');
    const repair = waterfallBars.find((element) => element.name === 'Waterfall bar: Repair');
    expect(quality?.bbox.height).toBeCloseTo((repair?.bbox.height ?? 0) * 2, 3);

    const compilation = compileNodeSlideArtifactSpecs(built.snapshot);
    expect(compilation.receipt.status).toBe('passed');
    for (const kind of nativeGeometryKinds) {
      expect(compilation.specs.filter((spec) => spec.id === `fixture-${kind}`)).toHaveLength(1);
    }
  });

  it('rejects unknown kinds and promoted provenance at the authored boundary', () => {
    const base = {
      schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
      id: 'typed-artifact',
      narrativeJob: 'Stay explicit.',
      provenance,
      payload: {},
    };
    expect(() => compileNodeSlideAuthoredArtifact({ ...base, kind: 'radar' })).toThrowError(
      /\[artifact_kind\] at \$\.kind/u,
    );
    expect(() =>
      compileNodeSlideAuthoredArtifact(
        {
          ...base,
          kind: 'metric',
          provenance: { ...provenance, sourceRefs: ['unknown:evidence'] },
          payload: { displayValue: '42%', label: 'Activation' },
        },
        { allowedSourceRefs: ['brief:prompt', 'brief:success-criteria'] },
      ),
    ).toThrowError(/\[artifact_source_binding\].*provenance\.sourceRefs/u);
    expect(() =>
      compileNodeSlideAuthoredArtifact({
        ...base,
        kind: 'metric',
        provenance: { ...provenance, truthState: 'promoted' },
        payload: { displayValue: '42%', label: 'Activation' },
      }),
    ).toThrowError(/\[artifact_provenance_truth_state\].*provenance\.truthState/u);
  });

  it('runs model output through typed adaptation, deterministic geometry, and projection', () => {
    const baseSlide = (index: number) => ({
      title: `Slide ${index + 1}`,
      section: 'Review',
      headline: `Decision ${index + 1}`,
      body: 'Keep the decision bounded and inspectable.',
      bullets: ['Context', 'Action', 'Outcome'],
    });
    const slides = Array.from({ length: 6 }, (_, index) => baseSlide(index));
    slides[1] = {
      ...baseSlide(1),
      artifactSpec: {
        schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
        id: 'activation-chart',
        kind: 'chart',
        narrativeJob: 'Compare activation from baseline to target.',
        provenance,
        payload: {
          labels: ['Baseline', 'Current', 'Target'],
          values: [24, 42, 60],
          unit: '%',
        },
      },
    } as ReturnType<typeof baseSlide> & { artifactSpec: unknown };
    slides[2] = {
      ...baseSlide(2),
      artifactSpec: {
        schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
        id: 'activation-metric',
        kind: 'metric',
        narrativeJob: 'Land the current activation rate.',
        provenance,
        payload: { displayValue: '42%', label: 'Activation rate' },
      },
    } as ReturnType<typeof baseSlide> & { artifactSpec: unknown };
    const built = buildBriefNodeSlide({
      deckId: 'deck-authored-artifact',
      projectId: 'project-authored-artifact',
      title: 'Typed creation path',
      brief: {
        prompt: 'Create a typed activation review.',
        audience: 'Operators',
        purpose: 'choose the next activation experiment',
        successCriteria: ['Compare 24, 42, and 60 percent'],
      },
      themeId: 'quiet-precision',
      rawSpec: { title: 'Typed creation path', narrative: ['Frame', 'Measure'], slides },
      now: 1_700_000_000_000,
    });
    const authoredReceipts = built.spec.slides.flatMap((slide) =>
      slide.authoredArtifactCompilation ? [slide.authoredArtifactCompilation] : [],
    );
    const downstream = compileNodeSlideArtifactSpecs(built.snapshot);

    expect(authoredReceipts.map((receipt) => receipt.kind)).toEqual(['chart', 'generic']);
    expect(built.spec.slides[1]?.authoredArtifactSpec).toMatchObject({
      schemaVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
      kind: 'chart',
      provenance: { sourceRefs: ['brief:success-criteria'] },
    });
    expect(built.snapshot.elements.some((element) => element.kind === 'chart')).toBe(true);
    expect(
      built.snapshot.elements.some(
        (element) => element.role === 'metric' && element.content === '42%',
      ),
    ).toBe(true);
    expect(downstream.receipt.status).toBe('passed');
    const successCriteriaSource = built.snapshot.sources.find(
      (source) => source.title === 'Brief success criteria',
    );
    const chartElement = built.snapshot.elements.find((element) => element.kind === 'chart');
    expect(chartElement?.sourceIds).toEqual([successCriteriaSource?.id]);
    expect(downstream.specs.map((spec) => spec.kind)).toEqual(
      expect.arrayContaining(['chart', 'metric']),
    );
    const authoredChartProjection = downstream.specs.find((spec) => spec.id === 'activation-chart');
    expect(authoredChartProjection).toMatchObject({
      id: 'activation-chart',
      narrativeJob: 'Compare activation from baseline to target.',
      provenance: {
        truthState: 'derived',
        rationale: provenance.rationale,
      },
    });
    expect(
      built.snapshot.elements.find((element) => element.authoredArtifactBinding)
        ?.authoredArtifactBinding,
    ).toMatchObject({
      schemaVersion: 'nodeslide.authored-artifact-binding/v1',
      artifactId: 'activation-chart',
      truthState: 'derived',
    });
  });

  it('allows observed claims only from immutable evidence inventory', () => {
    const brief = {
      prompt: 'Create an evidence review with https://evidence.example.com/capture.png',
      audience: 'Reviewers',
      purpose: 'inspect supplied evidence',
      successCriteria: ['Keep provenance exact'],
    };
    const attachments = [
      { title: 'measurements.csv', format: 'csv' as const, content: 'metric,value\nlatency,42' },
    ];
    const inventory = nodeSlideAuthoredArtifactSourceInventory(brief, attachments);
    const options = nodeSlideAuthoredArtifactValidationOptions(inventory);
    const observed = {
      ...canonicalArtifactFixture('chart'),
      sourceIds: ['attachment:1'],
      provenance: {
        truthState: 'observed' as const,
        rationale: 'Values are present in the immutable uploaded attachment.',
        sourceRefs: ['attachment:1'],
      },
    };

    expect(compileNodeSlideAuthoredArtifact(observed, options).receipt.status).toBe('passed');
    expect(() =>
      compileNodeSlideAuthoredArtifact(
        {
          ...observed,
          sourceIds: ['brief:prompt'],
          provenance: { ...observed.provenance, sourceRefs: ['brief:prompt'] },
        },
        options,
      ),
    ).toThrowError(/\[artifact_provenance_evidence_class\]/u);
  });

  it('returns field-scoped repair issues without inventing missing provenance', () => {
    let failure: unknown;
    try {
      compileNodeSlideAuthoredArtifact({
        schemaVersion: NODESLIDE_CANONICAL_AUTHORED_ARTIFACT_VERSION,
        id: 'broken-chart',
        kind: 'chart',
        narrativeJob: 'Repair only the bad field.',
        claimIds: [],
        sourceIds: ['brief:prompt'],
        provenance: {
          truthState: 'observed',
          sourceRefs: ['brief:prompt'],
        },
        payload: {
          unit: '%',
          xAxis: { labels: ['A', 'B'] },
          yAxis: { min: 0, max: 1 },
          series: [{ id: 's', values: [1] }],
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(NodeSlideAuthoredArtifactValidationError);
    expect((failure as NodeSlideAuthoredArtifactValidationError).issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'artifact_provenance_rationale',
          path: '$.provenance.rationale',
          repair: { operation: 'replace', path: '$.provenance.rationale' },
        }),
        expect.objectContaining({
          code: 'chart_series_alignment',
          path: '$.payload.series[0].values',
        }),
      ]),
    );
  });

  it('preserves authored graph identity, narrative job, and truth through projection', () => {
    const slides = Array.from({ length: 6 }, (_, index) => ({
      title: `Slide ${index + 1}`,
      section: 'Architecture',
      headline: `Step ${index + 1}`,
      body: 'Keep the graph provenance explicit.',
      bullets: ['Bounded', 'Inspectable'],
    }));
    slides[1] = {
      ...slides[1],
      artifactSpec: {
        ...canonicalArtifactFixture('graph'),
        id: 'authored-architecture',
        narrativeJob: 'Explain the exact compiler boundary.',
        sourceIds: ['brief:prompt'],
        provenance: {
          truthState: 'illustrative',
          rationale:
            'This relationship is an explicit design illustration, not observed telemetry.',
          sourceRefs: ['brief:prompt'],
        },
      },
    } as (typeof slides)[number] & { artifactSpec: unknown };
    const built = buildBriefNodeSlide({
      deckId: 'deck-authored-graph',
      projectId: 'project-authored-graph',
      title: 'Authored graph identity',
      brief: {
        prompt: 'Create an architecture deck.',
        audience: 'Engineers',
        purpose: 'review the compiler boundary',
        successCriteria: ['Keep illustration distinct from telemetry'],
      },
      themeId: 'quiet-precision',
      rawSpec: { title: 'Authored graph identity', narrative: ['Boundary'], slides },
      now: 1_700_000_000_000,
    });
    const graphElements = built.snapshot.elements.filter(
      (element) => element.artifactBinding?.artifactId === 'authored-architecture',
    );
    expect(graphElements.length).toBeGreaterThanOrEqual(3);
    expect(
      graphElements.every(
        (element) =>
          element.authoredArtifactBinding?.artifactId === 'authored-architecture' &&
          element.authoredArtifactBinding.truthState === 'illustrative',
      ),
    ).toBe(true);
    expect(
      compileNodeSlideArtifactSpecs(built.snapshot).specs.find(
        (spec) => spec.id === 'authored-architecture',
      ),
    ).toMatchObject({
      narrativeJob: 'Explain the exact compiler boundary.',
      claimIds: ['claim:graph'],
      provenance: {
        truthState: 'illustrative',
        rationale: 'This relationship is an explicit design illustration, not observed telemetry.',
      },
    });
    const targetId = graphElements[0]?.id;
    const tampered = {
      ...built.snapshot,
      elements: built.snapshot.elements.map((element) =>
        element.id === targetId && element.authoredArtifactBinding
          ? {
              ...element,
              authoredArtifactBinding: {
                ...element.authoredArtifactBinding,
                sourceIds: ['source:forged'],
              },
            }
          : element,
      ),
    };
    expect(compileNodeSlideArtifactSpecs(tampered).receipt).toMatchObject({
      status: 'failed',
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'artifact_authored_binding', elementId: targetId }),
      ]),
    });
  });
});
