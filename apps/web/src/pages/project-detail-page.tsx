import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useOpenItems,
  useProjectDetail,
  useProjectMutations,
  useProjectWorkflow,
} from '@/api/hooks/use-project-queries';
import { stageLabel } from '@/features/projects/stage-labels';
import { formatFullLocalTime } from '@/lib/format-time';

const NODE_STATUS_OPTIONS = [
  'ready',
  'in_progress',
  'waiting_external',
  'blocked',
  'completed',
  'skipped',
] as const;

export function ProjectDetailPage() {
  const { id } = useParams();
  const project = useProjectDetail(id);
  const workflow = useProjectWorkflow(id);
  const openItems = useOpenItems(id);
  const mutations = useProjectMutations(id);
  const [itemTitle, setItemTitle] = useState('');
  const [highlightNode, setHighlightNode] = useState<string | null>(null);

  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash.startsWith('node-')) setHighlightNode(hash.replace('node-', ''));
    if (hash.startsWith('item-')) {
      const el = document.getElementById(hash);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [workflow.dataUpdatedAt, openItems.dataUpdatedAt]);

  const sortedNodes = useMemo(
    () => [...(workflow.data?.nodes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [workflow.data?.nodes],
  );

  const isLoading = project.isLoading || workflow.isLoading || openItems.isLoading;
  const isError = project.isError || workflow.isError || openItems.isError;
  const error = project.error ?? workflow.error ?? openItems.error;

  if (!id) return <ErrorState message="缺少项目 ID" />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link to="/projects" className="text-muted-foreground hover:text-foreground">
          项目中心
        </Link>
        <span className="text-muted-foreground">/</span>
        <span>{project.data?.name ?? id}</span>
      </div>

      {isLoading ? <LoadingListSkeleton rows={6} /> : null}
      {isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : '加载失败'}
          onRetry={() => {
            void project.refetch();
            void workflow.refetch();
            void openItems.refetch();
          }}
        />
      ) : null}

      {project.data && workflow.data ? (
        <>
          <PageHeader
            title={project.data.name}
            description={`${project.data.brand ?? '—'} · ${stageLabel(project.data.derivedStage)} · 健康 ${project.data.healthStatus}`}
            actions={
              <div className="flex gap-2">
                {project.data.archivedAt ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void mutations.restoreProject.mutateAsync(id)}
                  >
                    恢复
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void mutations.archiveProject.mutateAsync(id)}
                  >
                    归档
                  </Button>
                )}
              </div>
            }
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">项目概要</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-2">
              <p>产品：{project.data.product ?? '—'}</p>
              <p>合作类型：{project.data.cooperationType ?? '—'}</p>
              <p>负责人：{project.data.owner?.displayName ?? '—'}</p>
              <p>
                计划发布：
                {project.data.plannedPublishAt
                  ? formatFullLocalTime(project.data.plannedPublishAt)
                  : '—'}
              </p>
              <p>来源状态：{project.data.sourceStatus}</p>
              <p>
                归档：
                {project.data.archivedAt ? formatFullLocalTime(project.data.archivedAt) : '否'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">工作流树</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {sortedNodes.map((node) => (
                <div
                  key={node.id}
                  id={`node-${node.id}`}
                  className={`rounded-lg border p-3 ${highlightNode === node.id ? 'ring-2 ring-ring' : ''}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{node.label}</span>
                    <Badge variant="secondary">{node.status}</Badge>
                    {node.dueAt ? (
                      <span className="text-xs text-muted-foreground">
                        截止 {formatFullLocalTime(node.dueAt)}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    负责人 {node.owner?.displayName ?? '—'} · 完成条件{' '}
                    {node.completionCriteria ?? '—'}
                  </p>
                  {node.blockedReason ? (
                    <p className="text-sm text-destructive">阻塞：{node.blockedReason}</p>
                  ) : null}
                  {node.blockedByNodeIds.length > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      blocked_by: {node.blockedByNodeIds.join(', ')}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Select
                      value={node.status}
                      onValueChange={(status) =>
                        void mutations.patchNode.mutateAsync({
                          projectId: id,
                          nodeId: node.id,
                          body: { status },
                        })
                      }
                    >
                      <SelectTrigger className="w-[180px]" aria-label={`更新 ${node.label} 状态`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {NODE_STATUS_OPTIONS.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void mutations.patchNode.mutateAsync({
                          projectId: id,
                          nodeId: node.id,
                          body: { status: 'in_progress' },
                        })
                      }
                    >
                      标记进行中
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">最近状态变化</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {workflow.data.recentHistory.length === 0 ? (
                <p className="text-muted-foreground">暂无历史记录</p>
              ) : (
                workflow.data.recentHistory.map((h) => (
                  <p key={h.id}>
                    {formatFullLocalTime(h.changedAt)} · {h.fromStatus ?? '—'} → {h.toStatus}
                  </p>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">未闭环事项</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Input
                  value={itemTitle}
                  onChange={(e) => setItemTitle(e.target.value)}
                  placeholder="新事项标题"
                  className="max-w-md"
                />
                <Button
                  type="button"
                  disabled={!itemTitle.trim()}
                  onClick={() =>
                    void mutations.createOpenItem
                      .mutateAsync({
                        projectId: id,
                        body: {
                          itemType: 'our_action',
                          title: itemTitle.trim(),
                          responsibleParty: 'us',
                        },
                      })
                      .then(() => setItemTitle(''))
                  }
                >
                  添加我方事项
                </Button>
              </div>
              {(openItems.data?.items ?? []).length === 0 ? (
                <EmptyState
                  title="暂无未闭环事项"
                  description="可在此跟踪需人工确认或交付的条目。"
                />
              ) : (
                (openItems.data?.items ?? []).map((item) => (
                  <div key={item.id} id={`item-${item.id}`} className="rounded-lg border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.title}</span>
                      <Badge variant="secondary">{item.status}</Badge>
                      <Badge variant="outline">{item.itemType}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      责任方 {item.responsibleParty}
                      {item.dueAt ? ` · 截止 ${formatFullLocalTime(item.dueAt)}` : ''}
                    </p>
                    {item.closeCondition ? (
                      <p className="text-sm">关闭条件：{item.closeCondition}</p>
                    ) : null}
                    {item.status === 'open' ? (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-2"
                        variant="outline"
                        onClick={() =>
                          void mutations.patchOpenItem.mutateAsync({
                            projectId: id,
                            itemId: item.id,
                            body: { status: 'resolved' },
                          })
                        }
                      >
                        标记已解决
                      </Button>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
