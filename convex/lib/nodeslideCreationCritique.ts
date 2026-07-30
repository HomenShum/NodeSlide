import {
  type DeckBrief,
  type DeckSnapshot,
  isNodeSlideEmbeddedRasterDataUrl,
} from '../../shared/nodeslide';
import type { NodeSlideDataAttachment } from '../../shared/nodeslideAttachments';
import { findCompressedTextElements } from '../../shared/nodeslideLayoutMetrics';
import type { NodeSlideProviderResult } from './nodeslideProvider';
import { type NodeSlidePlannedChart, buildBriefNodeSlide } from './nodeslideSeed';
import { validateNodeSlideSnapshot } from './nodeslideValidation';

/**
 * Bounded creation self-critique: materialize a provider spec in memory, run
 * the real validator and layout-quality signals over the result, and (at most
 * once) ask the provider to correct the concrete issues found. Pure except for
 * the caller-supplied revision request, so it stays fully unit-testable.
 */

const MAX_REPORT_VALIDATION_ISSUES = 12;
const MAX_REPORT_COMPRESSED_SLIDES = 8;
const MAX_REPORT_PROMPT_BYTES = 4_000;

export type NodeSlideBriefPrimitive = 'chart' | 'diagram' | 'formula' | 'image';
export type NodeSlideSyntheticCreationFault = 'drop_requested_chart';

export interface NodeSlideSyntheticFaultResult {
  spec: unknown;
  fault: NodeSlideSyntheticCreationFault;
  applied: boolean;
  /** Canonical chart payloads removed from pass 1 and required in a valid repair. */
  requiredCharts: NodeSlidePlannedChart[];
  traceLabel: string;
}

export interface NodeSlideCreationQualityIssue {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  slideId?: string;
}

export interface NodeSlideCreationQualityReport {
  /** Total count of concrete signals; 0 means the spec materialized clean. */
  issueCount: number;
  validationIssues: NodeSlideCreationQualityIssue[];
  compressedSlides: Array<{ slideIndex: number; elementName: string }>;
  /** Brief-requested primitives absent from every materialized slide. */
  missingPrimitives: NodeSlideBriefPrimitive[];
  /** Exact brief-requested chart series still absent after materialization. */
  missingRequiredCharts: NodeSlidePlannedChart[];
  /** Archetype per slide, in deck order, for monotony inspection downstream. */
  archetypes: string[];
  /** Deck-level visual grammar defects that geometry-only validation cannot see. */
  visualRhythmIssues: NodeSlideCreationQualityIssue[];
  /** True when typed artifact or materialization validation blocked snapshot construction. */
  materializationFailed: boolean;
}

export interface NodeSlideCreationCritiqueInput {
  title: string;
  brief: DeckBrief;
  themeId: string;
  rawSpec: unknown;
  now: number;
  attachments?: readonly NodeSlideDataAttachment[];
  /**
   * Optional exact chart semantics that must survive materialization. This is
   * used by the development-only repair proof so an unrelated fallback chart
   * cannot satisfy the deliberately removed requested chart.
   */
  requiredCharts?: readonly NodeSlidePlannedChart[];
}

const PRIMITIVE_REQUESTS: ReadonlyArray<[NodeSlideBriefPrimitive, RegExp]> = [
  ['chart', /\bcharts?\b|\bgraphs?\b/u],
  ['diagram', /\bdiagrams?\b|\barchitectures?\b|\bprocess(?:es)?\b|\btimelines?\b|\bflows?\b/u],
  ['formula', /\bformulas?\b|\bequations?\b/u],
  ['image', /\bimages?\b|\bphotos?\b/u],
];

/**
 * Synthetic faults are opt-in twice: an explicit development runtime marker
 * and one allowlisted fault name. Missing/production markers fail closed.
 */
export function resolveNodeSlideSyntheticCreationFault(input: {
  runtimeEnvironment?: string;
  faultFlag?: string;
}): NodeSlideSyntheticCreationFault | null {
  if (input.runtimeEnvironment?.trim().toLowerCase() !== 'development') return null;
  return input.faultFlag?.trim().toLowerCase() === 'drop_requested_chart'
    ? 'drop_requested_chart'
    : null;
}

/**
 * Deliberately damage a provider spec before pass 1 so the real report and
 * real revision call can prove the repair branch. The mutation is cloned,
 * bounded, and only applies when the brief requested a chart and the provider
 * actually supplied one. The trace label always states its synthetic origin.
 */
export function injectNodeSlideSyntheticCreationFault(input: {
  rawSpec: unknown;
  brief: DeckBrief;
  fault: NodeSlideSyntheticCreationFault;
}): NodeSlideSyntheticFaultResult {
  const tracePrefix = 'Development-only synthetic fault (drop_requested_chart)';
  if (!chartRequested(input.brief) || !isCreationSpecRecord(input.rawSpec)) {
    return {
      spec: input.rawSpec,
      fault: input.fault,
      applied: false,
      requiredCharts: [],
      traceLabel: `${tracePrefix}: requested but not applicable; pass 1 was not modified.`,
    };
  }
  const slides = input.rawSpec.slides;
  if (!Array.isArray(slides)) {
    return {
      spec: input.rawSpec,
      fault: input.fault,
      applied: false,
      requiredCharts: [],
      traceLabel: `${tracePrefix}: requested but not applicable; pass 1 was not modified.`,
    };
  }
  const requestedChart = readRequestedChart(input.brief);
  const requiredCharts: NodeSlidePlannedChart[] = [];
  const faultedSlides = slides.map((slide) => {
    if (!isCreationSpecRecord(slide)) return slide;
    const authoredArtifact = isCreationSpecRecord(slide['artifactSpec'])
      ? slide['artifactSpec']
      : null;
    const authoredChart =
      authoredArtifact?.['kind'] === 'chart' ? authoredArtifact['payload'] : undefined;
    if (!Object.hasOwn(slide, 'chart') && authoredChart === undefined) return slide;
    const providerChart = readRequiredChart(slide['chart'] ?? authoredChart);
    if (!providerChart) return slide;
    if (requestedChart && !chartsSemanticallyMatch(providerChart, requestedChart)) return slide;
    requiredCharts.push(requestedChart ?? providerChart);
    const { chart: _removedChart, artifactSpec: _artifactSpec, ...slideWithoutChart } = slide;
    if (authoredChart === undefined && _artifactSpec !== undefined) {
      slideWithoutChart['artifactSpec'] = _artifactSpec;
    }
    // The deterministic materializer supplies a chart for a primitive-empty
    // evidence slot. Keep this intentionally broken pass chartless by placing
    // an explicitly labeled synthetic image primitive in an otherwise empty
    // slot; the provider revision still receives the real missing-chart issue.
    if (!slideWithoutChart['formula'] && !slideWithoutChart['image']) {
      slideWithoutChart['image'] = {
        altText: 'Development-only synthetic fault placeholder',
        credit: 'NodeSlide fault injection',
      };
    }
    return slideWithoutChart;
  });
  if (requiredCharts.length === 0) {
    return {
      spec: input.rawSpec,
      fault: input.fault,
      applied: false,
      requiredCharts: [],
      traceLabel: `${tracePrefix}: requested but the provider emitted no chart to remove.`,
    };
  }
  return {
    spec: { ...input.rawSpec, slides: faultedSlides },
    fault: input.fault,
    applied: true,
    requiredCharts,
    traceLabel: `${tracePrefix}: removed ${requiredCharts.length} provider-supplied chart${
      requiredCharts.length === 1 ? '' : 's'
    } matching the requested label/value series before pass 1.`,
  };
}

