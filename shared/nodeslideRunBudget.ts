/**
 * NodeSlide run budget — DELIBERATE PARTIAL PORT. This is not the whole module.
 *
 * Parity's `shared/nodeslideRunBudget.ts` exports ~34 symbols. This file carries
 * only the two that the routing-receipt chain actually needs, copied verbatim:
 * `NODESLIDE_RUN_BUDGET_BOUNDS` and its companion input shape. Both are pure
 * numbers and structure, with zero coupling to any model id.
 *
 * WITHHELD, pending an owner decision — do not add piecemeal:
 *   - `NODESLIDE_MODEL_PRICING` and `nodeSlideModelPricing()`, plus the
 *     priced/zero-cost/unknown metadata types and `scoreNodeSlideWorstCaseCost`.
 *   - `normalizeNodeSlideRunBudget`, `parseNodeSlideSpendConstraint`,
 *     `parseUsdDecimalToMicroUsd`, `NodeSlideRunBudgetValidationError`.
 *   - The budget state/receipt/preflight/postflight surface.
 *
 * WHY: the pricing record is keyed by model id, and the two catalogs diverge in
 * BOTH directions. Parity carries 'openai/gpt-5.6-luna', which this repo does
 * not sell; this repo carries six models parity does not price at all
 * (moonshotai/kimi-k3, openrouter/free, google/gemma-4-26b-a4b-it:free,
 * google/gemma-4-31b-it:free, nvidia/nemotron-3-super-120b-a12b:free,
 * openai/gpt-oss-20b:free). Closing that gap means setting real per-million-token
 * prices for six live models. That is a product/pricing decision, not a merge
 * decision, so it is refused here rather than guessed — a wrong price does not
 * fail loudly, it silently mis-bills or wrongly admits a run past its cost cap.
 *
 * The full module remains tracked as an open MERGE. When it lands, it must be a
 * SUPERSET of this file: the two symbols below are byte-identical to parity's, so
 * the overlap is identical-content and safe to reconcile.
 */

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
