import {
  Background,
  BackgroundVariant,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  useReactFlow,
  type Edge,
  type Node,
  type NodeChange,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
} from '../../workflow-mock/flow-nodes';
import { layoutWithDagre, type FlowDirection } from '../../workflow-mock/layout';
import { JUNCTION_SIZE, STAGE_H, STAGE_W, type FlowGraph } from '../../workflow-mock/model';
import { nudgeOverlaps } from '../../workflow-mock/overlap';
import '../../workflow-mock/workflow-mock.css';
import type { LiveGraphEdge, LiveGraphNode } from '../workflow-live-graph';
import { toDemoStatus } from '../workflow-status-map';

const nodeTypes = { stage: StageNode, junction: JunctionNode };

const toolButton =
  'border-white/15 bg-transparent text-zinc-100 hover:bg-white/10 hover:text-zinc-100';

type FlowNode = Node<StageNodeData | JunctionNodeData>;

type Meta = { name: string; status: string; reason: string };

/**
 * Connection points sit on the card center after it is shifted into the layout slot.
 * Horizontal uses the left and right edges; vertical uses the top and bottom edges.
 */
function stageHandles(cardWidth: number, cardHeight: number, direction: FlowDirection) {
  if (direction === 'tb') {
    const x = STAGE_W / 2 - 0.5;
    const top = (STAGE_H - cardHeight) / 2 - 6;
    return [
      {
        id: 'in',
        type: 'target' as const,
        position: Position.Top,
        x,
        y: top,
        width: 1,
        height: 1,
      },
      {
        id: 'out',
        type: 'source' as const,
        position: Position.Bottom,
        x,
        y: (STAGE_H + cardHeight) / 2 + 5,
        width: 1,
        height: 1,
      },
    ];
  }
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

function withStageHandles<T extends FlowNode>(node: T, direction: FlowDirection): T {
  if (node.type !== 'stage') return node;
  const measuredWidth = node.measured?.width;
  const measuredHeight = node.measured?.height;
  const cardWidth = measuredWidth && measuredWidth > 0 ? measuredWidth : STAGE_W;
  const cardHeight = measuredHeight && measuredHeight > 0 ? measuredHeight : STAGE_H;
  return { ...node, handles: stageHandles(cardWidth, cardHeight, direction) };
}

function junctionHandles(direction: FlowDirection) {
  const port = 6;
  if (direction === 'tb') {
    const x = (JUNCTION_SIZE - port) / 2;
    return [
      {
        id: 'in',
        type: 'target' as const,
        position: Position.Top,
        x,
        y: -14,
        width: port,
        height: port,
      },
      {
        id: 'out',
        type: 'source' as const,
        position: Position.Bottom,
        x,
        y: JUNCTION_SIZE + 8,
        width: port,
        height: port,
      },
    ];
  }
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

function toFlowGraph(nodes: LiveGraphNode[], edges: LiveGraphEdge[]): FlowGraph {
  return {
    nodes: nodes.map((node) => ({
      id: node.id,
      name: node.name,
      kind: node.kind,
      x: 0,
      y: 0,
    })),
    edges: edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target })),
  };
}

function toFlowNodes(
  graph: FlowGraph,
  meta: Map<string, Meta>,
  direction: FlowDirection,
): FlowNode[] {
  return graph.nodes.map((node) => {
    if (node.kind === 'merge') {
      return {
        id: node.id,
        type: 'junction',
        position: { x: node.x, y: node.y },
        data: { kind: 'merge' as const },
        draggable: true,
        selectable: false,
        connectable: false,
        focusable: false,
        deletable: false,
        width: JUNCTION_SIZE,
        height: JUNCTION_SIZE,
        measured: { width: JUNCTION_SIZE, height: JUNCTION_SIZE },
        handles: junctionHandles(direction),
        style: { width: JUNCTION_SIZE, height: JUNCTION_SIZE, overflow: 'visible' },
      };
    }
    const info = meta.get(node.id);
    const status = info?.status;
    return {
      id: node.id,
      type: 'stage',
      position: { x: node.x, y: node.y },
      data: {
        name: info?.name ?? node.name,
        workflowNodeId: node.id,
        ...(status ? { workflowStatus: status } : {}),
      },
      deletable: false,
      initialWidth: STAGE_W,
      initialHeight: STAGE_H,
      handles: stageHandles(STAGE_W, STAGE_H, direction),
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
    deletable: false,
  }));
}

