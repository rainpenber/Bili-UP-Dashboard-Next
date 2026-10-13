import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useDashboardToday } from '@/api/hooks/use-project-queries';
import { formatFullLocalTime } from '@/lib/format-time';
import type { DashboardEntry } from '@studio/contracts';

function projectLink(entry: DashboardEntry): string {
  const hash = entry.focusNodeId
    ? `#node-${entry.focusNodeId}`
    : entry.focusOpenItemId
      ? `#item-${entry.focusOpenItemId}`
      : '';
  return `/projects/${entry.projectId}${hash}`;
}

function EntryList({ title, items }: { title: string; items: DashboardEntry[] }) {
  if (items.length === 0) return null;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {items.map((entry) => (
          <Link
            key={entry.id}
            to={projectLink(entry)}
            className="block rounded-lg border p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{entry.projectName}</span>
              <Badge variant="secondary">{entry.title}</Badge>
              {entry.dueAt ? (
                <span className="text-xs text-muted-foreground">
                  截止 {formatFullLocalTime(entry.dueAt)}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{entry.issue}</p>
            <p className="text-sm">
              责任方：{entry.responsibleParty} · 建议：{entry.suggestedNextStep}
            </p>
            <p className="text-xs text-muted-foreground">排序：{entry.explanation}</p>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}

export function TodayDashboardPage() {
  const { data, isLoading, isError, error, refetch } = useDashboardToday();

  return (
    <div className="space-y-6">
      <PageHeader title="今日驾驶舱" description="逾期、临期、阻塞与待确认事项（规则透明排序）" />
      {isLoading ? <LoadingListSkeleton rows={5} /> : null}
      {isError ? (
        <ErrorState
          message={error instanceof Error ? error.message : '未知错误'}
          onRetry={() => refetch()}
        />
      ) : null}
      {data && !isLoading ? (
        <>
          {data.overdue.length === 0 &&
          data.dueToday.length === 0 &&
          data.blockedProjects.length === 0 &&
          data.waitingUs.length === 0 ? (
            <EmptyState title="暂无优先事项" description="当前没有需要立即处理的商单节点或事项。" />
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <EntryList title="已逾期" items={data.overdue} />
            <EntryList title="今日到期" items={data.dueToday} />
            <EntryList title="未来 7 天" items={data.dueNext7Days} />
            <EntryList title="阻塞项目" items={data.blockedProjects} />
            <EntryList title="等待甲方" items={data.waitingClient} />
            <EntryList title="等待我方" items={data.waitingUs} />
            <EntryList title="待人工确认" items={data.pendingConfirmation} />
          </div>
        </>
      ) : null}
    </div>
  );
}
