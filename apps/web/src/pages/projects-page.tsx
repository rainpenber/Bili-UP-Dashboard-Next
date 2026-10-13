import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/ui/pagination';
import { sourceStatusSchema, type ProjectSummary } from '@studio/contracts';
import {
  useProjectMutations,
  useProjectsList,
  useTeamMembers,
} from '@/api/hooks/use-project-queries';
import { stageLabel } from '@/features/projects/stage-labels';
import { formatFullLocalTime } from '@/lib/format-time';
const STAGES: ProjectSummary['derivedStage'][] = [
  'business_init',
  'outline',
  'copywriting',
  'production',
  'review',
  'publish',
  'go_live_monitoring',
  'settlement',
  'completed',
];

function useProjectFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(
    () => ({
      page: params.get('page') ?? '1',
      pageSize: '20',
      stage: params.get('stage') ?? undefined,
      ownerId: params.get('ownerId') ?? undefined,
      risk: params.get('risk') ?? undefined,
      includeArchived: params.get('includeArchived') ?? undefined,
      dueBefore: params.get('dueBefore') ?? undefined,
    }),
    [params],
  );
  const setFilter = (key: string, value: string | undefined, resetPage = true) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    if (resetPage) next.set('page', '1');
    setParams(next);
  };
  const setPage = (page: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(page));
    setParams(next);
  };
  return {
    filters,
    setFilter,
    setPage,
    view: params.get('view') ?? 'board',
    setView: (v: string) => {
      const next = new URLSearchParams(params);
      next.set('view', v);
      setParams(next);
    },
  };
}

function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="block rounded-lg border p-3 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-medium">{project.name}</p>
          <p className="text-sm text-muted-foreground">
            {project.brand ?? '—'} · {project.product ?? '—'} ·{' '}
            {project.owner?.displayName ?? '未指定负责人'}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={project.healthStatus === 'blocked' ? 'destructive' : 'secondary'}>
            {stageLabel(project.derivedStage)}
          </Badge>
          {project.archivedAt ? <Badge variant="outline">已归档</Badge> : null}
        </div>
      </div>
      <p className="mt-2 text-sm">下一步：{project.nextStepLabel ?? '—'}</p>
      {project.primaryBlockReason ? (
        <p className="text-xs text-destructive">阻塞：{project.primaryBlockReason}</p>
      ) : null}
      <p className="text-xs text-muted-foreground">
        未闭环 {project.openItemCount} · 计划发布{' '}
        {project.plannedPublishAt ? formatFullLocalTime(project.plannedPublishAt) : '—'}
      </p>
    </Link>
  );
}

