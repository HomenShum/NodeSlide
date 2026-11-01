import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { localByokStatus, requireLocalKeys } from './byok.js';
import { call, callByModel } from './llmClient.js';

/**
 * Scenario: a designer runs the local MCP bring-your-own-key edit planner (`planLocalByokEdit` ->
 * `callByModel`) with an Anthropic key and picks a Claude row from the NodeSlide catalog. The catalog
 * id is the OpenRouter slug (`anthropic/claude-sonnet-5.5`); the direct Anthropic API wants
 * `claude-sonnet-5-5` (SPEC section 1.2). Before, the slug had its prefix stripped to
 * `claude-sonnet-5.5`, which pi-ai's registry lacks: the call threw and sent no request. This drives
 * the real pi-ai client with a fake `fetch`, so the assertion is on the request that would leave.
 */
type Body = {
  model?: string;
  thinking?: { type?: string };
  messages?: { role?: string }[];
} & Record<string, unknown>;
type Sent = { url: string; headers: Record<string, string>; body: Body };

/** SPEC A.0.6 / 1.3: keys a Claude 5.5 request must not carry anywhere in its body. */
const FORBIDDEN_KEYS = ['temperature', 'top_p', 'top_k', 'tool_choice', 'budget_tokens'];

function wireShapeProblems(body: Body): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (node !== null && typeof node === 'object')
      for (const [k, v] of Object.entries(node)) {
        if (FORBIDDEN_KEYS.includes(k)) problems.push(`${path}.${k} is forbidden`);
        walk(v, `${path}.${k}`);
      }
  };
  walk(body, 'body');
  if (body.thinking?.type !== 'adaptive') problems.push('thinking is not adaptive');
  const last = body.messages?.[body.messages.length - 1];
  if (!last || last.role === 'assistant') problems.push('last turn is an assistant prefill');
  return problems;
}

/** Scenario as above, plus: the reply is governed by the top-level effort, set to the row default. */
describe('callByModel sends the direct Anthropic wire id and the row default effort', () => {
  const sent: Sent[] = [];

  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({
          url: String(input instanceof Request ? input.url : input),
          headers: Object.fromEntries(new Headers(init?.headers)),
          body: JSON.parse(String(init?.body ?? '{}')) as Body,
        });
        // A 400 ends the call without retries; only the request matters here.
        return new Response(
          JSON.stringify({
            type: 'error',
            error: { type: 'invalid_request_error', message: 'stop' },
          }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const run = (model: string) =>
    callByModel({ model, systemPrompt: 's', userText: 'u', maxTokens: 64 });

  // Every spelling of one row must reach the same wire id and the same default effort.
  it.each([
    ['anthropic/claude-sonnet-5.5', 'claude-sonnet-5-5', 'high'],
    ['claude-sonnet-5-5', 'claude-sonnet-5-5', 'high'],
    ['anthropic/claude-opus-5.5', 'claude-opus-5-5', 'medium'],
    ['anthropic/claude-opus-5-5', 'claude-opus-5-5', 'medium'],
    ['claude-opus-5-5', 'claude-opus-5-5', 'medium'],
  ] as const)('%s goes out as %s at the row default effort %s', async (model, wireId, effort) => {
    const result = await run(model);
    expect(result.provider).toBe('anthropic');
    expect(sent).toHaveLength(1);
    const { url, headers, body } = sent[0] as Sent;
    expect(url).toContain('api.anthropic.com');
    expect(body.model).toBe(wireId);
    expect(wireShapeProblems(body)).toEqual([]);
    // A trailing effort-only message applies only from the NEXT user turn (migration guide, mid-
    // conversation effort), and this request has none. The reply is governed by the top-level
    // output_config.effort, which pi-ai hard-codes to 'high' for managed-effort rows; the client
    // rewrites it to the row default (Opus 5.5 = medium). pi-ai's own trailing message is unchanged.
    expect(body['output_config']).toEqual({ effort });
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0]?.role).toBe('user');
    expect(body.messages[1]).toEqual({
      role: 'system',
      content: [],
      output_config: { effort },
    });
    expect(headers['anthropic-beta']).toContain('mid-conversation-output-config-2026-07-01');
  });

  it('keeps the existing Sonnet 5 row on its own id (pi-ai sends no effort for it)', async () => {
    await run('anthropic/claude-sonnet-5');
    expect(sent).toHaveLength(1);
    const body = (sent[0] as Sent).body;
    expect(body.model).toBe('claude-sonnet-5');
    expect(JSON.stringify(body)).not.toContain('effort');
    expect(FORBIDDEN_KEYS.filter((k) => JSON.stringify(body).includes(`"${k}"`))).toEqual([]);
    expect(body.messages.at(-1)?.role).toBe('user');
  });
}, 30_000); // first call cold-imports the pi-ai catalog; the default 5 s timed out on a cold run

