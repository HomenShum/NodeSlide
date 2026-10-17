'use node';

import { api, internal } from './_generated/api';
import { internalAction } from './_generated/server';
import { bindNodeSlideBudgetLedgerClient } from './lib/nodeslideBudgetedProvider';
import {
  type NodeSlideExecutorSplitProbeReceipt,
  executorSplitProbeBudgetUsd,
  runNodeSlideExecutorSplitProbe,
} from './lib/nodeslideExecutorSplitProbe';
import {
  runNodeSlideFreeRouterProbe,
  runNodeSlideFreeRouterStructuredProbe,
  runNodeSlideModelFleetProbe,
} from './lib/nodeslideModelFleetProbe';

/** Server-only operator proof. Invoke with `npx convex run nodeslideModelProbe:runFleet --prod`. */
export const runFleet = internalAction({
  args: {},
  handler: async () => runNodeSlideModelFleetProbe(),
});

/** Bounded, server-only qualification of the explicit zero-priced OpenRouter cohort. */
export const runFreeRouterFleet = internalAction({
  args: {},
  handler: async () => runNodeSlideFreeRouterProbe(),
});

/** Bounded JSON-schema qualification for the zero-priced cohort. */
export const runFreeRouterStructured = internalAction({
  args: {},
  handler: async () => runNodeSlideFreeRouterStructuredProbe(),
});

// Convex's generated API makes this action's own file part of the reference types it calls through,
// which TypeScript reads as a self-reference. Same confined escape hatch as convex/nodeslideAgent.ts.
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference described above
const generatedApi: any = api;
// biome-ignore lint/suspicious/noExplicitAny: generated Convex self-reference described above
const generatedInternal: any = internal;

/**
 * Candidate-bound executor receipt (SPEC Part A, section A.2.8): one premium-planner edit turn split
 * to the routed copy executor through the reserve-before-dispatch provider. Spends real provider
 * money, capped by NODESLIDE_PROBE_BUDGET_USD (default 0.55 USD, planner and executor together).
 * Invoke with `npx convex run nodeslideModelProbe:runExecutorSplit`.
 */
export const runExecutorSplit = internalAction({
  args: {},
  handler: async (ctx): Promise<NodeSlideExecutorSplitProbeReceipt> => {
    const buildIdentity = await ctx.runQuery(generatedApi.nodeslideBuildIdentity.get, {});
    return runNodeSlideExecutorSplitProbe({
      ledger: bindNodeSlideBudgetLedgerClient(ctx, generatedInternal.nodeslideBudgets),
      buildIdentity,
      budgetUsd: executorSplitProbeBudgetUsd(process.env),
    });
  },
});
