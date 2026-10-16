import { useParams } from 'react-router-dom';
import { useVideoDetailQuery, useVideoMetricsDetailQuery } from '@/api/hooks/use-monitor-queries';
import { coverAssetUrl } from '@/api/monitor-client';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import { MonitoringDetailLayout } from '@/features/monitoring/monitoring-detail-layout';
import {
  formatOnlineViewersDisplay,
  formatUnknownMetric,
  formatViewCountDisplay,
} from '@/lib/format-compact-number';
import { formatFullLocalTime, formatShortTime } from '@/lib/format-time';
import { toUserErrorMessage } from '@/lib/user-facing-error';

export function MonitoringVideoDetailPage() {
  const { bvid = '' } = useParams();
  const detailQuery = useVideoDetailQuery(bvid);
  const metricsQuery = useVideoMetricsDetailQuery(bvid);

  if (detailQuery.isLoading) return <LoadingListSkeleton rows={4} />;
  if (detailQuery.isError) {
    return (
      <ErrorState
        title="视频没加载出来"
        message={toUserErrorMessage(detailQuery.error, '没加载出来，请再试一次。')}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <ErrorState title="没有这个视频" message={`没有 BV 号为 ${bvid} 的视频。`} />;
  }

  const v = detailQuery.data;
  const latest = metricsQuery.data?.items.at(-1);

  return (
    <MonitoringDetailLayout
      title={v.title ?? v.bvid}
      description="播放量、在线观看和互动怎么变的。"
      chartsTitle="播放量和互动"
      entityLabel={v.bvid}
      backTo="/monitoring?tab=videos"
      status={
        v.deletedAt ? (
          <Badge variant="destructive">已删除</Badge>
        ) : v.archivedAt ? (
          <Badge variant="warning">已存档</Badge>
        ) : null
      }
      meta={[
        { label: 'BV 号', value: v.bvid },
        { label: '分类', value: v.category ?? '未分类' },
        { label: 'UP 主编号', value: v.mid ?? '—' },
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
          label: '最近更新',
          value: latest ? (
            <span title={formatFullLocalTime(latest.sampledAt)}>
              {formatShortTime(latest.sampledAt)}
            </span>
          ) : (
            '还没有记录'
          ),
        },
        {
          label: '播放量',
          value: latest ? formatViewCountDisplay(latest.viewCount) : '—',
        },
        {
          label: '在线观看',
          value: latest
            ? formatOnlineViewersDisplay(latest.onlineViewers, latest.onlineViewersRaw)
            : '—',
        },
        {
          label: '评论',
          value: latest ? formatUnknownMetric(latest.commentCount) : '还没有',
        },
      ]}
      charts={
        metricsQuery.isLoading ? (
          <LoadingListSkeleton rows={2} />
        ) : metricsQuery.isError ? (
          <ErrorState
            message={toUserErrorMessage(metricsQuery.error, '数据没加载出来')}
            onRetry={() => void metricsQuery.refetch()}
          />
        ) : (
          <MetricCharts kind="video" points={metricsQuery.data?.items ?? []} />
        )
      }
    />
  );
}
