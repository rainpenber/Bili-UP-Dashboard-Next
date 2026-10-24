import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { ActionItemRow } from '@/features/commercial/components/action-item-row';
import {
  countLiveOpenActions,
  excludeSoftArchivedProjects,
  getLiveActiveProjects,
  getLiveBlockedSummaries,
  getLiveClientActionItems,
  getLiveOurActionItems,
  liveInstantLabel,
  type LiveActionItem,
  type LiveActiveProjectSummary,
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

function BoardCounts({
  openActionCount,
  activeProjectCount,
  blockedCount,
}: {
  openActionCount: number;
  activeProjectCount: number;
  blockedCount: number;
}) {
  return (
    <p
      className="mb-4 text-sm text-muted-foreground"
      data-testid="home-board-counts"
      data-open-actions={openActionCount}
      data-active-projects={activeProjectCount}
      data-blocked={blockedCount}
    >
      开放事项 {openActionCount} · 进行中项目 {activeProjectCount} · 阻塞项目 {blockedCount}
    </p>
  );
}

function ActiveProjectsSection({ rows }: { rows: LiveActiveProjectSummary[] }) {
  return (
    <Section
      className="lg:col-span-2 xl:col-span-3"
      title="进行中项目"
      description="业务态为进行中的未归档项目。不依赖开放事项，方便直接进详情跟进。"
    >
      {rows.length === 0 ? (
        <EmptyState
          title="当前没有进行中的项目"
          description="来源状态为进行中 / 收尾中的真实项目会出现在这里。"
        />
      ) : (
        <ul className="divide-y rounded-lg border" data-testid="home-active-projects">
          {rows.map((row) => (
            <li key={row.projectId}>
              <Link
                to={`/projects/${row.projectId}`}
                className="flex flex-col gap-1 px-4 py-3 transition hover:bg-accent/30 sm:flex-row sm:items-center sm:justify-between"
                data-testid="home-active-project"
                data-project-id={row.projectId}
                data-business-state={row.businessState}
              >
                <div className="min-w-0 space-y-1">
                  <p className="font-medium">{row.projectName}</p>
                  <p className="text-sm text-muted-foreground">
                    当前节点 / 阶段：{row.progressLabel}
                  </p>
                </div>
                <p className="shrink-0 text-sm text-muted-foreground">
                  来源状态：{row.originStatusLabel}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

export function CommercialHomePage() {
  // Default list already omits archived_at; filter again so no module can show soft-deleted rows.
  const query = useLiveCommercialProjectsQuery({ includeArchived: false });
  const projects = query.data ? excludeSoftArchivedProjects(query.data.items) : [];
  const ourItems = getLiveOurActionItems(projects);
  const clientItems = getLiveClientActionItems(projects);
  const blocked = getLiveBlockedSummaries(projects);
  const activeProjects = getLiveActiveProjects(projects);

  return (
    <>
      <PageHeader
        title="今日看板"
        description="先看今天要催谁、自己要干什么，以及哪些项目节点被卡住了；下方列出业务态进行中的项目。"
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
        <>
          <BoardCounts
            openActionCount={countLiveOpenActions(projects)}
            activeProjectCount={activeProjects.length}
            blockedCount={blocked.length}
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3 xl:items-start">
            <ActionColumn
              title="我方要处理的事项"
              emptyTitle="这边暂时没有待办"
              emptyDescription={
                activeProjects.length > 0
                  ? '没有开放事项，但下方仍可看到进行中的项目。'
                  : '有商单需要你们推进时，会出现在这里。'
              }
              items={ourItems}
              projects={projects}
            />
            <ActionColumn
              title="等待甲方处理的事项"
              emptyTitle="没有在等甲方的开放事项"
              emptyDescription={
                activeProjects.length > 0
                  ? '没有开放事项，但下方仍可看到进行中的项目。'
                  : '需要品牌或中介回复、确认、开票时，会列在这里。'
              }
              items={clientItems}
              projects={projects}
            />
            <Section
              className="lg:col-span-2 xl:col-span-1"
              title="阻塞节点"
              description="按项目列出卡住的节点。没有记录的原因、对外时间或阻塞开始时间会照实标出。"
            >
              {blocked.length === 0 ? (
                <EmptyState
                  title="目前没有卡住的节点"
                  description={
                    activeProjects.length > 0
                      ? '没有阻塞节点，下方仍可看到进行中的项目。'
                      : '节点状态为阻塞时会出现在这里，包括还没有原因或日期的。'
                  }
                />
              ) : (
                <ul className="divide-y rounded-lg border">
                  {blocked.map((row) => (
                    <li key={row.projectId}>
                      <Link
                        to={`/projects/${row.projectId}`}
                        className="flex flex-col gap-2 px-4 py-3 transition hover:bg-accent/30"
                        data-testid="home-block"
                        data-project-id={row.projectId}
                      >
                        <p className="font-medium">{row.projectName}</p>
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
              )}
            </Section>
            <ActiveProjectsSection rows={activeProjects} />
          </div>
        </>
      ) : null}
    </>
  );
}
