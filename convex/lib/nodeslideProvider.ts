import {
  type AssistantMessage,
  type Context,
  type Model,
  type TextContent,
  createModels,
  createProvider,
  envApiKeyAuth,
} from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';
import {
  NODESLIDE_DEFAULT_AGENT_MODEL,
  NODESLIDE_DEFAULT_REASONING_EFFORT,
  type NodeSlideAgentModelId,
  type NodeSlideExternalProvider,
  type NodeSlideReasoningEffort,
  isNodeSlideAgentModelId,
  nodeSlideAgentModel,
  nodeSlideModelSupportsReasoningEffort,
} from '../../shared/nodeslide';

export const NODESLIDE_NEBIUS_PROVIDER = 'nebius' as const;
/** Backwards-compatible name for the default; requests may select any catalog model. */
export const NODESLIDE_EDIT_MODEL = NODESLIDE_DEFAULT_AGENT_MODEL;
export const NODESLIDE_EDIT_PROVIDER = nodeSlideAgentModel(NODESLIDE_DEFAULT_AGENT_MODEL).provider;
export const NODESLIDE_NEBIUS_GLM_MODEL = 'zai-org/GLM-5.2' as const;

const MODEL_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 200_000;
const MAX_REPAIR_CONTEXT_CHARS = 24_000;
const OPENROUTER_ATTRIBUTION_HEADERS = {
  'HTTP-Referer': 'https://parity.studio',
  'X-Title': 'Parity Studio NodeSlide',
};

