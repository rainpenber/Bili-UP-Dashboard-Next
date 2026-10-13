import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { allowedNodeTransitions, type NodeStatus } from '@studio/workflow';
import { openItemTypeSchema, responsiblePartySchema, sourceStatusSchema } from '@studio/contracts';
import type { ProjectSummary } from '@studio/contracts';

export function ProjectDetailPage() {
  const { id } = useParams();
  const project = useProjectDetail(id);
  const workflow = useProjectWorkflow(id);
  const openItems = useOpenItems(id);
  const mutations = useProjectMutations(id);
  const [itemTitle, setItemTitle] = useState('');
  const [itemType, setItemType] = useState<string>('our_action');
  const [itemParty, setItemParty] = useState<string>('us');
  const [itemDue, setItemDue] = useState('');
  const [itemClose, setItemClose] = useState('');
  const [itemDesc, setItemDesc] = useState('');
  const [itemNodeId, setItemNodeId] = useState('');
  const [highlightNode, setHighlightNode] = useState<string | null>(null);
  const [nodeError, setNodeError] = useState<string | null>(null);
  const [itemError, setItemError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editBrand, setEditBrand] = useState('');
  const [editProduct, setEditProduct] = useState('');
  const [editCooperation, setEditCooperation] = useState('');
  const [editSource, setEditSource] = useState('unknown');
  const [editPublish, setEditPublish] = useState('');
  const [patchError, setPatchError] = useState<string | null>(null);

  const isLoading = project.isLoading || workflow.isLoading || openItems.isLoading;
  const isError = project.isError || workflow.isError || openItems.isError;
  const error = project.error ?? workflow.error ?? openItems.error;

  const focusFromHash = () => {
    const hash = window.location.hash.replace('#', '');
    if (hash.startsWith('item-')) {
      setHighlightNode(null);
      const el = document.getElementById(hash);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el?.focus();
      return;
    }
    if (hash.startsWith('node-')) {
      const nodeId = hash.replace('node-', '');
      setHighlightNode(nodeId);
      const el = document.getElementById(hash);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  useEffect(() => {
    focusFromHash();
  }, [workflow.dataUpdatedAt, openItems.dataUpdatedAt, isLoading]);

  useEffect(() => {
    if (!project.data) return;
    setEditName(project.data.name);
    setEditBrand(project.data.brand ?? '');
    setEditProduct(project.data.product ?? '');
    setEditCooperation(project.data.cooperationType ?? '');
    setEditSource(project.data.sourceStatus);
    setEditPublish(project.data.plannedPublishAt ? project.data.plannedPublishAt.slice(0, 16) : '');
  }, [project.data?.id, project.data?.updatedAt]);

  const sortedNodes = useMemo(
    () => [...(workflow.data?.nodes ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [workflow.data?.nodes],
  );

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
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">项目概要</CardTitle>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setEditOpen((v) => !v)}
              >
                {editOpen ? '取消编辑' : '编辑概要'}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm md:grid-cols-2">
              {editOpen ? (
                <>
                  <div className="space-y-1">
                    <Label htmlFor="edit-name">名称</Label>
                    <Input
                      id="edit-name"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-brand">品牌</Label>
                    <Input
                      id="edit-brand"
                      value={editBrand}
                      onChange={(e) => setEditBrand(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-product">产品</Label>
                    <Input
                      id="edit-product"
                      value={editProduct}
                      onChange={(e) => setEditProduct(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-cooperation">合作类型</Label>
                    <Input
                      id="edit-cooperation"
                      value={editCooperation}
                      onChange={(e) => setEditCooperation(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-publish">计划发布</Label>
                    <Input
                      id="edit-publish"
                      type="datetime-local"
                      value={editPublish}
                      onChange={(e) => setEditPublish(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="edit-source">来源状态</Label>
                    <Select value={editSource} onValueChange={setEditSource}>
                      <SelectTrigger id="edit-source">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {sourceStatusSchema.options.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    className="md:col-span-2 w-fit"
                    disabled={mutations.patchProject.isPending}
                    onClick={() => {
                      setPatchError(null);
                      void mutations.patchProject
                        .mutateAsync({
                          id,
                          body: {
                            name: editName,
                            brand: editBrand || null,
                            product: editProduct || null,
                            cooperationType: editCooperation || null,
                            sourceStatus: editSource as ProjectSummary['sourceStatus'],
                            ...(editPublish
                              ? { plannedPublishAt: new Date(editPublish).toISOString() }
                              : { plannedPublishAt: null }),
                          },
                        })
                        .then(() => setEditOpen(false))
                        .catch((err: unknown) => {
                          setPatchError(err instanceof Error ? err.message : '保存失败');
                        });
                    }}
                  >
                    保存 PATCH
                  </Button>
                  {patchError ? (
                    <p className="text-destructive md:col-span-2">{patchError}</p>
                  ) : null}
                </>
              ) : (
                <>
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
                </>
              )}
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
                      onValueChange={(status) => {
                        setNodeError(null);
                        void mutations.patchNode
                          .mutateAsync({ projectId: id, nodeId: node.id, body: { status } })
                          .catch((err: unknown) => {
                            setNodeError(err instanceof Error ? err.message : '更新失败');
                          });
                      }}
                    >
                      <SelectTrigger className="w-[180px]" aria-label={`更新 ${node.label} 状态`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {allowedNodeTransitions(node.status as NodeStatus).map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {node.status !== 'locked' ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={mutations.patchNode.isPending}
                        onClick={() => {
                          setNodeError(null);
                          void mutations.patchNode
                            .mutateAsync({
                              projectId: id,
                              nodeId: node.id,
                              body: { status: 'in_progress' },
                            })
                            .catch((err: unknown) => {
                              setNodeError(err instanceof Error ? err.message : '更新失败');
                            });
                        }}
                      >
                        标记进行中
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </CardContent>
            {nodeError ? <p className="px-6 pb-4 text-sm text-destructive">{nodeError}</p> : null}
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
              <div className="grid gap-2 md:grid-cols-3">
                <div className="space-y-1 md:col-span-2">
                  <Label htmlFor="new-item-title">事项标题</Label>
                  <Input
                    id="new-item-title"
                    value={itemTitle}
                    onChange={(e) => setItemTitle(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-item-type">类型</Label>
                  <Select value={itemType} onValueChange={setItemType}>
                    <SelectTrigger id="new-item-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {openItemTypeSchema.options.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-item-party">责任方</Label>
                  <Select value={itemParty} onValueChange={setItemParty}>
                    <SelectTrigger id="new-item-party">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {responsiblePartySchema.options.map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-item-due">截止时间</Label>
                  <Input
                    id="new-item-due"
                    type="datetime-local"
                    value={itemDue}
                    onChange={(e) => setItemDue(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="new-item-node">关联节点</Label>
                  <Select
                    value={itemNodeId || 'none'}
                    onValueChange={(v) => setItemNodeId(v === 'none' ? '' : v)}
                  >
                    <SelectTrigger id="new-item-node">
                      <SelectValue placeholder="可选" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">无</SelectItem>
                      {sortedNodes.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 md:col-span-3">
                  <Label htmlFor="new-item-close">关闭条件</Label>
                  <Input
                    id="new-item-close"
                    value={itemClose}
                    onChange={(e) => setItemClose(e.target.value)}
                  />
                </div>
                <div className="space-y-1 md:col-span-3">
                  <Label htmlFor="new-item-desc">说明</Label>
                  <Input
                    id="new-item-desc"
                    value={itemDesc}
                    onChange={(e) => setItemDesc(e.target.value)}
                  />
                </div>
                <Button
                  type="button"
                  disabled={!itemTitle.trim() || mutations.createOpenItem.isPending}
                  onClick={() => {
                    setItemError(null);
                    void mutations.createOpenItem
                      .mutateAsync({
                        projectId: id,
                        body: {
                          itemType,
                          title: itemTitle.trim(),
                          responsibleParty: itemParty,
                          ...(itemDue ? { dueAt: new Date(itemDue).toISOString() } : {}),
                          ...(itemClose ? { closeCondition: itemClose } : {}),
                          ...(itemDesc ? { description: itemDesc } : {}),
                          ...(itemNodeId ? { workflowNodeId: itemNodeId } : {}),
                        },
                      })
                      .then(() => {
                        setItemTitle('');
                        setItemClose('');
                        setItemDesc('');
                        setItemDue('');
                      })
                      .catch((err: unknown) => {
                        setItemError(err instanceof Error ? err.message : '创建失败');
                      });
                  }}
                >
                  创建未闭环事项
                </Button>
                {itemError ? (
                  <p className="text-sm text-destructive md:col-span-3">{itemError}</p>
                ) : null}
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
                    {item.description ? <p className="text-sm">{item.description}</p> : null}
                    {item.closeCondition ? (
                      <p className="text-sm">关闭条件：{item.closeCondition}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      来源 {item.sourceType ?? '—'} · 证据 {item.externalEvidenceRef ?? '—'} · 确认{' '}
                      {item.humanConfirmed ? '是' : '否'}
                      {item.confirmedAt ? ` (${formatFullLocalTime(item.confirmedAt)})` : ''}
                    </p>
                    {item.workflowNodeId ? (
                      <p className="text-xs text-muted-foreground">
                        关联节点 {item.workflowNodeId}
                      </p>
                    ) : null}
                    {item.status === 'open' ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
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
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void mutations.patchOpenItem.mutateAsync({
                              projectId: id,
                              itemId: item.id,
                              body: { status: 'cancelled' },
                            })
                          }
                        >
                          取消
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void mutations.patchOpenItem.mutateAsync({
                              projectId: id,
                              itemId: item.id,
                              body: { humanConfirmed: true },
                            })
                          }
                        >
                          人工确认
                        </Button>
                      </div>
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
