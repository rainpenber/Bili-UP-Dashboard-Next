/** 图表「播放(千次)」轴与 tooltip 括号内缩放值；输入为 viewCount / 1000，不是原始播放量 */

function formatDecimalTrimmed(abs: number, maxDecimals: number): string {
  const s = abs.toFixed(maxDecimals).replace(/\.?0+$/, '');
  return s === '' ? '0' : s;
}

export function formatViewCountThousandsUnit(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '0';

  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs < 1) {
    const rounded = Math.round(value * 1000) / 1000;
    return `${sign}${formatDecimalTrimmed(Math.abs(rounded), 3)}`;
  }

  if (abs >= 1e4) {
    return `${sign}${formatDecimalTrimmed(abs / 1e4, 2)}万`;
  }

  if (Math.abs(value - Math.round(value)) < 1e-9) {
    return `${sign}${String(Math.round(abs))}`;
  }

  return `${sign}${formatDecimalTrimmed(abs, 2)}`;
}

/** 由原始播放量生成 tooltip / 轴用的千次说明 */
export function formatViewCountThousandsFromRaw(rawViewCount: number | null | undefined): string {
  if (rawViewCount === null || rawViewCount === undefined || !Number.isFinite(rawViewCount)) {
    return '—';
  }
  return formatViewCountThousandsUnit(rawViewCount / 1000);
}
