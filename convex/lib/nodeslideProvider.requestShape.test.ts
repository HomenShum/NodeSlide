/**
 * Request-shape proof for the 2026-10 model refresh (SPEC Part A rule 6, section A.2.8).
 *
 * Situation: a user picks Claude Sonnet 5.5, Claude Opus 5.5, Gemini 3.8 Flash or GPT-6.1 Sol in
 * the NodeSlide model picker, or the edit planner hands bulk copy work to the routed executor.
 * Those vendors reject some parameters outright (a 400, not a warning): sampling parameters on
 * Claude 5.5 and GPT-6, a disabled thinking block on Opus 5.5, Gemini's deprecated sampling. The
 * wrong wire id is just as fatal. Nothing here calls a provider: the real request is built by this
 * repo's own provider code (pi-ai plus `nodeSlideProviderPayload`) and the HTTP transport is a fake
 * `fetch` that records what would have been sent.
 *
 * Wire ids are SPEC section 1.2, `openrouter` column, and nothing else.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NODESLIDE_AGENT_MODELS,
  NODESLIDE_OFFERED_AGENT_MODELS,
  type NodeSlideAgentModelId,
  nodeSlideAgentModel,
} from '../../shared/nodeslide';
import {
  callNodeSlideFreeJson,
  nodeSlideModelProbeProfile,
  openrouterProviderWithOverrides,
  probeNodeSlideModelOnce,
} from './nodeslideProvider';
import {
  NODESLIDE_ROUTING_EXECUTOR_MODEL,
  resolveNodeSlideRouting,
} from './nodeslideRoutingPolicy';

/** SPEC section 1.2, `openrouter` column. */
const WIRE_ID = {
  sonnet55: 'anthropic/claude-sonnet-5.5',
  opus55: 'anthropic/claude-opus-5.5',
  gemini38Flash: 'google/gemini-3.8-flash',
  gpt61Sol: 'openai/gpt-6.1-sol',
} as const satisfies Record<string, NodeSlideAgentModelId>;

/** Keys a Claude 5.5 / GPT-6 / Gemini 3.6+ request must never carry (SPEC section 1.3). */
const FORBIDDEN_SAMPLING_KEYS = ['temperature', 'top_p', 'top_k'] as const;
const FORBIDDEN_LEGACY_KEYS = [
  'thinking',
  'budget_tokens',
  'thinking_budget',
  'candidate_count',
  'logprobs',
  'top_logprobs',
  'prefill',
] as const;

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
}

const sseDone = [
  'data: {"id":"gen-fake","model":"fake/echo","choices":[{"index":0,"delta":{"role":"assistant","content":"{\\"ok\\":true}"},"finish_reason":null}]}\n\n',
  'data: {"id":"gen-fake","model":"fake/echo","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
  'data: [DONE]\n\n',
].join('');

const originalKey = process.env['OPENROUTER_API_KEY'];
let captured: CapturedRequest[] = [];