/**
 * Materialize the spec exactly the way `createFromBriefInternal` will (same
 * coercion, archetypes, and geometry gate) and collect concrete quality
 * signals from the result. Pure and deterministic for a fixed `now`.
 */
export function collectNodeSlideCreationQualityReport(
  input: NodeSlideCreationCritiqueInput,
): NodeSlideCreationQualityReport {
  let built: ReturnType<typeof buildBriefNodeSlide>;
  try {
    built = buildBriefNodeSlide({
      deckId: 'deck_critique_preview',
      projectId: 'project_critique_preview',
      title: input.title,
      brief: input.brief,
      themeId: input.themeId,
      rawSpec: input.rawSpec,
      ...(input.attachments ? { attachments: input.attachments } : {}),
      now: input.now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Artifact materialization failed.';
    const issueCode = message.match(/\[([a-z0-9_]+)\]/u)?.[1] ?? 'artifact_spec';
    return {
      issueCount: 1,
      validationIssues: [{ severity: 'error', code: issueCode, message: message.slice(0, 220) }],
      compressedSlides: [],
      missingPrimitives: [],
      missingRequiredCharts: [],
      archetypes: [],
      visualRhythmIssues: [],
      materializationFailed: true,
    };
  }
  const validation = validateNodeSlideSnapshot(built.snapshot, input.now);
  const validationIssues: NodeSlideCreationQualityIssue[] = validation.issues
    .filter(
      (issue): issue is (typeof validation.issues)[number] & { severity: 'error' | 'warning' } =>
        issue.severity === 'error' || issue.severity === 'warning',
    )
    .slice(0, MAX_REPORT_VALIDATION_ISSUES)
    .map((issue) => ({
      severity: issue.severity,
      code: issue.code,
      message: issue.message.slice(0, 220),
      ...(issue.slideId ? { slideId: issue.slideId } : {}),
    }));

  const slideIndexById = new Map(built.snapshot.deck.slideOrder.map((id, index) => [id, index]));
  const compressedSlides = findCompressedTextElements(built.snapshot.elements)
    .slice(0, MAX_REPORT_COMPRESSED_SLIDES)
    .map((entry) => ({
      slideIndex: slideIndexById.get(entry.slideId) ?? -1,
      elementName: entry.elementName,
    }));

  const requestText =
    `${input.brief.prompt} ${input.brief.purpose} ${input.brief.successCriteria.join(' ')}`.toLowerCase();
  const missingRequiredCharts = (input.requiredCharts ?? []).filter(
    (requiredChart) =>
      !built.spec.slides.some(
        (slide) => slide.chart !== undefined && chartsSemanticallyMatch(slide.chart, requiredChart),
      ),
  );
  const missingPrimitives = PRIMITIVE_REQUESTS.filter(([primitive, pattern]) => {
    if (!pattern.test(requestText)) return false;
    if (primitive === 'chart' && input.requiredCharts?.length)
      return missingRequiredCharts.length > 0;
    return !built.spec.slides.some((slide) =>
      primitive === 'chart'
        ? slide.chart !== undefined
        : primitive === 'diagram'
          ? slide.diagram !== undefined
          : primitive === 'formula'
            ? slide.formula !== undefined
            : slide.image !== undefined,
    );
  }).map(([primitive]) => primitive);

  const archetypes = built.snapshot.slides.map((slide) => slide.archetype ?? 'unknown');
  const visualRhythmIssues = [
    ...collectPrimaryVisualConflicts(input.rawSpec),
    ...collectRawVisualLogicIssues(input.rawSpec),
    ...collectVisualLogicIssues(built.snapshot),
    ...collectVisualRhythmIssues(built.snapshot, archetypes),
  ];

  return {
    issueCount:
      validationIssues.length +
      compressedSlides.length +
      missingPrimitives.length +
      visualRhythmIssues.length,
    validationIssues,
    compressedSlides,
    missingPrimitives,
    missingRequiredCharts,
    archetypes,
    visualRhythmIssues,
    materializationFailed: false,
  };
}

function collectPrimaryVisualConflicts(rawSpec: unknown): NodeSlideCreationQualityIssue[] {
  if (!isCreationSpecRecord(rawSpec) || !Array.isArray(rawSpec.slides)) return [];
  return rawSpec.slides.flatMap((slide, index) => {
    if (!isCreationSpecRecord(slide)) return [];
    const primaryKeys = ['metric', 'chart', 'diagram', 'formula', 'math', 'image', 'video'].filter(
      (key) => Object.hasOwn(slide, key),
    );
    const authoredArtifact = isCreationSpecRecord(slide['artifactSpec'])
      ? slide['artifactSpec']
      : null;
    if (typeof authoredArtifact?.['kind'] === 'string') {
      const authoredKind =
        authoredArtifact['kind'] === 'graph'
          ? 'diagram'
          : authoredArtifact['kind'] === 'equation'
            ? 'formula'
            : authoredArtifact['kind'];
      primaryKeys.push(String(authoredKind));
    }
    // formula/math are aliases for the same primitive.
    const primaryKinds = new Set(primaryKeys.map((key) => (key === 'math' ? 'formula' : key)));
    if (primaryKinds.size <= 1) return [];
    return [
      {
        severity: 'warning' as const,
        code: 'multiple_primary_visuals',
        message: `Slide ${index + 1} supplies multiple dominant visuals (${[...primaryKinds].join(', ')}); choose the one that best proves its narrative job.`,
      },
    ];
  });
}

const NO_VISUAL_SIGNAL_VALUE =
  /^(?:0(?:[.,]0+)?\s*(?:cohorts?|items?|records?|series|datasets?)?|n\/?a|none|unknown|unavailable|[-—])$/iu;
const NO_VISUAL_SIGNAL_CONTEXT =
  /\b(?:no compatible|no data|not supplied|placeholder|pending|unavailable|unknown)\b/iu;

function metricHasNoVisualSignal(value: unknown, label: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'string') return true;
  const normalized = value.trim();
  const hasDecisionSignal =
    /(?:\d|[$€£¥%]|[≥≤<>]|\b(?:approved|blocked|ready|live|pass|fail|go|no-go)\b)/iu.test(
      normalized,
    );
  if (!hasDecisionSignal) return true;
  if (!NO_VISUAL_SIGNAL_VALUE.test(normalized)) return false;
  return (
    typeof label !== 'string' || label.trim().length === 0 || NO_VISUAL_SIGNAL_CONTEXT.test(label)
  );
}

function collectRawVisualLogicIssues(rawSpec: unknown): NodeSlideCreationQualityIssue[] {
  if (!isCreationSpecRecord(rawSpec) || !Array.isArray(rawSpec.slides)) return [];
  return rawSpec.slides.flatMap((value, index) => {
    if (!isCreationSpecRecord(value)) return [];
    if (!metricHasNoVisualSignal(value['metric'], value['metricLabel'])) return [];
    return [
      {
        severity: 'error' as const,
        code: 'visual_metric_without_signal',
        message: `Slide ${index + 1} promotes a zero-value or unavailable proxy as its metric; remove it or supply decision-relevant evidence.`,
      },
    ];
  });
}

function collectVisualLogicIssues(snapshot: DeckSnapshot): NodeSlideCreationQualityIssue[] {
  const issues: NodeSlideCreationQualityIssue[] = [];
  for (const slide of snapshot.slides) {
    const elements = snapshot.elements.filter((element) => element.slideId === slide.id);
    const slideText = elements
      .map((element) => element.content ?? '')
      .filter(Boolean)
      .join(' ');
    const placeholderHero = elements.find(
      (element) =>
        element.kind === 'image' &&
        element.image?.placeholder === true &&
        !element.imageUrl?.trim() &&
        (slide.archetype === 'media-dominant' || element.bbox.width * element.bbox.height >= 0.12),
    );
    if (placeholderHero) {
      issues.push({
        severity: 'error',
        code: 'visual_placeholder_hero',
        message: `Slide ${slide.id} gives unresolved media hero-scale space; use a renderable asset or a non-media composition.`,
        slideId: slide.id,
      });
    }

    const weakMetric = elements.find(
      (element) => element.role === 'metric' && metricHasNoVisualSignal(element.content, slideText),
    );
    if (weakMetric) {
      issues.push({
        severity: 'error',
        code: 'visual_metric_without_signal',
        message: `Slide ${slide.id} promotes a zero-value or unavailable proxy as its metric; remove it or supply decision-relevant evidence.`,
        slideId: slide.id,
      });
    }

    const missingTruthHero = elements.find(
      (element) =>
        ['chart', 'image', 'math', 'video'].includes(element.kind) &&
        element.authoredArtifactBinding?.truthState === 'missing' &&
        element.bbox.width * element.bbox.height >= 0.12,
    );
    if (missingTruthHero) {
      issues.push({
        severity: 'error',
        code: 'visual_missing_truth_hero',
        message: `Slide ${slide.id} gives hero-scale space to an artifact whose truth state is missing; replace it with supported evidence or a non-evidence composition.`,
        slideId: slide.id,
      });
    }
  }
  const storySlides = snapshot.slides.filter((slide) =>
    snapshot.elements.some(
      (element) => element.slideId === slide.id && element.role?.startsWith('story_motif_'),
    ),
  );
  if (
    storySlides.length >= 4 &&
    storySlides.some(
      (slide) =>
        snapshot.elements.filter(
          (element) => element.slideId === slide.id && element.role?.startsWith('story_motif_'),
        ).length < 2,
    )
  ) {
    issues.push({
      severity: 'warning',
      code: 'visual_metaphor_not_transformed',
      message:
        'The continuity motif repeats as a single decoration; pair it with a changing state marker so each scene advances the metaphor.',
    });
  }
  return issues;
}

function collectVisualRhythmIssues(
  snapshot: DeckSnapshot,
  archetypes: readonly string[],
): NodeSlideCreationQualityIssue[] {
  const issues: NodeSlideCreationQualityIssue[] = [];
  const requiredDistinctArchetypes = snapshot.slides.length >= 7 ? 5 : 4;
  const distinctArchetypes = new Set(archetypes).size;
  if (distinctArchetypes < requiredDistinctArchetypes) {
    issues.push({
      severity: 'warning',
      code: 'visual_archetype_variety',
      message: `Deck uses ${distinctArchetypes} layout archetypes; ${requiredDistinctArchetypes} are required for ${snapshot.slides.length} slides.`,
    });
  }

  const archetypeCounts = new Map<string, number>();
  for (const archetype of archetypes) {
    archetypeCounts.set(archetype, (archetypeCounts.get(archetype) ?? 0) + 1);
  }
  const overused = [...archetypeCounts.entries()].filter(([, count]) => count > 2);
  if (overused.length > 0) {
    issues.push({
      severity: 'warning',
      code: 'visual_composition_repeat',
      message: `No composition may carry more than two slides; overused: ${overused.map(([name, count]) => `${name} (${count})`).join(', ')}.`,
    });
  }

  let textDominantRun = 0;
  let runStart = 0;
  for (let index = 0; index < snapshot.slides.length; index += 1) {
    const slide = snapshot.slides[index];
    if (!slide) continue;
    const hasStructuredVisual = snapshot.elements.some(
      (element) =>
        element.slideId === slide.id &&
        (element.kind === 'chart' ||
          (element.kind === 'image' &&
            element.image?.placeholder !== true &&
            Boolean(element.imageUrl?.trim())) ||
          element.kind === 'video' ||
          element.kind === 'math' ||
          (element.role === 'metric' &&
            !metricHasNoVisualSignal(
              element.content,
              snapshot.elements
                .filter((candidate) => candidate.slideId === slide.id)
                .map((candidate) => candidate.content ?? '')
                .join(' '),
            )) ||
          element.role?.startsWith('diagram_')),
    );
    if (hasStructuredVisual) {
      textDominantRun = 0;
      runStart = index + 1;
      continue;
    }
    if (textDominantRun === 0) runStart = index;
    textDominantRun += 1;
    if (textDominantRun === 3) {
      issues.push({
        severity: 'warning',
        code: 'visual_text_dominant_run',
        message: `Slides ${runStart + 1}-${index + 1} are three consecutive text-dominant compositions; insert a structured visual argument.`,
        slideId: slide.id,
      });
    }
  }
  return issues;
}

/** Bounded JSON body handed to the provider inside the revision system prompt. */
export function nodeSlideCreationCritiquePromptReport(
  report: NodeSlideCreationQualityReport,
): string {
  return JSON.stringify({
    validationIssues: report.validationIssues,
    compressedSlides: report.compressedSlides,
    missingPrimitives: report.missingPrimitives,
    missingRequiredCharts: report.missingRequiredCharts,
    visualRhythmIssues: report.visualRhythmIssues,
    materializationFailed: report.materializationFailed,
  }).slice(0, MAX_REPORT_PROMPT_BYTES);
}

export type NodeSlideCreationCritiqueDecision =
  | 'skipped'
  | 'clean'
  | 'revised'
  | 'revision_failed'
  | 'revision_not_better';

export interface NodeSlideCreationCritiqueOutcome {
  /** The spec the deck should be built from (never worse than pass 1). */
  spec: unknown;
  /** Provider passes that ran (deterministic route reports 1, loop skipped). */
  passes: 1 | 2;
  decision: NodeSlideCreationCritiqueDecision;
  /** Honest one-line receipt for the creation trace. */
  summary: string;
  firstReport: NodeSlideCreationQualityReport | null;
  chosenReport: NodeSlideCreationQualityReport | null;
  revision: NodeSlideProviderResult | null;
}

export interface RunNodeSlideCreationCritiqueInput {
  firstSpec: unknown;
  title: string;
  brief: DeckBrief;
  themeId: string;
  now: number;
  attachments?: readonly NodeSlideDataAttachment[];
  /** Exact chart payloads removed by an authorized development-only fault. */
  requiredCharts?: readonly NodeSlidePlannedChart[];
  /** True only when pass 1 actually came from a live provider route. */
  providerLive: boolean;
  requestRevision: (promptReport: string) => Promise<NodeSlideProviderResult>;
}

function describeReport(report: NodeSlideCreationQualityReport): string {
  const parts: string[] = [];
  if (report.missingPrimitives.length > 0) {
    parts.push(`missing ${report.missingPrimitives.join('/')}`);
  }
  if (report.compressedSlides.length > 0) {
    parts.push(
      `compressed copy on ${report.compressedSlides.length} slide${report.compressedSlides.length === 1 ? '' : 's'}`,
    );
  }
  if (report.validationIssues.length > 0) {
    const codes = [...new Set(report.validationIssues.map((issue) => issue.code))].slice(0, 3);
    parts.push(
      `${codes.join('/')} validation issue${report.validationIssues.length === 1 ? '' : 's'}`,
    );
  }
  if (report.visualRhythmIssues.length > 0) {
    parts.push(
      `${report.visualRhythmIssues.map((issue) => issue.code).join('/')} visual-rhythm issue${report.visualRhythmIssues.length === 1 ? '' : 's'}`,
    );
  }
  return parts.join(', ') || 'reported issues';
}

function readRequiredChart(value: unknown): NodeSlidePlannedChart | null {
  if (
    !isCreationSpecRecord(value) ||
    !Array.isArray(value['labels']) ||
    !Array.isArray(value['values'])
  ) {
    return null;
  }
  const labels = value['labels']
    .filter((label): label is string => typeof label === 'string')
    .map((label) => label.replace(/\s+/gu, ' ').trim().slice(0, 30))
    .slice(0, 8);
  const values = value['values']
    .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    .slice(0, labels.length);
  if (labels.length < 2 || values.length !== labels.length) return null;
  const unit =
    typeof value['unit'] === 'string'
      ? value['unit'].replace(/\s+/gu, ' ').trim().slice(0, 16)
      : '';
  return { labels, values, ...(unit ? { unit } : {}) };
}

function chartsSemanticallyMatch(
  candidate: NodeSlidePlannedChart,
  required: NodeSlidePlannedChart,
): boolean {
  const candidatePairs = chartSemanticPairs(candidate);
  const requiredPairs = chartSemanticPairs(required);
  if (candidatePairs.length !== requiredPairs.length) return false;
  const pairsMatch = requiredPairs.every(([requiredLabel, requiredValue]) =>
    candidatePairs.some(
      ([candidateLabel, candidateValue]) =>
        candidateValue === requiredValue &&
        chartLabelsSemanticallyMatch(candidateLabel, requiredLabel),
    ),
  );
  if (!pairsMatch) return false;
  const requiredUnit = normalizeChartLabel(required.unit ?? '');
  return requiredUnit.length === 0 || normalizeChartLabel(candidate.unit ?? '') === requiredUnit;
}

function chartSemanticPairs(chart: NodeSlidePlannedChart): Array<readonly [string, number]> {
  return chart.labels
    .map((label, index): readonly [string, number] => [
      normalizeChartLabel(label),
      Object.is(chart.values[index], -0) ? 0 : (chart.values[index] ?? Number.NaN),
    ])
    .filter((pair) => pair[0].length > 0 && Number.isFinite(pair[1]));
}

function chartLabelsSemanticallyMatch(candidate: string, required: string): boolean {
  return (
    candidate === required ||
    candidate.endsWith(` ${required}`) ||
    required.endsWith(` ${candidate}`)
  );
}

function normalizeChartLabel(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase('en-US');
}

/**
 * Extract the explicitly requested label/value comparison from the brief.
 * This intentionally handles only clear "chart comparing A 1, B 2" language;
 * ambiguous prose leaves the synthetic hook on its provider-chart fallback.
 */
function readRequestedChart(brief: DeckBrief): NodeSlidePlannedChart | null {
  const requestText = `${brief.prompt} ${brief.purpose} ${brief.successCriteria.join(' ')}`;
  const comparisonText = requestText.match(
    /\b(?:bar\s+)?chart\b[^.;]{0,80}?\bcompar(?:e|ing)\s+(.+?)(?=,?\s+plus\b|\s+(?:formula|equation)\b|[.;]|$)/iu,
  )?.[1];
  if (!comparisonText) return null;
  const points = comparisonText.split(/,\s*(?:and\s+)?|\s+and\s+/iu).flatMap((part) => {
    const match = part.trim().match(/^(.+?)\s+(-?\d+(?:\.\d+)?)$/u);
    if (!match) return [];
    const label = (match[1] ?? '')
      .replace(/^an?\s+/iu, '')
      .replace(/\s+/gu, ' ')
      .trim()
      .slice(0, 30);
    const value = Number(match[2]);
    return label && Number.isFinite(value) ? [{ label, value }] : [];
  });
  if (points.length < 2) return null;
  return {
    labels: points.slice(0, 8).map((point) => point.label),
    values: points.slice(0, 8).map((point) => point.value),
  };
}

function chartRequested(brief: DeckBrief): boolean {
  return /\bcharts?\b|\bgraphs?\b/iu.test(
    `${brief.prompt} ${brief.purpose} ${brief.successCriteria.join(' ')}`,
  );
}

function isCreationSpecRecord(value: unknown): value is Record<string, unknown> & {
  slides?: unknown;
} {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function claimDiagramFromSlide(slide: Record<string, unknown>): Record<string, unknown> | null {
  const bullets = Array.isArray(slide['bullets'])
    ? slide['bullets'].filter(
        (bullet): bullet is string => typeof bullet === 'string' && bullet.trim().length > 0,
      )
    : [];
  if (bullets.length < 2) return null;
  const evidenceNodes = bullets.slice(0, 3).map((bullet, index) => ({
    id: `evidence-${index + 1}`,
    label: bullet.trim().slice(0, 80),
    kind: 'system',
  }));
  return {
    kind: 'architecture',
    direction: 'horizontal',
    nodes: [
      ...evidenceNodes,
      {
        id: 'claim',
        label:
          typeof slide['headline'] === 'string'
            ? slide['headline'].trim().slice(0, 80)
            : 'Decision claim',
        kind: 'decision',
      },
    ],
    edges: evidenceNodes.map((node) => ({
      from: node.id,
      to: 'claim',
      label: 'supports',
    })),
  };
}

function comparisonArtifactHasPlottableSignal(artifactSpec: Record<string, unknown>): boolean {
  const payload = artifactSpec['payload'];
  if (!isCreationSpecRecord(payload)) return false;
  const metrics = Array.isArray(payload['metrics'])
    ? payload['metrics'].filter(isCreationSpecRecord)
    : [];
  const cohorts = Array.isArray(payload['cohorts'])
    ? payload['cohorts'].filter(isCreationSpecRecord)
    : [];
  return metrics.some((metric) => {
    const metricId = typeof metric['id'] === 'string' ? metric['id'] : '';
    if (!metricId) return false;
    return (
      cohorts.filter((cohort) => {
        const values = cohort['values'];
        return isCreationSpecRecord(values) && Number.isFinite(values[metricId]);
      }).length >= 2
    );
  });
}

function formulaInventsPendingQuantities(value: unknown): boolean {
  if (!isCreationSpecRecord(value)) return false;
  const serialized = JSON.stringify(value);
  return (
    /(?:^|[^\p{L}])\d+(?:\.\d+)?/u.test(serialized) &&
    /\b(?:pending|missing|placeholder|not retrieved|not supplied)\b/iu.test(serialized)
  );
}

function briefForbidsIllustrativeQuantities(brief: DeckBrief): boolean {
  return /\b(?:never|do not|don't|must not|no)\s+(?:\w+\s+){0,3}(?:invent|fabricat|make up)\w*\s+(?:\w+\s+){0,3}(?:numbers?|figures?|data|metrics?|outcomes?)\b/iu.test(
    `${brief.prompt} ${brief.purpose} ${brief.successCriteria.join(' ')}`,
  );
}

function collectFiniteQuantities(
  value: unknown,
  quantities: number[] = [],
  includeNumericText = false,
): number[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    quantities.push(value);
    return quantities;
  }
  if (includeNumericText && typeof value === 'string') {
    for (const token of value.match(/-?\d[\d,]*(?:\.\d+)?/gu) ?? []) {
      const quantity = Number(token.replaceAll(',', ''));
      if (Number.isFinite(quantity)) quantities.push(quantity);
    }
    return quantities;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectFiniteQuantities(item, quantities, includeNumericText);
    return quantities;
  }
  if (isCreationSpecRecord(value)) {
    for (const item of Object.values(value)) {
      collectFiniteQuantities(item, quantities, includeNumericText);
    }
  }
  return quantities;
}

function briefSuppliedQuantities(brief: DeckBrief): Set<number> {
  const briefText = `${brief.prompt} ${brief.purpose} ${brief.successCriteria.join(' ')}`;
  return new Set(
    (briefText.match(/-?\d[\d,]*(?:\.\d+)?/gu) ?? [])
      .map((token) => Number(token.replaceAll(',', '')))
      .filter(Number.isFinite),
  );
}

function unsupportedArtifactQuantities(
  brief: DeckBrief,
  payload: unknown,
  includeNumericText = false,
): number[] {
  const suppliedQuantities = briefSuppliedQuantities(brief);
  return [
    ...new Set(
      collectFiniteQuantities(payload, [], includeNumericText).filter(
        (quantity) => !suppliedQuantities.has(quantity),
      ),
    ),
  ];
}

function briefSupportsArtifactQuantities(
  brief: DeckBrief,
  payload: unknown,
  includeNumericText = false,
): boolean {
  return unsupportedArtifactQuantities(brief, payload, includeNumericText).length === 0;
}

function removeUnsupportedMetricCopy(
  slide: Record<string, unknown>,
  unsupportedQuantities: number[],
): Record<string, unknown> {
  const unsupported = new Set(unsupportedQuantities);
  const copyContainsUnsupportedQuantity = (value: unknown) =>
    typeof value === 'string' &&
    (value.match(/-?\d[\d,]*(?:\.\d+)?/gu) ?? []).some((token) =>
      unsupported.has(Number(token.replaceAll(',', ''))),
    );
  const repaired = { ...slide };
  if (Array.isArray(repaired['bullets'])) {
    const groundedBullets = repaired['bullets'].filter(
      (bullet): bullet is string =>
        typeof bullet === 'string' &&
        bullet.trim().length > 0 &&
        !copyContainsUnsupportedQuantity(bullet),
    );
    repaired['bullets'] = [
      ...groundedBullets,
      'Set and source the checkpoint timing before publication',
    ].slice(0, 3);
  }
  return repaired;
}

function removeUnsupportedSchedulingCopy(
  slide: Record<string, unknown>,
  brief: DeckBrief,
): { slide: Record<string, unknown>; changed: boolean } {
  const suppliedQuantities = briefSuppliedQuantities(brief);
  const unsupportedSchedulePattern =
    /(-?\d[\d,]*(?:\.\d+)?)\s*(?:business\s+)?(?:days?|weeks?|months?|years?)\b/iu;
  let changed = false;
  const sanitizeSchedulingCopy = (value: unknown): unknown => {
    if (typeof value !== 'string') return value;
    const sanitized = value.replace(
      new RegExp(unsupportedSchedulePattern.source, 'giu'),
      (match, quantityToken: string) => {
        const quantity = Number(quantityToken.replaceAll(',', ''));
        if (suppliedQuantities.has(quantity)) return match;
        changed = true;
        return 'at a sourced checkpoint';
      },
    );
    if (
      /do not invent regulatory obligations/iu.test(brief.prompt) &&
      /\bimmediately\b/iu.test(sanitized)
    ) {
      changed = true;
      return sanitized.replace(/\bimmediately\b/giu, 'when the signed decision is recorded');
    }
    return sanitized;
  };
  const headline = sanitizeSchedulingCopy(slide['headline']);
  const body = sanitizeSchedulingCopy(slide['body']);
  if (!Array.isArray(slide['bullets'])) {
    return changed
      ? { slide: { ...slide, headline, body }, changed: true }
      : { slide, changed: false };
  }
  const groundedBullets = slide['bullets'].filter((bullet): bullet is string => {
    if (typeof bullet !== 'string' || bullet.trim().length === 0) return false;
    const match = bullet.match(unsupportedSchedulePattern);
    if (!match) return true;
    const quantity = Number(match[1]?.replaceAll(',', ''));
    if (suppliedQuantities.has(quantity)) return true;
    changed = true;
    return false;
  });
  if (!changed) return { slide, changed: false };
  return {
    slide: {
      ...slide,
      headline,
      body,
      bullets: [
        ...groundedBullets,
        'Set and source the checkpoint timing before publication',
      ].slice(0, 3),
    },
    changed: true,
  };
}

function preserveNarrativeAfterQuantitativeQuarantine(
  slide: Record<string, unknown>,
  unsupportedQuantities: number[],
): Record<string, unknown> {
  const unsupported = new Set(unsupportedQuantities);
  const containsUnsupportedQuantity = (value: string) =>
    (value.match(/-?\d[\d,]*(?:\.\d+)?/gu) ?? []).some((token) =>
      unsupported.has(Number(token.replaceAll(',', ''))),
    );
  if (!Array.isArray(slide['bullets'])) return slide;
  const groundedBullets = slide['bullets'].filter(
    (bullet): bullet is string =>
      typeof bullet === 'string' &&
      bullet.trim().length > 0 &&
      !containsUnsupportedQuantity(bullet),
  );
  return {
    ...slide,
    bullets: groundedBullets.slice(0, 3),
  };
}

function replaceQuarantinedQuantitativeCopy(
  slide: Record<string, unknown>,
): Record<string, unknown> {
  const repaired = { ...slide };
  if (typeof repaired['headline'] === 'string') {
    repaired['headline'] = 'The release gate stays closed until the evidence is verified';
  }
  if (typeof repaired['body'] === 'string') {
    repaired['body'] =
      'The supplied context does not contain verified figures, so NodeSlide does not invent a quantitative outlook. Publication resumes when exact values and source citations are attached.';
  }
  if (Array.isArray(repaired['bullets'])) {
    repaired['bullets'] = [
      'Hold the release decision',
      'Attach exact figures and metric definitions',
      'Verify the source, owner, and reconciliation',
    ];
  }
  return repaired;
}

function replaceQuarantinedEvidenceCopy(slide: Record<string, unknown>): Record<string, unknown> {
  const sourceGate = 'Source evidence must be captured before publication';
  const originalHeadline = typeof slide['headline'] === 'string' ? slide['headline'].trim() : '';
  const originalBody = typeof slide['body'] === 'string' ? slide['body'].trim() : '';
  const missingAssetPattern =
    /\b(?:placeholder|no captured|not captured|pending (?:a )?(?:licensed )?capture|missing (?:source|asset))\b/iu;
  const repaired: Record<string, unknown> = {
    ...slide,
    headline:
      originalHeadline && !missingAssetPattern.test(originalHeadline)
        ? originalHeadline
        : 'Source evidence required before publication',
    body:
      originalBody && !missingAssetPattern.test(originalBody)
        ? `${originalBody} ${sourceGate}.`
        : `The narrative is preserved, but its ${sourceGate.toLowerCase()}.`,
  };
  if (Array.isArray(repaired['bullets'])) {
    const sourcedBullets = repaired['bullets'].filter(
      (bullet): bullet is string =>
        typeof bullet === 'string' && bullet.trim().length > 0 && !missingAssetPattern.test(bullet),
    );
    repaired['bullets'] = sourcedBullets.includes(sourceGate)
      ? sourcedBullets
      : [...sourcedBullets, sourceGate];
  }
  return repaired;
}

function compactVisualBodyCopy(value: string, maxLength = 220): string {
  if (value.length <= maxLength) return value;
  const completeSentences = value.match(/[^.!?]+[.!?]+(?:\s+|$)/gu) ?? [];
  let compact = '';
  for (const sentence of completeSentences) {
    const candidate = `${compact}${sentence}`.trim();
    if (candidate.length > maxLength) break;
    compact = candidate;
  }
  if (compact) return compact;
  const bounded = value.slice(0, maxLength + 1);
  const lastSpace = bounded.lastIndexOf(' ');
  return bounded.slice(0, lastSpace > 0 ? lastSpace : maxLength).trimEnd();
}

function repairEvidencePipelineDiagram(
  slide: Record<string, unknown>,
): Record<string, unknown> | null {
  const diagram = slide['diagram'];
  if (!isCreationSpecRecord(diagram) || !Array.isArray(diagram['nodes'])) return null;
  const nodes = diagram['nodes'].filter(isCreationSpecRecord);
  const labelFor = (node: Record<string, unknown>) =>
    typeof node['label'] === 'string' ? node['label'] : '';
  const source = nodes.find((node) => /\b(?:source|filed|filing|deck)\b/iu.test(labelFor(node)));
  const extract = nodes.find((node) => /\bextract\w*\b/iu.test(labelFor(node)));
  const validate = nodes.find((node) => /\bvalidat\w*\b/iu.test(labelFor(node)));
  const decision = nodes.find((node) => /\b(?:decision|board)\b/iu.test(labelFor(node)));
  if (!source || !extract || !validate || !decision) return null;
  const label = nodes.find(
    (node) =>
      node !== source &&
      node !== extract &&
      node !== validate &&
      node !== decision &&
      /\b(?:label|tier|classif)\w*\b/iu.test(labelFor(node)),
  );
  const ordered = [source, extract, validate, ...(label ? [label] : []), decision];
  const orderedIds = ordered.map((node) => String(node['id']));
  if (orderedIds.some((id) => !id || id === 'undefined')) return null;
  return {
    ...slide,
    diagram: {
      ...diagram,
      direction: 'horizontal',
      nodes: ordered,
      edges: orderedIds.slice(0, -1).map((from, index) => ({
        from,
        to: orderedIds[index + 1],
        label: 'then',
      })),
    },
  };
}

function repairDecisionBulletOrder(slide: Record<string, unknown>): Record<string, unknown> | null {
  if (!Array.isArray(slide['bullets'])) return null;
  const bullets = [
    ...new Set(
      slide['bullets']
        .filter(
          (bullet): bullet is string => typeof bullet === 'string' && bullet.trim().length > 0,
        )
        .map((bullet) => bullet.trim()),
    ),
  ];
  const owner = bullets.find((bullet) => /\bowner\b/iu.test(bullet));
  const checkpoint = bullets.find((bullet) => /\bcheckpoint\b/iu.test(bullet));
  const decision =
    bullets.find(
      (bullet) =>
        bullet !== owner &&
        bullet !== checkpoint &&
        /\b(?:decision|release|hold|adopt|approve)\b/iu.test(bullet),
    ) ??
    (typeof slide['headline'] === 'string' &&
    /\b(?:release|hold)\b/iu.test(slide['headline']) &&
    owner &&
    checkpoint
      ? 'Record release, release with controls, or hold'
      : undefined);
  if (!decision || !owner || !checkpoint) return null;
  const ordered = [decision, owner, checkpoint].map((bullet) =>
    bullet.replace(/^\s*0?\d{1,2}(?:(?:[.):\-·])|\s)+\s*/u, '').trim(),
  );
  return { ...slide, bullets: ordered };
}

