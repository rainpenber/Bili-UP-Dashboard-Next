import { newestMetricPoint } from '@studio/contracts';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMonitorCardQuery } from '@/api/hooks/use-monitor-card-queries';
import {
  useCreatorDetailQuery,
  useCreatorMetricsDetailQuery,
  useCreatorPublishEventsQuery,
} from '@/api/hooks/use-monitor-queries';
import { coverAssetUrl } from '@/api/monitor-client';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { CreatorVideosSection } from '@/features/monitoring/creator-videos-section';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import { MonitorCardControls } from '@/features/monitoring/monitor-object-card';
import { detailReturnHref } from '@/features/monitoring/monitor-url-state';
import { MonitoringDetailLayout } from '@/features/monitoring/monitoring-detail-layout';
import { formatCompactNumber } from '@/lib/format-compact-number';
import { formatFullLocalTime, formatShortTime } from '@/lib/format-time';

function missingEntity(error: unknown): boolean {
  return (
    error instanceof Error && (error.message === 'not found' || error.message.includes('未找到'))
  );
}

export function MonitoringCreatorDetailPage() {
  const { mid = '' } = useParams();
  const [params] = useSearchParams();
  const listQuery = params.get('from') ?? '';
  const backTo = detailReturnHref('creators', listQuery || null);
  const detailQuery = useCreatorDetailQuery(mid);
  const cardQuery = useMonitorCardQuery('creator', mid);
  const metricsQuery = useCreatorMetricsDetailQuery(mid);
  const publishEventsQuery = useCreatorPublishEventsQuery(mid);
  const monitorToolbar = cardQuery.isLoading ? (
    <LoadingListSkeleton rows={1} />
  ) : cardQuery.isError ? (
    <ErrorState
      title="监控状态加载失败"
      message={cardQuery.error instanceof Error ? cardQuery.error.message : '加载失败'}
      onRetry={() => void cardQuery.refetch()}
    />
  ) : cardQuery.data ? (
    <MonitorCardControls
      card={cardQuery.data}
      listQuery={listQuery}
      includeDetailLink={false}
      layout="detail"
    />
  ) : null;

  if (detailQuery.isLoading || (detailQuery.isError && cardQuery.isLoading)) {
    return <LoadingListSkeleton rows={4} />;
  }
  if (missingEntity(detailQuery.error) && cardQuery.data && !cardQuery.data.hasEntity) {
    const card = cardQuery.data;
    return (
      <MonitoringDetailLayout
        testId="creator-detail-page"
        title={card.displayName}
        description="该监控目标还没有 UP 主实体或采样"
        entityLabel={card.externalId}
        backTo={backTo}
        meta={[
          { label: 'MID', value: card.externalId },
          { label: '采样', value: '尚无采集数据' },
        ]}
        charts={<p className="text-sm text-muted-foreground">尚无采集数据</p>}
        toolbar={monitorToolbar}
      />
    );
  }
  if (detailQuery.isError) {
    return (
      <ErrorState
        title="无法加载 UP 主"
        message={detailQuery.error instanceof Error ? detailQuery.error.message : '加载失败'}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }
  if (!detailQuery.data) {
    return <ErrorState title="未找到 UP 主" message={`不存在 MID ${mid}`} />;
  }

  const c = detailQuery.data;
  const latest = newestMetricPoint(metricsQuery.data?.items ?? []);

  return (
    <MonitoringDetailLayout
      testId="creator-detail-page"
      title={c.uname ?? c.mid}
      description="UP 主粉丝趋势与元数据"
      entityLabel={c.mid}
      toolbar={monitorToolbar}
      footer={<CreatorVideosSection mid={c.mid} />}
      backTo={backTo}
      status={
        c.deletedAt ? (
          <Badge variant="destructive">已删除</Badge>
        ) : c.archivedAt ? (
          <Badge variant="warning">已归档</Badge>
        ) : null
      }
      meta={[
        { label: 'MID', value: c.mid },
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
          label: '最新粉丝',
          value: latest ? formatCompactNumber(latest.followerCount) : '—',
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
          <MetricCharts
            kind="creator"
            points={metricsQuery.data?.items ?? []}
            publishEvents={publishEventsQuery.data?.items ?? []}
          />
        )
      }
    />
  );
}
