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
import { toUserErrorMessage } from '@/lib/user-facing-error';
import { Button } from '@/components/ui/button';

const TAB_LABEL: Record<MonitorTab, string> = {
  videos: '视频',
  creators: 'UP 主',
  dynamics: '动态',
};

const TREND_TITLE: Record<MonitorTab, string> = {
  videos: '播放量和互动',
  creators: '粉丝数变化',
  dynamics: '点赞、转发和评论',
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
        description="看已导入的视频、UP 主和动态。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '监控' }]}
        actions={<OfflineEnvironmentBadge />}
      />

      <Tabs value={state.tab} onValueChange={(v) => onTabChange(v as MonitorTab)} className="gap-4">
        <TabsList aria-label="视频、UP 主或动态">
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
                placeholder="输入分类"
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
                placeholder="标题或编号"
                onChange={(e) => patchUrl({ q: e.target.value, page: 1, selected: null })}
              />
            </div>
          )}
        </div>

        <TabsContent value={state.tab} className="mt-0">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start">
            <section aria-label="列表" className="min-w-0 space-y-4">
              {listQuery.isLoading ? <LoadingListSkeleton rows={3} /> : null}
              {listQuery.isError ? (
                <ErrorState
                  message={toUserErrorMessage(listQuery.error, '没加载出来，请再试一次。')}
                  onRetry={() => void listQuery.refetch()}
                />
              ) : null}
              {listQuery.isSuccess && listQuery.data.items.length === 0 ? (
                <EmptyState title="没有符合的内容" description="换个分类或关键词试试。" />
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
                                  粉丝数{' '}
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
                                  点赞{' '}
                                  {'latestMetrics' in d
                                    ? formatCount(d.latestMetrics.likeCount)
                                    : '—'}{' '}
                                  · 评论{' '}
                                  {'latestMetrics' in d
                                    ? formatUnknownMetric(d.latestMetrics.commentCount)
                                    : '还没有'}
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
                <CardTitle className="text-base">{TREND_TITLE[state.tab]}</CardTitle>
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
                {!state.selected ? <NoSelectionHint message="从左边点一条，看它怎么变。" /> : null}
                {state.selected && metricsQuery.isLoading ? <LoadingListSkeleton rows={2} /> : null}
                {state.selected && metricsQuery.isError ? (
                  <ErrorState
                    title="数据没加载出来"
                    message={toUserErrorMessage(metricsQuery.error, '暂时看不到变化')}
                    onRetry={() => void metricsQuery.refetch()}
                  />
                ) : null}
                {state.selected && metricsQuery.isSuccess && metricsQuery.data == null ? (
                  <NoSelectionHint message="这条还没有记录。" />
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
