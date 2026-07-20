import type { NodeSlidePrincipal } from '@nodeslide/backend';
import { NODESLIDE_PERMISSIONS } from '@nodeslide/backend';
import type { DeckSnapshot } from '@nodeslide/contracts';

export interface NodeSlideSelection {
  slideId: string | null;
  elementIds: readonly string[];
}

export interface NodeSlideStudioPermissions {
  canRead: boolean;
  canPropose: boolean;
  canPatch: boolean;
  canApprove: boolean;
  canExport: boolean;
}

export function nodeSlideStudioPermissionsForPrincipal(
  principal: NodeSlidePrincipal,
): NodeSlideStudioPermissions {
  const permissions = new Set(principal.permissions);
  return {
    canRead: permissions.has(NODESLIDE_PERMISSIONS.read),
    canPropose: permissions.has(NODESLIDE_PERMISSIONS.propose),
    canPatch: permissions.has(NODESLIDE_PERMISSIONS.write),
    canApprove: permissions.has(NODESLIDE_PERMISSIONS.approve),
    canExport: permissions.has(NODESLIDE_PERMISSIONS.export),
  };
}

export function normalizeNodeSlideSelection(
  snapshot: DeckSnapshot,
  selection: NodeSlideSelection,
): NodeSlideSelection {
  const slide = snapshot.slides.find((candidate) => candidate.id === selection.slideId);
  if (!slide) return { slideId: null, elementIds: [] };
  const allowed = new Set(slide.elementOrder);
  return {
    slideId: slide.id,
    elementIds: selection.elementIds.filter((elementId) => allowed.has(elementId)),
  };
}
