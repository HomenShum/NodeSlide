/**
 * NodeSlide run budget — PRICE-INDEPENDENT SUPERSET. This is still not the whole
 * module, but the withheld surface is now exactly three symbols, not thirty.
 *
 * Everything below is copied verbatim from parity's
 * `shared/nodeslideRunBudget.ts`: contract versions, the bounds table, budget
 * normalization and its validation error, the spend-constraint parser, the
 * micro-USD decimal parser, the pricing-metadata SHAPES, and the whole
 * state/receipt/preflight/postflight type surface. None of it names a model id
 * or carries a number that is a price.
 *
 * WITHHELD, still pending an owner pricing decision — exactly three exports:
 *   - `NODESLIDE_MODEL_PRICING`     — the model -> price record itself.
 *   - `nodeSlideModelPricing()`     — the lookup into that record.
 *   - `scoreNodeSlideWorstCaseCost()` — the only function that turns tokens into
 *     a currency figure; it is a pure consumer of the two above.
 *
 * WHY those three and nothing more: parity's record is declared
 * `satisfies Record<NodeSlideAgentModelId, ...>`, i.e. exhaustive over ITS
 * catalog, and the two catalogs diverge in BOTH directions. Parity prices
 * 'openai/gpt-5.6-luna', which this repo does not sell; this repo sells six
 * models parity does not price at all (moonshotai/kimi-k3, openrouter/free,
 * google/gemma-4-26b-a4b-it:free, google/gemma-4-31b-it:free,
 * nvidia/nemotron-3-super-120b-a12b:free, openai/gpt-oss-20b:free). Landing the
 * record here means writing real per-million-token input and output prices for
 * those six live routes. That is a product decision, not a merge decision, and a
 * wrong price does not fail loudly — it silently mis-bills, or wrongly admits a
 * run past its cost cap. Weakening the `satisfies` clause to `Record<string, …>`
 * to dodge the error would delete the exhaustiveness guarantee that makes adding
 * an unpriced model impossible, so that is not an option either.
 *
 * Note what this costs and what it does not: the shapes below
 * (`NodeSlidePricedModelMetadata`, `NodeSlideScoredModelMetadata`,
 * `NodeSlideUnknownModelPricing`) are structure, not prices, so every downstream
 * consumer that only hashes, forwards, or pattern-matches pricing metadata —
 * the whole budget ledger, for one — compiles and runs today.
 */

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
  readonly source:
    | 'nebius_token_factory_model_catalog'
    | 'openrouter_request_price_ceiling'
    | 'openrouter_model_catalog';
  readonly sourceUrl:
    | 'https://tokenfactory.nebius.com/proxy/inference/private/v1/models_info'
    | 'https://openrouter.ai/docs/guides/routing/provider-selection'
    | 'https://openrouter.ai/google/gemini-3.5-flash/pricing';
  readonly verifiedAt: '2026-07-16T01:22:40Z' | '2026-07-16T20:30:00Z' | '2026-07-16T23:55:00Z';
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

export interface NodeSlideUnknownModelPricing {
  readonly version: typeof NODESLIDE_MODEL_PRICING_VERSION;
  readonly kind: 'unknown';
  readonly modelId: string;
  readonly reason: NodeSlidePricingUnknownReason;
  readonly source: 'openrouter_dynamic_catalog' | 'unrecognized_model';
}

export type NodeSlideScoredModelMetadata =
  | NodeSlidePricedModelMetadata
  | NodeSlideZeroCostModelMetadata;
export type NodeSlideModelPricingMetadata =
  | NodeSlideScoredModelMetadata
  | NodeSlideUnknownModelPricing;

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
      readonly pricing: NodeSlideUnknownModelPricing;
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
      readonly pricing: NodeSlideUnknownModelPricing;
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
