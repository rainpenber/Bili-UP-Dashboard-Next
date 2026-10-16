import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnConnectEnd,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { JunctionNode, StageNode, type JunctionNodeData, type StageNodeData } from './flow-nodes';
import {
  JUNCTION_SIZE,
  STAGE_H,
  STAGE_W,
  addJunction,
  addStageNode,
  applyPositions,
  cloneGraph,
  commitDrag,
  commitHistory,
  connectNodes,
  redoHistory,
  removeElements,
  removeJunction,
  undoHistory,
  type FlowGraph,
  type HistoryState,
} from './model';
import './workflow-mock.css';

const nodeTypes = { stage: StageNode, junction: JunctionNode };

const toolButton =
  'border-white/15 bg-transparent text-zinc-100 hover:bg-white/10 hover:text-zinc-100';

type FlowNode = Node<StageNodeData | JunctionNodeData>;

/** Declared ports so edges render before ResizeObserver measures the DOM handles. */
function portHandles(width: number, height: number) {
  return [
    {
      id: 'in',
      type: 'target' as const,
      position: Position.Left,
      x: 0,
      y: height / 2,
      width: 1,
      height: 1,
    },
    {
      id: 'out',
      type: 'source' as const,
      position: Position.Right,
      x: width,
      y: height / 2,
      width: 1,
      height: 1,
    },
  ];
}

/** Both ports sit on the dot center so wires meet inside the circle. */
function junctionHandles() {
  const port = 6;
  const y = (JUNCTION_SIZE - port) / 2;
  return [
    {
      id: 'in',
      type: 'target' as const,
      position: Position.Left,
      x: -14,
      y,
      width: port,
      height: port,
    },
    {
      id: 'out',
      type: 'source' as const,
      position: Position.Right,
      x: JUNCTION_SIZE + 8,
      y,
      width: port,
      height: port,
    },
  ];
}

function toFlowNodes(graph: FlowGraph): FlowNode[] {
  return graph.nodes.map((node) => {
    if (node.kind === 'merge') {
      return {
        id: node.id,
        type: 'junction',
        position: { x: node.x, y: node.y },
        data: { kind: 'merge' },
        draggable: true,
        selectable: false,
        connectable: true,
        focusable: false,
        deletable: false,
        width: JUNCTION_SIZE,
        height: JUNCTION_SIZE,
        measured: { width: JUNCTION_SIZE, height: JUNCTION_SIZE },
        handles: junctionHandles(),
        style: { width: JUNCTION_SIZE, height: JUNCTION_SIZE, overflow: 'visible' },
      };
    }
    return {
      id: node.id,
      type: 'stage',
      position: { x: node.x, y: node.y },
      data: { name: node.name },
      width: STAGE_W,
      height: STAGE_H,
      measured: { width: STAGE_W, height: STAGE_H },
      handles: portHandles(STAGE_W, STAGE_H),
    };
  });
}

function toFlowEdges(graph: FlowGraph): Edge[] {
  return graph.edges.map((item) => ({
    id: item.id,
    source: item.source,
    target: item.target,
    sourceHandle: 'out',
    targetHandle: 'in',
    selectable: true,
  }));
}

