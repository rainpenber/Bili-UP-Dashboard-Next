import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { fetchHome } from '@/api/commercial-client';
import { PageHeader } from '@/components/layout/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { formatFullLocalTime } from '@/lib/format-time';

function ItemList(props: {
  items: {
    itemId: string;
    projectId: string;
    projectName: string;
    title: string;
    nextAction: string | null;
    plannedAt: string | null;
  }[];
  empty: string;
}) {
  if (props.items.length === 0)
    return <p className="text-sm text-muted-foreground">{props.empty}</p>;
  return (
    <div className="space-y-2 text-sm">
      {props.items.map((item) => (
        <Link
          key={item.itemId}
          to={`/projects/${item.projectId}#item-${item.itemId}`}
          className="block rounded-md border p-2 hover:bg-muted/50 focus:outline-none focus:ring-2"
        >
          <p className="font-medium">{item.title}</p>
          <p className="text-muted-foreground">
            {item.projectName} · {item.nextAction ?? '—'}
            {item.plannedAt ? ` · ${formatFullLocalTime(item.plannedAt)}` : ''}
          </p>
        </Link>
      ))}
    </div>
  );
}

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
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">我方要处理</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemList items={data.ourOpenItems} empty="暂无待办" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">等待甲方处理</CardTitle>
          </CardHeader>
          <CardContent>
            <ItemList items={data.clientOpenItems} empty="暂无等待甲方的事项" />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">进行中项目的阻塞节点</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {data.blockedProjects.length === 0 ? (
            <p className="text-muted-foreground">当前没有阻塞中的项目</p>
          ) : (
            data.blockedProjects.map((row) => (
              <Link
                key={`${row.projectId}-${row.blockedNodeId}`}
                to={`/projects/${row.projectId}#node-${row.blockedNodeId}`}
                className="block rounded-md border p-2 hover:bg-muted/50 focus:outline-none focus:ring-2"
              >
                <p className="font-medium">
                  {row.projectName} · {row.blockedNodeName}
                </p>
                <p className="text-muted-foreground">
                  {row.primaryBlock ?? '阻塞中'}
                  {row.userDeadlineAt ? ` · 死线 ${formatFullLocalTime(row.userDeadlineAt)}` : ''}
                  {row.blockedSinceHours != null
                    ? ` · 已阻塞 ${row.blockedSinceHours.toFixed(1)} 小时`
                    : ''}
                </p>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
