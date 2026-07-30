import { describe, expect, it, vi } from 'vitest';
import type { DeckBrief, SlideElement } from '../../shared/nodeslide';
import { findCompressedTextElements } from '../../shared/nodeslideLayoutMetrics';
import { NODESLIDE_AUTHORED_ARTIFACT_VERSION } from './nodeslideAuthoredArtifact';
import {
  collectNodeSlideCreationQualityReport,
  injectNodeSlideSyntheticCreationFault,
  nodeSlideCreationCritiquePromptReport,
  resolveNodeSlideSyntheticCreationFault,
  runNodeSlideCreationCritique,
} from './nodeslideCreationCritique';
import type { NodeSlideProviderResult } from './nodeslideProvider';

/**
 * Scenario: a founder briefs NodeSlide for an investor roadshow deck and
 * explicitly asks for a quarterly revenue chart and the CAC payback formula.
 * The provider's first pass "claims" the evidence in prose but omits the
 * structured chart primitive — exactly the failure mode the self-critique
 * loop exists to catch before the deck is persisted.
 */
const ROADSHOW_BRIEF: DeckBrief = {
  prompt:
    'Roadshow narrative for the seed round. Include a quarterly revenue chart and the CAC payback formula so investors can audit the math.',
  audience: 'seed-stage investors',
  purpose: 'Win a second partner meeting',
  successCriteria: ['Clear ask', 'Auditable evidence'],
};

const WORLD_CUP_BRIEF: DeckBrief = {
  prompt:
    'Create a 6-slide evidence-led deck about the 2022 FIFA World Cup. Include an editable bar chart comparing Mbappé 8, Messi 7, Álvarez 4, and Giroud 4, plus a formula showing 172 ÷ 64 = 2.69 goals per match. The returned slide specification must include a chart primitive.',
  audience: 'football operations leaders',
  purpose: 'Make the tournament evidence auditable',
  successCriteria: ['Six slides', 'Exact scorer comparison', 'Editable formula'],
};

const THEME_ID = 'editorial-signal';
const NOW = 1_700_000_000_000;
const EMBEDDED_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface SlideOverride {
  chart?: { labels: string[]; values: number[]; unit?: string };
  formula?: {
    expression: string;
    display: string;
    variables: Array<{ label: string; value: number }>;
  };
  image?: { altText: string; credit: string; url?: string };
  diagram?: {
    kind: 'process';
    direction: 'horizontal';
    nodes: Array<{ id: string; label: string }>;
    edges: Array<{ from: string; to: string }>;
  };
}

function specSlides(overrides: Record<number, SlideOverride>) {
  return Array.from({ length: 7 }, (_, index) => ({
    title: `Slide ${index + 1}`,
    section: `Act / 0${index + 1}`,
    headline: `Concise headline for act ${index + 1}.`,
    body: 'Short grounded copy that fits its measured block without compression.',
    bullets: index === 2 ? ['Point one', 'Point two', 'Point three'] : ['Point one', 'Point two'],
    ...(index === 1
      ? {
          diagram: {
            kind: 'process' as const,
            direction: 'horizontal' as const,
            nodes: [
              { id: 'brief', label: 'Brief' },
              { id: 'proof', label: 'Proof' },
              { id: 'decision', label: 'Decision' },
            ],
            edges: [
              { from: 'brief', to: 'proof' },
              { from: 'proof', to: 'decision' },
            ],
          },
        }
      : {}),
    ...(overrides[index] ?? {}),
  }));
}

const EXPLICIT_CHART: SlideOverride = {
  chart: { labels: ['Q1', 'Q2', 'Q3', 'Q4'], values: [120, 180, 260, 400], unit: '$K' },
};
const EXPLICIT_FORMULA: SlideOverride = {
  formula: {
    expression: 'payback = CAC / (ARPA * gross margin)',
    display: 'payback = CAC / (ARPA × gross margin)',
    variables: [{ label: 'CAC', value: 1_800 }],
  },
};
const EXPLICIT_IMAGE: SlideOverride = {
  image: {
    altText: 'Team photo',
    credit: 'Company archive',
    url: EMBEDDED_IMAGE,
  },
};

// Pass 1: formula present, but the requested chart never materializes.
// Slide 4 carries an explicit image so it cannot inherit the deterministic
// fallback chart — the deck genuinely ships chartless without a revision.
const FLAWED_SPEC = {
  title: 'Roadshow',
  narrative: ['Open', 'Build', 'Close'],
  plan: ['1. Open', '2. Evidence', '3. Ask'],
  slides: specSlides({ 3: EXPLICIT_FORMULA, 4: EXPLICIT_IMAGE }),
};

// Pass 2 (corrected): the chart primitive lands on the evidence slide.
const CORRECTED_SPEC = {
  ...FLAWED_SPEC,
  slides: specSlides({ 3: EXPLICIT_FORMULA, 4: EXPLICIT_CHART }),
};

// Pass 2 (worsened): the revision drops the formula too.
const WORSE_SPEC = {
  ...FLAWED_SPEC,
  slides: specSlides({ 3: EXPLICIT_IMAGE, 4: EXPLICIT_IMAGE }),
};

const WORLD_CUP_CHART: SlideOverride = {
  chart: {
    labels: ['Mbappé', 'Messi', 'Álvarez', 'Giroud'],
    values: [8, 7, 4, 4],
    unit: 'goals',
  },
};
const UNRELATED_CHART: SlideOverride = {
  chart: { labels: ['S1', 'S2', 'S3'], values: [64, 48, 32], unit: 'matches' },
};
const WORLD_CUP_SPEC = {
  title: 'World Cup evidence',
  narrative: ['Tournament', 'Scorers', 'Rate'],
  plan: ['1. Context', '2. Evidence', '3. Takeaway'],
  slides: specSlides({ 2: EXPLICIT_FORMULA, 3: WORLD_CUP_CHART, 4: UNRELATED_CHART }).slice(0, 6),
};

