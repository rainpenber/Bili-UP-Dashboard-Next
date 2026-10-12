import {
  parseCsv,
  parseBoundedCount,
  parseIntegerField,
  parseHistoricalTime,
  detectTimestampPrecision,
} from './csv-parse';
import type { FileKind } from './types';

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

const VIEWS_HEADERS = ['时间', '播放量', '在线观看人数', '点赞', '投币', '收藏', '分享', '弹幕'];
const FOLLOWER_HEADERS = ['时间', '粉丝数'];
const DETAIL_HEADERS = ['时间', '点赞数', '转发数', '评论数'];

function headerIndex(headers: string[], expected: string[]): Map<string, number> | null {
  const map = new Map<string, number>();
  for (const h of expected) {
    const idx = headers.indexOf(h);
    if (idx === -1) return null;
    map.set(h, idx);
  }
  return map;
}

function sameBigint(a: bigint | null, b: bigint | null): boolean {
  return a === b || (a !== null && b !== null && a === b);
}

export function parseMetricCsv(opts: {
  kind: FileKind;
  entityKey: string;
  text: string;
  sourceTimezone: string;
}): {
  samples: FollowerSample[] | VideoSample[] | DynamicSample[];
  issues: MetricRowIssue[];
} {
  const { headers, rows } = parseCsv(opts.text);
  const issues: MetricRowIssue[] = [];
  if (opts.kind === 'follower') {
    const idx = headerIndex(headers, FOLLOWER_HEADERS);
    if (!idx) {
      issues.push({ kind: 'reject', message: 'unknown follower header', detail: { headers } });
      return { samples: [], issues };
    }
    const mid = BigInt(opts.entityKey);
    const seen = new Map<string, FollowerSample>();
    const samples: FollowerSample[] = [];
    for (const row of rows) {
      const rawTime = row[idx.get('时间') ?? 0] ?? '';
      const precision = detectTimestampPrecision(rawTime);
      const sampledAt = parseHistoricalTime(rawTime, opts.sourceTimezone, precision);
      if (!sampledAt) {
        issues.push({ kind: 'reject', message: 'invalid time', detail: { rawTime } });
        continue;
      }
      const followerRaw = row[idx.get('粉丝数') ?? 1] ?? '';
      const followerCount = parseIntegerField(followerRaw);
      if (followerCount === null) {
        issues.push({ kind: 'reject', message: 'invalid follower count', detail: { followerRaw } });
        continue;
      }
      const key = sampledAt.toISOString();
      const sample: FollowerSample = {
        mid,
        sampledAt,
        rawTime,
        precision,
        followerCount,
      };
      const prev = seen.get(key);
      if (prev) {
        if (prev.followerCount === followerCount) {
          issues.push({
            kind: 'duplicate',
            message: 'duplicate timestamp same value',
            detail: { rawTime },
          });
        } else {
          issues.push({
            kind: 'conflict',
            message: 'duplicate timestamp different value',
            detail: {
              rawTime,
              prev: prev.followerCount.toString(),
              next: followerCount.toString(),
            },
          });
        }
        continue;
      }
      seen.set(key, sample);
      samples.push(sample);
    }
    return { samples, issues };
  }

  if (opts.kind === 'views') {
    const idx = headerIndex(headers, VIEWS_HEADERS);
    if (!idx) {
      issues.push({ kind: 'reject', message: 'unknown views header', detail: { headers } });
      return { samples: [], issues };
    }
    const bvid = opts.entityKey;
    const seen = new Map<string, VideoSample>();
    const samples: VideoSample[] = [];
    for (const row of rows) {
      const rawTime = row[idx.get('时间') ?? 0] ?? '';
      const precision = detectTimestampPrecision(rawTime);
      const sampledAt = parseHistoricalTime(rawTime, opts.sourceTimezone, precision);
      if (!sampledAt) {
        issues.push({ kind: 'reject', message: 'invalid time', detail: { rawTime } });
        continue;
      }
      const online = parseBoundedCount(row[idx.get('在线观看人数') ?? 2] ?? '');
      const sample: VideoSample = {
        bvid,
        sampledAt,
        rawTime,
        precision,
        viewCount: parseIntegerField(row[idx.get('播放量') ?? 1] ?? ''),
        onlineViewers: online.value,
        onlineViewersRaw: online.raw.includes('+') ? online.raw : null,
        likeCount: parseIntegerField(row[idx.get('点赞') ?? 3] ?? ''),
        coinCount: parseIntegerField(row[idx.get('投币') ?? 4] ?? ''),
        favoriteCount: parseIntegerField(row[idx.get('收藏') ?? 5] ?? ''),
        shareCount: parseIntegerField(row[idx.get('分享') ?? 6] ?? ''),
        danmakuCount: parseIntegerField(row[idx.get('弹幕') ?? 7] ?? ''),
      };
      const key = sampledAt.toISOString();
      const prev = seen.get(key);
      if (prev) {
        const same =
          sameBigint(prev.viewCount, sample.viewCount) &&
          sameBigint(prev.onlineViewers, sample.onlineViewers) &&
          prev.onlineViewersRaw === sample.onlineViewersRaw &&
          sameBigint(prev.likeCount, sample.likeCount);
        if (same) {
          issues.push({
            kind: 'duplicate',
            message: 'duplicate timestamp same value',
            detail: { rawTime },
          });
        } else {
          issues.push({
            kind: 'conflict',
            message: 'duplicate timestamp different value',
            detail: { rawTime },
          });
        }
        continue;
      }
      seen.set(key, sample);
      samples.push(sample);
    }
    return { samples, issues };
  }

  if (opts.kind === 'detailcount') {
    const idx = headerIndex(headers, DETAIL_HEADERS);
    if (!idx) {
      issues.push({ kind: 'reject', message: 'unknown detailcount header', detail: { headers } });
      return { samples: [], issues };
    }
    const dynamicId = opts.entityKey;
    const seen = new Map<string, DynamicSample>();
    const samples: DynamicSample[] = [];
    for (const row of rows) {
      const rawTime = row[idx.get('时间') ?? 0] ?? '';
      const precision = detectTimestampPrecision(rawTime);
      const sampledAt = parseHistoricalTime(rawTime, opts.sourceTimezone, precision);
      if (!sampledAt) {
        issues.push({ kind: 'reject', message: 'invalid time', detail: { rawTime } });
        continue;
      }
      const sample: DynamicSample = {
        dynamicId,
        sampledAt,
        rawTime,
        precision,
        likeCount: parseIntegerField(row[idx.get('点赞数') ?? 1] ?? ''),
        repostCount: parseIntegerField(row[idx.get('转发数') ?? 2] ?? ''),
        commentCount: parseIntegerField(row[idx.get('评论数') ?? 3] ?? ''),
      };
      const key = sampledAt.toISOString();
      const prev = seen.get(key);
      if (prev) {
        const same =
          sameBigint(prev.likeCount, sample.likeCount) &&
          sameBigint(prev.repostCount, sample.repostCount) &&
          sameBigint(prev.commentCount, sample.commentCount);
        if (same) {
          issues.push({
            kind: 'duplicate',
            message: 'duplicate timestamp same value',
            detail: { rawTime },
          });
        } else {
          issues.push({
            kind: 'conflict',
            message: 'duplicate timestamp different value',
            detail: { rawTime },
          });
        }
        continue;
      }
      seen.set(key, sample);
      samples.push(sample);
    }
    return { samples, issues };
  }

  return { samples: [], issues: [{ kind: 'reject', message: 'unsupported file kind' }] };
}

export function normalizeCategory(meta: Record<string, unknown> | undefined): string | null {
  if (!meta) return null;
  const cat = meta.category ?? meta.catagory;
  return typeof cat === 'string' ? cat : null;
}