const NODESLIDE_NEBIUS_GLM: Model<'openai-completions'> = {
  id: NODESLIDE_NEBIUS_GLM_MODEL,
  name: 'Z.ai GLM 5.2',
  api: 'openai-completions',
  provider: NODESLIDE_NEBIUS_PROVIDER,
  baseUrl: 'https://api.tokenfactory.nebius.com/v1',
  reasoning: true,
  input: ['text'],
  cost: { input: 1.4, output: 4.4, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_048_576,
  maxTokens: 131_072,
  compat: {
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    thinkingFormat: 'openai',
    maxTokensField: 'max_tokens',
  },
};

function nebiusProvider() {
  return createProvider({
    id: NODESLIDE_NEBIUS_PROVIDER,
    name: 'Nebius Token Factory',
    baseUrl: NODESLIDE_NEBIUS_GLM.baseUrl,
    auth: {
      apiKey: envApiKeyAuth('Nebius Token Factory API key', ['NEBIUS_API_KEY']),
    },
    models: [NODESLIDE_NEBIUS_GLM],
    api: openAICompletionsApi(),
  });
}

// Kimi K3 is newer than pi-ai's bundled OpenRouter catalog, so we register it
// explicitly (shape mirrors the catalog's moonshotai/kimi-k2-thinking entry).
const NODESLIDE_KIMI_K3: Model<'openai-completions'> = {
  id: 'moonshotai/kimi-k3',
  name: 'MoonshotAI: Kimi K3',
  api: 'openai-completions',
  provider: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  reasoning: false,
  input: ['text'],
  cost: { input: 0.6, output: 2.5, cacheRead: 0.15, cacheWrite: 0 },
  contextWindow: 262_144,
  maxTokens: 100_352,
  compat: {
    supportsDeveloperRole: false,
    maxTokensField: 'max_tokens',
  },
};

/**
 * Kimi permits reasoning to be disabled and is newer than the bundled catalog.
 * Mandatory-reasoning routes retain their bundled metadata and receive a
 * bounded supported effort instead of an invalid disabled-reasoning payload.
 */
export const NODESLIDE_OPENROUTER_MODEL_OVERRIDES: readonly Model<'openai-completions'>[] = [
  NODESLIDE_KIMI_K3,
];

export function openrouterProviderWithOverrides() {
  const builtin = openrouterProvider();
  const overridden = new Map(
    NODESLIDE_OPENROUTER_MODEL_OVERRIDES.map((model) => [model.id, model] as const),
  );
  const models = builtin.getModels().filter((model) => !overridden.has(model.id));
  return createProvider({
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    auth: { apiKey: envApiKeyAuth('OpenRouter API key', ['OPENROUTER_API_KEY']) },
    models: [...models, ...NODESLIDE_OPENROUTER_MODEL_OVERRIDES],
    api: openAICompletionsApi(),
  });
}

function providerDisplayName(provider: NodeSlideExternalProvider): string {
  return provider === 'nebius' ? 'Nebius' : 'OpenRouter';
}

const nodeSlideModels = createModels();
nodeSlideModels.setProvider(openrouterProviderWithOverrides());
nodeSlideModels.setProvider(nebiusProvider());

export interface NodeSlideProviderTelemetry {
  provider: string;
  /** Requested catalog route; differs from model when a router resolves upstream dynamically. */
  requestedModel?: string;
  /** Effective model used for persisted compatibility; see actualModel for qualification. */
  model: string;
  /** Provider-returned identity only; never synthesized from the requested route. */
  actualProvider?: string;
  /** Provider-returned resolved model only; required to qualify production routes. */
  actualModel?: string;
  responseId?: string;
  /** Present for current model calls; optional keeps persisted and fixture telemetry compatible. */
  reasoningEffort?: NodeSlideReasoningEffort;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface NodeSlideJsonSchema {
  name: string;
  schema: Record<string, unknown>;
}

export type NodeSlideProviderResult =
  | { ok: true; value: unknown; telemetry: NodeSlideProviderTelemetry }
  | {
      ok: false;
      reason: string;
      telemetry?: NodeSlideProviderTelemetry;
    };

export interface NodeSlideCompletionRequest {
  provider: NodeSlideExternalProvider;
  model: string;
  supportsTemperature: boolean;
  reasoningEffort: NodeSlideReasoningEffort;
  systemPrompt: string;
  userText: string;
  maxTokens: number;
  jsonSchema?: NodeSlideJsonSchema;
  repairAttempt: boolean;
  signal: AbortSignal;
  onTextDelta?: (delta: string, accumulatedText: string) => void | Promise<void>;
}

export interface NodeSlideCompletionResult {
  text: string;
  stopReason: string;
  errorMessage?: string;
  provider?: string;
  model?: string;
  responseId?: string;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export type NodeSlideCompletion = (
  request: NodeSlideCompletionRequest,
) => Promise<NodeSlideCompletionResult>;

interface NodeSlideProviderDependencies {
  complete?: NodeSlideCompletion;
  timeoutMs?: number;
  onTextDelta?: (event: NodeSlideProviderTextDelta) => void | Promise<void>;
}

export interface NodeSlideProviderTextDelta {
  delta: string;
  accumulatedText: string;
  attempt: number;
  repairAttempt: boolean;
}

export interface NodeSlideModelProbeReceipt {
  model: NodeSlideAgentModelId;
  provider: NodeSlideExternalProvider;
  upstreamModel: string;
  actualProvider?: string;
  actualModel?: string;
  reasoningEffort: NodeSlideReasoningEffort;
  maxTokens: number;
  status: 'passed' | 'failed';
  stopReason?: string;
  latencyMs: number;
  costMicroUsd: number;
  inputTokens: number;
  outputTokens: number;
  /** Bounded proof of output presence; provider text is deliberately omitted. */
  response: { present: boolean; bytes: number };
  failure?: string;
}

/**
 * Executes exactly one bounded completion for an offered catalog route. The
 * cap is route-specific because mandatory reasoning counts against output
 * tokens; a universal 64-token cap can prove only hidden deliberation. This is
 * kept below a server-only Convex action so an unauthenticated client cannot
 * turn the fleet probe into a cost-bearing endpoint.
 */
export async function probeNodeSlideModelOnce(
  modelId: NodeSlideAgentModelId,
  dependencies: NodeSlideProviderDependencies = {},
): Promise<NodeSlideModelProbeReceipt> {
  const route = nodeSlideAgentModel(modelId);
  const probeProfile = nodeSlideModelProbeProfile(modelId);
  const complete = dependencies.complete ?? completeNodeSlideWithPiAi;
  const controller = new AbortController();
  const startedAt = Date.now();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('nodeslide_provider_timeout'));
    }, dependencies.timeoutMs ?? MODEL_TIMEOUT_MS);
  });

  try {
    const result = await Promise.race([
      complete({
        provider: route.provider,
        model: route.upstreamId,
        supportsTemperature: route.supportsTemperature,
        reasoningEffort: probeProfile.reasoningEffort,
        systemPrompt: 'Reply with one character.',
        userText: '1',
        maxTokens: probeProfile.maxTokens,
        repairAttempt: false,
        signal: controller.signal,
      }),
      deadline,
    ]);
    const bytes = responseBytes(result.text);
    const hasOutput = result.text.trim().length > 0;
    const hasExactAttribution = isVerifiedNodeSlideRouteAttribution(
      route,
      result.provider,
      result.model,
    );
    const passed =
      result.stopReason !== 'error' &&
      result.stopReason !== 'aborted' &&
      hasOutput &&
      hasExactAttribution;
    return {
      model: modelId,
      provider: route.provider,
      upstreamModel: route.upstreamId,
      ...(result.provider ? { actualProvider: result.provider } : {}),
      ...(result.model ? { actualModel: result.model } : {}),
      reasoningEffort: probeProfile.reasoningEffort,
      maxTokens: probeProfile.maxTokens,
      status: passed ? 'passed' : 'failed',
      stopReason: result.stopReason,
      latencyMs: Date.now() - startedAt,
      costMicroUsd: result.costMicroUsd,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      response: { present: hasOutput, bytes },
      ...(passed
        ? {}
        : {
            failure:
              hasOutput && !hasExactAttribution
                ? `The ${route.label} route did not return verifiable provider/model attribution.`
                : hasOutput
                  ? providerErrorReason(
                      result.errorMessage,
                      `${route.label} via ${providerDisplayName(route.provider)}`,
                    )
                  : `The ${route.label} route returned no assistant text within ${probeProfile.maxTokens} output tokens.`,
          }),
    };
  } catch {
    return {
      model: modelId,
      provider: route.provider,
      upstreamModel: route.upstreamId,
      reasoningEffort: probeProfile.reasoningEffort,
      maxTokens: probeProfile.maxTokens,
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      costMicroUsd: 0,
      inputTokens: 0,
      outputTokens: 0,
      response: { present: false, bytes: 0 },
      failure: controller.signal.aborted
        ? `The ${route.label} route timed out.`
        : `The ${route.label} route was unavailable.`,
    };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

export function nodeSlideModelProbeProfile(modelId: NodeSlideAgentModelId): {
  reasoningEffort: NodeSlideReasoningEffort;
  maxTokens: number;
} {
  switch (modelId) {
    case 'google/gemma-4-26b-a4b-it:free':
    case 'google/gemma-4-31b-it:free':
    case 'nvidia/nemotron-3-super-120b-a12b:free':
    case 'openai/gpt-oss-20b:free':
      return { reasoningEffort: 'low', maxTokens: 512 };
    case 'z-ai/glm-5.2':
      return { reasoningEffort: 'high', maxTokens: 512 };
    case 'anthropic/claude-fable-5':
      return { reasoningEffort: 'low', maxTokens: 2_048 };
    case 'google/gemini-3.5-flash':
    case 'google/gemini-3.1-pro-preview':
      return { reasoningEffort: 'low', maxTokens: 256 };
    default:
      return { reasoningEffort: 'low', maxTokens: 64 };
  }
}

export async function callNodeSlideFreeJson(
  args: {
    systemPrompt: string;
    userText: string;
    maxTokens: number;
    model?: NodeSlideAgentModelId;
    reasoningEffort?: NodeSlideReasoningEffort;
    jsonSchema?: NodeSlideJsonSchema;
    onTextDelta?: (event: NodeSlideProviderTextDelta) => void | Promise<void>;
  },
  dependencies: NodeSlideProviderDependencies = {},
): Promise<NodeSlideProviderResult> {
  const complete = dependencies.complete ?? completeNodeSlideWithPiAi;
  const selectedModel = args.model ?? NODESLIDE_DEFAULT_AGENT_MODEL;
  const reasoningEffort = args.reasoningEffort ?? NODESLIDE_DEFAULT_REASONING_EFFORT;
  if (!isNodeSlideAgentModelId(selectedModel)) {
    return { ok: false, reason: 'Choose a supported NodeSlide agent model.' };
  }
  if (!nodeSlideModelSupportsReasoningEffort(selectedModel, reasoningEffort)) {
    return {
      ok: false,
      reason: `The ${nodeSlideAgentModel(selectedModel).label} route does not support the selected reasoning effort.`,
    };
  }
  const selectedRoute = nodeSlideAgentModel(selectedModel);
  const routeLabel = `${selectedRoute.label} via ${providerDisplayName(selectedRoute.provider)}`;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error('nodeslide_provider_timeout'));
    }, dependencies.timeoutMs ?? MODEL_TIMEOUT_MS);
  });
  let telemetry = emptyTelemetry(selectedModel, reasoningEffort);
  let hasTelemetry = false;
  let invalidResponse = '';
  let nativeSchemaEnabled = Boolean(args.jsonSchema);
  const onTextDelta = dependencies.onTextDelta ?? args.onTextDelta;

  try {
    // Exactly two model calls are possible: the initial completion and one JSON-repair completion.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const repairAttempt = attempt === 1;
      const result = await Promise.race([
        complete({
          provider: selectedRoute.provider,
          model: selectedRoute.upstreamId,
          supportsTemperature: selectedRoute.supportsTemperature,
          reasoningEffort,
          systemPrompt: providerSystemPrompt(args, repairAttempt),
          userText: repairAttempt ? repairUserText(args.userText, invalidResponse) : args.userText,
          maxTokens: args.maxTokens,
          ...(args.jsonSchema && nativeSchemaEnabled ? { jsonSchema: args.jsonSchema } : {}),
          repairAttempt,
          signal: controller.signal,
          ...(onTextDelta
            ? {
                onTextDelta: (delta: string, accumulatedText: string) =>
                  onTextDelta({
                    delta,
                    accumulatedText,
                    attempt: attempt + 1,
                    repairAttempt,
                  }),
              }
            : {}),
        }),
        deadline,
      ]);
      telemetry = addTelemetry(telemetry, result);
      hasTelemetry = true;

      if (result.stopReason === 'error') {
        if (
          attempt === 0 &&
          args.jsonSchema &&
          nativeSchemaEnabled &&
          isStructuredOutputRejection(result.errorMessage)
        ) {
          nativeSchemaEnabled = false;
          invalidResponse =
            '[The provider rejected native structured-output mode. Return contract-valid JSON using the schema in the system prompt.]';
          continue;
        }
        return providerFailure(
          providerErrorReason(result.errorMessage, routeLabel),
          telemetry,
          hasTelemetry,
        );
      }
      if (result.stopReason === 'aborted' || controller.signal.aborted) {
        return providerFailure(`The ${routeLabel} route timed out.`, telemetry, hasTelemetry);
      }
      if (responseBytes(result.text) > MAX_RESPONSE_BYTES) {
        invalidResponse = '';
      } else {
        invalidResponse = result.text;
        const value = parseStrictJson(result.text);
        if (
          result.stopReason !== 'length' &&
          value !== undefined &&
          (!args.jsonSchema || matchesJsonSchema(value, args.jsonSchema.schema))
        ) {
          return { ok: true, value, telemetry };
        }
      }
    }
    return providerFailure(
      `The ${routeLabel} route returned invalid JSON after one repair attempt.`,
      telemetry,
      hasTelemetry,
    );
  } catch {
    return providerFailure(
      controller.signal.aborted
        ? `The ${routeLabel} route timed out.`
        : `The ${routeLabel} route was unavailable.`,
      telemetry,
      hasTelemetry,
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

async function completeNodeSlideWithPiAi(
  request: NodeSlideCompletionRequest,
): Promise<NodeSlideCompletionResult> {
  const model = nodeSlideModels.getModel(request.provider, request.model);
  if (!model) throw new Error('The configured NodeSlide model is missing from the pi-ai catalog.');
  const context: Context = {
    systemPrompt: request.systemPrompt,
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: request.userText }],
        timestamp: Date.now(),
      },
    ],
  };
  const reasoningDisabled = request.provider === 'openrouter' && model.reasoning === false;
  const options = {
    signal: request.signal,
    maxTokens: request.maxTokens,
    maxRetries: 0,
    // pi-ai's provider-specific OpenAI completions API reads
    // `reasoningEffort` (the higher-level `reasoning` option is ignored here).
    ...(reasoningDisabled ? {} : { reasoningEffort: request.reasoningEffort }),
    ...(request.supportsTemperature ? { temperature: 0 } : {}),
    ...(request.provider === 'openrouter' ? { headers: OPENROUTER_ATTRIBUTION_HEADERS } : {}),
    onPayload: (payload: unknown) =>
      nodeSlideProviderPayload(payload, request.jsonSchema, reasoningDisabled),
  };
  let result: AssistantMessage;
  if (request.onTextDelta) {
    const stream = nodeSlideModels.stream(model, context, options);
    let accumulatedText = '';
    for await (const event of stream) {
      if (request.signal.aborted) break;
      if (event.type !== 'text_delta') continue;
      accumulatedText += event.delta;
      // Streaming is an observability/projection path. A transient persistence
      // failure must not turn a valid provider completion into an invalid edit.
      try {
        await request.onTextDelta(event.delta, accumulatedText);
      } catch {
        // The action finalizes or interrupts any started row after planning.
      }
    }
    result = await stream.result();
  } else {
    result = await nodeSlideModels.complete(model, context, options);
  }
  return completionResult(result);
}

