const MS_30_DAYS = 30 * 86_400_000;

export type DataZoomRange = { start: number; end: number };

/** 基于 ISO 时间序列计算默认 dataZoom（最后 30 天），不丢弃数据 */
export function defaultDataZoomRange(sampledAtList: string[]): DataZoomRange {
  const n = sampledAtList.length;
  if (n <= 1) return { start: 0, end: 100 };

  const lastIso = sampledAtList[n - 1]!;
  const lastMs = new Date(lastIso).getTime();
  if (Number.isNaN(lastMs)) return { start: 0, end: 100 };

  const cutoff = lastMs - MS_30_DAYS;
  let startIndex = 0;
  for (let i = 0; i < n; i++) {
    const ms = new Date(sampledAtList[i]!).getTime();
    if (!Number.isNaN(ms) && ms >= cutoff) {
      startIndex = i;
      break;
    }
  }

  if (startIndex === 0) return { start: 0, end: 100 };

  const start = (startIndex / n) * 100;
  return { start, end: 100 };
}

/**
 * Expand the default follower zoom so publish-event markers stay inside the visible window.
 * Events snap to nearest samples; zoom must include those sample indices.
 */
export function defaultFollowerZoomRange(
  sampledAtList: string[],
  eventPublishedAtList: string[],
): DataZoomRange {
  const base = defaultDataZoomRange(sampledAtList);
  if (sampledAtList.length <= 1 || eventPublishedAtList.length === 0) return base;
  let earliestIdx = sampledAtList.length - 1;
  for (const publishedAt of eventPublishedAtList) {
    const target = Date.parse(publishedAt);
    if (!Number.isFinite(target)) continue;
    let best = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < sampledAtList.length; i += 1) {
      const t = Date.parse(sampledAtList[i]!);
      if (!Number.isFinite(t)) continue;
      const dist = Math.abs(t - target);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    }
    earliestIdx = Math.min(earliestIdx, best);
  }
  const eventStart = (earliestIdx / sampledAtList.length) * 100;
  return { start: Math.min(base.start, eventStart), end: 100 };
}

export function dataZoomRangeForIndices(length: number, startIndex: number): DataZoomRange {
  if (length <= 0) return { start: 0, end: 100 };
  const start = Math.max(0, Math.min(100, (startIndex / length) * 100));
  return { start, end: 100 };
}
