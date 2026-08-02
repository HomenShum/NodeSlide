import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_LONGFORM_MAX_OUTPUT_TOKENS,
  nodeSlideCreateOutputTokenLimit,
  nodeSlideCreateScaledRunBudget,
} from './nodeslideCreateScale';

describe('NodeSlide long-form create scale', () => {
  it('preserves the short-deck budget envelope', () => {
    expect(nodeSlideCreateOutputTokenLimit(null)).toBe(10_000);
    expect(nodeSlideCreateOutputTokenLimit(12)).toBe(10_000);
    expect(nodeSlideCreateScaledRunBudget(12)).toEqual({});
  });

  it('scales exact long-form output without becoming unbounded', () => {
    expect(nodeSlideCreateOutputTokenLimit(72)).toBe(32_400);
    expect(nodeSlideCreateOutputTokenLimit(100)).toBe(45_000);
    expect(nodeSlideCreateOutputTokenLimit(1_000)).toBeLessThanOrEqual(
      NODESLIDE_LONGFORM_MAX_OUTPUT_TOKENS,
    );
    expect(nodeSlideCreateScaledRunBudget(72)).toEqual({ maxCostUsd: 5 });
  });
});
