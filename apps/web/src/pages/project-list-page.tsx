import { ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ProjectListCard } from '@/features/commercial/components/project-list-card';
import { listProjects } from '@/features/commercial/commercial-selectors';
import { useCommercialProjectsQuery } from '@/features/commercial/use-commercial-queries';
import { cn } from '@/lib/utils';

export function ProjectListPage() {
  const query = useCommercialProjectsQuery();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [keyword, setKeyword] = useState('');

  const list = useMemo(() => {
    if (!query.data) return [];
    return listProjects(query.data.items, keyword);
  }, [query.data, keyword]);

  return (
    <>
      <PageHeader
        title="项目"
        description="商单列表来自服务器。先看名字和当前节点；阻塞标记也来自同一份列表。"
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
          onClick={() => setFiltersOpen((value) => !value)}
        >
          搜索
          <ChevronDown className={cn('size-4', filtersOpen && 'rotate-180')} aria-hidden />
        </Button>
        {filtersOpen ? (
          <div className="mt-3 rounded-lg border bg-muted/20 p-4">
            <div className="space-y-2">
              <Label htmlFor="project-keyword">关键词</Label>
              <Input
                id="project-keyword"
                value={keyword}
                onChange={(event) => setKeyword(event.target.value)}
                placeholder="项目名或当前节点"
              />
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
            title="没有符合条件的项目"
            description="列表只显示数据库里的商单。可以放宽关键词，或先运行种子命令。"
            action={
              <Button type="button" variant="outline" onClick={() => setKeyword('')}>
                清空搜索
              </Button>
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
