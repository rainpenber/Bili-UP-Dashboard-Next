import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  MiniMap,
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
import { Kbd } from '@/components/ui/kbd';
import {
  JunctionNode,
  NodeUiContext,
  StageNode,
  type JunctionNodeData,
  type MockDetail,
  type StageNodeData,
} from './flow-nodes';
import { layoutWithDagre } from './layout';
import {
  JUNCTION_SIZE,
  STAGE_H,
  STAGE_W,
  addJunction,
  applyPositions,
  cloneGraph,
  commitDrag,
  commitHistory,
  connectNodes,
  redoHistory,
  removeElements,
  removeJunction,
  renameStageNode,
  createStageNode,
  undoHistory,
  type FlowGraph,
  type HistoryState,
} from './model';
import './workflow-mock.css';

const nodeTypes = { stage: StageNode, junction: JunctionNode };

const toolButton =
  'border-white/15 bg-transparent text-zinc-100 hover:bg-white/10 hover:text-zinc-100';

type FlowNode = Node<StageNodeData | JunctionNodeData>;

/**
 * Connection points sit on the card's vertical center after it is shifted onto the
 * 40px layout line, and on the 14px dots (6px outside each side of the card).
 */
function stageHandles(cardWidth: number) {
  const left = (STAGE_W - cardWidth) / 2;
  const y = STAGE_H / 2 - 0.5;
  return [
    {
      id: 'in',
      type: 'target' as const,
      position: Position.Left,
      x: left - 6,
      y,
      width: 1,
      height: 1,
    },
    {
      id: 'out',
      type: 'source' as const,
      position: Position.Right,
      x: left + cardWidth + 5,
      y,
      width: 1,
      height: 1,
    },
  ];
}

