import { formatShanghaiDateTime } from '@/lib/format-time';

/** Default dataZoom window on the follower chart (last N days from last sample). */
export const FOLLOWER_VIEW_WINDOW_DAYS = 90;
export const FOLLOWER_VIEW_WINDOW_MS = FOLLOWER_VIEW_WINDOW_DAYS * 86_400_000;

/** @deprecated Prefer FOLLOWER_VIEW_WINDOW_DAYS — kept for call-site compatibility. */
export const FOLLOWER_EVENT_WINDOW_DAYS = FOLLOWER_VIEW_WINDOW_DAYS;
/** @deprecated Prefer FOLLOWER_VIEW_WINDOW_MS. */
export const FOLLOWER_EVENT_WINDOW_MS = FOLLOWER_VIEW_WINDOW_MS;

const SHANGHAI = 'Asia/Shanghai';
const SHANGHAI_DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: SHANGHAI,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export type FollowerChartPublishEvent = {
  publishedAt: string;
  eventKind: 'video' | 'dynamic';
  titleSnapshot: string;
  externalId: string;
  navigable: boolean;
  monitoredTargetId: string | null;
  /** Same-origin cover URL for video tooltips; null → icon placeholder. */
  coverProxyUrl?: string | null;
};

export type FollowerEventTooltipItem = {
  publishedAt: string;
  eventKind: 'video' | 'dynamic';
  titleSnapshot: string;
  externalId: string;
  coverProxyUrl: string | null;
  /** SPA path when the tooltip / marker is clickable; null when unbound. */
  navHref: string | null;
  label: string;
};

export type FollowerEventDayBucket = {
  /** Asia/Shanghai calendar day YYYY-MM-DD */
  dayKey: string;
  /** Earliest publish instant that day — scatter x */
  xMs: number;
  /** Tooltip lines: `2026-08-28 13:29 发了动态《…》` */
  labels: string[];
  items: FollowerEventTooltipItem[];
  navigableExternalId: string | null;
  /** Preferred navigation target for the day marker / tooltip. */
  navHref: string | null;
};

/** Asia/Shanghai calendar day key for same-day aggregation. */
export function shanghaiCalendarDayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = SHANGHAI_DAY_FORMATTER.formatToParts(d);
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

/** Resolve SPA href for a publish event; null when there is no bound detail object. */
export function followerEventNavHref(event: FollowerChartPublishEvent): string | null {
  if (!event.externalId) return null;
  if (event.eventKind === 'dynamic') {
    return `/monitoring/dynamics/${encodeURIComponent(event.externalId)}`;
  }
  // Videos only when monitored (navigable); unmonitored uploads have no detail page.
  if (event.navigable) {
    return `/monitoring/videos/${encodeURIComponent(event.externalId)}`;
  }
  return null;
}

export type EventWindowPartition<T extends { publishedAt: string }> = {
  inWindow: T[];
  olderCount: number;
  windowStartMs: number;
};

/**
 * Keep events with publishedAt >= now - windowDays; count the rest (not silently dropped).
 * @deprecated Prefer partitionEventsBySampleRange / showAllEvents — kept for unit tests.
 */
export function partitionEventsByWindow<T extends { publishedAt: string }>(
  events: T[],
  nowMs: number,
  windowMs: number = FOLLOWER_VIEW_WINDOW_MS,
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

export type SampleRangePartition<T extends { publishedAt: string }> = {
  inRange: T[];
  outsideCount: number;
};

/**
 * Default chart mode: only events that fall inside the follower-sample time span.
 * When there are no samples, nothing is in-range (toggle 「显示全部事件」 to plot them).
 */
export function partitionEventsBySampleRange<T extends { publishedAt: string }>(
  events: T[],
  sampleTimesMs: number[],
): SampleRangePartition<T> {
  if (sampleTimesMs.length === 0) {
    return { inRange: [], outsideCount: events.length };
  }
  const minS = Math.min(...sampleTimesMs);
  const maxS = Math.max(...sampleTimesMs);
  const inRange: T[] = [];
  let outsideCount = 0;
  for (const event of events) {
    const t = Date.parse(event.publishedAt);
    if (!Number.isFinite(t)) continue;
    if (t >= minS && t <= maxS) inRange.push(event);
    else outsideCount += 1;
  }
  return { inRange, outsideCount };
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
      items: [],
      navigableExternalId: null,
      navHref: null,
    };
    existing.xMs = Math.min(existing.xMs, xMs);
    const label = eventLabelLine(event);
    existing.labels.push(label);
    const navHref = followerEventNavHref(event);
    existing.items.push({
      publishedAt: event.publishedAt,
      eventKind: event.eventKind,
      titleSnapshot: event.titleSnapshot?.trim() || event.externalId,
      externalId: event.externalId,
      coverProxyUrl: event.coverProxyUrl ?? null,
      navHref,
      label,
    });
    if (event.navigable && event.externalId && !existing.navigableExternalId) {
      existing.navigableExternalId = event.externalId;
    }
    // Prefer first video nav, else first dynamic nav.
    if (navHref && !existing.navHref) {
      existing.navHref = navHref;
    } else if (navHref && event.eventKind === 'video' && existing.navHref?.includes('/dynamics/')) {
      existing.navHref = navHref;
      if (event.navigable) existing.navigableExternalId = event.externalId;
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
 * X domain from samples + plotted events.
 * When showAllEvents, earliest event can pull the axis back to 2022/2023;
 * otherwise the domain stays within the sample span (plus in-range events).
 */
export function buildFollowerTimeDomain(args: {
  sampleTimesMs: number[];
  eventTimesMs: number[];
  nowMs: number;
}): FollowerTimeDomain {
  const { sampleTimesMs, eventTimesMs, nowMs } = args;
  const candidatesMin = [...eventTimesMs, ...sampleTimesMs];
  const candidatesMax = [...eventTimesMs, ...sampleTimesMs, nowMs];
  const minMs = candidatesMin.length > 0 ? Math.min(...candidatesMin) : nowMs;
  const maxMs = Math.max(...candidatesMax, minMs);
  return { minMs, maxMs };
}
