import { Handle, Position } from '@xyflow/react';

const handleClass =
  '!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0 pointer-events-none';

export type { WorkflowJunctionNodeData } from '../workflow-graph-junctions';

export function WorkflowJunctionNode() {
  return (
    <div
      className="flex size-3 items-center justify-center"
      data-workflow-junction="true"
      aria-hidden
    >
      <Handle type="target" position={Position.Top} id="target" className={handleClass} />
      <span className="size-2 rounded-full border border-border bg-foreground/70 shadow-sm" />
      <Handle type="source" position={Position.Bottom} id="source" className={handleClass} />
    </div>
  );
}
