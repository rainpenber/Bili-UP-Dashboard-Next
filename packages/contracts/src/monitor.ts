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
  /** True when dynamics.pinned_at is set. */
  pinned: boolean;
  /** Joined from monitor_targets (type=dynamic). Null when unmonitored. */
  target: DynamicTargetRef | null;
  /** metadata.author_name when present. */
  authorName: string | null;
  /** metadata.published_at when present (ISO). */
  publishedAt: string | null;
  /** Truncated metadata.text / title summary; null when empty. */
  textSummary: string | null;
  /** monitor_targets.label when a dynamic target exists. */
  targetLabel: string | null;
  /** Prefer author+summary, then target label, never prefer bare id when alternatives exist. */
  displayTitle: string;
  latestMetrics: {
    sampledAt: string | null;
    likeCount: BigIntString | null;
    repostCount: BigIntString | null;
    commentCount: BigIntString | null;
  };
};

/** Dynamic list sort (GET /dynamics). Always pinned-first on the server. */
export const MONITOR_DYNAMIC_SORTS = ['sampled_desc', 'likes_desc', 'comments_desc'] as const;
export type MonitorDynamicSort = (typeof MONITOR_DYNAMIC_SORTS)[number];
export const DEFAULT_MONITOR_DYNAMIC_SORT: MonitorDynamicSort = 'sampled_desc';

export type DynamicListQuery = {
  page: number;
  pageSize: number;
  status: 'all' | 'active' | 'archived' | 'deleted';
  sort: MonitorDynamicSort;
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
  /** videos.pubdate when known. */
  pubdate: string | null;
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

/** Default capped window when `all` is not set. */
export const MONITOR_DEFAULT_METRICS_LIMIT = 500;
/** Hard cap when `all=1` or an explicit high limit is requested (WP-R2-27A). */
export const MONITOR_MAX_METRICS_LIMIT = 20000;
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

/**
 * Parse metrics limit. Default 500.
 * When `all` is true (query `all=1` / `true`), returns the hard cap so callers
 * can fetch the full series without server-side downsampling.
 */
export function parseMetricsLimit(raw: string | undefined, options?: { all?: boolean }): number {
  if (options?.all) return MONITOR_MAX_METRICS_LIMIT;
  const n = Number(raw ?? MONITOR_DEFAULT_METRICS_LIMIT);
  if (!Number.isFinite(n) || n < 1) throw new Error('invalid limit');
  return Math.min(MONITOR_MAX_METRICS_LIMIT, Math.floor(n));
}

/** True for `all=1` / `true` / `yes` (case-insensitive). */
export function parseMetricsAllFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw === null || raw.trim() === '') return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
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

const DYNAMIC_SUMMARY_MAX = 80;

/** Prefer metadata.text; truncate for list/detail titles. */
export function dynamicTextSummaryFromMetadata(
  metadata: Record<string, unknown> | null | undefined,
): string | null {
  if (!metadata) return null;
  const raw = metadata.text;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return null;
  if (trimmed.length <= DYNAMIC_SUMMARY_MAX) return trimmed;
  return `${trimmed.slice(0, DYNAMIC_SUMMARY_MAX)}…`;
}

export function formatDynamicDisplayTitle(input: {
  authorName: string | null | undefined;
  textSummary: string | null | undefined;
  targetLabel: string | null | undefined;
  dynamicId: string;
}): string {
  const author = input.authorName?.trim() || null;
  const summary = input.textSummary?.trim() || null;
  if (author && summary) return `${author} · ${summary}`;
  if (summary) return summary;
  if (author) return author;
  const label = input.targetLabel?.trim() || null;
  if (label && label !== input.dynamicId) return label;
  return input.dynamicId;
}
