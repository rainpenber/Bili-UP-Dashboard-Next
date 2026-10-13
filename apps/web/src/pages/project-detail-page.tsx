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
  useTeamMembers,
} from '@/api/hooks/use-project-queries';
import { OpenItemCard } from '@/features/projects/open-item-card';
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
  const members = useTeamMembers();
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
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [editOwnerId, setEditOwnerId] = useState('');
  const [itemCreateConfirmed, setItemCreateConfirmed] = useState(false);
  const [itemCreateConfirmedBy, setItemCreateConfirmedBy] = useState('');

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
      el?.focus();
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
    setEditOwnerId(project.data.owner?.id ?? '');
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
              <div className="flex flex-col items-end gap-1">
                <div className="flex gap-2">
                  {project.data.archivedAt ? (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={mutations.restoreProject.isPending}
                      onClick={() => {
                        setArchiveError(null);
                        mutations.restoreProject.mutateAsync(id).catch((err: unknown) => {
                          setArchiveError(err instanceof Error ? err.message : '恢复失败');
                        });
                      }}
                    >
                      {mutations.restoreProject.isPending ? '恢复中…' : '恢复'}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      disabled={mutations.archiveProject.isPending}
                      onClick={() => {
                        setArchiveError(null);
                        mutations.archiveProject.mutateAsync(id).catch((err: unknown) => {
                          setArchiveError(err instanceof Error ? err.message : '归档失败');
                        });
                      }}
                    >
                      {mutations.archiveProject.isPending ? '归档中…' : '归档'}
                    </Button>
                  )}
                </div>
                {archiveError ? <p className="text-sm text-destructive">{archiveError}</p> : null}
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
                  <div className="space-y-1">
                    <Label htmlFor="edit-owner">负责人</Label>
                    <Select
                      value={editOwnerId || 'none'}
                      onValueChange={(v) => setEditOwnerId(v === 'none' ? '' : v)}
                    >
                      <SelectTrigger id="edit-owner">
                        <SelectValue placeholder="可选" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">无</SelectItem>
                        {(members.data?.items ?? []).map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.displayName}
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
                            ownerId: editOwnerId || null,
                          },
                        })
                        .then(() => setEditOpen(false))
                        .catch((err: unknown) => {
                          setPatchError(err instanceof Error ? err.message : '保存失败');
                        });
                    }}
                  >
                    {mutations.patchProject.isPending ? '保存中…' : '保存 PATCH'}
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
                  tabIndex={-1}
                  className={`rounded-lg border p-3 outline-none focus:ring-2 focus:ring-ring ${highlightNode === node.id ? 'ring-2 ring-ring' : ''}`}
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
                      disabled={mutations.patchNode.isPending}
                      onValueChange={(status) => {
                        setNodeError(null);
                        mutations.patchNode
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
                        {mutations.patchNode.isPending ? '更新中…' : '标记进行中'}
                      </Button>
                    ) : null}
                    {mutations.patchNode.isPending ? (
                      <span className="text-xs text-muted-foreground">节点更新中…</span>
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
                <div className="space-y-1">
                  <Label htmlFor="new-item-confirmed">初始人工确认</Label>
                  <Select
                    value={itemCreateConfirmed ? 'yes' : 'no'}
                    onValueChange={(v) => setItemCreateConfirmed(v === 'yes')}
                  >
                    <SelectTrigger id="new-item-confirmed">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="no">未确认</SelectItem>
                      <SelectItem value="yes">已确认</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {itemCreateConfirmed ? (
                  <div className="space-y-1">
                    <Label htmlFor="new-item-confirmer">确认人</Label>
                    <Select
                      value={itemCreateConfirmedBy || 'none'}
                      onValueChange={(v) => setItemCreateConfirmedBy(v === 'none' ? '' : v)}
                    >
                      <SelectTrigger id="new-item-confirmer">
                        <SelectValue placeholder="选择成员" />
                      </SelectTrigger>
                      <SelectContent>
                        {(members.data?.items ?? []).map((m) => (
                          <SelectItem key={m.id} value={m.id}>
                            {m.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ) : null}
                <Button
                  type="button"
                  disabled={!itemTitle.trim() || mutations.createOpenItem.isPending}
                  onClick={() => {
                    setItemError(null);
                    if (itemCreateConfirmed && !itemCreateConfirmedBy) {
                      setItemError('已确认时必须选择确认人');
                      return;
                    }
                    mutations.createOpenItem
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
                          ...(itemCreateConfirmed
                            ? {
                                humanConfirmed: true,
                                confirmedById: itemCreateConfirmedBy,
                              }
                            : {}),
                        },
                      })
                      .then(() => {
                        setItemTitle('');
                        setItemClose('');
                        setItemDesc('');
                        setItemDue('');
                        setItemCreateConfirmed(false);
                        setItemCreateConfirmedBy('');
                      })
                      .catch((err: unknown) => {
                        setItemError(err instanceof Error ? err.message : '创建失败');
                      });
                  }}
                >
                  {mutations.createOpenItem.isPending ? '创建中…' : '创建未闭环事项'}
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
                  <OpenItemCard
                    key={item.id}
                    item={item}
                    projectId={id}
                    nodes={sortedNodes}
                    members={members.data?.items ?? []}
                    mutations={mutations}
                    onError={setItemError}
                  />
                ))
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}
