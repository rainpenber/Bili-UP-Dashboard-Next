import { formatOnlineViewersDisplay, formatViewCountDisplay } from '@/lib/format-compact-number';

/** 监控列表视频卡片 `latestMetrics` 展示所需字段 */
export type VideoCardLatestMetrics = {
  viewCount: string | null;
  onlineViewers: string | null;
  onlineViewersRaw: string | null;
};

export function videoCardPlayText(metrics: VideoCardLatestMetrics): string {
  return formatViewCountDisplay(metrics.viewCount);
}

export function videoCardOnlineText(metrics: VideoCardLatestMetrics): string {
  return formatOnlineViewersDisplay(metrics.onlineViewers, metrics.onlineViewersRaw);
}

/** 生成卡片「播放量 / 在线观看」摘要，两者独立格式化、不串值 */
export function formatVideoCardMetricsSummary(metrics: VideoCardLatestMetrics): string {
  return `播放量 ${videoCardPlayText(metrics)} · 在线观看 ${videoCardOnlineText(metrics)}`;
}
