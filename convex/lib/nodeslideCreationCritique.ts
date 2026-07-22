import type { DeckBrief, DeckSnapshot } from '../../shared/nodeslide';
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
          element.kind === 'image' ||
          element.kind === 'video' ||
          element.kind === 'math' ||
          element.role === 'metric' ||
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

/**
 * Run the bounded self-critique loop: at most one revision call, and the
 * revised spec is kept only when it strictly reduces the concrete issue count
 * (never regress; a failed or non-improving revision keeps pass 1).
 */
export async function runNodeSlideCreationCritique(
  input: RunNodeSlideCreationCritiqueInput,
): Promise<NodeSlideCreationCritiqueOutcome> {
  if (!input.providerLive) {
    return {
      spec: input.firstSpec,
      passes: 1,
      decision: 'skipped',
      summary: '1 pass (deterministic route; self-critique loop skipped)',
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
    rawSpec: input.firstSpec,
  });
  if (firstReport.issueCount === 0) {
    return {
      spec: input.firstSpec,
      passes: 1,
      decision: 'clean',
      summary: '1 pass, clean',
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
      spec: input.firstSpec,
      passes: 2,
      decision: 'revision_failed',
      summary: `2 passes: revision call failed (${revision.reason.slice(0, 120)}); kept pass 1 with ${firstReport.issueCount} known issue${firstReport.issueCount === 1 ? '' : 's'}`,
      firstReport,
      chosenReport: firstReport,
      revision,
    };
  }

  const secondReport = collectNodeSlideCreationQualityReport({
    ...reportInput,
    rawSpec: revision.value,
  });
  if (creationReportScore(secondReport) < creationReportScore(firstReport)) {
    return {
      spec: revision.value,
      passes: 2,
      decision: 'revised',
      summary: `2 passes: revised to fix ${describeReport(firstReport)} (${firstReport.issueCount} -> ${secondReport.issueCount} issue${secondReport.issueCount === 1 ? '' : 's'})`,
      firstReport,
      chosenReport: secondReport,
      revision,
    };
  }
  return {
    spec: input.firstSpec,
    passes: 2,
    decision: 'revision_not_better',
    summary: `2 passes: revision did not improve on ${describeReport(firstReport)} (${firstReport.issueCount} -> ${secondReport.issueCount} issue${secondReport.issueCount === 1 ? '' : 's'}); kept pass 1`,
    firstReport,
    chosenReport: firstReport,
    revision,
  };
}

function creationReportScore(report: NodeSlideCreationQualityReport): number {
  return (report.materializationFailed ? 1_000 : 0) + report.issueCount;
}