beforeEach(() => {
  captured = [];
  // A fake key so pi-ai builds the request; the transport below never leaves the process.
  process.env['OPENROUTER_API_KEY'] = 'sk-or-test-fake-not-a-credential';
  vi.stubGlobal('fetch', async (input: unknown, init?: { body?: unknown }) => {
    const url =
      typeof input === 'string' ? input : ((input as { url?: string }).url ?? String(input));
    captured.push({ url, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return new Response(sseDone, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) Reflect.deleteProperty(process.env, 'OPENROUTER_API_KEY');
  else process.env['OPENROUTER_API_KEY'] = originalKey;
});

function expectNoForbiddenKeys(body: Record<string, unknown>) {
  for (const key of [...FORBIDDEN_SAMPLING_KEYS, ...FORBIDDEN_LEGACY_KEYS]) {
    expect(Object.keys(body), `request must not carry "${key}"`).not.toContain(key);
  }
  // A disabled reasoning block is a 400 on Opus 5.5 and Sonnet 5.5; effort must be explicit.
  const reasoning = body['reasoning'] as { enabled?: boolean; effort?: string } | undefined;
  expect(reasoning?.enabled).toBeUndefined();
  expect(typeof reasoning?.effort).toBe('string');
}

describe('the new catalog rows build refresh-safe requests', () => {
  for (const [label, modelId] of Object.entries(WIRE_ID) as [string, NodeSlideAgentModelId][]) {
    it(`${label}: probe request carries the SPEC 1.2 wire id and none of the forbidden keys`, async () => {
      const route = nodeSlideAgentModel(modelId);
      // The row must exist (an unknown id silently falls back to the first catalog row).
      expect(route.id).toBe(modelId);
      expect(route.upstreamId).toBe(modelId);
      expect(route.provider).toBe('openrouter');
      expect(route.supportsTemperature).toBe(false);
      expect(route.productionEnabled).toBe(true);

      await probeNodeSlideModelOnce(modelId);

      expect(captured).toHaveLength(1);
      const [request] = captured;
      expect(request?.url).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(request?.body['model']).toBe(modelId);
      expectNoForbiddenKeys(request?.body ?? {});
      const budgetKey = ['max_tokens', 'max_completion_tokens'].find(
        (key) => key in (request?.body ?? {}),
      );
      expect(budgetKey).toBeDefined();
      expect(request?.body[budgetKey as string]).toBe(
        nodeSlideModelProbeProfile(modelId).maxTokens,
      );
    });
  }

  it('Opus 5.5 never relies on the vendor default effort: every request names one', async () => {
    // Opus 5.5 defaults to medium on the vendor side (Opus 5 was high). NodeSlide's own default
    // is 'high' and it is always sent, so the vendor default can never apply.
    await callNodeSlideFreeJson({
      systemPrompt: 'Return JSON.',
      userText: '{}',
      maxTokens: 500,
      model: WIRE_ID.opus55,
    });
    expect(captured.length).toBeGreaterThan(0);
    for (const request of captured) {
      expect(request.body['model']).toBe(WIRE_ID.opus55);
      expect((request.body['reasoning'] as { effort: string }).effort).toBe('high');
      expectNoForbiddenKeys(request.body);
    }
  });

  it('every offered row is a priced, temperature-free-or-declared route', () => {
    for (const row of NODESLIDE_OFFERED_AGENT_MODELS) {
      const id = row.id as NodeSlideAgentModelId;
      if (
        id.startsWith('anthropic/claude-') ||
        id === WIRE_ID.gpt61Sol ||
        id === WIRE_ID.gemini38Flash
      ) {
        expect(row.supportsTemperature, `${id} rejects sampling parameters`).toBe(false);
      }
    }
  });
});

describe('Claude rows keep the OpenRouter chat-completions endpoint under pi-ai 1.1.0', () => {
  it('pins every bundled anthropic-messages OpenRouter row to /api/v1 chat-completions', () => {
    // pi-ai 1.1.0 ships these as api "anthropic-messages" at https://openrouter.ai/api; sent through
    // this provider's chat-completions client that is POST /api/chat/completions, not an OpenRouter
    // endpoint. The override must normalize them.
    const claudeRows = openrouterProviderWithOverrides()
      .getModels()
      .filter((model) => model.id.startsWith('anthropic/claude-'));
    expect(claudeRows.length).toBeGreaterThan(0);
    for (const model of claudeRows) {
      expect(model.api, model.id).toBe('openai-completions');
      expect(model.baseUrl, model.id).toBe('https://openrouter.ai/api/v1');
    }
  });

  it('keeps the pre-existing Claude rows (sonnet-5, fable-5) on a valid endpoint too', async () => {
    for (const modelId of ['anthropic/claude-sonnet-5', 'anthropic/claude-fable-5'] as const) {
      captured = [];
      await probeNodeSlideModelOnce(modelId);
      expect(captured[0]?.url, modelId).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(captured[0]?.body['model']).toBe(modelId);
      expect(Object.keys(captured[0]?.body ?? {})).not.toContain('temperature');
    }
  });
});

describe('the routed executor (SPEC 2026-10-08 Gemini 3.5 Flash deprecation)', () => {
  it('routes bulk copy to Gemini 3.8 Flash and the request names exactly that id', async () => {
    const decision = resolveNodeSlideRouting({
      task: 'edit_plan',
      requestedModel: 'moonshotai/kimi-k3',
      replaceTextOps: 3,
    });
    expect(decision.reason).toBe('split_premium_planner_bulk_copy');
    expect(decision.executorModel).toBe(WIRE_ID.gemini38Flash);
    expect(NODESLIDE_ROUTING_EXECUTOR_MODEL).toBe(WIRE_ID.gemini38Flash);

    await callNodeSlideFreeJson({
      systemPrompt: 'Rewrite the copy.',
      userText: '{}',
      maxTokens: 500,
      model: decision.executorModel as NodeSlideAgentModelId,
      reasoningEffort: 'low',
    });
    expect(captured.length).toBeGreaterThan(0);
    for (const request of captured) {
      expect(request.body['model']).toBe('google/gemini-3.8-flash');
      expect(request.body['model']).not.toBe('google/gemini-3.5-flash');
      expectNoForbiddenKeys(request.body);
    }
  });

  it('sends the edit patch to Gemini 3.8 Flash as json_object, decided by the catalog flag', async () => {
    const editPatchSchema = {
      name: 'nodeslide_edit_patch',
      schema: { type: 'object', properties: { operations: { type: 'array' } } },
    };
    await callNodeSlideFreeJson({
      systemPrompt: 'Return a patch.',
      userText: '{}',
      maxTokens: 500,
      model: WIRE_ID.gemini38Flash,
      reasoningEffort: 'low',
      jsonSchema: editPatchSchema,
    });
    const first = captured[0];
    expect(first?.body['model']).toBe(WIRE_ID.gemini38Flash);
    expect(first?.body['response_format']).toEqual({ type: 'json_object' });
    expectNoForbiddenKeys(first?.body ?? {});

    // A different schema on the same row still uses native json_schema.
    captured = [];
    await callNodeSlideFreeJson({
      systemPrompt: 'Return JSON.',
      userText: '{}',
      maxTokens: 500,
      model: WIRE_ID.gemini38Flash,
      reasoningEffort: 'low',
      jsonSchema: { name: 'other_schema', schema: { type: 'object' } },
    });
    expect((captured[0]?.body['response_format'] as { type: string }).type).toBe('json_schema');
  });

  it('retires the deprecated Gemini 3.5 Flash row from the offered picker but keeps it resolvable', () => {
    const retired = nodeSlideAgentModel('google/gemini-3.5-flash');
    expect(retired.id).toBe('google/gemini-3.5-flash');
    expect(retired.productionEnabled).toBe(false);
    expect(NODESLIDE_OFFERED_AGENT_MODELS.map((row) => row.id)).not.toContain(
      'google/gemini-3.5-flash',
    );
  });

  it('removes gpt-oss-20b:free from the free-router candidates but keeps the row', () => {
    const row = nodeSlideAgentModel('openai/gpt-oss-20b:free');
    expect(row.id).toBe('openai/gpt-oss-20b:free');
    expect(row.productionEnabled).toBe(false);
    expect('freeRouterCandidate' in row).toBe(false);
    expect(NODESLIDE_AGENT_MODELS.some((model) => model.id === 'openai/gpt-oss-20b:free')).toBe(
      true,
    );
  });
});