function CanvasInner({
  label,
  initial,
  onBack,
}: {
  label: string;
  initial: FlowGraph;
  onBack: (graph: FlowGraph) => void;
}) {
  const [history, setHistory] = useState<HistoryState>(() => ({
    past: [],
    present: cloneGraph(initial),
    future: [],
  }));
  const [nodes, setNodes] = useState<FlowNode[]>(() => toFlowNodes(initial));
  const [edges, setEdges] = useState<Edge[]>(() => toFlowEdges(initial));
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const historyRef = useRef(history);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const dragOrigin = useRef<FlowGraph | null>(null);
  const accepted = useRef(false);
  const [connecting, setConnecting] = useState(false);
  const [menu, setMenu] = useState<
    | { kind: 'pane'; at: { x: number; y: number } }
    | { kind: 'junction'; id: string }
    | { kind: 'edge'; id: string }
    | null
  >(null);
  const shellRef = useRef<HTMLDivElement>(null);
  historyRef.current = history;
  nodesRef.current = nodes;
  edgesRef.current = edges;
  const { fitView, screenToFlowPosition, setViewport, getNodes } = useReactFlow();

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 1600);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    let frame = 0;
    let tries = 0;
    const run = () => {
      if (booted.current || tries > 30) return;
      tries += 1;
      const stages = getNodes().filter((node) => node.type === 'stage');
      const shell = shellRef.current?.querySelector('.react-flow');
      if (stages.length === 0 || !shell || shell.clientHeight < 2) {
        frame = requestAnimationFrame(run);
        return;
      }
      booted.current = true;
      const minY = Math.min(...stages.map((node) => node.position.y));
      const maxY = Math.max(
        ...stages.map((node) => node.position.y + (node.measured?.height ?? STAGE_H)),
      );
      const midY = (minY + maxY) / 2;
      void setViewport({ x: 36, y: shell.clientHeight / 2 - midY, zoom: 1 });
    };
    frame = requestAnimationFrame(run);
    return () => cancelAnimationFrame(frame);
  }, [getNodes, setViewport]);

  const sync = useCallback((graph: FlowGraph) => {
    const selectedNodes = new Set(
      nodesRef.current.filter((node) => node.selected).map((node) => node.id),
    );
    const selectedEdges = new Set(
      edgesRef.current.filter((edge) => edge.selected).map((edge) => edge.id),
    );
    const nextNodes = toFlowNodes(graph).map((node) => ({
      ...node,
      selected: selectedNodes.has(node.id),
    }));
    const nextEdges = toFlowEdges(graph).map((edge) => ({
      ...edge,
      selected: selectedEdges.has(edge.id),
    }));
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, []);

  const commit = useCallback(
    (next: FlowGraph) => {
      const updated = commitHistory(historyRef.current, next);
      historyRef.current = updated;
      setHistory(updated);
      sync(next);
    },
    [sync],
  );

  const undo = useCallback(() => {
    const updated = undoHistory(historyRef.current);
    historyRef.current = updated;
    setHistory(updated);
    sync(updated.present);
  }, [sync]);

  const redo = useCallback(() => {
    const updated = redoHistory(historyRef.current);
    historyRef.current = updated;
    setHistory(updated);
    sync(updated.present);
  }, [sync]);

  const deleteSelection = useCallback(() => {
    const nodeIds = nodesRef.current
      .filter((node) => node.selected && node.type === 'stage')
      .map((node) => node.id);
    const edgeIds = edgesRef.current.filter((edge) => edge.selected).map((edge) => edge.id);
    if (nodeIds.length === 0 && edgeIds.length === 0) return;
    commit(removeElements(historyRef.current.present, nodeIds, edgeIds));
  }, [commit]);

  const selectAll = useCallback(() => {
    const nextNodes = nodesRef.current.map((node) => ({
      ...node,
      selected: node.type === 'stage',
    }));
    const nextEdges = edgesRef.current.map((edge) => ({ ...edge, selected: false }));
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, []);

  const clearSelection = useCallback(() => {
    const nextNodes = nodesRef.current.map((node) => ({ ...node, selected: false }));
    const nextEdges = edgesRef.current.map((edge) => ({ ...edge, selected: false }));
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
  }, []);

  const viewCenter = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return undefined;
    const rect = shell.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return undefined;
    return screenToFlowPosition({
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    });
  }, [screenToFlowPosition]);

  const submitAdd = useCallback(() => {
    const result = addStageNode(historyRef.current.present, draft, viewCenter());
    if (!result.ok) {
      setNotice(result.message);
      return;
    }
    setDraft('');
    setAdding(false);
    commit(result.graph);
  }, [commit, draft, viewCenter]);

  const actions = useRef({ undo, redo, deleteSelection, selectAll, fitView, clearSelection });
  actions.current = { undo, redo, deleteSelection, selectAll, fitView, clearSelection };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (meta && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) actions.current.redo();
        else actions.current.undo();
        return;
      }
      if (meta && key === 'y') {
        event.preventDefault();
        actions.current.redo();
        return;
      }
      if (typing) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setAdding(false);
          setDraft('');
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        actions.current.deleteSelection();
        return;
      }
      if (meta && key === 'a') {
        event.preventDefault();
        actions.current.selectAll();
        return;
      }
      if (key === 'a') {
        event.preventDefault();
        setAdding(true);
        return;
      }
      if (key === 'f') {
        event.preventDefault();
        void actions.current.fitView({ padding: 0.2 });
        return;
      }
      if (event.key === 'Escape') {
        setAdding(false);
        setDraft('');
        actions.current.clearSelection();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const structural = changes.filter((change) => change.type !== 'remove');
    const next = applyNodeChanges(structural, nodesRef.current) as FlowNode[];
    nodesRef.current = next;
    setNodes(next);

    const dragging = structural.some((change) => change.type === 'position' && change.dragging);
    const ended = structural.some(
      (change) => change.type === 'position' && change.dragging === false,
    );
    if (dragging && !dragOrigin.current) {
      dragOrigin.current = cloneGraph(historyRef.current.present);
    }
    if (ended && dragOrigin.current) {
      const origin = dragOrigin.current;
      dragOrigin.current = null;
      const positions = new Map(next.map((node) => [node.id, node.position]));
      const moved = applyPositions(historyRef.current.present, positions);
      const updated = commitDrag(historyRef.current, origin, moved);
      historyRef.current = updated;
      setHistory(updated);
    }
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    const structural = changes.filter((change) => change.type !== 'remove');
    const next = applyEdgeChanges(structural, edgesRef.current);
    edgesRef.current = next;
    setEdges(next);
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return;
      const result = connectNodes(historyRef.current.present, connection.source, connection.target);
      accepted.current = result.ok;
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setNotice(null);
      commit(result.graph);
    },
    [commit],
  );

  const onConnectStart = useCallback(() => {
    setConnecting(true);
  }, []);

  const onConnectEnd = useCallback<OnConnectEnd>((_event, state) => {
    setConnecting(false);
    if (accepted.current) {
      accepted.current = false;
      return;
    }
    const source = state.fromNode?.id;
    const target = state.toNode?.id;
    if (!source || !target) return;
    const result = connectNodes(historyRef.current.present, source, target);
    if (!result.ok) setNotice(result.message);
  }, []);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    if (!connection.source || !connection.target) return false;
    return connectNodes(historyRef.current.present, connection.source, connection.target).ok;
  }, []);

  const viewEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        style: {
          stroke: edge.selected ? '#e8b15a' : '#8e8e8e',
          strokeWidth: edge.selected ? 2.25 : 1.75,
        },
      })),
    [edges],
  );

  const selectedStage = nodes.filter((node) => node.selected && node.type === 'stage');
  const selectedName =
    selectedStage.length === 1 && 'name' in selectedStage[0]!.data
      ? selectedStage[0]!.data.name
      : null;
  const canDelete = selectedStage.length > 0 || edges.some((edge) => edge.selected);

  return (
    <div
      ref={shellRef}
      className="flex h-[calc(100svh-7.5rem)] min-h-[28rem] flex-col overflow-hidden rounded-lg border border-black/40 bg-[#1b1b1b]"
      data-testid="workflow-mock-canvas"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={toolButton}
          onClick={() => onBack(historyRef.current.present)}
        >
          返回
        </Button>
        <span className="text-sm text-zinc-100" data-testid="workflow-mock-open-version">
          {label}
        </span>
        {selectedName ? <span className="text-sm text-zinc-400">{selectedName}</span> : null}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {adding ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitAdd();
              }}
            >
              <input
                autoFocus
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="名称"
                aria-label="名称"
                autoComplete="off"
                data-testid="workflow-mock-name"
                className="h-8 w-36 rounded-md border border-white/15 bg-transparent px-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-500"
              />
            </form>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolButton}
              data-testid="workflow-mock-add"
              onClick={() => setAdding(true)}
            >
              添加
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolButton}
            disabled={history.past.length === 0}
            data-testid="workflow-mock-undo"
            onClick={undo}
          >
            撤销
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={toolButton}
            disabled={history.future.length === 0}
            data-testid="workflow-mock-redo"
            onClick={redo}
          >
            重做
          </Button>
          {canDelete ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolButton}
              data-testid="workflow-mock-delete"
              onClick={deleteSelection}
            >
              删除
            </Button>
          ) : null}
        </div>
      </div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="relative min-h-0 flex-1">
            {notice ? (
              <p
                role="status"
                data-testid="workflow-mock-notice"
                className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded bg-black/80 px-2 py-1 text-xs text-zinc-100"
              >
                {notice}
              </p>
            ) : null}
            <ReactFlow
              className={connecting ? 'workflow-mock-flow is-connecting' : 'workflow-mock-flow'}
              onConnectStart={onConnectStart}
              nodes={nodes}
              edges={viewEdges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onConnectEnd={onConnectEnd}
              isValidConnection={isValidConnection}
              connectionMode={ConnectionMode.Strict}
              connectionRadius={32}
              connectionLineStyle={{ stroke: '#e8b15a', strokeWidth: 1.75 }}
              minZoom={0.35}
              nodeDragThreshold={1}
              maxZoom={1.75}
              panOnDrag
              selectionOnDrag={false}
              deleteKeyCode={null}
              proOptions={{ hideAttribution: true }}
              colorMode="dark"
              onNodeClick={(_, node) => {
                if (node.type === 'junction') return;
                const nextNodes = nodesRef.current.map((item) => ({
                  ...item,
                  selected: item.id === node.id,
                }));
                const nextEdges = edgesRef.current.map((item) => ({ ...item, selected: false }));
                nodesRef.current = nextNodes;
                edgesRef.current = nextEdges;
                setNodes(nextNodes);
                setEdges(nextEdges);
              }}
              onEdgeClick={(_, edge) => {
                const nextEdges = edgesRef.current.map((item) => ({
                  ...item,
                  selected: item.id === edge.id,
                }));
                const nextNodes = nodesRef.current.map((item) => ({ ...item, selected: false }));
                nodesRef.current = nextNodes;
                edgesRef.current = nextEdges;
                setNodes(nextNodes);
                setEdges(nextEdges);
              }}
              onPaneClick={clearSelection}
              onPaneContextMenu={(event) => {
                const target = event.target as HTMLElement;
                if (target.closest('.react-flow__node') || target.closest('.react-flow__edge'))
                  return;
                setMenu({
                  kind: 'pane',
                  at: screenToFlowPosition({ x: event.clientX, y: event.clientY }),
                });
              }}
              onNodeContextMenu={(event, node) => {
                if (node.type !== 'junction') {
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                setMenu({ kind: 'junction', id: node.id });
              }}
              onEdgeContextMenu={(_event, edge) => {
                setMenu({ kind: 'edge', id: edge.id });
              }}
              aria-label="节点画布"
            >
              <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#333333" />
            </ReactFlow>
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {menu?.kind === 'pane' ? (
            <ContextMenuItem
              onSelect={() => {
                commit(addJunction(historyRef.current.present, menu.at));
              }}
            >
              增加汇合点
            </ContextMenuItem>
          ) : null}
          {menu?.kind === 'junction' ? (
            <ContextMenuItem
              onSelect={() => {
                commit(removeJunction(historyRef.current.present, menu.id));
              }}
            >
              删除汇合点
            </ContextMenuItem>
          ) : null}
          {menu?.kind === 'edge' ? (
            <ContextMenuItem
              onSelect={() => {
                commit(removeElements(historyRef.current.present, [], [menu.id]));
              }}
            >
              删除连线
            </ContextMenuItem>
          ) : null}
        </ContextMenuContent>
      </ContextMenu>
    </div>
  );
}

export function WorkflowCanvas(props: {
  label: string;
  initial: FlowGraph;
  onBack: (graph: FlowGraph) => void;
}) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
