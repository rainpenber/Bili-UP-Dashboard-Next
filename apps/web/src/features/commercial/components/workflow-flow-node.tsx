import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { WorkflowFlowNodeData } from '../workflow-graph-flow-layout';
import { workflowNodeStatusClass, workflowNodeStatusLabel } from '../workflow-node-visual';

const handleClass =
  '!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent !opacity-0 pointer-events-none';

export function WorkflowFlowNode({ data }: NodeProps<Node<WorkflowFlowNodeData>>) {
  const { wfNode, expanded } = data;
  return (
    <div className="relative">
      <Handle type="target" position={Position.Top} id="target" className={handleClass} />
      <Card
        className={cn(
          'w-[11rem] shadow-sm transition-shadow',
          workflowNodeStatusClass(wfNode.status),
          expanded && 'ring-2 ring-ring/40',
        )}
        data-workflow-node={wfNode.id}
      >
        <CardContent className="p-2">
          <p className="text-sm font-medium leading-snug">{wfNode.name}</p>
          {expanded ? (
            <div className="mt-2 space-y-1 text-xs text-muted-foreground">
              <p>{workflowNodeStatusLabel(wfNode.status)}</p>
              {wfNode.plannedDateLabel ? <p>计划：{wfNode.plannedDateLabel}</p> : null}
              {wfNode.finishedDateLabel ? <p>完成：{wfNode.finishedDateLabel}</p> : null}
              {wfNode.blockingReason ? <p>{wfNode.blockingReason}</p> : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
      <Handle type="source" position={Position.Bottom} id="source" className={handleClass} />
    </div>
  );
}