function repairCreationVisualLogic(
  rawSpec: unknown,
  brief: DeckBrief,
): {
  spec: unknown;
  repairCount: number;
} {
  if (!isCreationSpecRecord(rawSpec) || !Array.isArray(rawSpec.slides)) {
    return { spec: rawSpec, repairCount: 0 };
  }
  let repairCount = 0;
  const slides = rawSpec.slides.map((value) => {
    if (!isCreationSpecRecord(value)) return value;
    let slide: Record<string, unknown> = { ...value };
    const schedulingRepair = removeUnsupportedSchedulingCopy(slide, brief);
    if (schedulingRepair.changed) {
      slide = schedulingRepair.slide;
      repairCount += 1;
    }
    const authoredArtifact = slide['artifactSpec'];
    const authoredPayload = isCreationSpecRecord(authoredArtifact)
      ? authoredArtifact['payload']
      : undefined;
    const authoredProvenance = isCreationSpecRecord(authoredArtifact)
      ? authoredArtifact['provenance']
      : undefined;
    const authoredTruthState = isCreationSpecRecord(authoredProvenance)
      ? authoredProvenance['truthState']
      : undefined;
    const authoredSourceRefs = isCreationSpecRecord(authoredProvenance)
      ? authoredProvenance['sourceRefs']
      : undefined;
    const quantitativeArtifact =
      isCreationSpecRecord(authoredArtifact) &&
      ['chart', 'comparison', 'equation'].includes(String(authoredArtifact['kind']));
    const artifactInventsUnsuppliedQuantities =
      quantitativeArtifact &&
      ['illustrative', 'estimated'].includes(String(authoredTruthState)) &&
      !briefSupportsArtifactQuantities(brief, authoredPayload);
    const violatesBriefTruthPolicy =
      quantitativeArtifact &&
      (artifactInventsUnsuppliedQuantities ||
        (briefForbidsIllustrativeQuantities(brief) &&
          authoredTruthState === 'supported' &&
          (!Array.isArray(authoredSourceRefs) || authoredSourceRefs.length === 0)));
    const unsupportedAuthoredArtifact =
      isCreationSpecRecord(authoredArtifact) &&
      (violatesBriefTruthPolicy ||
        authoredArtifact['kind'] === 'evidence-media' ||
        (authoredArtifact['kind'] === 'generic' &&
          (!isCreationSpecRecord(authoredPayload) ||
            authoredPayload['displayValue'] === undefined ||
            metricHasNoVisualSignal(
              authoredPayload['displayValue'],
              authoredPayload['label'] ?? authoredArtifact['narrativeJob'],
            ))) ||
        (authoredArtifact['kind'] === 'comparison' &&
          !comparisonArtifactHasPlottableSignal(authoredArtifact)));
    if (unsupportedAuthoredArtifact) {
      const {
        artifactSpec: _unsupportedArtifact,
        chart: _unsupportedChart,
        metric: _unsupportedMetric,
        metricLabel: _unsupportedMetricLabel,
        ...withoutArtifact
      } = slide;
      slide = withoutArtifact;
      if (violatesBriefTruthPolicy) {
        const hasGroundedAlternative = ['diagram', 'formula', 'image', 'video'].some(
          (key) => slide[key] !== undefined && slide[key] !== null,
        );
        const preservesDecisionNarrative =
          /\b(?:decision|decide|adopt|approve|release|owner)\b/iu.test(
            `${String(slide['title'] ?? '')} ${String(slide['section'] ?? '')} ${String(
              slide['headline'] ?? '',
            )}`,
          );
        const preserveNarrative = hasGroundedAlternative || preservesDecisionNarrative;
        slide = preserveNarrative
          ? preserveNarrativeAfterQuantitativeQuarantine(
              slide,
              unsupportedArtifactQuantities(brief, authoredPayload),
            )
          : replaceQuarantinedQuantitativeCopy(slide);
        if (!hasGroundedAlternative) {
          const claimDiagram = claimDiagramFromSlide(slide);
          if (claimDiagram) slide['diagram'] = claimDiagram;
        }
      }
      if (authoredArtifact['kind'] === 'evidence-media') {
        slide = replaceQuarantinedEvidenceCopy(slide);
      }
      if (
        authoredArtifact['kind'] === 'evidence-media' &&
        slide['diagram'] === undefined &&
        slide['chart'] === undefined &&
        slide['formula'] === undefined
      ) {
        const claimDiagram = claimDiagramFromSlide(slide);
        if (claimDiagram) slide['diagram'] = claimDiagram;
      }
      repairCount += 1;
    }
    const image = slide['image'];
    if (image !== undefined && !hasRenderableImage(image)) {
      const { image: _invalidImage, ...withoutImage } = slide;
      slide = replaceQuarantinedEvidenceCopy(withoutImage);
      const hasOtherVisual = ['chart', 'diagram', 'formula', 'video', 'artifactSpec'].some(
        (key) => slide[key] !== undefined && slide[key] !== null,
      );
      if (!hasOtherVisual) {
        const claimDiagram = claimDiagramFromSlide(slide);
        if (claimDiagram) slide['diagram'] = claimDiagram;
      }
      repairCount += 1;
    }
    const video = slide['video'];
    if (video !== undefined && !hasRenderableVideo(video)) {
      const { video: _invalidVideo, ...withoutVideo } = slide;
      slide = withoutVideo;
      repairCount += 1;
    }
    if (metricHasNoVisualSignal(slide['metric'], slide['metricLabel'])) {
      const { metric: _invalidMetric, metricLabel: _invalidMetricLabel, ...withoutMetric } = slide;
      slide = withoutMetric;
      repairCount += 1;
    }
    if (
      slide['metric'] !== undefined &&
      (briefForbidsIllustrativeQuantities(brief) ||
        /\b(?:days?|weeks?|months?|years?|score|threshold|tolerance|target)\b/iu.test(
          `${String(slide['metric'])} ${String(slide['metricLabel'] ?? '')}`,
        )) &&
      !briefSupportsArtifactQuantities(
        brief,
        { metric: slide['metric'], metricLabel: slide['metricLabel'] },
        true,
      )
    ) {
      const unsupportedQuantities = unsupportedArtifactQuantities(
        brief,
        { metric: slide['metric'], metricLabel: slide['metricLabel'] },
        true,
      );
      const {
        metric: _unsupportedMetric,
        metricLabel: _unsupportedMetricLabel,
        ...withoutMetric
      } = slide;
      slide = removeUnsupportedMetricCopy(withoutMetric, unsupportedQuantities);
      repairCount += 1;
    }
    if (
      slide['chart'] !== undefined &&
      (briefForbidsIllustrativeQuantities(brief) ||
        /\b(?:illustrative|estimated|synthetic|placeholder)\b/iu.test(
          JSON.stringify(slide['chart']),
        )) &&
      !briefSupportsArtifactQuantities(brief, slide['chart'])
    ) {
      const { chart: _unsupportedChart, ...withoutChart } = slide;
      slide = replaceQuarantinedQuantitativeCopy(withoutChart);
      repairCount += 1;
    }
    if (
      slide['formula'] !== undefined &&
      ((!briefSupportsArtifactQuantities(brief, slide['formula'], true) &&
        /\b(?:illustrative|estimated|tolerance|threshold|pending|missing|placeholder|not retrieved|not supplied)\b/iu.test(
          JSON.stringify(slide['formula']),
        )) ||
        (briefForbidsIllustrativeQuantities(brief) &&
          formulaInventsPendingQuantities(slide['formula'])))
    ) {
      const { formula: _unsupportedFormula, ...withoutFormula } = slide;
      slide = replaceQuarantinedQuantitativeCopy(withoutFormula);
      repairCount += 1;
    }
    const primaryVisualKeys = [
      'metric',
      'chart',
      'diagram',
      'formula',
      'image',
      'video',
      'artifactSpec',
    ];
    if (
      !primaryVisualKeys.some((key) => slide[key] !== undefined && slide[key] !== null) &&
      claimsMissingQuantitativeVisual(slide)
    ) {
      slide = replaceQuarantinedQuantitativeCopy(slide);
      const claimDiagram = claimDiagramFromSlide(slide);
      if (claimDiagram) slide['diagram'] = claimDiagram;
      repairCount += 1;
    }
    const hasPrimaryVisual = primaryVisualKeys.some(
      (key) => slide[key] !== undefined && slide[key] !== null,
    );
    if (hasPrimaryVisual && typeof slide['body'] === 'string' && slide['body'].length > 220) {
      slide = { ...slide, body: compactVisualBodyCopy(slide['body']) };
      repairCount += 1;
    }
    const evidencePipelineRepair = repairEvidencePipelineDiagram(slide);
    if (evidencePipelineRepair) {
      slide = evidencePipelineRepair;
      repairCount += 1;
    }
    const decisionBulletRepair = repairDecisionBulletOrder(slide);
    if (decisionBulletRepair) {
      slide = decisionBulletRepair;
      repairCount += 1;
    }
    const artifactSpec = slide['artifactSpec'];
    const provenance = isCreationSpecRecord(artifactSpec) ? artifactSpec['provenance'] : undefined;
    if (
      isCreationSpecRecord(artifactSpec) &&
      artifactSpec['kind'] === 'chart' &&
      isCreationSpecRecord(provenance) &&
      provenance['truthState'] === 'missing'
    ) {
      const {
        artifactSpec: _missingArtifact,
        chart: _missingChart,
        ...withoutMissingChart
      } = slide;
      slide = replaceQuarantinedQuantitativeCopy(withoutMissingChart);
      repairCount += 1;
    }
    return slide;
  });
  const adjacentRepair = repairAdjacentQuantitativeQuarantines(slides, rawSpec.slides);
  repairCount += adjacentRepair.repairCount;
  return repairCount > 0
    ? { spec: { ...rawSpec, slides: adjacentRepair.slides }, repairCount }
    : { spec: rawSpec, repairCount };
}

