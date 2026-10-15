import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Scenario: a designer runs the local MCP planner on Claude Opus 5.5 through OpenRouter and names no
 * effort. pi-ai 1.1.0 sends 'high' for every managed-effort Claude row when the caller says nothing,
 * but the NodeSlide row (and the vendor) default Opus 5.5 to medium (SPEC A.2.8). The client must
 * name the row default itself. pi-ai is faked so no request leaves the process.
 */
const complete = vi.hoisted(() => vi.fn());
vi.mock('@earendil-works/pi-ai/compat', () => ({
  getModel: () => ({ input: ['text'], cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }),
  complete,
}));

import { call } from './llmClient.js';

const base = { systemPrompt: 's', userText: 'u' } as const;

describe('local MCP client names the NodeSlide row default effort', () => {
  beforeEach(() => {
    complete.mockReset();
    complete.mockResolvedValue({
      content: [],
      usage: { cost: { total: 0 }, input: 0, output: 0 },
      model: 'm',
      stopReason: 'stop',
    });
  });

  it('sends medium for Opus 5.5 and high for the Sonnet 5.5 and Kimi rows', async () => {
    for (const [modelId, effort] of [
      ['anthropic/claude-opus-5.5', 'medium'],
      ['anthropic/claude-sonnet-5.5', 'high'],
      ['moonshotai/kimi-k3', 'high'],
    ] as const) {
      await call({ provider: 'openrouter', modelId, ...base });
      expect(complete.mock.calls.at(-1)?.[2]).toMatchObject({ effort });
    }
  });

  it('adds no effort for a model id that is not a NodeSlide row', async () => {
    await call({ provider: 'anthropic', modelId: 'claude-opus-5-5', ...base });
    expect(complete.mock.calls.at(-1)?.[2]).not.toHaveProperty('effort');
  });
});
