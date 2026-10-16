import { useParams } from 'react-router-dom';
import {
  useCreatorDetailQuery,
  useCreatorMetricsDetailQuery,
} from '@/api/hooks/use-monitor-queries';
import { coverAssetUrl } from '@/api/monitor-client';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import { MonitoringDetailLayout } from '@/features/monitoring/monitoring-detail-layout';
import { formatCompactNumber } from '@/lib/format-compact-number';
import { formatFullLocalTime, formatShortTime } from '@/lib/format-time';
import { toUserErrorMessage } from '@/lib/user-facing-error';

export function MonitoringCreatorDetailPage() {
  const { mid = '' } = useParams();
  const detailQuery = useCreatorDetailQuery(mid);
  const metricsQuery = useCreatorMetricsDetailQuery(mid);

  if (detailQuery.isLoading) return <LoadingListSkeleton rows={4} />;
  if (detailQuery.isError) {
    return (
      <ErrorState
        title="UP 主没加载出来"
        message={toUserErrorMessage(detailQuery.error, '没加载出来，请再试一次。')}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <ErrorState title="没有这个 UP 主" message={`没有编号为 ${mid} 的 UP 主。`} />;
  }

  const c = detailQuery.data;
  const latest = metricsQuery.data?.items.at(-1);

  return (
    <MonitoringDetailLayout
      title={c.uname ?? c.mid}
      description="粉丝数怎么变的。"
      chartsTitle="粉丝数变化"
      entityLabel={c.mid}
      backTo="/monitoring?tab=creators"
      status={
        c.deletedAt ? (
          <Badge variant="destructive">已删除</Badge>
        ) : c.archivedAt ? (
          <Badge variant="warning">已存档</Badge>
        ) : null
      }
      meta={[
        { label: '编号', value: c.mid },
        { label: '昵称', value: c.uname ?? '—' },
        { label: '分类', value: c.category ?? '未分类' },
        {
          label: '头像',
          value: (
            <img
              src={coverAssetUrl(c.faceAssetId)}
              alt=""
              className="size-16 rounded-full border object-cover"
              width={64}
              height={64}
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
          label: '粉丝数',
          value: latest ? formatCompactNumber(latest.followerCount) : '—',
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
          <MetricCharts kind="creator" points={metricsQuery.data?.items ?? []} />
        )
      }
    />
  );
}
