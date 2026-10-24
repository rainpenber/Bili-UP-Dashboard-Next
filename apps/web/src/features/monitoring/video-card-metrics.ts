import {
  formatCompactNumber,
  formatExactNumber,
  type CompactNumberInput,
} from '@/lib/format-compact-number';

/** 监控列表视频卡片 `latestMetrics` 展示所需字段 */
export type VideoCardLatestMetrics = {
  viewCount: string | null;
  onlineViewers: string | null;
  onlineViewersRaw: string | null;
};

function parseOnlineSample(input: CompactNumberInput): number | null {
  if (input === null || input === undefined) return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    return input;
  }
  if (typeof input === 'bigint') {
    const asNumber = Number(input);
    return Number.isFinite(asNumber) ? asNumber : null;
  }
  const trimmed = input.trim();
  if (trimmed === '') return null;
  // 仅接受纯数字；「1000+」等下界原文不是峰值样本
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/**
 * 最近窗口内峰值在线人数。
 * 无有效数值样本时返回 null（卡片显示「无在线数据」，不要用 0 占位）。
 */
export function peakOnlineFromSamples(samples: ReadonlyArray<CompactNumberInput>): number | null {
  let peak: number | null = null;
  for (const sample of samples) {
    const n = parseOnlineSample(sample);
    if (n === null) continue;
    if (peak === null || n > peak) peak = n;
  }
  return peak;
}

export function videoCardPlayText(metrics: VideoCardLatestMetrics): string {
  return formatCompactNumber(metrics.viewCount);
}

/**
 * 卡片在线文案：取样本峰值；无样本 →「无在线数据」。
 * 与详情页图表口径不同：卡片=窗口峰值，图表=逐点（可含下界原文）。
 */
export function videoCardOnlineText(
  metrics: VideoCardLatestMetrics,
  onlineSamples?: ReadonlyArray<CompactNumberInput>,
): string {
  const samples = onlineSamples ?? [metrics.onlineViewers];
  const peak = peakOnlineFromSamples(samples);
  if (peak === null) return '无在线数据';
  return formatCompactNumber(peak);
}

/** 生成卡片「播放 / 峰值在线」摘要 */
export function formatVideoCardMetricsSummary(
  metrics: VideoCardLatestMetrics,
  onlineSamples?: ReadonlyArray<CompactNumberInput>,
): string {
  const online = videoCardOnlineText(metrics, onlineSamples);
  if (online === '无在线数据') {
    return `播放 ${videoCardPlayText(metrics)} · 无在线数据`;
  }
  return `播放 ${videoCardPlayText(metrics)} · 峰值在线 ${online}`;
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

/** 网格第二行：播放量；有峰值在线时追加，无样本显示「无在线数据」 */
export function formatVideoGridMetricsLine(
  metrics: VideoCardLatestMetrics,
  onlineSamples?: ReadonlyArray<CompactNumberInput>,
): string {
  const play = formatVideoGridPlayText(metrics.viewCount);
  const online = videoCardOnlineText(metrics, onlineSamples);
  if (online === '无在线数据') return `${play} · 无在线数据`;
  return `${play} · 峰值在线 ${online}`;
}

/** 网格「更新：YYYY-MM-DD HH:mm」；无采样时「暂无」 */
export function formatVideoGridUpdateText(sampledAt: string | null): string {
  if (!sampledAt) return '暂无';
  const date = new Date(sampledAt);
  if (Number.isNaN(date.getTime())) return sampledAt;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
