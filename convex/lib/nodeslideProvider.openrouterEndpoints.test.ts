/**
 * pi-ai 1.1.0 upgrade proof (SPEC Part A, section A.2.8 "Pre-PR").
 *
 * Situation: a person picks Claude Sonnet 5 or Claude Fable 5 in the NodeSlide model picker. pi-ai
 * 1.1.0 ships OpenRouter's Claude rows as the `anthropic-messages` API at `https://openrouter.ai/api`;
 * NodeSlide sends every OpenRouter route through the chat-completions client, so without a fix the
 * request goes to `/api/chat/completions`, which is not an OpenRouter endpoint, and the route fails
 * on the first call after the SDK bump. Nothing here calls a provider: the real request is built by
 * this repo's own provider code and the HTTP transport is a fake `fetch` that records the URL.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openrouterProviderWithOverrides, probeNodeSlideModelOnce } from './nodeslideProvider';

const sseDone = [
  'data: {"id":"gen-fake","model":"fake/echo","choices":[{"index":0,"delta":{"role":"assistant","content":"1"},"finish_reason":null}]}\n\n',
  'data: {"id":"gen-fake","model":"fake/echo","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n\n',
  'data: [DONE]\n\n',
].join('');

const originalKey = process.env['OPENROUTER_API_KEY'];
let captured: { url: string; body: Record<string, unknown> }[] = [];

beforeEach(() => {
  captured = [];
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

describe('Claude rows keep the OpenRouter chat-completions endpoint under pi-ai 1.1.0', () => {
  it('pins every bundled anthropic-messages OpenRouter row to /api/v1 chat-completions', () => {
    const claudeRows = openrouterProviderWithOverrides()
      .getModels()
      .filter((model) => model.id.startsWith('anthropic/claude-'));
    expect(claudeRows.length).toBeGreaterThan(0);
    for (const model of claudeRows) {
      expect(model.api, model.id).toBe('openai-completions');
      expect(model.baseUrl, model.id).toBe('https://openrouter.ai/api/v1');
    }
  });

  it('sends the existing Claude rows (sonnet-5, fable-5) to a valid OpenRouter endpoint', async () => {
    for (const modelId of ['anthropic/claude-sonnet-5', 'anthropic/claude-fable-5'] as const) {
      captured = [];
      await probeNodeSlideModelOnce(modelId);
      expect(captured[0]?.url, modelId).toBe('https://openrouter.ai/api/v1/chat/completions');
      expect(captured[0]?.body['model']).toBe(modelId);
    }
  });
});
