/**
 * Deterministic deck-level diversity gate.
 *
 * Measures silhouette similarity across slides using rendered geometry —
 * element types, region occupancy, dominant-region changes, text/visual area
 * ratios, alignment axes, and decorative primitives. Fails when adjacent
 * slides are near-duplicates or one composition family dominates beyond a
 * bounded threshold.
 */
import type { SlideElement } from '../../shared/nodeslide';

export interface SlideSilhouette {
  slideIndex: number;
  /** Element kinds present (text, shape, image, chart, math, connector, video) */
  elementKinds: Set<string>;
  /** Region occupancy: which of 9 canvas regions contain content */
  regionOccupancy: number; // bitmask of 9 regions (3x3 grid)
  /** Dominant region: the region with the most content area */
  dominantRegion: number; // 0-8
  /** Text area as fraction of total slide area */
  textAreaRatio: number;
  /** Visual area (chart, image, diagram shapes) as fraction of total slide area */
  visualAreaRatio: number;
  /** Horizontal alignment axis: x-center of the dominant content */
  dominantAxisX: number;
  /** Whether the slide has decorative primitives (accent rail, rules, etc.) */
  decorativePrimitiveCount: number;
  /** Number of content elements (excluding footer/page_number/decorations) */
  contentElementCount: number;
  /** Semantic artifact roles prevent a waterfall and risk matrix from being
   * collapsed into one generic shape-only silhouette. */
  artifactRoles: Set<string>;
  /** Materializer-selected composition family when the caller has it. */
  compositionFamily?: string;
}

export interface DeckDiversityReport {
  /** Overall diversity score: 0 (all identical) to 1 (maximally diverse) */
  score: number;
  /** Whether the deck passes the diversity gate */
  passes: boolean;
  /** Reasons for failure */
  failures: string[];
  /** Adjacent slide pairs with similarity > threshold */
  nearDuplicatePairs: Array<{ first: number; second: number; similarity: number }>;
  /** Number of distinct composition families used */
  distinctFamilies: number;
  /** Per-slide silhouettes */
  silhouettes: SlideSilhouette[];
}

export interface DeckDiversityOptions {
  intentionalSeries?: Array<{ slideIndexes: number[] }>;
}

const NEAR_DUPLICATE_THRESHOLD = 0.82;
const NON_ADJACENT_REPEAT_THRESHOLD = 0.9;
const MIN_DISTINCT_FAMILIES = 4;
const MAX_SINGLE_FAMILY_FRACTION = 0.6;

function computeSlideSilhouette(
  elements: SlideElement[],
  slideIndex: number,
  compositionFamily?: string,
): SlideSilhouette {
  const contentElements = elements.filter(
    (e) =>
      e.role !== 'footer' &&
      e.role !== 'page_number' &&
      e.role !== 'decoration' &&
      e.role?.startsWith('story_motif') !== true &&
      e.visible !== false,
  );
  const decorativeElements = elements.filter(
    (e) => e.role === 'decoration' || e.role?.startsWith('story_motif'),
  );

  const elementKinds = new Set<string>();
  const artifactRoles = new Set<string>();
  let regionOccupancy = 0;
  let textArea = 0;
  let visualArea = 0;
  const regionAreas = new Array<number>(9).fill(0);

  for (const element of contentElements) {
    elementKinds.add(element.kind);
    if (
      element.role?.startsWith('artifact_') ||
      element.role?.startsWith('diagram_') ||
      element.role === 'evidence' ||
      element.kind === 'chart' ||
      element.kind === 'image'
    ) {
      artifactRoles.add(element.role ?? element.kind);
    }
    const area = element.bbox.width * element.bbox.height;
    if (element.kind === 'text' || element.kind === 'math') {
      textArea += area;
    } else if (
      element.kind === 'chart' ||
      element.kind === 'image' ||
      element.kind === 'shape' ||
      element.kind === 'connector'
    ) {
      visualArea += area;
    }
    // Map bbox to 3x3 region
    const col = Math.min(2, Math.floor(element.bbox.x * 3));
    const row = Math.min(2, Math.floor(element.bbox.y * 3));
    const region = row * 3 + col;
    regionOccupancy |= 1 << region;
    regionAreas[region] = (regionAreas[region] ?? 0) + area;
  }

  // Dominant region: the region with the most content area
  let dominantRegion = 0;
  let maxArea = 0;
  for (let i = 0; i < 9; i += 1) {
    const area = regionAreas[i] ?? 0;
    if (area > maxArea) {
      maxArea = area;
      dominantRegion = i;
    }
  }

  // Dominant axis: x-center of the dominant content
  let dominantAxisX = 0.5;
  if (contentElements.length > 0) {
    const dominantElements = contentElements.filter((e) => {
      const col = Math.min(2, Math.floor(e.bbox.x * 3));
      const row = Math.min(2, Math.floor(e.bbox.y * 3));
      return row * 3 + col === dominantRegion;
    });
    if (dominantElements.length > 0) {
      dominantAxisX =
        dominantElements.reduce((sum, e) => sum + e.bbox.x + e.bbox.width / 2, 0) /
        dominantElements.length;
    }
  }

  const totalArea = Math.max(0.01, textArea + visualArea);

  return {
    slideIndex,
    elementKinds,
    regionOccupancy,
    dominantRegion,
    textAreaRatio: textArea / totalArea,
    visualAreaRatio: visualArea / totalArea,
    dominantAxisX,
    decorativePrimitiveCount: decorativeElements.length,
    contentElementCount: contentElements.length,
    artifactRoles,
    ...(compositionFamily ? { compositionFamily } : {}),
  };
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  const intersection = new Set([...a].filter((x) => b.has(x)));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 0 : intersection.size / union.size;
}