function claimsMissingQuantitativeVisual(slide: Record<string, unknown>): boolean {
  const copy = [
    slide['title'],
    slide['headline'],
    slide['body'],
    ...(Array.isArray(slide['bullets']) ? slide['bullets'] : []),
  ]
    .map((value) => String(value ?? ''))
    .join(' ');
  return (
    /\b(?:plotted|plotting|mapped|positioned)\b/iu.test(copy) &&
    /\b(?:axes?|matrix|quadrant|heatmap|band)\b/iu.test(copy)
  );
}

function repairAdjacentQuantitativeQuarantines(
  slides: unknown[],
  originals: unknown[],
): { slides: unknown[]; repairCount: number } {
  const quarantineHeadline = 'The release gate stays closed until the evidence is verified';
  let repairCount = 0;
  const repaired = slides.map((value, index) => {
    if (!isCreationSpecRecord(value) || index === 0) return value;
    const previous = slides[index - 1];
    if (
      !isCreationSpecRecord(previous) ||
      previous['headline'] !== quarantineHeadline ||
      value['headline'] !== quarantineHeadline
    ) {
      return value;
    }
    const original = originals[index];
    const originalHeadline =
      isCreationSpecRecord(original) && typeof original['headline'] === 'string'
        ? original['headline'].trim()
        : '';
    const safeOriginalHeadline =
      originalHeadline.length > 0 && !/\d/u.test(originalHeadline)
        ? originalHeadline
        : 'The next evidence obligation must be resolved before release';
    repairCount += 1;
    return {
      ...value,
      headline: safeOriginalHeadline,
      body: 'The prior gate hold establishes the decision boundary. This evidence obligation names what must be verified before committee review can resume.',
      bullets: [
        'Define the evidence owner',
        'Bind each claim to a source',
        'Record the unresolved risk at the gate',
      ],
    };
  });
  return { slides: repaired, repairCount };
}

