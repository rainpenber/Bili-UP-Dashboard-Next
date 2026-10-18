export type BigIntString = string;

export type PaginationMeta = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
};

export type VideoListItem = {
  bvid: string;
  title: string | null;
  category: string | null;
  mid: BigIntString | null;
  monitoringEnabled: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  coverAssetId: string | null;
  latestMetrics: {
    sampledAt: string | null;
    viewCount: BigIntString | null;
    onlineViewers: BigIntString | null;
    onlineViewersRaw: string | null;
    likeCount: BigIntString | null;
  };
};

export type CreatorListItem = {
  mid: BigIntString;
  uname: string | null;
  category: string | null;
  monitoringEnabled: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  faceAssetId: string | null;
  latestMetrics: {
    sampledAt: string | null;
    followerCount: BigIntString | null;
  };
};

export type DynamicListItem = {
  dynamicId: string;
  mid: BigIntString | null;
  category: string | null;
  monitoringEnabled: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  latestMetrics: {
    sampledAt: string | null;
    likeCount: BigIntString | null;
    repostCount: BigIntString | null;
    commentCount: BigIntString | null;
  };
};

export type Paginated<T> = PaginationMeta & { items: T[] };

export type VideoMetricPoint = {
  sampledAt: string;
  rawTime: string;
  sourceTimezone: string;
  timestampPrecision: 'minute' | 'second';
  viewCount: BigIntString | null;
  onlineViewers: BigIntString | null;
  onlineViewersRaw: string | null;
  likeCount: BigIntString | null;
  coinCount: BigIntString | null;
  favoriteCount: BigIntString | null;
  shareCount: BigIntString | null;
  danmakuCount: BigIntString | null;
  commentCount: BigIntString | null;
};

export type CreatorMetricPoint = {
  sampledAt: string;
  rawTime: string;
  sourceTimezone: string;
  timestampPrecision: 'minute' | 'second';
  followerCount: BigIntString;
};

export type DynamicMetricPoint = {
  sampledAt: string;
  rawTime: string;
  sourceTimezone: string;
  timestampPrecision: 'minute' | 'second';
  likeCount: BigIntString | null;
  repostCount: BigIntString | null;
  commentCount: BigIntString | null;
};

export const MONITOR_MAX_METRICS_LIMIT = 2000;
export const MONITOR_DEFAULT_PAGE_SIZE = 8;
export const MONITOR_MAX_PAGE_SIZE = 50;

export function bigintToJson(value: bigint | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

export function parseMonitorPage(raw: string | undefined, fallback = 1): number {
  const n = Number(raw ?? fallback);
  if (!Number.isFinite(n) || n < 1) throw new Error('invalid page');
  return Math.floor(n);
}

export function parseMonitorPageSize(raw: string | undefined): number {
  const n = Number(raw ?? MONITOR_DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(n) || n < 1) throw new Error('invalid pageSize');
  return Math.min(MONITOR_MAX_PAGE_SIZE, Math.floor(n));
}

export function parseMetricsLimit(raw: string | undefined): number {
  const n = Number(raw ?? 500);
  if (!Number.isFinite(n) || n < 1) throw new Error('invalid limit');
  return Math.min(MONITOR_MAX_METRICS_LIMIT, Math.floor(n));
}

/**
 * Newest sample in a metrics payload.
 * Series endpoints return a bounded chronological window whose last point is the
 * newest row matching the filter, not the oldest page of history.
 */
export function newestMetricPoint<T extends { sampledAt: string }>(
  points: readonly T[],
): T | undefined {
  let newest: T | undefined;
  let newestMs = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    const ms = Date.parse(point.sampledAt);
    if (Number.isNaN(ms)) continue;
    if (!newest || ms >= newestMs) {
      newest = point;
      newestMs = ms;
    }
  }
  return newest;
}

export function parseIsoDateParam(raw: string | undefined, name: string): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid ${name}`);
  return d;
}
