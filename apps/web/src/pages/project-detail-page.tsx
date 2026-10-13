import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import {
  advanceToNode,
  completeNode,
  connectNodes,
  createGraphNode,
  createOpenItem,
  deleteGraphEdge,
  deleteGraphNode,
  fetchProject,
  publishProject,
  rollbackNode,
  redoWorkflow,
  undoWorkflow,
  applyBatchGraphLayout,
  updateNodeLayout,
} from '@/api/commercial-client';
import { autoLayoutPositions } from '@/features/commercial/graph-auto-layout';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { OpenItemCard } from '@/features/commercial/open-item-card';
import { WorkflowFlowEditor } from '@/features/commercial/workflow-flow-editor';
import { overallStageLabel, nodeStatusLabel } from '@/lib/commercial-labels';
import { formatFullLocalTime } from '@/lib/format-time';

export function ProjectDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const qc = useQueryClient();
  const [publishOpen, setPublishOpen] = useState(false);
  const [bvid, setBvid] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [newItemTitle, setNewItemTitle] = useState('');
  const [newItemNextAction, setNewItemNextAction] = useState('');
  const [newItemActor, setNewItemActor] = useState<'us' | 'client'>('us');
  const [newItemImpact, setNewItemImpact] = useState<'normal' | 'blocking'>('normal');
  const [newItemBlocksNode, setNewItemBlocksNode] = useState('');
  const [layoutPending, setLayoutPending] = useState(false);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [newNodeName, setNewNodeName] = useState('');
  const [newNodePrompt, setNewNodePrompt] = useState<'serial' | 'parallel' | null>(null);
  const [newNodeAnchorId, setNewNodeAnchorId] = useState<string | null>(null);

  const focusNodeId = useMemo(() => {
    const hash = location.hash.replace('#', '');
    if (hash.startsWith('node-')) return hash.slice('node-'.length);
    return undefined;
  }, [location.hash]);

  const focusItemId = useMemo(() => {
    const hash = location.hash.replace('#', '');
    if (hash.startsWith('item-')) return hash.slice('item-'.length);
    return undefined;
  }, [location.hash]);

  const project = useQuery({
    queryKey: ['commercial', 'project', id],
    queryFn: () => fetchProject(id!),
    enabled: Boolean(id),
  });

  useEffect(() => {
    if (!focusItemId || !project.data) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`item-${focusItemId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
    }, 200);
    return () => window.clearTimeout(t);
  }, [focusItemId, project.data]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['commercial'] });

  const graphMut = useMutation({
    mutationFn: async (action: {
      type: string;
      nodeId: string;
      pos?: { x: number; y: number };
      create?: { name: string; posX: number; posY: number };
    }) => {
      if (!id) throw new Error('missing id');
      if (action.type === 'advance') return advanceToNode(id, action.nodeId);
      if (action.type === 'complete') return completeNode(id, action.nodeId);
      if (action.type === 'rollback') return rollbackNode(id, action.nodeId);
      if (action.type === 'move' && action.pos) {
        return updateNodeLayout(id, action.nodeId, action.pos.x, action.pos.y);
      }
      if (action.type === 'delete') return deleteGraphNode(id, action.nodeId);
      if (action.type === 'create' && action.create) {
        return createGraphNode(id, action.create);
      }
      throw new Error('unknown');
    },
    onSuccess: invalidate,
  });

  const connectMut = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => connectNodes(id!, from, to),
    onSuccess: invalidate,
  });

  const deleteEdgeMut = useMutation({
    mutationFn: (edgeId: string) => deleteGraphEdge(id!, edgeId),
    onSuccess: invalidate,
  });

  const undoMut = useMutation({
    mutationFn: () => undoWorkflow(id!),
    onSuccess: invalidate,
  });

  const redoMut = useMutation({
    mutationFn: () => redoWorkflow(id!),
    onSuccess: invalidate,
  });

  const publishMut = useMutation({
    mutationFn: () =>
      publishProject(id!, {
        bvid: bvid.trim(),
        publishedAt: new Date(publishedAt).toISOString(),
        idempotencyKey: `web-publish-${id}-${bvid.trim()}`,
      }),
    onSuccess: () => {
      setPublishOpen(false);
      invalidate();
    },
  });

  const itemMut = useMutation({
    mutationFn: () =>
      createOpenItem(id!, {
        title: newItemTitle.trim(),
        nextActor: newItemActor,
        nextAction: newItemNextAction.trim() || undefined,
        impact: newItemImpact,
        ...(newItemImpact === 'blocking' && newItemBlocksNode
          ? { blocksNodeId: newItemBlocksNode }
          : {}),
      }),
    onSuccess: () => {
      setItemFormOpen(false);
      setNewItemTitle('');
      setNewItemNextAction('');
      invalidate();
    },
  });

  if (!id) return <ErrorState message="缺少项目 ID" />;
  if (project.isLoading) return <LoadingListSkeleton rows={8} />;
  if (project.isError) {
    return (
      <ErrorState
        message={project.error instanceof Error ? project.error.message : '加载失败'}
        onRetry={() => void project.refetch()}
      />
    );
  }

  const p = project.data!;
  const wf = p.workflow;
  const pending =
    graphMut.isPending ||
    connectMut.isPending ||
    deleteEdgeMut.isPending ||
    publishMut.isPending ||
    itemMut.isPending ||
    undoMut.isPending ||
    redoMut.isPending;

  const connectError =
    connectMut.isError && connectMut.error instanceof Error ? connectMut.error.message : null;

  const statusSummary =
    [
      overallStageLabel(p.overallStage),
      p.inProgressNodes.length
        ? `进行中：${p.inProgressNodes.map((n) => n.name).join('、')}`
        : null,
      p.primaryBlockReason ? `主要阻塞：${p.primaryBlockReason}` : null,
    ]
      .filter(Boolean)
      .join(' · ') || '暂无进行中的节点';

  const forcedAudit = Array.isArray(p.publish?.forcedCompleteAudit)
    ? (p.publish!.forcedCompleteAudit as { name?: string; nodeId?: string }[])
    : null;

  return (
    <div className="mx-auto max-w-6xl space-y-6 overflow-x-hidden px-1">
      <PageHeader title={p.name} description={statusSummary} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">概要</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <p>主要阻塞：{p.primaryBlockReason ?? '当前无阻塞事项'}</p>
          <p>
            到手 / 返点：{p.netAmount?.toLocaleString('zh-CN') ?? '—'} /{' '}
            {p.rebateAmount?.toLocaleString('zh-CN') ?? '—'}
          </p>
          <div className="md:col-span-2">
            <p className="mb-1 font-medium">未完成节点计划</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {p.pendingPlannedNodes.length === 0 ? (
                <li>暂无带计划时间的未完成节点</li>
              ) : (
                p.pendingPlannedNodes.map((n) => (
                  <li key={n.id}>
                    <Link to={`#node-${n.id}`}>{n.name}</Link> ·{' '}
                    {n.plannedAt ? formatFullLocalTime(n.plannedAt) : '未设计划时间'}
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className="md:col-span-2">
            <p className="mb-1 font-medium">进行中节点</p>
            <p>
              {p.inProgressNodes.length === 0
                ? '暂无进行中节点'
                : p.inProgressNodes
                    .map((n) => `${n.name}（${nodeStatusLabel(n.status)}）`)
                    .join('、')}
            </p>
          </div>
          <details className="md:col-span-2">
            <summary className="cursor-pointer">已完成节点</summary>
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {p.completedNodes.length === 0 ? (
                <li>尚无已完成节点</li>
              ) : (
                p.completedNodes.map((n) => (
                  <li key={n.id}>
                    {n.name} · {n.completedAt ? formatFullLocalTime(n.completedAt) : '—'}
                  </li>
                ))
              )}
            </ul>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">当前与发布状态</CardTitle>
          {!p.publish ? (
            <Button type="button" variant="outline" onClick={() => setPublishOpen((v) => !v)}>
              {publishOpen ? '取消发布' : '填写发布信息'}
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {p.publish ? (
            <>
              <p>
                已上线 {p.publish.bvid} · {formatFullLocalTime(p.publish.publishedAt)}
              </p>
              {p.monitorContract?.linkedBvid ? (
                <Link
                  className="text-primary underline"
                  to={`/monitoring/videos/${p.monitorContract.linkedBvid}`}
                >
                  查看视频数据趋势
                </Link>
              ) : null}
              <details>
                <summary className="cursor-pointer">发布时强制完成审计</summary>
                {forcedAudit && forcedAudit.length > 0 ? (
                  <ul className="mt-2 list-disc pl-5 text-muted-foreground">
                    {forcedAudit.map((row, i) => (
                      <li key={row.nodeId ?? i}>{row.name ?? row.nodeId ?? '节点'}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-muted-foreground">无额外强制完成节点</p>
                )}
              </details>
            </>
          ) : publishOpen ? (
            <div className="flex flex-col gap-2 md:max-w-md">
              <Input
                aria-label="BV号"
                placeholder="BV号"
                value={bvid}
                onChange={(e) => setBvid(e.target.value)}
              />
              <Input
                aria-label="上线时间"
                type="datetime-local"
                value={publishedAt}
                onChange={(e) => setPublishedAt(e.target.value)}
              />
              {publishMut.isError ? (
                <p className="text-destructive text-sm">
                  {publishMut.error instanceof Error ? publishMut.error.message : '发布失败'}
                </p>
              ) : null}
              <Button
                type="button"
                disabled={pending || !bvid.trim() || !publishedAt}
                onClick={() => publishMut.mutate()}
              >
                {publishMut.isPending ? '发布中…' : '确认发布'}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground">尚未发布，请填写 BV 号与上线时间。</p>
          )}
        </CardContent>
      </Card>

      {wf ? (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-base">工作流图</CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || undoMut.isPending}
                onClick={() => undoMut.mutate()}
              >
                撤销
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || redoMut.isPending}
                onClick={() => redoMut.mutate()}
              >
                重做
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || layoutPending}
                onClick={async () => {
                  setLayoutError(null);
                  setLayoutPending(true);
                  try {
                    const positions = autoLayoutPositions(
                      wf.nodes.map((n) => ({ id: n.id, posX: n.posX, posY: n.posY })),
                      wf.edges.map((e) => ({ fromNodeId: e.fromNodeId, toNodeId: e.toNodeId })),
                    );
                    await applyBatchGraphLayout(
                      id!,
                      [...positions.entries()].map(([nodeId, pos]) => ({
                        nodeId,
                        posX: pos.posX,
                        posY: pos.posY,
                      })),
                    );
                    invalidate();
                  } catch (e) {
                    setLayoutError(e instanceof Error ? e.message : '自动布局失败');
                  } finally {
                    setLayoutPending(false);
                  }
                }}
              >
                {layoutPending ? '布局中…' : '自动布局'}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {graphMut.isError ? (
              <p className="text-destructive mb-2 text-sm">
                {graphMut.error instanceof Error ? graphMut.error.message : '操作失败'}
              </p>
            ) : null}
            {layoutError ? <p className="text-destructive mb-2 text-sm">{layoutError}</p> : null}
            {newNodePrompt ? (
              <div className="mb-3 flex flex-wrap items-end gap-2 rounded border p-2">
                <Input
                  aria-label="新节点名称"
                  placeholder="节点名称"
                  value={newNodeName}
                  onChange={(e) => setNewNodeName(e.target.value)}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={pending || !newNodeName.trim()}
                  onClick={() => {
                    const n = wf.nodes.find((x) => x.id === newNodeAnchorId);
                    void graphMut.mutate({
                      type: 'create',
                      nodeId: newNodeAnchorId!,
                      create: {
                        name: newNodeName.trim(),
                        posX: (n?.posX ?? 0) + (newNodePrompt === 'serial' ? 200 : 0),
                        posY: (n?.posY ?? 0) + (newNodePrompt === 'parallel' ? 140 : 0),
                      },
                    });
                    setNewNodePrompt(null);
                    setNewNodeName('');
                  }}
                >
                  创建
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setNewNodePrompt(null)}
                >
                  取消
                </Button>
              </div>
            ) : null}
            <WorkflowFlowEditor
              graph={wf}
              {...(focusNodeId ? { focusNodeId } : {})}
              pending={pending}
              connectError={connectError}
              onMoveNode={async (nodeId, x, y) => {
                await graphMut.mutateAsync({ type: 'move', nodeId, pos: { x, y } });
              }}
              onConnect={async (from, to) => {
                await connectMut.mutateAsync({ from, to });
              }}
              onDeleteEdge={async (edgeId) => {
                await deleteEdgeMut.mutateAsync(edgeId);
              }}
              onAdvanceTo={(nodeId) => graphMut.mutate({ type: 'advance', nodeId })}
              onComplete={(nodeId) => graphMut.mutate({ type: 'complete', nodeId })}
              onRollback={(nodeId) => graphMut.mutate({ type: 'rollback', nodeId })}
              onDeleteNode={(nodeId) => graphMut.mutate({ type: 'delete', nodeId })}
              onAddSerialNode={(afterId) => {
                setNewNodeAnchorId(afterId);
                setNewNodePrompt('serial');
                setNewNodeName('');
              }}
              onAddParallelNode={(sibId) => {
                setNewNodeAnchorId(sibId);
                setNewNodePrompt('parallel');
                setNewNodeName('');
              }}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">待闭环事项</CardTitle>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => setItemFormOpen((v) => !v)}
          >
            {itemFormOpen ? '收起表单' : '新建事项'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {itemFormOpen ? (
            <div className="space-y-2 rounded border p-3">
              <Input
                aria-label="事项标题"
                placeholder="标题"
                value={newItemTitle}
                onChange={(e) => setNewItemTitle(e.target.value)}
              />
              <Input
                aria-label="下一步动作"
                placeholder="下一步动作"
                value={newItemNextAction}
                onChange={(e) => setNewItemNextAction(e.target.value)}
              />
              <label className="flex items-center gap-2">
                行动方
                <select
                  className="rounded border px-2 py-1"
                  value={newItemActor}
                  onChange={(e) => setNewItemActor(e.target.value as 'us' | 'client')}
                >
                  <option value="us">我方</option>
                  <option value="client">甲方</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                影响
                <select
                  className="rounded border px-2 py-1"
                  value={newItemImpact}
                  onChange={(e) => setNewItemImpact(e.target.value as 'normal' | 'blocking')}
                >
                  <option value="normal">普通</option>
                  <option value="blocking">阻塞</option>
                </select>
              </label>
              {newItemImpact === 'blocking' ? (
                <select
                  className="w-full rounded border px-2 py-1"
                  value={newItemBlocksNode}
                  onChange={(e) => setNewItemBlocksNode(e.target.value)}
                >
                  <option value="">选择阻塞节点</option>
                  {wf?.nodes.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name}
                    </option>
                  ))}
                </select>
              ) : null}
              {itemMut.isError ? (
                <p className="text-destructive text-xs">
                  {itemMut.error instanceof Error ? itemMut.error.message : '创建失败'}
                </p>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={
                  pending ||
                  !newItemTitle.trim() ||
                  (newItemImpact === 'blocking' && !newItemBlocksNode)
                }
                onClick={() => itemMut.mutate()}
              >
                {itemMut.isPending ? '创建中…' : '提交事项'}
              </Button>
            </div>
          ) : null}
          {p.openItems.filter((i) => i.lifecycle === 'open').length === 0 ? (
            <p className="text-muted-foreground">暂无待闭环事项</p>
          ) : (
            p.openItems
              .filter((i) => i.lifecycle === 'open')
              .map((item) => (
                <OpenItemCard
                  key={item.id}
                  projectId={id}
                  item={item}
                  workflow={wf}
                  disabled={pending}
                />
              ))
          )}
          <details className="pt-2">
            <summary className="cursor-pointer font-medium">已闭环 / 已取消历史</summary>
            <ul className="mt-2 space-y-2">
              {p.openItems
                .filter((i) => i.lifecycle !== 'open')
                .map((item) => (
                  <li key={item.id} id={`item-${item.id}`} tabIndex={-1}>
                    <Link to={`#item-${item.id}`} className="text-primary underline">
                      {item.title}
                    </Link>
                    <span className="text-muted-foreground">
                      {' '}
                      · {item.lifecycle === 'closed' ? '已闭环' : '已取消'}
                      {item.closeConclusion ? ` · ${item.closeConclusion}` : ''}
                      {item.cancelReason ? ` · ${item.cancelReason}` : ''}
                    </span>
                  </li>
                ))}
              {p.openItems.filter((i) => i.lifecycle !== 'open').length === 0 ? (
                <li className="text-muted-foreground">暂无历史事项</li>
              ) : null}
            </ul>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
