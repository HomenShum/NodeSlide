import { NODESLIDE_AGENT_MODELS } from '../../shared/nodeslide';
import { type NodeSlideModelProbeReceipt, probeNodeSlideModelOnce } from './nodeslideProvider';

export const NODESLIDE_MODEL_FLEET_PROBE_SCHEMA = 'nodeslide.model-fleet-probe/v1' as const;

/**
 * Sequential by design: this is a bounded operator audit, not a public load
 * generator. The receipt contains catalog metadata and metering only; provider
 * text and provider error bodies never cross this boundary.
 */
export async function runNodeSlideModelFleetProbe(
  dependencies: {
    probe?: (
      model: (typeof NODESLIDE_AGENT_MODELS)[number]['id'],
    ) => Promise<NodeSlideModelProbeReceipt>;
    now?: () => number;
  } = {},
) {
  const probe = dependencies.probe ?? probeNodeSlideModelOnce;
  const now = dependencies.now ?? Date.now;
  const startedAt = now();
  const receipts: NodeSlideModelProbeReceipt[] = [];
  for (const route of NODESLIDE_AGENT_MODELS) receipts.push(await probe(route.id));
  const failedModelCount = receipts.filter((receipt) => receipt.status === 'failed').length;
  return {
    schemaVersion: NODESLIDE_MODEL_FLEET_PROBE_SCHEMA,
    generatedAt: new Date(startedAt).toISOString(),
    durationMs: Math.max(0, now() - startedAt),
    catalogModelCount: NODESLIDE_AGENT_MODELS.length,
    probedModelCount: receipts.length,
    failedModelCount,
    passed: receipts.length === NODESLIDE_AGENT_MODELS.length && failedModelCount === 0,
    receipts,
  };
}
