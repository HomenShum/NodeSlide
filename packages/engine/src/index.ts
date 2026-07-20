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

/**
 * Compatibility exports for the product's pure patch and candidate validators.
 * Their source can move out of `convex/lib` without changing package consumers.
 */
export {
  NODESLIDE_DECK_EMBEDDED_IMAGE_BUDGET,
  isAllowedNodeSlideAddedImageUrl,
  validateNodeSlidePatch,
} from '../../../convex/lib/nodeslidePatches';
export { validateNodeSlideSnapshot } from '../../../convex/lib/nodeslideValidation';
