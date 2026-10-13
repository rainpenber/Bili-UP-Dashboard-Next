import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchHome } from '@/api/commercial-client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { formatFullLocalTime } from '@/lib/format-time';

export function TodayDashboardPage() {
  const home = useQuery({ queryKey: ['commercial', 'home'], queryFn: () => fetchHome() });

  if (home.isLoading) return <LoadingListSkeleton rows={8} />;
  if (home.isError) {
    return (
      <ErrorState
        message={home.error instanceof Error ? home.error.message : '加载失败'}
        onRetry={() => void home.refetch()}
      />
    );
  }
  const data = home.data!;

  return (
    <div className="space-y-6">
      <PageHeader title="首页" description="我方待办、等待甲方与项目阻塞一览" />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">我方要处理的未闭环事项</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.ourOpenItems.length === 0 ? (
            <p className="text-muted-foreground">暂无</p>
          ) : (
            data.ourOpenItems.map((item) => (
              <Link
                key={item.itemId}
                to={`/projects/${item.projectId}#item-${item.itemId}`}
                className="block rounded-md border p-2 hover:bg-muted/50"
              >
                <p className="font-medium">{item.title}</p>
                <p className="text-muted-foreground">
                  {item.projectName} · {item.nextAction ?? '—'}
                  {item.plannedAt ? ` · ${formatFullLocalTime(item.plannedAt)}` : ''}
                </p>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">等待甲方处理的未闭环事项</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.clientOpenItems.map((item) => (
            <Link
              key={item.itemId}
              to={`/projects/${item.projectId}#item-${item.itemId}`}
              className="block rounded-md border p-2 hover:bg-muted/50"
            >
              <p className="font-medium">{item.title}</p>
              <p className="text-muted-foreground">{item.projectName}</p>
            </Link>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">进行中项目的阻塞节点</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.blockedProjects.map((row) => (
            <Link
              key={`${row.projectId}-${row.blockedNodeId}`}
              to={`/projects/${row.projectId}#node-${row.blockedNodeId}`}
              className="block rounded-md border p-2 hover:bg-muted/50"
            >
              <p className="font-medium">
                {row.projectName} · {row.blockedNodeName}
              </p>
              <p className="text-muted-foreground">
                {row.primaryBlock ?? '阻塞中'}
                {row.userDeadlineAt ? ` · 死线 ${formatFullLocalTime(row.userDeadlineAt)}` : ''}
              </p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
