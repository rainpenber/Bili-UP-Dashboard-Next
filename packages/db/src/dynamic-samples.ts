import type postgres from 'postgres';
import type { Sql } from './client';
import type { SampleSource } from './monitor-targets';

type Queryable = postgres.Sql | postgres.TransactionSql;

const DYNAMIC_ID = /^[1-9]\d*$/;
const DECIMAL_INTEGER = /^(0|[1-9]\d*)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSTGRES_BIGINT_MAX = 9223372036854775807n;

/**
 * One dynamic interaction sample plus the detail fields that map into
 * `dynamics.metadata`. Counts stay on `dynamic_metric_samples`. `authorMid`
 * is the existing creators/dynamics foreign key. This type is defined here
 * so the database package does not import the monitoring parser.
 */
export type DynamicSampleWrite = {
  dynamicId: string;
  dynamicType?: string | null;
  visible?: boolean | null;
  authorMid?: string | null;
  authorName?: string | null;
  faceUrl?: string | null;
  publishedAt?: Date | null;
  publishedText?: string | null;
  text?: string | null;
  majorType?: string | null;
  likeCount: bigint | null;
  repostCount: bigint | null;
  commentCount: bigint | null;
  sampledAt: Date;
  rawTime: string;
  sourceTimezone: string;
  timestampPrecision: 'minute' | 'second';
  source: SampleSource;
  accountId: string | null;
  collectorRunId: string | null;
  collectedAt: Date | null;
  extra: Record<string, unknown>;
};

type NormalizedDynamicSample = {
  dynamicId: string;
  authorMid: string | null;
  authorName: string | null;
  sampledAt: Date;
  collectedAt: Date | null;
  rawTime: string;
  sourceTimezone: string;
  timestampPrecision: 'minute' | 'second';
  likeCount: string | null;
  repostCount: string | null;
  commentCount: string | null;
  source: SampleSource;
  accountId: string | null;
  collectorRunId: string | null;
  extra: postgres.JSONValue;
  metadata: postgres.JSONValue;
};

function optionalText(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error(`${field} 必须是字符串或 null`);
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalBoolean(value: boolean | null | undefined, field: string): boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'boolean') throw new Error(`${field} 必须是布尔值或 null`);
  return value;
}

function requireDate(value: unknown, field: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`${field} 不是有效时间`);
  }
  return value;
}

function countText(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'bigint') throw new Error(`${field} 必须是 bigint 或 null`);
  if (value < 0n) throw new Error(`${field} 不能为负数`);
  if (value > POSTGRES_BIGINT_MAX) throw new Error(`${field} 超出 BIGINT 范围`);
  return value.toString();
}

function optionalMid(value: string | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !DECIMAL_INTEGER.test(value)) {
    throw new Error('作者 mid 必须是十进制整数字符串');
  }
  if (BigInt(value) > POSTGRES_BIGINT_MAX) throw new Error('作者 mid 超出 BIGINT 范围');
  return value;
}

function optionalUuid(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !UUID.test(value)) {
    throw new Error(`${field} 必须是 UUID 或 null`);
  }
  return value;
}

function jsonObject(value: unknown, field: string): postgres.JSONValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} 必须是 JSON 对象`);
  }
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(value));
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${field} 必须是 JSON 对象`);
    }
    return parsed as postgres.JSONValue;
  } catch (error) {
    if (error instanceof Error && error.message.includes('必须是 JSON 对象')) throw error;
    throw new Error(`${field} 不是可存储的 JSON 对象`);
  }
}

function requireSource(value: unknown): SampleSource {
  if (value === 'import' || value === 'legacy_csv' || value === 'bilibili') return value;
  throw new Error('source 必须是 import、legacy_csv 或 bilibili');
}

