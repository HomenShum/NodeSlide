/**
 * pi-ai wrapper for the MCP server. Mirrors convex/lib/piAi.ts so the MCP
 * package and the Convex backend share the same provider abstraction.
 *
 * Source: github.com/badlogic/pi-mono, packages/ai (maintained as @earendil-works/pi-ai).
 *
 * API surface:
 *   import { getModel, complete } from '@earendil-works/pi-ai/compat';
 *   const model = getModel('anthropic', 'claude-sonnet-4-6');
 *   const result = await complete(model, {
 *     systemPrompt: '...',
 *     messages: [{ role: 'user', content: [
 *       { type: 'text', text: '...' },
 *       { type: 'image', data: base64, mimeType: 'image/png' },
 *     ]}],
 *   });
 *   // result.content: (TextContent | ThinkingContent | ToolCall)[]
 *   // result.usage.cost.total: USD float
 *
 * Provider keys (read by pi-ai from process.env):
 *   ANTHROPIC_API_KEY    for claude-* models
 *   OPENAI_API_KEY       for gpt-* models
 *   GEMINI_API_KEY       for gemini-* models (via google provider)
 *   OPENROUTER_API_KEY   for vendor/model OpenRouter routing
 *   GROQ_API_KEY, CEREBRAS_API_KEY, XAI_API_KEY, MISTRAL_API_KEY ... per pi-ai
 *
 * Design rationale (override on prior commit's @anthropic-ai/sdk + openai approach):
 * pi-ai is the canonical stack across parity-studio (Convex backend uses it
 * via convex/lib/piAi.ts; the original spec calls for it; the offline PoC
 * pipeline at scripts/career/poc-headless-pipeline/ uses the same models).
 * Stack consistency > install-size optimization.
 */

import type {
  AssistantMessage,
  Context,
  ImageContent,
  TextContent,
} from '@earendil-works/pi-ai/compat';
import {
  type NodeSlideReasoningEffort,
  isNodeSlideAgentModelId,
  isNodeSlideVerifiedFreeModelId,
  nodeSlideDefaultReasoningEffort,
} from '../../../shared/nodeslide.js';
import { nodeSlideLedgerPricedCost } from '../../../shared/nodeslideRunBudget.js';

/**
 * pi-ai's Provider type is `KnownProvider | string` (open by design — users
 * can register custom providers). We narrow to a known set of vision-capable
 * providers we route to today. Add more as we validate them.
 */
export type SupportedProvider =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'groq'
  | 'cerebras'
  | 'xai'
  | 'mistral';

