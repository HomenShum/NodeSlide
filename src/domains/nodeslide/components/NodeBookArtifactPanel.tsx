import { NodeBookArtifactSurface, type NodeBookArtifactSurfaceProps } from '@nodebook/react';
import '@nodebook/react/styles.css';

export type NodeSlideNodeBookArtifactPanelProps = NodeBookArtifactSurfaceProps & {
  deckId: string;
};

/** Host adapter: NodeSlide owns deck identity; NodeBook owns artifact rendering only. */
export function NodeSlideNodeBookArtifactPanel({
  deckId,
  ...artifact
}: NodeSlideNodeBookArtifactPanelProps) {
  return (
    <div data-nodebook-host="nodeslide" data-nodebook-workspace-id={deckId}>
      <NodeBookArtifactSurface {...artifact} />
    </div>
  );
}