function withStageHandles<T extends FlowNode>(node: T): T {
  if (node.type !== 'stage') return node;
  const measured = node.measured?.width;
  const cardWidth = measured && measured > 0 ? measured : STAGE_W;
  return { ...node, handles: stageHandles(cardWidth) };
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
      initialWidth: STAGE_W,
      initialHeight: STAGE_H,
      handles: stageHandles(STAGE_W),
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
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRef = useRef<{ id: string; isNew: boolean } | null>(null);
  const [details, setDetails] = useState<Record<string, MockDetail>>({});
  const historyRef = useRef(history);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const dragOrigin = useRef<FlowGraph | null>(null);
  const accepted = useRef(false);
  const [connecting, setConnecting] = useState(false);
  const [menu, setMenu] = useState<
    | { kind: 'pane'; at: { x: number; y: number } }
    | { kind: 'stage'; id: string }
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
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    const nextNodes = toFlowNodes(graph).map((node) => {
      const measured = previous.get(node.id)?.measured;
      return withStageHandles({
        ...node,
        selected: selectedNodes.has(node.id),
        ...(measured ? { measured } : {}),
      });
    });
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

  const beginAdd = useCallback(
    (at?: { x: number; y: number }) => {
      const point = at ?? viewCenter() ?? { x: 240, y: 160 };
      const created = createStageNode(historyRef.current.present, point);
      editingRef.current = { id: created.id, isNew: true };
      setEditingId(created.id);
      setNotice(null);
      commit(created.graph);
    },
    [commit, viewCenter],
  );

  const startEdit = useCallback((id: string) => {
    if (editingRef.current?.id === id) return;
    editingRef.current = { id, isNew: false };
    setEditingId(id);
  }, []);

  const startEditSelected = useCallback(() => {
    if (editingRef.current) return;
    const selected = nodesRef.current.filter((node) => node.selected && node.type === 'stage');
    if (selected.length !== 1) return;
    startEdit(selected[0]!.id);
  }, [startEdit]);

  const commitEdit = useCallback(
    (id: string, value: string) => {
      const session = editingRef.current;
      if (!session || session.id !== id) return;
      const result = renameStageNode(historyRef.current.present, id, value);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      editingRef.current = null;
      setEditingId(null);
      setNotice(null);
      if (result.graph !== historyRef.current.present) commit(result.graph);
    },
    [commit],
  );

  const cancelEdit = useCallback(
    (id: string) => {
      const session = editingRef.current;
      if (!session || session.id !== id) return;
      editingRef.current = null;
      setEditingId(null);
      if (session.isNew) commit(removeElements(historyRef.current.present, [id], []));
    },
    [commit],
  );

  const toggleDetail = useCallback((id: string) => {
    setDetails((current) => {
      const prev = current[id] ?? { open: false, status: '未到', reason: '' };
      return { ...current, [id]: { ...prev, open: !prev.open } };
    });
  }, []);

  const setReason = useCallback((id: string, reason: string) => {
    setDetails((current) => {
      const prev = current[id] ?? { open: true, status: '未到', reason: '' };
      return { ...current, [id]: { ...prev, reason } };
    });
  }, []);

  const mockAction = useCallback((id: string, action: 'forward' | 'block' | 'done') => {
    setDetails((current) => {
      const prev = current[id] ?? { open: true, status: '未到', reason: '' };
      if (action === 'forward') return { ...current, [id]: { ...prev, status: '进行' } };
      if (action === 'block')
        return { ...current, [id]: { ...prev, status: '卡住', reason: prev.reason || '演示' } };
      return { ...current, [id]: { ...prev, status: '完成', reason: '' } };
    });
  }, []);

  const nodeUi = useMemo(
    () => ({
      editingId,
      startEdit,
      commitEdit,
      cancelEdit,
      toggleDetail,
      detail: (id: string) => details[id] ?? { open: false, status: '未到', reason: '' },
      mockAction,
      setReason,
    }),
    [editingId, startEdit, commitEdit, cancelEdit, toggleDetail, details, mockAction, setReason],
  );

  const addJunctionHere = useCallback(() => {
    const at = viewCenter() ?? { x: 240, y: 160 };
    commit(addJunction(historyRef.current.present, at));
  }, [commit, viewCenter]);

  const tidy = useCallback(() => {
    commit(layoutWithDagre(historyRef.current.present));
  }, [commit]);

  const fit = useCallback(() => {
    void fitView({ padding: 0.2 });
  }, [fitView]);

  const actions = useRef({
    undo,
    redo,
    deleteSelection,
    selectAll,
    fit,
    clearSelection,
    tidy,
    addJunctionHere,
    beginAdd,
    cancelEdit,
    startEditSelected,
  });
  actions.current = {
    undo,
    redo,
    deleteSelection,
    selectAll,
    fit,
    clearSelection,
    tidy,
    addJunctionHere,
    beginAdd,
    cancelEdit,
    startEditSelected,
  };

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
        if (event.key === 'Escape' && editingRef.current) {
          event.preventDefault();
          actions.current.cancelEdit(editingRef.current.id);
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
      if (!meta && key === 'a') {
        event.preventDefault();
        actions.current.beginAdd();
        return;
      }
      if (!meta && key === 'l') {
        event.preventDefault();
        actions.current.tidy();
        return;
      }
      if (!meta && key === 'j') {
        event.preventDefault();
        actions.current.addJunctionHere();
        return;
      }
      if (key === 'f') {
        event.preventDefault();
        actions.current.fit();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        actions.current.startEditSelected();
        return;
      }
      if (event.key === 'Escape') {
        if (editingRef.current) actions.current.cancelEdit(editingRef.current.id);
        else actions.current.clearSelection();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const structural = changes.filter((change) => change.type !== 'remove');
    const next = (applyNodeChanges(structural, nodesRef.current) as FlowNode[]).map(
      withStageHandles,
    );
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

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  return (
    <NodeUiContext.Provider value={nodeUi}>
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
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolButton}
              data-testid="workflow-mock-tidy"
              onClick={tidy}
            >
              整理
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolButton}
              data-testid="workflow-mock-fit"
              onClick={fit}
            >
              复位
            </Button>
          </div>
        </div>
        <p
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/10 px-3 py-1.5 text-[11px] text-zinc-400"
          data-testid="workflow-mock-keys"
        >
          <Kbd className="border-white/20 bg-white/10 text-zinc-200">A</Kbd>
          添加
          <Kbd className="border-white/20 bg-white/10 text-zinc-200">L</Kbd>
          整理
          <Kbd className="border-white/20 bg-white/10 text-zinc-200">J</Kbd>
          汇合点
          <Kbd className="border-white/20 bg-white/10 text-zinc-200">F</Kbd>
          复位全图
          <Kbd className="border-white/20 bg-white/10 text-zinc-200">Delete</Kbd>
          删除
          <Kbd className="border-white/20 bg-white/10 text-zinc-200">Ctrl+Z</Kbd>
          撤销
        </p>
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
                onNodeContextMenu={(_event, node) => {
                  if (node.type === 'junction') {
                    setMenu({ kind: 'junction', id: node.id });
                    return;
                  }
                  setMenu({ kind: 'stage', id: node.id });
                }}
                onEdgeContextMenu={(_event, edge) => {
                  setMenu({ kind: 'edge', id: edge.id });
                }}
                aria-label="节点画布"
              >
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#333333" />
                <MiniMap
                  position="bottom-right"
                  pannable
                  zoomable
                  bgColor="#141414"
                  maskColor="rgba(0,0,0,0.55)"
                  nodeStrokeColor="#8e8e8e"
                  nodeColor={(node) => (node.type === 'junction' ? '#e8b15a' : '#3a3a3a')}
                  style={{ background: '#141414' }}
                />
              </ReactFlow>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
            }}
          >
            {menu?.kind === 'pane' ? (
              <>
                <ContextMenuItem onSelect={() => beginAdd(menu.at)}>
                  增加节点
                  <Kbd className="ml-auto">A</Kbd>
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => commit(addJunction(historyRef.current.present, menu.at))}
                >
                  增加汇合点
                  <Kbd className="ml-auto">J</Kbd>
                </ContextMenuItem>
                <ContextMenuItem onSelect={tidy}>
                  整理
                  <Kbd className="ml-auto">L</Kbd>
                </ContextMenuItem>
                <ContextMenuItem disabled={!canUndo} onSelect={undo}>
                  撤销
                  <Kbd className="ml-auto">Ctrl+Z</Kbd>
                </ContextMenuItem>
                <ContextMenuItem disabled={!canRedo} onSelect={redo}>
                  重做
                  <Kbd className="ml-auto">Ctrl+Shift+Z</Kbd>
                </ContextMenuItem>
              </>
            ) : null}
            {menu?.kind === 'stage' ? (
              <>
                <ContextMenuItem onSelect={() => startEdit(menu.id)}>
                  修改节点名称
                  <Kbd className="ml-auto">Enter</Kbd>
                </ContextMenuItem>
                <ContextMenuItem
                  onSelect={() => commit(removeElements(historyRef.current.present, [menu.id], []))}
                >
                  删除节点
                  <Kbd className="ml-auto">Delete</Kbd>
                </ContextMenuItem>
              </>
            ) : null}
            {menu?.kind === 'junction' ? (
              <ContextMenuItem
                onSelect={() => commit(removeJunction(historyRef.current.present, menu.id))}
              >
                删除汇合点
              </ContextMenuItem>
            ) : null}
            {menu?.kind === 'edge' ? (
              <ContextMenuItem
                onSelect={() => commit(removeElements(historyRef.current.present, [], [menu.id]))}
              >
                删除连线
                <Kbd className="ml-auto">Delete</Kbd>
              </ContextMenuItem>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </NodeUiContext.Provider>
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
