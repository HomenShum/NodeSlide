import { describe, expect, it, vi } from 'vitest';
import { NODESLIDE_NEBIUS_AGENT_MODEL, nodeSlideAgentModel } from '../../shared/nodeslide';
import {
  NODESLIDE_EDIT_MODEL,
  NODESLIDE_EDIT_PROVIDER,
  NODESLIDE_OPENROUTER_MODEL_OVERRIDES,
  type NodeSlideCompletion,
  type NodeSlideCompletionResult,
  callNodeSlideFreeJson,
  nodeSlideStructuredOutputPayload,
  openrouterProviderWithOverrides,
  probeNodeSlideModelOnce,
} from './nodeslideProvider';

const defaultRoute = nodeSlideAgentModel(NODESLIDE_EDIT_MODEL);
const defaultRouteLabel = `${defaultRoute.label} via ${
  defaultRoute.provider === 'nebius' ? 'Nebius' : 'OpenRouter'
}`;

const request = {
  systemPrompt: 'Return a bounded NodeSlide patch.',
  userText: '{"instruction":"Rewrite the headline"}',
  maxTokens: 500,
  jsonSchema: {
    name: 'nodeslide_test_patch',
    schema: {
      type: 'object',
      required: ['operations'],
      properties: { operations: { type: 'array' } },
    },
  },
};

function completion(
  text: string,
  options: Partial<Omit<NodeSlideCompletionResult, 'text'>> = {},
): NodeSlideCompletionResult {
  return {
    text,
    stopReason: options.stopReason ?? 'stop',
    ...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
    costMicroUsd: options.costMicroUsd ?? 1_250,
    inputTokens: options.inputTokens ?? 120,
    outputTokens: options.outputTokens ?? 30,
  };
}

