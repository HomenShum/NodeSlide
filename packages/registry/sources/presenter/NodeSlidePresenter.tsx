import type { NodeSlideDeckViewerProps } from '@nodeslide/react';
import { NodeSlideDeckViewer } from '@nodeslide/react';

export function NodeSlidePresenter(props: NodeSlideDeckViewerProps) {
  return (
    <main aria-label="NodeSlide presenter" data-nodeslide-host="presenter">
      <NodeSlideDeckViewer {...props} />
    </main>
  );
}
