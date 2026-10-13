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
import {
  useProjectMutations,
  useProjectsList,
  useTeamMembers,
} from '@/api/hooks/use-project-queries';
import { stageLabel } from '@/features/projects/stage-labels';
import { formatFullLocalTime } from '@/lib/format-time';
import type { ProjectSummary } from '@studio/contracts';

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
    }),
    [params],
  );
  const setFilter = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params);
    if (!value) next.delete(key);
    else next.set(key, value);
    next.set('page', '1');
    setParams(next);
  };
  return {
    filters,
    setFilter,
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
            {project.brand ?? '—'} · {project.owner?.displayName ?? '未指定负责人'}
          </p>
        </div>
        <Badge variant={project.healthStatus === 'blocked' ? 'destructive' : 'secondary'}>
          {stageLabel(project.derivedStage)}
        </Badge>
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
  const { filters, setFilter, view, setView } = useProjectFilters();
  const { data, isLoading, isError, error, refetch } = useProjectsList(filters);
  const members = useTeamMembers();
  const { createProject } = useProjectMutations();
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');

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
        <CardContent className="grid gap-3 pt-6 md:grid-cols-4">
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
          <div className="md:col-span-2 space-y-1">
            <Label htmlFor="new-name">新建项目</Label>
            <Input
              id="new-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="项目名称"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-brand">品牌</Label>
            <Input
              id="new-brand"
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="可选"
            />
          </div>
          <Button
            type="button"
            disabled={!name.trim() || createProject.isPending}
            onClick={() => {
              void createProject
                .mutateAsync({ name: name.trim(), ...(brand ? { brand } : {}) })
                .then(() => {
                  setName('');
                  setBrand('');
                });
            }}
          >
            创建并生成工作流
          </Button>
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
              <EmptyState
                title="暂无项目"
                description="创建第一个商单项目后将自动生成标准工作流。"
              />
            ) : null}
          </TabsContent>
          <TabsContent value="list" className="space-y-2">
            {data.items.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
}
