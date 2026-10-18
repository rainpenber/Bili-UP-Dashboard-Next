import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { newestMetricPoint, type VideoMetricPoint } from '@studio/contracts';
import { useVideoDetailQuery, useVideoMetricsDetailQuery } from '@/api/hooks/use-monitor-queries';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import { formatUnknownMetric, formatViewCountDisplay } from '@/lib/format-compact-number';
import { formatFullLocalTime } from '@/lib/format-time';

function isMonitorNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.message === 'not found' || error.message === 'HTTP 404';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '加载失败';
}

function LatestSummary({ latest }: { latest: VideoMetricPoint }) {
  const rows = [
    ['播放', 'viewCount', formatViewCountDisplay(latest.viewCount)],
    ['点赞', 'likeCount', formatUnknownMetric(latest.likeCount)],
    ['投币', 'coinCount', formatUnknownMetric(latest.coinCount)],
    ['收藏', 'favoriteCount', formatUnknownMetric(latest.favoriteCount)],
    ['弹幕', 'danmakuCount', formatUnknownMetric(latest.danmakuCount)],
    ['分享', 'shareCount', formatUnknownMetric(latest.shareCount)],
    ['评论', 'commentCount', formatUnknownMetric(latest.commentCount)],
  ] as const;
  return (
    <dl
      className="flex max-w-full flex-wrap gap-x-4 gap-y-1 text-sm"
      data-testid="project-video-latest-summary"
    >
      {rows.map(([label, metric, value]) => (
        <div key={metric} className="flex items-baseline gap-1 whitespace-nowrap">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums" data-metric={metric}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type BoundaryProps = { resetKey: string; children: ReactNode };
type BoundaryState = { error: Error | null };

class VideoMetricsBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidUpdate(prevProps: BoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('project video metrics failed', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorState
          title="视频数据读取失败"
          message={this.state.error.message}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

/** Read-only playback and engagement for the project's recorded publish BV. */
export function ProjectVideoMetrics({ bvid }: { bvid: string }) {
  const detailQuery = useVideoDetailQuery(bvid);
  const metricsQuery = useVideoMetricsDetailQuery(bvid, detailQuery.isSuccess);
  const notFound = detailQuery.isError && isMonitorNotFound(detailQuery.error);
  const latest = newestMetricPoint(metricsQuery.data?.items ?? []);

  let body: ReactNode;
  if (detailQuery.isPending) {
    body = <LoadingListSkeleton rows={2} />;
  } else if (notFound) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="project-video-metrics-unlinked">
        暂未接入监控。监控库里没有这个 BV，所以没有播放或互动数据。
      </p>
    );
  } else if (detailQuery.isError) {
    body = (
      <ErrorState
        title="视频数据读取失败"
        message={errorMessage(detailQuery.error)}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  } else if (!metricsQuery.isSuccess) {
    body = metricsQuery.isError ? (
      <ErrorState
        title="视频数据读取失败"
        message={errorMessage(metricsQuery.error)}
        onRetry={() => void metricsQuery.refetch()}
      />
    ) : (
      <LoadingListSkeleton rows={2} />
    );
  } else if (metricsQuery.data.items.length === 0) {
    body = (
      <p className="text-sm text-muted-foreground" data-testid="project-video-metrics-empty">
        这个视频已在监控库中，但还没有采样。没有历史，所以不绘制曲线。
      </p>
    );
  } else {
    const point = latest;
    body = point ? (
      <div className="min-w-0 space-y-3">
        <LatestSummary latest={point} />
        <MetricCharts kind="video" layout="columns" points={metricsQuery.data.items} />
      </div>
    ) : null;
  }

  return (
    <section aria-label="视频数据" data-testid="project-video-metrics" data-bvid={bvid}>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
          <div className="min-w-0 space-y-1">
            <CardTitle>视频数据</CardTitle>
            <CardDescription>
              {bvid}
              {latest ? ` · 最近更新 ${formatFullLocalTime(latest.sampledAt)}` : null}
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to={`/monitoring/videos/${encodeURIComponent(bvid)}`}>查看完整监控详情</Link>
          </Button>
        </CardHeader>
        <CardContent>
          <VideoMetricsBoundary resetKey={bvid}>{body}</VideoMetricsBoundary>
        </CardContent>
      </Card>
    </section>
  );
}
