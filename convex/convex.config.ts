import workflow from '@convex-dev/workflow/convex.config';
import { defineApp } from 'convex/server';

/**
 * Convex component registration.
 *
 * Ported from parity-studio's `convex/convex.config.ts`, minus
 * `@convex-dev/persistent-text-streaming`. That component backs
 * parity-studio's streaming-text surface, which has no consumer in this
 * repo — registering it would have meant carrying a runtime dependency for
 * code that never landed.
 *
 * `app.use(workflow)` is what makes `components.workflow` exist in
 * `convex/_generated/api`. `convex/workflows.ts` reads it to construct the
 * durable WorkflowManager that the NodeSlide job modules
 * (nodeslideJobs, nodeslideJobControl, nodeslideJobWorkflow) start,
 * cancel and restart.
 */
const app = defineApp();
app.use(workflow);

export default app;
