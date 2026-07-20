/**
 * Pure, deterministic NodeSlide mutation engine.
 *
 * This first boundary intentionally exposes the already-proven patch protocol
 * without moving or rewriting it. UI, Convex, auth, and provider code are not
 * part of this package.
 */
export {
  applyDeckPatch,
  changedElementIds,
  validatePatchScope,
} from '../../../shared/nodeslidePatch';
export type { PatchApplicationResult } from '../../../shared/nodeslidePatch';
