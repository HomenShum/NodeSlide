import type { DeckBrief } from '../../shared/nodeslide';
import { findCompressedTextElements } from '../../shared/nodeslideLayoutMetrics';
import type { NodeSlideProviderResult } from './nodeslideProvider';
import { buildBriefNodeSlide } from './nodeslideSeed';
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

export type NodeSlideBriefPrimitive = 'chart' | 'formula' | 'image';

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
  /** Archetype per slide, in deck order, for monotony inspection downstream. */
  archetypes: string[];
}

export interface NodeSlideCreationCritiqueInput {
  title: string;
  brief: DeckBrief;
  themeId: string;
  rawSpec: unknown;
  now: number;
}

const PRIMITIVE_REQUESTS: ReadonlyArray<[NodeSlideBriefPrimitive, RegExp]> = [
  ['chart', /\bcharts?\b|\bgraphs?\b/u],
  ['formula', /\bformulas?\b|\bequations?\b/u],
  ['image', /\bimages?\b|\bphotos?\b/u],
];

/**
 * Materialize the spec exactly the way `createFromBriefInternal` will (same
 * coercion, archetypes, and geometry gate) and collect concrete quality
 * signals from the result. Pure and deterministic for a fixed `now`.
 */
export function collectNodeSlideCreationQualityReport(
  input: NodeSlideCreationCritiqueInput,
): NodeSlideCreationQualityReport {
  const built = buildBriefNodeSlide({
    deckId: 'deck_critique_preview',
    projectId: 'project_critique_preview',
    title: input.title,
    brief: input.brief,
    themeId: input.themeId,
    rawSpec: input.rawSpec,
    now: input.now,
  });
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
  const missingPrimitives = PRIMITIVE_REQUESTS.filter(([primitive, pattern]) => {
    if (!pattern.test(requestText)) return false;
    return !built.spec.slides.some((slide) =>
      primitive === 'chart'
        ? slide.chart !== undefined
        : primitive === 'formula'
          ? slide.formula !== undefined
          : slide.image !== undefined,
    );
  }).map(([primitive]) => primitive);

  const archetypes = built.snapshot.slides.map((slide) => slide.archetype ?? 'unknown');

  return {
    issueCount: validationIssues.length + compressedSlides.length + missingPrimitives.length,
    validationIssues,
    compressedSlides,
    missingPrimitives,
    archetypes,
  };
}

/** Bounded JSON body handed to the provider inside the revision system prompt. */
export function nodeSlideCreationCritiquePromptReport(
  report: NodeSlideCreationQualityReport,
): string {
  return JSON.stringify({
    validationIssues: report.validationIssues,
    compressedSlides: report.compressedSlides,
    missingPrimitives: report.missingPrimitives,
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
  return parts.join(', ') || 'reported issues';
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
  if (secondReport.issueCount < firstReport.issueCount) {
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
