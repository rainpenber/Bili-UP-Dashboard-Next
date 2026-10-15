import {
  Background,
  ConnectionMode,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type EdgeTypes,
  type NodeMouseHandler,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
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

function cloneViewport(vp: Viewport): Viewport {
  return { x: vp.x, y: vp.y, zoom: vp.zoom };
}

function WorkflowInitialViewport({
  fitKey,
  containerRef,
  onLocked,
}: {
  fitKey: string;
  containerRef: RefObject<HTMLElement | null>;
  onLocked: (vp: Viewport) => void;
}) {
  const { fitView, getViewport } = useReactFlow();
  const fittedForKey = useRef<string | null>(null);

  useEffect(() => {
    if (fittedForKey.current === fitKey) return;
    let cancelled = false;

    const runFit = () => {
      const shell = containerRef.current;
      if (!shell || shell.clientWidth < 1 || shell.clientHeight < 1) {
        requestAnimationFrame(runFit);
        return;
      }
      void fitView({ padding: 0.1, maxZoom: 1.25, minZoom: FIT_VIEW_MIN_ZOOM }).then(() => {
        if (cancelled) return;
        const vp = cloneViewport(getViewport());
        fittedForKey.current = fitKey;
        onLocked(vp);
      });
    };

    requestAnimationFrame(runFit);
    return () => {
      cancelled = true;
    };
  }, [fitKey, fitView, getViewport, containerRef, onLocked]);

  return null;
}

function WorkflowViewportGuard({
  lockedRef,
  revision,
}: {
  lockedRef: RefObject<Viewport | null>;
  revision: string;
}) {
  const { getViewport, setViewport } = useReactFlow();

  useLayoutEffect(() => {
    const locked = lockedRef.current;
    if (!locked) return;
    const current = getViewport();
    if (
      Math.abs(current.x - locked.x) > 0.001 ||
      Math.abs(current.y - locked.y) > 0.001 ||
      Math.abs(current.zoom - locked.zoom) > 0.000_001
    ) {
      setViewport(cloneViewport(locked), { duration: 0 });
    }
  }, [revision, getViewport, setViewport, lockedRef]);

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
  const containerRef = useRef<HTMLDivElement>(null);
  const lockedViewport = useRef<Viewport | null>(null);
  const userPanning = useRef(false);

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
  const [viewport, setViewportState] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });

  const onLocked = useCallback((vp: Viewport) => {
    lockedViewport.current = cloneViewport(vp);
    setViewportState(cloneViewport(vp));
  }, []);

  useEffect(() => {
    lockedViewport.current = null;
  }, [fitKey]);

  useEffect(() => {
    setNodes(decoratedNodes);
  }, [decoratedNodes, setNodes]);

  useEffect(() => {
    setEdges(elements.edges);
  }, [elements.edges, setEdges]);

  const revision = `${selectedNodeId ?? ''}|${nodes.map((n) => n.id + (n.measured?.height ?? 0)).join(',')}`;

  useLayoutEffect(() => {
    if (!lockedViewport.current) return;
    setViewportState(cloneViewport(lockedViewport.current));
  }, [revision]);

  const onNodeClick: NodeMouseHandler = useCallback(
    (_evt, node) => {
      if (node.type === 'workflowJunction') return;
      activateNode(node.id);
    },
    [activateNode],
  );

  const onMoveStart = useCallback(() => {
    userPanning.current = true;
  }, []);

  const onMoveEnd = useCallback((_: unknown, vp: Viewport) => {
    userPanning.current = false;
    lockedViewport.current = cloneViewport(vp);
    setViewportState(cloneViewport(vp));
  }, []);

  if (nodes.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无流程节点。</p>;
  }

  return (
    <div
      ref={containerRef}
      className="h-[720px] min-h-[680px] w-full overflow-hidden rounded-lg border bg-muted/10"
      style={{ maxWidth: '100%' }}
      data-testid="workflow-graph-canvas"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes as EdgeTypes}
        viewport={viewport}
        onViewportChange={(vp) => {
          if (userPanning.current) setViewportState(cloneViewport(vp));
          else if (lockedViewport.current) setViewportState(cloneViewport(lockedViewport.current));
        }}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
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
        <WorkflowInitialViewport fitKey={fitKey} containerRef={containerRef} onLocked={onLocked} />
        <WorkflowViewportGuard lockedRef={lockedViewport} revision={revision} />
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