function regionSimilarity(a: number, b: number): number {
  // Count shared occupied regions
  const shared = a & b;
  const sharedCount = countBits(shared);
  const aCount = countBits(a);
  const bCount = countBits(b);
  if (aCount === 0 && bCount === 0) return 1;
  return sharedCount / Math.max(aCount, bCount);
}

function countBits(n: number): number {
  let count = 0;
  let v = n;
  while (v > 0) {
    count += v & 1;
    v >>= 1;
  }
  return count;
}

function computePairSimilarity(a: SlideSilhouette, b: SlideSilhouette): number {
  // Weighted similarity across multiple dimensions
  const kindSim = jaccardSimilarity(a.elementKinds, b.elementKinds);
  const artifactRoleSim = jaccardSimilarity(a.artifactRoles, b.artifactRoles);
  const regionSim = regionSimilarity(a.regionOccupancy, b.regionOccupancy);
  const dominantRegionSim = a.dominantRegion === b.dominantRegion ? 1 : 0;
  const axisSim = 1 - Math.min(1, Math.abs(a.dominantAxisX - b.dominantAxisX) * 2);
  const textRatioSim = 1 - Math.abs(a.textAreaRatio - b.textAreaRatio);
  const elementCountSim =
    1 -
    Math.abs(a.contentElementCount - b.contentElementCount) /
      Math.max(1, Math.max(a.contentElementCount, b.contentElementCount));

  return (
    kindSim * 0.18 +
    artifactRoleSim * 0.22 +
    regionSim * 0.16 +
    dominantRegionSim * 0.12 +
    axisSim * 0.1 +
    textRatioSim * 0.1 +
    elementCountSim * 0.12
  );
}

function identifyCompositionFamily(silhouette: SlideSilhouette): string {
  if (silhouette.compositionFamily) return silhouette.compositionFamily;
  // Classify into composition families based on geometric signature
  if (silhouette.contentElementCount <= 2) return 'minimal';
  if (silhouette.visualAreaRatio > 0.6) return 'visual-dominant';
  if (silhouette.textAreaRatio > 0.8) {
    if (silhouette.contentElementCount <= 4) {
      return silhouette.dominantRegion === 3 || silhouette.dominantAxisX >= 0.44
        ? 'text-thesis-centered'
        : 'text-thesis-offset';
    }
    return silhouette.dominantAxisX >= 0.44 ? 'editorial-centered' : 'editorial-offset';
  }
  if (silhouette.elementKinds.has('chart') || silhouette.elementKinds.has('image'))
    return 'mixed-evidence';
  if (silhouette.elementKinds.has('connector')) return 'process';
  if (silhouette.dominantRegion === 4) return 'centered'; // center region
  return 'editorial';
}

/**
 * Compute the deck-level diversity gate. Returns a report with pass/fail
 * and reasons for failure.
 */
