/**
 * NodeSlide run budget — COMPLETE. The three symbols this module used to
 * withhold (`NODESLIDE_MODEL_PRICING`, `nodeSlideModelPricing`,
 * `scoreNodeSlideWorstCaseCost`) are at the bottom of this file, and every route
 * in `shared/nodeslide.ts` now has a row.
 *
 * The prior refusal was correct and its reasoning still governs the table: a
 * wrong price does not fail loudly, it silently mis-bills or wrongly admits a
 * run past its cost cap, so a price is only allowed here if it was read from the
 * provider's own machine catalog on a recorded date. The table's own docstring
 * carries that date and that URL. Nothing in it was guessed, and the two shapes
 * that could have been used to dodge the problem — a zero price for a dynamic
 * route, and a `Record<string, …>` that would let an unpriced route through —
 * are both still closed: dynamic routes have their own non-scorable kind, and
 * the record is still `satisfies Record<NodeSlideAgentModelId, …>`.
 *
 * One route is deliberately unpriced and DENIES: `nebius/zai-org/GLM-5.2` is not
 * an OpenRouter route, its price lives behind a private endpoint, and carrying
 * over a figure verified on a different day would be exactly the stale-paste
 * defect the table exists to prevent.
 */

import type { NodeSlideAgentModelId } from './nodeslide';

export const NODESLIDE_RUN_BUDGET_VERSION = 'nodeslide.run-budget/v1' as const;
export const NODESLIDE_RUN_BUDGET_STATE_VERSION = 'nodeslide.run-budget-state/v1' as const;
export const NODESLIDE_RUN_BUDGET_RECEIPT_VERSION = 'nodeslide.run-budget-receipt/v1' as const;
export const NODESLIDE_MODEL_PRICING_VERSION = 'nodeslide.model-pricing/v1' as const;
export const NODESLIDE_PRIVATE_DETERMINISTIC_MODEL = 'nodeslide/private-deterministic' as const;
export const NODESLIDE_MICRO_USD_PER_USD = 1_000_000 as const;
export const NODESLIDE_TOKENS_PER_PRICING_UNIT = 1_000_000 as const;

/**
 * Every run budget is finite after normalization. Defaults are deliberately
 * useful for a short agent run while the maxima bound untrusted server input.
 */
export const NODESLIDE_RUN_BUDGET_BOUNDS = {
  maxCostUsd: { default: 1, min: 0, max: 100 },
  maxInputTokens: { default: 1_048_576, min: 1, max: 16_777_216 },
  maxOutputTokens: { default: 262_144, min: 1, max: 4_194_304 },
  maxDurationMs: { default: 300_000, min: 1_000, max: 3_600_000 },
  maxIterations: { default: 12, min: 1, max: 128 },
  maxToolCalls: { default: 64, min: 1, max: 1_024 },
} as const;

export interface NodeSlideRunBudgetInput {
  maxCostUsd?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxDurationMs?: number;
  maxIterations?: number;
  maxToolCalls?: number;
}

export interface NodeSlideSpendConstraint {
  readonly source: 'instruction';
  readonly matchedText: string;
  readonly maxCostMicroUsd: number;
}

const NODESLIDE_SPEND_CONSTRAINT_PATTERN =
  /\bspend\s+(?:no|not)\s+more\s+than\s+(?:(?:usd)\s*)?\$\s*(\d+(?:\.\d+)?)\s+(?:on|for)\s+(?:this|the)\s+run\b/giu;

/**
 * Extracts explicit run-level dollar ceilings without floating-point parsing.
 * When an instruction repeats the constraint, the most restrictive value wins.
 */
