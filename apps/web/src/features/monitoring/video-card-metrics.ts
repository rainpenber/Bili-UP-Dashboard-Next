import {
  formatCompactNumber,
  formatExactNumber,
  formatOnlineViewersDisplay,
  formatViewCountDisplay,
  type CompactNumberInput,
} from '@/lib/format-compact-number';

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

/** 生成卡片「播放 / 在线」摘要，两者独立格式化、不串值 */
export function formatVideoCardMetricsSummary(metrics: VideoCardLatestMetrics): string {
  return `播放 ${videoCardPlayText(metrics)} · 在线 ${videoCardOnlineText(metrics)}`;
}

/**
 * 网格卡片播放量：万/千 + 括号精确值，如 `1.4万 (13,631) 播放`。
 * 不足一千只显示精确值；无法解析时回退「— 播放」。
 */
export function formatVideoGridPlayText(viewCount: CompactNumberInput): string {
  const compact = formatCompactNumber(viewCount);
  if (compact === '—') return '— 播放';
  const exact = formatExactNumber(viewCount);
  if (exact === '—') return '— 播放';
  // 不足一千时 compact 与 exact 等价（无 千/万/亿 后缀），不再叠括号
  if (compact === exact || !/[千万亿]/.test(compact)) {
    return `${exact} 播放`;
  }
  return `${compact} (${exact}) 播放`;
}

/** 网格第二行：播放量；有在线人数时追加 */
export function formatVideoGridMetricsLine(metrics: VideoCardLatestMetrics): string {
  const play = formatVideoGridPlayText(metrics.viewCount);
  const online = videoCardOnlineText(metrics);
  if (!online || online === '—') return play;
  return `${play} · 在线 ${online}`;
}

/** 网格「更新：YYYY-MM-DD HH:mm」；无采样时「暂无」 */
export function formatVideoGridUpdateText(sampledAt: string | null): string {
  if (!sampledAt) return '暂无';
  const date = new Date(sampledAt);
  if (Number.isNaN(date.getTime())) return sampledAt;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
