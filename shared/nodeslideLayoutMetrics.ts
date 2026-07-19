import type { BoundingBox, SlideElement } from './nodeslide';

/**
 * Pure text-measurement and geometry helpers for the deck materializer.
 *
 * The canvas model matches the renderer/validator raster: a 13.333in wide
 * 16:9 slide rendered at 120px/in, i.e. 1600x900 canvas pixels, with font
 * sizes expressed in canvas pixels and an average glyph width of ~0.52em
 * (the same heuristic used by the SlideLang overflow validator).
 */
export const NODESLIDE_CANVAS_WIDTH_IN = 13.333;
export const NODESLIDE_CANVAS_ASPECT = 16 / 9;
export const NODESLIDE_CANVAS_PX_PER_IN = 120;
export const NODESLIDE_AVG_CHAR_WIDTH_EM = 0.52;

/** Overlap of more than 8% of the smaller box counts as a collision. */
export const NODESLIDE_COLLISION_OVERLAP_RATIO = 0.08;

/** Bounded nudge budget when resolving collisions by pushing elements down. */
export const NODESLIDE_COLLISION_MAX_NUDGES = 8;

export interface NodeSlideTextMeasurement {
  lines: number;
  charactersPerLine: number;
  /** Normalized (0..1) height of the wrapped text block. */
  height: number;
}

/**
 * Estimate how many wrapped lines `content` needs inside a box of
 * `boxWidthNormalized` slide-widths, using greedy word wrapping with an
 * average character width of 0.52em.
 */
export function measureText(
  content: string,
  fontSizePx: number,
  lineHeight: number,
  boxWidthNormalized: number,
  canvasWidthIn: number = NODESLIDE_CANVAS_WIDTH_IN,
): NodeSlideTextMeasurement {
  const safeFontSize = Number.isFinite(fontSizePx) && fontSizePx > 0 ? fontSizePx : 24;
  const safeLineHeight =
    Number.isFinite(lineHeight) && lineHeight > 0 ? Math.max(0.8, lineHeight) : 1.2;
  const canvasWidthPx = Math.max(1, canvasWidthIn) * NODESLIDE_CANVAS_PX_PER_IN;
  const canvasHeightPx = canvasWidthPx / NODESLIDE_CANVAS_ASPECT;
  const innerWidthPx = Math.max(1, boxWidthNormalized * canvasWidthPx);
  const averageCharWidthPx = safeFontSize * NODESLIDE_AVG_CHAR_WIDTH_EM;
  const charactersPerLine = Math.max(1, Math.floor(innerWidthPx / averageCharWidthPx));

  let lines = 0;
  for (const paragraph of content.split(/\r?\n/u)) {
    if (paragraph.trim().length === 0) {
      lines += 1;
      continue;
    }
    let lineLength = 0;
    let paragraphLines = 1;
    for (const word of paragraph.trim().split(/\s+/u)) {
      const wordLength = Math.max(1, word.length);
      if (wordLength > charactersPerLine) {
        const wrapped = Math.ceil(wordLength / charactersPerLine);
        paragraphLines += Math.max(0, wrapped - (lineLength === 0 ? 1 : 0));
        lineLength = wordLength % charactersPerLine;
      } else if (lineLength === 0) {
        lineLength = wordLength;
      } else if (lineLength + 1 + wordLength <= charactersPerLine) {
        lineLength += 1 + wordLength;
      } else {
        paragraphLines += 1;
        lineLength = wordLength;
      }
    }
    lines += paragraphLines;
  }
  lines = Math.max(1, lines);

  return {
    lines,
    charactersPerLine,
    height: (lines * safeFontSize * safeLineHeight) / canvasHeightPx,
  };
}

/** Normalized height of `content` wrapped inside a box of the given width. */
export function estimateTextHeight(
  content: string,
  fontSizePx: number,
  lineHeight: number,
  boxWidthNormalized: number,
  canvasWidthIn: number = NODESLIDE_CANVAS_WIDTH_IN,
): number {
  return measureText(content, fontSizePx, lineHeight, boxWidthNormalized, canvasWidthIn).height;
}

export interface NodeSlideStackBlock {
  key: string;
  /** Preferred normalized height for the block. */
  height: number;
  /** Gap between this block and the previous one (ignored for the first). */
  gapBefore: number;
}

export interface NodeSlideStackedBlock {
  key: string;
  y: number;
  height: number;
}

/**
 * Stack blocks vertically starting at `startY`, each block beginning below
 * the previous one plus its gap. If the stack would extend past `maxBottom`,
 * gaps are first compressed to 0.01 and then heights are scaled down
 * proportionally so the stack always fits.
 */
export function stackBlocks(
  startY: number,
  blocks: readonly NodeSlideStackBlock[],
  maxBottom: number,
): NodeSlideStackedBlock[] {
  if (blocks.length === 0) return [];
  const available = Math.max(0.02, maxBottom - startY);
  let gaps = blocks.map((block, index) => (index === 0 ? 0 : Math.max(0, block.gapBefore)));
  const totalHeight = blocks.reduce((sum, block) => sum + Math.max(0.01, block.height), 0);
  let totalGap = gaps.reduce((sum, gap) => sum + gap, 0);
  if (totalHeight + totalGap > available) {
    gaps = gaps.map((gap, index) => (index === 0 ? 0 : Math.min(gap, 0.01)));
    totalGap = gaps.reduce((sum, gap) => sum + gap, 0);
  }
  const heightScale =
    totalHeight + totalGap > available ? Math.max(0.05, (available - totalGap) / totalHeight) : 1;

  const placed: NodeSlideStackedBlock[] = [];
  let cursor = startY;
  blocks.forEach((block, index) => {
    const gap = gaps[index] ?? 0;
    const height = Math.max(0.01, block.height) * heightScale;
    const y = cursor + gap;
    placed.push({ key: block.key, y, height });
    cursor = y + height;
  });
  return placed;
}

