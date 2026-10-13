import type { Sql } from '@studio/db';
import type { StagingMetricRow } from './metric-parse';
import type { MetricRowIssue } from './metric-rows';
import type { DynamicSample, FollowerSample, VideoSample } from './metric-rows';
import { pgBigint } from './sql-values';

const DEFAULT_CHUNK = 400;

export async function bulkInsertSourceMetricRows(
  tx: Sql,
  batchId: string,
  sourceFileId: number,
  rows: StagingMetricRow[],
  chunkSize = DEFAULT_CHUNK,
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    if (chunk.length === 0) continue;
    const records = chunk.map((row) => ({
      batch_id: batchId,
      source_file_id: sourceFileId,
      row_index: row.rowIndex,
      entity_type: row.entityType,
      entity_key: row.entityKey,
      sampled_at: row.sampledAt,
      raw_time: row.rawTime,
      payload: row.payload,
      quality_flags: row.qualityFlags,
      is_canonical: row.isCanonical,
    }));
    await tx`INSERT INTO source_metric_rows ${tx(records as never)}`;
  }
}

export async function bulkInsertConflicts(
  tx: Sql,
  batchId: string,
  sourceFileId: number | null,
  fileKind: string,
  entityKey: string,
  issues: MetricRowIssue[],
  chunkSize = DEFAULT_CHUNK,
): Promise<void> {
  for (let offset = 0; offset < issues.length; offset += chunkSize) {
    const chunk = issues.slice(offset, offset + chunkSize);
    if (chunk.length === 0) continue;
    const records = chunk.map((issue) => ({
      batch_id: batchId,
      source_file_id: sourceFileId,
      kind: issue.kind,
      entity_type: fileKind,
      entity_key: entityKey,
      sampled_at: issue.detail?.sampledAt ? new Date(String(issue.detail.sampledAt)) : null,
      message: issue.message,
      detail: issue.detail ?? {},
    }));
    await tx`INSERT INTO import_conflicts_or_rejects ${tx(records as never)}`;
  }
}

export async function bulkInsertFollowerSamples(
  tx: Sql,
  batchId: string,
  canonicalFileId: number,
  sourceTimezone: string,
  samples: FollowerSample[],
  chunkSize = DEFAULT_CHUNK,
): Promise<void> {
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const chunk = samples.slice(offset, offset + chunkSize);
    if (chunk.length === 0) continue;
    const mids = [...new Set(chunk.map((s) => s.mid.toString()))];
    for (const mid of mids) {
      await tx`INSERT INTO creators (mid) VALUES (${mid}) ON CONFLICT (mid) DO NOTHING`;
    }
    const records = chunk.map((s) => ({
      mid: pgBigint(s.mid),
      sampled_at: s.sampledAt,
      source_timezone: sourceTimezone,
      raw_time: s.rawTime,
      timestamp_precision: s.precision,
      follower_count: pgBigint(s.followerCount),
      import_batch_id: batchId,
      source_file_id: canonicalFileId,
    }));
    await tx`
      INSERT INTO creator_follower_samples ${tx(records as never)}
      ON CONFLICT (mid, sampled_at) DO NOTHING
    `;
  }
}

export async function bulkInsertVideoSamples(
  tx: Sql,
  batchId: string,
  canonicalFileId: number,
  sourceTimezone: string,
  samples: VideoSample[],
  chunkSize = DEFAULT_CHUNK,
): Promise<void> {
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const chunk = samples.slice(offset, offset + chunkSize);
    if (chunk.length === 0) continue;
    const bvids = [...new Set(chunk.map((s) => s.bvid))];
    for (const bvid of bvids) {
      await tx`INSERT INTO videos (bvid) VALUES (${bvid}) ON CONFLICT (bvid) DO NOTHING`;
    }
    const records = chunk.map((s) => ({
      bvid: s.bvid,
      sampled_at: s.sampledAt,
      source_timezone: sourceTimezone,
      raw_time: s.rawTime,
      timestamp_precision: s.precision,
      view_count: pgBigint(s.viewCount),
      online_viewers: pgBigint(s.onlineViewers),
      online_viewers_raw: s.onlineViewersRaw,
      like_count: pgBigint(s.likeCount),
      coin_count: pgBigint(s.coinCount),
      favorite_count: pgBigint(s.favoriteCount),
      share_count: pgBigint(s.shareCount),
      danmaku_count: pgBigint(s.danmakuCount),
      comment_count: pgBigint(s.commentCount),
      import_batch_id: batchId,
      source_file_id: canonicalFileId,
    }));
    await tx`
      INSERT INTO video_metric_samples ${tx(records as never)}
      ON CONFLICT (bvid, sampled_at) DO NOTHING
    `;
  }
}

export async function bulkInsertDynamicSamples(
  tx: Sql,
  batchId: string,
  canonicalFileId: number,
  sourceTimezone: string,
  samples: DynamicSample[],
  chunkSize = DEFAULT_CHUNK,
): Promise<void> {
  for (let offset = 0; offset < samples.length; offset += chunkSize) {
    const chunk = samples.slice(offset, offset + chunkSize);
    if (chunk.length === 0) continue;
    const ids = [...new Set(chunk.map((s) => s.dynamicId))];
    for (const dynamicId of ids) {
      await tx`INSERT INTO dynamics (dynamic_id) VALUES (${dynamicId}) ON CONFLICT (dynamic_id) DO NOTHING`;
    }
    const records = chunk.map((s) => ({
      dynamic_id: s.dynamicId,
      sampled_at: s.sampledAt,
      source_timezone: sourceTimezone,
      raw_time: s.rawTime,
      timestamp_precision: s.precision,
      like_count: pgBigint(s.likeCount),
      repost_count: pgBigint(s.repostCount),
      comment_count: pgBigint(s.commentCount),
      import_batch_id: batchId,
      source_file_id: canonicalFileId,
    }));
    await tx`
      INSERT INTO dynamic_metric_samples ${tx(records as never)}
      ON CONFLICT (dynamic_id, sampled_at) DO NOTHING
    `;
  }
}
