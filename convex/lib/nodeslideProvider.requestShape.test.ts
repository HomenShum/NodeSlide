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
  NODESLIDE_DEFAULT_REASONING_EFFORT,
  NODESLIDE_OFFERED_AGENT_MODELS,
  NODESLIDE_OPENROUTER_EDIT_CONSENT,
  type NodeSlideAgentModelId,
  nodeSlideAgentModel,
  nodeSlideDefaultReasoningEffort,
  nodeSlideEffortForModel,
  nodeSlideModelSupportsReasoningEffort,
} from '../../shared/nodeslide';
import {
  callNodeSlideFreeJson,
  nodeSlideModelProbeProfile,
  openrouterProviderWithOverrides,
  probeNodeSlideModelOnce,
} from './nodeslideProvider';
import { validateNodeSlideProviderChoice } from './nodeslideProviderConsent';
import {
  NODESLIDE_ROUTING_EXECUTOR_MODEL,
  resolveNodeSlideRouting,
} from './nodeslideRoutingPolicy';
import {
  NODESLIDE_OPENROUTER_BRIEF_CONSENT,
  validateNodeSlideBriefProviderChoice,
} from './nodeslideValidators';

// The first provider call in this file pays for the cold pi-ai catalog/lazy-transport import. It took
// 6565 ms under a loaded `npm run check` against the 5 s default (round 1, review defect 11), so this
// file gets an explicit budget instead of depending on machine load. Only the timeout moves; every
// assertion is unchanged.
vi.setConfig({ testTimeout: 30_000 });

/** SPEC section 1.2, `openrouter` column. */
const WIRE_ID = {
  sonnet55: 'anthropic/claude-sonnet-5.5',
  opus55: 'anthropic/claude-opus-5.5',
  gemini38Flash: 'google/gemini-3.8-flash',
  gpt61Sol: 'openai/gpt-6.1-sol',
} as const satisfies Record<string, NodeSlideAgentModelId>;

/** SPEC D2: the routed executor, the newest :free row with structured outputs (list of 2026-10-16T11:15:06Z). */
const EXECUTOR_FREE_ID =
  'nvidia/nemotron-3.5-super-vl:free' as const satisfies NodeSlideAgentModelId;

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
  // Forced tool choice is a 400 on Sonnet 5.5 and Opus 5.5 (SPEC 1.3), and GPT-6.1 tools need the
  // Responses API, not Chat Completions. NodeSlide's JSON calls offer no tools, so neither key may appear.
  'tool_choice',
  'tools',
] as const;
/** SPEC 1.3: low..max are accepted; `none` and `minimal` are rejected on the new rows. */
const ACCEPTED_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

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

function expectNoForbiddenKeys(
  body: Record<string, unknown>,
  // Sampling is a 400 only on the Claude 5.5 / GPT-6 / Gemini 3.6+ ids of SPEC 1.3; the :free
  // executor is none of them and its catalog row accepts temperature.
  { sampling = true }: { sampling?: boolean } = {},
) {
  for (const key of [...(sampling ? FORBIDDEN_SAMPLING_KEYS : []), ...FORBIDDEN_LEGACY_KEYS]) {
    expect(Object.keys(body), `request must not carry "${key}"`).not.toContain(key);
  }
  // Prefill is an assistant turn at the end of the conversation (a 400 on every new row), not a key.
  const messages = (body['messages'] ?? []) as { role?: string }[];
  expect(messages.length, 'request carries messages').toBeGreaterThan(0);
  expect(messages.at(-1)?.role, 'request must not end on an assistant message (prefill)').not.toBe(
    'assistant',
  );
  // A disabled reasoning block is a 400 on Opus 5.5 and Sonnet 5.5; effort must be explicit, and one
  // the vendors accept.
  const reasoning = body['reasoning'] as { enabled?: boolean; effort?: string } | undefined;
  expect(reasoning?.enabled).toBeUndefined();
  expect(ACCEPTED_EFFORTS as readonly string[]).toContain(reasoning?.effort);
}

