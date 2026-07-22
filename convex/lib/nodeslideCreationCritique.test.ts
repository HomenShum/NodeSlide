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

interface SlideOverride {
  chart?: { labels: string[]; values: number[]; unit?: string };
  formula?: {
    expression: string;
    display: string;
    variables: Array<{ label: string; value: number }>;
  };
  image?: { altText: string; credit: string };
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
  image: { altText: 'Team photo', credit: 'Company archive' },
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
