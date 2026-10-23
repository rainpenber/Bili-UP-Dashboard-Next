import { formatShanghaiDateTime } from '@/lib/format-time';

/** Default publish-event window on the follower chart (real dates, not sample snap). */
export const FOLLOWER_EVENT_WINDOW_DAYS = 90;
export const FOLLOWER_EVENT_WINDOW_MS = FOLLOWER_EVENT_WINDOW_DAYS * 86_400_000;

const SHANGHAI = 'Asia/Shanghai';

export type FollowerChartPublishEvent = {
  publishedAt: string;
  eventKind: 'video' | 'dynamic';
  titleSnapshot: string;
  externalId: string;
  navigable: boolean;
  monitoredTargetId: string | null;
};

export type FollowerEventDayBucket = {
  /** Asia/Shanghai calendar day YYYY-MM-DD */
  dayKey: string;
  /** Earliest publish instant that day — scatter x */
  xMs: number;
  /** Tooltip lines: `2026-08-28 13:29 发了动态《…》` */
  labels: string[];
  navigableExternalId: string | null;
};

/** Asia/Shanghai calendar day key for same-day aggregation. */
export function shanghaiCalendarDayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SHANGHAI,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

/** `YYYY-MM-DD HH:mm` in Asia/Shanghai (no seconds) for event tooltips. */
export function formatShanghaiDateMinute(iso: string): string {
  const full = formatShanghaiDateTime(iso);
  // formatShanghaiDateTime → `YYYY-MM-DD HH:mm:ss`
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(full)) {
    return full.slice(0, 16);
  }
  return full;
}

export function eventLabelLine(event: FollowerChartPublishEvent): string {
  const title = event.titleSnapshot?.trim() || event.externalId;
  const kind = event.eventKind === 'video' ? `发布了视频《${title}》` : `发了动态《${title}》`;
  return `${formatShanghaiDateMinute(event.publishedAt)} ${kind}`;
}

export type EventWindowPartition<T extends { publishedAt: string }> = {
  inWindow: T[];
  olderCount: number;
  windowStartMs: number;
};

/** Keep events with publishedAt >= now - windowDays; count the rest (not silently dropped). */
export function partitionEventsByWindow<T extends { publishedAt: string }>(
  events: T[],
  nowMs: number,
  windowMs: number = FOLLOWER_EVENT_WINDOW_MS,
): EventWindowPartition<T> {
  const windowStartMs = nowMs - windowMs;
  const inWindow: T[] = [];
  let olderCount = 0;
  for (const event of events) {
    const t = Date.parse(event.publishedAt);
    if (!Number.isFinite(t)) continue;
    if (t >= windowStartMs) inWindow.push(event);
    else olderCount += 1;
  }
  return { inWindow, olderCount, windowStartMs };
}

/**
 * Aggregate overlapping publish markers by Asia/Shanghai calendar day.
 * X position is the earliest publishedAt that day (real date — never snapped to samples).
 */
export function aggregateFollowerEventsByDay(
  events: FollowerChartPublishEvent[],
): Map<string, FollowerEventDayBucket> {
  const buckets = new Map<string, FollowerEventDayBucket>();
  const ordered = [...events].sort((a, b) => Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  for (const event of ordered) {
    const dayKey = shanghaiCalendarDayKey(event.publishedAt);
    const xMs = Date.parse(event.publishedAt);
    if (!dayKey || !Number.isFinite(xMs)) continue;
    const existing = buckets.get(dayKey) ?? {
      dayKey,
      xMs,
      labels: [],
      navigableExternalId: null,
    };
    existing.xMs = Math.min(existing.xMs, xMs);
    existing.labels.push(eventLabelLine(event));
    if (event.navigable && event.externalId && !existing.navigableExternalId) {
      existing.navigableExternalId = event.externalId;
    }
    buckets.set(dayKey, existing);
  }
  return buckets;
}

/** Closest sample on the same Shanghai day; null when that day has no sample. */
export function followerSampleOnDay(
  dayKey: string,
  sampledAtList: string[],
  followers: (number | null)[],
  aroundMs: number,
): number | null {
  let best: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < sampledAtList.length; i += 1) {
    const iso = sampledAtList[i]!;
    if (shanghaiCalendarDayKey(iso) !== dayKey) continue;
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) continue;
    const fans = followers[i];
    if (fans == null) continue;
    const dist = Math.abs(t - aroundMs);
    if (dist < bestDist) {
      bestDist = dist;
      best = fans;
    }
  }
  return best;
}

export type FollowerTimeDomain = {
  minMs: number;
  maxMs: number;
};

/**
 * X domain: left at earliest in-window event (or sample), right at today / latest point.
 * Does not extend left into empty pre-event space before the first in-window event date.
 */
export function buildFollowerTimeDomain(args: {
  sampleTimesMs: number[];
  eventTimesMs: number[];
  nowMs: number;
  windowStartMs: number;
}): FollowerTimeDomain {
  const { sampleTimesMs, eventTimesMs, nowMs, windowStartMs } = args;
  const samplesInWindow = sampleTimesMs.filter((t) => t >= windowStartMs);
  const candidatesMin = [...eventTimesMs, ...samplesInWindow];
  const candidatesMax = [...eventTimesMs, ...sampleTimesMs, nowMs];
  const minMs =
    candidatesMin.length > 0 ? Math.min(...candidatesMin) : Math.min(windowStartMs, nowMs);
  const maxMs = Math.max(...candidatesMax, minMs);
  return { minMs, maxMs };
}
