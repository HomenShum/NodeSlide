'use node';

import { internalAction } from './_generated/server';
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
