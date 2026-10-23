import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProjectListCard } from '@/features/commercial/components/project-list-card';
import {
  filterLiveProjects,
  sortLiveProjects,
} from '@/features/commercial/commercial-live-selectors';
import { useLiveCommercialProjectsQuery } from '@/features/commercial/use-live-workflow';
import { cn } from '@/lib/utils';

type OriginFilter = '' | 'real' | 'fixture' | 'manual' | 'unclassified';

function readIncludeArchived(searchParams: URLSearchParams): boolean {
  return searchParams.get('includeArchived') === '1';
}

export function ProjectListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [originKind, setOriginKind] = useState<OriginFilter>('');
  const includeArchived = readIncludeArchived(searchParams);
  const query = useLiveCommercialProjectsQuery({ originKind, includeArchived });

  const setIncludeArchived = (next: boolean) => {
    const nextParams = new URLSearchParams(searchParams);
    if (next) nextParams.set('includeArchived', '1');
    else nextParams.delete('includeArchived');
    setSearchParams(nextParams, { replace: true });
  };

  const list = useMemo(() => {
    if (!query.data) return [];
    return sortLiveProjects(filterLiveProjects(query.data.items, { keyword, fromDate }));
  }, [query.data, keyword, fromDate]);
  const unfilteredCount = query.data?.total ?? query.data?.items.length ?? 0;

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
            <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-3">
              <input
                id="project-include-archived"
                type="checkbox"
                className="size-4 rounded border border-input"
                checked={includeArchived}
                onChange={(e) => setIncludeArchived(e.target.checked)}
                data-testid="project-include-archived"
              />
              <Label htmlFor="project-include-archived" className="font-normal">
                显示已归档
              </Label>
            </div>
          </div>
        ) : null}
      </div>

      {query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : '加载失败'}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {!query.isError && query.isLoading ? <LoadingListSkeleton rows={6} /> : null}

      {!query.isError && query.isSuccess ? (
        list.length === 0 ? (
          <EmptyState
            title={
              unfilteredCount === 0
                ? originKind === 'real'
                  ? '还没有真实接入的商单'
                  : '还没有数据库项目'
                : '没有符合条件的项目'
            }
            description={
              unfilteredCount === 0
                ? originKind === 'real'
                  ? '真实来源尚未写入。本包不假装已迁移历史商单；样例请切到来源「样例」或「全部」。'
                  : includeArchived
                    ? '列表来自已保存的商单。读取失败时不会改显示演示项目。'
                    : '列表默认隐藏已归档项目。可在筛选中打开「显示已归档」查看或恢复。'
                : '试试放宽关键词，或去掉创建日 / 来源筛选。'
            }
            action={
              unfilteredCount === 0 && !originKind && !includeArchived ? null : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setKeyword('');
                    setFromDate('');
                    setOriginKind('');
                    setIncludeArchived(false);
                  }}
                >
                  清空筛选
                </Button>
              )
            }
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((project) => (
              <ProjectListCard key={project.id} project={project} />
            ))}
          </div>
        )
      ) : null}
    </>
  );
}
