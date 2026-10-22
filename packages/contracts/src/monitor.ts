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
  tid: number | null;
  tidV2: number | null;
  partitionName: string | null;
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

/** Active monitor_targets row for a dynamic, when one exists. */
export type DynamicTargetRef = {
  id: string;
  enabled: boolean;
  intervalMinutes: number;
  intervalMode: 'auto' | 'fixed';
  lastSuccessAt: string | null;
  lastError: string | null;
};

export type DynamicListItem = {
  dynamicId: string;
  mid: BigIntString | null;
  category: string | null;
  monitoringEnabled: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  /** Joined from monitor_targets (type=dynamic). Null when unmonitored. */
  target: DynamicTargetRef | null;
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

/** Author embedded on a video detail. Null on the video when `videos.mid` is null. */
export type VideoCreatorSummary = {
  mid: BigIntString;
  uname: string | null;
  faceAssetId: string | null;
  followerLatest: BigIntString | null;
  followerSampledAt: string | null;
  monitoringEnabled: boolean;
};

export type VideoDetail = {
  bvid: string;
  title: string | null;
  category: string | null;
  mid: BigIntString | null;
  monitoringEnabled: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  coverAssetId: string | null;
  tid: number | null;
  tidV2: number | null;
  partitionName: string | null;
  metadata: Record<string, unknown>;
  creator: VideoCreatorSummary | null;
};

/** Newest video_metric_samples row for one of a creator's videos. Null when none exist. */
export type CreatorVideoLatest = {
  sampledAt: string;
  viewCount: BigIntString | null;
  likeCount: BigIntString | null;
  commentCount: BigIntString | null;
  onlineViewers: BigIntString | null;
};

export type CreatorVideoItem = {
  bvid: string;
  title: string | null;
  coverAssetId: string | null;
  pubdate: string | null;
  partitionName: string | null;
  archivedAt: string | null;
  latest: CreatorVideoLatest | null;
};

export type CreatorVideoList = {
  mid: BigIntString;
  total: number;
  items: CreatorVideoItem[];
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
export const MONITOR_CREATOR_VIDEOS_DEFAULT_LIMIT = 20;
export const MONITOR_CREATOR_VIDEOS_MAX_LIMIT = 100;

const POSTGRES_BIGINT_MAX = 9223372036854775807n;

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

export function parseCreatorVideosLimit(raw: string | undefined): number {
  const n = Number(raw ?? MONITOR_CREATOR_VIDEOS_DEFAULT_LIMIT);
  if (!Number.isFinite(n) || n < 1) throw new Error('invalid limit');
  return Math.min(MONITOR_CREATOR_VIDEOS_MAX_LIMIT, Math.floor(n));
}

export function parseCreatorVideosOffset(raw: string | undefined): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error('invalid offset');
  return Math.floor(n);
}

/** Creator mids are PostgreSQL bigint. Reject blank, non-digits, and overflow. */
export function parseCreatorMid(raw: string): string {
  if (!/^\d+$/.test(raw)) throw new Error('invalid mid');
  const value = BigInt(raw);
  if (value > POSTGRES_BIGINT_MAX) throw new Error('invalid mid');
  return value.toString();
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
