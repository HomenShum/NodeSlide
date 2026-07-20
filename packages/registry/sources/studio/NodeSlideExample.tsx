import type { NodeSlideStudioShellProps } from '@nodeslide/react';
import { NodeSlideStudioShell } from '@nodeslide/react';

/** Route-neutral example. Add it to your router explicitly after reviewing it. */
export function NodeSlideExample(props: NodeSlideStudioShellProps) {
  return <NodeSlideStudioShell {...props} />;
}
