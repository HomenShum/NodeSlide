/**
 * The price table is money. This file is the second opinion on it.
 *
 * `shared/nodeslideRunBudget.ts` stores integer micro-USD per million tokens.
 * The provider catalog at https://openrouter.ai/api/v1/models publishes decimal
 * USD per single token. Those are different units by a factor of 1e12, and a
 * table transcribed by hand between them can be wrong by three orders of
 * magnitude without looking wrong. So the catalog values are restated here, in
 * the provider's own units and exactly as the catalog printed them on
 * 2026-10-14, and the test does the conversion itself.
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call as callMcpByok } from '../mcp/src/lib/llmClient';
import {
  NODESLIDE_AGENT_MODELS,
  type NodeSlideAgentModelId,
  nodeSlideAgentModel,
} from '../shared/nodeslide';
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
import { decideNodeSlideAutoRoute } from './lib/nodeslideAutoRoutingPolicy';
import {
  NODESLIDE_KIMI_K3,
  NODESLIDE_OPENROUTER_MODEL_OVERRIDES,
  callNodeSlideFreeJson,
  openrouterProviderWithOverrides,
} from './lib/nodeslideProvider';

/**
 * Read out of the `data[]` entry for each id on 2026-10-14: `pricing.prompt`,
 * `pricing.completion` (USD per token, as strings), `context_length`, and
 * `top_provider.max_completion_tokens`. `null` is recorded as null, not guessed.
 */
const OPENROUTER_CATALOG_2026_10_14 = {
  // Was 0.000003 / 0.000015 (and maxCompletionTokens null) on 2026-07-28.
  'moonshotai/kimi-k3': {
    prompt: '0.0000007',
    completion: '0.000015',
    contextLength: 1_048_576,
    maxCompletionTokens: 943_718,
  },
  // Was 0.0000007686 / 0.0000024156 and 131_072 on 2026-07-28.
  'z-ai/glm-5.2': {
    prompt: '0.00000005',
    completion: '0.000007',
    contextLength: 1_048_576,
    maxCompletionTokens: 943_718,
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
  'anthropic/claude-sonnet-5.5': {
    prompt: '0.000002',
    completion: '0.00001',
    contextLength: 1_000_000,
    maxCompletionTokens: 128_000,
  },
  'anthropic/claude-opus-5.5': {
    prompt: '0.000004',
    completion: '0.00002',
    contextLength: 1_000_000,
    maxCompletionTokens: 128_000,
  },
  'google/gemini-3.5-flash': {
    prompt: '0.0000015',
    completion: '0.000009',
    contextLength: 1_048_576,
    maxCompletionTokens: 65_536,
  },
  'google/gemini-3.8-flash': {
    prompt: '0.00000075',
    completion: '0.00000375',
    contextLength: 1_048_576,
    maxCompletionTokens: 65_536,
  },
  'google/gemini-3.1-pro-preview': {
    prompt: '0.000002',
    completion: '0.000012',
    contextLength: 1_048_576,
    maxCompletionTokens: 65_536,
  },
  // Was 0.000005 / 0.00003 on 2026-07-28.
  'openai/gpt-5.6-sol': {
    prompt: '0.000002',
    completion: '0.00001',
    contextLength: 1_050_000,
    maxCompletionTokens: 128_000,
  },
  // Was 0.00000125 / 0.0000075 on 2026-07-28.
  'openai/gpt-5.6-terra': {
    prompt: '0.000002',
    completion: '0.000012',
    contextLength: 1_050_000,
    maxCompletionTokens: 128_000,
  },
  'openai/gpt-6.1-sol': {
    prompt: '0.000002',
    completion: '0.00001',
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
    expect(NODESLIDE_MODEL_PRICING_VERIFIED_AT).toBe('2026-10-14T16:03:00Z');
  });

  it('converts the provider unit to the ledger unit without floating-point drift', () => {
    // The route that would have silently lost a micro-USD to `* 1e12`.
    expect(microUsdPerMillionTokens('0.0000007686')).toBe(768_600);
    expect(microUsdPerMillionTokens('0.0000007')).toBe(700_000);
    expect(microUsdPerMillionTokens('0.000003')).toBe(3_000_000);
    expect(microUsdPerMillionTokens('0.00005')).toBe(50_000_000);
  });
});

