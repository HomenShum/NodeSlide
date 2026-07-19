import type { BoundingBox, DeckSnapshot, Slide, SlideElement, ValidationIssue } from './nodeslide';
import { overlapOfSmallerRatio } from './nodeslideLayoutMetrics';

/**
 * Single-source geometry validation (collision + text overflow) shared by the
 * server validator (convex/lib/nodeslideValidation.ts) and the client
 * SlideLang validator (src/domains/nodeslide/slidelang/validation.ts).
 *
 * Both surfaces MUST derive their geometry issues from `geometryIssueDrafts`
 * so a deck's ok/publishOk/issues agree between server validation records and
 * client export gating. Geometry issues are warnings (a colliding deck still
 * compiles), but both validators treat `collision` and `overflow` warnings as
 * publish blockers.
 */

export const NODESLIDE_GEOMETRY_CANVAS_WIDTH = 1600;
export const NODESLIDE_GEOMETRY_CANVAS_HEIGHT = 900;

/** Overlap of at least 20% of the smaller important element blocks publish. */
export const NODESLIDE_GEOMETRY_COLLISION_RATIO = 0.2;

/** Issue payload without a surface-specific stable ID. */
export type GeometryIssueDraft = Omit<ValidationIssue, 'id'>;

export interface TextFitEstimate {
  overflow: boolean;
  estimatedLines: number;
  availableLines: number;
  estimatedCharactersPerLine: number;
}

/** Overlap area divided by the smaller box's area (0 when disjoint). */
export const intersectionRatio = overlapOfSmallerRatio;

export function boxContains(
  container: BoundingBox,
  content: BoundingBox,
  tolerance = 0.005,
): boolean {
  return (
    container.x <= content.x + tolerance &&
    container.y <= content.y + tolerance &&
    container.x + container.width >= content.x + content.width - tolerance &&
    container.y + container.height >= content.y + content.height - tolerance
  );
}

/**
 * Greedy word-wrap estimate of whether an element's text fits its box on the
 * 1600x900 canvas raster, using the shared ~0.52em average glyph width.
 */
export function estimateTextFit(element: SlideElement): TextFitEstimate {
  const content = element.content ?? '';
  const fontSize = Number.isFinite(element.style.fontSize)
    ? Math.max(1, element.style.fontSize ?? 24)
    : 24;
  const lineHeight = Number.isFinite(element.style.lineHeight)
    ? Math.max(0.8, element.style.lineHeight ?? 1.2)
    : 1.2;
  const padding = Number.isFinite(element.style.padding)
    ? Math.max(0, element.style.padding ?? 0)
    : 0;
  const innerWidth = Math.max(
    1,
    element.bbox.width * NODESLIDE_GEOMETRY_CANVAS_WIDTH - padding * 2,
  );
  const innerHeight = Math.max(
    1,
    element.bbox.height * NODESLIDE_GEOMETRY_CANVAS_HEIGHT - padding * 2,
  );
  const averageCharacterWidth = fontSize * 0.52;
  const charactersPerLine = Math.max(1, Math.floor(innerWidth / averageCharacterWidth));
  const availableLines = Math.max(1, Math.floor(innerHeight / (fontSize * lineHeight)));

  let estimatedLines = 0;
  for (const paragraph of content.split(/\r?\n/)) {
    if (paragraph.length === 0) {
      estimatedLines += 1;
      continue;
    }
    let lineLength = 0;
    let lines = 1;
    for (const word of paragraph.split(/\s+/)) {
      const wordLength = Math.max(1, word.length);
      if (wordLength > charactersPerLine) {
        const wrappedWordLines = Math.ceil(wordLength / charactersPerLine);
        lines += Math.max(0, wrappedWordLines - (lineLength === 0 ? 1 : 0));
        lineLength = wordLength % charactersPerLine;
      } else if (lineLength === 0) {
        lineLength = wordLength;
      } else if (lineLength + 1 + wordLength <= charactersPerLine) {
        lineLength += 1 + wordLength;
      } else {
        lines += 1;
        lineLength = wordLength;
      }
    }
    estimatedLines += lines;
  }

  return {
    overflow: estimatedLines > availableLines,
    estimatedLines,
    availableLines,
    estimatedCharactersPerLine: charactersPerLine,
  };
}