export function ProjectsPage() {
  const { filters, setFilter, setPage, view, setView } = useProjectFilters();
  const { data, isLoading, isError, error, refetch } = useProjectsList(filters);
  const members = useTeamMembers();
  const { createProject } = useProjectMutations();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [product, setProduct] = useState('');
  const [cooperationType, setCooperationType] = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [plannedPublishAt, setPlannedPublishAt] = useState('');
  const [sourceStatus, setSourceStatus] = useState<string>('unknown');
  const [createError, setCreateError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, ProjectSummary[]>();
    for (const stage of STAGES) map.set(stage, []);
    for (const p of data?.items ?? []) {
      const list = map.get(p.derivedStage) ?? [];
      list.push(p);
      map.set(p.derivedStage, list);
    }
    return map;
  }, [data?.items]);

  return (
    <div className="space-y-6">
      <PageHeader title="项目中心" description="商单看板与列表，主阶段由工作流推导" />
      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-5">
          <div className="space-y-1">
            <Label htmlFor="stage">主阶段</Label>
            <Select
              value={filters.stage ?? 'all'}
              onValueChange={(v) => setFilter('stage', v === 'all' ? undefined : v)}
            >
              <SelectTrigger id="stage">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {STAGES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {stageLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="owner">负责人</Label>
            <Select
              value={filters.ownerId ?? 'all'}
              onValueChange={(v) => setFilter('ownerId', v === 'all' ? undefined : v)}
            >
              <SelectTrigger id="owner">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                {(members.data?.items ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="risk">风险</Label>
            <Select
              value={filters.risk ?? 'any'}
              onValueChange={(v) => setFilter('risk', v === 'any' ? undefined : v)}
            >
              <SelectTrigger id="risk">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">全部</SelectItem>
                <SelectItem value="blocked">阻塞</SelectItem>
                <SelectItem value="at_risk">有风险</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label htmlFor="dueBefore">计划发布截止（早于）</Label>
            <Input
              id="dueBefore"
              type="datetime-local"
              value={filters.dueBefore ? filters.dueBefore.slice(0, 16) : ''}
              onChange={(e) =>
                setFilter(
                  'dueBefore',
                  e.target.value ? new Date(e.target.value).toISOString() : undefined,
                )
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="archived">归档</Label>
            <Select
              value={filters.includeArchived ?? 'false'}
              onValueChange={(v) => setFilter('includeArchived', v === 'true' ? 'true' : undefined)}
            >
              <SelectTrigger id="archived">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="false">隐藏归档</SelectItem>
                <SelectItem value="true">包含归档</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="grid gap-3 pt-6 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="new-name">项目名称</Label>
            <Input id="new-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-brand">品牌</Label>
            <Input id="new-brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-product">产品</Label>
            <Input id="new-product" value={product} onChange={(e) => setProduct(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-cooperation">合作类型</Label>
            <Input
              id="new-cooperation"
              value={cooperationType}
              onChange={(e) => setCooperationType(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-owner">负责人</Label>
            <Select
              value={ownerId || 'none'}
              onValueChange={(v) => setOwnerId(v === 'none' ? '' : v)}
            >
              <SelectTrigger id="new-owner">
                <SelectValue placeholder="可选" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">未指定</SelectItem>
                {(members.data?.items ?? []).map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-publish">计划发布</Label>
            <Input
              id="new-publish"
              type="datetime-local"
              value={plannedPublishAt}
              onChange={(e) => setPlannedPublishAt(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-source">来源状态</Label>
            <Select value={sourceStatus} onValueChange={setSourceStatus}>
              <SelectTrigger id="new-source">
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
          <div className="flex items-end">
            <Button
              type="button"
              disabled={!name.trim() || createProject.isPending}
              onClick={() => {
                setCreateError(null);
                void createProject
                  .mutateAsync({
                    name: name.trim(),
                    ...(brand ? { brand } : {}),
                    ...(product ? { product } : {}),
                    ...(cooperationType ? { cooperationType } : {}),
                    ...(ownerId ? { ownerId } : {}),
                    ...(plannedPublishAt
                      ? { plannedPublishAt: new Date(plannedPublishAt).toISOString() }
                      : {}),
                    sourceStatus,
                  })
                  .then(() => {
                    setName('');
                    setBrand('');
                    setProduct('');
                    setCooperationType('');
                    setOwnerId('');
                    setPlannedPublishAt('');
                  })
                  .catch((err: unknown) => {
                    setCreateError(err instanceof Error ? err.message : '创建失败');
                  });
              }}
            >
              创建并生成工作流
            </Button>
          </div>
          {createError ? (
            <p className="text-sm text-destructive md:col-span-3">{createError}</p>
          ) : null}
        </CardContent>
      </Card>

      {isLoading ? <LoadingListSkeleton /> : null}
      {isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : '加载失败'}
          onRetry={() => refetch()}
        />
      ) : null}

      {data && !isLoading ? (
        <Tabs value={view} onValueChange={setView}>
          <TabsList>
            <TabsTrigger value="board">看板</TabsTrigger>
            <TabsTrigger value="list">列表</TabsTrigger>
          </TabsList>
          <TabsContent value="board" className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {STAGES.map((stage) => {
              const items = grouped.get(stage) ?? [];
              if (items.length === 0) return null;
              return (
                <div key={stage} className="space-y-2">
                  <h2 className="text-sm font-semibold">{stageLabel(stage)}</h2>
                  <div className="space-y-2">
                    {items.map((p) => (
                      <ProjectCard key={p.id} project={p} />
                    ))}
                  </div>
                </div>
              );
            })}
            {data.items.length === 0 ? (
              <EmptyState title="看板暂无项目" description="创建商单或调整筛选条件。" />
            ) : null}
          </TabsContent>
          <TabsContent value="list" className="space-y-2">
            {data.items.length === 0 ? (
              <EmptyState title="列表暂无项目" description="创建商单或调整筛选条件。" />
            ) : (
              data.items.map((p) => <ProjectCard key={p.id} project={p} />)
            )}
          </TabsContent>
          <Pagination
            className="mt-4"
            page={Number(filters.page)}
            totalPages={data.totalPages}
            onPageChange={setPage}
            disabled={isLoading}
          />
        </Tabs>
      ) : null}
    </div>
  );
}
