import { v } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { workflow } from './workflows';

/**
 * Scenario: an author kicks off a deck job, walks away, and expects it to
 * survive a transient model outage.
 *
 * Everything durable in NodeSlide's job layer hangs off this one manager
 * instance. `nodeslideJobs` calls `.start()` and `.cancel()`, `nodeslideJobControl`
 * calls `.restart()`, and `nodeslideJobWorkflow` calls `.define()` at module
 * load. Because `.define()` runs at import time, every failure below is a
 * *boot* failure of the whole job layer, not a single failed request — the
 * deploy comes up, the deck page renders, and every job silently 500s.
 *
 * These are the three ways that has actually broken:
 *   1. `convex.config.ts` stops registering the workflow component, so
 *      `components.workflow` is undefined and the manager wraps nothing.
 *   2. A `@convex-dev/workflow` upgrade renames one of the four methods the
 *      job modules consume.
 *   3. Someone edits the retry policy down. Nothing throws; jobs just stop
 *      surviving the first blip, which only shows up under production load.
 */
describe('nodeslide durable job orchestrator', () => {
  it('is wired to a registered workflow component, not an undefined one', () => {
    // If `app.use(workflow)` is dropped from convex.config.ts, `components.workflow`
    // resolves to undefined and every `.start()` fails at runtime with a confusing
    // "cannot read properties of undefined" deep inside the workpool.
    expect(workflow.component).toBeDefined();
    expect(workflow.component).not.toBeNull();
  });

  it('exposes exactly the surface the three job modules import', () => {
    // nodeslideJobs -> start, cancel; nodeslideJobControl -> restart;
    // nodeslideJobWorkflow -> define.
    for (const method of ['define', 'start', 'cancel', 'restart'] as const) {
      expect(typeof workflow[method], `workflow.${method}`).toBe('function');
    }
  });

  it('keeps a retry budget that survives a transient upstream failure', () => {
    // The sad path this defends: a model provider returns one 503 mid-run.
    // With maxAttempts at 1 the author's job dies on a blip and the only
    // signal is a support ticket. Three attempts with exponential backoff
    // (1s, 2s, 4s) is the policy this repo shipped with.
    const retry = workflow.options?.workpoolOptions?.defaultRetryBehavior;
    expect(retry).toEqual({ maxAttempts: 3, initialBackoffMs: 1_000, base: 2 });
  });

  it('bounds concurrency so a burst of jobs cannot saturate the workpool', () => {
    // Burst scenario: a workspace fires ten deck jobs in one click-through.
    // Unbounded parallelism would let one author starve every other tenant's
    // jobs; the cap is what makes the queue fair under spike.
    const maxParallelism = workflow.options?.workpoolOptions?.maxParallelism;
    expect(typeof maxParallelism).toBe('number');
    expect(maxParallelism).toBe(8);
  });

  it('defines a multi-step workflow in the shape the job modules use', () => {
    // Sustained-run shape: nodeslideJobWorkflow defines its workflows at module
    // load with an args validator and an async handler that only touches the
    // journaled `step` API. If `.define()` ever stops accepting that shape, the
    // job layer cannot even be imported.
    const defined = workflow.define({
      args: { jobId: v.string() },
      handler: async (step, { jobId }): Promise<string> => {
        // Deterministic handler: no wall-clock, no randomness, no direct db.
        // Every side effect would go through `step`, which journals and replays.
        expect(typeof step.runQuery).toBe('function');
        expect(typeof step.runAction).toBe('function');
        return jobId;
      },
    });

    // A workflow definition is registered as an *internal* mutation: internal so
    // no browser can start someone else's job by calling it directly, mutation so
    // the journal write and the kickoff land in one transaction.
    expect(defined).toBeTruthy();
    expect(defined.isMutation).toBe(true);
    expect(defined.isInternal).toBe(true);
  });
});
