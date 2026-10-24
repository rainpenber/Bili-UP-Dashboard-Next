import { FOLLOWER_VIEW_WINDOW_MS } from '@/lib/chart-follower-events';

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
 * Default follower dataZoom: last ~90 days anchored on the latest sample
 * (or domain max when no samples). Slider still spans the full domain.
 * When the domain itself is shorter than 90 days, show everything.
 */
export function defaultFollowerZoomRange(
  domainMinMs: number,
  domainMaxMs: number,
  lastSampleMs: number | null = null,
  windowMs: number = FOLLOWER_VIEW_WINDOW_MS,
): DataZoomRange {
  const span = Math.max(1, domainMaxMs - domainMinMs);
  if (span <= windowMs) return { start: 0, end: 100 };

  const anchor = lastSampleMs != null && Number.isFinite(lastSampleMs) ? lastSampleMs : domainMaxMs;
  const viewStartMs = Math.max(domainMinMs, anchor - windowMs);
  const start = ((viewStartMs - domainMinMs) / span) * 100;
  return { start: Math.max(0, Math.min(100, start)), end: 100 };
}

/**
 * Compatibility wrapper: derive domain from sample / event ISO lists, then
 * apply the 90-day default window.
 */
export function defaultFollowerZoomRangeFromTimes(
  sampledAtList: string[],
  eventPublishedAtList: string[] = [],
  nowMs: number = Date.now(),
): DataZoomRange {
  const sampleTimes = sampledAtList.map((iso) => Date.parse(iso)).filter((t) => Number.isFinite(t));
  const eventTimes = eventPublishedAtList
    .map((iso) => Date.parse(iso))
    .filter((t) => Number.isFinite(t));
  const candidatesMin = [...sampleTimes, ...eventTimes];
  const candidatesMax = [...sampleTimes, ...eventTimes, nowMs];
  if (candidatesMin.length === 0) return { start: 0, end: 100 };
  const domainMinMs = Math.min(...candidatesMin);
  const domainMaxMs = Math.max(...candidatesMax, domainMinMs);
  const lastSampleMs = sampleTimes.length > 0 ? Math.max(...sampleTimes) : null;
  return defaultFollowerZoomRange(domainMinMs, domainMaxMs, lastSampleMs);
}

export function dataZoomRangeForIndices(length: number, startIndex: number): DataZoomRange {
  if (length <= 0) return { start: 0, end: 100 };
  const start = Math.max(0, Math.min(100, (startIndex / length) * 100));
  return { start, end: 100 };
}
