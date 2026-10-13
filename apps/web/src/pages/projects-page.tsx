import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createProject, fetchProjects } from '@/api/commercial-client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';

export function ProjectsPage() {
  const [params, setParams] = useSearchParams();
  const page = params.get('page') ?? '1';
  const q = params.get('q') ?? '';
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const qc = useQueryClient();

  const list = useQuery({
    queryKey: ['commercial', 'projects', page, q],
    queryFn: () => fetchProjects({ page, ...(q ? { q } : {}) }),
  });

  const create = useMutation({
    mutationFn: () => createProject(newName.trim()),
    onSuccess: async () => {
      setNewName('');
      setCreateOpen(false);
      await qc.invalidateQueries({ queryKey: ['commercial'] });
    },
  });

  if (list.isLoading) return <LoadingListSkeleton rows={6} />;
  if (list.isError) {
    return (
      <ErrorState
        message={list.error instanceof Error ? list.error.message : '加载失败'}
        onRetry={() => void list.refetch()}
      />
    );
  }

  const items = list.data?.items ?? [];

  return (
    <div className="space-y-6">
      <PageHeader title="项目列表" description="按阻塞与阶段快速定位商单" />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => setFiltersOpen((v) => !v)}>
          {filtersOpen ? '收起筛选' : '展开筛选'}
        </Button>
        <Button type="button" variant="outline" onClick={() => setCreateOpen((v) => !v)}>
          {createOpen ? '收起创建' : '新建空白项目'}
        </Button>
      </div>
      {filtersOpen ? (
        <Card>
          <CardContent className="flex flex-wrap gap-2 pt-6">
            <Input
              placeholder="关键词"
              value={q}
              onChange={(e) => {
                const next = new URLSearchParams(params);
                if (e.target.value) next.set('q', e.target.value);
                else next.delete('q');
                next.set('page', '1');
                setParams(next);
              }}
            />
          </CardContent>
        </Card>
      ) : null}
      {createOpen ? (
        <Card>
          <CardContent className="flex flex-wrap items-end gap-2 pt-6">
            <Input
              aria-label="项目名称"
              placeholder="项目名称"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <Button
              type="button"
              disabled={!newName.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? '创建中…' : '创建'}
            </Button>
          </CardContent>
        </Card>
      ) : null}
      <div className="space-y-2">
        {items.map((p) => (
          <Card key={p.id}>
            <CardHeader className="flex flex-row items-center justify-between py-3">
              <div>
                <CardTitle className="text-base">
                  <Link to={`/projects/${p.id}`}>{p.name}</Link>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {p.primaryBlockLabel ? `阻塞：${p.primaryBlockLabel}` : p.overallStage}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}
              >
                {expanded === p.id ? '收起' : '展开'}
              </Button>
            </CardHeader>
            {expanded === p.id ? (
              <CardContent className="text-sm text-muted-foreground">
                未闭环 {p.openItemCount} 条 · 到手 {p.netAmount ?? '—'} · 返点{' '}
                {p.rebateAmount ?? '—'}
              </CardContent>
            ) : null}
          </Card>
        ))}
      </div>
    </div>
  );
}
