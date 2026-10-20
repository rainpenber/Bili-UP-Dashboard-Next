import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type postgres from 'postgres';
import type { Sql } from './client';
import {
  applyTargetSchedule,
  writeCreatorSampleWithin,
  writeVideoSampleWithin,
  type CollectorScheduleWrite,
  type CreatorSampleWrite,
  type VideoSampleWrite,
} from './monitor-targets';

type Queryable = postgres.Sql | postgres.TransactionSql;

export type BiliAccountStatus = 'pending' | 'active' | 'expired' | 'revoked' | 'blocked';

export type ResolvedBiliAccount = {
  id: string;
  status: BiliAccountStatus;
  mid: string | null;
};

export type CircuitRow = {
  resumeAt: Date;
  reason: string;
  consecutiveFailures: number;
};

export type EncryptedSecretRow = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyVersion: number;
};

function asBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error('凭据字段不是二进制');
}

function scrubStoredError(value: string | null): string | null {
  if (value === null) return null;
  return value
    .replace(/SESSDATA=[^;\s&"]*/gi, 'SESSDATA=redacted')
    .replace(/bili_jct=[^;\s&"]*/gi, 'bili_jct=redacted')
    .replace(/DedeUserID__ckMd5=[^;\s&"]*/gi, 'DedeUserID__ckMd5=redacted')
    .slice(0, 500);
}

export async function collectorSchemaReady(sql: Queryable): Promise<boolean> {
  const rows = await sql<{ ready: boolean }[]>`
    SELECT (
      to_regclass('public.monitor_targets') IS NOT NULL
      AND to_regclass('public.collector_jobs') IS NOT NULL
      AND to_regclass('public.collector_runs') IS NOT NULL
      AND to_regclass('public.collector_heartbeats') IS NOT NULL
      AND to_regclass('public.bili_accounts') IS NOT NULL
      AND to_regclass('public.bili_account_secrets') IS NOT NULL
      AND to_regclass('public.collector_requests') IS NOT NULL
      AND to_regclass('public.collector_circuits') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'videos' AND column_name = 'cid'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'video_metric_samples'
          AND column_name = 'collected_at'
      )
      AND EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'creator_follower_samples'
          AND column_name = 'following_count'
      )
    ) AS ready
  `;
  return rows[0]?.ready === true;
}

export async function deferCollectorJob(sql: Queryable, jobId: string, until: Date): Promise<void> {
  await sql`
    UPDATE collector_jobs
    SET status = 'pending',
        attempts = GREATEST(attempts - 1, 0),
        scheduled_for = ${until},
        started_at = NULL,
        finished_at = NULL,
        error = NULL,
        updated_at = statement_timestamp()
    WHERE id = ${jobId}::uuid
  `;
}

export async function disableMonitorTarget(
  sql: Queryable,
  targetId: string,
  error: string,
): Promise<void> {
  await sql`
    UPDATE monitor_targets
    SET enabled = false,
        last_error = ${error},
        last_run_at = statement_timestamp(),
        updated_at = statement_timestamp()
    WHERE id = ${targetId}::uuid AND deleted_at IS NULL
  `;
}

async function readAccount(sql: Queryable, id: string): Promise<ResolvedBiliAccount | null> {
  const rows = await sql<{ id: string; status: BiliAccountStatus; mid: string | null }[]>`
    SELECT id::text AS id, status, mid::text AS mid
    FROM bili_accounts
    WHERE id = ${id}::uuid
  `;
  return rows[0] ?? null;
}

export async function resolveCollectorAccount(
  sql: Queryable,
  input: { targetAccountId: string | null; forcedAccountId: string | null },
): Promise<ResolvedBiliAccount | null> {
  if (input.forcedAccountId) return readAccount(sql, input.forcedAccountId);
  if (input.targetAccountId) return readAccount(sql, input.targetAccountId);
  const active = await sql<{ id: string; status: BiliAccountStatus; mid: string | null }[]>`
    SELECT id::text AS id, status, mid::text AS mid
    FROM bili_accounts
    WHERE is_default = true AND status = 'active'
    ORDER BY created_at
    LIMIT 1
  `;
  if (active[0]) return active[0];
  const expired = await sql<{ id: string; status: BiliAccountStatus; mid: string | null }[]>`
    SELECT id::text AS id, status, mid::text AS mid
    FROM bili_accounts
    WHERE is_default = true AND status = 'expired'
    ORDER BY updated_at DESC
    LIMIT 1
  `;
  return expired[0] ?? null;
}

export async function readCollectorCircuit(
  sql: Queryable,
  accountId: string,
): Promise<CircuitRow | null> {
  const rows = await sql<{ resume_at: Date; reason: string; consecutive_failures: number }[]>`
    SELECT resume_at, reason, consecutive_failures
    FROM collector_circuits
    WHERE account_id = ${accountId}::uuid
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    resumeAt: row.resume_at,
    reason: row.reason,
    consecutiveFailures: row.consecutive_failures,
  };
}

export async function openCollectorCircuit(
  sql: Queryable,
  input: { accountId: string; resumeAt: Date; reason: string },
): Promise<void> {
  await sql`
    INSERT INTO collector_circuits (account_id, opened_at, resume_at, consecutive_failures, reason)
    VALUES (${input.accountId}::uuid, statement_timestamp(), ${input.resumeAt}, 1, ${input.reason})
    ON CONFLICT (account_id) DO UPDATE SET
      resume_at = EXCLUDED.resume_at,
      consecutive_failures = collector_circuits.consecutive_failures + 1,
      reason = EXCLUDED.reason
  `;
}

export async function clearCollectorCircuit(sql: Queryable, accountId: string): Promise<void> {
  await sql`DELETE FROM collector_circuits WHERE account_id = ${accountId}::uuid`;
}

export async function markBiliAccountExpired(sql: Queryable, accountId: string): Promise<void> {
  await sql`
    UPDATE bili_accounts
    SET status = 'expired', updated_at = statement_timestamp()
    WHERE id = ${accountId}::uuid
  `;
}

export async function markBiliAccountUsed(sql: Queryable, accountId: string): Promise<void> {
  await sql`
    UPDATE bili_accounts
    SET last_used_at = statement_timestamp(), updated_at = statement_timestamp()
    WHERE id = ${accountId}::uuid
  `;
}

export async function readBiliAccountSecret(
  sql: Queryable,
  accountId: string,
): Promise<EncryptedSecretRow | null> {
  const rows = await sql<
    { ciphertext: unknown; iv: unknown; auth_tag: unknown; key_version: number }[]
  >`
    SELECT ciphertext, iv, auth_tag, key_version
    FROM bili_account_secrets
    WHERE account_id = ${accountId}::uuid
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    ciphertext: asBuffer(row.ciphertext),
    iv: asBuffer(row.iv),
    authTag: asBuffer(row.auth_tag),
    keyVersion: row.key_version,
  };
}

export async function saveActiveBiliAccount(
  sql: Sql,
  input: {
    id: string;
    mid: string;
    uname: string;
    avatarUrl: string | null;
    cookieExpiresAt: Date | null;
    secret: EncryptedSecretRow;
  },
): Promise<{ accountId: string }> {
  return sql.begin(async (tx) => {
    const existing = await tx<{ id: string }[]>`
      SELECT id::text AS id FROM bili_accounts WHERE mid = ${input.mid}::bigint
    `;
    const accountId = existing[0]?.id ?? input.id;
    if (existing[0]) {
      await tx`
        UPDATE bili_accounts
        SET uname = ${input.uname},
            avatar_url = ${input.avatarUrl},
            status = 'active',
            cookie_expires_at = ${input.cookieExpiresAt},
            last_verified_at = statement_timestamp(),
            updated_at = statement_timestamp()
        WHERE id = ${accountId}::uuid
      `;
    } else {
      await tx`
        INSERT INTO bili_accounts (
          id, mid, uname, avatar_url, status, is_default, cookie_expires_at, last_verified_at
        ) VALUES (
          ${accountId}::uuid,
          ${input.mid}::bigint,
          ${input.uname},
          ${input.avatarUrl},
          'active',
          false,
          ${input.cookieExpiresAt},
          statement_timestamp()
        )
      `;
    }
    await tx`
      INSERT INTO bili_account_secrets (account_id, ciphertext, iv, auth_tag, key_version)
      VALUES (
        ${accountId}::uuid,
        ${input.secret.ciphertext},
        ${input.secret.iv},
        ${input.secret.authTag},
        ${input.secret.keyVersion}
      )
      ON CONFLICT (account_id) DO UPDATE SET
        ciphertext = EXCLUDED.ciphertext,
        iv = EXCLUDED.iv,
        auth_tag = EXCLUDED.auth_tag,
        key_version = EXCLUDED.key_version,
        updated_at = statement_timestamp()
    `;
    const defaults = await tx<{ id: string }[]>`
      SELECT id::text AS id
      FROM bili_accounts
      WHERE is_default = true AND status = 'active' AND id <> ${accountId}::uuid
      LIMIT 1
    `;
    if (!defaults[0]) {
      await tx`
        UPDATE bili_accounts
        SET is_default = false, updated_at = statement_timestamp()
        WHERE is_default = true AND id <> ${accountId}::uuid
      `;
      await tx`
        UPDATE bili_accounts
        SET is_default = true, updated_at = statement_timestamp()
        WHERE id = ${accountId}::uuid
      `;
    }
    return { accountId };
  });
}

export async function insertCollectorRequests(
  sql: Queryable,
  rows: readonly {
    accountId: string | null;
    runId: string | null;
    endpoint: string;
    statusCode: number | null;
    bizCode: number | null;
    durationMs: number;
    error: string | null;
  }[],
): Promise<void> {
  for (const row of rows) {
    await sql`
      INSERT INTO collector_requests (
        account_id, run_id, endpoint, status_code, biz_code, duration_ms, error
      ) VALUES (
        ${row.accountId}::uuid,
        ${row.runId}::uuid,
        ${row.endpoint},
        ${row.statusCode},
        ${row.bizCode},
        ${row.durationMs},
        ${scrubStoredError(row.error)}
      )
    `;
  }
}

async function openSucceededRun(
  tx: Queryable,
  input: { jobId: string; targetId: string; startedAt: Date; durationMs: number; runId: string },
): Promise<void> {
  const finished = new Date();
  await tx`
    INSERT INTO collector_runs (
      id, job_id, target_id, status, samples_written, duration_ms, error, started_at, finished_at
    ) VALUES (
      ${input.runId}::uuid,
      ${input.jobId}::uuid,
      ${input.targetId}::uuid,
      'succeeded',
      0,
      ${input.durationMs},
      NULL,
      ${input.startedAt},
      ${finished}
    )
  `;
}

async function closeSucceededRun(
  tx: Queryable,
  input: {
    jobId: string;
    targetId: string;
    runId: string;
    samplesWritten: number;
    schedule: CollectorScheduleWrite | null;
  },
): Promise<void> {
  const finished = new Date();
  await tx`
    UPDATE collector_runs
    SET samples_written = ${input.samplesWritten}, finished_at = ${finished}
    WHERE id = ${input.runId}::uuid
  `;
  await tx`
    UPDATE collector_jobs
    SET status = 'succeeded', finished_at = ${finished}, error = NULL, updated_at = ${finished}
    WHERE id = ${input.jobId}::uuid
  `;
  await applyTargetSchedule(tx, {
    targetId: input.targetId,
    finished,
    success: true,
    error: null,
    schedule: input.schedule,
  });
}

export async function commitBilibiliVideo(
  sql: Sql,
  input: {
    jobId: string;
    targetId: string;
    startedAt: Date;
    durationMs: number;
    sample: VideoSampleWrite;
    schedule: CollectorScheduleWrite | null;
  },
): Promise<{ inserted: boolean; runId: string }> {
  return sql.begin(async (tx) => {
    const runId = crypto.randomUUID();
    await openSucceededRun(tx, {
      jobId: input.jobId,
      targetId: input.targetId,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      runId,
    });
    const inserted = await writeVideoSampleWithin(tx, {
      ...input.sample,
      collectorRunId: runId,
      source: input.sample.source ?? 'bilibili',
    });
    await closeSucceededRun(tx, {
      jobId: input.jobId,
      targetId: input.targetId,
      runId,
      samplesWritten: inserted ? 1 : 0,
      schedule: input.schedule,
    });
    return { inserted, runId };
  });
}

export async function commitBilibiliCreator(
  sql: Sql,
  input: {
    jobId: string;
    targetId: string;
    startedAt: Date;
    durationMs: number;
    sample: CreatorSampleWrite;
    schedule: CollectorScheduleWrite | null;
  },
): Promise<{ inserted: boolean; runId: string }> {
  return sql.begin(async (tx) => {
    const runId = crypto.randomUUID();
    await openSucceededRun(tx, {
      jobId: input.jobId,
      targetId: input.targetId,
      startedAt: input.startedAt,
      durationMs: input.durationMs,
      runId,
    });
    const inserted = await writeCreatorSampleWithin(tx, {
      ...input.sample,
      collectorRunId: runId,
      source: input.sample.source ?? 'bilibili',
    });
    await closeSucceededRun(tx, {
      jobId: input.jobId,
      targetId: input.targetId,
      runId,
      samplesWritten: inserted ? 1 : 0,
      schedule: input.schedule,
    });
    return { inserted, runId };
  });
}

export type LegacyVideoRow = {
  sampledAt: Date;
  rawTime: string;
  viewCount: bigint;
  onlineViewers: bigint | null;
  onlineViewersRaw: string | null;
  likeCount: bigint;
  coinCount: bigint;
  favoriteCount: bigint;
  shareCount: bigint;
  danmakuCount: bigint;
};

export type LegacyFollowerRow = {
  sampledAt: Date;
  rawTime: string;
  followerCount: bigint;
};

function jsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

const LEGACY_SAMPLE_CHUNK = 1000;

export async function insertLegacyImportBatch(
  tx: Queryable,
  input: { batchId: string; importerVersion: string; report: Record<string, unknown> },
): Promise<void> {
  await tx`
    INSERT INTO import_batches (id, mode, source_timezone, status, importer_version, report_json, completed_at)
    VALUES (
      ${input.batchId}::uuid,
      'apply',
      'Asia/Shanghai',
      'completed',
      ${input.importerVersion},
      ${tx.json(jsonValue(input.report))},
      statement_timestamp()
    )
  `;
}

export async function insertLegacyRejects(
  tx: Queryable,
  input: {
    batchId: string;
    entityType: 'video' | 'creator';
    entityKey: string;
    lines: readonly string[];
  },
): Promise<void> {
  const lines = input.lines.map((line) => line.slice(0, 500)).filter((line) => line.length > 0);
  for (let index = 0; index < lines.length; index += LEGACY_SAMPLE_CHUNK) {
    const payload = jsonValue({
      rows: lines.slice(index, index + LEGACY_SAMPLE_CHUNK).map((line) => ({ line })),
    });
    await tx`
      INSERT INTO import_conflicts_or_rejects (batch_id, kind, entity_type, entity_key, message, detail)
      SELECT
        ${input.batchId}::uuid,
        'rejected_row',
        ${input.entityType},
        ${input.entityKey},
        '无法解析的旧 CSV 行',
        elem
      FROM jsonb_array_elements(${tx.json(payload)}::jsonb -> 'rows') AS elem
    `;
  }
}

export async function writeLegacyVideoSamplesWithin(
  tx: Queryable,
  input: { batchId: string; bvid: string; rows: LegacyVideoRow[] },
): Promise<number> {
  await tx`INSERT INTO videos (bvid) VALUES (${input.bvid}) ON CONFLICT (bvid) DO NOTHING`;
  let inserted = 0;
  for (let index = 0; index < input.rows.length; index += LEGACY_SAMPLE_CHUNK) {
    const payload = jsonValue({
      rows: input.rows.slice(index, index + LEGACY_SAMPLE_CHUNK).map((row) => ({
        sampledAt: row.sampledAt.toISOString(),
        rawTime: row.rawTime,
        viewCount: row.viewCount.toString(),
        onlineViewers: row.onlineViewers === null ? null : row.onlineViewers.toString(),
        onlineViewersRaw: row.onlineViewersRaw,
        likeCount: row.likeCount.toString(),
        coinCount: row.coinCount.toString(),
        favoriteCount: row.favoriteCount.toString(),
        shareCount: row.shareCount.toString(),
        danmakuCount: row.danmakuCount.toString(),
      })),
    });
    const written = await tx<{ id: string }[]>`
      INSERT INTO video_metric_samples (
        bvid, sampled_at, source_timezone, raw_time, timestamp_precision,
        view_count, online_viewers, online_viewers_raw, like_count, coin_count,
        favorite_count, share_count, danmaku_count, comment_count,
        source, collected_at, extra, import_batch_id
      )
      SELECT
        ${input.bvid},
        (elem->>'sampledAt')::timestamptz,
        'Asia/Shanghai',
        elem->>'rawTime',
        'minute',
        (elem->>'viewCount')::bigint,
        (elem->>'onlineViewers')::bigint,
        elem->>'onlineViewersRaw',
        (elem->>'likeCount')::bigint,
        (elem->>'coinCount')::bigint,
        (elem->>'favoriteCount')::bigint,
        (elem->>'shareCount')::bigint,
        (elem->>'danmakuCount')::bigint,
        NULL,
        'legacy_csv',
        NULL,
        '{}'::jsonb,
        ${input.batchId}::uuid
      FROM jsonb_array_elements(${tx.json(payload)}::jsonb -> 'rows') AS elem
      ON CONFLICT (bvid, sampled_at) DO NOTHING
      RETURNING id::text AS id
    `;
    inserted += written.length;
  }
  return inserted;
}

export async function writeLegacyFollowerSamplesWithin(
  tx: Queryable,
  input: { batchId: string; mid: string; rows: LegacyFollowerRow[] },
): Promise<number> {
  await tx`
    INSERT INTO creators (mid) VALUES (${input.mid}::bigint) ON CONFLICT (mid) DO NOTHING
  `;
  let inserted = 0;
  for (let index = 0; index < input.rows.length; index += LEGACY_SAMPLE_CHUNK) {
    const payload = jsonValue({
      rows: input.rows.slice(index, index + LEGACY_SAMPLE_CHUNK).map((row) => ({
        sampledAt: row.sampledAt.toISOString(),
        rawTime: row.rawTime,
        followerCount: row.followerCount.toString(),
      })),
    });
    const written = await tx<{ id: string }[]>`
      INSERT INTO creator_follower_samples (
        mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count,
        following_count, source, collected_at, extra, import_batch_id
      )
      SELECT
        ${input.mid}::bigint,
        (elem->>'sampledAt')::timestamptz,
        'Asia/Shanghai',
        elem->>'rawTime',
        'minute',
        (elem->>'followerCount')::bigint,
        NULL,
        'legacy_csv',
        NULL,
        '{}'::jsonb,
        ${input.batchId}::uuid
      FROM jsonb_array_elements(${tx.json(payload)}::jsonb -> 'rows') AS elem
      ON CONFLICT (mid, sampled_at) DO NOTHING
      RETURNING id::text AS id
    `;
    inserted += written.length;
  }
  return inserted;
}

export async function applyLegacyVideoImport(
  sql: Sql,
  input: { batchId: string; bvid: string; report: Record<string, unknown>; rows: LegacyVideoRow[] },
): Promise<number> {
  return sql.begin(async (tx) => {
    await insertLegacyImportBatch(tx, {
      batchId: input.batchId,
      importerVersion: 'legacy-csv',
      report: input.report,
    });
    return writeLegacyVideoSamplesWithin(tx, {
      batchId: input.batchId,
      bvid: input.bvid,
      rows: input.rows,
    });
  });
}

export async function applyLegacyFollowerImport(
  sql: Sql,
  input: {
    batchId: string;
    mid: string;
    report: Record<string, unknown>;
    rows: LegacyFollowerRow[];
  },
): Promise<number> {
  return sql.begin(async (tx) => {
    await insertLegacyImportBatch(tx, {
      batchId: input.batchId,
      importerVersion: 'legacy-csv',
      report: input.report,
    });
    return writeLegacyFollowerSamplesWithin(tx, {
      batchId: input.batchId,
      mid: input.mid,
      rows: input.rows,
    });
  });
}

export function migrationSql(versionPrefix: string): string {
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), '../migrations');
  const file = readdirSync(migrationsDir).find((name) => name.startsWith(versionPrefix));
  if (!file) throw new Error(`找不到迁移 ${versionPrefix}`);
  return readFileSync(join(migrationsDir, file), 'utf8');
}
