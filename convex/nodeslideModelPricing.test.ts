/**
 * The price table is money. This file is the second opinion on it.
 *
 * `shared/nodeslideRunBudget.ts` stores integer micro-USD per million tokens.
 * The provider catalog at https://openrouter.ai/api/v1/models publishes decimal
 * USD per single token. Those are different units by a factor of 1e12, and a
 * table transcribed by hand between them can be wrong by three orders of
 * magnitude without looking wrong. So the catalog values are restated here, in
 * the provider's own units and exactly as the catalog printed them on
 * 2026-07-28, and the test does the conversion itself.
 *
 * That is deliberately a SECOND transcription, not an import. Importing the
 * table and asserting it equals itself would pass on any value at all. If these
 * two transcriptions ever disagree, one of them is wrong and someone has to go
 * back to the endpoint — which is the correct outcome, because a table nobody
 * re-derives is a silent overcharge waiting for a price change.
 *
 * WHAT THIS FILE CANNOT DO: it cannot tell you the prices are still current. It
 * pins the table to a recorded observation. Re-fetch the endpoint and update
 * both transcriptions together when the recorded date gets old.
 */
import { describe, expect, it } from 'vitest';
import { NODESLIDE_AGENT_MODELS, type NodeSlideAgentModelId } from '../shared/nodeslide';
import {
  NODESLIDE_MODEL_PRICING,
  NODESLIDE_MODEL_PRICING_SOURCE_URL,
  NODESLIDE_MODEL_PRICING_VERIFIED_AT,
  NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
  isNodeSlideScoredPricing,
  nodeSlideModelPricing,
  nodeSlidePricingRefusalReason,
  scoreNodeSlideWorstCaseCost,
} from '../shared/nodeslideRunBudget';

/**
 * Read out of the `data[]` entry for each id on 2026-07-28: `pricing.prompt`,
 * `pricing.completion` (USD per token, as strings), `context_length`, and
 * `top_provider.max_completion_tokens`. `null` is recorded as null, not guessed.
 */
const OPENROUTER_CATALOG_2026_07_28 = {
  'moonshotai/kimi-k3': {
    prompt: '0.000003',
    completion: '0.000015',
    contextLength: 1_048_576,
    maxCompletionTokens: null,
  },
  'z-ai/glm-5.2': {
    prompt: '0.0000007686',
    completion: '0.0000024156',
    contextLength: 1_048_576,
    maxCompletionTokens: 131_072,
  },
  'anthropic/claude-sonnet-5': {
    prompt: '0.000002',
    completion: '0.00001',
    contextLength: 1_000_000,
    maxCompletionTokens: 128_000,
  },
  'anthropic/claude-fable-5': {
    prompt: '0.00001',
    completion: '0.00005',
    contextLength: 1_000_000,
    maxCompletionTokens: 128_000,
  },
  'google/gemini-3.5-flash': {
    prompt: '0.0000015',
    completion: '0.000009',
    contextLength: 1_048_576,
    maxCompletionTokens: 65_536,
  },
  'google/gemini-3.1-pro-preview': {
    prompt: '0.000002',
    completion: '0.000012',
    contextLength: 1_048_576,
    maxCompletionTokens: 65_536,
  },
  'openai/gpt-5.6-sol': {
    prompt: '0.000005',
    completion: '0.00003',
    contextLength: 1_050_000,
    maxCompletionTokens: 128_000,
  },
  'openai/gpt-5.6-terra': {
    prompt: '0.00000125',
    completion: '0.0000075',
    contextLength: 1_050_000,
    maxCompletionTokens: 128_000,
  },
} as const satisfies Partial<
  Record<
    NodeSlideAgentModelId,
    {
      prompt: string;
      completion: string;
      contextLength: number;
      maxCompletionTokens: number | null;
    }
  >
>;

/** The routes the catalog prices at "0" per token. Never a price; always a deny. */
const OPENROUTER_ZERO_PRICED_ROUTES: readonly NodeSlideAgentModelId[] = [
  'openrouter/free',
  'google/gemma-4-26b-a4b-it:free',
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openai/gpt-oss-20b:free',
];

/**
 * USD-per-token decimal string -> integer micro-USD per million tokens, without
 * floating-point multiplication. `0.0000007686 * 1e12` is 768599.9999999999 in
 * IEEE 754; doing it on the digits is exact.
 */
function microUsdPerMillionTokens(usdPerToken: string): number {
  const [whole = '0', fraction = ''] = usdPerToken.split('.');
  const scaled = `${whole}${fraction.padEnd(12, '0')}`;
  const shifted = BigInt(scaled) / 10n ** BigInt(Math.max(0, fraction.length - 12));
  return Number(shifted);
}

describe('the recorded catalog observation', () => {
  it('names the endpoint and the date it was read', () => {
    expect(NODESLIDE_MODEL_PRICING_SOURCE_URL).toBe('https://openrouter.ai/api/v1/models');
    expect(NODESLIDE_MODEL_PRICING_VERIFIED_AT).toBe('2026-07-28T00:00:00Z');
  });

  it('converts the provider unit to the ledger unit without floating-point drift', () => {
    // The route that would have silently lost a micro-USD to `* 1e12`.
    expect(microUsdPerMillionTokens('0.0000007686')).toBe(768_600);
    expect(microUsdPerMillionTokens('0.000003')).toBe(3_000_000);
    expect(microUsdPerMillionTokens('0.00005')).toBe(50_000_000);
  });
});

