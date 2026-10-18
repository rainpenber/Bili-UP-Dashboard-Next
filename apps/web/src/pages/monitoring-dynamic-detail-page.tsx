import { newestMetricPoint } from '@studio/contracts';
import { useParams } from 'react-router-dom';
import {
  useDynamicDetailQuery,
  useDynamicMetricsDetailQuery,
} from '@/api/hooks/use-monitor-queries';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import { MonitoringDetailLayout } from '@/features/monitoring/monitoring-detail-layout';
import { formatUnknownMetric } from '@/lib/format-compact-number';
import { formatFullLocalTime, formatShortTime } from '@/lib/format-time';

export function MonitoringDynamicDetailPage() {
  const { id = '' } = useParams();
  const detailQuery = useDynamicDetailQuery(id);
  const metricsQuery = useDynamicMetricsDetailQuery(id);

  if (detailQuery.isLoading) return <LoadingListSkeleton rows={4} />;
  if (detailQuery.isError) {
    return (
      <ErrorState
        title="无法加载动态"
        message={detailQuery.error instanceof Error ? detailQuery.error.message : '加载失败'}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <ErrorState title="未找到动态" message={`不存在动态 ${id}`} />;
  }

  const d = detailQuery.data;
  const latest = newestMetricPoint(metricsQuery.data?.items ?? []);

  return (
    <MonitoringDetailLayout
      title={d.dynamicId}
      description="动态互动指标趋势"
      entityLabel={d.dynamicId}
      backTo="/monitoring?tab=dynamics"
      status={
        d.deletedAt ? (
          <Badge variant="destructive">已删除</Badge>
        ) : d.archivedAt ? (
          <Badge variant="warning">已归档</Badge>
        ) : null
      }
      meta={[
        { label: '动态 ID', value: d.dynamicId },
        { label: 'UP MID', value: d.mid ?? '—' },
        { label: '分类', value: d.category ?? '未分类' },
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
          label: '最新点赞',
          value: latest ? formatUnknownMetric(latest.likeCount) : '—',
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
          <MetricCharts kind="dynamic" points={metricsQuery.data?.items ?? []} />
        )
      }
    />
  );
}
