/**
 * Portable NodeSlide domain contracts.
 *
 * `shared/` remains the compatibility source during the first extraction
 * slice. This entrypoint is the package boundary consumers should adopt; a
 * later source move can happen without changing this public API.
 */
export * from '../../../shared/nodeslide';
export * from '../../../shared/nodeslideGym';
export {
  NODESLIDE_CREATE_ATTACHMENT_MAX_FILES,
  NODESLIDE_CREATE_ATTACHMENT_MAX_TOTAL_BYTES,
  NODESLIDE_DATA_ATTACHMENT_MAX_BYTES,
  nodeSlideDataAttachmentShape,
  normalizeNodeSlideDataAttachment,
} from '../../../shared/nodeslideAttachments';
