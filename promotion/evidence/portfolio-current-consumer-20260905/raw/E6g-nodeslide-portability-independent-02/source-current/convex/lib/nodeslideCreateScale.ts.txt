import type { NodeSlideRunBudgetInput } from '../../shared/nodeslideRunBudget';

export const NODESLIDE_LONGFORM_SLIDE_THRESHOLD = 12;
export const NODESLIDE_LONGFORM_MAX_OUTPUT_TOKENS = 50_000;

export function nodeSlideCreateOutputTokenLimit(slideCount: number | null): number {
  if (slideCount === null || slideCount <= NODESLIDE_LONGFORM_SLIDE_THRESHOLD) return 10_000;
  const boundedCount = Math.min(100, Math.max(13, Math.trunc(slideCount)));
  return Math.min(NODESLIDE_LONGFORM_MAX_OUTPUT_TOKENS, Math.max(10_000, boundedCount * 450));
}

export function nodeSlideCreateScaledRunBudget(slideCount: number | null): NodeSlideRunBudgetInput {
  return slideCount !== null && slideCount > NODESLIDE_LONGFORM_SLIDE_THRESHOLD
    ? { maxCostUsd: 5 }
    : {};
}