describe('every priced row matches the catalog it claims to come from', () => {
  for (const [modelId, catalog] of Object.entries(OPENROUTER_CATALOG_2026_07_28)) {
    it(`prices ${modelId} exactly as the catalog published it`, () => {
      const pricing = nodeSlideModelPricing(modelId);
      expect(pricing.kind).toBe('priced');
      if (pricing.kind !== 'priced') return;

      expect(pricing.inputMicroUsdPerMillionTokens).toBe(microUsdPerMillionTokens(catalog.prompt));
      expect(pricing.outputMicroUsdPerMillionTokens).toBe(
        microUsdPerMillionTokens(catalog.completion),
      );
      expect(pricing.providerContextWindowTokens).toBe(catalog.contextLength);
      // Where the catalog declares no separate completion cap, the context
      // window is the provider's binding output limit — recorded, not invented.
      expect(pricing.providerMaxOutputTokens).toBe(
        catalog.maxCompletionTokens ?? catalog.contextLength,
      );
      expect(pricing.source).toBe('openrouter_model_catalog_api');
      expect(pricing.sourceUrl).toBe(NODESLIDE_MODEL_PRICING_SOURCE_URL);
      expect(pricing.verifiedAt).toBe(NODESLIDE_MODEL_PRICING_VERIFIED_AT);
      // A price of zero on a metered route is the defect this whole file exists
      // to catch: it makes every worst case zero and every reservation unbounded.
      expect(pricing.inputMicroUsdPerMillionTokens).toBeGreaterThan(0);
      expect(pricing.outputMicroUsdPerMillionTokens).toBeGreaterThan(0);
    });
  }
});

describe('zero-priced and unpriceable routes deny rather than reserve', () => {
  for (const modelId of OPENROUTER_ZERO_PRICED_ROUTES) {
    it(`refuses ${modelId} with a stated reason instead of treating "0" as a price`, () => {
      const pricing = nodeSlideModelPricing(modelId);
      expect(pricing.kind).toBe('dynamic');
      expect(isNodeSlideScoredPricing(pricing)).toBe(false);
      if (pricing.kind !== 'dynamic') return;
      expect(pricing.reason).toBe('provider_pricing_dynamic');
      expect(pricing.statedReason.length).toBeGreaterThan(20);

      // The scorer must refuse it. If this ever returns `scored` with a zero
      // total, the reservation for this route becomes unbounded.
      const scored = scoreNodeSlideWorstCaseCost({
        model: modelId,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      });
      expect(scored.kind).toBe('unscored');
      expect(scored.totalCostMicroUsd).toBeNull();
    });
  }

  it('refuses the Nebius route, whose price this deployment cannot re-verify', () => {
    // Not an OpenRouter route; its price lives behind a private endpoint. A
    // figure carried over from an earlier verification would be a number nobody
    // checked, so the route denies and degrades to the deterministic planner.
    const pricing = nodeSlideModelPricing('nebius/zai-org/GLM-5.2');
    expect(pricing.kind).toBe('unknown');
    expect(isNodeSlideScoredPricing(pricing)).toBe(false);
    expect(nodeSlidePricingRefusalReason(pricing as never)).toContain('nebius/zai-org/GLM-5.2');
  });

  it('refuses a model that is not in the catalog at all', () => {
    const pricing = nodeSlideModelPricing('some-vendor/model-nobody-sells');
    expect(pricing.kind).toBe('unknown');
    if (pricing.kind !== 'unknown') return;
    expect(pricing.reason).toBe('model_not_cataloged');
  });
});

describe('the table is exhaustive over the routes this deployment sells', () => {
  it('has a row for every catalog id, and no rows for anything else', () => {
    const catalogIds = NODESLIDE_AGENT_MODELS.map((model) => model.id).sort();
    expect(Object.keys(NODESLIDE_MODEL_PRICING).sort()).toEqual(catalogIds);
  });

  it('never reports a metered route as free', () => {
    for (const model of NODESLIDE_AGENT_MODELS) {
      const pricing = nodeSlideModelPricing(model.id);
      if (!isNodeSlideScoredPricing(pricing)) continue;
      // `zero_cost` is reserved for the private deterministic route, which is
      // not in the catalog. Any catalog route that scored must carry a price.
      expect(pricing.kind).toBe('priced');
      expect(pricing.inputMicroUsdPerMillionTokens).toBeGreaterThan(0);
      expect(pricing.outputMicroUsdPerMillionTokens).toBeGreaterThan(0);
    }
  });

  it('keeps the deterministic route out of the price table, because it makes no provider call', () => {
    expect(Object.keys(NODESLIDE_MODEL_PRICING)).not.toContain(
      NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
    );
    const pricing = nodeSlideModelPricing(NODESLIDE_PRIVATE_DETERMINISTIC_MODEL);
    // Its zero is a fact about the route — no request is issued — rather than a
    // price read off a catalog. That is why it is a different kind.
    expect(pricing.kind).toBe('zero_cost');
    expect(
      scoreNodeSlideWorstCaseCost({
        model: NODESLIDE_PRIVATE_DETERMINISTIC_MODEL,
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }).totalCostMicroUsd,
    ).toBe(0);
  });
});

describe('worst-case scoring rounds against the run, never in its favour', () => {
  it('rounds a fractional micro-USD up', () => {
    // One input token of z-ai/glm-5.2 costs 768_600/1_000_000 = 0.7686
    // micro-USD. Rounding that down to 0 would let an unbounded number of
    // small calls cost nothing at all against the cap.
    const scored = scoreNodeSlideWorstCaseCost({
      model: 'z-ai/glm-5.2',
      inputTokens: 1,
      outputTokens: 0,
    });
    expect(scored.totalCostMicroUsd).toBe(1);
  });

  it('computes the exact worst case for a full million tokens each way', () => {
    const scored = scoreNodeSlideWorstCaseCost({
      model: 'anthropic/claude-fable-5',
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });
    // $10/M in + $50/M out = $60 = 60_000_000 micro-USD.
    expect(scored.totalCostMicroUsd).toBe(60_000_000);
  });
});
