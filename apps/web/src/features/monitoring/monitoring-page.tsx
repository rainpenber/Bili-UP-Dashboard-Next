import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Columns2, LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { useDynamicsQuery, useEntityMetricsQuery } from '@/api/hooks/use-monitor-queries';
import { useMonitorCardsQuery } from '@/api/hooks/use-monitor-card-queries';
import {
  EmptyState,
  ErrorState,
  LoadingListSkeleton,
  NoSelectionHint,
} from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pagination } from '@/components/ui/pagination';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { DynamicObjectCard } from '@/features/monitoring/dynamic-object-card';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import { MonitorAddDialog } from '@/features/monitoring/monitor-add-dialog';
import { MonitorCardControls, MonitorObjectCard } from '@/features/monitoring/monitor-object-card';
import {
  parseMonitorSearchParams,
  writeMonitorSearchParams,
  type MonitorPresenceFilter,
  type MonitorTab,
  type MonitorVideoSort,
  type MonitorView,
} from '@/features/monitoring/monitor-url-state';
import { OfflineEnvironmentBadge } from '@/features/monitoring/offline-environment-badge';
import { formatUnknownMetric } from '@/lib/format-compact-number';
import { formatFullLocalTime, formatShortTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Toggle } from '@/components/ui/toggle';
import { useStudioOwnerAccountQuery } from '@/api/hooks/use-studio-owner-queries';

const TAB_LABEL: Record<MonitorTab, string> = {
  videos: '视频',
  creators: 'UP 主',
  dynamics: '动态',
};

const MONITOR_FILTER_LABEL: Record<MonitorPresenceFilter, string> = {
  all: '全部',
  active: '监控中',
  paused: '已暂停',
  unmonitored: '未监控',
};

const VIDEO_SORT_LABEL: Record<MonitorVideoSort, string> = {
  published_desc: '最新发布',
  published_asc: '最早发布',
};

