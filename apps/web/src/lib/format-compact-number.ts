export type CompactNumberInput = string | number | bigint | null | undefined;

function parseNumeric(input: CompactNumberInput): number | null {
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
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** 中文紧凑数值（千 / 万 / 亿），卡片与轴标签使用 */
export function formatCompactNumber(
  input: CompactNumberInput,
  options?: { signed?: boolean },
): string {
  const n = parseNumeric(input);
  if (n === null) return '—';
  const sign = options?.signed && n > 0 ? '+' : n < 0 ? '-' : '';
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${sign}${trimDecimal(abs / 1e8)}亿`;
  if (abs >= 1e4) return `${sign}${trimDecimal(abs / 1e4)}万`;
  if (abs >= 1e3) return `${sign}${trimDecimal(abs / 1e3)}千`;
  if (Number.isInteger(n)) return `${n}`;
  return `${sign}${trimDecimal(abs)}`;
}

function trimDecimal(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1).replace(/\.0$/, '');
}

/** tooltip 等场景：保留分组与原始精度 */
export function formatExactNumber(input: CompactNumberInput): string {
  const n = parseNumeric(input);
  if (n === null) return '—';
  if (Number.isInteger(n)) {
    return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(n);
  }
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(n);
}

/**
 * 在线观看「1000+」这类下界：页面上写成「1千+」，不再出现「下界」。
 * 只去掉展示用的末尾加号，不改传入的原始字符串。
 */
export function formatMetricCount(
  value: string | null | undefined,
  rawLower?: string | null,
): string {
  if (rawLower) {
    const trimmed = rawLower.trim();
    const numeric = trimmed.replace(/\+$/, '');
    const compact = formatCompactNumber(numeric);
    return trimmed.includes('+') ? `${compact}+` : compact;
  }
  if (value === null || value === undefined) return '—';
  return formatCompactNumber(value);
}

/** 播放量展示：不得传入 onlineViewersRaw，避免与在线下界串值 */
export function formatViewCountDisplay(viewCount: string | null | undefined): string {
  return formatMetricCount(viewCount);
}

/** 在线观看人数（含 1000+ 下界） */
export function formatOnlineViewersDisplay(
  onlineViewers: string | null | undefined,
  onlineViewersRaw: string | null | undefined,
): string {
  return formatMetricCount(onlineViewers, onlineViewersRaw);
}

export function formatUnknownMetric(value: string | null | undefined): string {
  if (value === null || value === undefined) return '还没有';
  return formatCompactNumber(value);
}