function structureKey(nodes: LiveGraphNode[], edges: LiveGraphEdge[]): string {
  const nodeKey = nodes
    .map((node) => `${node.id}:${node.kind}`)
    .sort()
    .join('|');
  const edgeKey = edges
    .map((edge) => `${edge.source}>${edge.target}`)
    .sort()
    .join('|');
  return `${nodeKey}#${edgeKey}`;
}

function metaKey(nodes: LiveGraphNode[]): string {
  return nodes
    .map((node) => `${node.id}:${node.name}:${node.status ?? ''}:${node.blockingReason ?? ''}`)
    .join('|');
}

function LiveCanvasInner({
  nodes: sourceNodes,
  edges: sourceEdges,
  label,
  readOnly = false,
  onRename,
}: {
  nodes: LiveGraphNode[];
  edges: LiveGraphEdge[];
  label: string;
  readOnly?: boolean;
  onRename?: (id: string, name: string) => string | null;
}) {
  const meta = useMemo(() => {
    const map = new Map<string, Meta>();
    for (const node of sourceNodes) {
      map.set(node.id, {
        name: node.name,
        status: node.status ?? 'not_reached',
        reason: node.blockingReason ?? '',
      });
    }
    return map;
  }, [sourceNodes]);

  const structure = structureKey(sourceNodes, sourceEdges);
  const metaSignature = metaKey(sourceNodes);
  const [direction, setDirection] = useState<FlowDirection>('lr');
  const directionRef = useRef<FlowDirection>('lr');
  const [flowNodes, setFlowNodes] = useState<FlowNode[]>(() =>
    toFlowNodes(layoutWithDagre(toFlowGraph(sourceNodes, sourceEdges), 'lr'), meta, 'lr'),
  );
  const [flowEdges, setFlowEdges] = useState<Edge[]>(() =>
    toFlowEdges(layoutWithDagre(toFlowGraph(sourceNodes, sourceEdges), 'lr')),
  );
  const [nudge, setNudge] = useState<Record<string, { x: number; y: number }>>({});
  const nudgeRef = useRef(nudge);
  nudgeRef.current = nudge;
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  const [openIds, setOpenIds] = useState<Record<string, boolean>>({});
  const nodesRef = useRef(flowNodes);
  const edgesRef = useRef(flowEdges);
  const dragOrigin = useRef(false);
  const structureRef = useRef(structure);
  const shellRef = useRef<HTMLDivElement>(null);
  const readOnlyRef = useRef(readOnly);
  const onRenameRef = useRef(onRename);
  const metaRef = useRef(meta);
  nodesRef.current = flowNodes;
  edgesRef.current = flowEdges;
  directionRef.current = direction;
  readOnlyRef.current = readOnly;
  onRenameRef.current = onRename;
  metaRef.current = meta;
  const { fitView } = useReactFlow();
  const booted = useRef(false);

  useEffect(() => {
    if (booted.current) return;
    const timer = window.setTimeout(() => {
      booted.current = true;
      void fitView({ padding: 0.2 });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [fitView]);

  const syncLayout = useCallback((graph: FlowGraph, nextDirection: FlowDirection) => {
    const selected = new Set(
      nodesRef.current.filter((node) => node.selected).map((node) => node.id),
    );
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]));
    const nextNodes = toFlowNodes(graph, metaRef.current, nextDirection).map((node) => {
      const measured = previous.get(node.id)?.measured;
      return withStageHandles(
        {
          ...node,
          selected: selected.has(node.id),
          ...(measured ? { measured } : {}),
        },
        nextDirection,
      );
    });
    const nextEdges = toFlowEdges(graph);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setFlowNodes(nextNodes);
    setFlowEdges(nextEdges);
  }, []);

  useEffect(() => {
    if (structureRef.current !== structure) {
      structureRef.current = structure;
      const laid = layoutWithDagre(toFlowGraph(sourceNodes, sourceEdges), directionRef.current);
      syncLayout(laid, directionRef.current);
      return;
    }
    setFlowNodes((current) => {
      let changed = false;
      const next = current.map((node) => {
        if (node.type !== 'stage') return node;
        const info = meta.get(node.id);
        if (!info) return node;
        const data = node.data as StageNodeData;
        if (data.name === info.name && data.workflowStatus === info.status) return node;
        changed = true;
        return withStageHandles(
          {
            ...node,
            data: {
              name: info.name,
              workflowNodeId: node.id,
              ...(info.status ? { workflowStatus: info.status } : {}),
            },
          },
          directionRef.current,
        );
      });
      if (!changed) return current;
      nodesRef.current = next;
      return next;
    });
  }, [structure, metaSignature, meta, sourceNodes, sourceEdges, syncLayout]);

  const applyDirection = useCallback(
    (next: FlowDirection) => {
      if (next === directionRef.current) return;
      const logical = toFlowGraph(sourceNodes, sourceEdges);
      const laid = layoutWithDagre(logical, next);
      directionRef.current = next;
      setDirection(next);
      setNudge({});
      syncLayout(laid, next);
      void fitView({ padding: 0.2 });
    },
    [fitView, sourceEdges, sourceNodes, syncLayout],
  );

  const tidy = useCallback(() => {
    const laid = layoutWithDagre(toFlowGraph(sourceNodes, sourceEdges), directionRef.current);
    setNudge({});
    syncLayout(laid, directionRef.current);
  }, [sourceEdges, sourceNodes, syncLayout]);

  const fit = useCallback(() => {
    void fitView({ padding: 0.2 });
  }, [fitView]);

  const startEdit = useCallback((id: string) => {
    if (readOnlyRef.current || !onRenameRef.current) return;
    if (editingRef.current === id) return;
    editingRef.current = id;
    setEditingId(id);
    setNotice(null);
  }, []);

  const commitEdit = useCallback((id: string, value: string) => {
    if (editingRef.current !== id) return;
    const rename = onRenameRef.current;
    if (!rename) {
      editingRef.current = null;
      setEditingId(null);
      return;
    }
    const message = rename(id, value);
    if (message) {
      setNotice(message);
      return;
    }
    editingRef.current = null;
    setEditingId(null);
    setNotice(null);
  }, []);

  const cancelEdit = useCallback((id: string) => {
    if (editingRef.current !== id) return;
    editingRef.current = null;
    setEditingId(null);
  }, []);

  const toggleDetail = useCallback((id: string) => {
    setOpenIds((current) => ({ ...current, [id]: !current[id] }));
  }, []);

  const nodeUi = useMemo(
    () => ({
      editingId,
      startEdit,
      commitEdit,
      cancelEdit,
      toggleDetail,
      detail: (id: string): MockDetail => {
        const info = meta.get(id);
        return {
          open: openIds[id] ?? false,
          status: toDemoStatus(info?.status ?? 'not_reached'),
          reason: info?.reason ?? '',
        };
      },
      setStatus: () => {
        // TODO(I-2): wire the four cells to start / complete / block.
      },
      setReason: () => {
        // TODO(I-2): block reasons stay read-only until status writes land.
      },
      direction,
      statusReadOnly: true,
    }),
    [editingId, startEdit, commitEdit, cancelEdit, toggleDetail, meta, openIds, direction],
  );

  useEffect(() => {
    if (dragOrigin.current) return;
    const open = new Set(
      Object.entries(openIds)
        .filter(([, on]) => on)
        .map(([id]) => id),
    );
    if (open.size === 0) {
      setNudge((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    const boxes = nodesRef.current.map((node) => {
      const junction = node.type === 'junction';
      const w = junction ? JUNCTION_SIZE : (node.measured?.width ?? STAGE_W);
      const h = junction ? JUNCTION_SIZE : (node.measured?.height ?? STAGE_H);
      return {
        id: node.id,
        x: junction ? node.position.x : node.position.x + (STAGE_W - w) / 2,
        y: junction ? node.position.y : node.position.y + (STAGE_H - h) / 2,
        w,
        h,
        anchor: open.has(node.id),
      };
    });
    const next = nudgeOverlaps(boxes, 14, direction === 'tb' ? 'y' : undefined);
    setNudge((prev) => {
      const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
      for (const key of keys) {
        const a = prev[key];
        const b = next[key];
        if (!a || !b || Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5) return next;
      }
      return prev;
    });
  }, [openIds, flowNodes, direction]);

  const displayNodes = useMemo(
    () =>
      flowNodes.map((node) => {
        const offset = nudge[node.id];
        if (!offset) return node;
        return {
          ...node,
          position: { x: node.position.x + offset.x, y: node.position.y + offset.y },
        };
      }),
    [flowNodes, nudge],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const structural = changes
      .filter((change) => change.type !== 'remove')
      .map((change) => {
        if (change.type !== 'position' || !change.position) return change;
        const offset = nudgeRef.current[change.id];
        if (!offset) return change;
        return {
          ...change,
          position: { x: change.position.x - offset.x, y: change.position.y - offset.y },
        };
      });
    const next = (applyNodeChanges(structural, nodesRef.current) as FlowNode[]).map((node) =>
      withStageHandles(node, directionRef.current),
    );
    nodesRef.current = next;
    setFlowNodes(next);
    const dragging = structural.some((change) => change.type === 'position' && change.dragging);
    const ended = structural.some(
      (change) => change.type === 'position' && change.dragging === false,
    );
    if (dragging) dragOrigin.current = true;
    if (ended) dragOrigin.current = false;
  }, []);

  const startEditSelected = useCallback(() => {
    if (editingRef.current) return;
    const selected = nodesRef.current.filter((node) => node.selected && node.type === 'stage');
    if (selected.length !== 1) return;
    startEdit(selected[0]!.id);
  }, [startEdit]);

  const onShellKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const meta = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (meta && (key === 'z' || key === 'y')) return;
      if (typing) return;
      if (target?.tagName === 'BUTTON') return;
      if (!meta && key === 'l') {
        event.preventDefault();
        tidy();
        return;
      }
      if (key === 'f' && !meta) {
        event.preventDefault();
        fit();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        startEditSelected();
        return;
      }
      if (event.key === 'Escape') {
        if (editingRef.current) cancelEdit(editingRef.current);
      }
      if (
        !meta &&
        (key === 'a' || key === 'j' || event.key === 'Delete' || event.key === 'Backspace')
      ) {
        event.preventDefault();
        setNotice('增删节点和连线留到后续');
      }
    },
    [tidy, fit, startEditSelected, cancelEdit],
  );

  const [menu, setMenu] = useState<{ kind: 'pane' } | { kind: 'stage'; id: string } | null>(null);

  const stageCount = sourceNodes.filter((node) => node.kind === 'stage').length;
  const mergeCount = sourceNodes.filter((node) => node.kind === 'merge').length;

  return (
    <NodeUiContext.Provider value={nodeUi}>
      <div
        ref={shellRef}
        tabIndex={0}
        onKeyDown={onShellKeyDown}
        className="flex h-[720px] min-h-[28rem] flex-col overflow-hidden rounded-lg border border-black/40 bg-[#1b1b1b] outline-none"
        data-testid="workflow-live-canvas"
        data-live-node-count={sourceNodes.length}
        data-live-stage-count={stageCount}
        data-live-merge-count={mergeCount}
        data-live-edge-count={sourceEdges.length}
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
          <span className="text-sm text-zinc-100" data-testid="workflow-live-label">
            {label}
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="方向"
              data-testid="workflow-live-direction"
              className="flex overflow-hidden rounded-md border border-white/15"
            >
              <button
                type="button"
                aria-pressed={direction === 'lr'}
                data-direction="lr"
                className={
                  direction === 'lr'
                    ? 'bg-white/15 px-2 py-1 text-xs text-zinc-100'
                    : 'px-2 py-1 text-xs text-zinc-400 hover:bg-white/10'
                }
                onClick={() => applyDirection('lr')}
              >
                横向
              </button>
              <button
                type="button"
                aria-pressed={direction === 'tb'}
                data-direction="tb"
                className={
                  direction === 'tb'
                    ? 'bg-white/15 px-2 py-1 text-xs text-zinc-100'
                    : 'px-2 py-1 text-xs text-zinc-400 hover:bg-white/10'
                }
                onClick={() => applyDirection('tb')}
              >
                纵向
              </button>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolButton}
              data-testid="workflow-live-tidy"
              onClick={tidy}
            >
              整理
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={toolButton}
              data-testid="workflow-live-fit"
              onClick={fit}
            >
              复位
            </Button>
          </div>
        </div>
        <p
          className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-white/10 px-3 py-1.5 text-[11px] text-zinc-400"
          data-testid="workflow-live-keys"
        >
          <Kbd className="border-white/20 bg-white/10 text-zinc-200">Enter</Kbd>
          改名
          <Kbd className="border-white/20 bg-white/10 text-zinc-200">L</Kbd>
          整理
          <Kbd className="border-white/20 bg-white/10 text-zinc-200">F</Kbd>
          复位
          <Kbd className="border-white/20 bg-white/10 text-zinc-200">Ctrl+Z</Kbd>
          撤销改名
        </p>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="relative min-h-0 flex-1">
              {notice ? (
                <p
                  role="status"
                  data-testid="workflow-live-notice"
                  className="pointer-events-none absolute top-3 left-1/2 z-10 -translate-x-1/2 rounded bg-black/80 px-2 py-1 text-xs text-zinc-100"
                >
                  {notice}
                </p>
              ) : null}
              <ReactFlow
                className={['workflow-mock-flow', direction === 'tb' ? 'is-vertical' : '']
                  .filter(Boolean)
                  .join(' ')}
                nodes={displayNodes}
                edges={flowEdges}
                nodeTypes={nodeTypes}
                onNodesChange={onNodesChange}
                nodesConnectable={false}
                edgesReconnectable={false}
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
                  nodesRef.current = nextNodes;
                  setFlowNodes(nextNodes);
                  shellRef.current?.focus();
                }}
                onPaneClick={() => {
                  const nextNodes = nodesRef.current.map((item) => ({ ...item, selected: false }));
                  nodesRef.current = nextNodes;
                  setFlowNodes(nextNodes);
                }}
                onPaneContextMenu={(event) => {
                  const target = event.target as HTMLElement;
                  if (target.closest('.react-flow__node') || target.closest('.react-flow__edge')) {
                    return;
                  }
                  setMenu({ kind: 'pane' });
                }}
                onNodeContextMenu={(_event, node) => {
                  if (node.type !== 'stage') return;
                  setMenu({ kind: 'stage', id: node.id });
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
              <ContextMenuItem onSelect={tidy}>
                整理
                <Kbd className="ml-auto">L</Kbd>
              </ContextMenuItem>
            ) : null}
            {menu?.kind === 'stage' && !readOnly ? (
              <ContextMenuItem onSelect={() => startEdit(menu.id)}>
                修改节点名称
                <Kbd className="ml-auto">Enter</Kbd>
              </ContextMenuItem>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      </div>
    </NodeUiContext.Provider>
  );
}

export function WorkflowLiveCanvas(props: {
  nodes: LiveGraphNode[];
  edges: LiveGraphEdge[];
  label: string;
  readOnly?: boolean;
  /** Returns an error message, or null when the name was accepted. */
  onRename?: (id: string, name: string) => string | null;
}) {
  return (
    <ReactFlowProvider>
      <LiveCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
