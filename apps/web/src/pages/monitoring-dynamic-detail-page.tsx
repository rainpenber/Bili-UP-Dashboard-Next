import { newestMetricPoint, type DynamicTargetRef } from '@studio/contracts';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  useDynamicDetailQuery,
  useDynamicMetricsDetailQuery,
} from '@/api/hooks/use-monitor-queries';
import { useMonitorTargetByIdentityQuery } from '@/api/hooks/use-monitor-target-queries';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { DynamicMonitorControls } from '@/features/monitoring/dynamic-monitor-controls';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import { detailReturnHref } from '@/features/monitoring/monitor-url-state';
import { MonitoringDetailLayout } from '@/features/monitoring/monitoring-detail-layout';
import { formatUnknownMetric } from '@/lib/format-compact-number';
import { formatFullLocalTime, formatShortTime } from '@/lib/format-time';

function toTargetRef(
  target: {
    id: string;
    enabled: boolean;
    intervalMinutes: number;
    intervalMode: 'auto' | 'fixed';
    lastSuccessAt: string | null;
    lastError: string | null;
  } | null,
): DynamicTargetRef | null {
  if (!target) return null;
  return {
    id: target.id,
    enabled: target.enabled,
    intervalMinutes: target.intervalMinutes,
    intervalMode: target.intervalMode,
    lastSuccessAt: target.lastSuccessAt,
    lastError: target.lastError,
  };
}

export function MonitoringDynamicDetailPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const listQuery = params.get('from') ?? '';
  const backTo = detailReturnHref('dynamics', listQuery || null);
  const detailQuery = useDynamicDetailQuery(id);
  const targetQuery = useMonitorTargetByIdentityQuery('dynamic', id);
  const metricsQuery = useDynamicMetricsDetailQuery(id);

  const target =
    detailQuery.data?.target ?? toTargetRef(targetQuery.data) ?? null;
  const monitorToolbar =
    detailQuery.isLoading && targetQuery.isLoading ? (
      <LoadingListSkeleton rows={1} />
    ) : (
      <DynamicMonitorControls
        dynamicId={id}
        target={target}
        listQuery={listQuery}
        layout="detail"
      />
    );

  if (detailQuery.isLoading && targetQuery.isLoading) {
    return <LoadingListSkeleton rows={4} />;
  }

  if (detailQuery.isError && !target) {
    const missing =
      detailQuery.error instanceof Error &&
      (detailQuery.error.message === 'not found' || detailQuery.error.message.includes('未找到'));
    if (missing && targetQuery.isSuccess && targetQuery.data == null) {
      return <ErrorState title="未找到动态" message={`不存在动态 ${id}`} />;
    }
    if (!missing) {
      return (
        <ErrorState
          title="无法加载动态"
          message={detailQuery.error instanceof Error ? detailQuery.error.message : '加载失败'}
          onRetry={() => void detailQuery.refetch()}
        />
      );
    }
  }

  if (!detailQuery.data && target) {
    return (
      <MonitoringDetailLayout
        testId="dynamic-detail-page"
        title={id}
        description="该监控目标还没有动态实体或采样"
        entityLabel={id}
        backTo={backTo}
        toolbar={monitorToolbar}
        meta={[
          { label: '动态 ID', value: id },
          { label: '采样', value: '尚无采集数据' },
        ]}
        charts={<p className="text-sm text-muted-foreground">尚无采集数据</p>}
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
      testId="dynamic-detail-page"
      title={d.dynamicId}
      description="动态互动指标趋势"
      entityLabel={d.dynamicId}
      backTo={backTo}
      toolbar={monitorToolbar}
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
        {
          label: '转发数',
          value: latest ? formatUnknownMetric(latest.repostCount) : '暂无数据',
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