export function evaluateDeckDiversity(
  slideElements: Array<{
    slideIndex: number;
    elements: SlideElement[];
    compositionFamily?: string;
  }>,
  options: DeckDiversityOptions = {},
): DeckDiversityReport {
  const silhouettes = slideElements.map(({ slideIndex, elements, compositionFamily }) =>
    computeSlideSilhouette(elements, slideIndex, compositionFamily),
  );

  const failures: string[] = [];
  const nearDuplicatePairs: DeckDiversityReport['nearDuplicatePairs'] = [];

  const recordedPairs = new Set<string>();
  const intentionalSeries = (options.intentionalSeries ?? []).map(
    (series) => new Set(series.slideIndexes.map((index) => index - 1)),
  );
  const isIntentionalPair = (first: number, second: number) =>
    intentionalSeries.some((series) => series.has(first) && series.has(second));
  // Adjacent repetition always damages reveal pacing.
  for (let i = 0; i < silhouettes.length - 1; i += 1) {
    const a = silhouettes[i];
    const b = silhouettes[i + 1];
    if (!a || !b) continue;
    if (isIntentionalPair(i, i + 1)) continue;
    const similarity = computePairSimilarity(a, b);
    if (similarity <= NEAR_DUPLICATE_THRESHOLD) continue;
    nearDuplicatePairs.push({ first: i, second: i + 1, similarity });
    recordedPairs.add(`${i}:${i + 1}`);
    failures.push(
      `Slides ${i + 1} and ${i + 2} are near-duplicates (similarity: ${similarity.toFixed(2)})`,
    );
  }

  // A composition may recur proportionally in a long deck. Twelve-slide decks
  // still fail on the third use; a 72-page approval book can reuse a system up
  // to six times across distant chapters before it becomes template repetition.
  const nonAdjacentRepeatAllowance = Math.max(2, Math.ceil(silhouettes.length / 12));
  for (let j = 0; j < silhouettes.length; j += 1) {
    const current = silhouettes[j];
    if (!current) continue;
    const previousMatches: Array<{ index: number; similarity: number }> = [];
    for (let i = 0; i < j; i += 1) {
      const previous = silhouettes[i];
      if (!previous) continue;
      if (isIntentionalPair(i, j)) continue;
      const similarity = computePairSimilarity(previous, current);
      if (similarity > NON_ADJACENT_REPEAT_THRESHOLD) {
        previousMatches.push({ index: i, similarity });
      }
    }
    if (previousMatches.length < nonAdjacentRepeatAllowance) continue;
    // The current slide is the repeated use. Record one nearest matching
    // predecessor instead of emitting an O(n^2) list of equivalent pairs.
    const match = previousMatches.at(-1);
    if (!match) continue;
    const key = `${match.index}:${j}`;
    if (recordedPairs.has(key)) continue;
    nearDuplicatePairs.push({ first: match.index, second: j, similarity: match.similarity });
    recordedPairs.add(key);
    failures.push(
      `Slides ${match.index + 1} and ${j + 1} are a repeated composition (similarity: ${match.similarity.toFixed(2)})`,
    );
  }

  // Count composition families
  const representativeIndexes = new Set(silhouettes.map((_, index) => index));
  for (const series of intentionalSeries) {
    const sorted = [...series].sort((left, right) => left - right);
    for (const index of sorted.slice(1)) representativeIndexes.delete(index);
  }
  const familySilhouettes = silhouettes.filter((_, index) => representativeIndexes.has(index));
  const families = familySilhouettes.map(identifyCompositionFamily);
  const distinctFamilies = new Set(families).size;

  // Check if one family dominates
  const familyCounts = new Map<string, number>();
  for (const family of families) {
    familyCounts.set(family, (familyCounts.get(family) ?? 0) + 1);
  }
  const maxFamilyCount = Math.max(...familyCounts.values());
  const maxFamilyFraction = maxFamilyCount / Math.max(1, familySilhouettes.length);
  if (maxFamilyFraction > MAX_SINGLE_FAMILY_FRACTION && familySilhouettes.length >= 4) {
    const dominantFamily = [...familyCounts.entries()].find(
      ([, count]) => count === maxFamilyCount,
    )?.[0];
    failures.push(
      `Composition family "${dominantFamily}" dominates ${Math.round(maxFamilyFraction * 100)}% of the deck (threshold: ${Math.round(MAX_SINGLE_FAMILY_FRACTION * 100)}%)`,
    );
  }

  // Check minimum distinct families
  if (distinctFamilies < MIN_DISTINCT_FAMILIES && familySilhouettes.length >= 6) {
    failures.push(
      `Only ${distinctFamilies} distinct composition families used (minimum: ${MIN_DISTINCT_FAMILIES})`,
    );
  }

  // Compute overall diversity score
  let totalSimilarity = 0;
  let pairCount = 0;
  for (let i = 0; i < silhouettes.length; i += 1) {
    for (let j = i + 1; j < silhouettes.length; j += 1) {
      const a = silhouettes[i];
      const b = silhouettes[j];
      if (!a || !b) continue;
      if (isIntentionalPair(i, j)) continue;
      totalSimilarity += computePairSimilarity(a, b);
      pairCount += 1;
    }
  }
  const avgSimilarity = pairCount > 0 ? totalSimilarity / pairCount : 0;
  const score = 1 - avgSimilarity;

  const passes = failures.length === 0;

  return {
    score,
    passes,
    failures,
    nearDuplicatePairs,
    distinctFamilies,
    silhouettes,
  };
}
