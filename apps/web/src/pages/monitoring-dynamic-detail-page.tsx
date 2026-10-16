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
import { toUserErrorMessage } from '@/lib/user-facing-error';

export function MonitoringDynamicDetailPage() {
  const { id = '' } = useParams();
  const detailQuery = useDynamicDetailQuery(id);
  const metricsQuery = useDynamicMetricsDetailQuery(id);

  if (detailQuery.isLoading) return <LoadingListSkeleton rows={4} />;
  if (detailQuery.isError) {
    return (
      <ErrorState
        title="动态没加载出来"
        message={toUserErrorMessage(detailQuery.error, '没加载出来，请再试一次。')}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <ErrorState title="没有这条动态" message={`没有编号为 ${id} 的动态。`} />;
  }

  const d = detailQuery.data;
  const latest = metricsQuery.data?.items.at(-1);

  return (
    <MonitoringDetailLayout
      title={d.dynamicId}
      description="点赞、转发和评论怎么变的。"
      chartsTitle="点赞、转发和评论"
      entityLabel={d.dynamicId}
      backTo="/monitoring?tab=dynamics"
      status={
        d.deletedAt ? (
          <Badge variant="destructive">已删除</Badge>
        ) : d.archivedAt ? (
          <Badge variant="warning">已存档</Badge>
        ) : null
      }
      meta={[
        { label: '编号', value: d.dynamicId },
        { label: 'UP 主编号', value: d.mid ?? '—' },
        { label: '分类', value: d.category ?? '未分类' },
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
          label: '点赞',
          value: latest ? formatUnknownMetric(latest.likeCount) : '—',
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
          <MetricCharts kind="dynamic" points={metricsQuery.data?.items ?? []} />
        )
      }
    />
  );
}
