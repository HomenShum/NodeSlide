'use node';

import { internalAction } from './_generated/server';
import { runNodeSlideModelFleetProbe } from './lib/nodeslideModelFleetProbe';

/** Server-only operator proof. Invoke with `npx convex run nodeslideModelProbe:runFleet --prod`. */
export const runFleet = internalAction({
  args: {},
  handler: async () => runNodeSlideModelFleetProbe(),
});
