import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type {
  CreatorPublishEvent,
  VideoMetricPoint,
  CreatorMetricPoint,
  DynamicMetricPoint,
} from '@studio/contracts';
import { formatFullLocalTime } from '@/lib/format-time';
import { parseSeriesNumber } from '@/lib/chart-follower-axis';
import {
  buildDynamicOption,
  buildFollowerOptionDetailed,
  buildVideoEngagementOption,
  buildVideoViewsOption,
  FOLLOWER_PUBLISH_SERIES_NAME,
  type FollowerChartPublishEvent,
} from '@/lib/chart-config';
import { shanghaiCalendarDayKey } from '@/lib/chart-follower-events';
import { defaultFollowerZoomRange } from '@/lib/chart-window';
import { chartSemanticFromResolved } from '@/lib/chart-colors';
import { useResolvedChartColors } from '@/features/monitoring/use-resolved-chart-colors';
import { useCreatorVideoCoverMap } from '@/api/hooks/use-monitor-queries';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type Props =
  | {
      kind: 'video';
      points: VideoMetricPoint[];
      /** 默认上下堆叠。columns 时桌面左右并列，窄屏一列。 */
      layout?: 'stack' | 'columns';
      playbackSummary?: ReactNode;
      engagementSummary?: ReactNode;
    }
  | {
      kind: 'creator';
      points: CreatorMetricPoint[];
      variant?: 'full' | 'sparkline';
      publishEvents?: CreatorPublishEvent[];
      mid?: string;
    }
  | { kind: 'dynamic'; points: DynamicMetricPoint[] };

function hasDrawnPoint(value: number | string | null): boolean {
  return value !== null && value !== '';
}

