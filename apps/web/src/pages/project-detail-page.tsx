import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams, useLocation } from 'react-router-dom';
import {
  advanceToNode,
  completeNode,
  connectNodes,
  createOpenItem,
  fetchProject,
  patchOpenItem,
  publishProject,
  rollbackNode,
  updateNodeLayout,
} from '@/api/commercial-client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { WorkflowFlowEditor } from '@/features/commercial/workflow-flow-editor';
import { overallStageLabel, nodeStatusLabel } from '@/lib/commercial-labels';

export function ProjectDetailPage() {
  const { id } = useParams();
  const location = useLocation();
  const qc = useQueryClient();
  const [publishOpen, setPublishOpen] = useState(false);
  const [bvid, setBvid] = useState('');
  const [publishedAt, setPublishedAt] = useState('');
  const project = useQuery({
    queryKey: ['commercial', 'project', id],
    queryFn: () => fetchProject(id!),
    enabled: Boolean(id),
  });

  useEffect(() => {
    const hash = location.hash.replace('#', '');
    if (hash) {
      document.getElementById(hash)?.focus();
    }
  }, [location.hash, project.data]);

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['commercial'] });

  const graphMut = useMutation({
    mutationFn: async (action: {
      type: string;
      nodeId: string;
      pos?: { x: number; y: number };
    }) => {
      if (!id) throw new Error('missing id');
      if (action.type === 'advance') return advanceToNode(id, action.nodeId);
      if (action.type === 'complete') return completeNode(id, action.nodeId);
      if (action.type === 'rollback') return rollbackNode(id, action.nodeId);
      if (action.type === 'move' && action.pos) {
        return updateNodeLayout(id, action.nodeId, action.pos.x, action.pos.y);
      }
      throw new Error('unknown');
    },
    onSuccess: invalidate,
  });

  const connectMut = useMutation({
    mutationFn: ({ from, to }: { from: string; to: string }) => connectNodes(id!, from, to),
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
        title: '新待闭环事项',
        nextActor: 'us',
        nextAction: '跟进处理',
      }),
    onSuccess: invalidate,
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
    graphMut.isPending || connectMut.isPending || publishMut.isPending || itemMut.isPending;

  return (
    <div className="mx-auto max-w-6xl space-y-6 overflow-x-hidden px-1">
      <PageHeader title={p.name} description={`当前阶段：${overallStageLabel(p.overallStage)}`} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">概要</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm md:grid-cols-2">
          <p>主要阻塞：{p.primaryBlockReason ?? '—'}</p>
          <p>
            到手 / 返点：{p.netAmount?.toLocaleString('zh-CN') ?? '—'} /{' '}
            {p.rebateAmount?.toLocaleString('zh-CN') ?? '—'}
          </p>
          <div className="md:col-span-2">
            <p className="mb-1 font-medium">未完成节点计划</p>
            <ul className="list-disc pl-5 text-muted-foreground">
              {p.pendingPlannedNodes.map((n) => (
                <li key={n.id}>
                  {n.name} · {n.plannedAt ?? '未设计划时间'}
                </li>
              ))}
            </ul>
          </div>
          <div className="md:col-span-2">
            <p className="mb-1 font-medium">进行中节点</p>
            <p>
              {p.inProgressNodes
                .map((n) => `${n.name}（${nodeStatusLabel(n.status)}）`)
                .join('、') || '—'}
            </p>
          </div>
          <details className="md:col-span-2">
            <summary className="cursor-pointer">已完成节点</summary>
            <ul className="mt-2 list-disc pl-5 text-muted-foreground">
              {p.completedNodes.map((n) => (
                <li key={n.id}>
                  {n.name} · {n.completedAt ?? '—'}
                </li>
              ))}
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
                已上线 {p.publish.bvid} · {p.publish.publishedAt}
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
                <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
                  {JSON.stringify(p.publish.forcedCompleteAudit, null, 2)}
                </pre>
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
          <CardHeader>
            <CardTitle className="text-base">工作流图</CardTitle>
          </CardHeader>
          <CardContent>
            {graphMut.isError ? (
              <p className="text-destructive mb-2 text-sm">
                {graphMut.error instanceof Error ? graphMut.error.message : '操作失败'}
              </p>
            ) : null}
            <WorkflowFlowEditor
              graph={wf}
              pending={pending}
              onMoveNode={(nodeId, x, y) =>
                graphMut.mutate({ type: 'move', nodeId, pos: { x, y } })
              }
              onConnect={(from, to) => connectMut.mutate({ from, to })}
              onAdvanceTo={(nodeId) => graphMut.mutate({ type: 'advance', nodeId })}
              onComplete={(nodeId) => graphMut.mutate({ type: 'complete', nodeId })}
              onRollback={(nodeId) => graphMut.mutate({ type: 'rollback', nodeId })}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">待闭环事项</CardTitle>
          <Button type="button" size="sm" disabled={pending} onClick={() => itemMut.mutate()}>
            {itemMut.isPending ? '创建中…' : '新建事项'}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {p.openItems.map((item) => (
            <div
              key={item.id}
              id={`item-${item.id}`}
              tabIndex={0}
              className="rounded border p-2 outline-none focus:ring-2"
            >
              <p className="font-medium">{item.title}</p>
              <p className="text-muted-foreground">
                {item.nextAction ?? '—'} · {item.nextActor === 'us' ? '我方' : '甲方'} ·{' '}
                {item.impact === 'blocking' ? '阻塞' : '普通'}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="mt-1"
                onClick={() =>
                  patchOpenItem(id!, item.id, {
                    impact: item.impact === 'blocking' ? 'normal' : 'blocking',
                  }).then(invalidate)
                }
              >
                切换阻塞影响
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