describe('NodeSlide named pi-ai JSON provider', () => {
  it('routes through the named default model', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('{"summary":"Sharper thesis","operations":[{"op":"replace_text"}]}'),
    );

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: true,
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: defaultRoute.upstreamId,
        reasoningEffort: 'high',
        costMicroUsd: 1_250,
        inputTokens: 120,
        outputTokens: 30,
      },
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      provider: NODESLIDE_EDIT_PROVIDER,
      model: defaultRoute.upstreamId,
      reasoningEffort: 'high',
      maxTokens: 500,
      jsonSchema: request.jsonSchema,
      repairAttempt: false,
    });
    expect(complete.mock.calls[0]?.[0].systemPrompt).toContain('JSON Schema');
  });

  it('routes an allowlisted model selection and attributes telemetry to that exact model', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('{"summary":"Sharper thesis","operations":[{"op":"replace_text"}]}'),
    );

    const result = await callNodeSlideFreeJson(
      { ...request, model: 'anthropic/claude-sonnet-5', reasoningEffort: 'xhigh' },
      { complete },
    );

    expect(result).toMatchObject({
      ok: true,
      telemetry: {
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-5',
        reasoningEffort: 'xhigh',
      },
    });
    expect(complete.mock.calls[0]?.[0].model).toBe('anthropic/claude-sonnet-5');
    expect(complete.mock.calls[0]?.[0].reasoningEffort).toBe('xhigh');
  });

  it('pins reasoning:false OpenRouter overrides for routes that reject or exhaust reasoning', () => {
    const provider = openrouterProviderWithOverrides();
    const models = provider.getModels();
    const overrideIds = NODESLIDE_OPENROUTER_MODEL_OVERRIDES.map((model) => model.id);
    expect(overrideIds).toEqual([
      'moonshotai/kimi-k3',
      'google/gemini-3.5-flash',
      'anthropic/claude-fable-5',
      'google/gemini-3.1-pro-preview',
    ]);
    for (const override of NODESLIDE_OPENROUTER_MODEL_OVERRIDES) {
      const matches = models.filter((model) => model.id === override.id);
      // Exactly one entry per id: our pinned definition wins over any bundled
      // catalog entry that would re-enable reasoning and burn the JSON budget.
      expect(matches).toHaveLength(1);
      expect(matches[0]).toMatchObject({ reasoning: false });
    }
  });

  it('injects the schema while preserving pi-ai provider routing', () => {
    expect(
      nodeSlideStructuredOutputPayload(
        { model: NODESLIDE_EDIT_MODEL, provider: { data_collection: 'deny' } },
        request.jsonSchema,
      ),
    ).toEqual({
      model: NODESLIDE_EDIT_MODEL,
      provider: { data_collection: 'deny' },
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: request.jsonSchema.name,
          strict: false,
          schema: request.jsonSchema.schema,
        },
      },
    });
  });

  it('makes exactly one repair completion after malformed JSON', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('not-json'))
      .mockResolvedValueOnce(
        completion('{"operations":[{"op":"replace_text"}]}', {
          costMicroUsd: 2_000,
          inputTokens: 150,
          outputTokens: 40,
        }),
      );

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: true,
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: defaultRoute.upstreamId,
        costMicroUsd: 3_250,
        inputTokens: 270,
        outputTokens: 70,
      },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toMatchObject({ repairAttempt: true });
    expect(complete.mock.calls[1]?.[0].userText).toContain('Prior invalid model response');
  });

  it('uses the same single repair attempt for a schema-invalid JSON envelope', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('{"summary":"Missing operations"}'))
      .mockResolvedValueOnce(completion('{"operations":[{"op":"replace_text"}]}'));

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result.ok).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0]).toMatchObject({ repairAttempt: true });
    expect(complete.mock.calls[1]?.[0].userText).toContain('Missing operations');
  });

  it('falls back honestly after the single repair also returns invalid JSON', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('not-json'))
      .mockResolvedValueOnce(completion('still-not-json'));

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: false,
      reason: `The ${defaultRouteLabel} route returned invalid JSON after one repair attempt.`,
      telemetry: {
        provider: NODESLIDE_EDIT_PROVIDER,
        model: defaultRoute.upstreamId,
      },
    });
    expect(complete).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain('still-not-json');
  });

  it('uses the single repair attempt without native schema mode when a route rejects it', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(
        completion('', {
          stopReason: 'error',
          errorMessage: 'response_format JSON schema is not supported by this endpoint',
        }),
      )
      .mockResolvedValueOnce(completion('{"operations":[{"op":"replace_text"}]}'));

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result.ok).toBe(true);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ jsonSchema: request.jsonSchema });
    expect(complete.mock.calls[1]?.[0]).not.toHaveProperty('jsonSchema');
    expect(complete.mock.calls[1]?.[0]).toMatchObject({ repairAttempt: true });
    expect(complete.mock.calls[1]?.[0].systemPrompt).toContain('JSON Schema');
    expect(complete.mock.calls[1]?.[0].userText).toContain(
      'provider rejected native structured-output mode',
    );
  });

  it('falls back honestly when the schema compatibility retry also errors', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('', {
        stopReason: 'error',
        errorMessage: 'response_format JSON schema is not supported by this endpoint',
      }),
    );

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result).toMatchObject({
      ok: false,
      reason: `The ${defaultRouteLabel} route rejected the structured-output schema.`,
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('bounds model output before attempting the one repair', async () => {
    const complete = vi
      .fn<NodeSlideCompletion>()
      .mockResolvedValueOnce(completion('x'.repeat(200_001)))
      .mockResolvedValueOnce(completion('still-not-json'));

    const result = await callNodeSlideFreeJson(request, { complete });

    expect(result.ok).toBe(false);
    expect(complete).toHaveBeenCalledTimes(2);
    expect(complete.mock.calls[1]?.[0].userText).toContain('response omitted');
    expect(complete.mock.calls[1]?.[0].userText).not.toContain('x'.repeat(1_000));
  });

  it('enforces the hard deadline even when the completion ignores AbortSignal', async () => {
    const complete = vi.fn<NodeSlideCompletion>(() => new Promise(() => {}));

    const result = await callNodeSlideFreeJson(request, { complete, timeoutMs: 10 });

    expect(result).toEqual({
      ok: false,
      reason: `The ${defaultRouteLabel} route timed out.`,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });

  it('forwards real provider text deltas with attempt identity while keeping raw JSON out of the result', async () => {
    const onTextDelta = vi.fn(async () => undefined);
    const complete = vi.fn<NodeSlideCompletion>(async (completionRequest) => {
      await completionRequest.onTextDelta?.('{"summary":"Shar', '{"summary":"Shar');
      await completionRequest.onTextDelta?.(
        'per"}',
        '{"summary":"Sharper","operations":[{"op":"replace_text"}]}',
      );
      return completion('{"summary":"Sharper","operations":[{"op":"replace_text"}]}');
    });

    const result = await callNodeSlideFreeJson(request, { complete, onTextDelta });

    expect(result.ok).toBe(true);
    expect(onTextDelta).toHaveBeenCalledTimes(2);
    expect(onTextDelta.mock.calls[0]?.[0]).toMatchObject({
      delta: '{"summary":"Shar',
      accumulatedText: '{"summary":"Shar',
      attempt: 1,
      repairAttempt: false,
    });
    expect(result).not.toHaveProperty('accumulatedText');
  });

  it('rejects reasoning efforts that the selected provider does not advertise', async () => {
    const complete = vi.fn<NodeSlideCompletion>();

    const result = await callNodeSlideFreeJson(
      { ...request, model: NODESLIDE_NEBIUS_AGENT_MODEL, reasoningEffort: 'xhigh' },
      { complete },
    );

    expect(result).toEqual({
      ok: false,
      reason: 'The GLM 5.2 route does not support the selected reasoning effort.',
    });
    expect(complete).not.toHaveBeenCalled();
  });

  it('probes a catalog route with the bounded cross-fleet output budget', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('1', { inputTokens: 5, outputTokens: 1, costMicroUsd: 7 }),
    );

    const result = await probeNodeSlideModelOnce(NODESLIDE_EDIT_MODEL, { complete });

    expect(result).toMatchObject({
      model: NODESLIDE_EDIT_MODEL,
      maxTokens: 64,
      status: 'passed',
      inputTokens: 5,
      outputTokens: 1,
      costMicroUsd: 7,
    });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]?.[0]).toMatchObject({
      maxTokens: 64,
      reasoningEffort: 'low',
      repairAttempt: false,
    });
  });

  it('returns a sanitized failed receipt when a fleet route times out', async () => {
    const complete = vi.fn<NodeSlideCompletion>(() => new Promise(() => {}));

    const result = await probeNodeSlideModelOnce(NODESLIDE_EDIT_MODEL, {
      complete,
      timeoutMs: 5,
    });

    expect(result).toMatchObject({
      model: NODESLIDE_EDIT_MODEL,
      maxTokens: 64,
      status: 'failed',
      costMicroUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      failure: 'The Kimi K3 route timed out.',
    });
    expect(complete.mock.calls[0]?.[0].signal.aborted).toBe(true);
  });

  it('fails a bounded probe honestly when the route returns no assistant text', async () => {
    const complete = vi.fn<NodeSlideCompletion>(async () =>
      completion('', { outputTokens: 1, stopReason: 'length' }),
    );
    const result = await probeNodeSlideModelOnce(NODESLIDE_EDIT_MODEL, { complete });
    expect(result).toMatchObject({
      status: 'failed',
      response: { present: false, bytes: 0 },
      failure: 'The Kimi K3 route returned no assistant text within 64 output tokens.',
    });
    expect(JSON.stringify(result)).not.toContain('errorMessage');
  });
});
