import type { NodeSlideRepository } from '@nodeslide/backend';

/** Implement this port in server-owned code, then run nodeslide.conformance.ts. */
export function createNodeSlideBackend(): NodeSlideRepository {
  throw new Error('Connect your governed NodeSlideRepository implementation.');
}
