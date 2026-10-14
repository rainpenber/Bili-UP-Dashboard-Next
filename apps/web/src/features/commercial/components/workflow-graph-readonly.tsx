import { useState } from 'react';
import type { WorkflowGraph, WorkflowGraphNode } from '../types';
import {
  flattenWorkflowGraph,
  workflowNodeStatusClass,
  workflowNodeStatusLabel,
} from '../workflow-graph-layout';
import { cn } from '@/lib/utils';

function WorkflowNodeCard({
  node,
  expanded,
  onToggle,
}: {
  node: WorkflowGraphNode;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'w-full max-w-xs rounded-md border px-3 py-2 text-left text-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        workflowNodeStatusClass(node.status),
        expanded && 'ring-2 ring-ring/40',
      )}
      aria-expanded={expanded}
    >
      <span className="font-medium">{node.name}</span>
      {expanded ? (
        <div className="mt-2 space-y-1 text-xs opacity-90">
          <p>状态：{workflowNodeStatusLabel(node.status)}</p>
          {node.plannedDateLabel ? <p>计划：{node.plannedDateLabel}</p> : null}
          {node.finishedDateLabel ? <p>完成：{node.finishedDateLabel}</p> : null}
          {node.blockingReason ? <p>卡住原因：{node.blockingReason}</p> : null}
        </div>
      ) : null}
    </button>
  );
}

function Connector() {
  return (
    <div className="flex justify-center py-1" aria-hidden>
      <div className="h-6 w-px bg-border" />
    </div>
  );
}

export function WorkflowGraphReadonly({ graph }: { graph: WorkflowGraph }) {
  const rows = flattenWorkflowGraph(graph);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无流程节点。</p>;
  }

  return (
    <div className="overflow-x-auto pb-2">
      <div className="mx-auto flex min-w-min flex-col items-center">
        {rows.map((row, index) => (
          <div key={`${row.kind}-${index}`} className="flex w-full flex-col items-center">
            {index > 0 ? <Connector /> : null}
            {row.kind === 'node' ? (
              <WorkflowNodeCard
                node={row.node}
                expanded={expandedId === row.node.id}
                onToggle={() => setExpandedId((cur) => (cur === row.node.id ? null : row.node.id))}
              />
            ) : (
              <div className="flex flex-wrap items-start justify-center gap-3 px-2">
                {row.nodes.map((node) => (
                  <WorkflowNodeCard
                    key={node.id}
                    node={node}
                    expanded={expandedId === node.id}
                    onToggle={() => setExpandedId((cur) => (cur === node.id ? null : node.id))}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