function requirePrecision(value: unknown): 'minute' | 'second' {
  if (value === 'minute' || value === 'second') return value;
  throw new Error('timestamp_precision 必须是 minute 或 second');
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${field} 必须是非空字符串`);
  }
  return value;
}

/**
 * Validate every caller-supplied value before the first statement.
 * Null metadata fields are omitted so a later sample cannot replace an
 * existing JSON value with null. Blank strings are treated as missing.
 */
function normalize(sample: DynamicSampleWrite): NormalizedDynamicSample {
  if (typeof sample.dynamicId !== 'string' || !DYNAMIC_ID.test(sample.dynamicId)) {
    throw new Error('动态 id 必须是十进制整数字符串');
  }
  const authorMid = optionalMid(sample.authorMid);
  const authorName = optionalText(sample.authorName, '作者名');
  const text = optionalText(sample.text, '正文');
  const dynamicType = optionalText(sample.dynamicType, '动态类型');
  const majorType = optionalText(sample.majorType, 'major 类型');
  const publishedText = optionalText(sample.publishedText, '发布时间文案');
  const faceUrl = optionalText(sample.faceUrl, '作者头像');
  const visible = optionalBoolean(sample.visible, 'visible');
  const publishedAt =
    sample.publishedAt === undefined || sample.publishedAt === null
      ? null
      : requireDate(sample.publishedAt, '发布时间');
  const metadata: Record<string, unknown> = {};
  if (text !== null) metadata.text = text;
  if (dynamicType !== null) metadata.dynamic_type = dynamicType;
  if (majorType !== null) metadata.major_type = majorType;
  if (publishedText !== null) metadata.published_text = publishedText;
  if (authorName !== null) metadata.author_name = authorName;
  if (faceUrl !== null) metadata.author_face = faceUrl;
  if (publishedAt) metadata.published_at = publishedAt.toISOString();
  if (visible !== null) metadata.visible = visible;

  if (!('sampledAt' in sample)) throw new Error('采样时间不是有效时间');
  if (!('collectedAt' in sample)) throw new Error('collected_at 必须是有效时间或 null');
  if (!('accountId' in sample)) throw new Error('account_id 必须是 UUID 或 null');
  if (!('collectorRunId' in sample)) throw new Error('collector_run_id 必须是 UUID 或 null');
  if (!('extra' in sample)) throw new Error('extra 必须是 JSON 对象');

  return {
    dynamicId: sample.dynamicId,
    authorMid,
    authorName,
    sampledAt: requireDate(sample.sampledAt, '采样时间'),
    collectedAt:
      sample.collectedAt === null ? null : requireDate(sample.collectedAt, 'collected_at'),
    rawTime: requireNonEmpty(sample.rawTime, 'raw_time'),
    sourceTimezone: requireNonEmpty(sample.sourceTimezone, 'source_timezone'),
    timestampPrecision: requirePrecision(sample.timestampPrecision),
    likeCount: countText(sample.likeCount, 'like_count'),
    repostCount: countText(sample.repostCount, 'repost_count'),
    commentCount: countText(sample.commentCount, 'comment_count'),
    source: requireSource(sample.source),
    accountId: optionalUuid(sample.accountId, 'account_id'),
    collectorRunId: optionalUuid(sample.collectorRunId, 'collector_run_id'),
    extra: jsonObject(sample.extra, 'extra'),
    metadata: jsonObject(metadata, 'metadata'),
  };
}

/**
 * Insert one sample and its author/dynamic metadata inside the caller transaction.
 * A conflicting `(dynamic_id, sampled_at)` is a no-op: the existing sample,
 * author, and dynamic metadata stay as they were. Returns true only when the
 * sample row was inserted.
 */
export async function writeDynamicSampleWithin(
  tx: Queryable,
  sample: DynamicSampleWrite,
): Promise<boolean> {
  const row = normalize(sample);
  await tx`
    INSERT INTO dynamics (dynamic_id)
    VALUES (${row.dynamicId})
    ON CONFLICT (dynamic_id) DO NOTHING
  `;
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO dynamic_metric_samples (
      dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision,
      like_count, repost_count, comment_count,
      source, account_id, collector_run_id, collected_at, extra
    ) VALUES (
      ${row.dynamicId},
      ${row.sampledAt},
      ${row.sourceTimezone},
      ${row.rawTime},
      ${row.timestampPrecision},
      ${row.likeCount}::bigint,
      ${row.repostCount}::bigint,
      ${row.commentCount}::bigint,
      ${row.source},
      ${row.accountId}::uuid,
      ${row.collectorRunId}::uuid,
      ${row.collectedAt},
      ${tx.json(row.extra)}
    )
    ON CONFLICT (dynamic_id, sampled_at) DO NOTHING
    RETURNING id::text AS id
  `;
  if (inserted.length === 0) return false;

  if (row.authorMid) {
    await tx`
      INSERT INTO creators (mid, uname)
      VALUES (${row.authorMid}::bigint, ${row.authorName})
      ON CONFLICT (mid) DO UPDATE SET
        uname = COALESCE(EXCLUDED.uname, creators.uname),
        updated_at = CASE
          WHEN EXCLUDED.uname IS NOT NULL AND EXCLUDED.uname IS DISTINCT FROM creators.uname
            THEN now()
          ELSE creators.updated_at
        END
    `;
  }
  const updated = await tx<{ dynamic_id: string }[]>`
    UPDATE dynamics
    SET mid = COALESCE(${row.authorMid}::bigint, dynamics.mid),
        metadata = CASE
          WHEN jsonb_typeof(dynamics.metadata) = 'object'
            THEN dynamics.metadata || ${tx.json(row.metadata)}
          ELSE dynamics.metadata
        END,
        updated_at = now()
    WHERE dynamic_id = ${row.dynamicId}
    RETURNING dynamic_id
  `;
  if (updated.length !== 1) throw new Error('动态实体没有更新');
  return true;
}

/** Commit wrapper around {@link writeDynamicSampleWithin}. */
export async function writeDynamicSample(sql: Sql, sample: DynamicSampleWrite): Promise<boolean> {
  return sql.begin(async (tx) => writeDynamicSampleWithin(tx, sample));
}
