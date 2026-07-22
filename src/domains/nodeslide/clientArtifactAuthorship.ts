import type { SlideElement } from '../../../shared/nodeslide';

/**
 * Server-authored semantic bindings prove the exact canonical spec that was
 * compiled. A client copy is a new artifact candidate, so it must not inherit
 * that authority from the source element.
 */
export function cloneNodeSlideElementWithoutAuthoredBinding(element: SlideElement): SlideElement {
  const clone = structuredClone(element);
  Reflect.deleteProperty(clone, 'authoredArtifactBinding');
  return clone;
}
