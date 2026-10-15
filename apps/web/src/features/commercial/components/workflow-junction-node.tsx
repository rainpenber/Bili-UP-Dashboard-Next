import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { JUNCTION_ACCENT, type WorkflowJunctionNodeData } from '../workflow-graph-junctions';

const handleClass =
  '!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0 pointer-events-none';

export type { WorkflowJunctionNodeData } from '../workflow-graph-junctions';

/** Display-only meeting marker. Anchors keep edge endpoints and paint nothing. */
export function WorkflowJunctionNode({ data }: NodeProps<Node<WorkflowJunctionNodeData>>) {
  if (data.marker !== 'dot') {
    return (
      <div className="pointer-events-none" aria-hidden>
        <Handle type="target" position={Position.Top} id="target" className={handleClass} />
        <Handle type="source" position={Position.Bottom} id="source" className={handleClass} />
      </div>
    );
  }

  return (
    <div
      className="pointer-events-none size-full rounded-full"
      data-workflow-junction="true"
      style={{ backgroundColor: JUNCTION_ACCENT }}
      aria-hidden
    />
  );
}
