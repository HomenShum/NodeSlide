import {
  NODESLIDE_FREE_ROUTER_CANDIDATES,
  NODESLIDE_OFFERED_AGENT_MODELS,
  type NodeSlideAgentModelId,
} from '../../shared/nodeslide';
import {
  type NodeSlideModelProbeReceipt,
  callNodeSlideFreeJson,
  isVerifiedNodeSlideRouteAttribution,
  probeNodeSlideModelOnce,
} from './nodeslideProvider';

export const NODESLIDE_MODEL_FLEET_PROBE_SCHEMA = 'nodeslide.model-fleet-probe/v1' as const;

/**
 * Sequential by design: this is a bounded operator audit, not a public load
 * generator. The receipt contains catalog metadata and metering only; provider
 * text and provider error bodies never cross this boundary.
 */
export async function runNodeSlideModelFleetProbe(
  dependencies: {
    probe?: (
      model: (typeof NODESLIDE_OFFERED_AGENT_MODELS)[number]['id'],
    ) => Promise<NodeSlideModelProbeReceipt>;
    now?: () => number;
  } = {},
) {
  const probe = dependencies.probe
    ? (model: NodeSlideAgentModelId) =>
        dependencies.probe?.(
          model as (typeof NODESLIDE_OFFERED_AGENT_MODELS)[number]['id'],
        ) as Promise<NodeSlideModelProbeReceipt>
    : probeNodeSlideModelOnce;
  return runFleet(
    NODESLIDE_OFFERED_AGENT_MODELS,
    probe,
    dependencies.now ?? Date.now,
    NODESLIDE_MODEL_FLEET_PROBE_SCHEMA,
  );
}

export const NODESLIDE_FREE_ROUTER_PROBE_SCHEMA = 'nodeslide.free-router-fleet-probe/v1' as const;
export const NODESLIDE_FREE_ROUTER_STRUCTURED_PROBE_SCHEMA =
  'nodeslide.free-router-structured-probe/v1' as const;

/** Qualifies only explicitly zero-priced candidate routes; it does not expose them to clients. */
export async function runNodeSlideFreeRouterProbe(
  dependencies: {
    probe?: (model: NodeSlideAgentModelId) => Promise<NodeSlideModelProbeReceipt>;
    now?: () => number;
  } = {},
) {
  const probe = dependencies.probe ?? probeNodeSlideModelOnce;
  return runFleet(
    NODESLIDE_FREE_ROUTER_CANDIDATES,
    probe,
    dependencies.now ?? Date.now,
    NODESLIDE_FREE_ROUTER_PROBE_SCHEMA,
  );
}

/** Second-stage qualification against the strict JSON contract used by deck generation. */
export async function runNodeSlideFreeRouterStructuredProbe() {
  const startedAt = Date.now();
  const receipts = [];
  for (const route of NODESLIDE_FREE_ROUTER_CANDIDATES) {
    const routeStartedAt = Date.now();
    const result = await callNodeSlideFreeJson({
      model: route.id,
      reasoningEffort: 'low',
      maxTokens: 512,
      systemPrompt: 'Return the requested bounded qualification object.',
      userText: 'Set ok to true and marker to nodeslide.',
      jsonSchema: {
        name: 'nodeslide_free_router_qualification',
        schema: {
          type: 'object',
          properties: {
            ok: { const: true },
            marker: { const: 'nodeslide' },
          },
          required: ['ok', 'marker'],
          additionalProperties: false,
        },
      },
    });
    const responseBytes = result.ok
      ? new TextEncoder().encode(JSON.stringify(result.value)).length
      : 0;
    const actualProvider = result.telemetry?.actualProvider;
    const actualModel = result.telemetry?.actualModel;
    const attributionVerified = isVerifiedNodeSlideRouteAttribution(
      route,
      actualProvider,
      actualModel,
    );
    const zeroCostVerified =
      Number.isSafeInteger(result.telemetry?.costMicroUsd) && result.telemetry?.costMicroUsd === 0;
    const qualified = result.ok && attributionVerified && zeroCostVerified;
    const failure = !result.ok
      ? result.reason
      : !attributionVerified
        ? 'The route did not return verifiable provider/model attribution.'
        : !zeroCostVerified
          ? 'The candidate route did not return exact zero-cost telemetry.'
          : undefined;
    receipts.push({
      model: route.id,
      upstreamModel: route.upstreamId,
      provider: route.provider,
      ...(result.telemetry?.actualProvider
        ? { actualProvider: result.telemetry.actualProvider }
        : {}),
      ...(result.telemetry?.actualModel ? { actualModel: result.telemetry.actualModel } : {}),
      status: qualified ? ('passed' as const) : ('failed' as const),
      latencyMs: Date.now() - routeStartedAt,
      costMicroUsd: result.telemetry?.costMicroUsd ?? 0,
      inputTokens: result.telemetry?.inputTokens ?? 0,
      outputTokens: result.telemetry?.outputTokens ?? 0,
      response: { present: result.ok, bytes: responseBytes },
      ...(failure ? { failure } : {}),
    });
  }
  const failedModelCount = receipts.filter((receipt) => receipt.status === 'failed').length;
  return {
    schemaVersion: NODESLIDE_FREE_ROUTER_STRUCTURED_PROBE_SCHEMA,
    generatedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    catalogModelCount: NODESLIDE_FREE_ROUTER_CANDIDATES.length,
    probedModelCount: receipts.length,
    failedModelCount,
    passed: receipts.length === NODESLIDE_FREE_ROUTER_CANDIDATES.length && failedModelCount === 0,
    receipts,
  };
}

async function runFleet(
  routes: readonly { id: NodeSlideAgentModelId }[],
  probe: (model: NodeSlideAgentModelId) => Promise<NodeSlideModelProbeReceipt>,
  now: () => number,
  schemaVersion:
    | typeof NODESLIDE_MODEL_FLEET_PROBE_SCHEMA
    | typeof NODESLIDE_FREE_ROUTER_PROBE_SCHEMA,
) {
  const startedAt = now();
  const receipts: NodeSlideModelProbeReceipt[] = [];
  for (const route of routes) {
    const receipt = await probe(route.id);
    const requiresZeroCost = schemaVersion === NODESLIDE_FREE_ROUTER_PROBE_SCHEMA;
    receipts.push(
      requiresZeroCost &&
        receipt.status === 'passed' &&
        (!Number.isSafeInteger(receipt.costMicroUsd) || receipt.costMicroUsd !== 0)
        ? {
            ...receipt,
            status: 'failed',
            failure: 'The candidate route did not return exact zero-cost telemetry.',
          }
        : receipt,
    );
  }
  const failedModelCount = receipts.filter((receipt) => receipt.status === 'failed').length;
  return {
    schemaVersion,
    generatedAt: new Date(startedAt).toISOString(),
    durationMs: Math.max(0, now() - startedAt),
    catalogModelCount: routes.length,
    probedModelCount: receipts.length,
    failedModelCount,
    passed: receipts.length === routes.length && failedModelCount === 0,
    receipts,
  };
}