export function parseNodeSlideSpendConstraint(
  instruction: string,
): NodeSlideSpendConstraint | null {
  if (typeof instruction !== 'string' || instruction.length > 20_000) return null;
  let selected: NodeSlideSpendConstraint | null = null;
  for (const match of instruction.matchAll(NODESLIDE_SPEND_CONSTRAINT_PATTERN)) {
    const amount = match[1];
    if (!amount) continue;
    const maxCostMicroUsd = parseUsdDecimalToMicroUsd(amount);
    if (
      maxCostMicroUsd >
      NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.max * NODESLIDE_MICRO_USD_PER_USD
    ) {
      throw new NodeSlideRunBudgetValidationError(
        'maxCostUsd',
        `instruction ceiling exceeds ${NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd.max} USD`,
      );
    }
    const candidate: NodeSlideSpendConstraint = {
      source: 'instruction',
      matchedText: match[0],
      maxCostMicroUsd,
    };
    if (!selected || candidate.maxCostMicroUsd < selected.maxCostMicroUsd) {
      selected = candidate;
    }
  }
  return selected;
}

/** Converts an unsigned USD decimal to integer micro-USD by rounding down. */
export function parseUsdDecimalToMicroUsd(value: string): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) {
    throw new NodeSlideRunBudgetValidationError('maxCostUsd', 'expected an unsigned USD decimal');
  }
  const [whole = '0', fraction = ''] = value.split('.');
  const microFraction = `${fraction}000000`.slice(0, 6);
  const microUsd = BigInt(whole) * BigInt(NODESLIDE_MICRO_USD_PER_USD) + BigInt(microFraction);
  if (microUsd > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new NodeSlideRunBudgetValidationError('maxCostUsd', 'amount exceeds the safe range');
  }
  return Number(microUsd);
}

export interface NodeSlideRunBudget {
  readonly version: typeof NODESLIDE_RUN_BUDGET_VERSION;
  readonly enforcement: 'hard';
  readonly maxCostUsd: number;
  readonly maxCostMicroUsd: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxDurationMs: number;
  readonly maxIterations: number;
  readonly maxToolCalls: number;
}

export class NodeSlideRunBudgetValidationError extends Error {
  readonly code = 'invalid_run_budget' as const;

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(`Invalid NodeSlide run budget ${field}: ${message}`);
    this.name = 'NodeSlideRunBudgetValidationError';
  }
}

const RUN_BUDGET_KEYS = new Set([
  'version',
  'enforcement',
  'maxCostUsd',
  'maxCostMicroUsd',
  'maxInputTokens',
  'maxOutputTokens',
  'maxDurationMs',
  'maxIterations',
  'maxToolCalls',
]);

/**
 * Strictly validates untrusted input and returns one canonical representation.
 * Passing an already-normalized budget is idempotent.
 */
export function normalizeNodeSlideRunBudget(input: unknown = {}): NodeSlideRunBudget {
  if (!isRecord(input)) {
    throw new NodeSlideRunBudgetValidationError('root', 'expected a plain object');
  }
  for (const key of Object.keys(input)) {
    if (!RUN_BUDGET_KEYS.has(key)) {
      throw new NodeSlideRunBudgetValidationError(key, 'unknown field');
    }
  }
  if (input['version'] !== undefined && input['version'] !== NODESLIDE_RUN_BUDGET_VERSION) {
    throw new NodeSlideRunBudgetValidationError('version', 'unsupported contract version');
  }
  if (input['enforcement'] !== undefined && input['enforcement'] !== 'hard') {
    throw new NodeSlideRunBudgetValidationError('enforcement', 'must be hard');
  }

  const maxCostUsd = readCostUsd(input['maxCostUsd']);
  const maxCostMicroUsd = Math.floor(maxCostUsd * NODESLIDE_MICRO_USD_PER_USD);
  if (input['maxCostMicroUsd'] !== undefined && input['maxCostMicroUsd'] !== maxCostMicroUsd) {
    throw new NodeSlideRunBudgetValidationError(
      'maxCostMicroUsd',
      'does not match canonical maxCostUsd',
    );
  }

  return {
    version: NODESLIDE_RUN_BUDGET_VERSION,
    enforcement: 'hard',
    maxCostUsd: maxCostMicroUsd / NODESLIDE_MICRO_USD_PER_USD,
    maxCostMicroUsd,
    maxInputTokens: readBoundedInteger(
      'maxInputTokens',
      input['maxInputTokens'],
      NODESLIDE_RUN_BUDGET_BOUNDS.maxInputTokens,
    ),
    maxOutputTokens: readBoundedInteger(
      'maxOutputTokens',
      input['maxOutputTokens'],
      NODESLIDE_RUN_BUDGET_BOUNDS.maxOutputTokens,
    ),
    maxDurationMs: readBoundedInteger(
      'maxDurationMs',
      input['maxDurationMs'],
      NODESLIDE_RUN_BUDGET_BOUNDS.maxDurationMs,
    ),
    maxIterations: readBoundedInteger(
      'maxIterations',
      input['maxIterations'],
      NODESLIDE_RUN_BUDGET_BOUNDS.maxIterations,
    ),
    maxToolCalls: readBoundedInteger(
      'maxToolCalls',
      input['maxToolCalls'],
      NODESLIDE_RUN_BUDGET_BOUNDS.maxToolCalls,
    ),
  };
}

