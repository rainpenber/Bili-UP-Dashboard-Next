import {
  Background,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useStore,
  type EdgeTypes,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { WorkflowGraph } from '../types';
import {
  layoutWorkflowGraph,
  toReactFlowElements,
  type WorkflowNodeEditorActions,
} from '../workflow-graph-flow-layout';
import { WorkflowFlowNode } from './workflow-flow-node';
import { WorkflowJunctionNode } from './workflow-junction-node';
import { WorkflowRoutedEdge } from './workflow-routed-edge';

const nodeTypes = { workflowNode: WorkflowFlowNode, workflowJunction: WorkflowJunctionNode };
const edgeTypes = { workflowRouted: WorkflowRoutedEdge };

const defaultEdgeOptions = {
  type: 'workflowRouted' as const,
  style: { strokeWidth: 1, stroke: 'var(--border)' },
};

const FIT_VIEW_MIN_ZOOM = 0.85;

function serializeViewport(vp: { x: number; y: number; zoom: number }): string {
  return JSON.stringify([vp.x, vp.y, vp.zoom]);
}

function WorkflowViewportLock({
  fitKey,
  selectionEpoch,
}: {
  fitKey: string;
  selectionEpoch: string;
}) {
  const { fitView, getViewport, setViewport } = useReactFlow();
  const lockedRef = useRef<string | null>(null);
  const fitKeyRef = useRef<string | null>(null);
  const nodeMeasureEpoch = useStore((s) =>
    s.nodes.map((n) => `${n.id}:${n.measured?.height ?? n.height ?? 0}`).join('|'),
  );

  useEffect(() => {
    if (fitKeyRef.current !== fitKey) {
      fitKeyRef.current = fitKey;
      lockedRef.current = null;
      const t = window.setTimeout(() => {
        void fitView({ padding: 0.1, maxZoom: 1.25, minZoom: FIT_VIEW_MIN_ZOOM }).then(() => {
          lockedRef.current = serializeViewport(getViewport());
        });
      }, 80);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [fitKey, fitView, getViewport]);

  useEffect(() => {
    if (!lockedRef.current) return;
    const [x, y, zoom] = JSON.parse(lockedRef.current) as [number, number, number];
    setViewport({ x, y, zoom }, { duration: 0 });
  }, [selectionEpoch, nodeMeasureEpoch, setViewport]);

  return null;
}

export function WorkflowGraphCanvas({
  graph,
  selectedNodeId,
  onSelectNode,
  buildNodeEditor,
}: {
  graph: WorkflowGraph;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  buildNodeEditor?: (nodeId: string) => WorkflowNodeEditorActions | undefined;
}) {
  const layout = useMemo(() => layoutWorkflowGraph(graph), [graph]);
  const elements = useMemo(() => toReactFlowElements(layout), [layout]);
  const fitKey = `${layout.width}x${layout.height}x${layout.edges.length}x${layout.junctions.length}`;

  const activateNode = useCallback(
    (nodeId: string) => {
      onSelectNode(selectedNodeId === nodeId ? null : nodeId);
    },
    [onSelectNode, selectedNodeId],
  );

  const decorateNodes = useCallback(
    (base: typeof elements.nodes) =>
      base.map((n) => {
        if (n.type === 'workflowJunction') return n;
        return {
          ...n,
          data: {
            ...n.data,
            expanded: n.id === selectedNodeId,
            selected: n.id === selectedNodeId,
            onNodeActivate: activateNode,
            editor: buildNodeEditor?.(n.id),
          },
        };
      }),
    [activateNode, buildNodeEditor, selectedNodeId],
  );

  const decoratedNodes = useMemo(
    () => decorateNodes(elements.nodes),
    [elements.nodes, decorateNodes],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(decoratedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(elements.edges);

  useEffect(() => {
    setNodes(decoratedNodes);
  }, [decoratedNodes, setNodes]);

  useEffect(() => {
    setEdges(elements.edges);
  }, [elements.edges, setEdges]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      if (node.type === 'workflowJunction') return;
      activateNode(node.id);
    },
    [activateNode],
  );

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无流程节点。</p>;
  }

  return (
    <div
      className="h-[720px] min-h-[680px] w-full overflow-hidden rounded-lg border bg-muted/10"
      style={{ maxWidth: '100%' }}
      data-testid="workflow-graph-canvas"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes as EdgeTypes}
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
        fitView={false}
        autoPanOnNodeFocus={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={16} size={1} />
        <WorkflowViewportLock fitKey={fitKey} selectionEpoch={selectedNodeId ?? ''} />
      </ReactFlow>
    </div>
  );
}

export function WorkflowGraphCanvasProvider(props: {
  graph: WorkflowGraph;
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
  buildNodeEditor?: (nodeId: string) => WorkflowNodeEditorActions | undefined;
}) {
  return (
    <ReactFlowProvider>
      <WorkflowGraphCanvas {...props} />
    </ReactFlowProvider>
  );
}
