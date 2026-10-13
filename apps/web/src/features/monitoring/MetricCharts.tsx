import ReactECharts from 'echarts-for-react';
import type { VideoMetricPoint, CreatorMetricPoint, DynamicMetricPoint } from '@studio/contracts';
import { baseTimeSeriesOption, chartSemanticColors } from '@/lib/chart-config';

type Props =
  | { kind: 'video'; points: VideoMetricPoint[] }
  | { kind: 'creator'; points: CreatorMetricPoint[] }
  | { kind: 'dynamic'; points: DynamicMetricPoint[] };

export function MetricCharts(props: Props) {
  if (props.points.length === 0) {
    return <p className="text-sm text-muted-foreground">暂无指标时序数据</p>;
  }

  if (props.kind === 'video') {
    const times = props.points.map((p) => p.sampledAt);
    const online = props.points.map((p) =>
      p.onlineViewersRaw ? `${p.onlineViewersRaw}` : (p.onlineViewers ?? null),
    );
    const views = props.points.map((p) => (p.viewCount != null ? Number(p.viewCount) : null));
    const likes = props.points.map((p) => (p.likeCount != null ? Number(p.likeCount) : null));
    const coins = props.points.map((p) => (p.coinCount != null ? Number(p.coinCount) : null));
    const base = baseTimeSeriesOption(times);

    return (
      <div className="space-y-4">
        <ReactECharts
          option={{
            ...base,
            yAxis: {
              type: 'value',
              name: '播放/在线',
              axisLabel: { color: 'var(--muted-foreground)' },
            },
            series: [
              {
                name: '播放量',
                type: 'line',
                data: views,
                connectNulls: false,
                color: chartSemanticColors.series1,
              },
              {
                name: '在线',
                type: 'line',
                data: online,
                connectNulls: false,
                color: chartSemanticColors.series2,
              },
            ],
          }}
          style={{ height: 280, width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
        <ReactECharts
          option={{
            ...base,
            yAxis: { type: 'value', name: '互动', axisLabel: { color: 'var(--muted-foreground)' } },
            series: [
              {
                name: '点赞',
                type: 'line',
                data: likes,
                connectNulls: false,
                color: chartSemanticColors.series3,
              },
              {
                name: '投币',
                type: 'line',
                data: coins,
                connectNulls: false,
                color: chartSemanticColors.series4,
              },
            ],
          }}
          style={{ height: 280, width: '100%' }}
          opts={{ renderer: 'canvas' }}
        />
      </div>
    );
  }

  if (props.kind === 'creator') {
    const times = props.points.map((p) => p.sampledAt);
    const followers = props.points.map((p) => Number(p.followerCount));
    return (
      <ReactECharts
        option={{
          ...baseTimeSeriesOption(times),
          yAxis: { type: 'value', axisLabel: { color: 'var(--muted-foreground)' } },
          series: [
            {
              name: '粉丝数',
              type: 'line',
              data: followers,
              connectNulls: false,
              color: chartSemanticColors.series1,
            },
          ],
        }}
        style={{ height: 320, width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    );
  }

  const times = props.points.map((p) => p.sampledAt);
  const likes = props.points.map((p) => (p.likeCount != null ? Number(p.likeCount) : null));
  const reposts = props.points.map((p) => (p.repostCount != null ? Number(p.repostCount) : null));
  const comments = props.points.map((p) =>
    p.commentCount != null ? Number(p.commentCount) : null,
  );

  return (
    <ReactECharts
      option={{
        ...baseTimeSeriesOption(times),
        yAxis: { type: 'value', axisLabel: { color: 'var(--muted-foreground)' } },
        series: [
          {
            name: '点赞',
            type: 'line',
            data: likes,
            connectNulls: false,
            color: chartSemanticColors.series1,
          },
          {
            name: '转发',
            type: 'line',
            data: reposts,
            connectNulls: false,
            color: chartSemanticColors.series2,
          },
          {
            name: '评论',
            type: 'line',
            data: comments,
            connectNulls: false,
            color: chartSemanticColors.series3,
          },
        ],
      }}
      style={{ height: 320, width: '100%' }}
      opts={{ renderer: 'canvas' }}
    />
  );
}
