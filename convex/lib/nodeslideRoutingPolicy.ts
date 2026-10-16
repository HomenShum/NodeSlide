/**
 * NodeSlide orchestrator/worker routing policy (Track B2).
 *
 * Per docs/ECOSYSTEM.md (J2 decision): routing lives in nodeslide as a
 * STANDALONE policy module — typed policy input, no NodeSlide imports in its
 * core — so it can later be lifted into a product-neutral `model-routing.v1`
 * contract unchanged. Keep this file dependency-free.
 *
 * Default policy: the planner is always the requested model. A cheap executor
 * (the executor above) is granted ONLY when the planner is a premium model
 * (Kimi / Claude / GPT) AND the plan contains at least two replace_text
 * operations worth of copy work. Everything else runs single-model.
 * The executor is always advisory: on failure or timeout the planner's own
 * copy stands — the orchestrator must never block on the cheap model.
 */

export const NODESLIDE_ROUTING_POLICY_VERSION = 'nodeslide.model-routing/v1' as const;

// Gemini 3.5 Flash was deprecated by Google on 2026-10-08 (requests auto-route to 3.6). SPEC D2
// (Homen 2026-10-16: no OpenRouter key exists, so OpenRouter-routed roles move to the newest `:free`
// model on the public list with the capabilities the role needs) puts the executor on
// nvidia/nemotron-3.5-super-vl:free (created 2026-10-15; tools and structured outputs; list fetched
// 2026-10-16T11:15:06Z). live-unverified (no key, Homen 2026-10-16). The run-budget ledger denies
// zero-priced `:free` routes (`dynamicRoute`, shared/nodeslideRunBudget.ts), so while this is the
// executor the budgeted dispatch refuses its call and the planner's own copy stands.
export const NODESLIDE_ROUTING_EXECUTOR_MODEL = 'nvidia/nemotron-3.5-super-vl:free' as const;

/** Minimum replace_text operations before splitting copy work to an executor. */
export const NODESLIDE_ROUTING_MIN_REPLACE_TEXT_OPS = 2 as const;

export type NodeSlideRoutingTask = 'edit_plan' | 'copy_execute';

export interface NodeSlideRoutingInput<Model extends string = string> {
  task: NodeSlideRoutingTask;
  requestedModel: Model;
  /** Reasoning effort of the request; reserved for future tiers, unused by v1. */
  effort?: string;
  /** replace_text operations in the planner's plan. Unknown (pre-plan) counts as 0. */
  replaceTextOps?: number;
}

export type NodeSlideRoutingReason =
  | 'split_premium_planner_bulk_copy'
  | 'no_split_task_not_edit_plan'
  | 'no_split_planner_not_premium'
  | 'no_split_below_copy_threshold'
  | 'no_split_planner_is_executor';

export interface NodeSlideRoutingDecision<Model extends string = string> {
  policyVersion: typeof NODESLIDE_ROUTING_POLICY_VERSION;
  plannerModel: Model;
  executorModel: typeof NODESLIDE_ROUTING_EXECUTOR_MODEL | null;
  reason: NodeSlideRoutingReason;
}

/** Premium planner families that justify delegating bulk copy to a cheap executor. */
const PREMIUM_PLANNER_PATTERNS: readonly RegExp[] = [
  /(^|\/)kimi[-\w.]*/i,
  /(^|\/)claude[-\w.]*/i,
  /(^|\/)gpt[-\w.]*/i,
];

export function isPremiumNodeSlidePlannerModel(modelId: string): boolean {
  return PREMIUM_PLANNER_PATTERNS.some((pattern) => pattern.test(modelId));
}

export function resolveNodeSlideRouting<Model extends string>(
  input: NodeSlideRoutingInput<Model>,
): NodeSlideRoutingDecision<Model> {
  const base = {
    policyVersion: NODESLIDE_ROUTING_POLICY_VERSION,
    plannerModel: input.requestedModel,
  } as const;
  if (input.task !== 'edit_plan') {
    return { ...base, executorModel: null, reason: 'no_split_task_not_edit_plan' };
  }
  if (input.requestedModel === NODESLIDE_ROUTING_EXECUTOR_MODEL) {
    return { ...base, executorModel: null, reason: 'no_split_planner_is_executor' };
  }
  if (!isPremiumNodeSlidePlannerModel(input.requestedModel)) {
    return { ...base, executorModel: null, reason: 'no_split_planner_not_premium' };
  }
  const replaceTextOps =
    Number.isFinite(input.replaceTextOps) && (input.replaceTextOps as number) > 0
      ? Math.floor(input.replaceTextOps as number)
      : 0;
  if (replaceTextOps < NODESLIDE_ROUTING_MIN_REPLACE_TEXT_OPS) {
    return { ...base, executorModel: null, reason: 'no_split_below_copy_threshold' };
  }
  return {
    ...base,
    executorModel: NODESLIDE_ROUTING_EXECUTOR_MODEL,
    reason: 'split_premium_planner_bulk_copy',
  };
}