export interface VisionInput {
  base64: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface CallOptions {
  /** Provider id (anthropic, openai, google, openrouter, groq, cerebras, xai, mistral). */
  provider: SupportedProvider;
  /** Provider-specific model id (e.g. claude-sonnet-4-6, gpt-5, gemini-2.5-pro, openai/gpt-4o). */
  modelId: string;
  systemPrompt: string;
  userText: string;
  /** Optional vision input. Both fields required if present. Errors if model lacks vision. */
  userImage?: VisionInput;
  maxTokens?: number;
  signal?: AbortSignal;
  /** Optional local/OpenAI-compatible endpoint override. Kept in the MCP process. */
  baseUrl?: string;
}

export interface CallResult {
  text: string;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  modelUsed: string;
  provider: SupportedProvider;
  stopReason: AssistantMessage['stopReason'];
  errorMessage?: string;
}

/**
 * Infer provider from a model id. Conservative: prefers explicit prefixes
 * (anthropic/, openai/, google/) over substring sniffs (claude-*, gpt-*).
 * Used by the high-level call() so MCP tool handlers can pass a single
 * `model` string and we route correctly.
 */
export function inferProvider(modelId: string): SupportedProvider {
  // `:free` / `-free` ids and the free router exist only on OpenRouter, so the key the caller needs
  // (byok.ts) and the route `call` takes are decided here, once, not by the id's vendor prefix.
  if (isFreeLookingModelId(modelId)) return 'openrouter';
  if (modelId.startsWith('anthropic/') || modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('openai/') || modelId.startsWith('gpt-')) return 'openai';
  if (modelId.startsWith('google/') || modelId.startsWith('gemini-')) return 'google';
  if (modelId.startsWith('mistral/') || modelId.startsWith('mistral-')) return 'mistral';
  if (modelId.startsWith('groq/')) return 'groq';
  if (modelId.startsWith('cerebras/')) return 'cerebras';
  if (modelId.startsWith('xai/') || modelId.startsWith('grok-')) return 'xai';
  // Anything with a `/` and not matched above is OpenRouter convention
  if (modelId.includes('/')) return 'openrouter';
  return 'openai';
}

/**
 * Direct-Anthropic wire ids for the NodeSlide catalog's Claude rows (SPEC section 1.2, `anthropic`
 * column). The catalog id is the OpenRouter slug (`anthropic/claude-sonnet-5.5`, dotted), which is not
 * the direct id (`claude-sonnet-5-5`, dashed): stripping the prefix produced `claude-sonnet-5.5`,
 * which pi-ai's registry does not have, so the call threw before any request. An explicit table, not
 * string replacement (SPEC A.0.5). Which provider serves the id is still `inferProvider`'s choice.
 */
const DIRECT_ANTHROPIC_WIRE_ID: Readonly<Record<string, string>> = {
  'anthropic/claude-sonnet-5': 'claude-sonnet-5',
  'anthropic/claude-fable-5': 'claude-fable-5',
  'anthropic/claude-sonnet-5.5': 'claude-sonnet-5-5',
  'anthropic/claude-opus-5.5': 'claude-opus-5-5',
};

/**
 * Strip provider prefix if present so getModel(provider, id) gets the canonical
 * id. e.g. "anthropic/claude-sonnet-4-6" + provider="anthropic" -> "claude-sonnet-4-6".
 */
function canonicalizeModelId(provider: SupportedProvider, modelId: string): string {
  if (provider === 'anthropic' && Object.hasOwn(DIRECT_ANTHROPIC_WIRE_ID, modelId)) {
    return DIRECT_ANTHROPIC_WIRE_ID[modelId] as string;
  }
  // An OpenRouter id is the whole slug (`openrouter/free` is a catalog route, not a provider prefix).
  if (provider === 'openrouter') return modelId;
  const prefix = `${provider}/`;
  if (modelId.startsWith(prefix)) return modelId.slice(prefix.length);
  return modelId;
}

/** The verified free constant a free-looking unknown id resolves to (SPEC A.0.10). */
const FREE_ROUTER_MODEL_ID = 'openrouter/free';

function isFreeLookingModelId(modelId: string): boolean {
  return modelId.endsWith(':free') || modelId.endsWith('-free') || modelId === FREE_ROUTER_MODEL_ID;
}

/**
 * The row default effort in the option the model's own API reads. pi-ai's `complete` forwards options
 * untouched, and each API reads a different one: Anthropic `effort` (the mid-conversation effort
 * message), the OpenAI Responses API `reasoningEffort`, Gemini `thinking.level`. A name the API does
 * not read is dropped, which ran GPT and Gemini rows at the vendor default (medium) instead of the
 * row's (high). `effort` is always passed, as before; the other two are added for their API.
 */
function rowEffortOption(api: string, effort: NodeSlideReasoningEffort | undefined) {
  if (effort === undefined) return {};
  switch (api) {
    case 'openai-responses':
      return { effort, reasoningEffort: effort };
    case 'google-generative-ai':
      // Gemini 3.x Flash takes low / medium / high only (the catalog rows never offer more).
      return effort === 'low' || effort === 'medium' || effort === 'high'
        ? {
            effort,
            thinking: { enabled: true, level: effort.toUpperCase() as 'LOW' | 'MEDIUM' | 'HIGH' },
          }
        : { effort };
    default:
      return { effort };
  }
}

/**
 * Anthropic managed-effort rows (Opus 5.5, Sonnet 5.5) are governed by the top-level
 * `output_config.effort`. pi-ai 1.1.0 writes a fixed 'high' there and only appends the requested
 * effort as a trailing effort-only message, which the API applies "from the next user turn"
 * (migration guide, mid-conversation effort). This call is one user turn with no turn after it, so the
 * trailing message cannot govern the reply. Writing the row effort into the top-level field makes the
 * reply run at the row default. A body with no `output_config.effort` (Sonnet 5) is left untouched.
 */
function withTopLevelEffort(payload: unknown, effort: NodeSlideReasoningEffort): unknown {
  const body = payload as { output_config?: { effort?: string } };
  if (body.output_config?.effort === undefined) return payload;
  return { ...body, output_config: { ...body.output_config, effort } };
}

/**
 * Single completion call. Supports text-only and vision.
 *
 * Error handling per agentic_reliability HONEST_STATUS:
 * - Network/auth errors throw (callers wrap with try/catch and surface
 *   structured error in MCP tool response)
 * - Model returns stopReason='error' -> CallResult with errorMessage set
 * - Model returns stopReason='length' -> CallResult; caller decides whether
 *   to retry with larger maxTokens
 */
export async function call(opts: CallOptions): Promise<CallResult> {
  // Keep the sizeable provider catalog off the MCP startup/help path. Offline
  // file tools never pay this import cost; BYOK loads it only at first use.
  const pi = await import('@earendil-works/pi-ai/compat');
  let provider = opts.provider;
  let canonicalId = canonicalizeModelId(provider, opts.modelId);
  // pi-ai's getModel is typed against its compile-time MODEL registry, but
  // we accept arbitrary strings at this boundary (env-driven model overrides,
  // per-call user input). Runtime validation inside getModel throws for
  // unknown ids — we surface that as a clear error message to the agent.
  // biome-ignore lint/suspicious/noExplicitAny: see comment above
  const lookup = pi.getModel as any;
  let registryModel = lookup(provider, canonicalId);
  if (!registryModel) {
    // SPEC D1: a known id (a NodeSlide catalog row, or a SPEC 1.2 verified free id) is never rerouted
    // to another model, so one pi-ai cannot serve throws here, before any request. SPEC A.0.10: an unknown id never becomes
    // a paid default; a free-looking one resolves to the verified free router and every other unknown
    // throws.
    if (isNodeSlideAgentModelId(opts.modelId) || isNodeSlideVerifiedFreeModelId(opts.modelId)) {
      throw new Error(
        `Model "${opts.modelId}" is a known NodeSlide id but pi-ai has no ${provider} route for it; it is not rerouted.`,
      );
    }
    if (!isFreeLookingModelId(opts.modelId)) {
      throw new Error(`Unknown model "${opts.modelId}": pi-ai has no ${provider} route for it.`);
    }
    provider = 'openrouter';
    canonicalId = FREE_ROUTER_MODEL_ID;
    registryModel = lookup(provider, canonicalId);
    if (!registryModel)
      throw new Error(`The free router "${FREE_ROUTER_MODEL_ID}" is not in pi-ai.`);
  }
  // The bundled pi-ai catalog is an older price snapshot than the NodeSlide run-budget ledger
  // (kimi-k3 0.5 against 3, glm-5.2 0.171 against 0.7686), so a response on an OpenRouter route the
  // ledger prices is costed at the ledger's rate, the same one the Convex dispatcher uses.
  const pricedModel =
    provider === 'openrouter' && registryModel.cost
      ? { ...registryModel, cost: nodeSlideLedgerPricedCost(canonicalId, registryModel.cost) }
      : registryModel;
  const model = opts.baseUrl ? { ...pricedModel, baseUrl: opts.baseUrl } : pricedModel;

  const userContent: (TextContent | ImageContent)[] = [{ type: 'text', text: opts.userText }];
  if (opts.userImage !== undefined) {
    if (!model.input.includes('image')) {
      throw new Error(`pi-ai model ${provider}/${canonicalId} does not support image input`);
    }
    userContent.push({
      type: 'image',
      data: opts.userImage.base64,
      mimeType: opts.userImage.mediaType,
    });
  }

  const context: Context = {
    systemPrompt: opts.systemPrompt,
    messages: [
      {
        role: 'user',
        content: userContent,
        timestamp: Date.now(),
      },
    ],
  };

  // A NodeSlide catalog row states its own default effort (Opus 5.5 = medium). Left unset, pi-ai
  // sends 'high' for every managed-effort Claude row, which is not the row's default.
  // Every spelling of a catalog Claude row (the slug, the dashed wire id, either with the provider
  // prefix) reaches the same wire id, so the default is looked up from that wire id, not the spelling.
  const row =
    (provider === 'anthropic'
      ? Object.keys(DIRECT_ANTHROPIC_WIRE_ID).find(
          (slug) => DIRECT_ANTHROPIC_WIRE_ID[slug] === canonicalId,
        )
      : undefined) ?? opts.modelId;
  const rowEffort = isNodeSlideAgentModelId(row) ? nodeSlideDefaultReasoningEffort(row) : undefined;
  const result = await pi.complete(model, context, {
    ...rowEffortOption(model.api, rowEffort),
    ...(model.api === 'anthropic-messages' && rowEffort !== undefined
      ? { onPayload: (payload: unknown) => withTopLevelEffort(payload, rowEffort) }
      : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
    ...(opts.maxTokens !== undefined ? { maxOutputTokens: opts.maxTokens } : {}),
  });

  const textBlocks = result.content.filter((b): b is TextContent => b.type === 'text');
  const text = textBlocks.map((b) => b.text).join('');

  const out: CallResult = {
    text,
    costUsd: Number.isFinite(result.usage.cost.total) ? result.usage.cost.total : 0,
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
    provider,
    modelUsed: result.model,
    stopReason: result.stopReason,
  };
  if (result.errorMessage !== undefined) out.errorMessage = result.errorMessage;
  return out;
}

/**
 * Convenience wrapper that infers the provider from the model id. Same
 * object-arg shape as call() so renames are a one-liner. Prefer call()
 * directly when you know both provider + modelId — fewer miscategorizations
 * at the boundary.
 */
export async function callByModel(
  opts: { model: string } & Omit<CallOptions, 'provider' | 'modelId'>,
): Promise<CallResult> {
  const { model, ...rest } = opts;
  const provider = inferProvider(model);
  return await call({ provider, modelId: model, ...rest });
}
