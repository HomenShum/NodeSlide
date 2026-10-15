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
describe('callByModel sends the direct Anthropic wire id and the row default effort', () => {
  const sent: { url: string; body: Record<string, unknown> }[] = [];

  beforeEach(() => {
    sent.length = 0;
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key-not-real');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        sent.push({
          url: String(input instanceof Request ? input.url : input),
          body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
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

  it.each([
    ['anthropic/claude-sonnet-5.5', 'claude-sonnet-5-5', 'high'],
    ['anthropic/claude-opus-5.5', 'claude-opus-5-5', 'medium'],
  ] as const)('%s goes out as %s at the row default effort %s', async (model, wireId, effort) => {
    const result = await run(model);
    expect(result.provider).toBe('anthropic');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toContain('api.anthropic.com');
    expect(sent[0]?.body.model).toBe(wireId);
    expect(JSON.stringify(sent[0]?.body)).toContain(`"effort":"${effort}"`);
  });

  it('keeps the existing Sonnet 5 row on its own id (pi-ai sends no effort for it)', async () => {
    await run('anthropic/claude-sonnet-5');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.body.model).toBe('claude-sonnet-5');
  });
});