function readCostUsd(value: unknown): number {
  const bounds = NODESLIDE_RUN_BUDGET_BOUNDS.maxCostUsd;
  const candidate = value === undefined ? bounds.default : value;
  if (
    typeof candidate !== 'number' ||
    !Number.isFinite(candidate) ||
    candidate < bounds.min ||
    candidate > bounds.max
  ) {
    throw new NodeSlideRunBudgetValidationError(
      'maxCostUsd',
      `expected a finite number from ${bounds.min} through ${bounds.max}`,
    );
  }
  return candidate;
}

function readBoundedInteger(
  field: string,
  value: unknown,
  bounds: Readonly<{ default: number; min: number; max: number }>,
): number {
  const candidate = value === undefined ? bounds.default : value;
  if (
    typeof candidate !== 'number' ||
    !Number.isSafeInteger(candidate) ||
    candidate < bounds.min ||
    candidate > bounds.max
  ) {
    throw new NodeSlideRunBudgetValidationError(
      field,
      `expected an integer from ${bounds.min} through ${bounds.max}`,
    );
  }
  return candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type NodeSlidePricingUnknownReason = 'provider_pricing_not_pinned' | 'model_not_cataloged';

export interface NodeSlidePricedModelMetadata {
  readonly version: typeof NODESLIDE_MODEL_PRICING_VERSION;
  readonly kind: 'priced';
  readonly modelId: string;
  readonly currency: 'USD';
  readonly billingUnit: 'million_tokens';
  readonly inputMicroUsdPerMillionTokens: number;
  readonly outputMicroUsdPerMillionTokens: number;
  readonly providerContextWindowTokens: number;
  readonly providerMaxOutputTokens: number;
  readonly source: 'openrouter_model_catalog_api';
  readonly sourceUrl: typeof NODESLIDE_MODEL_PRICING_SOURCE_URL;
  readonly verifiedAt: typeof NODESLIDE_MODEL_PRICING_VERIFIED_AT;
}

export interface NodeSlideZeroCostModelMetadata {
  readonly version: typeof NODESLIDE_MODEL_PRICING_VERSION;
  readonly kind: 'zero_cost';
  readonly modelId: typeof NODESLIDE_PRIVATE_DETERMINISTIC_MODEL;
  readonly currency: 'USD';
  readonly billingUnit: 'none';
  readonly inputMicroUsdPerMillionTokens: 0;
  readonly outputMicroUsdPerMillionTokens: 0;
  readonly providerMaxOutputTokens: number;
  readonly source: 'private_deterministic_route';
}

/**
 * A route whose per-token price is not a property of the route.
 *
 * `openrouter/free` resolves to an arbitrary upstream model per request, and the
 * `:free` variants are promotional tiers the provider re-prices or withdraws
 * without a contract change. The catalog API reports `"0"` for all of them, and
 * that string is the single most dangerous number in this file: scoring it as a
 * price makes the worst case zero, which makes the reservation zero, which is an
 * UNBOUNDED authorization wearing a conservative-looking value. So a dynamic
 * route is a distinct kind rather than a priced row with zeros in it, and it is
 * deliberately NOT a member of `NodeSlideScoredModelMetadata` — the type system,
 * not a reviewer, is what stops it from reaching `scoreNodeSlideWorstCaseCost`
 * as if it were scorable.
 */
export interface NodeSlideDynamicModelPricing {
  readonly version: typeof NODESLIDE_MODEL_PRICING_VERSION;
  readonly kind: 'dynamic';
  readonly modelId: string;
  readonly reason: 'provider_pricing_dynamic';
  /** Stated in the denial a caller sees; never a number, because there is none. */
  readonly statedReason: string;
  readonly source: 'openrouter_zero_priced_dynamic_route';
  readonly sourceUrl: typeof NODESLIDE_MODEL_PRICING_SOURCE_URL;
  readonly verifiedAt: typeof NODESLIDE_MODEL_PRICING_VERIFIED_AT;
}

export interface NodeSlideUnknownModelPricing {
  readonly version: typeof NODESLIDE_MODEL_PRICING_VERSION;
  readonly kind: 'unknown';
  readonly modelId: string;
  readonly reason: NodeSlidePricingUnknownReason;
  readonly source: 'openrouter_dynamic_catalog' | 'nebius_private_catalog' | 'unrecognized_model';
}

export type NodeSlideScoredModelMetadata =
  | NodeSlidePricedModelMetadata
  | NodeSlideZeroCostModelMetadata;
/** Everything a reservation cannot be computed from. Every member denies. */
export type NodeSlideUnscoredModelPricing =
  | NodeSlideUnknownModelPricing
  | NodeSlideDynamicModelPricing;
export type NodeSlideModelPricingMetadata =
  | NodeSlideScoredModelMetadata
  | NodeSlideUnscoredModelPricing;

export type NodeSlideWorstCaseCostScore =
  | {
      readonly kind: 'scored';
      readonly model: string;
      readonly pricing: NodeSlideScoredModelMetadata;
      readonly inputCostMicroUsd: number;
      readonly outputCostMicroUsd: number;
      readonly totalCostMicroUsd: number;
    }
  | {
      readonly kind: 'unscored';
      readonly model: string;
      readonly reason: 'pricing_unknown';
      readonly pricing: NodeSlideUnscoredModelPricing;
      readonly inputCostMicroUsd: null;
      readonly outputCostMicroUsd: null;
      readonly totalCostMicroUsd: null;
    };

export interface NodeSlideRunBudgetAccumulated {
  readonly costMicroUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly elapsedMs: number;
  readonly iterations: number;
  readonly toolCalls: number;
}

export interface NodeSlideRunBudgetRemaining {
  readonly costMicroUsd: number;
  readonly costUsd: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly durationMs: number;
  readonly iterations: number;
  readonly toolCalls: number;
}

export interface NodeSlideRunBudgetState {
  readonly version: typeof NODESLIDE_RUN_BUDGET_STATE_VERSION;
  readonly budget: NodeSlideRunBudget;
  readonly accumulated: NodeSlideRunBudgetAccumulated;
  readonly receiptDigests: Readonly<Record<string, string>>;
  readonly digest: string;
}

export interface NodeSlideRunBudgetReceipt {
  readonly version: typeof NODESLIDE_RUN_BUDGET_RECEIPT_VERSION;
  readonly idempotencyKey: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicroUsd: number;
  readonly elapsedMs: number;
  readonly iterations: number;
  readonly toolCalls: number;
}

export type NodeSlideRunBudgetTerminalReason =
  | { readonly code: 'max_cost_reached'; readonly used: number; readonly limit: number }
  | { readonly code: 'max_input_tokens_reached'; readonly used: number; readonly limit: number }
  | { readonly code: 'max_output_tokens_reached'; readonly used: number; readonly limit: number }
  | { readonly code: 'max_duration_reached'; readonly used: number; readonly limit: number }
  | { readonly code: 'max_iterations_reached'; readonly used: number; readonly limit: number }
  | { readonly code: 'max_tool_calls_reached'; readonly used: number; readonly limit: number };

export type NodeSlideRunBudgetPreflightDenialReason =
  | NodeSlideRunBudgetTerminalReason
  | {
      readonly code: 'invalid_preflight';
      readonly field: string;
      readonly message: string;
    }
  | { readonly code: 'state_digest_mismatch' }
  | {
      readonly code: 'pricing_unknown';
      readonly model: string;
      readonly pricing: NodeSlideUnscoredModelPricing;
    }
  | {
      readonly code: 'estimated_input_exceeds_remaining';
      readonly estimatedInputTokens: number;
      readonly remainingInputTokens: number;
    }
  | {
      readonly code: 'model_context_exceeded';
      readonly estimatedInputTokens: number;
      readonly providerContextWindowTokens: number;
    }
  | {
      readonly code: 'cost_budget_exceeded';
      readonly remainingCostMicroUsd: number;
      readonly inputCostMicroUsd: number;
      readonly minimumOutputCostMicroUsd: number;
    };

export type NodeSlideRunBudgetPreflightResult =
  | {
      readonly ok: true;
      readonly model: string;
      readonly pricing: NodeSlideScoredModelMetadata;
      readonly providerSafeOutputTokenCeiling: number;
      readonly providerTimeoutMs: number;
      readonly worstCaseCostMicroUsd: number;
      readonly remainingBeforeCall: NodeSlideRunBudgetRemaining;
      readonly stateDigest: string;
      readonly decisionDigest: string;
    }
  | {
      readonly ok: false;
      readonly reason: NodeSlideRunBudgetPreflightDenialReason;
      readonly remaining: NodeSlideRunBudgetRemaining;
      readonly stateDigest: string;
    };

export type NodeSlideRunBudgetPostflightRejection =
  | { readonly code: 'state_digest_mismatch' }
  | {
      readonly code: 'invalid_receipt';
      readonly field: string;
      readonly message: string;
    }
  | {
      readonly code: 'receipt_replay_mismatch';
      readonly idempotencyKey: string;
      readonly existingDigest: string;
      readonly receivedDigest: string;
    }
  | { readonly code: 'receipt_ledger_full'; readonly limit: number };

export type NodeSlideRunBudgetPostflightResult =
  | {
      readonly ok: true;
      readonly applied: boolean;
      readonly receiptDigest: string;
      readonly state: NodeSlideRunBudgetState;
      readonly remaining: NodeSlideRunBudgetRemaining;
      readonly terminalReason: NodeSlideRunBudgetTerminalReason | null;
    }
  | {
      readonly ok: false;
      readonly reason: NodeSlideRunBudgetPostflightRejection;
      readonly state: NodeSlideRunBudgetState;
      readonly remaining: NodeSlideRunBudgetRemaining;
      readonly terminalReason: NodeSlideRunBudgetTerminalReason | null;
    };

/**
 * WHERE THESE NUMBERS CAME FROM, and how to check them.
 *
 * SOURCE:   https://openrouter.ai/api/v1/models — the provider's own machine
 *           catalog, not a docs page, not a pricing page, not a paste from a
 *           conversation. Every row below was read out of one response body.
 * FETCHED:  2026-07-28T00:00:00Z (see NODESLIDE_MODEL_PRICING_VERIFIED_AT).
 * UNIT:     `pricing.prompt` / `pricing.completion` are USD per single token.
 *           This table stores integer micro-USD per MILLION tokens, so every
 *           value is the catalog string multiplied by 1e12. Integers only: the
 *           whole ledger accounts in micro-USD and a float here would round a
 *           reservation, which is the one place rounding down is a loan.
 * WINDOWS:  `providerContextWindowTokens` is `context_length`;
 *           `providerMaxOutputTokens` is `top_provider.max_completion_tokens`.
 *           Where the catalog reports `null` for the completion cap — currently
 *           `moonshotai/kimi-k3` only — the context window is the binding
 *           provider limit and is recorded as such. That is read from the same
 *           response, not assumed.
 *
 * TO RE-VERIFY: fetch the URL, and for each row assert
 *   `pricing.prompt * 1e12 === inputMicroUsdPerMillionTokens` and the same for
 *   completion. `nodeslideRunBudget.test.ts` states the expected catalog values
 *   independently so a careless edit to this table fails rather than silently
 *   re-prices production. Prices change; a stale table is a silent overcharge
 *   in one direction and a silent under-reservation in the other.
 *
 * NOT IN THIS TABLE, deliberately:
 *   - `nodeslide/private-deterministic`. It issues no provider request, so a
 *     per-token price for it would be fiction. It is a separate `zero_cost`
 *     constant whose zero is a fact about the route, not a price.
 *   - The five zero-priced dynamic routes. See `NodeSlideDynamicModelPricing`.
 *   - `nebius/zai-org/GLM-5.2`. It is not an OpenRouter route and its price
 *     lives behind a private Nebius endpoint this table's fetch cannot read, so
 *     it is `unknown` and DENIES. Porting the previously recorded Nebius figure
 *     would have been landing a number nobody re-verified today, which is the
 *     exact defect this docstring exists to prevent. The route is
 *     `productionEnabled: false`; a denial degrades it to the deterministic
 *     fallback rather than billing against an unchecked price.
 */
export const NODESLIDE_MODEL_PRICING_SOURCE_URL = 'https://openrouter.ai/api/v1/models' as const;
export const NODESLIDE_MODEL_PRICING_VERIFIED_AT = '2026-07-28T00:00:00Z' as const;

type NodeSlideCatalogPricingMetadata =
  | NodeSlidePricedModelMetadata
  | NodeSlideDynamicModelPricing
  | NodeSlideUnknownModelPricing;

function pricedRoute(args: {
  modelId: NodeSlideAgentModelId;
  inputMicroUsdPerMillionTokens: number;
  outputMicroUsdPerMillionTokens: number;
  providerContextWindowTokens: number;
  providerMaxOutputTokens: number;
}): NodeSlidePricedModelMetadata {
  return {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'priced',
    currency: 'USD',
    billingUnit: 'million_tokens',
    source: 'openrouter_model_catalog_api',
    sourceUrl: NODESLIDE_MODEL_PRICING_SOURCE_URL,
    verifiedAt: NODESLIDE_MODEL_PRICING_VERIFIED_AT,
    ...args,
  };
}

function dynamicRoute(
  modelId: NodeSlideAgentModelId,
  statedReason: string,
): NodeSlideDynamicModelPricing {
  return {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'dynamic',
    modelId,
    reason: 'provider_pricing_dynamic',
    statedReason,
    source: 'openrouter_zero_priced_dynamic_route',
    sourceUrl: NODESLIDE_MODEL_PRICING_SOURCE_URL,
    verifiedAt: NODESLIDE_MODEL_PRICING_VERIFIED_AT,
  };
}

/**
 * Exhaustive over `NodeSlideAgentModelId` by construction. Adding a route to
 * `shared/nodeslide.ts` without a row here is a type error, and the only rows
 * that can be written are priced, dynamic, or unknown — there is no shape for
 * "cataloged and free".
 */
export const NODESLIDE_MODEL_PRICING = {
  'nebius/zai-org/GLM-5.2': {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'unknown',
    modelId: 'nebius/zai-org/GLM-5.2',
    reason: 'provider_pricing_not_pinned',
    source: 'nebius_private_catalog',
  },
  'moonshotai/kimi-k3': pricedRoute({
    modelId: 'moonshotai/kimi-k3',
    inputMicroUsdPerMillionTokens: 3_000_000,
    outputMicroUsdPerMillionTokens: 15_000_000,
    providerContextWindowTokens: 1_048_576,
    // The catalog reports `top_provider.max_completion_tokens: null` for this
    // route, so the context window is the provider's binding output limit.
    providerMaxOutputTokens: 1_048_576,
  }),
  'z-ai/glm-5.2': pricedRoute({
    modelId: 'z-ai/glm-5.2',
    inputMicroUsdPerMillionTokens: 768_600,
    outputMicroUsdPerMillionTokens: 2_415_600,
    providerContextWindowTokens: 1_048_576,
    providerMaxOutputTokens: 131_072,
  }),
  'anthropic/claude-sonnet-5': pricedRoute({
    modelId: 'anthropic/claude-sonnet-5',
    inputMicroUsdPerMillionTokens: 2_000_000,
    outputMicroUsdPerMillionTokens: 10_000_000,
    providerContextWindowTokens: 1_000_000,
    providerMaxOutputTokens: 128_000,
  }),
  'anthropic/claude-fable-5': pricedRoute({
    modelId: 'anthropic/claude-fable-5',
    inputMicroUsdPerMillionTokens: 10_000_000,
    outputMicroUsdPerMillionTokens: 50_000_000,
    providerContextWindowTokens: 1_000_000,
    providerMaxOutputTokens: 128_000,
  }),
  'google/gemini-3.5-flash': pricedRoute({
    modelId: 'google/gemini-3.5-flash',
    inputMicroUsdPerMillionTokens: 1_500_000,
    outputMicroUsdPerMillionTokens: 9_000_000,
    providerContextWindowTokens: 1_048_576,
    providerMaxOutputTokens: 65_536,
  }),
  'google/gemini-3.1-pro-preview': pricedRoute({
    modelId: 'google/gemini-3.1-pro-preview',
    inputMicroUsdPerMillionTokens: 2_000_000,
    outputMicroUsdPerMillionTokens: 12_000_000,
    providerContextWindowTokens: 1_048_576,
    providerMaxOutputTokens: 65_536,
  }),
  'openai/gpt-5.6-sol': pricedRoute({
    modelId: 'openai/gpt-5.6-sol',
    inputMicroUsdPerMillionTokens: 5_000_000,
    outputMicroUsdPerMillionTokens: 30_000_000,
    providerContextWindowTokens: 1_050_000,
    providerMaxOutputTokens: 128_000,
  }),
  'openai/gpt-5.6-terra': pricedRoute({
    modelId: 'openai/gpt-5.6-terra',
    inputMicroUsdPerMillionTokens: 1_250_000,
    outputMicroUsdPerMillionTokens: 7_500_000,
    providerContextWindowTokens: 1_050_000,
    providerMaxOutputTokens: 128_000,
  }),
  'openrouter/free': dynamicRoute(
    'openrouter/free',
    'The free router selects an upstream model per request, so no per-token price can be quoted before dispatch.',
  ),
  'google/gemma-4-26b-a4b-it:free': dynamicRoute(
    'google/gemma-4-26b-a4b-it:free',
    'This is a promotional zero-priced tier, not a contracted price; it is denied rather than reserved at zero.',
  ),
  'google/gemma-4-31b-it:free': dynamicRoute(
    'google/gemma-4-31b-it:free',
    'This is a promotional zero-priced tier, not a contracted price; it is denied rather than reserved at zero.',
  ),
  'nvidia/nemotron-3-super-120b-a12b:free': dynamicRoute(
    'nvidia/nemotron-3-super-120b-a12b:free',
    'This is a promotional zero-priced tier, not a contracted price; it is denied rather than reserved at zero.',
  ),
  'openai/gpt-oss-20b:free': dynamicRoute(
    'openai/gpt-oss-20b:free',
    'This is a promotional zero-priced tier, not a contracted price; it is denied rather than reserved at zero.',
  ),
} as const satisfies Record<NodeSlideAgentModelId, NodeSlideCatalogPricingMetadata>;

/**
 * The one route whose zero is a fact rather than a price: it issues no provider
 * request at all, so there is nothing to meter and nothing to reserve.
 */
const PRIVATE_DETERMINISTIC_PRICING: NodeSlideZeroCostModelMetadata = {
  version: NODESLIDE_MODEL_PRICING_VERSION,
  kind: 'zero_cost',
  modelId: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
  currency: 'USD',
  billingUnit: 'none',
  inputMicroUsdPerMillionTokens: 0,
  outputMicroUsdPerMillionTokens: 0,
  providerMaxOutputTokens: NODESLIDE_RUN_BUDGET_BOUNDS.maxOutputTokens.max,
  source: 'private_deterministic_route',
};

export function nodeSlideModelPricing(model: string): NodeSlideModelPricingMetadata {
  if (model === NODESLIDE_PRIVATE_DETERMINISTIC_MODEL) {
    return PRIVATE_DETERMINISTIC_PRICING;
  }
  if (Object.prototype.hasOwnProperty.call(NODESLIDE_MODEL_PRICING, model)) {
    return NODESLIDE_MODEL_PRICING[
      model as NodeSlideAgentModelId
    ] as NodeSlideCatalogPricingMetadata;
  }
  return {
    version: NODESLIDE_MODEL_PRICING_VERSION,
    kind: 'unknown',
    modelId: model,
    reason: 'model_not_cataloged',
    source: 'unrecognized_model',
  };
}

/** True only for pricing a reservation can actually be computed from. */
export function isNodeSlideScoredPricing(
  pricing: NodeSlideModelPricingMetadata,
): pricing is NodeSlideScoredModelMetadata {
  return pricing.kind === 'priced' || pricing.kind === 'zero_cost';
}

/**
 * The refusal a caller reads. Every unscorable route states WHY it cannot be
 * reserved; none of them is ever reported as free.
 */
export function nodeSlidePricingRefusalReason(pricing: NodeSlideUnscoredModelPricing): string {
  if (pricing.kind === 'dynamic') return pricing.statedReason;
  return pricing.reason === 'model_not_cataloged'
    ? `The model ${pricing.modelId} is not in this deployment's route catalog, so no reservation can be computed.`
    : `The route ${pricing.modelId} has no server-pinned price in this deployment, so no reservation can be computed.`;
}

export function scoreNodeSlideWorstCaseCost(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): NodeSlideWorstCaseCostScore {
  assertPricingModel(args.model);
  assertAccountingInteger('inputTokens', args.inputTokens);
  assertAccountingInteger('outputTokens', args.outputTokens);
  const pricing = nodeSlideModelPricing(args.model);
  if (!isNodeSlideScoredPricing(pricing)) {
    return {
      kind: 'unscored',
      model: args.model,
      reason: 'pricing_unknown',
      pricing,
      inputCostMicroUsd: null,
      outputCostMicroUsd: null,
      totalCostMicroUsd: null,
    };
  }
  const inputCostMicroUsd = conservativeTokenCost(
    args.inputTokens,
    pricing.inputMicroUsdPerMillionTokens,
  );
  const outputCostMicroUsd = conservativeTokenCost(
    args.outputTokens,
    pricing.outputMicroUsdPerMillionTokens,
  );
  return {
    kind: 'scored',
    model: args.model,
    pricing,
    inputCostMicroUsd,
    outputCostMicroUsd,
    totalCostMicroUsd: inputCostMicroUsd + outputCostMicroUsd,
  };
}

/** Rounds UP. A reservation that rounds down is a loan the ledger never books. */
function conservativeTokenCost(tokens: number, microUsdPerMillionTokens: number): number {
  if (tokens === 0 || microUsdPerMillionTokens === 0) return 0;
  const numerator = BigInt(tokens) * BigInt(microUsdPerMillionTokens);
  const denominator = BigInt(NODESLIDE_TOKENS_PER_PRICING_UNIT);
  const cost = (numerator + denominator - 1n) / denominator;
  const result = Number(cost);
  if (!Number.isSafeInteger(result)) {
    throw new NodeSlideRunBudgetValidationError('cost', 'calculation exceeds safe range');
  }
  return result;
}

function assertPricingModel(model: string): void {
  if (
    typeof model !== 'string' ||
    model.length < 1 ||
    model.length > 256 ||
    model.trim() !== model
  ) {
    throw new NodeSlideRunBudgetValidationError(
      'model',
      'expected a trimmed model identifier of 1 through 256 characters',
    );
  }
}

function assertAccountingInteger(field: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new NodeSlideRunBudgetValidationError(field, 'expected a non-negative safe integer');
  }
}
