import ReactECharts from 'echarts-for-react';
import type { VideoMetricPoint, CreatorMetricPoint, DynamicMetricPoint } from '@studio/contracts';
type Props =
  | { kind: 'video'; points: VideoMetricPoint[] }
  | { kind: 'creator'; points: CreatorMetricPoint[] }
  | { kind: 'dynamic'; points: DynamicMetricPoint[] };

export function MetricCharts(props: Props) {
  if (props.points.length === 0) {
    return <p className="empty">暂无指标时序数据</p>;
  }

  if (props.kind === 'video') {
    const times = props.points.map((p) => p.sampledAt);
    const online = props.points.map((p) =>
      p.onlineViewersRaw ? `${p.onlineViewersRaw}` : (p.onlineViewers ?? null),
    );
    const views = props.points.map((p) => (p.viewCount != null ? Number(p.viewCount) : null));
    const likes = props.points.map((p) => (p.likeCount != null ? Number(p.likeCount) : null));
    const coins = props.points.map((p) => (p.coinCount != null ? Number(p.coinCount) : null));

    const base = {
      tooltip: { trigger: 'axis' as const },
      legend: { top: 0 },
      dataZoom: [{ type: 'inside' }, { type: 'slider' }],
      toolbox: { feature: { restore: {} } },
      xAxis: { type: 'category' as const, data: times },
    };

    return (
      <div className="charts">
        <ReactECharts
          option={{
            ...base,
            yAxis: { type: 'value', name: '播放/在线' },
            series: [
              { name: '播放量', type: 'line', data: views, connectNulls: false },
              { name: '在线', type: 'line', data: online, connectNulls: false },
            ],
          }}
          style={{ height: 280 }}
        />
        <ReactECharts
          option={{
            ...base,
            yAxis: { type: 'value', name: '互动' },
            series: [
              { name: '点赞', type: 'line', data: likes, connectNulls: false },
              { name: '投币', type: 'line', data: coins, connectNulls: false },
            ],
          }}
          style={{ height: 280 }}
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
          tooltip: { trigger: 'axis' },
          legend: { data: ['粉丝数'] },
          dataZoom: [{ type: 'inside' }, { type: 'slider' }],
          toolbox: { feature: { restore: {} } },
          xAxis: { type: 'category', data: times },
          yAxis: { type: 'value' },
          series: [{ name: '粉丝数', type: 'line', data: followers, connectNulls: false }],
        }}
        style={{ height: 320 }}
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
        tooltip: { trigger: 'axis' },
        legend: { data: ['点赞', '转发', '评论'] },
        dataZoom: [{ type: 'inside' }, { type: 'slider' }],
        toolbox: { feature: { restore: {} } },
        xAxis: { type: 'category', data: times },
        yAxis: { type: 'value' },
        series: [
          { name: '点赞', type: 'line', data: likes, connectNulls: false },
          { name: '转发', type: 'line', data: reposts, connectNulls: false },
          { name: '评论', type: 'line', data: comments, connectNulls: false },
        ],
      }}
      style={{ height: 320 }}
    />
  );
}