describe('the forbidden-shape guard itself', () => {
  // Round 1 (Codex): injecting toolChoice:'required' into the provider left every test passing.
  // These feed the guard a request that carries each forbidden shape and require it to object.
  const clean = {
    model: 'x',
    messages: [{ role: 'user', content: 'hi' }],
    reasoning: { effort: 'high' },
  };
  it('accepts a clean request', () => {
    expect(() => expectNoForbiddenKeys(clean)).not.toThrow();
  });
  it.each([
    ['a forced tool_choice', { ...clean, tool_choice: 'required' }],
    ['an offered tool list', { ...clean, tools: [{ type: 'function' }] }],
    ['a sampling parameter', { ...clean, temperature: 0 }],
    [
      'an assistant prefill turn',
      { ...clean, messages: [...clean.messages, { role: 'assistant', content: '{' }] },
    ],
    ['a disabled reasoning block', { ...clean, reasoning: { enabled: false, effort: 'high' } }],
    ['effort "none"', { ...clean, reasoning: { effort: 'none' } }],
    ['effort "minimal"', { ...clean, reasoning: { effort: 'minimal' } }],
    ['an arbitrary effort string', { ...clean, reasoning: { effort: 'banana' } }],
  ])('rejects %s', (_label, body) => {
    expect(() => expectNoForbiddenKeys(body)).toThrow();
  });
});

