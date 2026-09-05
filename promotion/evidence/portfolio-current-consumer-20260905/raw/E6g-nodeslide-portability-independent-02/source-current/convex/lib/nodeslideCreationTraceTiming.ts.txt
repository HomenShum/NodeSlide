export const NODESLIDE_CREATION_TRACE_MAX_ELAPSED_MS = 360_000;

/**
 * Bind an action-observed start to the mutation's authoritative completion time.
 * The action is server-side, but retries or a future caller may still supply a
 * stale value, so the accepted interval stays finite and cannot point forward.
 */
export function nodeSlideCreationTraceStartedAt(candidate: number, completedAt: number): number {
  if (
    !Number.isSafeInteger(completedAt) ||
    completedAt < 0 ||
    !Number.isSafeInteger(candidate) ||
    candidate < 0 ||
    candidate > completedAt
  ) {
    return completedAt;
  }
  return Math.max(candidate, completedAt - NODESLIDE_CREATION_TRACE_MAX_ELAPSED_MS);
}
