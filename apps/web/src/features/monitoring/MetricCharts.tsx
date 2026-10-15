import { useCallback, useMemo, useState } from 'react';
import ReactECharts from 'echarts-for-react';
import type { VideoMetricPoint, CreatorMetricPoint, DynamicMetricPoint } from '@studio/contracts';
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
  | { kind: 'video'; points: VideoMetricPoint[] }
  | { kind: 'creator'; points: CreatorMetricPoint[] }
  | { kind: 'dynamic'; points: DynamicMetricPoint[] };

function onlineValue(p: VideoMetricPoint): number | string | null {
  if (p.onlineViewersRaw) return p.onlineViewersRaw;
  return parseSeriesNumber(p.onlineViewers);
}

function hasAnyNumeric(values: (number | null)[]): boolean {
  return values.some((v) => v !== null);
}

export function MetricCharts(props: Props) {
  const colors = useResolvedChartColors();
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

    return (
      <div className="space-y-4">
        <ReactECharts
          option={buildVideoViewsOption(sampledAtList, online, views, colors, tooltipTimes)}
          style={{ height: 300, width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge
        />
        <ReactECharts
          option={buildVideoEngagementOption(sampledAtList, engagementSeries, colors, tooltipTimes)}
          style={{ height: 300, width: '100%' }}
          opts={{ renderer: 'canvas' }}
          notMerge
        />
        {!hasAnyNumeric(comments) ? (
          <p className="text-xs text-muted-foreground">评论数：历史数据暂无，未绘制评论曲线。</p>
        ) : null}
      </div>
    );
  }

  if (props.kind === 'creator') {
    const followers = props.points.map((p) => parseSeriesNumber(p.followerCount));
    const zoom = followerZoom ?? initialZoom;
    const { start, end } = visibleIndexRange(followers.length, zoom.start, zoom.end);

    return (
      <ReactECharts
        option={buildFollowerOption(sampledAtList, followers, colors, tooltipTimes, start, end)}
        style={{ height: 320, width: '100%' }}
        opts={{ renderer: 'canvas' }}
        notMerge
        onEvents={{
          datazoom: onFollowerZoom,
          restore: () => setFollowerZoom(null),
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
