import type { NodeSlideEditorCommandId } from '../../../../shared/nodeslide';
import { InspectorPanel, type InspectorPanelProps } from './InspectorPanel';

export type NodeSlideInspectorPanelProps = InspectorPanelProps<NodeSlideEditorCommandId>;

/**
 * The inspector's lazy entry point.
 *
 * `InspectorPanel` is generic, and a generic component cannot be the target of
 * `lazy(() => import(...))` without losing its type argument. Binding the command id here
 * gives the studio one concrete default export to code-split against, so the inspector and
 * everything it pulls in (six inspectors, the trace waterfall, the JSON editor) stays out of
 * the first paint.
 */
export default function NodeSlideInspectorPanel(props: NodeSlideInspectorPanelProps) {
  return <InspectorPanel<NodeSlideEditorCommandId> {...props} />;
}
