import {
  parseCsv,
  parseBoundedCount,
  parseIntegerField,
  parseHistoricalTime,
  detectTimestampPrecision,
} from './csv-parse';
import type { FileKind } from './types';
import type { DynamicSample, FollowerSample, MetricRowIssue, VideoSample } from './metric-rows';

export type StagingMetricRow = {
  rowIndex: number;
  entityType: string;
  entityKey: string;
  sampledAt: Date | null;
  rawTime: string;
  payload: Record<string, unknown>;
  qualityFlags: string[];
  isCanonical: boolean;
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

export function parseMetricCsvWithStaging(opts: {
  kind: FileKind;
  entityKey: string;
  text: string;
  sourceTimezone: string;
}): {
  stagingRows: StagingMetricRow[];
  samples: FollowerSample[] | VideoSample[] | DynamicSample[];
  issues: MetricRowIssue[];
} {
  const { headers, rows } = parseCsv(opts.text);
  const issues: MetricRowIssue[] = [];
  const stagingRows: StagingMetricRow[] = [];

  if (opts.kind === 'follower') {
    const idx = headerIndex(headers, FOLLOWER_HEADERS);
    if (!idx) {
      issues.push({ kind: 'reject', message: 'unknown follower header', detail: { headers } });
      return { stagingRows, samples: [], issues };
    }
    const mid = BigInt(opts.entityKey);
    const seen = new Map<string, FollowerSample>();
    const samples: FollowerSample[] = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] ?? [];
      const rawTime = row[idx.get('时间') ?? 0] ?? '';
      const precision = detectTimestampPrecision(rawTime);
      const sampledAt = parseHistoricalTime(rawTime, opts.sourceTimezone, precision);
      const followerRaw = row[idx.get('粉丝数') ?? 1] ?? '';
      const followerCount = parseIntegerField(followerRaw);
      if (!sampledAt || followerCount === null) {
        const flags = ['rejected'];
        stagingRows.push({
          rowIndex,
          entityType: 'creator',
          entityKey: opts.entityKey,
          sampledAt,
          rawTime,
          payload: { followerRaw },
          qualityFlags: flags,
          isCanonical: false,
        });
        issues.push({
          kind: 'reject',
          message: 'invalid follower row',
          detail: { rawTime, followerRaw, rowIndex },
        });
        continue;
      }
      const sample: FollowerSample = { mid, sampledAt, rawTime, precision, followerCount };
      const key = sampledAt.toISOString();
      const prev = seen.get(key);
      const payload = { followerCount: followerCount.toString() };
      if (prev) {
        const same = prev.followerCount === followerCount;
        const flags = same ? ['duplicate_same'] : ['conflict'];
        stagingRows.push({
          rowIndex,
          entityType: 'creator',
          entityKey: opts.entityKey,
          sampledAt,
          rawTime,
          payload,
          qualityFlags: flags,
          isCanonical: false,
        });
        issues.push({
          kind: same ? 'duplicate' : 'conflict',
          message: same ? 'duplicate timestamp same value' : 'duplicate timestamp different value',
          detail: {
            rawTime,
            rowIndex,
            prev: prev.followerCount.toString(),
            next: followerCount.toString(),
          },
        });
        continue;
      }
      seen.set(key, sample);
      samples.push(sample);
      stagingRows.push({
        rowIndex,
        entityType: 'creator',
        entityKey: opts.entityKey,
        sampledAt,
        rawTime,
        payload,
        qualityFlags: ['accepted'],
        isCanonical: true,
      });
    }
    return { stagingRows, samples, issues };
  }

  if (opts.kind === 'views') {
    const idx = headerIndex(headers, VIEWS_HEADERS);
    if (!idx) {
      issues.push({ kind: 'reject', message: 'unknown views header', detail: { headers } });
      return { stagingRows, samples: [], issues };
    }
    const bvid = opts.entityKey;
    const seen = new Map<string, VideoSample>();
    const samples: VideoSample[] = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] ?? [];
      const rawTime = row[idx.get('时间') ?? 0] ?? '';
      const precision = detectTimestampPrecision(rawTime);
      const sampledAt = parseHistoricalTime(rawTime, opts.sourceTimezone, precision);
      if (!sampledAt) {
        stagingRows.push({
          rowIndex,
          entityType: 'video',
          entityKey: bvid,
          sampledAt: null,
          rawTime,
          payload: {},
          qualityFlags: ['rejected'],
          isCanonical: false,
        });
        issues.push({ kind: 'reject', message: 'invalid time', detail: { rawTime, rowIndex } });
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
      const payload = {
        viewCount: sample.viewCount?.toString() ?? null,
        onlineViewers: sample.onlineViewers?.toString() ?? null,
        onlineViewersRaw: sample.onlineViewersRaw,
        likeCount: sample.likeCount?.toString() ?? null,
      };
      const key = sampledAt.toISOString();
      const prev = seen.get(key);
      if (prev) {
        const same =
          sameBigint(prev.viewCount, sample.viewCount) &&
          sameBigint(prev.onlineViewers, sample.onlineViewers) &&
          prev.onlineViewersRaw === sample.onlineViewersRaw &&
          sameBigint(prev.likeCount, sample.likeCount);
        stagingRows.push({
          rowIndex,
          entityType: 'video',
          entityKey: bvid,
          sampledAt,
          rawTime,
          payload,
          qualityFlags: same ? ['duplicate_same'] : ['conflict'],
          isCanonical: false,
        });
        issues.push({
          kind: same ? 'duplicate' : 'conflict',
          message: same ? 'duplicate timestamp same value' : 'duplicate timestamp different value',
          detail: { rawTime, rowIndex },
        });
        continue;
      }
      seen.set(key, sample);
      samples.push(sample);
      stagingRows.push({
        rowIndex,
        entityType: 'video',
        entityKey: bvid,
        sampledAt,
        rawTime,
        payload,
        qualityFlags: ['accepted'],
        isCanonical: true,
      });
    }
    return { stagingRows, samples, issues };
  }

  if (opts.kind === 'detailcount') {
    const idx = headerIndex(headers, DETAIL_HEADERS);
    if (!idx) {
      issues.push({ kind: 'reject', message: 'unknown detailcount header', detail: { headers } });
      return { stagingRows, samples: [], issues };
    }
    const dynamicId = opts.entityKey;
    const seen = new Map<string, DynamicSample>();
    const samples: DynamicSample[] = [];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const row = rows[rowIndex] ?? [];
      const rawTime = row[idx.get('时间') ?? 0] ?? '';
      const precision = detectTimestampPrecision(rawTime);
      const sampledAt = parseHistoricalTime(rawTime, opts.sourceTimezone, precision);
      if (!sampledAt) {
        stagingRows.push({
          rowIndex,
          entityType: 'dynamic',
          entityKey: dynamicId,
          sampledAt: null,
          rawTime,
          payload: {},
          qualityFlags: ['rejected'],
          isCanonical: false,
        });
        issues.push({ kind: 'reject', message: 'invalid time', detail: { rawTime, rowIndex } });
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
      const payload = {
        likeCount: sample.likeCount?.toString() ?? null,
        repostCount: sample.repostCount?.toString() ?? null,
        commentCount: sample.commentCount?.toString() ?? null,
      };
      const key = sampledAt.toISOString();
      const prev = seen.get(key);
      if (prev) {
        const same =
          sameBigint(prev.likeCount, sample.likeCount) &&
          sameBigint(prev.repostCount, sample.repostCount) &&
          sameBigint(prev.commentCount, sample.commentCount);
        stagingRows.push({
          rowIndex,
          entityType: 'dynamic',
          entityKey: dynamicId,
          sampledAt,
          rawTime,
          payload,
          qualityFlags: same ? ['duplicate_same'] : ['conflict'],
          isCanonical: false,
        });
        issues.push({
          kind: same ? 'duplicate' : 'conflict',
          message: same ? 'duplicate timestamp same value' : 'duplicate timestamp different value',
          detail: { rawTime, rowIndex },
        });
        continue;
      }
      seen.set(key, sample);
      samples.push(sample);
      stagingRows.push({
        rowIndex,
        entityType: 'dynamic',
        entityKey: dynamicId,
        sampledAt,
        rawTime,
        payload,
        qualityFlags: ['accepted'],
        isCanonical: true,
      });
    }
    return { stagingRows, samples, issues };
  }

  return {
    stagingRows,
    samples: [],
    issues: [{ kind: 'reject', message: 'unsupported file kind' }],
  };
}
