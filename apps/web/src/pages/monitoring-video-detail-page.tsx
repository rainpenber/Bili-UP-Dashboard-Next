import { newestMetricPoint } from '@studio/contracts';
import { useParams } from 'react-router-dom';
import { useVideoDetailQuery, useVideoMetricsDetailQuery } from '@/api/hooks/use-monitor-queries';
import { coverAssetUrl } from '@/api/monitor-client';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import { MonitoringDetailLayout } from '@/features/monitoring/monitoring-detail-layout';
import { VideoAuthorPanel } from '@/features/monitoring/video-author-panel';
import {
  formatOnlineViewersDisplay,
  formatUnknownMetric,
  formatViewCountDisplay,
} from '@/lib/format-compact-number';
import { formatFullLocalTime, formatShortTime } from '@/lib/format-time';

export function MonitoringVideoDetailPage() {
  const { bvid = '' } = useParams();
  const detailQuery = useVideoDetailQuery(bvid);
  const metricsQuery = useVideoMetricsDetailQuery(bvid);

  if (detailQuery.isLoading) return <LoadingListSkeleton rows={4} />;
  if (detailQuery.isError) {
    return (
      <ErrorState
        title="无法加载视频"
        message={detailQuery.error instanceof Error ? detailQuery.error.message : '加载失败'}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <ErrorState title="未找到视频" message={`不存在 BV 号 ${bvid}`} />;
  }

  const v = detailQuery.data;
  const latest = newestMetricPoint(metricsQuery.data?.items ?? []);

  return (
    <MonitoringDetailLayout
      testId="video-detail-page"
      title={v.title ?? v.bvid}
      description="视频监控详情与历史指标"
      entityLabel={v.bvid}
      aside={<VideoAuthorPanel creator={v.creator ?? null} />}
      backTo="/monitoring?tab=videos"
      status={
        v.deletedAt ? (
          <Badge variant="destructive">已删除</Badge>
        ) : v.archivedAt ? (
          <Badge variant="warning">已归档</Badge>
        ) : null
      }
      meta={[
        { label: 'BV 号', value: v.bvid },
        { label: '分类', value: v.category ?? '未分类' },
        { label: '分区', value: v.partitionName ?? '暂缺' },
        { label: 'UP MID', value: v.mid ?? '—' },
        {
          label: '封面',
          value: (
            <img
              src={coverAssetUrl(v.coverAssetId)}
              alt=""
              className="max-h-24 rounded border object-cover"
              width={160}
              height={90}
            />
          ),
        },
        {
          label: '最后采样',
          value: latest ? (
            <span title={formatFullLocalTime(latest.sampledAt)}>
              {formatShortTime(latest.sampledAt)}
            </span>
          ) : (
            '暂无采样'
          ),
        },
        {
          label: '最新播放',
          value: latest ? formatViewCountDisplay(latest.viewCount) : '—',
        },
        {
          label: '在线观看',
          value: latest
            ? formatOnlineViewersDisplay(latest.onlineViewers, latest.onlineViewersRaw)
            : '—',
        },
        {
          label: '评论数',
          value: latest ? formatUnknownMetric(latest.commentCount) : '暂无数据',
        },
      ]}
      charts={
        metricsQuery.isLoading ? (
          <LoadingListSkeleton rows={2} />
        ) : metricsQuery.isError ? (
          <ErrorState
            message={
              metricsQuery.error instanceof Error ? metricsQuery.error.message : '指标加载失败'
            }
            onRetry={() => void metricsQuery.refetch()}
          />
        ) : (
          <MetricCharts kind="video" points={metricsQuery.data?.items ?? []} />
        )
      }
    />
  );
}