function completionResult(result: AssistantMessage): NodeSlideCompletionResult {
  const text = result.content
    .filter((block): block is TextContent => block.type === 'text')
    .map((block) => block.text)
    .join('');
  return {
    text,
    stopReason: result.stopReason,
    ...(result.errorMessage ? { errorMessage: result.errorMessage } : {}),
    provider: result.provider,
    model: result.responseModel ?? result.model,
    ...(result.responseId ? { responseId: result.responseId } : {}),
    costMicroUsd: usdToMicroUsd(result.usage.cost.total),
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
  };
}

export function nodeSlideStructuredOutputPayload(
  payload: unknown,
  jsonSchema: NodeSlideJsonSchema | undefined,
): unknown {
  return nodeSlideProviderPayload(payload, jsonSchema, false);
}

export function nodeSlideProviderPayload(
  payload: unknown,
  jsonSchema: NodeSlideJsonSchema | undefined,
  reasoningDisabled: boolean,
): unknown {
  if (!isPlainObject(payload)) return payload;
  return {
    ...payload,
    // OpenRouter otherwise lets some models default to hidden reasoning even
    // when pi-ai's pinned model metadata says reasoning:false.
    ...(reasoningDisabled ? { reasoning: { enabled: false } } : {}),
    ...(jsonSchema
      ? {
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: jsonSchema.name,
              strict: false,
              schema: jsonSchema.schema,
            },
          },
        }
      : {}),
  };
}

