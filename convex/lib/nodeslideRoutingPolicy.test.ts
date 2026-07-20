import { describe, expect, it } from 'vitest';
import {
  NODESLIDE_ROUTING_EXECUTOR_MODEL,
  NODESLIDE_ROUTING_MIN_REPLACE_TEXT_OPS,
  NODESLIDE_ROUTING_POLICY_VERSION,
  isPremiumNodeSlidePlannerModel,
  resolveNodeSlideRouting,
} from './nodeslideRoutingPolicy';

describe('NodeSlide routing policy (B2 orchestrator/worker split)', () => {
  it('splits every premium planner family once the plan carries enough copy work', () => {
    for (const model of [
      'moonshotai/kimi-k3',
      'anthropic/claude-sonnet-5',
      'anthropic/claude-fable-5',
      'openai/gpt-5.6-sol',
      'openai/gpt-5.6-terra',
    ]) {
      const decision = resolveNodeSlideRouting({
        task: 'edit_plan',
        requestedModel: model,
        effort: 'high',
        replaceTextOps: NODESLIDE_ROUTING_MIN_REPLACE_TEXT_OPS,
      });
      expect(decision).toEqual({
        policyVersion: NODESLIDE_ROUTING_POLICY_VERSION,
        plannerModel: model,
        executorModel: NODESLIDE_ROUTING_EXECUTOR_MODEL,
        reason: 'split_premium_planner_bulk_copy',
      });
    }
  });

  it('never splits below the replace_text threshold, even for premium planners', () => {
    for (const replaceTextOps of [undefined, 0, 1, Number.NaN, -3]) {
      const decision = resolveNodeSlideRouting({
        task: 'edit_plan',
        requestedModel: 'moonshotai/kimi-k3',
        ...(replaceTextOps === undefined ? {} : { replaceTextOps }),
      });
      expect(decision.executorModel).toBeNull();
      expect(decision.reason).toBe('no_split_below_copy_threshold');
      expect(decision.plannerModel).toBe('moonshotai/kimi-k3');
    }
  });

  it('never splits for non-premium planners regardless of copy volume', () => {
    for (const model of [
      'z-ai/glm-5.2',
      'nebius/zai-org/GLM-5.2',
      'google/gemini-3.1-pro-preview',
    ]) {
      const decision = resolveNodeSlideRouting({
        task: 'edit_plan',
        requestedModel: model,
        replaceTextOps: 8,
      });
      expect(decision.executorModel).toBeNull();
      expect(decision.reason).toBe('no_split_planner_not_premium');
    }
  });

  it('never splits a copy_execute task — the executor lane must not recurse', () => {
    const decision = resolveNodeSlideRouting({
      task: 'copy_execute',
      requestedModel: 'moonshotai/kimi-k3',
      replaceTextOps: 8,
    });
    expect(decision.executorModel).toBeNull();
    expect(decision.reason).toBe('no_split_task_not_edit_plan');
  });

  it('never splits when the requested planner already is the executor model', () => {
    const decision = resolveNodeSlideRouting({
      task: 'edit_plan',
      requestedModel: NODESLIDE_ROUTING_EXECUTOR_MODEL,
      replaceTextOps: 8,
    });
    expect(decision.executorModel).toBeNull();
    expect(decision.reason).toBe('no_split_planner_is_executor');
  });

  it('classifies premium families by id segment, not by loose substring', () => {
    expect(isPremiumNodeSlidePlannerModel('moonshotai/kimi-k3')).toBe(true);
    expect(isPremiumNodeSlidePlannerModel('anthropic/claude-fable-5')).toBe(true);
    expect(isPremiumNodeSlidePlannerModel('openai/gpt-5.6-sol')).toBe(true);
    expect(isPremiumNodeSlidePlannerModel('google/gemini-3.5-flash')).toBe(false);
    expect(isPremiumNodeSlidePlannerModel('z-ai/glm-5.2')).toBe(false);
  });
});