/**
 * SPEC 1.3 shapes for the two direct providers, checked on the whole body so an extra key cannot hide
 * behind a `toMatchObject`. GPT-6.1: reasoning carries only effort (plus the summary pi-ai asks for),
 * low..max, never `enabled` or a token budget; no sampling/logprob keys; the input does not end on an
 * assistant turn. Gemini 3.8: thinkingConfig carries only includeThoughts and thinkingLevel
 * (LOW/MEDIUM/HIGH), never thinkingBudget; no candidateCount or sampling keys; the last content is
 * not a model turn (prefill is a 400).
 */
const DIRECT_FORBIDDEN_KEYS = [
  ...FORBIDDEN_KEYS,
  'thinking_budget',
  'thinkingBudget',
  'candidate_count',
  'candidateCount',
  // Gemini's own sampling keys are camelCase (generationConfig.topP/topK); the walk is recursive, so
  // they are caught at any depth, as is generationConfig.temperature via FORBIDDEN_KEYS. SPEC 1.3:
  // sampling on Gemini 3.6+ is deprecated and must be removed. Codex round 6: injecting topP/topK left
  // all 49 tests green because only the snake_case spellings were listed.
  'topP',
  'topK',
  'logprobs',
  'top_logprobs',
  'prefill',
];

function directWireProblems(
  provider: 'openai' | 'gemini',
  body: Record<string, unknown>,
): string[] {
  const problems: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`));
    else if (node !== null && typeof node === 'object')
      for (const [k, v] of Object.entries(node)) {
        if (DIRECT_FORBIDDEN_KEYS.includes(k)) problems.push(`${path}.${k} is forbidden`);
        walk(v, `${path}.${k}`);
      }
  };
  walk(body, 'body');
  const keysOutside = (obj: unknown, allowed: string[], path: string) => {
    for (const k of Object.keys((obj ?? {}) as object))
      if (!allowed.includes(k)) problems.push(`${path}.${k} is not an allowed key`);
  };
  if (provider === 'openai') {
    const reasoning = body['reasoning'] as { effort?: string } | undefined;
    keysOutside(reasoning, ['effort', 'summary'], 'body.reasoning');
    if (!['low', 'medium', 'high', 'xhigh', 'max'].includes(reasoning?.effort ?? ''))
      problems.push('reasoning.effort is not low..max');
    const input = body['input'] as { role?: string }[] | undefined;
    const last = input?.[input.length - 1];
    if (!last || last.role === 'assistant')
      problems.push('last input turn is an assistant prefill');
  } else {
    const cfg = body['generationConfig'] as
      | { thinkingConfig?: { thinkingLevel?: string } }
      | undefined;
    keysOutside(
      cfg?.thinkingConfig,
      ['includeThoughts', 'thinkingLevel'],
      'body.generationConfig.thinkingConfig',
    );
    if (!['LOW', 'MEDIUM', 'HIGH'].includes(cfg?.thinkingConfig?.thinkingLevel ?? ''))
      problems.push('thinkingLevel is not LOW/MEDIUM/HIGH');
    const contents = body['contents'] as { role?: string }[] | undefined;
    const last = contents?.[contents.length - 1];
    if (!last || last.role === 'model') problems.push('last content is a model-turn prefill');
  }
  return problems;
}

describe('the direct-provider shape guard itself', () => {
  // Codex round 5: injecting reasoning.max_tokens, reasoning.enabled:false and a trailing assistant
  // input into the GPT-6.1 request left every test passing. The guard must object to each shape.
  const gpt = {
    model: 'm',
    reasoning: { effort: 'high', summary: 'auto' },
    input: [{ role: 'user' }],
  };
  const gem = {
    contents: [{ role: 'user' }],
    generationConfig: {
      thinkingConfig: { includeThoughts: true, thinkingLevel: 'HIGH' },
    },
  };
  it('accepts the clean bodies', () => {
    expect(directWireProblems('openai', gpt)).toEqual([]);
    expect(directWireProblems('gemini', gem)).toEqual([]);
  });
  it.each([
    [
      'a reasoning token budget',
      'openai',
      { ...gpt, reasoning: { ...gpt.reasoning, max_tokens: 1 } },
    ],
    [
      'a disabled reasoning block',
      'openai',
      { ...gpt, reasoning: { ...gpt.reasoning, enabled: false } },
    ],
    ['effort none', 'openai', { ...gpt, reasoning: { effort: 'none' } }],
    [
      'a trailing assistant input',
      'openai',
      { ...gpt, input: [...gpt.input, { role: 'assistant' }] },
    ],
    ['a sampling key', 'openai', { ...gpt, temperature: 0 }],
    ['logprobs', 'openai', { ...gpt, logprobs: true }],
    [
      'thinkingBudget',
      'gemini',
      {
        ...gem,
        generationConfig: {
          thinkingConfig: { thinkingLevel: 'HIGH', thinkingBudget: 0 },
        },
      },
    ],
    [
      'candidateCount',
      'gemini',
      {
        ...gem,
        generationConfig: { ...gem.generationConfig, candidateCount: 2 },
      },
    ],
    [
      'generationConfig.topP',
      'gemini',
      { ...gem, generationConfig: { ...gem.generationConfig, topP: 0.9 } },
    ],
    [
      'generationConfig.topK',
      'gemini',
      { ...gem, generationConfig: { ...gem.generationConfig, topK: 5 } },
    ],
    [
      'generationConfig.temperature',
      'gemini',
      { ...gem, generationConfig: { ...gem.generationConfig, temperature: 0 } },
    ],
    ['a model-turn prefill', 'gemini', { ...gem, contents: [...gem.contents, { role: 'model' }] }],
    [
      'thinkingLevel MINIMAL',
      'gemini',
      {
        ...gem,
        generationConfig: { thinkingConfig: { thinkingLevel: 'MINIMAL' } },
      },
    ],
  ] as const)('rejects %s', (_label, provider, body) => {
    expect(directWireProblems(provider, body as Record<string, unknown>)).not.toEqual([]);
  });
});

/**
 * Scenario: the same designer picks a GPT-6.1 Sol or Gemini 3.8 Flash row. The row default is `high`.
 * pi-ai's `complete` reads a different option per API (`reasoningEffort` on the OpenAI Responses API,
 * `thinking.level` on Gemini) and silently drops the `effort` that only its Anthropic path reads, so
 * both calls used to go out at the vendor default (medium). The assertion is on the request body.
 */
describe('callByModel sends the row default effort on the OpenAI and Gemini APIs too', () => {
  const sent: Sent[] = [];

  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv('OPENAI_API_KEY', 'test-key-not-real');
    vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({
          url: String(input instanceof Request ? input.url : input),
          headers: Object.fromEntries(new Headers(init?.headers)),
          body: JSON.parse(String(init?.body ?? '{}')) as Body,
        });
        return new Response(JSON.stringify({ error: { message: 'stop', code: 400 } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const run = (model: string) =>
    callByModel({ model, systemPrompt: 's', userText: 'u', maxTokens: 64 });

  it('openai/gpt-6.1-sol goes to the Responses API at reasoning.effort high, with no sampling keys', async () => {
    await run('openai/gpt-6.1-sol');
    expect(sent).toHaveLength(1);
    const { url, body } = sent[0] as Sent;
    expect(url).toContain('api.openai.com/v1/responses');
    expect(body.model).toBe('gpt-6.1-sol');
    expect(body['reasoning']).toMatchObject({ effort: 'high' });
    expect(directWireProblems('openai', body)).toEqual([]);
  });

  it('google/gemini-3.8-flash goes out with thinkingLevel HIGH and no sampling keys', async () => {
    await run('google/gemini-3.8-flash');
    expect(sent).toHaveLength(1);
    const { url, body } = sent[0] as Sent;
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(url).toContain('gemini-3.8-flash');
    expect(body['generationConfig']).toMatchObject({
      thinkingConfig: { thinkingLevel: 'HIGH' },
    });
    expect(directWireProblems('gemini', body)).toEqual([]);
  });

  // Codex round 6: an explicit OpenRouter call to a GPT-6.1 or Gemini 3.8 row went out with no
  // `reasoning` block, because pi-ai's chat-completions adapter reads `reasoningEffort`, not `effort`.
  it.each([['openai/gpt-6.1-sol'], ['google/gemini-3.8-flash']])(
    'explicit OpenRouter call to %s carries the row default reasoning effort high',
    async (modelId) => {
      vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
      const result = await call({
        provider: 'openrouter',
        modelId,
        systemPrompt: 's',
        userText: 'u',
        maxTokens: 64,
      });
      expect(result.provider).toBe('openrouter');
      expect(sent).toHaveLength(1);
      const { url, body } = sent[0] as Sent;
      expect(url).toContain('openrouter.ai');
      expect(body.model).toBe(modelId);
      expect(body['reasoning']).toEqual({ effort: 'high' });
    },
  );

  // SPEC A.0.10: free-looking unknown ids reach the verified free router; every other unknown throws
  // before any request. `openrouter/free` is a catalog route and used to lose its prefix.
  it.each([['openrouter/free'], ['bogus/model:free'], ['vendor-free']])(
    '%s resolves to the free router on OpenRouter',
    async (model) => {
      vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
      const result = await run(model);
      expect(result.provider).toBe('openrouter');
      expect(sent).toHaveLength(1);
      const { url, body } = sent[0] as Sent;
      expect(url).toContain('openrouter.ai');
      expect(body.model).toBe('openrouter/free');
    },
  );

  // SPEC D1: a NodeSlide catalog row is a known id and is never silently rerouted. These three used
  // to reach OpenRouter as `openrouter/free` (pi-ai's `google` route had no such id, so the free
  // fallback ran); each is now sent as itself, to OpenRouter.
  it.each([
    ['google/gemma-4-26b-a4b-it:free'],
    ['google/gemma-4-31b-it:free'],
    ['nvidia/nemotron-3-super-120b-a12b:free'],
  ])('catalog id %s is sent to OpenRouter as itself, not as the free router', async (model) => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
    const result = await run(model);
    expect(result.provider).toBe('openrouter');
    expect(sent).toHaveLength(1);
    const { url, body } = sent[0] as Sent;
    expect(url).toContain('openrouter.ai');
    expect(body.model).toBe(model);
  });

  // SPEC D1 / A.0.10: a SPEC 1.2 verified free id that pi-ai cannot serve is a known id, so it throws
  // before any request instead of being rerouted to `openrouter/free`.
  it('verified free id pi-ai has no row for is refused, not rerouted to the free router', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
    await expect(run('nvidia/nemotron-3.5-content-safety:free')).rejects.toThrow(/not rerouted/);
    expect(sent).toEqual([]);
  });

  // The key the tool demands before it calls must be the key the call then uses. `vendor-free` once
  // demanded OPENAI_API_KEY and was sent to OpenRouter; the gemma ids demanded GEMINI_API_KEY.
  it.each([
    ['vendor-free'],
    ['bogus/model:free'],
    ['openrouter/free'],
    ['google/gemma-4-26b-a4b-it:free'],
    ['google/gemma-4-31b-it:free'],
    ['nvidia/nemotron-3-super-120b-a12b:free'],
  ])('%s needs the OpenRouter key alone, and only the OpenRouter key', async (model) => {
    expect(localByokStatus([model]).models[0]).toMatchObject({
      provider: 'openrouter',
      envVar: 'OPENROUTER_API_KEY',
    });
    // Only an OpenRouter key is set: the check passes and the call goes where the check said.
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
    expect(() => requireLocalKeys([model])).not.toThrow();
    const result = await run(model);
    expect(result.provider).toBe('openrouter');
    expect(sent[0]?.url).toContain('openrouter.ai');
  });

  it('refuses a free-looking id when only the inferred vendor key is set', () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key-not-real');
    vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
    vi.stubEnv('OPENROUTER_API_KEY', '');
    expect(() => requireLocalKeys(['vendor-free'])).toThrow(/OPENROUTER_API_KEY/);
    expect(() => requireLocalKeys(['google/gemma-4-26b-a4b-it:free'])).toThrow(
      /OPENROUTER_API_KEY/,
    );
  });

  it.each([['bogus/model'], ['gpt-nonexistent'], ['claude-unknown-9']])(
    '%s is refused before any request',
    async (model) => {
      await expect(run(model)).rejects.toThrow(/Unknown model/);
      expect(sent).toEqual([]);
    },
  );
}, 30_000);

/**
 * Scenario: a designer keeps working with the rows this refresh did not touch (the previous-generation
 * GPT-5.6 rows and the frozen Gemini 3.1 Pro preview). SPEC A.0.4 says their behaviour is as today, so
 * their request must be exactly the one main's client sent: `pi.complete` with only `maxOutputTokens`,
 * which is how main's `call()` invoked it. Applying the new rows' effort to them changed the OpenAI
 * rows from reasoning effort 'none' to 'high' and gave Gemini 3.1 Pro an explicit thinking level.
 */
describe('callByModel leaves the requests of rows this refresh does not add byte-identical to main', () => {
  const sent: Sent[] = [];

  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv('OPENAI_API_KEY', 'test-key-not-real');
    vi.stubEnv('GEMINI_API_KEY', 'test-key-not-real');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({
          url: String(input instanceof Request ? input.url : input),
          headers: Object.fromEntries(new Headers(init?.headers)),
          body: JSON.parse(String(init?.body ?? '{}')) as Body,
        });
        return new Response(JSON.stringify({ error: { message: 'stop', code: 400 } }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** What main's `call()` sent: the registry model and `{ maxOutputTokens }`, nothing else. */
  async function mainRequest(provider: 'openai' | 'google', canonicalId: string): Promise<Sent> {
    const pi = await import('@earendil-works/pi-ai/compat');
    // biome-ignore lint/suspicious/noExplicitAny: pi-ai's getModel is typed against its compile-time registry
    const model = (pi.getModel as any)(provider, canonicalId);
    sent.length = 0;
    await pi.complete(
      model,
      {
        systemPrompt: 's',
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'u' }],
            timestamp: 0,
          },
        ],
      },
      { maxOutputTokens: 64 },
    );
    return sent[0] as Sent;
  }

  it.each([
    ['openai/gpt-5.6-sol', 'openai', 'gpt-5.6-sol'],
    ['openai/gpt-5.6-terra', 'openai', 'gpt-5.6-terra'],
    ['google/gemini-3.1-pro-preview', 'google', 'gemini-3.1-pro-preview'],
    ['google/gemini-3.5-flash', 'google', 'gemini-3.5-flash'],
  ] as const)('%s sends the body main sent', async (id, provider, canonicalId) => {
    const baseline = await mainRequest(provider, canonicalId);
    sent.length = 0;
    await callByModel({
      model: id,
      systemPrompt: 's',
      userText: 'u',
      maxTokens: 64,
    });
    expect(sent).toHaveLength(1);
    const now = sent[0] as Sent;
    expect(now.url).toBe(baseline.url);
    expect(now.body).toEqual(baseline.body);
    expect(JSON.stringify(now.body)).toBe(JSON.stringify(baseline.body));
  });

  // SPEC 1.2 supersession (2026-10-31 recheck): Flint is a verified free id with no pi-ai row, so it is
  // a known id and is refused, never sent as `openrouter/free`.
  it('recursive/flint-v1.0:free is refused before any request, not rerouted', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key-not-real');
    await expect(
      callByModel({
        model: 'recursive/flint-v1.0:free',
        systemPrompt: 's',
        userText: 'u',
        maxTokens: 64,
      }),
    ).rejects.toThrow(/not rerouted/);
    expect(sent).toEqual([]);
  });
}, 30_000);

/** The checker above is only worth having if it rejects each shape A.0.6 forbids. */
describe('wireShapeProblems rejects the shapes SPEC A.0.6 forbids', () => {
  const ok = {
    thinking: { type: 'adaptive' },
    messages: [{ role: 'user', content: [] }],
  };
  it.each([
    ['temperature', { ...ok, temperature: 0 }],
    ['top_p', { ...ok, top_p: 0.9 }],
    ['top_k', { ...ok, top_k: 5 }],
    ['a forced tool_choice', { ...ok, tool_choice: { type: 'tool', name: 'x' } }],
    ['budget_tokens', { ...ok, thinking: { type: 'adaptive', budget_tokens: 1024 } }],
    ['disabled thinking', { ...ok, thinking: { type: 'disabled' } }],
    [
      'an assistant prefill',
      {
        ...ok,
        messages: [...ok.messages, { role: 'assistant', content: '{' }],
      },
    ],
  ])('%s', (_name, body) => {
    expect(wireShapeProblems(body)).not.toEqual([]);
  });
  it('accepts the clean shape', () => {
    expect(wireShapeProblems(ok)).toEqual([]);
  });
});
