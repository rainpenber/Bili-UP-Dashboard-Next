import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import {
  useCreatorsQuery,
  useDynamicsQuery,
  useEntityMetricsQuery,
  useVideosQuery,
} from '@/api/hooks/use-monitor-queries';
import { coverAssetUrl, formatCount } from '@/api/monitor-client';
import {
  EmptyState,
  ErrorState,
  LoadingListSkeleton,
  NoSelectionHint,
} from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pagination } from '@/components/ui/pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import {
  parseMonitorSearchParams,
  writeMonitorSearchParams,
  type MonitorTab,
} from '@/features/monitoring/monitor-url-state';
import { formatVideoCardMetricsSummary } from '@/features/monitoring/video-card-metrics';
import { cn } from '@/lib/utils';
import { OfflineEnvironmentBadge } from '@/features/monitoring/offline-environment-badge';
import { formatShortTime } from '@/lib/format-time';
import { formatUnknownMetric } from '@/lib/format-compact-number';
import { Button } from '@/components/ui/button';

const TAB_LABEL: Record<MonitorTab, string> = {
  videos: '视频',
  creators: 'UP 主',
  dynamics: '动态',
};

export function MonitoringPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseMonitorSearchParams(searchParams), [searchParams]);

  const patchUrl = (patch: Parameters<typeof writeMonitorSearchParams>[1]) => {
    setSearchParams(writeMonitorSearchParams(searchParams, patch), { replace: true });
  };

  const onTabChange = (tab: MonitorTab) => {
    patchUrl({
      tab,
      page: 1,
      selected: null,
      ...(tab === 'dynamics' ? { category: '', q: '' } : {}),
    });
  };

  const videosQuery = useVideosQuery(state.page, state.category, state.q, state.tab === 'videos');
  const creatorsQuery = useCreatorsQuery(state.page, state.q, state.tab === 'creators');
  const dynamicsQuery = useDynamicsQuery(state.page, state.tab === 'dynamics');
  const metricsQuery = useEntityMetricsQuery(state.tab, state.selected);

  const listQuery =
    state.tab === 'videos' ? videosQuery : state.tab === 'creators' ? creatorsQuery : dynamicsQuery;

  const totalPages = listQuery.data?.totalPages ?? (listQuery.isSuccess ? 1 : 1);

  return (
    <>
      <PageHeader
        title="监控中心"
        description="查看已导入的视频、UP 主与动态播放与互动趋势，支持筛选、分页与趋势对比。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '监控' }]}
        actions={<OfflineEnvironmentBadge />}
      />

      <Tabs value={state.tab} onValueChange={(v) => onTabChange(v as MonitorTab)} className="gap-4">
        <TabsList aria-label="监控实体类型">
          {(Object.keys(TAB_LABEL) as MonitorTab[]).map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {TAB_LABEL[tab]}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="flex flex-wrap gap-4 rounded-lg border bg-muted/20 p-4">
          {state.tab === 'videos' ? (
            <div className="grid w-full min-w-[10rem] max-w-xs gap-1.5">
              <Label htmlFor="monitor-category">分类</Label>
              <Input
                id="monitor-category"
                value={state.category}
                placeholder="可选"
                onChange={(e) => patchUrl({ category: e.target.value, page: 1, selected: null })}
              />
            </div>
          ) : null}
          {(state.tab === 'videos' || state.tab === 'creators') && (
            <div className="grid w-full min-w-[10rem] max-w-sm flex-1 gap-1.5">
              <Label htmlFor="monitor-q">关键词</Label>
              <Input
                id="monitor-q"
                value={state.q}
                placeholder="标题 / ID"
                onChange={(e) => patchUrl({ q: e.target.value, page: 1, selected: null })}
              />
            </div>
          )}
        </div>

        <TabsContent value={state.tab} className="mt-0">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
            <section aria-label="实体列表" className="min-w-0 space-y-4">
              {listQuery.isLoading ? <LoadingListSkeleton rows={3} /> : null}
              {listQuery.isError ? (
                <ErrorState
                  message={listQuery.error instanceof Error ? listQuery.error.message : '加载失败'}
                  onRetry={() => void listQuery.refetch()}
                />
              ) : null}
              {listQuery.isSuccess && listQuery.data.items.length === 0 ? (
                <EmptyState
                  title="没有匹配的条目"
                  description="尝试调整筛选条件或确认离线 CSV 是否已成功导入。"
                />
              ) : null}

              {listQuery.isSuccess && listQuery.data.items.length > 0 ? (
                <ul className="space-y-2" role="list">
                  {state.tab === 'videos' &&
                    videosQuery.data?.items.map((v) => {
                      const id = 'bvid' in v ? v.bvid : '';
                      const selected = state.selected === id;
                      return (
                        <li key={id}>
                          <div
                            className={cn(
                              'flex w-full gap-2 rounded-lg border p-3 transition-colors duration-200',
                              selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => patchUrl({ selected: id })}
                              className={cn(
                                'flex min-w-0 flex-1 gap-3 text-left',
                                'hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md',
                              )}
                              aria-pressed={selected}
                            >
                              <img
                                src={coverAssetUrl('coverAssetId' in v ? v.coverAssetId : null)}
                                alt=""
                                width={96}
                                height={54}
                                className="size-16 shrink-0 rounded object-cover"
                              />
                              <div className="min-w-0 flex-1 space-y-1">
                                <p className="line-clamp-2 font-medium leading-snug">
                                  {'title' in v ? (v.title ?? v.bvid) : id}
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  {'category' in v ? (v.category ?? '未分类') : ''}
                                </p>
                                <p className="truncate text-xs tabular-nums text-muted-foreground">
                                  更新{' '}
                                  {'latestMetrics' in v && v.latestMetrics.sampledAt
                                    ? formatShortTime(v.latestMetrics.sampledAt)
                                    : '—'}{' '}
                                  ·{' '}
                                  {'latestMetrics' in v
                                    ? formatVideoCardMetricsSummary(v.latestMetrics)
                                    : '—'}
                                </p>
                              </div>
                            </button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="shrink-0 self-center"
                              asChild
                            >
                              <Link to={`/monitoring/videos/${encodeURIComponent(id)}`}>
                                查看详情
                              </Link>
                            </Button>
                          </div>
                        </li>
                      );
                    })}

                  {state.tab === 'creators' &&
                    creatorsQuery.data?.items.map((c) => {
                      const id = 'mid' in c ? c.mid : '';
                      const selected = state.selected === id;
                      return (
                        <li key={id}>
                          <div
                            className={cn(
                              'flex w-full gap-2 rounded-lg border p-3',
                              selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => patchUrl({ selected: id })}
                              className="flex min-w-0 flex-1 gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                              aria-pressed={selected}
                            >
                              <img
                                src={coverAssetUrl('faceAssetId' in c ? c.faceAssetId : null)}
                                alt=""
                                width={64}
                                height={64}
                                className="size-14 shrink-0 rounded-full object-cover"
                              />
                              <div className="min-w-0 flex-1 space-y-1">
                                <p className="truncate font-medium">
                                  {'uname' in c ? (c.uname ?? c.mid) : id}
                                </p>
                                <p className="text-xs tabular-nums text-muted-foreground">
                                  粉丝{' '}
                                  {'latestMetrics' in c
                                    ? formatCount(c.latestMetrics.followerCount)
                                    : '—'}
                                </p>
                              </div>
                            </button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="shrink-0 self-center"
                              asChild
                            >
                              <Link to={`/monitoring/creators/${encodeURIComponent(id)}`}>
                                查看详情
                              </Link>
                            </Button>
                          </div>
                        </li>
                      );
                    })}

                  {state.tab === 'dynamics' &&
                    dynamicsQuery.data?.items.map((d) => {
                      const id = 'dynamicId' in d ? d.dynamicId : '';
                      const selected = state.selected === id;
                      return (
                        <li key={id}>
                          <div
                            className={cn(
                              'flex w-full gap-2 rounded-lg border p-3',
                              selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => patchUrl({ selected: id })}
                              className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
                              aria-pressed={selected}
                            >
                              <div className="min-w-0 space-y-1">
                                <p className="break-all font-medium">{id}</p>
                                <p className="text-xs tabular-nums text-muted-foreground">
                                  赞{' '}
                                  {'latestMetrics' in d
                                    ? formatCount(d.latestMetrics.likeCount)
                                    : '—'}{' '}
                                  · 评{' '}
                                  {'latestMetrics' in d
                                    ? formatUnknownMetric(d.latestMetrics.commentCount)
                                    : '暂无数据'}
                                </p>
                              </div>
                            </button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="shrink-0 self-center"
                              asChild
                            >
                              <Link to={`/monitoring/dynamics/${encodeURIComponent(id)}`}>
                                查看详情
                              </Link>
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                </ul>
              ) : null}

              <Pagination
                page={state.page}
                totalPages={totalPages}
                disabled={listQuery.isFetching}
                onPageChange={(page) => patchUrl({ page })}
              />
            </section>

            <Card className="min-w-0 lg:sticky lg:top-20">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">播放与互动趋势</CardTitle>
                {state.selected ? (
                  <Badge
                    variant="outline"
                    className="max-w-[12rem] truncate font-normal tabular-nums"
                  >
                    {state.selected}
                  </Badge>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                {!state.selected ? (
                  <NoSelectionHint message="从左侧列表选择一条记录以查看趋势图。" />
                ) : null}
                {state.selected && metricsQuery.isLoading ? <LoadingListSkeleton rows={2} /> : null}
                {state.selected && metricsQuery.isError ? (
                  <ErrorState
                    title="指标加载失败"
                    message={
                      metricsQuery.error instanceof Error
                        ? metricsQuery.error.message
                        : '无法获取趋势数据'
                    }
                    onRetry={() => void metricsQuery.refetch()}
                  />
                ) : null}
                {state.selected && metricsQuery.isSuccess && metricsQuery.data == null ? (
                  <NoSelectionHint message="未找到该实体的指标序列。" />
                ) : null}
                {state.selected && metricsQuery.isSuccess && metricsQuery.data?.kind === 'video' ? (
                  <MetricCharts kind="video" points={metricsQuery.data.points} />
                ) : null}
                {state.selected &&
                metricsQuery.isSuccess &&
                metricsQuery.data?.kind === 'creator' ? (
                  <MetricCharts kind="creator" points={metricsQuery.data.points} />
                ) : null}
                {state.selected &&
                metricsQuery.isSuccess &&
                metricsQuery.data?.kind === 'dynamic' ? (
                  <MetricCharts kind="dynamic" points={metricsQuery.data.points} />
                ) : null}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </>
  );
}
