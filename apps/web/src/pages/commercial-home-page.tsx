import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { ActionItemRow } from '@/features/commercial/components/action-item-row';
import {
  getLiveBlockedSummaries,
  getLiveClientActionItems,
  getLiveOurActionItems,
  liveInstantLabel,
  type LiveActionItem,
} from '@/features/commercial/commercial-live-selectors';
import { useLiveCommercialProjectsQuery } from '@/features/commercial/use-live-workflow';
import { Link } from 'react-router-dom';
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

function ActionColumn({
  title,
  emptyTitle,
  emptyDescription,
  items,
  projects,
}: {
  title: string;
  emptyTitle: string;
  emptyDescription: string;
  items: LiveActionItem[];
  projects: CommercialProjectListItem[];
}) {
  const byProject = new Map(projects.map((project) => [project.id, project]));
  if (items.length === 0) {
    return (
      <Section title={title}>
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </Section>
    );
  }
  return (
    <Section title={title}>
      <div className="space-y-2">
        {items.map((item) => {
          const project = byProject.get(item.projectId);
          if (!project) return null;
          return <ActionItemRow key={item.id} item={item} projectName={project.name} />;
        })}
      </div>
    </Section>
  );
}

export function CommercialHomePage() {
  const query = useLiveCommercialProjectsQuery();

  return (
    <>
      <PageHeader
        title="今日看板"
        description="先看今天要催谁、自己要干什么，以及哪些项目节点被卡住了。"
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
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3 xl:items-start">
          <ActionColumn
            title="我方要处理的事项"
            emptyTitle="这边暂时没有待办"
            emptyDescription="有商单需要你们推进时，会出现在这里。"
            items={getLiveOurActionItems(query.data.items)}
            projects={query.data.items}
          />
          <ActionColumn
            title="等待甲方处理的事项"
            emptyTitle="没有在等甲方的开放事项"
            emptyDescription="需要品牌或中介回复、确认、开票时，会列在这里。"
            items={getLiveClientActionItems(query.data.items)}
            projects={query.data.items}
          />
          <Section
            className="lg:col-span-2 xl:col-span-1"
            title="阻塞节点"
            description="按项目列出卡住的节点。没有记录的原因、对外时间或阻塞开始时间会照实标出。"
          >
            {(() => {
              const rows = getLiveBlockedSummaries(query.data.items);
              if (rows.length === 0) {
                return (
                  <EmptyState
                    title="目前没有卡住的节点"
                    description="节点状态为阻塞时会出现在这里，包括还没有原因或日期的。"
                  />
                );
              }
              return (
                <ul className="divide-y rounded-lg border">
                  {rows.map((row) => (
                    <li key={row.projectId}>
                      <Link
                        to={`/projects/${row.projectId}`}
                        className="flex flex-col gap-2 px-4 py-3 transition hover:bg-accent/30"
                        data-testid="home-block"
                        data-project-id={row.projectId}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">{row.projectName}</p>
                          {row.archived ? <Badge variant="secondary">已归档</Badge> : null}
                        </div>
                        <p className="text-sm">
                          <span className="text-muted-foreground">卡住的节点：</span>
                          {row.blockedNodeNames.length > 0
                            ? row.blockedNodeNames.join('、')
                            : '无节点名'}
                        </p>
                        <p className="text-sm">
                          <span className="text-muted-foreground">阻塞原因：</span>
                          {row.blockingReason ?? '未记录'}
                        </p>
                        <p className="text-sm">
                          <span className="text-muted-foreground">对外时间：</span>
                          {liveInstantLabel(row.userDeadlineAt, '未定')}
                        </p>
                        <p className="text-sm">
                          <span className="text-muted-foreground">阻塞开始：</span>
                          {liveInstantLabel(row.blockedSinceAt, '未记录')}
                        </p>
                        {row.closedItemCount > 0 ? (
                          <p className="text-sm text-muted-foreground">
                            已关闭事项 {row.closedItemCount} 条
                          </p>
                        ) : null}
                      </Link>
                    </li>
                  ))}
                </ul>
              );
            })()}
          </Section>
        </div>
      ) : null}
    </>
  );
}
