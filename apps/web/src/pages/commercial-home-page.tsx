import type { ReactNode } from 'react';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { ActionItemRow } from '@/features/commercial/components/action-item-row';
import {
  getBlockedProjectSummaries,
  getClientActionItems,
  getOurActionItems,
} from '@/features/commercial/commercial-selectors';
import { useCommercialProjectsQuery } from '@/features/commercial/use-commercial-queries';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

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

export function CommercialHomePage() {
  const query = useCommercialProjectsQuery();

  return (
    <>
      <PageHeader
        title="今日看板"
        description="先看今天要催谁、自己要干什么，以及哪些项目节点被卡住了。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '今日看板' }]}
      />

      {query.isLoading ? <LoadingListSkeleton rows={5} /> : null}
      {query.isError ? (
        <ErrorState
          message={query.error instanceof Error ? query.error.message : '加载失败'}
          onRetry={() => query.refetch()}
        />
      ) : null}

      {query.isSuccess ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3 xl:items-start">
          <Section title="我方要处理的事项">
            {(() => {
              const items = getOurActionItems(query.data);
              const byProject = new Map(query.data.map((p) => [p.id, p]));
              if (items.length === 0) {
                return (
                  <EmptyState
                    title="这边暂时没有待办"
                    description="有商单需要你们推进时，会出现在这里。"
                  />
                );
              }
              return (
                <div className="space-y-2">
                  {items.map((item) => {
                    const project = byProject.get(item.projectId);
                    if (!project) return null;
                    return <ActionItemRow key={item.id} item={item} project={project} />;
                  })}
                </div>
              );
            })()}
          </Section>

          <Section title="等待甲方处理的事项">
            {(() => {
              const items = getClientActionItems(query.data);
              const byProject = new Map(query.data.map((p) => [p.id, p]));
              if (items.length === 0) {
                return (
                  <EmptyState
                    title="暂无在等甲方的事"
                    description="需要品牌或中介回复、确认、开票时，会列在这里。"
                  />
                );
              }
              return (
                <div className="space-y-2">
                  {items.map((item) => {
                    const project = byProject.get(item.projectId);
                    if (!project) return null;
                    return <ActionItemRow key={item.id} item={item} project={project} />;
                  })}
                </div>
              );
            })()}
          </Section>

          <Section
            className="lg:col-span-2 xl:col-span-1"
            title="进行中项目的阻塞节点汇总"
            description="按项目汇总：卡在哪、主要因为什么、对外承诺时间和已卡天数。"
          >
            {(() => {
              const rows = getBlockedProjectSummaries(query.data);
              if (rows.length === 0) {
                return (
                  <EmptyState
                    title="目前没有明确卡住的节点"
                    description="有具体阻塞原因的项目会出现在这里。"
                  />
                );
              }
              return (
                <ul className="divide-y rounded-lg border">
                  {rows.map((row) => (
                    <li key={row.projectId}>
                      <Link
                        to={`/projects/${row.projectId}`}
                        className="flex flex-col gap-2 px-4 py-3 transition hover:bg-accent/30 sm:grid sm:grid-cols-2 sm:gap-x-4 lg:grid-cols-4"
                      >
                        <div>
                          <p className="text-xs text-muted-foreground">项目</p>
                          <p className="font-medium">{row.projectName}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">卡住的节点</p>
                          <p>{row.blockedNode}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">主要阻塞项</p>
                          <p className="text-sm">{row.mainBlockingItem}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">对外时间 · 已卡天数</p>
                          <p className="text-sm">
                            {row.userFacingDeadline} · 已卡 {row.blockedDays} 天
                          </p>
                        </div>
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