function MonitorLayoutToggle({
  value,
  onValueChange,
}: {
  value: MonitorView;
  onValueChange: (value: MonitorView) => void;
}) {
  return (
    <div className="ml-auto grid shrink-0 gap-1.5">
      <Label id="monitor-view-label">布局</Label>
      <ToggleGroup
        type="single"
        size="sm"
        value={value}
        aria-labelledby="monitor-view-label"
        onValueChange={(next) => {
          if (next === 'split' || next === 'grid') onValueChange(next);
        }}
      >
        <ToggleGroupItem value="split" aria-label="分栏">
          <Columns2 aria-hidden />
          分栏
        </ToggleGroupItem>
        <ToggleGroupItem value="grid" aria-label="网格">
          <LayoutGrid aria-hidden />
          网格
        </ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}

export function MonitoringPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const state = useMemo(() => parseMonitorSearchParams(searchParams), [searchParams]);
  const [addOpen, setAddOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const listQuery = searchParams.toString();

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

  const cardType = state.tab === 'creators' ? 'creator' : 'video';
  const addType =
    state.tab === 'creators' ? 'creator' : state.tab === 'dynamics' ? 'dynamic' : 'video';
  const ownerQuery = useStudioOwnerAccountQuery(state.tab === 'videos');
  const cardsQuery = useMonitorCardsQuery({
    type: cardType,
    page: state.page,
    monitor: state.monitor,
    q: state.q,
    category: state.category,
    ...(state.tab === 'videos' ? { sort: state.sort, onlyMine: state.onlyMine } : {}),
    enabled: state.tab === 'videos' || state.tab === 'creators',
  });
  const dynamicsQuery = useDynamicsQuery(state.page, state.tab === 'dynamics');
  const selectedCard =
    cardsQuery.data?.items.find((item) => item.externalId === state.selected) ?? null;
  const selectedDynamic =
    dynamicsQuery.data?.items.find((item) => item.dynamicId === state.selected) ?? null;
  const metricsQuery = useEntityMetricsQuery(
    state.tab,
    state.tab === 'dynamics' ? state.selected : selectedCard?.hasEntity ? state.selected : null,
    state.tab === 'dynamics' || selectedCard?.hasEntity === true,
  );

  const listQueryState = state.tab === 'dynamics' ? dynamicsQuery : cardsQuery;
  const totalPages = listQueryState.data?.totalPages ?? 1;
  const layoutView = state.view;
  const gridLayout = layoutView === 'grid';

  return (
    <div data-testid="monitoring-page" className="min-w-0 max-w-full overflow-x-hidden">
      <PageHeader
        title="监控中心"
        description="按视频、UP 主和动态查看对象。可在此新增、暂停和恢复监控。"
        crumbs={[{ label: '工作室', to: '/' }, { label: '监控' }]}
        actions={
          <>
            <OfflineEnvironmentBadge />
            <Button type="button" onClick={() => setAddOpen(true)}>
              新增监控
            </Button>
          </>
        }
      />

      {notice ? (
        <p role="status" className="mb-4 text-sm text-muted-foreground">
          {notice}
        </p>
      ) : null}

      <Tabs
        value={state.tab}
        onValueChange={(value) => onTabChange(value as MonitorTab)}
        className="gap-4"
      >
        <TabsList aria-label="监控实体类型">
          {(Object.keys(TAB_LABEL) as MonitorTab[]).map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {TAB_LABEL[tab]}
            </TabsTrigger>
          ))}
        </TabsList>

        {state.tab === 'dynamics' ? (
          <div className="flex min-w-0 flex-wrap items-end gap-4 rounded-lg border bg-muted/20 p-4">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              动态可新增监控、暂停与恢复。无监控目标时仍可浏览已有互动指标。
            </p>
            <MonitorLayoutToggle value={state.view} onValueChange={(view) => patchUrl({ view })} />
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap gap-4 rounded-lg border bg-muted/20 p-4">
            {state.tab === 'videos' ? (
              <div className="grid w-full min-w-0 max-w-xs gap-1.5">
                <Label htmlFor="monitor-category">分类</Label>
                <Input
                  id="monitor-category"
                  value={state.category}
                  placeholder="可选"
                  onChange={(event) =>
                    patchUrl({ category: event.target.value, page: 1, selected: null })
                  }
                />
              </div>
            ) : null}
            <div className="grid w-full min-w-0 max-w-sm flex-1 gap-1.5">
              <Label htmlFor="monitor-q">关键词</Label>
              <Input
                id="monitor-q"
                value={state.q}
                placeholder="标题 / ID"
                onChange={(event) => patchUrl({ q: event.target.value, page: 1, selected: null })}
              />
            </div>
            <div className="grid w-full min-w-0 max-w-xs gap-1.5">
              <Label htmlFor="monitor-presence">监控状态</Label>
              <select
                id="monitor-presence"
                className="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                value={state.monitor}
                onChange={(event) =>
                  patchUrl({
                    monitor: event.target.value as MonitorPresenceFilter,
                    page: 1,
                    selected: null,
                  })
                }
              >
                {(Object.keys(MONITOR_FILTER_LABEL) as MonitorPresenceFilter[]).map((filter) => (
                  <option key={filter} value={filter}>
                    {MONITOR_FILTER_LABEL[filter]}
                  </option>
                ))}
              </select>
            </div>
            {state.tab === 'videos' ? (
              <div className="grid w-full min-w-0 max-w-xs gap-1.5">
                <Label htmlFor="monitor-video-sort">排序</Label>
                <Select
                  value={state.sort}
                  onValueChange={(value) => {
                    if (value !== 'published_desc' && value !== 'published_asc') return;
                    patchUrl({ sort: value, page: 1, selected: null });
                  }}
                >
                  <SelectTrigger id="monitor-video-sort" aria-label="排序" className="w-full">
                    <SelectValue placeholder="排序" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(VIDEO_SORT_LABEL) as MonitorVideoSort[]).map((sort) => (
                      <SelectItem key={sort} value={sort}>
                        {VIDEO_SORT_LABEL[sort]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            {state.tab === 'videos' ? (
              <div className="grid w-full min-w-0 max-w-xs gap-1.5">
                <p id="monitor-only-mine-group" className="text-sm font-medium leading-none">
                  本人视频
                </p>
                <Toggle
                  id="monitor-only-mine"
                  variant="outline"
                  pressed={state.onlyMine}
                  aria-label="只看我的"
                  aria-describedby="monitor-only-mine-group"
                  data-testid="monitor-only-mine"
                  className="w-full justify-center"
                  onPressedChange={(pressed) =>
                    patchUrl({ onlyMine: pressed, page: 1, selected: null })
                  }
                >
                  只看我的
                </Toggle>
                {ownerQuery.isSuccess ? (
                  <p className="truncate text-xs text-muted-foreground" title={ownerQuery.data.mid}>
                    {ownerQuery.data.displayName} · {ownerQuery.data.mid}
                  </p>
                ) : null}
              </div>
            ) : null}
            <MonitorLayoutToggle value={state.view} onValueChange={(view) => patchUrl({ view })} />
          </div>
        )}

        <TabsContent value={state.tab} className="mt-0 min-w-0">
          <div
            data-testid="monitor-layout"
            data-view={layoutView}
            className={cn(
              'grid min-w-0 gap-6',
              gridLayout
                ? 'grid-cols-1'
                : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-start',
            )}
          >
            <section aria-label="实体列表" className="min-w-0 space-y-4">
              {listQueryState.isLoading ? <LoadingListSkeleton rows={3} /> : null}
              {listQueryState.isError ? (
                <ErrorState
                  message={
                    listQueryState.error instanceof Error
                      ? listQueryState.error.message
                      : '加载失败'
                  }
                  onRetry={() => void listQueryState.refetch()}
                />
              ) : null}
              {listQueryState.isSuccess && listQueryState.data.items.length === 0 ? (
                <EmptyState
                  title="没有匹配的条目"
                  description={
                    state.tab === 'dynamics'
                      ? '还没有动态样本。可先新增一条动态监控，或等待采集写入后再回来查看。'
                      : '调整筛选，或新增一个视频 / UP 主监控。历史对象和尚未采样的目标也会出现在这里。'
                  }
                />
              ) : null}

              {state.tab !== 'dynamics' &&
              cardsQuery.isSuccess &&
              cardsQuery.data.items.length > 0 ? (
                <ul
                  className={cn(
                    'min-w-0',
                    gridLayout
                      ? 'grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                      : 'space-y-2',
                  )}
                  role="list"
                  data-testid="monitor-card-list"
                >
                  {cardsQuery.data.items.map((card) => (
                    <MonitorObjectCard
                      key={`${card.type}:${card.externalId}`}
                      card={card}
                      presentation={gridLayout ? 'grid' : 'list'}
                      selected={state.selected === card.externalId}
                      listQuery={listQuery}
                      onSelect={() => patchUrl({ selected: card.externalId })}
                    />
                  ))}
                </ul>
              ) : null}

              {state.tab === 'dynamics' &&
              dynamicsQuery.isSuccess &&
              dynamicsQuery.data.items.length > 0 ? (
                <ul
                  className={cn(
                    'min-w-0',
                    gridLayout
                      ? 'grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
                      : 'space-y-2',
                  )}
                  role="list"
                  data-testid="dynamic-card-list"
                >
                  {dynamicsQuery.data.items.map((item) => (
                    <DynamicObjectCard
                      key={item.dynamicId}
                      item={item}
                      presentation={gridLayout ? 'grid' : 'list'}
                      selected={state.selected === item.dynamicId}
                      listQuery={listQuery}
                      onSelect={() => patchUrl({ selected: item.dynamicId })}
                    />
                  ))}
                </ul>
              ) : null}

              <Pagination
                page={state.page}
                totalPages={totalPages}
                disabled={listQueryState.isFetching}
                onPageChange={(page) => patchUrl({ page })}
              />
            </section>

            <Card
              data-testid="monitor-trend-card"
              className={cn('min-w-0', gridLayout ? 'w-full' : 'lg:sticky lg:top-20')}
            >
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base">
                  {state.tab === 'dynamics' ? '互动趋势' : '播放与互动趋势'}
                </CardTitle>
                {state.selected ? (
                  <Badge
                    variant="outline"
                    className="max-w-[12rem] truncate font-normal tabular-nums"
                  >
                    {state.selected}
                  </Badge>
                ) : null}
              </CardHeader>
              <CardContent className="min-w-0 space-y-4">
                {!state.selected ? (
                  <NoSelectionHint
                    message={
                      gridLayout
                        ? '从上方卡片选择一条记录以查看趋势图。'
                        : '从左侧列表选择一条记录以查看趋势图。'
                    }
                  />
                ) : null}
                {!gridLayout && selectedCard ? (
                  <div data-testid="monitor-split-detail-panel">
                    <MonitorCardControls
                      card={selectedCard}
                      listQuery={listQuery}
                      layout="detail"
                      includeDetailLink
                    />
                  </div>
                ) : null}
                {state.selected && selectedCard && !selectedCard.hasEntity ? (
                  <NoSelectionHint message="尚无采集数据" />
                ) : null}
                {state.selected && selectedCard?.hasEntity && !selectedCard.hasSamples ? (
                  <p className="text-sm text-muted-foreground">尚无采集数据</p>
                ) : null}
                {state.selected && state.tab === 'dynamics' && selectedDynamic ? (
                  <dl className="grid gap-1 text-sm text-muted-foreground">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        点赞{' '}
                        <span className="font-medium text-foreground tabular-nums">
                          {formatUnknownMetric(selectedDynamic.latestMetrics.likeCount)}
                        </span>
                      </span>
                      <span>
                        评论{' '}
                        <span className="font-medium text-foreground tabular-nums">
                          {formatUnknownMetric(selectedDynamic.latestMetrics.commentCount)}
                        </span>
                      </span>
                      <span>
                        转发{' '}
                        <span className="font-medium text-foreground tabular-nums">
                          {formatUnknownMetric(selectedDynamic.latestMetrics.repostCount)}
                        </span>
                      </span>
                    </div>
                    <div className="tabular-nums">
                      最近采集：
                      {selectedDynamic.latestMetrics.sampledAt ? (
                        <span title={formatFullLocalTime(selectedDynamic.latestMetrics.sampledAt)}>
                          {formatShortTime(selectedDynamic.latestMetrics.sampledAt)}
                        </span>
                      ) : (
                        '暂无'
                      )}
                    </div>
                  </dl>
                ) : null}
                {state.selected && metricsQuery.isLoading ? <LoadingListSkeleton rows={2} /> : null}
                {state.selected && metricsQuery.isError ? (
                  <ErrorState
                    title="指标加载失败"
                    message={
                      metricsQuery.error instanceof Error
                        ? metricsQuery.error.message
                        : '暂时拉不到趋势数据'
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

      <div className="mt-6">
        <Button type="button" size="sm" variant="outline" asChild>
          <Link to="/ops">查看采集记录</Link>
        </Button>
      </div>

      <MonitorAddDialog
        open={addOpen}
        type={addType}
        onOpenChange={setAddOpen}
        onCreated={({ externalId, message, enabled }) => {
          setNotice(message);
          if (state.tab === 'dynamics') {
            patchUrl({
              page: 1,
              selected: externalId,
              tab: 'dynamics',
              category: '',
              q: '',
              monitor: enabled ? 'active' : 'paused',
              onlyMine: false,
            });
            void dynamicsQuery.refetch();
            return;
          }
          // onlyMine can hide a newly added/upserted non-owner video; clear it like category.
          patchUrl({
            q: externalId,
            page: 1,
            selected: externalId,
            tab: state.tab,
            category: '',
            monitor: enabled ? 'active' : 'paused',
            onlyMine: false,
          });
        }}
      />
    </div>
  );
}
