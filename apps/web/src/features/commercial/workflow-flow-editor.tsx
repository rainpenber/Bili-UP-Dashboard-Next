import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { WorkflowGraph } from '@studio/contracts';

type GraphNode = WorkflowGraph['nodes'][number];
import { nodeStatusLabel } from '@/lib/commercial-labels';
import { Button } from '@/components/ui/button';

const statusStyles: Record<string, { border: string; background: string }> = {
  completed: { border: '#16a34a', background: 'rgba(22,163,74,0.15)' },
  in_progress: { border: '#ea580c', background: 'rgba(234,88,12,0.15)' },
  blocked: { border: '#dc2626', background: 'rgba(220,38,38,0.18)' },
  not_reached: { border: 'hsl(var(--border))', background: 'hsl(var(--muted))' },
  not_applicable: { border: 'hsl(var(--border))', background: 'hsl(var(--muted) / 0.5)' },
};

function flowNodeFromGraph(n: GraphNode, selected: boolean): Node {
  const style = statusStyles[n.status] ?? statusStyles.not_reached!;
  return {
    id: n.id,
    position: { x: n.posX + 240, y: n.posY },
    data: { label: `${n.name}\n${nodeStatusLabel(n.status)}` },
    style: {
      borderRadius: 8,
      padding: 8,
      border: `2px solid ${style.border}`,
      background: style.background,
      minWidth: 140,
      whiteSpace: 'pre-wrap',
    },
    draggable: true,
    focusable: true,
    selected,
  };
}

type Props = {
  graph: WorkflowGraph;
  focusNodeId?: string;
  onMoveNode: (nodeId: string, posX: number, posY: number) => Promise<void>;
  onConnect: (from: string, to: string) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onAdvanceTo: (nodeId: string) => void;
  onComplete: (nodeId: string) => void;
  onRollback: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onAddSerialNode?: (afterNodeId: string) => void;
  onAddParallelNode?: (siblingNodeId: string) => void;
  pending: boolean;
  connectError: string | null;
};

export function WorkflowFlowEditor(props: Props) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const graphRef = useRef(props.graph);
  graphRef.current = props.graph;
  const reactFlowRef = useRef<{ fitView: (opts?: { nodes?: { id: string }[] }) => void } | null>(
    null,
  );

  useEffect(() => {
    setNodes(props.graph.nodes.map((n) => flowNodeFromGraph(n, props.focusNodeId === n.id)));
    setEdges(
      props.graph.edges.map((e) => ({
        id: e.id,
        source: e.fromNodeId,
        target: e.toNodeId,
        animated: true,
      })),
    );
  }, [props.graph, props.focusNodeId]);

  useEffect(() => {
    if (!props.focusNodeId) return;
    const t = window.setTimeout(() => {
      reactFlowRef.current?.fitView({ nodes: [{ id: props.focusNodeId! }] });
      setNodes((nds) =>
        nds.map((n) => ({ ...n, selected: n.id === props.focusNodeId })),
      );
    }, 120);
    return () => window.clearTimeout(t);
  }, [props.focusNodeId]);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      setEdges((eds) => applyEdgeChanges(changes, eds));
      for (const ch of changes) {
        if (ch.type === 'remove') {
          void props.onDeleteEdge(ch.id).catch(() => {
            setEdges(
              graphRef.current.edges.map((e) => ({
                id: e.id,
                source: e.fromNodeId,
                target: e.toNodeId,
                animated: true,
              })),
            );
          });
        }
      }
    },
    [props],
  );

  const onConnectCb = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      const tempId = `temp-${conn.source}-${conn.target}`;
      setEdges((eds) => [
        ...eds,
        { id: tempId, source: conn.source!, target: conn.target!, animated: true },
      ]);
      void props.onConnect(conn.source, conn.target).catch(() => {
        setEdges(
          graphRef.current.edges.map((e) => ({
            id: e.id,
            source: e.fromNodeId,
            target: e.toNodeId,
            animated: true,
          })),
        );
      });
    },
    [props],
  );

  const selected = useMemo(() => nodes.find((n) => n.selected), [nodes]);

  return (
    <div className="h-[520px] w-full max-w-full overflow-hidden rounded-md border">
      {props.connectError ? (
        <p className="text-destructive px-2 py-1 text-sm">{props.connectError}</p>
      ) : null}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onInit={(inst) => {
          reactFlowRef.current = inst;
        }}
        onNodesChange={(changes) => {
          setNodes((nds) => {
            const next = [...nds];
            for (const ch of changes) {
              if (ch.type === 'position' && ch.id && ch.position) {
                const idx = next.findIndex((n) => n.id === ch.id);
                if (idx >= 0) next[idx] = { ...next[idx]!, position: ch.position };
              }
              if (ch.type === 'select' && ch.id) {
                const idx = next.findIndex((n) => n.id === ch.id);
                if (idx >= 0) next[idx] = { ...next[idx]!, selected: ch.selected };
              }
            }
            return next;
          });
        }}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectCb}
        onNodeDragStop={(_, node) => {
          void props.onMoveNode(node.id, node.position.x - 240, node.position.y).catch(() => {
            setNodes(
              graphRef.current.nodes.map((n) => flowNodeFromGraph(n, n.id === props.focusNodeId)),
            );
          });
        }}
        fitView
        minZoom={0.35}
        maxZoom={1.4}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      {selected ? (
        <div className="flex flex-wrap gap-2 border-t p-2">
          <Button size="sm" disabled={props.pending} onClick={() => props.onAdvanceTo(selected.id)}>
            {props.pending ? '处理中…' : '前进到此节点'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={props.pending}
            onClick={() => props.onComplete(selected.id)}
          >
            完成节点
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={props.pending}
            onClick={() => props.onRollback(selected.id)}
          >
            回退
          </Button>
          {props.onAddSerialNode ? (
            <Button
              size="sm"
              variant="outline"
              disabled={props.pending}
              onClick={() => props.onAddSerialNode!(selected.id)}
            >
              添加串行节点
            </Button>
          ) : null}
          {props.onAddParallelNode ? (
            <Button
              size="sm"
              variant="outline"
              disabled={props.pending}
              onClick={() => props.onAddParallelNode!(selected.id)}
            >
              添加并行节点
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="destructive"
            disabled={props.pending}
            onClick={() => props.onDeleteNode(selected.id)}
          >
            删除节点
          </Button>
        </div>
      ) : null}
    </div>
  );
}