export interface NodeSlideCollisionRect {
  id: string;
  bbox: BoundingBox;
}

export interface NodeSlideCollisionPair {
  first: string;
  second: string;
  overlapRatio: number;
}

/** Overlap area divided by the smaller box's area (0 when disjoint). */
export function overlapOfSmallerRatio(left: BoundingBox, right: BoundingBox): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const overlap = width * height;
  const smallerArea = Math.min(left.width * left.height, right.width * right.height);
  return smallerArea > 0 ? overlap / smallerArea : 0;
}

/** All pairs whose overlap exceeds the collision threshold. */
export function findCollisions(
  rects: readonly NodeSlideCollisionRect[],
  threshold: number = NODESLIDE_COLLISION_OVERLAP_RATIO,
): NodeSlideCollisionPair[] {
  const pairs: NodeSlideCollisionPair[] = [];
  for (let leftIndex = 0; leftIndex < rects.length; leftIndex += 1) {
    const left = rects[leftIndex];
    if (!left) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < rects.length; rightIndex += 1) {
      const right = rects[rightIndex];
      if (!right) continue;
      const ratio = overlapOfSmallerRatio(left.bbox, right.bbox);
      if (ratio > threshold) {
        pairs.push({ first: left.id, second: right.id, overlapRatio: ratio });
      }
    }
  }
  return pairs;
}

export interface NodeSlideCollisionResolution {
  /** Bounding boxes after resolution, keyed by element id. */
  boxes: Map<string, BoundingBox>;
  /** Ids of elements that were nudged downward. */
  nudged: string[];
  /** True when no collision above the threshold remains. */
  resolved: boolean;
  /** Collisions remaining after the bounded nudge budget was spent. */
  remaining: NodeSlideCollisionPair[];
}

/**
 * Resolve collisions by pushing the lower element of each colliding pair
 * further down (bounded by `maxNudges` total nudges and the bottom of the
 * slide). Pure: input rects are not mutated.
 */
export function resolveCollisions(
  rects: readonly NodeSlideCollisionRect[],
  options?: {
    threshold?: number;
    maxNudges?: number;
    gap?: number;
    maxBottom?: number;
  },
): NodeSlideCollisionResolution {
  const threshold = options?.threshold ?? NODESLIDE_COLLISION_OVERLAP_RATIO;
  const maxNudges = options?.maxNudges ?? NODESLIDE_COLLISION_MAX_NUDGES;
  const gap = options?.gap ?? 0.01;
  const maxBottom = options?.maxBottom ?? 0.995;

  const working = rects.map((rect) => ({ id: rect.id, bbox: { ...rect.bbox } }));
  const nudged: string[] = [];
  for (let nudge = 0; nudge < maxNudges; nudge += 1) {
    const collisions = findCollisions(working, threshold);
    const collision = collisions[0];
    if (!collision) break;
    const first = working.find((rect) => rect.id === collision.first);
    const second = working.find((rect) => rect.id === collision.second);
    if (!first || !second) break;
    const [upper, lower] = first.bbox.y <= second.bbox.y ? [first, second] : [second, first];
    const targetY = upper.bbox.y + upper.bbox.height + gap;
    const clampedY = Math.min(targetY, maxBottom - lower.bbox.height);
    if (clampedY <= lower.bbox.y) break; // Cannot make progress by pushing down.
    lower.bbox.y = clampedY;
    nudged.push(lower.id);
  }

  const remaining = findCollisions(working, threshold);
  return {
    boxes: new Map(working.map((rect) => [rect.id, rect.bbox])),
    nudged,
    resolved: remaining.length === 0,
    remaining,
  };
}

/** Default measured-vs-allotted ratio above which text counts as compressed. */
export const NODESLIDE_TEXT_COMPRESSION_TOLERANCE = 1.12;

export interface NodeSlideCompressedTextElement {
  slideId: string;
  elementId: string;
  elementName: string;
  /** Estimated normalized height the content needs at its styled font. */
  measuredHeight: number;
  /** Normalized height the layout actually granted the element. */
  allottedHeight: number;
}

/**
 * Report text elements whose measured wrapped height exceeds the height the
 * materializer granted them (i.e. copy that only fits because a clamp or the
 * stack compressor squeezed it). Pure, DOM-free: uses the same canvas-model
 * estimate as the materializer, so a block laid out at its measured height
 * reports a ratio of exactly 1 and is never flagged.
 */
export function findCompressedTextElements(
  elements: readonly SlideElement[],
  toleranceRatio: number = NODESLIDE_TEXT_COMPRESSION_TOLERANCE,
): NodeSlideCompressedTextElement[] {
  const compressed: NodeSlideCompressedTextElement[] = [];
  for (const element of elements) {
    if (element.kind !== 'text') continue;
    const content = element.content?.trim();
    if (!content) continue;
    const fontSize = element.style.fontSize;
    if (!fontSize || fontSize <= 0) continue;
    if (element.bbox.height <= 0 || element.bbox.width <= 0) continue;
    const measuredHeight = estimateTextHeight(
      content,
      fontSize,
      element.style.lineHeight ?? 1.2,
      element.bbox.width,
    );
    if (measuredHeight > element.bbox.height * toleranceRatio) {
      compressed.push({
        slideId: element.slideId,
        elementId: element.id,
        elementName: element.name,
        measuredHeight,
        allottedHeight: element.bbox.height,
      });
    }
  }
  return compressed;
}
