import persistentTextStreaming from '@convex-dev/persistent-text-streaming/convex.config';
import workflow from '@convex-dev/workflow/convex.config';
import { defineApp } from 'convex/server';

/**
 * Convex component registration.
 *
 * `app.use(workflow)` is what makes `components.workflow` exist in
 * `convex/_generated/api`. `convex/workflows.ts` reads it to construct the
 * durable WorkflowManager that the NodeSlide job modules
 * (nodeslideJobs, nodeslideJobControl, nodeslideJobWorkflow) start,
 * cancel and restart.
 *
 * `app.use(persistentTextStreaming)` was previously withheld with the note that
 * the component "has no consumer in this repo". That was true and is no longer:
 * `convex/nodeslideJobs.ts` now owns the consumer. Every job row carries a
 * `streamId` created through this component at enqueue time, and `getStream`
 * reads the body back. Dropping the registration again does not degrade the job
 * layer gracefully — `components.persistentTextStreaming` becomes undefined and
 * `startCreateDeck` fails before it writes a row.
 */
const app = defineApp();
app.use(workflow);
app.use(persistentTextStreaming);

export default app;
