import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProjectListCard } from '@/features/commercial/components/project-list-card';
import { filterProjects, sortProjectsForList } from '@/features/commercial/commercial-selectors';
import { useCommercialProjectsQuery } from '@/features/commercial/use-commercial-queries';
import { cn } from '@/lib/utils';

export function ProjectListPage() {
  const query = useCommercialProjectsQuery();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [fromDate, setFromDate] = useState('');

  const list = useMemo(() => {
    if (!query.data) return [];
    return sortProjectsForList(filterProjects(query.data, { keyword, fromDate }));
  }, [query.data, keyword, fromDate]);

  return (
    <>
      <PageHeader
        title="项目"
        description="商单列表：先看名字和当前阶段；需要时再展开看卡点和待办。"
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
          <div className="mt-3 grid gap-4 rounded-lg border bg-muted/20 p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="project-keyword">关键词</Label>
              <Input
                id="project-keyword"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="项目名、品牌、阶段…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="project-from-date">时间不早于</Label>
              <Input
                id="project-from-date"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>
          </div>
        ) : null}
      </div>

      {query.isLoading ? <LoadingListSkeleton rows={6} /> : null}
      {query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : '加载失败'}
          onRetry={() => query.refetch()}
        />
      ) : null}

      {query.isSuccess ? (
        list.length === 0 ? (
          <EmptyState
            title="没有符合条件的项目"
            description="试试放宽关键词或日期筛选。"
            action={
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setKeyword('');
                  setFromDate('');
                }}
              >
                清空筛选
              </Button>
            }
          />
        ) : (
          <div className="space-y-3">
            {list.map((project) => (
              <ProjectListCard key={project.id} project={project} />
            ))}
          </div>
        )
      ) : null}
    </>
  );
}
