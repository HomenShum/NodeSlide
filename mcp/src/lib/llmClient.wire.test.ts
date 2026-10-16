import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callByModel } from './llmClient.js';

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

/** Scenario as above, plus: the reply is governed by the trailing effort-only message. */
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
    // The effort that governs the reply is the effort-only message after the user turn; the
    // top-level output_config.effort stays pi-ai's own 'high' and does not.
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
    expect(FORBIDDEN_KEYS.filter((k) => JSON.stringify(body).includes(`"${k}"`))).toEqual([]);
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
    expect(FORBIDDEN_KEYS.filter((k) => JSON.stringify(body).includes(`"${k}"`))).toEqual([]);
  });

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

  it.each([['bogus/model'], ['gpt-nonexistent'], ['claude-unknown-9']])(
    '%s is refused before any request',
    async (model) => {
      await expect(run(model)).rejects.toThrow(/Unknown model/);
      expect(sent).toEqual([]);
    },
  );
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
      { ...ok, messages: [...ok.messages, { role: 'assistant', content: '{' }] },
    ],
  ])('%s', (_name, body) => {
    expect(wireShapeProblems(body)).not.toEqual([]);
  });
  it('accepts the clean shape', () => {
    expect(wireShapeProblems(ok)).toEqual([]);
  });
});