describe('the new catalog rows build refresh-safe requests', () => {
  for (const [label, modelId] of Object.entries(WIRE_ID) as [string, NodeSlideAgentModelId][]) {
    it(`${label}: probe request carries the SPEC 1.2 wire id and none of the forbidden keys`, async () => {
      const route = nodeSlideAgentModel(modelId);
      // The row must exist (an unknown id throws: it no longer falls back to the first catalog row).
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

  it('Opus 5.5 defaults to its own row effort (medium) and every request names one', async () => {
    // SPEC A.2.8: Opus 5.5 defaults to medium on the vendor side (Opus 5 was high), "explicit per
    // row". The catalog row carries defaultEffort 'medium'; the provider sends it explicitly so
    // the vendor default never applies. (Round 1 asserted 'high' here and locked in the wrong value.)
    expect(nodeSlideDefaultReasoningEffort(WIRE_ID.opus55)).toBe('medium');
    await callNodeSlideFreeJson({
      systemPrompt: 'Return JSON.',
      userText: '{}',
      maxTokens: 500,
      model: WIRE_ID.opus55,
    });
    expect(captured.length).toBeGreaterThan(0);
    for (const request of captured) {
      expect(request.body['model']).toBe(WIRE_ID.opus55);
      expect((request.body['reasoning'] as { effort: string }).effort).toBe('medium');
      expectNoForbiddenKeys(request.body);
    }
  });

  it('an explicit caller effort is kept as given, Opus 5.5 included', async () => {
    await callNodeSlideFreeJson({
      systemPrompt: 'Return JSON.',
      userText: '{}',
      maxTokens: 500,
      model: WIRE_ID.opus55,
      reasoningEffort: 'high',
    });
    expect(captured.length).toBeGreaterThan(0);
    for (const request of captured) {
      expect((request.body['reasoning'] as { effort: string }).effort).toBe('high');
    }
  });

  it('every defaulting boundary agrees: only Opus 5.5 differs from the global high default', () => {
    for (const row of NODESLIDE_OFFERED_AGENT_MODELS) {
      const id = row.id as NodeSlideAgentModelId;
      const expected = id === WIRE_ID.opus55 ? 'medium' : NODESLIDE_DEFAULT_REASONING_EFFORT;
      expect(nodeSlideDefaultReasoningEffort(id), id).toBe(expected);
      expect(nodeSlideModelSupportsReasoningEffort(id, expected), id).toBe(true);
      // Public create boundary and public edit/variation consent boundary, no caller effort.
      expect(
        validateNodeSlideBriefProviderChoice(
          'openrouter_free',
          NODESLIDE_OPENROUTER_BRIEF_CONSENT,
          id,
        ),
        `create ${id}`,
      ).toMatchObject({ providerEffort: expected });
      expect(
        validateNodeSlideProviderChoice(
          'propose_edit',
          'openrouter_free',
          NODESLIDE_OPENROUTER_EDIT_CONSENT,
          id,
        ),
        `edit ${id}`,
      ).toMatchObject({ providerEffort: expected });
    }
    // An explicit effort passes through both boundaries untouched.
    expect(
      validateNodeSlideBriefProviderChoice(
        'openrouter_free',
        NODESLIDE_OPENROUTER_BRIEF_CONSENT,
        WIRE_ID.opus55,
        'high',
      ),
    ).toMatchObject({ providerEffort: 'high' });
  });

  it('a picker with no chosen effort shows the row default; a chosen effort is kept across rows', () => {
    // Untouched (null): each row's own default, so switching rows follows it. Opus 5.5 = medium.
    expect(nodeSlideEffortForModel(WIRE_ID.opus55, null)).toBe('medium');
    expect(nodeSlideEffortForModel(WIRE_ID.sonnet55, null)).toBe('high');
    expect(nodeSlideEffortForModel('moonshotai/kimi-k3', null)).toBe('high');
    // Chosen: kept on any row that supports it, including an effort equal to the PREVIOUS row's
    // default (round 3: Sonnet 5.5 'high' chosen on purpose, then Opus 5.5, used to become 'medium').
    expect(nodeSlideEffortForModel(WIRE_ID.sonnet55, 'high')).toBe('high');
    expect(nodeSlideEffortForModel(WIRE_ID.opus55, 'high')).toBe('high');
    expect(nodeSlideEffortForModel(WIRE_ID.sonnet55, 'medium')).toBe('medium');
    expect(nodeSlideEffortForModel(WIRE_ID.opus55, 'medium')).toBe('medium');
    expect(nodeSlideEffortForModel(WIRE_ID.opus55, 'xhigh')).toBe('xhigh');
    expect(nodeSlideEffortForModel(WIRE_ID.opus55, 'low')).toBe('low');
    // A chosen effort the row does not support falls to that row's default; the choice itself is
    // not lost (the picker still holds it), so returning to a supporting row shows it again.
    expect(nodeSlideEffortForModel('moonshotai/kimi-k3', 'xhigh')).toBe('high');
    // A stale or foreign saved value is no choice at all.
    expect(nodeSlideEffortForModel(WIRE_ID.opus55, 'not-an-effort')).toBe('medium');
    expect(nodeSlideEffortForModel('moonshotai/kimi-k3', 'not-an-effort')).toBe('high');
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

describe('the routed executor (Gemini 3.5 Flash deprecation 2026-10-08; SPEC D2 moves it to a :free route)', () => {
  it('routes bulk copy to the D2 :free executor and the request names exactly that id', async () => {
    const decision = resolveNodeSlideRouting({
      task: 'edit_plan',
      requestedModel: 'moonshotai/kimi-k3',
      replaceTextOps: 3,
    });
    expect(decision.reason).toBe('split_premium_planner_bulk_copy');
    expect(decision.executorModel).toBe(EXECUTOR_FREE_ID);
    expect(NODESLIDE_ROUTING_EXECUTOR_MODEL).toBe(EXECUTOR_FREE_ID);

    await callNodeSlideFreeJson({
      systemPrompt: 'Rewrite the copy.',
      userText: '{}',
      maxTokens: 500,
      model: decision.executorModel as NodeSlideAgentModelId,
      reasoningEffort: 'low',
    });
    expect(captured.length).toBeGreaterThan(0);
    for (const request of captured) {
      expect(request.body['model']).toBe('nvidia/nemotron-3.5-super-vl:free');
      expect(request.body['model']).not.toBe('google/gemini-3.5-flash');
      expect(request.body['model']).not.toBe('google/gemini-3.8-flash');
      expectNoForbiddenKeys(request.body, { sampling: false });
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