describe('every priced row matches the catalog it claims to come from', () => {
  for (const [modelId, catalog] of Object.entries(OPENROUTER_CATALOG_2026_10_14)) {
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

/**
 * Part A rule 6: every pricing source in this repo, each with its date, one test, equal
 * `{inPerM, outPerM}` per (id, OpenRouter transport). The sources:
 *
 *   1. the ledger table `NODESLIDE_MODEL_PRICING` (also the reservation quote and the OpenRouter
 *      `max_price` ceiling), pricingAsOf `NODESLIDE_MODEL_PRICING_VERIFIED_AT` (2026-10-14T16:03Z);
 *   2. the hand-typed `Model<>` overrides in `nodeslideProvider.ts`, same pricingAsOf;
 *   3. the provider the dispatcher actually builds (`openrouterProviderWithOverrides`): its rows
 *      price every response (`usage.cost.total` -> `costMicroUsd`). Its base rows are the bundled
 *      pi-ai 1.1.0 OpenRouter catalog, which is NOT dated by us and disagreed with the ledger on
 *      two rows when read on 2026-10-14: moonshotai/kimi-k3 0.5 / 15 (ledger 0.7 / 15) and
 *      z-ai/glm-5.2 0.171 / 7.2 (ledger 0.05 / 7). The provider therefore prices every ledger-priced
 *      row at the ledger's rate, and this test is what notices the day that stops being true;
 *   4. the auto-router estimate (`nodeslideAutoRoutingPolicy.ts`), which read the same pi-ai
 *      catalog: it caps a job-create request's cost, so an under-estimate admits a route the ledger
 *      would refuse. It prices ledger-priced routes at the ledger's rate for the same reason;
 *   5. the MCP BYOK client (`mcp/src/lib/llmClient.ts`), which called `getModel` on the raw pi-ai
 *      catalog and reported `usage.cost.total` as `costUsd` (kimi-k3 $0.015500 against the ledger's
 *      $0.015700 for 1k in / 1k out, glm-5.2 $0.007371 against $0.007050). It prices OpenRouter
 *      routes through `nodeSlideLedgerPricedCost`, the function the provider in 3 uses. It carries
 *      no date of its own: it takes the ledger's, `NODESLIDE_MODEL_PRICING_VERIFIED_AT`.
 *
 * Cache rates are part of the agreement, not only input and output: the reservation quote prices
 * every input token at the ledger's input rate, so a cached-read token must not cost more than that
 * (pi-ai's glm-5.2 row said 0.162 against 0.05, which settled 100k cached tokens at 3.24x their
 * quote and left a valid response unreconciled), and a cache-write premium must stay inside the
 * quote's 2x input-estimate headroom (Claude and GPT rows bill writes at 1.25x).
 *
 * Above-threshold tiers (pi-ai lists a higher rate above 200K-272K prompt tokens for gemini-3.1-pro
 * and the gpt-5.6 / gpt-6.1 rows) are pi-ai-only data the flat ledger does not model; a NodeSlide
 * prompt is bounded far below the threshold by the read-context limit.
 */
describe('every pricing source in this repo agrees (Part A rule 6)', () => {
  const ledgerPricedOpenRouterRoutes = NODESLIDE_AGENT_MODELS.filter(
    (model) => model.provider === 'openrouter' && nodeSlideModelPricing(model.id).kind === 'priced',
  );
  const perMillion = (usdPerMillion: number) => Math.round(usdPerMillion * 1_000_000);
  const textOnly = { web: false, longContext: false, image: false, reasoning: false };

  function autoRoute(modelId: NodeSlideAgentModelId, maxUsd: number) {
    return decideNodeSlideAutoRoute({
      task: 'compose-deck',
      capabilities: textOnly,
      privacy: 'external_if_consented',
      requestedReasoningEffort: null,
      deterministicAvailable: true,
      consent: { providers: ['openrouter'], models: [modelId] },
      availability: [{ provider: 'openrouter', catalogModelId: modelId, available: true }],
      expectedInputTokens: 100_000,
      expectedOutputTokens: 1_000,
      maxUsd,
      fallbackPolicy: { mode: 'none' },
    });
  }

  it('covers every metered OpenRouter route in the catalog', () => {
    // A route added to the catalog without a ledger price fails the exhaustiveness test above; this
    // one fails if the filter above ever silently matches nothing.
    expect(ledgerPricedOpenRouterRoutes.length).toBeGreaterThanOrEqual(10);
    expect(ledgerPricedOpenRouterRoutes.map((model) => model.id)).toEqual(
      expect.arrayContaining(['moonshotai/kimi-k3', 'z-ai/glm-5.2', 'anthropic/claude-sonnet-5.5']),
    );
  });

  it('the hand-typed Kimi K3 Model<> override costs what the price table charges', () => {
    const pricing = nodeSlideModelPricing('moonshotai/kimi-k3');
    expect(pricing.kind).toBe('priced');
    if (pricing.kind !== 'priced') return;
    expect(NODESLIDE_KIMI_K3.provider).toBe('openrouter');
    expect(perMillion(NODESLIDE_KIMI_K3.cost.input)).toBe(pricing.inputMicroUsdPerMillionTokens);
    expect(perMillion(NODESLIDE_KIMI_K3.cost.output)).toBe(pricing.outputMicroUsdPerMillionTokens);
    expect(NODESLIDE_KIMI_K3.contextWindow).toBe(pricing.providerContextWindowTokens);
  });

  it('every OpenRouter model override is a priced row that agrees with the table', () => {
    for (const override of NODESLIDE_OPENROUTER_MODEL_OVERRIDES) {
      const pricing = nodeSlideModelPricing(override.id);
      expect(pricing.kind).toBe('priced');
      if (pricing.kind !== 'priced') continue;
      expect(perMillion(override.cost.input)).toBe(pricing.inputMicroUsdPerMillionTokens);
      expect(perMillion(override.cost.output)).toBe(pricing.outputMicroUsdPerMillionTokens);
    }
  });

  it('the provider the dispatcher builds prices every metered route at the ledger rate', () => {
    const models = new Map(
      openrouterProviderWithOverrides()
        .getModels()
        .map((model) => [model.id, model] as const),
    );
    for (const route of ledgerPricedOpenRouterRoutes) {
      const pricing = nodeSlideModelPricing(route.id);
      const model = models.get(route.upstreamId);
      expect(model, `${route.upstreamId} is in the provider`).toBeDefined();
      if (pricing.kind !== 'priced' || !model) continue;
      expect(perMillion(model.cost.input), `${route.id} input`).toBe(
        pricing.inputMicroUsdPerMillionTokens,
      );
      expect(perMillion(model.cost.output), `${route.id} output`).toBe(
        pricing.outputMicroUsdPerMillionTokens,
      );
    }
  });

  it('no cache rate prices a token above what the reservation quote assumed', () => {
    // The quote's input estimate is bytes x MAX_PROVIDER_ATTEMPTS (2) + overhead, i.e. at least twice
    // the tokens ever sent, so a write premium up to 2x the input rate still settles inside it.
    const WRITE_PREMIUM_HEADROOM = 2;
    const models = new Map(
      openrouterProviderWithOverrides()
        .getModels()
        .map((model) => [model.id, model] as const),
    );
    for (const route of ledgerPricedOpenRouterRoutes) {
      const model = models.get(route.upstreamId);
      if (!model) throw new Error(`${route.upstreamId} is missing from the provider`);
      expect(model.cost.cacheRead, `${route.id} cacheRead <= ledger input`).toBeLessThanOrEqual(
        model.cost.input,
      );
      expect(
        model.cost.cacheWrite,
        `${route.id} cacheWrite within the quote's headroom`,
      ).toBeLessThanOrEqual(model.cost.input * WRITE_PREMIUM_HEADROOM);
    }
  });

  describe('a response is costed at the ledger rate through both response paths', () => {
    const originalKey = process.env['OPENROUTER_API_KEY'];
    let usage: Record<string, unknown> = {};
    const sse = () =>
      [
        'data: {"id":"gen-fake","model":"fake/echo","choices":[{"index":0,"delta":{"role":"assistant","content":"{\\"ok\\":true}"},"finish_reason":null}]}\n\n',
        `data: ${JSON.stringify({
          id: 'gen-fake',
          model: 'fake/echo',
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage,
        })}\n\n`,
        'data: [DONE]\n\n',
      ].join('');
    beforeEach(() => {
      process.env['OPENROUTER_API_KEY'] = 'sk-or-test-fake-not-a-credential';
      vi.stubGlobal(
        'fetch',
        async () =>
          new Response(sse(), { status: 200, headers: { 'content-type': 'text/event-stream' } }),
      );
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      if (originalKey === undefined) Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
      else process.env['OPENROUTER_API_KEY'] = originalKey;
    });

    const ledgerMicroUsd = (id: string, inputTokens: number, outputTokens: number) => {
      const pricing = nodeSlideModelPricing(id);
      if (pricing.kind !== 'priced') throw new Error(`${id} is not ledger-priced`);
      return (
        (inputTokens * pricing.inputMicroUsdPerMillionTokens +
          outputTokens * pricing.outputMicroUsdPerMillionTokens) /
        1_000_000
      );
    };
    // MCP routes by vendor prefix; these are the routes it sends to OpenRouter by id.
    const mcpRoutes = ['moonshotai/kimi-k3', 'z-ai/glm-5.2'] as const;
    const mcpCall = (modelId: string) =>
      callMcpByok({
        provider: 'openrouter',
        modelId,
        systemPrompt: 'Return JSON.',
        userText: '{}',
      });

    it('the MCP BYOK client costs 1k in / 1k out at the ledger rate (kimi-k3 $0.015700, glm-5.2 $0.007050)', async () => {
      usage = { prompt_tokens: 1000, completion_tokens: 1000, total_tokens: 2000 };
      for (const id of mcpRoutes) {
        const result = await mcpCall(id);
        expect(result.costUsd * 1_000_000, id).toBeCloseTo(ledgerMicroUsd(id, 1000, 1000), 6);
      }
    });

    it('no response path costs a fully cached prompt above the input rate the quote assumed', async () => {
      // 100k prompt tokens, all served from cache, 10 output tokens (Codex's replay: glm-5.2 settled
      // 16,270 micro-USD against a 15,352 quote before the cache cap).
      usage = {
        prompt_tokens: 100_000,
        completion_tokens: 10,
        total_tokens: 100_010,
        prompt_tokens_details: { cached_tokens: 100_000 },
      };
      for (const route of ledgerPricedOpenRouterRoutes) {
        const ceiling = Math.ceil(ledgerMicroUsd(route.id, 100_000, 10));
        const result = await callNodeSlideFreeJson({
          systemPrompt: 'Return JSON.',
          userText: '{}',
          maxTokens: 500,
          model: route.id,
          reasoningEffort: (route.supportedEfforts as readonly string[]).includes('low')
            ? 'low'
            : 'high',
        });
        expect(result.ok, route.id).toBe(true);
        if (!result.ok) continue;
        expect(result.telemetry.costMicroUsd, `convex ${route.id}`).toBeLessThanOrEqual(ceiling);
      }
      for (const id of mcpRoutes) {
        const result = await mcpCall(id);
        expect(result.costUsd * 1_000_000, `mcp ${id}`).toBeLessThanOrEqual(
          Math.ceil(ledgerMicroUsd(id, 100_000, 10)),
        );
      }
    });
  });

  it('the auto-router estimates every metered route at the ledger rate', () => {
    for (const route of ledgerPricedOpenRouterRoutes) {
      const pricing = nodeSlideModelPricing(route.id);
      if (pricing.kind !== 'priced') continue;
      const decision = autoRoute(route.id, 100);
      expect(decision.kind, `${route.id} is routable`).toBe('selected');
      const estimate = decision.costEstimate;
      expect(estimate.status).toBe('estimated');
      if (estimate.status !== 'estimated') continue;
      expect(perMillion(estimate.pricing.inputUsdPerMillionTokens), `${route.id} input`).toBe(
        pricing.inputMicroUsdPerMillionTokens,
      );
      expect(perMillion(estimate.pricing.outputUsdPerMillionTokens), `${route.id} output`).toBe(
        pricing.outputMicroUsdPerMillionTokens,
      );
    }
  });

  it('kimi-k3 is not admitted on an estimate below the ledger worst case', () => {
    // Round 1: pi-ai 1.1.0 priced kimi-k3 at 0.5 / 15, so 100k in + 1k out estimated $0.065 while the
    // ledger's worst case is $0.085, and the auto-router admitted a route the ledger would price higher.
    const worst = scoreNodeSlideWorstCaseCost({
      model: 'moonshotai/kimi-k3',
      inputTokens: 100_000,
      outputTokens: 1_000,
    });
    expect(worst.totalCostMicroUsd).toBe(85_000);
    expect(autoRoute('moonshotai/kimi-k3', 0.085).kind).toBe('selected');
    expect(autoRoute('moonshotai/kimi-k3', 0.084999).kind).toBe('refused');
  });

  it('keeps the Nebius GLM-5.2 hand-typed cost out of every reservation path', () => {
    // NODESLIDE_NEBIUS_GLM carries a hand-typed 1.4 / 4.4 (not in frontier.json, not on OpenRouter).
    // The route is productionEnabled:false and its ledger row is 'unknown' (denied), so the
    // figure cannot reach a reservation. It is verified against the Nebius price list when the
    // route is enabled (SPEC Part A section A.2.8, R row convex/lib/nodeslideProvider.ts:27).
    expect(nodeSlideAgentModel('nebius/zai-org/GLM-5.2').productionEnabled).toBe(false);
    expect(nodeSlideModelPricing('nebius/zai-org/GLM-5.2').kind).toBe('unknown');
  });
});
