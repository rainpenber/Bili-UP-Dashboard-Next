import {
  Background,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
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

const defaultEdgeOptions = {
  type: 'smoothstep' as const,
  style: { strokeWidth: 1, stroke: 'var(--border)' },
};

/** Default fit must stay legible; user can still zoom out via controls/scroll. */
const FIT_VIEW_MIN_ZOOM = 0.85;

function FitViewOnLoad({ layoutHeight, edgeCount }: { layoutHeight: number; edgeCount: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const t = window.setTimeout(() => {
      void fitView({ padding: 0.1, maxZoom: 1.25, minZoom: FIT_VIEW_MIN_ZOOM });
    }, 80);
    return () => window.clearTimeout(t);
  }, [fitView, layoutHeight, edgeCount]);
  return null;
}

function WorkflowGraphCanvas({ graph }: { graph: WorkflowGraph }) {
  const layout = useMemo(() => layoutWorkflowGraph(graph), [graph]);
  const elements = useMemo(() => toReactFlowElements(layout), [layout]);
  const [nodes, setNodes, onNodesChange] = useNodesState(elements.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setNodes(elements.nodes);
  }, [elements.nodes, setNodes]);

  useEffect(() => {
    setEdges(elements.edges);
  }, [elements.edges, setEdges]);

  useEffect(() => {
    setNodes((nds) =>
      nds.map((n) => ({
        ...n,
        data: {
          ...n.data,
          expanded: n.id === expandedId,
        },
      })),
    );
  }, [expandedId, setNodes]);

  const onNodeClick: NodeMouseHandler = useCallback((_evt, node) => {
    setExpandedId((cur) => (cur === node.id ? null : node.id));
  }, []);

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无流程节点。</p>;
  }

  return (
    <div
      className="h-[720px] min-h-[680px] w-full overflow-hidden rounded-lg border bg-muted/10"
      style={{ maxWidth: '100%' }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={onNodeClick}
        defaultEdgeOptions={defaultEdgeOptions}
        connectionMode={ConnectionMode.Loose}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        edgesFocusable={false}
        panOnScroll
        zoomOnScroll
        minZoom={0.45}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <FitViewOnLoad layoutHeight={layout.height} edgeCount={edges.length} />
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
