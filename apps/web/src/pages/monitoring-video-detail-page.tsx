import { newestMetricPoint } from '@studio/contracts';
import { useParams, useSearchParams } from 'react-router-dom';
import { useMonitorCardQuery } from '@/api/hooks/use-monitor-card-queries';
import { useVideoDetailQuery, useVideoMetricsDetailQuery } from '@/api/hooks/use-monitor-queries';
import { coverAssetUrl } from '@/api/monitor-client';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { MetricCharts } from '@/features/monitoring/MetricCharts';
import { MonitorCardControls } from '@/features/monitoring/monitor-object-card';
import { detailReturnHref } from '@/features/monitoring/monitor-url-state';
import { MonitoringDetailLayout } from '@/features/monitoring/monitoring-detail-layout';
import { VideoAuthorPanel } from '@/features/monitoring/video-author-panel';
import {
  formatOnlineViewersDisplay,
  formatUnknownMetric,
  formatViewCountDisplay,
} from '@/lib/format-compact-number';
import { formatFullLocalTime, formatShortTime } from '@/lib/format-time';

function missingEntity(error: unknown): boolean {
  return (
    error instanceof Error && (error.message === 'not found' || error.message.includes('未找到'))
  );
}

export function MonitoringVideoDetailPage() {
  const { bvid = '' } = useParams();
  const [params] = useSearchParams();
  const listQuery = params.get('from') ?? '';
  const backTo = detailReturnHref('videos', listQuery || null);
  const detailQuery = useVideoDetailQuery(bvid);
  const cardQuery = useMonitorCardQuery('video', bvid);
  const metricsQuery = useVideoMetricsDetailQuery(bvid, Boolean(detailQuery.data));
  const monitorFooter = cardQuery.isLoading ? (
    <LoadingListSkeleton rows={1} />
  ) : cardQuery.isError ? (
    <ErrorState
      title="监控状态加载失败"
      message={cardQuery.error instanceof Error ? cardQuery.error.message : '加载失败'}
      onRetry={() => void cardQuery.refetch()}
    />
  ) : cardQuery.data ? (
    <MonitorCardControls card={cardQuery.data} listQuery={listQuery} includeDetailLink={false} />
  ) : null;

  if (detailQuery.isLoading || (detailQuery.isError && cardQuery.isLoading)) {
    return <LoadingListSkeleton rows={4} />;
  }
  if (missingEntity(detailQuery.error) && cardQuery.data && !cardQuery.data.hasEntity) {
    const card = cardQuery.data;
    return (
      <MonitoringDetailLayout
        testId="video-detail-page"
        title={card.displayName}
        description="该监控目标还没有视频实体或采样"
        entityLabel={card.externalId}
        backTo={backTo}
        meta={[
          { label: 'BV 号', value: card.externalId },
          { label: '采样', value: '尚无采集数据' },
        ]}
        charts={<p className="text-sm text-muted-foreground">尚无采集数据</p>}
        footer={monitorFooter}
      />
    );
  }
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
      backTo={backTo}
      footer={monitorFooter}
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
