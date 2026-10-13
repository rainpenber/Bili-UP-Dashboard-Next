const PADDING = 300;

export function parseSeriesNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 粉丝等非负指标纵轴：可见窗口 min-300 ~ max+300，下界不低于 0 */
export function followerYAxisBounds(
  values: unknown[],
  options?: { nonNegative?: boolean },
): { min: number; max: number } | undefined {
  const nums = values.map(parseSeriesNumber).filter((v): v is number => v !== null);
  if (nums.length === 0) return undefined;

  const minVal = Math.min(...nums);
  const maxVal = Math.max(...nums);
  let min = minVal - PADDING;
  let max = maxVal + PADDING;

  if (options?.nonNegative !== false) {
    min = Math.max(0, min);
  }

  if (max <= min) {
    max = min + PADDING * 2;
  }

  return { min, max };
}
