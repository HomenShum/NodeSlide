import type { SlideArchetype } from './nodeslide';

/**
 * Content shape of a planned slide, reduced to the signals that drive layout
 * archetype selection. Pure data — safe for any runtime.
 */
export interface SlideContentShape {
  index: number;
  total: number;
  hasMetric: boolean;
  hasChart: boolean;
  /** Image or video present. */
  hasMedia: boolean;
  hasFormula: boolean;
  bulletCount: number;
}

/**
 * Ranked viable archetypes for a content shape. The first entry is the
 * preferred archetype; later entries are honest alternatives the content also
 * supports (used by the anti-monotony rule). Shapes with a single entry have
 * no alternative — adjacent repeats of those are unavoidable.
 */
export function archetypeCandidates(shape: SlideContentShape): SlideArchetype[] {
  const isEdge = shape.index === 0 || shape.index === shape.total - 1;
  // Primary media wins: an image or video is the strongest visual anchor.
  if (shape.hasMedia) return ['media-dominant'];
  // A formula renders as a right-column panel; that is the split layout.
  if (shape.hasFormula) return ['split'];
  if (shape.hasMetric) {
    return shape.hasChart ? ['stat-dominant', 'chart-dominant'] : ['stat-dominant'];
  }
  if (shape.hasChart) return ['chart-dominant'];
  if (isEdge) return ['statement', 'split'];
  if (shape.bulletCount >= 3) return ['comparison', 'split'];
  return ['split'];
}

/**
 * Choose one archetype per slide with an anti-monotony rule: an adjacent
 * slide never repeats the previous archetype when its content shape offers an
 * alternative. When the shape supports exactly one archetype the repeat is
 * allowed — variety never overrides content honesty.
 */
export function chooseDeckArchetypes(shapes: readonly SlideContentShape[]): SlideArchetype[] {
  const chosen: SlideArchetype[] = [];
  for (const shape of shapes) {
    const candidates = archetypeCandidates(shape);
    const previous = chosen[chosen.length - 1];
    const pick = candidates.find((candidate) => candidate !== previous) ?? candidates[0] ?? 'split';
    chosen.push(pick);
  }
  return chosen;
}