function hasRenderableImage(value: unknown): boolean {
  if (!isCreationSpecRecord(value)) return false;
  return [value['url'], value['imageUrl']].some(
    (candidate) =>
      typeof candidate === 'string' && isNodeSlideEmbeddedRasterDataUrl(candidate.trim()),
  );
}

function hasRenderableVideo(value: unknown): boolean {
  return (
    isCreationSpecRecord(value) &&
    typeof value['url'] === 'string' &&
    value['url'].trim().length > 0
  );
}

/**
 * Run the bounded self-critique loop: at most one revision call, and the
 * revised spec is kept only when it strictly reduces the concrete issue count
 * (never regress; a failed or non-improving revision keeps pass 1).
 */
export async function runNodeSlideCreationCritique(
  input: RunNodeSlideCreationCritiqueInput,
): Promise<NodeSlideCreationCritiqueOutcome> {
  const firstRepair = repairCreationVisualLogic(input.firstSpec, input.brief);
  const firstSpec = firstRepair.spec;
  const repairSummary =
    firstRepair.repairCount > 0
      ? `; deterministic visual-logic repair corrected ${firstRepair.repairCount} unusable hero primitive${firstRepair.repairCount === 1 ? '' : 's'}`
      : '';
  if (!input.providerLive) {
    return {
      spec: firstSpec,
      passes: 1,
      decision: 'skipped',
      summary: `1 pass (deterministic route; self-critique loop skipped${repairSummary})`,
      firstReport: null,
      chosenReport: null,
      revision: null,
    };
  }
  const reportInput = {
    title: input.title,
    brief: input.brief,
    themeId: input.themeId,
    now: input.now,
    ...(input.attachments ? { attachments: input.attachments } : {}),
    ...(input.requiredCharts?.length ? { requiredCharts: input.requiredCharts } : {}),
  };
  const firstReport = collectNodeSlideCreationQualityReport({
    ...reportInput,
    rawSpec: firstSpec,
  });
  if (firstReport.issueCount === 0) {
    return {
      spec: firstSpec,
      passes: 1,
      decision: 'clean',
      summary: `1 pass, clean${repairSummary}`,
      firstReport,
      chosenReport: firstReport,
      revision: null,
    };
  }

  let revision: NodeSlideProviderResult;
  try {
    revision = await input.requestRevision(nodeSlideCreationCritiquePromptReport(firstReport));
  } catch (error) {
    revision = {
      ok: false,
      reason: error instanceof Error ? error.message : 'revision call threw',
    };
  }
  if (revision.ok !== true) {
    return {
      spec: firstSpec,
      passes: 2,
      decision: 'revision_failed',
      summary: `2 passes: revision call failed (${revision.reason.slice(0, 120)}); kept pass 1 with ${firstReport.issueCount} known issue${firstReport.issueCount === 1 ? '' : 's'}${repairSummary}`,
      firstReport,
      chosenReport: firstReport,
      revision,
    };
  }

  const secondRepair = repairCreationVisualLogic(revision.value, input.brief);
  const secondReport = collectNodeSlideCreationQualityReport({
    ...reportInput,
    rawSpec: secondRepair.spec,
  });
  if (creationReportScore(secondReport) < creationReportScore(firstReport)) {
    return {
      spec: secondRepair.spec,
      passes: 2,
      decision: 'revised',
      summary: `2 passes: revised to fix ${describeReport(firstReport)} (${firstReport.issueCount} -> ${secondReport.issueCount} issue${secondReport.issueCount === 1 ? '' : 's'})${secondRepair.repairCount > 0 ? `; deterministic visual-logic repair corrected ${secondRepair.repairCount} unusable hero primitive${secondRepair.repairCount === 1 ? '' : 's'} from pass 2` : ''}`,
      firstReport,
      chosenReport: secondReport,
      revision,
    };
  }
  return {
    spec: firstSpec,
    passes: 2,
    decision: 'revision_not_better',
    summary: `2 passes: revision did not improve on ${describeReport(firstReport)} (${firstReport.issueCount} -> ${secondReport.issueCount} issue${secondReport.issueCount === 1 ? '' : 's'}); kept pass 1${repairSummary}`,
    firstReport,
    chosenReport: firstReport,
    revision,
  };
}

function creationReportScore(report: NodeSlideCreationQualityReport): number {
  return (report.materializationFailed ? 1_000 : 0) + report.issueCount;
}
