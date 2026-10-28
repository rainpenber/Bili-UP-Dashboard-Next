import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { CommercialProjectListItem, CommercialProjectPhase } from '@studio/contracts';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProjectListCard } from '@/features/commercial/components/project-list-card';
import {
  filterLiveProjects,
  onlySoftArchivedProjects,
  sortLiveProjects,
} from '@/features/commercial/commercial-live-selectors';
import { useLiveCommercialProjectsQuery } from '@/features/commercial/use-live-workflow';
import { cn } from '@/lib/utils';

type OriginFilter = '' | 'real' | 'fixture' | 'manual' | 'unclassified';

const PHASE_COLUMNS: ReadonlyArray<{ phase: CommercialProjectPhase; title: string }> = [
  { phase: 'pending', title: '待开始' },
  { phase: 'active', title: '进行中' },
  { phase: 'wrapping', title: '收尾完结' },
];

function readArchivedExpanded(searchParams: URLSearchParams): boolean {
  return searchParams.get('includeArchived') === '1';
}

export function ProjectListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [originKind, setOriginKind] = useState<OriginFilter>('');
  const archivedExpanded = readArchivedExpanded(searchParams);

  const activeQuery = useLiveCommercialProjectsQuery({ originKind, includeArchived: false });
  // Always fetch with includeArchived so the fold can show an accurate count while collapsed.
  // Cards render only when expanded (includeArchived=1 in the URL).
  const withArchivedQuery = useLiveCommercialProjectsQuery({
    originKind,
    includeArchived: true,
  });

  const setArchivedExpanded = (next: boolean) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next) nextParams.set('includeArchived', '1');
    else nextParams.delete('includeArchived');
    setSearchParams(nextParams, { replace: true });
  };

  const filters = useMemo(() => ({ keyword, fromDate }), [keyword, fromDate]);

  const activeList = useMemo(() => {
    if (!activeQuery.data) return [];
    return sortLiveProjects(filterLiveProjects(activeQuery.data.items, filters));
  }, [activeQuery.data, filters]);

  const phaseGroups = useMemo(() => {
    const groups: Record<CommercialProjectPhase, CommercialProjectListItem[]> = {
      pending: [],
      active: [],
      wrapping: [],
    };
    for (const project of activeList) groups[project.phase].push(project);
    return groups;
  }, [activeList]);

  const archivedList = useMemo(() => {
    if (!withArchivedQuery.data) return [];
    return sortLiveProjects(
      filterLiveProjects(onlySoftArchivedProjects(withArchivedQuery.data.items), filters),
    );
  }, [withArchivedQuery.data, filters]);

  const archivedCount = useMemo(() => {
    if (!withArchivedQuery.data || !activeQuery.data) return archivedList.length;
    return Math.max(0, withArchivedQuery.data.total - activeQuery.data.total);
  }, [withArchivedQuery.data, activeQuery.data, archivedList.length]);

  const listReady = activeQuery.isSuccess && withArchivedQuery.isSuccess;
  const listError = activeQuery.isError || withArchivedQuery.isError;
  const listLoading =
    !listError && (activeQuery.isLoading || (!listReady && withArchivedQuery.isLoading));
  const unfilteredActiveCount = activeQuery.data?.total ?? activeQuery.data?.items.length ?? 0;
  const error = activeQuery.error ?? withArchivedQuery.error;

  return (
    <>
      <PageHeader
        title="项目"
        description="商单列表：先看名字和当前阶段；需要时再展开看卡点和事项。"
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '项目', to: '/projects' },
        ]}
      />

      <div className="mb-4">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((v) => !v)}
        >
          搜索与筛选
          <ChevronDown className={cn('size-4', filtersOpen && 'rotate-180')} aria-hidden />
        </Button>
        {filtersOpen ? (
          <div className="mt-3 grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="project-keyword">关键词</Label>
              <Input
                id="project-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="项目名、阶段、事项"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-from-date">创建日不早于</Label>
              <Input
                id="project-from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-origin-kind">来源</Label>
              <select
                id="project-origin-kind"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                value={originKind}
                onChange={(e) => setOriginKind(e.target.value as OriginFilter)}
              >
                <option value="">全部（含样例）</option>
                <option value="fixture">样例</option>
                <option value="real">真实接入</option>
                <option value="manual">手工</option>
                <option value="unclassified">未分类</option>
              </select>
            </div>
          </div>
        ) : null}
      </div>

      {listError ? (
        <ErrorState
          message={error instanceof Error ? error.message : '加载失败'}
          onRetry={() => {
            void activeQuery.refetch();
            void withArchivedQuery.refetch();
          }}
        />
      ) : null}

      {!listError && listLoading ? <LoadingListSkeleton rows={6} /> : null}

      {!listError && listReady ? (
        <div className="space-y-6">
          {activeList.length === 0 ? (
            <EmptyState
              title={
                unfilteredActiveCount === 0
                  ? originKind === 'real'
                    ? '还没有真实接入的商单'
                    : '还没有数据库项目'
                  : '没有符合条件的项目'
              }
              description={
                unfilteredActiveCount === 0
                  ? originKind === 'real'
                    ? '真实来源尚未写入。本包不假装已迁移历史商单；样例请切到来源「样例」或「全部」。'
                    : '列表默认隐藏已归档项目。可在底部「已归档」折叠区查看或恢复。'
                  : '试试放宽关键词，或去掉创建日 / 来源筛选。'
              }
              action={
                unfilteredActiveCount === 0 && !originKind ? null : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setKeyword('');
                      setFromDate('');
                      setOriginKind('');
                    }}
                  >
                    清空筛选
                  </Button>
                )
              }
            />
          ) : (
            <div
              className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start"
              data-testid="project-phase-columns"
            >
              {PHASE_COLUMNS.map(({ phase, title }) => {
                const projects = phaseGroups[phase];
                return (
                  <section
                    key={phase}
                    className="min-w-0 space-y-3"
                    data-testid="project-phase-column"
                    data-phase={phase}
                  >
                    <h2
                      className="border-b pb-2 text-sm font-semibold"
                      data-testid="project-phase-heading"
                    >
                      {title} · {projects.length}
                    </h2>
                    {projects.length === 0 ? (
                      <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                        暂无项目
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {projects.map((project) => (
                          <ProjectListCard key={project.id} project={project} />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          <div className="space-y-3 border-t pt-4" data-testid="project-archived-fold">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm font-medium text-foreground hover:bg-muted/40"
              aria-expanded={archivedExpanded}
              onClick={() => setArchivedExpanded(!archivedExpanded)}
              data-testid="project-archived-fold-toggle"
            >
              <span aria-hidden>{archivedExpanded ? '▾' : '▷'}</span>
              <span>已归档（{archivedCount}）</span>
            </button>
            {archivedExpanded ? (
              archivedList.length === 0 ? (
                <EmptyState title="暂无已归档" description="归档的项目会出现在这里，可单独恢复。" />
              ) : (
                <div
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
                  data-testid="project-archived-fold-list"
                >
                  {archivedList.map((project) => (
                    <ProjectListCard key={project.id} project={project} />
                  ))}
                </div>
              )
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