function isCollisionCandidate(element: SlideElement): boolean {
  if (element.kind === 'connector') return false;
  if (element.role === 'footer' || element.role === 'page_number') return false;
  if (/(?:background|decorative|decoration|watermark)/i.test(element.role ?? '')) return false;
  return element.kind !== 'shape' || Boolean(element.content?.trim());
}

function shouldIgnoreContainedShape(first: SlideElement, second: SlideElement): boolean {
  if (first.kind === 'shape' && boxContains(first.bbox, second.bbox)) return true;
  if (second.kind === 'shape' && boxContains(second.bbox, first.bbox)) return true;
  return false;
}

function orderedSlideElements(snapshot: DeckSnapshot, slide: Slide): SlideElement[] {
  const candidates = snapshot.elements.filter((element) => element.slideId === slide.id);
  const byId = new Map(candidates.map((element) => [element.id, element]));
  const ordered = slide.elementOrder.flatMap((elementId) => {
    const element = byId.get(elementId);
    return element ? [element] : [];
  });
  const seen = new Set(ordered.map((element) => element.id));
  return [...ordered, ...candidates.filter((element) => !seen.has(element.id))];
}

/** Collision drafts for one slide, in element order. */
export function collisionIssueDrafts(snapshot: DeckSnapshot, slide: Slide): GeometryIssueDraft[] {
  const drafts: GeometryIssueDraft[] = [];
  const elements = orderedSlideElements(snapshot, slide).filter(isCollisionCandidate);
  for (let firstIndex = 0; firstIndex < elements.length; firstIndex += 1) {
    const first = elements[firstIndex];
    if (!first) continue;
    for (let secondIndex = firstIndex + 1; secondIndex < elements.length; secondIndex += 1) {
      const second = elements[secondIndex];
      if (!second || shouldIgnoreContainedShape(first, second)) continue;
      const overlap = intersectionRatio(first.bbox, second.bbox);
      if (overlap < NODESLIDE_GEOMETRY_COLLISION_RATIO) continue;
      drafts.push({
        severity: 'warning',
        code: 'collision',
        message: `Important elements "${first.id}" and "${second.id}" overlap by ${Math.round(overlap * 100)}% of the smaller element.`,
        slideId: slide.id,
        elementId: second.id,
      });
    }
  }
  return drafts;
}

/** Estimated text-overflow drafts for one element (text, shape, or math). */
export function overflowIssueDrafts(element: SlideElement): GeometryIssueDraft[] {
  const textLikeContent =
    element.kind === 'math' ? element.math?.expression : element.content?.trim();
  if (
    (element.kind !== 'text' && element.kind !== 'shape' && element.kind !== 'math') ||
    !textLikeContent
  ) {
    return [];
  }
  const fit = estimateTextFit({ ...element, content: textLikeContent });
  if (!fit.overflow) return [];
  return [
    {
      severity: 'warning',
      code: 'overflow',
      message: `Text is estimated at ${fit.estimatedLines} lines but "${element.id}" fits about ${fit.availableLines}.`,
      slideId: element.slideId,
      elementId: element.id,
    },
  ];
}

/**
 * Every geometry issue (overflow per element, then collisions per slide) for
 * a deck snapshot. Deterministic order: element overflow in snapshot element
 * order, then collisions in deck slide order.
 */
export function geometryIssueDrafts(snapshot: DeckSnapshot): GeometryIssueDraft[] {
  const drafts: GeometryIssueDraft[] = [];
  for (const element of snapshot.elements) {
    drafts.push(...overflowIssueDrafts(element));
  }
  for (const slide of snapshot.slides) {
    drafts.push(...collisionIssueDrafts(snapshot, slide));
  }
  return drafts;
}