function FittedChart({ option }: { option: EChartsOption }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReactECharts | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      try {
        chartRef.current?.getEchartsInstance()?.resize();
      } catch {
        // The instance may not exist yet when the container first reports a size.
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={hostRef} className="min-w-0">
      <ReactECharts
        ref={chartRef}
        option={option}
        style={{ height: 300, width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
      />
    </div>
  );
}

function onlineValue(p: VideoMetricPoint): number | string | null {
  if (p.onlineViewersRaw) return p.onlineViewersRaw;
  return parseSeriesNumber(p.onlineViewers);
}

function hasAnyNumeric(values: (number | null)[]): boolean {
  return values.some((v) => v !== null);
}

function parseAllEventsParam(raw: string | null): boolean {
  return raw === '1' || raw === 'true';
}

function CreatorFollowerCharts({
  points,
  variant,
  publishEvents = [],
  mid = '',
}: {
  points: CreatorMetricPoint[];
  variant?: 'full' | 'sparkline';
  publishEvents?: CreatorPublishEvent[];
  mid?: string;
}) {
  const colors = useResolvedChartColors();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const showAllEvents = parseAllEventsParam(searchParams.get('allEvents'));
  const needsVideoCovers = publishEvents.some((event) => event.eventKind === 'video');
  const coverMapQuery = useCreatorVideoCoverMap(mid, needsVideoCovers);
  const coverByBvid = coverMapQuery.data;
  const chartHostRef = useRef<HTMLDivElement>(null);

  const setShowAllEvents = useCallback(
    (next: boolean) => {
      setSearchParams(
        (prev) => {
          const params = new URLSearchParams(prev);
          if (next) params.set('allEvents', '1');
          else params.delete('allEvents');
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const sampledAtList = useMemo(() => points.map((p) => p.sampledAt), [points]);
  const mappedPublishEvents = useMemo<FollowerChartPublishEvent[]>(
    () =>
      publishEvents.map((event) => ({
        publishedAt: event.publishedAt,
        eventKind: event.eventKind,
        titleSnapshot: event.titleSnapshot,
        externalId: event.externalId,
        navigable: event.navigable,
        monitoredTargetId: event.monitoredTargetId,
        coverProxyUrl:
          event.eventKind === 'video' ? (coverByBvid?.get(event.externalId) ?? null) : null,
      })),
    [publishEvents, coverByBvid],
  );

  const followers = useMemo(() => points.map((p) => parseSeriesNumber(p.followerCount)), [points]);

  const sampleTimesMs = useMemo(
    () => sampledAtList.map((iso) => Date.parse(iso)).filter((t) => Number.isFinite(t)),
    [sampledAtList],
  );

  // Domain preview for initial zoom (matches buildFollowerOptionDetailed filtering).
  const domainPreview = useMemo(() => {
    const eventsForDomain = showAllEvents
      ? mappedPublishEvents
      : (() => {
          if (sampleTimesMs.length === 0) return [] as FollowerChartPublishEvent[];
          const minS = Math.min(...sampleTimesMs);
          const maxS = Math.max(...sampleTimesMs);
          return mappedPublishEvents.filter((event) => {
            const t = Date.parse(event.publishedAt);
            return Number.isFinite(t) && t >= minS && t <= maxS;
          });
        })();
    const eventTimes = eventsForDomain
      .map((e) => Date.parse(e.publishedAt))
      .filter((t) => Number.isFinite(t));
    const minCandidates = [...sampleTimesMs, ...eventTimes];
    const maxCandidates = [...sampleTimesMs, ...eventTimes, Date.now()];
    if (minCandidates.length === 0) {
      return { minMs: Date.now(), maxMs: Date.now() };
    }
    const minMs = Math.min(...minCandidates);
    const maxMs = Math.max(...maxCandidates, minMs);
    return { minMs, maxMs };
  }, [mappedPublishEvents, sampleTimesMs, showAllEvents]);

  const initialZoom = useMemo(() => {
    const lastSampleMs = sampleTimesMs.length > 0 ? Math.max(...sampleTimesMs) : null;
    return defaultFollowerZoomRange(domainPreview.minMs, domainPreview.maxMs, lastSampleMs);
  }, [domainPreview, sampleTimesMs]);

  const [followerZoom, setFollowerZoom] = useState<{ start: number; end: number } | null>(null);
  const appliedFollowerZoomRef = useRef<{ start: number; end: number }>(initialZoom);

  useEffect(() => {
    appliedFollowerZoomRef.current = followerZoom ?? initialZoom;
  }, [followerZoom, initialZoom]);

  // Reset user zoom when the default window / domain changes (toggle / new data).
  useEffect(() => {
    setFollowerZoom(null);
  }, [showAllEvents, initialZoom.start, initialZoom.end]);

  const onFollowerZoom = useCallback(
    (params: { start?: number; end?: number; batch?: { start?: number; end?: number }[] }) => {
      const batch = params.batch?.[0];
      const start = batch?.start ?? params.start;
      const end = batch?.end ?? params.end;
      if (start == null || end == null) return;
      const applied = appliedFollowerZoomRef.current;
      if (Math.abs(applied.start - start) < 0.05 && Math.abs(applied.end - end) < 0.05) {
        return;
      }
      appliedFollowerZoomRef.current = { start, end };
      setFollowerZoom({ start, end });
    },
    [],
  );

  const zoom = followerZoom ?? initialZoom;
  const { option, dayBuckets } = useMemo(
    () =>
      buildFollowerOptionDetailed(
        sampledAtList,
        followers,
        colors,
        zoom.start,
        zoom.end,
        mappedPublishEvents,
        Date.now(),
        showAllEvents,
      ),
    [sampledAtList, followers, colors, zoom.start, zoom.end, mappedPublishEvents, showAllEvents],
  );

  /** Shanghai day → nav href for line-hit navigation. */
  const navByDay = useMemo(() => {
    const map = new Map<string, string>();
    for (const [dayKey, bucket] of dayBuckets) {
      if (bucket.navHref) map.set(dayKey, bucket.navHref);
    }
    return map;
  }, [dayBuckets]);

  const goNav = useCallback(
    (href: string | null | undefined) => {
      if (!href) return;
      navigate(href);
    },
    [navigate],
  );

  const onPublishMarkClick = useCallback(
    (params: {
      componentType?: string;
      seriesType?: string;
      seriesName?: string;
      dataIndex?: number;
      data?: unknown;
      value?: unknown;
    }) => {
      if (params.componentType !== 'series') return;
      let href: string | null = null;
      if (params.seriesType === 'scatter' && params.seriesName === FOLLOWER_PUBLISH_SERIES_NAME) {
        const row = params.data;
        if (row && typeof row === 'object' && !Array.isArray(row)) {
          const data = row as { navHref?: string | null; navigableExternalId?: string | null };
          href =
            data.navHref ??
            (data.navigableExternalId
              ? `/monitoring/videos/${encodeURIComponent(data.navigableExternalId)}`
              : null);
        }
      } else if (params.seriesType === 'line') {
        const raw = params.value;
        const timeMs = Array.isArray(raw)
          ? typeof raw[0] === 'number'
            ? raw[0]
            : Date.parse(String(raw[0]))
          : NaN;
        if (Number.isFinite(timeMs)) {
          const dayKey = shanghaiCalendarDayKey(new Date(timeMs).toISOString());
          if (dayKey) href = navByDay.get(dayKey) ?? null;
        }
      }
      goNav(href);
    },
    [goNav, navByDay],
  );

  // Tooltip HTML uses data-follower-nav; capture clicks on the enterable tooltip.
  useEffect(() => {
    const host = chartHostRef.current;
    if (!host) return;
    const onClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const navEl = target.closest('[data-follower-nav]');
      if (!navEl) return;
      const href = navEl.getAttribute('data-follower-nav');
      if (!href) return;
      event.preventDefault();
      event.stopPropagation();
      goNav(href);
    };
    host.addEventListener('click', onClick);
    // Tooltips may render under body; also listen on document for enterable tips.
    document.addEventListener('click', onClick);
    return () => {
      host.removeEventListener('click', onClick);
      document.removeEventListener('click', onClick);
    };
  }, [goNav]);

  if (points.length === 0) {
    if (variant === 'sparkline') {
      return (
        <p className="text-sm text-muted-foreground" data-testid="follower-sparkline-empty">
          暂无样本
        </p>
      );
    }
    return <p className="text-sm text-muted-foreground">暂无播放与互动数据</p>;
  }

  if (variant === 'sparkline') {
    return (
      <div className="min-w-0 overflow-hidden" data-testid="follower-sparkline">
        <ReactECharts
          option={{
            ...option,
            legend: { show: false },
            toolbox: { show: false },
            dataZoom: [{ type: 'inside', start: zoom.start, end: zoom.end }],
            grid: { left: 8, right: 8, top: 16, bottom: 24, containLabel: true },
          }}
          style={{ height: 140, width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-2" data-testid="follower-chart" ref={chartHostRef}>
      <div className="flex items-center gap-2" data-testid="follower-chart-all-events-toggle">
        <Switch
          id="follower-all-events"
          checked={showAllEvents}
          onCheckedChange={setShowAllEvents}
          data-testid="follower-all-events-switch"
        />
        <Label htmlFor="follower-all-events" className="cursor-pointer text-sm font-normal">
          显示全部事件
        </Label>
      </div>
      <ReactECharts
        option={option}
        style={{ height: 320, width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
        onEvents={{
          datazoom: onFollowerZoom,
          click: onPublishMarkClick,
        }}
      />
    </div>
  );
}

export function MetricCharts(props: Props) {
  const colors = useResolvedChartColors();
  const points = props.points;
  const sampledAtList = useMemo(() => points.map((p) => p.sampledAt), [points]);
  const tooltipTimes = useMemo(
    () => sampledAtList.map((t) => formatFullLocalTime(t)),
    [sampledAtList],
  );

  if (props.kind === 'creator') {
    return (
      <CreatorFollowerCharts
        points={props.points}
        {...(props.variant ? { variant: props.variant } : {})}
        {...(props.publishEvents ? { publishEvents: props.publishEvents } : {})}
        {...(props.mid ? { mid: props.mid } : {})}
      />
    );
  }

  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无播放与互动数据</p>;
  }

  if (props.kind === 'video') {
    const online = props.points.map((p) => onlineValue(p));
    const views = props.points.map((p) => parseSeriesNumber(p.viewCount));
    const likes = props.points.map((p) => parseSeriesNumber(p.likeCount));
    const coins = props.points.map((p) => parseSeriesNumber(p.coinCount));
    const favorites = props.points.map((p) => parseSeriesNumber(p.favoriteCount));
    const shares = props.points.map((p) => parseSeriesNumber(p.shareCount));
    const danmaku = props.points.map((p) => parseSeriesNumber(p.danmakuCount));
    const comments = props.points.map((p) => parseSeriesNumber(p.commentCount));
    const semantic = chartSemanticFromResolved(colors);

    const engagementSeries = [
      { name: '点赞', data: likes, color: semantic.series1 },
      { name: '投币', data: coins, color: semantic.series2 },
      { name: '收藏', data: favorites, color: semantic.series3 },
      { name: '分享', data: shares, color: semantic.series4 },
      { name: '弹幕', data: danmaku, color: semantic.series5 },
    ];
    if (hasAnyNumeric(comments)) {
      engagementSeries.push({ name: '评论', data: comments, color: semantic.series1 });
    }

    const viewsOption = buildVideoViewsOption(sampledAtList, online, views, colors, tooltipTimes);
    const engagementOption = buildVideoEngagementOption(
      sampledAtList,
      engagementSeries,
      colors,
      tooltipTimes,
    );
    const commentNote = !hasAnyNumeric(comments) ? (
      <p className="text-xs text-muted-foreground">评论数：历史数据暂无，未绘制评论曲线。</p>
    ) : null;

    if (props.layout === 'columns') {
      const playbackHasHistory =
        online.some(hasDrawnPoint) || views.some((value) => value !== null);
      const engagementHasHistory = engagementSeries.some((series) => hasAnyNumeric(series.data));
      return (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2" data-testid="metric-charts-columns">
          <p
            className="text-xs text-muted-foreground lg:col-span-2"
            data-testid="online-metric-scope-note"
          >
            在线人数：本图为逐点曲线；列表卡片摘要取最近窗口峰值（峰值在线）。
          </p>
          <section className="min-w-0 space-y-2" data-testid="metric-chart-playback">
            <h3 className="text-sm font-medium text-foreground">播放</h3>
            {props.playbackSummary}
            {playbackHasHistory ? (
              <FittedChart option={viewsOption} />
            ) : (
              <p
                className="text-sm text-muted-foreground"
                data-testid="metric-chart-playback-empty"
              >
                没有播放或在线观看的历史数值，未绘制曲线。
              </p>
            )}
          </section>
          <section className="min-w-0 space-y-2" data-testid="metric-chart-engagement">
            <h3 className="text-sm font-medium text-foreground">互动</h3>
            {props.engagementSummary}
            {engagementHasHistory ? (
              <FittedChart option={engagementOption} />
            ) : (
              <p
                className="text-sm text-muted-foreground"
                data-testid="metric-chart-engagement-empty"
              >
                没有点赞、投币、收藏、分享、弹幕或评论的历史数值，未绘制曲线。
              </p>
            )}
            {commentNote}
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <p className="text-xs text-muted-foreground" data-testid="online-metric-scope-note">
          在线人数：本图为逐点曲线；列表卡片摘要取最近窗口峰值（峰值在线）。
        </p>
        <ReactECharts
          option={viewsOption}
          style={{ height: 300, width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge
        />
        <ReactECharts
          option={engagementOption}
          style={{ height: 300, width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge
        />
        {commentNote}
      </div>
    );
  }

  const likes = props.points.map((p) => parseSeriesNumber(p.likeCount));
  const reposts = props.points.map((p) => parseSeriesNumber(p.repostCount));
  const comments = props.points.map((p) => parseSeriesNumber(p.commentCount));
  const semantic = chartSemanticFromResolved(colors);
  const series = [
    { name: '点赞', data: likes, color: semantic.series1 },
    { name: '转发', data: reposts, color: semantic.series2 },
  ];
  if (hasAnyNumeric(comments)) {
    series.push({ name: '评论', data: comments, color: semantic.series3 });
  }

  return (
    <div className="space-y-2">
      <ReactECharts
        option={buildDynamicOption(sampledAtList, series, colors, tooltipTimes)}
        style={{ height: 320, width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
      />
      {!hasAnyNumeric(comments) ? (
        <p className="text-xs text-muted-foreground">评论数：暂无数据。</p>
      ) : null}
    </div>
  );
}
