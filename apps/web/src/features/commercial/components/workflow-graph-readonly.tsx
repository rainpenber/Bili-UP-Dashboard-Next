import { useState } from 'react';
import type { WorkflowGraph, WorkflowGraphNode } from '../types';
import {
  flattenWorkflowGraph,
  workflowNodeStatusClass,
  workflowNodeStatusLabel,
} from '../workflow-graph-layout';
import { cn } from '@/lib/utils';

const LEGEND = [
  { label: '已完成', className: 'border-success/50 bg-success/15' },
  { label: '进行中', className: 'border-warning/50 bg-warning/15' },
  { label: '被卡住', className: 'border-destructive/50 bg-destructive/15' },
  { label: '未到', className: 'border-border bg-muted/40' },
] as const;

function WorkflowNodeCard({
  node,
  expanded,
  onToggle,
  compact,
}: {
  node: WorkflowGraphNode;
  expanded: boolean;
  onToggle: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'rounded-md border px-3 py-2 text-left text-sm transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        compact ? 'min-w-[7.5rem] max-w-[11rem] flex-1 shrink-0' : 'w-full max-w-xs',
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

function VerticalStem({ className }: { className?: string }) {
  return <div className={cn('w-px bg-border', className)} aria-hidden />;
}

function ParallelForkJoinRow({
  nodes,
  expandedId,
  setExpandedId,
}: {
  nodes: WorkflowGraphNode[];
  expandedId: string | null;
  setExpandedId: (id: string | null) => void;
}) {
  return (
    <div className="flex w-full max-w-4xl flex-col items-center px-2">
      <VerticalStem className="h-4" />
      <div
        className="h-px w-full max-w-[min(100%,36rem)] bg-border"
        aria-hidden
        role="presentation"
      />
      <div className="flex w-full max-w-[min(100%,36rem)] flex-row flex-nowrap items-start justify-between gap-3">
        {nodes.map((node) => (
          <div key={node.id} className="flex min-w-0 flex-1 flex-col items-center">
            <VerticalStem className="h-3" />
            <WorkflowNodeCard
              node={node}
              compact
              expanded={expandedId === node.id}
              onToggle={() => setExpandedId(expandedId === node.id ? null : node.id)}
            />
            <VerticalStem className="h-3" />
          </div>
        ))}
      </div>
      <div
        className="h-px w-full max-w-[min(100%,36rem)] bg-border"
        aria-hidden
        role="presentation"
      />
      <VerticalStem className="h-4" />
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
    <div className="space-y-4">
      <ul className="flex flex-wrap gap-3 text-xs text-muted-foreground" aria-label="流程图图例">
        {LEGEND.map((item) => (
          <li key={item.label} className="flex items-center gap-1.5">
            <span className={cn('size-3 rounded-sm border', item.className)} aria-hidden />
            {item.label}
          </li>
        ))}
      </ul>
      <div className="overflow-x-auto pb-2">
        <div className="mx-auto flex min-w-min flex-col items-center">
          {rows.map((row, index) => (
            <div key={row.kind === 'parallel' ? row.joinId : row.node.id} className="w-full">
              {index > 0 && row.kind === 'serial' ? null : null}
              {row.kind === 'serial' ? (
                <div className="flex flex-col items-center">
                  {index > 0 ? <VerticalStem className="h-4" /> : null}
                  <WorkflowNodeCard
                    node={row.node}
                    expanded={expandedId === row.node.id}
                    onToggle={() => setExpandedId(expandedId === row.node.id ? null : row.node.id)}
                  />
                </div>
              ) : (
                <>
                  {index > 0 ? (
                    <div className="flex justify-center">
                      <VerticalStem className="h-4" />
                    </div>
                  ) : null}
                  <ParallelForkJoinRow
                    nodes={row.nodes}
                    expandedId={expandedId}
                    setExpandedId={setExpandedId}
                  />
                </>
              )}
            </div>
          ))}
          <VerticalStem className="h-2" />
        </div>
      </div>
    </div>
  );
}