function reportFor(rawSpec: unknown) {
  return collectNodeSlideCreationQualityReport({
    title: 'Roadshow',
    brief: ROADSHOW_BRIEF,
    themeId: THEME_ID,
    rawSpec,
    now: NOW,
  });
}

describe('NodeSlide creation quality report', () => {
  it('flags a brief-requested chart that never materialized', () => {
    const report = reportFor(FLAWED_SPEC);
    expect(report.missingPrimitives).toContain('chart');
    expect(report.missingPrimitives).not.toContain('formula');
    expect(report.issueCount).toBeGreaterThan(0);
    expect(report.archetypes).toHaveLength(7);
  });

  it('reports clean for a spec that satisfies the brief', () => {
    const report = reportFor(CORRECTED_SPEC);
    expect(report.missingPrimitives).toEqual([]);
    expect(report.validationIssues).toEqual([]);
    expect(report.visualRhythmIssues).toEqual([]);
    expect(report.issueCount).toBe(0);
  });

  it('flags repetitive text-only compositions even when geometry is clean', () => {
    const repetitive = {
      ...CORRECTED_SPEC,
      slides: Array.from({ length: 7 }, (_, index) => ({
        title: `Repeated ${index + 1}`,
        section: `Repeat / 0${index + 1}`,
        headline: 'The same composition repeats.',
        body: 'Geometry can be valid while the deck remains visually monotonous.',
        bullets: ['One point', 'Second point'],
      })),
    };

    const report = reportFor(repetitive);

    expect(report.visualRhythmIssues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'visual_archetype_variety',
        'visual_composition_repeat',
        'visual_text_dominant_run',
      ]),
    );
    expect(report.issueCount).toBeGreaterThan(0);
  });

  it('rejects several dominant visuals on one provider slide', () => {
    const conflicted = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 4 ? { ...slide, image: EXPLICIT_IMAGE.image } : slide,
      ),
    };

    const report = reportFor(conflicted);

    expect(report.visualRhythmIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'multiple_primary_visuals',
          message: expect.stringContaining('chart, image'),
        }),
      ]),
    );
  });

  it('flags visually dominant placeholders and zero-value proxy metrics before publication', () => {
    const riskCommitteeSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) => {
        if (index === 1) {
          return {
            ...slide,
            metric: '0 cohorts',
            metricLabel: 'editability - no compatible plotted metric',
          };
        }
        if (index === 5) {
          return {
            ...slide,
            image: {
              altText: 'Production evidence screenshot placeholder',
              credit: 'No renderable asset supplied',
            },
          };
        }
        if (index === 4) {
          return {
            ...slide,
            artifactSpec: {
              schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
              id: 'unpopulated-outlook',
              kind: 'chart',
              narrativeJob: 'Show an outlook bridge.',
              provenance: {
                truthState: 'missing',
                rationale: 'The referenced filing was not retrieved.',
                sourceRefs: [],
              },
              payload: {
                labels: ['Actual', 'Target'],
                values: [0, 0],
                unit: 'USD',
              },
            },
          };
        }
        if (index === 6) {
          return {
            ...slide,
            metric: 'Typed artifact',
            metricLabel: 'Pair each assumption with its invalidating risk',
          };
        }
        return slide;
      }),
    };

    const report = reportFor(riskCommitteeSpec);
    const codes = report.visualRhythmIssues.map((issue) => issue.code);

    expect(codes).toEqual(
      expect.arrayContaining([
        'visual_metric_without_signal',
        'visual_placeholder_hero',
        'visual_missing_truth_hero',
      ]),
    );
    expect(
      report.visualRhythmIssues.find((issue) => issue.code === 'visual_placeholder_hero'),
    ).toMatchObject({ severity: 'error' });
  });

  it('keeps the visual-logic report bounded during a recurring 100-deck portfolio review', () => {
    const recurringPortfolioSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 5
          ? {
              ...slide,
              image: {
                altText: 'Missing portfolio-company product capture',
                credit: 'Pending portfolio update',
              },
            }
          : slide,
      ),
    };

    const reports = Array.from({ length: 100 }, () => reportFor(recurringPortfolioSpec));

    expect(
      reports.every(
        (report) =>
          report.visualRhythmIssues.length <= 12 &&
          report.visualRhythmIssues.some((issue) => issue.code === 'visual_placeholder_hero'),
      ),
    ).toBe(true);
  }, 15_000);

  it('bounds the prompt report payload', () => {
    const promptReport = nodeSlideCreationCritiquePromptReport(reportFor(FLAWED_SPEC));
    expect(promptReport.length).toBeLessThanOrEqual(4_000);
    expect(JSON.parse(promptReport).missingPrimitives).toEqual(['chart']);
  });
});

