import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import { useNavigate } from 'react-router-dom';
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
  buildFollowerOption,
  buildVideoEngagementOption,
  buildVideoViewsOption,
  visibleIndexRange,
} from '@/lib/chart-config';
import { defaultDataZoomRange } from '@/lib/chart-window';
import { chartSemanticFromResolved } from '@/lib/chart-colors';
import { useResolvedChartColors } from '@/features/monitoring/use-resolved-chart-colors';

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

export function MetricCharts(props: Props) {
  const colors = useResolvedChartColors();
  const navigate = useNavigate();
  const points = props.points;
  const sampledAtList = useMemo(() => points.map((p) => p.sampledAt), [points]);
  const tooltipTimes = useMemo(
    () => sampledAtList.map((t) => formatFullLocalTime(t)),
    [sampledAtList],
  );

  const initialZoom = useMemo(() => defaultDataZoomRange(sampledAtList), [sampledAtList]);
  const [followerZoom, setFollowerZoom] = useState<{ start: number; end: number } | null>(null);

  const onFollowerZoom = useCallback(
    (params: { start?: number; end?: number; batch?: { start?: number; end?: number }[] }) => {
      const batch = params.batch?.[0];
      const start = batch?.start ?? params.start;
      const end = batch?.end ?? params.end;
      if (start == null || end == null) return;
      setFollowerZoom({ start, end });
    },
    [],
  );

  const onPublishMarkClick = useCallback(
    (params: { componentType?: string; data?: { navigableExternalId?: string | null } }) => {
      if (params.componentType !== 'markPoint') return;
      const bvid = params.data?.navigableExternalId;
      if (!bvid) return;
      navigate(`/monitoring/videos/${encodeURIComponent(bvid)}`);
    },
    [navigate],
  );

  if (points.length === 0) {
    if (props.kind === 'creator' && props.variant === 'sparkline') {
      return (
        <p className="text-sm text-muted-foreground" data-testid="follower-sparkline-empty">
          暂无样本
        </p>
      );
    }
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

  if (props.kind === 'creator') {
    const followers = props.points.map((p) => parseSeriesNumber(p.followerCount));
    const zoom = followerZoom ?? initialZoom;
    const { start, end } = visibleIndexRange(followers.length, zoom.start, zoom.end);
    const publishEvents = props.publishEvents ?? [];

    const option = buildFollowerOption(
      sampledAtList,
      followers,
      colors,
      tooltipTimes,
      start,
      end,
      publishEvents.map((event) => ({
        publishedAt: event.publishedAt,
        eventKind: event.eventKind,
        titleSnapshot: event.titleSnapshot,
        externalId: event.externalId,
        navigable: event.navigable,
        monitoredTargetId: event.monitoredTargetId,
      })),
    );
    if (props.variant === 'sparkline') {
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
      <ReactECharts
        option={option}
        style={{ height: 320, width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
        onEvents={{
          datazoom: onFollowerZoom,
          restore: () => setFollowerZoom(null),
          click: onPublishMarkClick,
        }}
      />
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
