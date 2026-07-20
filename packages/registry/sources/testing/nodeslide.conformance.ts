import type {
  NodeSlidePatchCommand,
  NodeSlidePrincipal,
  NodeSlideRepository,
} from '@nodeslide/backend';
import type { DeckSnapshot } from '@nodeslide/contracts';
import { runNodeSlideRepositoryConformance } from '@nodeslide/testing';

export function verifyNodeSlideBackend(input: {
  repository: NodeSlideRepository;
  principal: NodeSlidePrincipal;
  initialSnapshot: DeckSnapshot;
  proposal: NodeSlidePatchCommand;
}) {
  return runNodeSlideRepositoryConformance(input);
}
