import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import {
  blockedProjects,
  movingProjects,
  stageSummary,
} from '@/features/commercial/commercial-selectors';
import { useCommercialProjectsQuery } from '@/features/commercial/use-commercial-queries';
import { cn } from '@/lib/utils';
import type { CommercialProjectListItem } from '@studio/contracts';

function Section({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-3', className)}>
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ProjectLinks({ projects }: { projects: CommercialProjectListItem[] }) {
  if (projects.length === 0) {
    return <EmptyState title="这里是空的" description="有符合条件的商单时会出现在这里。" />;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {projects.map((project) => (
        <li key={project.id}>
          <Link
            to={`/projects/${project.id}`}
            className="block px-4 py-3 transition hover:bg-accent/30"
          >
            <p className="font-medium">{project.name}</p>
            <p className="text-sm text-muted-foreground">{stageSummary(project)}</p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function CommercialHomePage() {
  const query = useCommercialProjectsQuery();
  const items = query.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="今日看板"
        description="按列表接口里的阻塞标记和当前节点汇总。开放事项的分工不在这份列表里。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '今日看板' }]}
      />

      {query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : '加载失败'}
          onRetry={() => void query.refetch()}
        />
      ) : null}

      {!query.isError && query.isLoading ? <LoadingListSkeleton rows={5} /> : null}

      {!query.isError && query.isSuccess ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Section title="有节点被卡住的项目" description="列表接口标记了 anyNodeBlocked 的商单。">
            <ProjectLinks projects={blockedProjects(items)} />
          </Section>
          <Section
            title="正在推进、没有阻塞的项目"
            description="当前有进行中的节点，且没有阻塞节点。"
          >
            <ProjectLinks projects={movingProjects(items)} />
          </Section>
        </div>
      ) : null}
    </>
  );
}
