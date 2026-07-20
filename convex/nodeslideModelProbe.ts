import { NODESLIDE_AGENT_MODELS } from '../shared/nodeslide';
import { internalAction } from './_generated/server';
import { probeNodeSlideModelOnce } from './lib/nodeslideProvider';

/** Server-only operator proof. Invoke with `npx convex run nodeslideModelProbe:runFleet --prod`. */
export const runFleet = internalAction({
  args: {},
  handler: async () => {
    const startedAt = Date.now();
    const receipts = [];
    for (const route of NODESLIDE_AGENT_MODELS) {
      receipts.push(await probeNodeSlideModelOnce(route.id));
    }
    return {
      schemaVersion: 'nodeslide.model-fleet-probe/v1' as const,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      passed: receipts.every((receipt) => receipt.status === 'passed'),
      receipts,
    };
  },
});
