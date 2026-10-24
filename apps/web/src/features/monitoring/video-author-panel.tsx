import type { VideoCreatorSummary } from '@studio/contracts';
import { Link } from 'react-router-dom';
import {
  useCreatorMetricsDetailQuery,
  useCreatorPublishEventsQuery,
} from '@/api/hooks/use-monitor-queries';
import { coverAssetUrl } from '@/api/monitor-client';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import { formatCompactNumber } from '@/lib/format-compact-number';
import { formatFullLocalTime, formatShortTime } from '@/lib/format-time';

export function VideoAuthorPanel({ creator }: { creator: VideoCreatorSummary | null }) {
  const metricsQuery = useCreatorMetricsDetailQuery(creator?.mid ?? '');
  const publishEventsQuery = useCreatorPublishEventsQuery(creator?.mid ?? '');

  if (!creator) {
    return (
      <div data-testid="video-author-panel" className="min-w-0">
        <EmptyState
          title="作者信息待补齐"
          description="这条视频还没有关联 UP 主。补齐 mid 之后，这里会显示作者和粉丝变化。"
        />
      </div>
    );
  }

  const sampleTitle = creator.followerSampledAt
    ? formatFullLocalTime(creator.followerSampledAt)
    : undefined;

  return (
    <section
      data-testid="video-author-panel"
      className="grid min-w-0 grid-cols-1 gap-4 min-[1440px]:grid-cols-2"
    >
      <Link
        to={`/monitoring/creators/${encodeURIComponent(creator.mid)}`}
        data-testid="video-author-card"
        className="block min-w-0 rounded-lg border bg-background p-4 shadow-sm transition-colors hover:bg-muted/40"
      >
        <div className="flex min-w-0 items-center gap-3">
          <img
            src={coverAssetUrl(creator.faceAssetId)}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-full border object-cover"
          />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">作者</p>
            <p className="truncate font-medium" data-testid="video-author-name">
              {creator.uname ?? creator.mid}
            </p>
          </div>
          <Badge
            variant={creator.monitoringEnabled ? 'success' : 'outline'}
            className="ml-auto shrink-0"
          >
            {creator.monitoringEnabled ? '监控中' : '未监控'}
          </Badge>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="min-w-0">
            <dt className="text-muted-foreground">粉丝</dt>
            <dd className="font-medium tabular-nums" data-testid="video-author-followers">
              {formatCompactNumber(creator.followerLatest)}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-muted-foreground">最近采样</dt>
            <dd className="truncate" data-testid="video-author-sampled-at" title={sampleTitle}>
              {creator.followerSampledAt ? formatShortTime(creator.followerSampledAt) : '暂无采样'}
            </dd>
          </div>
        </dl>
      </Link>
      <div
        data-testid="video-author-sparkline"
        className="min-w-0 rounded-lg border bg-background p-4 shadow-sm"
      >
        <h3 className="mb-2 text-sm font-medium">粉丝变化</h3>
        {metricsQuery.isLoading ? (
          <LoadingListSkeleton rows={1} />
        ) : metricsQuery.isError ? (
          <ErrorState
            title="无法加载粉丝曲线"
            message={
              metricsQuery.error instanceof Error ? metricsQuery.error.message : '指标加载失败'
            }
            onRetry={() => void metricsQuery.refetch()}
          />
        ) : (
          <MetricCharts
            kind="creator"
            variant="sparkline"
            points={metricsQuery.data?.items ?? []}
            publishEvents={publishEventsQuery.data?.items ?? []}
            mid={creator.mid}
          />
        )}
      </div>
    </section>
  );
}