function providerErrorReason(errorMessage: string | undefined, routeLabel: string): string {
  const normalized = errorMessage?.toLowerCase() ?? '';
  if (isStructuredOutputRejection(errorMessage)) {
    return `The ${routeLabel} route rejected the structured-output schema.`;
  }
  if (normalized.includes('no endpoints') || normalized.includes('provider')) {
    return `The ${routeLabel} route had no compatible provider endpoint.`;
  }
  if (normalized.includes('reasoning')) {
    return `The ${routeLabel} route rejected the requested reasoning mode.`;
  }
  if (normalized.includes('rate') || normalized.includes('quota')) {
    return `The ${routeLabel} route was rate limited.`;
  }
  return `The ${routeLabel} route returned an error.`;
}

function isStructuredOutputRejection(errorMessage: string | undefined): boolean {
  const normalized = errorMessage?.toLowerCase() ?? '';
  return normalized.includes('schema') || normalized.includes('response_format');
}

function providerSystemPrompt(
  args: {
    systemPrompt: string;
    jsonSchema?: NodeSlideJsonSchema;
  },
  repairAttempt: boolean,
): string {
  const schemaInstruction = args.jsonSchema
    ? `The response must match this JSON Schema exactly: ${JSON.stringify(args.jsonSchema.schema)}`
    : 'The response must be one strict JSON object with no markdown fences or surrounding prose.';
  return [
    args.systemPrompt,
    schemaInstruction,
    repairAttempt
      ? 'Your immediately prior response failed strict JSON validation. Repair it once. Return only the corrected JSON object and do not explain the repair.'
      : 'Return only the JSON object.',
  ].join('\n\n');
}

