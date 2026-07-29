import { WorkflowManager } from '@convex-dev/workflow';
import { components } from './_generated/api';

/**
 * The durable-orchestration manager shared by every NodeSlide job module.
 *
 * Why @convex-dev/workflow (not the Agent component): Agent locks to
 * Vercel AI SDK; we want pi-ai. Workflow is independent and gives us
 * exactly the durable-multi-step + retry + replay shape we need.
 *
 * Workflow handlers must be deterministic. All side effects go through
 * `step.runAction` / `step.runQuery` so they get journaled and replayed.
 *
 * PORTING NOTE — this file is deliberately a subset of parity-studio's
 * `convex/workflows.ts`. That file also defines three parity-studio
 * pipeline entry points — `iterateWithCommentsWorkflow`,
 * `verifyImportedKit` and `parityStudioWorkflow` — which orchestrate the
 * screenshot-to-UI-kit parity pipeline over six Convex modules that do not
 * exist here (`runs`, `artifacts`, `uiKits`, `comments`, `parityReports`,
 * `generation`) and the tables behind them. Landing them would have
 * required inventing that whole layer, which is an owner decision, not a
 * port. They stay in parity-studio; only the manager crosses over, because
 * the manager is the piece the NodeSlide job modules import.
 */
export const workflow = new WorkflowManager(components.workflow, {
  workpoolOptions: {
    maxParallelism: 8,
    defaultRetryBehavior: {
      maxAttempts: 3,
      initialBackoffMs: 1_000,
      base: 2,
    },
  },
});
