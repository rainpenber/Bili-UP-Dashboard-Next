import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { WorkflowGraph } from '../types';
import { layoutWorkflowGraph, toReactFlowElements } from '../workflow-graph-flow-layout';
import { cn } from '@/lib/utils';
import { WorkflowFlowNode } from './workflow-flow-node';

const LEGEND = [
  { label: '已完成', className: 'border-success/50 bg-success/15' },
  { label: '进行中', className: 'border-warning/50 bg-warning/15' },
  { label: '被卡住', className: 'border-destructive/50 bg-destructive/15' },
  { label: '未到', className: 'border-border bg-muted/40' },
] as const;

const nodeTypes = { workflowNode: WorkflowFlowNode };

function FitViewOnLoad({ layoutHeight }: { layoutHeight: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = window.setTimeout(() => {
      void fitView({ padding: 0.15, maxZoom: 1.2, minZoom: 0.35 });
    }, 0);
    return () => window.clearTimeout(t);
  }, [fitView, layoutHeight]);
  return null;
}

function WorkflowGraphCanvas({ graph }: { graph: WorkflowGraph }) {
  const layout = useMemo(() => layoutWorkflowGraph(graph), [graph]);
  const base = useMemo(() => toReactFlowElements(layout), [layout]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const nodes = useMemo(
    () =>
      base.nodes.map((n) => ({
        ...n,
        data: {
          ...n.data,
          expanded: n.id === expandedId,
        },
      })),
    [base.nodes, expandedId],
  );

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    setExpandedId((cur) => (cur === node.id ? null : node.id));
  }, []);

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无流程节点。</p>;
  }

  return (
    <div
      className="h-[min(70vh,560px)] min-h-[280px] w-full overflow-hidden rounded-lg border bg-muted/10"
      style={{ maxWidth: '100%' }}
    >
      <ReactFlow
        nodes={nodes}
        edges={base.edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        panOnScroll
        zoomOnScroll
        minZoom={0.25}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background gap={16} size={1} />
        <FitViewOnLoad layoutHeight={layout.height} />
      </ReactFlow>
    </div>
  );
}

export function WorkflowGraphReadonly({ graph }: { graph: WorkflowGraph }) {
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
      <ReactFlowProvider>
        <WorkflowGraphCanvas graph={graph} />
      </ReactFlowProvider>
    </div>
  );
}
