import type { FileKind } from './types';
import { parseMetricCsvWithStaging } from './metric-parse';

export type MetricRowIssue = {
  kind: 'reject' | 'duplicate' | 'conflict';
  message: string;
  detail?: Record<string, unknown>;
};

export type FollowerSample = {
  mid: bigint;
  sampledAt: Date;
  rawTime: string;
  precision: 'minute' | 'second';
  followerCount: bigint;
};

export type VideoSample = {
  bvid: string;
  sampledAt: Date;
  rawTime: string;
  precision: 'minute' | 'second';
  viewCount: bigint | null;
  onlineViewers: bigint | null;
  onlineViewersRaw: string | null;
  likeCount: bigint | null;
  coinCount: bigint | null;
  favoriteCount: bigint | null;
  shareCount: bigint | null;
  danmakuCount: bigint | null;
};

export type DynamicSample = {
  dynamicId: string;
  sampledAt: Date;
  rawTime: string;
  precision: 'minute' | 'second';
  likeCount: bigint | null;
  repostCount: bigint | null;
  commentCount: bigint | null;
};

export { parseMetricCsvWithStaging, type StagingMetricRow } from './metric-parse';

export function parseMetricCsv(opts: {
  kind: FileKind;
  entityKey: string;
  text: string;
  sourceTimezone: string;
}): {
  samples: FollowerSample[] | VideoSample[] | DynamicSample[];
  issues: MetricRowIssue[];
} {
  const parsed = parseMetricCsvWithStaging(opts);
  return { samples: parsed.samples, issues: parsed.issues };
}

export function normalizeCategory(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const cat = meta.category ?? meta.catagory;
  return typeof cat === 'string' ? cat : null;
}
