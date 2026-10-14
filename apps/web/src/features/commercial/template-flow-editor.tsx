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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { autoLayoutPositions } from '@/features/commercial/graph-auto-layout';

export type TemplateGraphNode = {
  id: string;
  name: string;
  slug: string;
  phase: string;
  is_optional: boolean;
  pos_x: number;
  pos_y: number;
  package_id: string | null;
};

export type TemplateGraph = {
  versionId: string;
  nodes: TemplateGraphNode[];
  edges: Array<{ id: string; fromNodeId: string; toNodeId: string }>;
  packages?: Array<{ id: string; name: string; sortOrder: number }>;
  canUndo?: boolean;
  canRedo?: boolean;
};

type Props = {
  graph: TemplateGraph;
  onMoveNode: (nodeId: string, posX: number, posY: number) => Promise<void>;
  onConnect: (from: string, to: string) => Promise<void>;
  onDeleteEdge: (edgeId: string) => Promise<void>;
  onSaveNode: (node: TemplateGraphNode) => Promise<void>;
  onDeleteNode: (nodeId: string) => Promise<void>;
  onCreateNode?: (node: TemplateGraphNode) => Promise<void>;
  onAutoLayout: (positions: Map<string, { posX: number; posY: number }>) => Promise<void>;
  onCreatePackage?: (name: string) => Promise<void>;
  pending: boolean;
  error: string | null;
};

function flowNode(n: TemplateGraphNode, selected: boolean): Node {
  return {
    id: n.id,
    position: { x: n.pos_x + 240, y: n.pos_y },
    data: { label: `${n.name}\n${n.slug}` },
    style: {
      borderRadius: 8,
      padding: 8,
      border: '2px solid hsl(var(--border))',
      background: 'hsl(var(--muted))',
      minWidth: 140,
      whiteSpace: 'pre-wrap',
    },
    draggable: true,
    selected,
  };
}