describe('NodeSlide creation self-critique loop', () => {
  const loopInput = {
    title: 'Roadshow',
    brief: ROADSHOW_BRIEF,
    themeId: THEME_ID,
    now: NOW,
  };

  it('removes missing portfolio media without erasing the slide thesis', async () => {
    const degradedSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 5
          ? {
              ...slide,
              headline: 'One source of truth: the captured evidence',
              body: 'The visual is a placeholder pending a licensed capture.',
              bullets: [
                'All figures must reconcile to the source',
                'Placeholder image — no captured evidence is claimed',
                'Use the dated filing as the source of record',
              ],
              artifactSpec: {
                schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
                id: 'missing-source-capture',
                kind: 'evidence-media',
                narrativeJob: 'Show the source of record.',
                provenance: {
                  truthState: 'missing',
                  rationale: 'No captured asset was supplied.',
                  sourceRefs: [],
                },
                payload: { altText: 'Source filing screenshot' },
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: degradedSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedSlide = (outcome.spec as typeof degradedSpec).slides[5];

    expect(repairedSlide).not.toHaveProperty('artifactSpec');
    expect(repairedSlide).toHaveProperty('diagram');
    expect(repairedSlide).toMatchObject({
      headline: 'One source of truth: the captured evidence',
      body: expect.stringContaining('source evidence must be captured'),
      bullets: expect.arrayContaining([
        'Use the dated filing as the source of record',
        'Source evidence must be captured before publication',
      ]),
    });
    expect(JSON.stringify(repairedSlide)).not.toMatch(/\bplaceholder\b/i);
  });

  it('quarantines a claimed-supported chart when no evidence backs its figures', async () => {
    const unsupportedChartSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 4
          ? {
              ...slide,
              headline: 'Where the inventory sits today',
              chart: { labels: ['Exposed', 'Conditional', 'Released'], values: [4, 6, 2] },
              artifactSpec: {
                schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
                id: 'unsupported-inventory-chart',
                kind: 'chart',
                narrativeJob: 'Show the current AI inventory by release state.',
                provenance: {
                  truthState: 'supported',
                  rationale: 'Counts are treated as current.',
                  sourceRefs: [],
                },
                payload: {
                  chartType: 'bar',
                  labels: ['Exposed', 'Conditional', 'Released'],
                  series: [{ name: 'Systems', values: [4, 6, 2] }],
                },
              },
            }
          : slide,
      ),
    };

    const outcomes = await Promise.all(
      Array.from({ length: 100 }, () =>
        runNodeSlideCreationCritique({
          ...loopInput,
          brief: {
            ...ROADSHOW_BRIEF,
            prompt:
              'Create a risk committee deck. Do not invent numbers, figures, data, metrics, or outcomes.',
          },
          firstSpec: unsupportedChartSpec,
          providerLive: false,
          requestRevision: vi.fn(),
        }),
      ),
    );
    const repairedSlides = outcomes.map(
      (outcome) => (outcome.spec as typeof unsupportedChartSpec).slides[4],
    );
    const repairedSlide = repairedSlides[0];

    expect(repairedSlide).not.toHaveProperty('artifactSpec');
    expect(repairedSlide).not.toHaveProperty('chart');
    expect(repairedSlide).toMatchObject({
      headline: 'The release gate stays closed until the evidence is verified',
      body: expect.stringContaining('does not invent a quantitative outlook'),
    });
    expect(repairedSlides.every((slide) => !('artifactSpec' in slide) && !('chart' in slide))).toBe(
      true,
    );
  });

  it('preserves distinct narrative jobs when adjacent quantitative slides are quarantined', async () => {
    const unsupportedAdjacentSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 4 || index === 5
          ? {
              ...slide,
              headline:
                index === 4
                  ? 'Residual risk is separate from model performance'
                  : 'Evidence obligations before committee review',
              artifactSpec: {
                schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
                id: `unsupported-${index}`,
                kind: 'chart',
                narrativeJob: index === 4 ? 'Separate risk from performance.' : 'Bind evidence.',
                provenance: {
                  truthState: 'supported',
                  rationale: 'No source references were supplied.',
                  sourceRefs: [],
                },
                payload: {
                  chartType: 'bar',
                  labels: ['Pending', 'Ready'],
                  series: [{ name: 'Systems', values: [4, 6] }],
                },
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      brief: {
        ...ROADSHOW_BRIEF,
        prompt: 'Create a risk committee deck. Do not invent numbers, figures, or metrics.',
      },
      firstSpec: unsupportedAdjacentSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repaired = (outcome.spec as typeof unsupportedAdjacentSpec).slides;

    expect(repaired[4]?.headline).toBe(
      'The release gate stays closed until the evidence is verified',
    );
    expect(repaired[5]?.headline).toBe('Evidence obligations before committee review');
    expect(repaired[5]?.bullets).toEqual([
      'Define the evidence owner',
      'Bind each claim to a source',
      'Record the unresolved risk at the gate',
    ]);
  });

  it('deterministically removes unusable hero primitives when the provider path is degraded', async () => {
    const degradedSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 4
          ? {
              ...slide,
              chart: undefined,
              metric: '0 cohorts',
              metricLabel: 'no compatible plotted metric',
              image: {
                altText: 'Missing production capture',
                credit: 'Pending',
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: degradedSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedSlides = (outcome.spec as typeof degradedSpec).slides;

    expect(repairedSlides[4]).not.toHaveProperty('metric');
    expect(repairedSlides[4]).not.toHaveProperty('metricLabel');
    expect(repairedSlides[4]).not.toHaveProperty('image');
    expect(repairedSlides[4]).toHaveProperty('diagram.kind', 'architecture');
    expect(repairedSlides[4]).toHaveProperty('diagram.edges.0.label', 'supports');
    expect(repairedSlides[4]).toMatchObject({
      headline: 'Concise headline for act 5.',
      body: expect.stringMatching(/source evidence must be captured/iu),
    });
    expect(JSON.stringify(repairedSlides[4])).not.toMatch(/\bplaceholder\b/i);
    expect(outcome.summary).toContain('deterministic visual-logic repair corrected 2');
  });

  it('keeps a visual-slide briefing from painting body copy into its decision bullets', async () => {
    const longBody =
      'The filing poses one tension: is customer and revenue momentum converting into lasting margin structure? This briefing tests that claim before asking leadership for two accountable decisions. The remaining detail belongs in the decision bullets and speaker notes.';
    const crowdedSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 0
          ? {
              ...slide,
              body: longBody,
              metric: 'Q4/FY2025',
              metricLabel: 'Reporting period under review',
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: crowdedSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedBody = (outcome.spec as typeof crowdedSpec).slides[0].body;

    expect(repairedBody.length).toBeLessThanOrEqual(220);
    expect(repairedBody).toMatch(/[.!?]$/u);
    expect(repairedBody).not.toContain('…');
    expect(repairedBody).toContain('two accountable decisions');
    expect(repairedBody).not.toContain('speaker notes');
  });

  it('orders a board evidence pipeline from source through extraction to decision', async () => {
    const reversedSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 2
          ? {
              ...slide,
              diagram: {
                kind: 'process',
                direction: 'horizontal',
                nodes: [
                  { id: 'validate', label: 'Validate claims' },
                  { id: 'label', label: 'Label evidence tier' },
                  { id: 'extract', label: 'Extract figures' },
                  { id: 'source', label: 'SEC-filed source deck' },
                  { id: 'decision', label: 'Board decision' },
                ],
                edges: [
                  { from: 'validate', to: 'label' },
                  { from: 'label', to: 'extract' },
                  { from: 'extract', to: 'source' },
                  { from: 'source', to: 'decision' },
                ],
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: reversedSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repaired = (outcome.spec as typeof reversedSpec).slides[2].diagram;

    expect(repaired.nodes.map((node) => node.id)).toEqual([
      'source',
      'extract',
      'validate',
      'label',
      'decision',
    ]);
    expect(repaired.edges).toEqual([
      { from: 'source', to: 'extract', label: 'then' },
      { from: 'extract', to: 'validate', label: 'then' },
      { from: 'validate', to: 'label', label: 'then' },
      { from: 'label', to: 'decision', label: 'then' },
    ]);
  });

  it('orders a district review close from decision to owner to checkpoint', async () => {
    const reversedClose = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 5
          ? {
              ...slide,
              bullets: [
                "03 Checkpoint: first full-cycle run at next month's review.",
                '02 Owner: district programme manager and M&E officer.',
                '01 Decision: adopt the verify–visualize–decide–follow-up loop.',
              ],
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: reversedClose,
      providerLive: false,
      requestRevision: vi.fn(),
    });

    expect((outcome.spec as typeof reversedClose).slides[5].bullets).toEqual([
      'Decision: adopt the verify–visualize–decide–follow-up loop.',
      'Owner: district programme manager and M&E officer.',
      "Checkpoint: first full-cycle run at next month's review.",
    ]);
  });

  it('removes a provider comparison that cannot plot two cohorts instead of minting a zero proxy', async () => {
    const degradedSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 1
          ? {
              ...slide,
              artifactSpec: {
                schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
                id: 'empty-comparison',
                kind: 'comparison',
                narrativeJob: 'Compare operating outcomes.',
                provenance: {
                  truthState: 'missing',
                  rationale: 'The filing values were not retrieved.',
                  sourceRefs: [],
                },
                payload: {
                  metrics: [{ id: 'margin', label: 'Margin', unit: '%' }],
                  cohorts: [
                    { id: 'actual', label: 'Actual', values: {} },
                    { id: 'target', label: 'Target', values: {} },
                  ],
                },
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: degradedSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedSlide = (outcome.spec as typeof degradedSpec).slides[1];

    expect(repairedSlide).not.toHaveProperty('artifactSpec');
    expect(repairedSlide).not.toHaveProperty('metric');
    expect(JSON.stringify(outcome.spec)).not.toContain('0 cohorts');
  });

  it('does not mistake incidental brief numbers for evidence behind an illustrative risk matrix', async () => {
    const riskBrief = {
      ...ROADSHOW_BRIEF,
      prompt:
        'Create a 7-slide NIST AI RMF 1.0 deck. Preserve all four functions and show a risk matrix. Do not invent regulatory obligations.',
    };
    const degradedSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 4
          ? {
              ...slide,
              headline: 'Illustrative residual-risk placement',
              body: 'Plotted on likelihood and impact axes, the candidate and two comparators sit in the amber band after controls.',
              bullets: [
                'Candidate: high impact',
                'Comparator A: strong controls',
                'Comparator B: bias evidence pending',
              ],
              artifactSpec: {
                schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
                id: 'illustrative-risk-matrix',
                kind: 'comparison',
                narrativeJob: 'Place three systems on a risk matrix.',
                provenance: {
                  truthState: 'illustrative',
                  rationale: 'No measured system values were supplied.',
                  sourceRefs: [],
                },
                payload: {
                  metrics: [
                    { id: 'likelihood', label: 'Likelihood' },
                    { id: 'impact', label: 'Impact' },
                  ],
                  cohorts: [
                    { id: 'candidate', label: 'Candidate', values: { likelihood: 4, impact: 1 } },
                    { id: 'peer-a', label: 'Peer A', values: { likelihood: 7, impact: 4 } },
                  ],
                },
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      brief: riskBrief,
      firstSpec: degradedSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedSlide = (outcome.spec as typeof degradedSpec).slides[4];

    expect(repairedSlide).not.toHaveProperty('artifactSpec');
    expect(repairedSlide).toHaveProperty('diagram');
    expect(JSON.stringify(repairedSlide)).not.toMatch(/\b(?:plotted|axes|amber band)\b/i);
  });

  it('repairs a chartless slide that still claims viewers can see a plotted risk matrix', async () => {
    const chartlessSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 4
          ? {
              title: slide.title,
              section: slide.section,
              headline: 'Illustrative residual-risk placement',
              body: 'Plotted on likelihood and impact axes, the candidate and two comparators sit in the amber band after controls.',
              bullets: [
                'Candidate: high impact',
                'Comparator A: strong controls',
                'Comparator B: bias evidence pending',
              ],
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      brief: {
        ...ROADSHOW_BRIEF,
        prompt:
          'Create a 7-slide NIST AI RMF 1.0 deck. Preserve all four functions and show a risk matrix.',
      },
      firstSpec: chartlessSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedSlide = (outcome.spec as typeof chartlessSpec).slides[4];

    expect(repairedSlide).toHaveProperty('diagram');
    expect(JSON.stringify(repairedSlide)).not.toMatch(/\b(?:plotted|axes|amber band)\b/i);
  });

  it('removes chart-dependent copy when a referenced filing was not retrieved', async () => {
    const degradedSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 4
          ? {
              ...slide,
              headline: 'The question is the slope of margin',
              body: 'This chart is an illustrative placeholder showing the expected shape.',
              bullets: ['The chart carries the argument', 'Replace every value before publish'],
              chart: { labels: ['Q1', 'Q2'], values: [0, 0] },
              artifactSpec: {
                schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
                id: 'unretrieved-filing-chart',
                kind: 'chart',
                narrativeJob: 'Show margin discipline.',
                provenance: {
                  truthState: 'missing',
                  rationale: 'The referenced filing was not retrieved.',
                  sourceRefs: [],
                },
                payload: { labels: ['Q1', 'Q2'], values: [0, 0], unit: '%' },
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: degradedSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedSlide = (outcome.spec as typeof degradedSpec).slides[4];

    expect(repairedSlide).not.toHaveProperty('artifactSpec');
    expect(repairedSlide).not.toHaveProperty('chart');
    expect(JSON.stringify(repairedSlide)).not.toMatch(/\b(?:chart|shape|placeholder)\b/i);
    expect(repairedSlide).toMatchObject({
      headline: 'The release gate stays closed until the evidence is verified',
      body: expect.stringContaining('does not invent a quantitative outlook'),
    });
  });

  it('quarantines an empty generic artifact instead of promoting Typed artifact to a hero', async () => {
    const degradedSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 6
          ? {
              ...slide,
              artifactSpec: {
                schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
                id: 'empty-generic',
                kind: 'generic',
                narrativeJob: 'Pair assumptions with invalidating risks.',
                provenance: {
                  truthState: 'missing',
                  rationale: 'No display value was supplied.',
                  sourceRefs: [],
                },
                payload: { label: 'Assumption review' },
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: degradedSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });

    expect((outcome.spec as typeof degradedSpec).slides[6]).not.toHaveProperty('artifactSpec');
    expect(JSON.stringify(outcome.spec)).not.toContain('Typed artifact');
  });

  it('keeps a risk committee brief honest when an unsupplied illustrative trajectory is quarantined', async () => {
    const riskCommitteeBrief = {
      ...ROADSHOW_BRIEF,
      prompt:
        'Create a seven-slide NIST AI RMF risk committee deck. Do not invent regulatory obligations.',
    };
    const degradedSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 4
          ? {
              ...slide,
              headline: 'Illustrative trajectory: Adjusted EBITDA margin path',
              body: 'The chart is an illustrative shape of the discipline story.',
              bullets: [
                'Replace values before publish',
                'Reconcile the metric',
                'The shape carries the argument',
              ],
              chart: { labels: ['Q1', 'Q2', 'Outlook'], values: [0.8, 1.1, 1.5] },
              artifactSpec: {
                schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
                id: 'illustrative-outlook',
                kind: 'chart',
                narrativeJob: 'Show the medium-term outlook.',
                provenance: {
                  truthState: 'illustrative',
                  rationale: 'The filing values were not retrieved.',
                  sourceRefs: [],
                },
                payload: {
                  labels: ['Q1', 'Q2', 'Outlook'],
                  values: [0.8, 1.1, 1.5],
                  unit: 'normalized',
                },
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      brief: riskCommitteeBrief,
      firstSpec: degradedSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedSlide = (outcome.spec as typeof degradedSpec).slides[4];

    expect(repairedSlide).not.toHaveProperty('artifactSpec');
    expect(repairedSlide).not.toHaveProperty('chart');
    expect(JSON.stringify(outcome.spec)).not.toContain('illustrative-outlook');
    expect(JSON.stringify(repairedSlide)).not.toMatch(/\b(?:chart|shape|trajectory)\b/i);
    expect(repairedSlide).toMatchObject({
      headline: 'The release gate stays closed until the evidence is verified',
      body: expect.stringContaining('does not invent a quantitative outlook'),
      bullets: expect.arrayContaining([
        'Hold the release decision',
        'Verify the source, owner, and reconciliation',
      ]),
    });
  });

  it('preserves the slide thesis when a grounded symbolic visual survives quarantine', async () => {
    const riskSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 4
          ? {
              ...slide,
              headline: 'Residual risk must be scored separately from performance',
              bullets: [
                'Performance answers whether the model works',
                'Residual risk answers what harm remains',
                'The release gate weighs both',
              ],
              formula: {
                expression: 'residual_risk = likelihood * impact * remaining_control_gap',
                display: 'Residual Risk = Likelihood × Impact × Remaining Control Gap',
                variables: [],
              },
              chart: { labels: ['Initial', 'Gate'], values: [20, 9] },
              artifactSpec: {
                schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
                id: 'illustrative-risk-trajectory',
                kind: 'chart',
                narrativeJob: 'Show residual risk moving toward tolerance.',
                provenance: {
                  truthState: 'illustrative',
                  rationale: 'The values demonstrate the metaphor only.',
                  sourceRefs: [],
                },
                payload: {
                  labels: ['Initial', 'Gate'],
                  values: [20, 9],
                },
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      brief: {
        ...ROADSHOW_BRIEF,
        prompt: 'Create a NIST AI RMF release decision deck.',
      },
      firstSpec: riskSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedSlide = (outcome.spec as typeof riskSpec).slides[4];

    expect(repairedSlide).not.toHaveProperty('artifactSpec');
    expect(repairedSlide).not.toHaveProperty('chart');
    expect(repairedSlide).toHaveProperty('formula');
    expect(repairedSlide.headline).toBe('Residual risk must be scored separately from performance');
    expect(JSON.stringify(repairedSlide)).not.toMatch(/\b(?:20|9)\b/u);
  });

  it('preserves the closing decision when its invented numeric hero is quarantined', async () => {
    const decisionSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 6
          ? {
              ...slide,
              title: 'The Release Decision',
              section: 'Decide',
              headline: 'Adopt the gate, name the owner, set the checkpoint.',
              bullets: [
                'Adopt the continuous release gate',
                'Name the accountable owner',
                'Complete the first checkpoint within 90 days',
              ],
              chart: { labels: ['Now', 'Target'], values: [20, 9] },
              artifactSpec: {
                schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
                id: 'illustrative-decision-score',
                kind: 'chart',
                narrativeJob: 'Close on the release decision.',
                provenance: {
                  truthState: 'illustrative',
                  rationale: 'The values are not measured.',
                  sourceRefs: [],
                },
                payload: {
                  labels: ['Now', 'Target'],
                  values: [20, 9],
                },
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      brief: {
        ...ROADSHOW_BRIEF,
        prompt: 'Create a NIST AI RMF release decision deck.',
      },
      firstSpec: decisionSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedSlide = (outcome.spec as typeof decisionSpec).slides[6];

    expect(repairedSlide).not.toHaveProperty('artifactSpec');
    expect(repairedSlide).not.toHaveProperty('chart');
    expect(repairedSlide).toHaveProperty('diagram');
    expect(repairedSlide.headline).toBe('Adopt the gate, name the owner, set the checkpoint.');
    expect(JSON.stringify(repairedSlide)).not.toMatch(/\b(?:20|9|90)\b/u);
    expect(repairedSlide.bullets).toContain(
      'Set and source the checkpoint timing before publication',
    );
  });

  it('removes an invented score formula whose filing inputs are still pending', async () => {
    const strictBoardBrief = {
      ...ROADSHOW_BRIEF,
      prompt: `${ROADSHOW_BRIEF.prompt} Never invent missing numbers.`,
    };
    const degradedSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 6
          ? {
              ...slide,
              headline: 'A transparent score leadership can audit',
              body: 'Leadership can score growth and discipline equally.',
              bullets: ['Inputs come from the filing', 'Equal weights are a governance choice'],
              formula: {
                expression: '0.5*g + 0.5*m',
                display: 'Quality Score = 0.5 × revenue growth + 0.5 × margin',
                variables: [
                  { label: 'Revenue growth (pending filing)', value: 0 },
                  { label: 'Margin (pending filing)', value: 0 },
                ],
              },
            }
          : slide,
      ),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      brief: strictBoardBrief,
      firstSpec: degradedSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedSlide = (outcome.spec as typeof degradedSpec).slides[6];

    expect(repairedSlide).not.toHaveProperty('formula');
    expect(JSON.stringify(repairedSlide)).not.toContain('0.5');
    expect(repairedSlide).toMatchObject({
      headline: 'The release gate stays closed until the evidence is verified',
      body: expect.stringContaining('does not invent a quantitative outlook'),
    });
  });

  it('removes unsupplied formula and checkpoint quantities from a governance decision', async () => {
    const governanceSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) => {
        if (index === 3) {
          return {
            ...slide,
            formula: {
              expression: 'residual_risk = likelihood * impact',
              display: 'Residual Risk = 3 × 4 = 12 (tolerance ≤ 9)',
              variables: [
                { label: 'Likelihood', value: 3 },
                { label: 'Impact', value: 4 },
                { label: 'Tolerance', value: 9 },
              ],
            },
          };
        }
        if (index === 6) {
          return {
            ...slide,
            headline: 'Adopt the gate, name the owner, set the checkpoint.',
            bullets: [
              'Adopt the continuous release gate',
              'Name the accountable owner',
              'Complete the first full-inventory review within 90 days',
            ],
            metric: '90',
            metricLabel: 'days to first full-inventory gate review',
          };
        }
        return slide;
      }),
    };

    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      brief: {
        ...ROADSHOW_BRIEF,
        prompt:
          'Create a seven-slide NIST AI RMF risk committee deck. Do not invent regulatory obligations.',
      },
      firstSpec: governanceSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repairedFormulaSlide = (outcome.spec as typeof governanceSpec).slides[3];
    const repairedDecisionSlide = (outcome.spec as typeof governanceSpec).slides[6];

    expect(repairedFormulaSlide).not.toHaveProperty('formula');
    expect(repairedFormulaSlide).toMatchObject({
      headline: 'The release gate stays closed until the evidence is verified',
    });
    expect(repairedDecisionSlide).not.toHaveProperty('metric');
    expect(repairedDecisionSlide).not.toHaveProperty('metricLabel');
    expect(repairedDecisionSlide.headline).toBe(
      'Adopt the gate, name the owner, set the checkpoint.',
    );
    expect(JSON.stringify(repairedDecisionSlide)).not.toMatch(/\b90\b/u);
    expect(repairedDecisionSlide.bullets).toContain(
      'Set and source the checkpoint timing before publication',
    );
  });

  it('removes unsourced timing from decision prose and emits three distinct decision bullets', async () => {
    const decisionSpec = {
      ...CORRECTED_SPEC,
      slides: CORRECTED_SPEC.slides.map((slide, index) =>
        index === 6
          ? {
              ...slide,
              headline: 'Release, release with controls, or hold — signed and dated.',
              body: 'The chief risk officer signs the decision and the review clock starts immediately. Next checkpoint: first governed review within 30 days.',
              bullets: [
                'Decision owner: chief risk officer, countersigned by general counsel',
                'Decision owner: chief risk officer, countersigned by general counsel',
                'Set and source the checkpoint timing before publication',
              ],
            }
          : slide,
      ),
    };
    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      brief: {
        ...ROADSHOW_BRIEF,
        prompt: 'Create a NIST AI RMF risk committee deck. Do not invent regulatory obligations.',
      },
      firstSpec: decisionSpec,
      providerLive: false,
      requestRevision: vi.fn(),
    });
    const repaired = (outcome.spec as typeof decisionSpec).slides[6];

    expect(repaired?.body).not.toMatch(/\b(?:30 days|immediately)\b/iu);
    expect(new Set(repaired?.bullets).size).toBe(3);
    expect(repaired?.bullets[0]).toBe('Record release, release with controls, or hold');
  });

  it('runs exactly one revision and adopts a corrected pass 2', async () => {
    const requestRevision = vi.fn(
      async (promptReport: string): Promise<NodeSlideProviderResult> => {
        expect(promptReport).toContain('"missingPrimitives":["chart"]');
        return {
          ok: true,
          value: CORRECTED_SPEC,
          telemetry: {
            provider: 'openrouter',
            model: 'kimi-k3',
            costMicroUsd: 20,
            inputTokens: 900,
            outputTokens: 1_400,
          },
        };
      },
    );
    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: FLAWED_SPEC,
      providerLive: true,
      requestRevision,
    });
    expect(requestRevision).toHaveBeenCalledTimes(1);
    expect(outcome.passes).toBe(2);
    expect(outcome.decision).toBe('revised');
    expect(outcome.spec).toBe(CORRECTED_SPEC);
    expect(outcome.summary).toMatch(/^2 passes: revised to fix missing chart/);
    expect(outcome.chosenReport?.issueCount).toBe(0);
    expect(outcome.firstReport?.missingPrimitives).toEqual(['chart']);
  });

  it('keeps pass 1 when the revision worsens the deck', async () => {
    const requestRevision = vi.fn(
      async (): Promise<NodeSlideProviderResult> => ({
        ok: true,
        value: WORSE_SPEC,
        telemetry: {
          provider: 'openrouter',
          model: 'kimi-k3',
          costMicroUsd: 20,
          inputTokens: 900,
          outputTokens: 1_400,
        },
      }),
    );
    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: FLAWED_SPEC,
      providerLive: true,
      requestRevision,
    });
    expect(requestRevision).toHaveBeenCalledTimes(1);
    expect(outcome.passes).toBe(2);
    expect(outcome.decision).toBe('revision_not_better');
    expect(outcome.spec).toBe(FLAWED_SPEC);
    expect(outcome.summary).toContain('kept pass 1');
  });

  it('keeps pass 1 when the revision call fails', async () => {
    const requestRevision = vi.fn(
      async (): Promise<NodeSlideProviderResult> => ({
        ok: false,
        reason: 'provider timeout',
      }),
    );
    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: FLAWED_SPEC,
      providerLive: true,
      requestRevision,
    });
    expect(outcome.decision).toBe('revision_failed');
    expect(outcome.spec).toBe(FLAWED_SPEC);
    expect(outcome.summary).toContain('revision call failed (provider timeout)');
    expect(outcome.summary).toContain('kept pass 1');
  });

  it('keeps pass 1 when the revision request throws', async () => {
    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: FLAWED_SPEC,
      providerLive: true,
      requestRevision: async () => {
        throw new Error('socket hang up');
      },
    });
    expect(outcome.decision).toBe('revision_failed');
    expect(outcome.spec).toBe(FLAWED_SPEC);
    expect(outcome.summary).toContain('socket hang up');
  });

  it('states one clean pass when pass 1 has no issues', async () => {
    const requestRevision = vi.fn();
    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: CORRECTED_SPEC,
      providerLive: true,
      requestRevision,
    });
    expect(requestRevision).not.toHaveBeenCalled();
    expect(outcome.passes).toBe(1);
    expect(outcome.decision).toBe('clean');
    expect(outcome.summary).toBe('1 pass, clean');
  });

  it('skips the loop entirely on the deterministic route', async () => {
    const requestRevision = vi.fn();
    const outcome = await runNodeSlideCreationCritique({
      ...loopInput,
      firstSpec: FLAWED_SPEC,
      providerLive: false,
      requestRevision,
    });
    expect(requestRevision).not.toHaveBeenCalled();
    expect(outcome.passes).toBe(1);
    expect(outcome.decision).toBe('skipped');
    expect(outcome.summary).toContain('self-critique loop skipped');
  });
});

describe('development-only creation fault injection', () => {
  it('fails closed unless both the runtime and allowlisted flag opt in', () => {
    expect(
      resolveNodeSlideSyntheticCreationFault({
        runtimeEnvironment: 'production',
        faultFlag: 'drop_requested_chart',
      }),
    ).toBeNull();
    expect(
      resolveNodeSlideSyntheticCreationFault({
        runtimeEnvironment: 'development',
        faultFlag: 'unknown',
      }),
    ).toBeNull();
    expect(
      resolveNodeSlideSyntheticCreationFault({
        runtimeEnvironment: 'development',
        faultFlag: 'drop_requested_chart',
      }),
    ).toBe('drop_requested_chart');
  });

  it('removes a requested provider chart and labels the synthetic origin', async () => {
    const injected = injectNodeSlideSyntheticCreationFault({
      rawSpec: CORRECTED_SPEC,
      brief: ROADSHOW_BRIEF,
      fault: 'drop_requested_chart',
    });
    expect(injected.applied).toBe(true);
    expect(injected.traceLabel).toContain('Development-only synthetic fault');
    expect(injected.requiredCharts).toEqual([EXPLICIT_CHART.chart]);
    expect(reportFor(injected.spec).missingPrimitives).toEqual(['chart']);

    const outcome = await runNodeSlideCreationCritique({
      title: 'Roadshow',
      brief: ROADSHOW_BRIEF,
      themeId: THEME_ID,
      now: NOW,
      firstSpec: injected.spec,
      requiredCharts: injected.requiredCharts,
      providerLive: true,
      requestRevision: async () => ({
        ok: true,
        value: CORRECTED_SPEC,
        telemetry: {
          provider: 'openrouter',
          model: 'kimi-k3',
          costMicroUsd: 20,
          inputTokens: 900,
          outputTokens: 1_400,
        },
      }),
    });
    expect(outcome.decision).toBe('revised');
    expect(outcome.passes).toBe(2);
    expect(outcome.chosenReport?.issueCount).toBe(0);
  });

  it('requires the exact requested scorer series even when another chart exists', async () => {
    const injected = injectNodeSlideSyntheticCreationFault({
      rawSpec: WORLD_CUP_SPEC,
      brief: WORLD_CUP_BRIEF,
      fault: 'drop_requested_chart',
    });
    expect(injected.applied).toBe(true);
    expect(injected.requiredCharts).toEqual([
      {
        labels: ['Mbappé', 'Messi', 'Álvarez', 'Giroud'],
        values: [8, 7, 4, 4],
      },
    ]);
    expect(
      (injected.spec as typeof WORLD_CUP_SPEC).slides.some(
        (slide) => slide.chart?.labels.join('/') === 'S1/S2/S3',
      ),
    ).toBe(true);

    const firstReport = collectNodeSlideCreationQualityReport({
      title: 'World Cup evidence',
      brief: WORLD_CUP_BRIEF,
      themeId: THEME_ID,
      rawSpec: injected.spec,
      requiredCharts: injected.requiredCharts,
      now: NOW,
    });
    expect(firstReport.missingPrimitives).toEqual(['chart']);
    expect(firstReport.missingRequiredCharts).toEqual(injected.requiredCharts);
    expect(JSON.parse(nodeSlideCreationCritiquePromptReport(firstReport))).toMatchObject({
      missingPrimitives: ['chart'],
      missingRequiredCharts: injected.requiredCharts,
    });

    const requestRevision = vi.fn(
      async (): Promise<NodeSlideProviderResult> => ({
        ok: true,
        value: WORLD_CUP_SPEC,
        telemetry: {
          provider: 'openrouter',
          model: 'kimi-k3',
          costMicroUsd: 20,
          inputTokens: 900,
          outputTokens: 1_400,
        },
      }),
    );
    const outcome = await runNodeSlideCreationCritique({
      firstSpec: injected.spec,
      title: 'World Cup evidence',
      brief: WORLD_CUP_BRIEF,
      themeId: THEME_ID,
      now: NOW,
      requiredCharts: injected.requiredCharts,
      providerLive: true,
      requestRevision,
    });
    expect(requestRevision).toHaveBeenCalledTimes(1);
    expect(outcome.decision).toBe('revised');
    expect(outcome.passes).toBe(2);
    expect(outcome.firstReport?.missingRequiredCharts).toEqual(injected.requiredCharts);
    expect(outcome.chosenReport?.missingRequiredCharts).toEqual([]);
  });

  it('rejects a second pass that keeps only the unrelated fallback chart', async () => {
    const injected = injectNodeSlideSyntheticCreationFault({
      rawSpec: WORLD_CUP_SPEC,
      brief: WORLD_CUP_BRIEF,
      fault: 'drop_requested_chart',
    });
    const outcome = await runNodeSlideCreationCritique({
      firstSpec: injected.spec,
      title: 'World Cup evidence',
      brief: WORLD_CUP_BRIEF,
      themeId: THEME_ID,
      now: NOW,
      requiredCharts: injected.requiredCharts,
      providerLive: true,
      requestRevision: async () => ({
        ok: true,
        value: injected.spec,
        telemetry: {
          provider: 'openrouter',
          model: 'kimi-k3',
          costMicroUsd: 20,
          inputTokens: 900,
          outputTokens: 1_400,
        },
      }),
    });
    expect(outcome.decision).toBe('revision_not_better');
    expect(outcome.chosenReport?.missingRequiredCharts).toEqual(injected.requiredCharts);
  });

  it('records a requested but inapplicable fault without changing the spec', () => {
    const withoutChartRequest: DeckBrief = {
      ...ROADSHOW_BRIEF,
      prompt: 'Roadshow narrative with a concise formula.',
    };
    const injected = injectNodeSlideSyntheticCreationFault({
      rawSpec: CORRECTED_SPEC,
      brief: withoutChartRequest,
      fault: 'drop_requested_chart',
    });
    expect(injected.applied).toBe(false);
    expect(injected.spec).toBe(CORRECTED_SPEC);
    expect(injected.traceLabel).toContain('not applicable');
  });
});

describe('typed authored artifact critique repair', () => {
  it('reports an unknown canonical source and accepts a materializable revision', async () => {
    const invalid = structuredClone(CORRECTED_SPEC);
    const firstSlide = invalid.slides[0] as unknown as Record<string, unknown>;
    firstSlide['artifactSpec'] = {
      schemaVersion: NODESLIDE_AUTHORED_ARTIFACT_VERSION,
      id: 'unknown-source-metric',
      kind: 'metric',
      narrativeJob: 'Land a sourced metric.',
      provenance: {
        truthState: 'observed',
        rationale: 'Provider claimed an unknown source.',
        sourceRefs: ['source:invented'],
      },
      payload: { displayValue: '42%', label: 'Activation' },
    };
    const firstReport = collectNodeSlideCreationQualityReport({
      title: 'Roadshow',
      brief: ROADSHOW_BRIEF,
      themeId: THEME_ID,
      rawSpec: invalid,
      now: NOW,
    });

    expect(firstReport).toMatchObject({
      materializationFailed: true,
      validationIssues: [expect.objectContaining({ code: 'artifact_provenance_evidence_class' })],
    });
    expect(nodeSlideCreationCritiquePromptReport(firstReport)).toContain(
      'artifact_provenance_evidence_class',
    );

    const outcome = await runNodeSlideCreationCritique({
      firstSpec: invalid,
      title: 'Roadshow',
      brief: ROADSHOW_BRIEF,
      themeId: THEME_ID,
      now: NOW,
      providerLive: true,
      requestRevision: async () => ({
        ok: true,
        value: CORRECTED_SPEC,
        telemetry: {
          provider: 'openrouter',
          model: 'kimi-k3',
          costMicroUsd: 20,
          inputTokens: 900,
          outputTokens: 1_400,
        },
      }),
    });

    expect(outcome.decision).toBe('revised');
    expect(outcome.spec).toBe(CORRECTED_SPEC);
    expect(outcome.chosenReport?.materializationFailed).toBe(false);
  });
});

describe('compressed text detection', () => {
  const textElement = (content: string, height: number): SlideElement => ({
    id: 'element_test_copy',
    slideId: 'slide_test',
    name: 'Body copy',
    kind: 'text',
    bbox: { x: 0.07, y: 0.4, width: 0.4, height },
    rotation: 0,
    content,
    style: { fontSize: 18, lineHeight: 1.5 },
    sourceIds: [],
    locked: false,
    exportCapabilities: ['web_native'],
    version: 1,
  });

  it('flags copy squeezed well below its measured height', () => {
    const dense = textElement(
      'A very long block of narrative copy that wraps across many lines and plainly cannot fit inside the sliver of vertical space the layout granted it, because the stack compressor squeezed the block to preserve the footer band.',
      0.05,
    );
    const flagged = findCompressedTextElements([dense]);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]).toMatchObject({ slideId: 'slide_test', elementName: 'Body copy' });
    expect(flagged[0]?.measuredHeight).toBeGreaterThan(flagged[0]?.allottedHeight ?? 0);
  });

  it('ignores copy that fits its granted box', () => {
    expect(findCompressedTextElements([textElement('Fits fine.', 0.2)])).toEqual([]);
  });
});
