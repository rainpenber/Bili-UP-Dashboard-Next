import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useCallback, useEffect } from 'react';
import type { WorkflowGraph } from '@studio/contracts';
import { nodeStatusLabel } from '@/lib/commercial-labels';
import { Button } from '@/components/ui/button';

type Props = {
  graph: WorkflowGraph;
  onMoveNode: (nodeId: string, posX: number, posY: number) => void;
  onConnect: (from: string, to: string) => void;
  onAdvanceTo: (nodeId: string) => void;
  onComplete: (nodeId: string) => void;
  onRollback: (nodeId: string) => void;
  pending: boolean;
};

export function WorkflowFlowEditor({
  graph,
  onMoveNode,
  onConnect,
  onAdvanceTo,
  onComplete,
  onRollback,
  pending,
}: Props) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  useEffect(() => {
    setNodes(
      graph.nodes.map((n) => ({
        id: n.id,
        position: { x: n.posX + 240, y: n.posY },
        data: { label: `${n.name}\n${nodeStatusLabel(n.status)}` },
        style: {
          borderRadius: 8,
          padding: 8,
          border: '1px solid hsl(var(--border))',
          background: 'hsl(var(--card))',
          minWidth: 140,
          whiteSpace: 'pre-wrap',
        },
        draggable: true,
        tabIndex: 0,
      })),
    );
    setEdges(
      graph.edges.map((e) => ({
        id: e.id,
        source: e.fromNodeId,
        target: e.toNodeId,
        animated: true,
      })),
    );
  }, [graph, setEdges, setNodes]);

  const onConnectCb = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return;
      onConnect(conn.source, conn.target);
      setEdges((eds) => addEdge(conn, eds));
    },
    [onConnect, setEdges],
  );

  const selected = nodes.find((n) => n.selected);

  return (
    <div className="h-[520px] w-full max-w-full overflow-hidden rounded-md border">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnectCb}
        onNodeDragStop={(_, node) => onMoveNode(node.id, node.position.x - 240, node.position.y)}
        fitView
        minZoom={0.4}
        maxZoom={1.4}
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
      {selected ? (
        <div className="flex flex-wrap gap-2 border-t p-2">
          <Button size="sm" disabled={pending} onClick={() => onAdvanceTo(selected.id)}>
            {pending ? '处理中…' : '前进到此节点'}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={pending}
            onClick={() => onComplete(selected.id)}
          >
            完成节点
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => onRollback(selected.id)}
          >
            回退
          </Button>
        </div>
      ) : null}
    </div>
  );
}