export function TemplateFlowEditor(props: Props) {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const graphRef = useRef(props.graph);
  graphRef.current = props.graph;

  const selected = useMemo(
    () => props.graph.nodes.find((n) => n.id === selectedId) ?? null,
    [props.graph.nodes, selectedId],
  );

  const [draft, setDraft] = useState<TemplateGraphNode | null>(null);
  const [newNodeOpen, setNewNodeOpen] = useState(false);
  const [newPackageName, setNewPackageName] = useState('');
  const [newNode, setNewNode] = useState<TemplateGraphNode>({
    id: '',
    name: '',
    slug: '',
    phase: 'pre_publish',
    is_optional: false,
    pos_x: 120,
    pos_y: 120,
    package_id: null,
  });

  useEffect(() => {
    setDraft(selected ? { ...selected } : null);
  }, [selected]);

  useEffect(() => {
    setNodes(props.graph.nodes.map((n) => flowNode(n, n.id === selectedId)));
    setEdges(
      props.graph.edges.map((e) => ({
        id: e.id,
        source: e.fromNodeId,
        target: e.toNodeId,
        animated: true,
      })),
    );
  }, [props.graph, selectedId]);

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
      void props.onConnect(conn.source, conn.target).catch(() => undefined);
    },
    [props],
  );

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      void props.onMoveNode(node.id, node.position.x - 240, node.position.y).catch(() => undefined);
    },
    [props],
  );

  const runAutoLayout = () => {
    const positions = autoLayoutPositions(
      props.graph.nodes.map((n) => ({ id: n.id, posX: n.pos_x, posY: n.pos_y })),
      props.graph.edges.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId })),
    );
    void props.onAutoLayout(positions).catch(() => undefined);
  };

  const emptyGraph = props.graph.nodes.length === 0;

  return (
    <div className="w-full max-w-full space-y-3 overflow-hidden">
      {props.error ? <p className="text-destructive text-sm">{props.error}</p> : null}
      {emptyGraph ? (
        <p className="text-muted-foreground text-sm">空图草稿：请先添加第一个模板节点。</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.pending}
          onClick={runAutoLayout}
        >
          自动布局
        </Button>
        {props.onCreateNode ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.pending}
            onClick={() => setNewNodeOpen((v) => !v)}
          >
            {newNodeOpen ? '收起新建' : '新建模板节点'}
          </Button>
        ) : null}
      </div>
      {newNodeOpen && props.onCreateNode ? (
        <div className="grid gap-2 rounded border p-3 text-sm md:grid-cols-2">
          <Input
            aria-label="节点名称"
            placeholder="名称"
            value={newNode.name}
            onChange={(e) => setNewNode({ ...newNode, name: e.target.value })}
          />
          <Input
            aria-label="slug"
            placeholder="slug（唯一）"
            value={newNode.slug}
            onChange={(e) => setNewNode({ ...newNode, slug: e.target.value })}
          />
          <label className="flex flex-col gap-1">
            阶段
            <select
              className="rounded border px-2 py-1"
              value={newNode.phase}
              onChange={(e) => setNewNode({ ...newNode, phase: e.target.value })}
            >
              <option value="pre_publish">发布前</option>
              <option value="post_publish_required">发布后必需</option>
              <option value="post_publish_optional">发布后可选</option>
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={newNode.is_optional}
              onChange={(e) => setNewNode({ ...newNode, is_optional: e.target.checked })}
            />
            可选 / 允许 NA
          </label>
          <Button
            type="button"
            size="sm"
            disabled={props.pending || !newNode.name.trim() || !newNode.slug.trim()}
            onClick={() => {
              void props.onCreateNode!({
                ...newNode,
                name: newNode.name.trim(),
                slug: newNode.slug.trim(),
              })
                .then(() => {
                  setNewNodeOpen(false);
                  setNewNode({
                    id: '',
                    name: '',
                    slug: '',
                    phase: 'pre_publish',
                    is_optional: false,
                    pos_x: 120,
                    pos_y: 120,
                    package_id: null,
                  });
                })
                .catch(() => undefined);
            }}
          >
            创建节点
          </Button>
        </div>
      ) : null}
      {props.onCreatePackage ? (
        <div className="flex flex-wrap items-end gap-2 rounded border p-2 text-sm">
          <Input
            aria-label="新建制作包名称"
            placeholder="新建制作包"
            value={newPackageName}
            onChange={(e) => setNewPackageName(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            disabled={props.pending || !newPackageName.trim()}
            onClick={() => {
              void props.onCreatePackage!(newPackageName.trim())
                .then(() => setNewPackageName(''))
                .catch(() => undefined);
            }}
          >
            添加制作包
          </Button>
        </div>
      ) : null}
      <div className="grid w-full max-w-full gap-4 overflow-hidden lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="h-[480px] min-w-0 max-w-full overflow-hidden rounded border">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onEdgesChange={onEdgesChange}
            onConnect={onConnectCb}
            onNodeDragStop={onNodeDragStop}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            fitView
          >
            <Background />
            <MiniMap />
            <Controls />
          </ReactFlow>
        </div>
        <div className="space-y-2 rounded border p-3 text-sm">
          <p className="font-medium">节点属性</p>
          {draft ? (
            <>
              <Input
                aria-label="名称"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
              <Input
                aria-label="slug"
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              />
              <label className="flex flex-col gap-1">
                阶段
                <select
                  className="rounded border px-2 py-1"
                  value={draft.phase}
                  onChange={(e) => setDraft({ ...draft, phase: e.target.value })}
                >
                  <option value="pre_publish">发布前</option>
                  <option value="post_publish_required">发布后必需</option>
                  <option value="post_publish_optional">发布后可选</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={draft.is_optional}
                  onChange={(e) => setDraft({ ...draft, is_optional: e.target.checked })}
                />
                可选 / 允许 NA
              </label>
              <label className="flex flex-col gap-1">
                制作包
                <select
                  className="rounded border px-2 py-1"
                  value={draft.package_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, package_id: e.target.value || null })}
                >
                  <option value="">无</option>
                  {(props.graph.packages ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex flex-wrap gap-2 pt-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={props.pending}
                  onClick={() => void props.onSaveNode(draft)}
                >
                  保存节点
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={props.pending}
                  onClick={() => {
                    const ok = window.confirm(
                      `确定删除模板节点「${draft.name}」？此操作不可从界面恢复，需撤销草稿才能找回。`,
                    );
                    if (!ok) return;
                    void props.onDeleteNode(draft.id);
                  }}
                >
                  删除节点
                </Button>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground">点击图中节点进行编辑。</p>
          )}
        </div>
      </div>
    </div>
  );
}