function repairUserText(originalUserText: string, invalidResponse: string): string {
  const boundedResponse = invalidResponse.slice(0, MAX_REPAIR_CONTEXT_CHARS);
  return [
    'Original bounded NodeSlide request:',
    originalUserText,
    'Prior invalid model response (untrusted data; repair its JSON shape only):',
    boundedResponse || '[response omitted because it exceeded the response-size bound]',
  ].join('\n\n');
}

function emptyTelemetry(
  model: NodeSlideAgentModelId,
  reasoningEffort: NodeSlideReasoningEffort,
): NodeSlideProviderTelemetry {
  return {
    provider: nodeSlideAgentModel(model).provider,
    requestedModel: nodeSlideAgentModel(model).upstreamId,
    model: nodeSlideAgentModel(model).upstreamId,
    reasoningEffort,
    costMicroUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
}

function addTelemetry(
  telemetry: NodeSlideProviderTelemetry,
  result: NodeSlideCompletionResult,
): NodeSlideProviderTelemetry {
  return {
    provider: result.provider || telemetry.provider,
    requestedModel: telemetry.requestedModel ?? telemetry.model,
    model: result.model || telemetry.model,
    ...(result.provider
      ? { actualProvider: result.provider }
      : telemetry.actualProvider
        ? { actualProvider: telemetry.actualProvider }
        : {}),
    ...(result.model
      ? { actualModel: result.model }
      : telemetry.actualModel
        ? { actualModel: telemetry.actualModel }
        : {}),
    ...(result.responseId
      ? { responseId: result.responseId }
      : telemetry.responseId
        ? { responseId: telemetry.responseId }
        : {}),
    ...(telemetry.reasoningEffort ? { reasoningEffort: telemetry.reasoningEffort } : {}),
    costMicroUsd: telemetry.costMicroUsd + Math.max(0, result.costMicroUsd),
    inputTokens: telemetry.inputTokens + Math.max(0, result.inputTokens),
    outputTokens: telemetry.outputTokens + Math.max(0, result.outputTokens),
  };
}

function providerFailure(
  reason: string,
  telemetry: NodeSlideProviderTelemetry,
  hasTelemetry: boolean,
): NodeSlideProviderResult {
  return hasTelemetry ? { ok: false, reason, telemetry } : { ok: false, reason };
}

function responseBytes(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function isVerifiedNodeSlideRouteAttribution(
  route: { id: string; provider: string; upstreamId: string },
  actualProvider: unknown,
  actualModel: unknown,
): boolean {
  const normalizedModel =
    typeof actualModel === 'string' &&
    actualModel === actualModel.trim() &&
    actualModel.length >= 3 &&
    actualModel.length <= 256 &&
    /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/u.test(actualModel);
  return (
    actualProvider === route.provider &&
    normalizedModel &&
    (route.id === 'openrouter/free'
      ? actualModel !== route.upstreamId
      : actualModel === route.upstreamId)
  );
}

function usdToMicroUsd(usd: number): number {
  if (!Number.isFinite(usd) || usd < 0) return 0;
  return Math.floor(usd * 1_000_000);
}

function parseStrictJson(text: string): unknown | undefined {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

function matchesJsonSchema(value: unknown, schema: Record<string, unknown>): boolean {
  const constValue = schema['const'];
  const enumValues = schema['enum'];
  const oneOf = schema['oneOf'];
  const schemaType = schema['type'];
  if ('const' in schema && !Object.is(value, constValue)) return false;
  if (Array.isArray(enumValues) && !enumValues.some((candidate) => Object.is(candidate, value))) {
    return false;
  }

  if (Array.isArray(oneOf)) {
    return oneOf.some(
      (candidate) =>
        isPlainObject(candidate) && matchesJsonSchema(value, candidate as Record<string, unknown>),
    );
  }

  if (schemaType === 'object') {
    if (!isPlainObject(value)) return false;
    const objectValue = value as Record<string, unknown>;
    const schemaProperties = schema['properties'];
    const properties = isPlainObject(schemaProperties)
      ? (schemaProperties as Record<string, unknown>)
      : {};
    const required = schema['required'];
    if (
      Array.isArray(required) &&
      required.some((key) => typeof key !== 'string' || !(key in objectValue))
    ) {
      return false;
    }
    if (
      schema['additionalProperties'] === false &&
      Object.keys(objectValue).some((key) => !(key in properties))
    ) {
      return false;
    }
    return Object.entries(properties).every(([key, propertySchema]) => {
      if (!(key in objectValue)) return true;
      return (
        isPlainObject(propertySchema) &&
        matchesJsonSchema(objectValue[key], propertySchema as Record<string, unknown>)
      );
    });
  }

  if (schemaType === 'array') {
    if (!Array.isArray(value)) return false;
    const minItems = schema['minItems'];
    const maxItems = schema['maxItems'];
    const items = schema['items'];
    if (typeof minItems === 'number' && value.length < minItems) return false;
    if (typeof maxItems === 'number' && value.length > maxItems) return false;
    if (!isPlainObject(items)) return true;
    return value.every((item) => matchesJsonSchema(item, items as Record<string, unknown>));
  }

  if (schemaType === 'string') return typeof value === 'string';
  if (schemaType === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    const minimum = schema['minimum'];
    const maximum = schema['maximum'];
    if (typeof minimum === 'number' && value < minimum) return false;
    if (typeof maximum === 'number' && value > maximum) return false;
    return true;
  }
  if (schemaType === 'integer') return Number.isInteger(value);
  if (schemaType === 'boolean') return typeof value === 'boolean';
  if (schemaType === 'null') return value === null;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
