import type postgres from 'postgres';
import type { Sql } from './client';
import { partitionNameFromLabels } from './partitions';

type Queryable = postgres.Sql | postgres.TransactionSql;

export type MonitorTargetType = 'video' | 'creator' | 'dynamic';
export type CollectorJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type MonitorTargetRow = {
  id: string;
  type: MonitorTargetType;
  externalId: string;
  label: string;
  tags: string[];
  enabled: boolean;
  intervalMinutes: number;
  intervalMode: 'auto' | 'fixed';
  /** User-planned first collect. Distinct from nextRunAt (scheduler cursor). */
  startAt: Date | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type UpdateMonitorTargetStatus =
  'missing' | 'deleted' | 'updated' | 'already_started' | 'running' | 'invalid_start_type';

export type RequestCollectorRunStatus = 'missing' | 'deleted' | 'queued' | 'before_start';

export type CollectorRunRow = {
  id: string;
  status: 'succeeded' | 'failed';
  samplesWritten: number;
  durationMs: number;
  error: string | null;
  finishedAt: Date;
};

export type CollectorJobRow = {
  id: string;
  targetId: string;
  targetType: MonitorTargetType;
  externalId: string;
  status: CollectorJobStatus;
  attempts: number;
  scheduledFor: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
  latestRun: CollectorRunRow | null;
};

export type ClaimedCollectorJob = {
  id: string;
  targetId: string;
  targetType: MonitorTargetType;
  externalId: string;
  attempts: number;
  scheduledFor: Date;
  accountId: string | null;
};

type TargetSqlRow = {
  id: string;
  type: MonitorTargetType;
  external_id: string;
  label: string;
  tags: string[] | string;
  enabled: boolean;
  interval_minutes: number;
  interval_mode: 'auto' | 'fixed';
  start_at: Date | null;
  next_run_at: Date | null;
  last_run_at: Date | null;
  last_success_at: Date | null;
  last_error: string | null;
  source: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

function pgTextArray(values: readonly string[]): string {
  if (values.length === 0) return '{}';
  return `{${values.map((value) => `"${value}"`).join(',')}}`;
}

function readTags(value: string[] | string): string[] {
  if (Array.isArray(value)) return value;
  if (value === '{}') return [];
  return value
    .replace(/^\{/, '')
    .replace(/\}$/, '')
    .split(',')
    .map((part) => part.replace(/^"/, '').replace(/"$/, ''))
    .filter((part) => part.length > 0);
}

function mapTarget(row: TargetSqlRow): MonitorTargetRow {
  return {
    id: row.id,
    type: row.type,
    externalId: row.external_id,
    label: row.label,
    tags: readTags(row.tags),
    enabled: row.enabled,
    intervalMinutes: row.interval_minutes,
    intervalMode: row.interval_mode,
    startAt: row.start_at,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

const targetColumns = `
  id, "type", external_id, label, tags, enabled, interval_minutes, interval_mode,
  start_at, next_run_at, last_run_at, last_success_at, last_error, source,
  created_at, updated_at, deleted_at
`;

/** First-collect cursor: never earlier than a future startAt. */
export function effectiveFirstRunAt(now: Date, startAt: Date | null): Date {
  if (!startAt) return now;
  return startAt.getTime() > now.getTime() ? startAt : now;
}

export async function getMonitorTarget(
  sql: Queryable,
  id: string,
): Promise<MonitorTargetRow | null> {
  const rows = await sql<TargetSqlRow[]>`
    SELECT ${sql.unsafe(targetColumns)}
    FROM monitor_targets
    WHERE id = ${id}::uuid
  `;
  const row = rows[0];
  return row ? mapTarget(row) : null;
}

export async function insertMonitorTarget(
  sql: Sql,
  input: {
    id: string;
    type: MonitorTargetType;
    externalId: string;
    label: string;
    tags: string[];
    intervalMinutes: number;
    intervalMode?: 'auto' | 'fixed';
    /** Video only. Null/omitted = immediate. */
    startAt?: Date | null;
    now: Date;
  },
): Promise<{ target: MonitorTargetRow; created: boolean; jobId: string | null }> {
  const intervalMode = input.intervalMode ?? (input.type === 'dynamic' ? 'fixed' : 'auto');
  if (input.type === 'dynamic' && intervalMode !== 'fixed') {
    throw new Error('动态只支持固定间隔，不能使用自动频率');
  }
  const startAt = input.startAt ?? null;
  if (startAt && input.type !== 'video') {
    throw new Error('只有视频监控支持计划开始时间');
  }
  const firstRunAt = effectiveFirstRunAt(input.now, startAt);
  const dueNow = firstRunAt.getTime() <= input.now.getTime();
  return sql.begin(async (tx) => {
    const inserted = await tx<TargetSqlRow[]>`
      INSERT INTO monitor_targets (
        id, "type", external_id, label, tags, enabled, interval_minutes, interval_mode,
        start_at, next_run_at, source
      ) VALUES (
        ${input.id}::uuid,
        ${input.type},
        ${input.externalId},
        ${input.label},
        ${pgTextArray(input.tags)}::text[],
        true,
        ${input.intervalMinutes},
        ${intervalMode},
        ${startAt},
        ${firstRunAt},
        'offline'
      )
      ON CONFLICT ("type", external_id) WHERE deleted_at IS NULL
      DO NOTHING
      RETURNING ${tx.unsafe(targetColumns)}
    `;
    const createdRow = inserted[0];
    if (!createdRow) {
      const existing = await tx<TargetSqlRow[]>`
        SELECT ${tx.unsafe(targetColumns)}
        FROM monitor_targets
        WHERE "type" = ${input.type}
          AND external_id = ${input.externalId}
          AND deleted_at IS NULL
      `;
      const row = existing[0];
      if (!row) throw new Error('监控项冲突后未能读回既有记录');
      return { target: mapTarget(row), created: false, jobId: null };
    }
    if (!dueNow) {
      return { target: mapTarget(createdRow), created: true, jobId: null };
    }
    const jobId = crypto.randomUUID();
    await tx`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
      VALUES (${jobId}::uuid, ${createdRow.id}::uuid, 'pending', 0, ${firstRunAt})
    `;
    return { target: mapTarget(createdRow), created: true, jobId };
  });
}

export async function listMonitorTargets(
  sql: Sql,
  input: { page: number; pageSize: number; includeDeleted: boolean },
): Promise<{ items: MonitorTargetRow[]; totalItems: number }> {
  const offset = (input.page - 1) * input.pageSize;
  const countRows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM monitor_targets
    WHERE (${input.includeDeleted}::boolean OR deleted_at IS NULL)
  `;
  const rows = await sql<TargetSqlRow[]>`
    SELECT ${sql.unsafe(targetColumns)}
    FROM monitor_targets
    WHERE (${input.includeDeleted}::boolean OR deleted_at IS NULL)
    ORDER BY created_at DESC, id
    LIMIT ${input.pageSize} OFFSET ${offset}
  `;
  return {
    items: rows.map(mapTarget),
    totalItems: Number(countRows[0]?.count ?? '0'),
  };
}

async function insertJobIfIdle(
  sql: Queryable,
  targetId: string,
  scheduledFor: Date,
): Promise<string | null> {
  const busy = await sql<{ id: string }[]>`
    SELECT id::text AS id
    FROM collector_jobs
    WHERE target_id = ${targetId}::uuid
      AND status IN ('pending', 'running')
    LIMIT 1
  `;
  if (busy.length > 0) return null;
  const jobId = crypto.randomUUID();
  const inserted = await sql<{ id: string }[]>`
    INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
    VALUES (${jobId}::uuid, ${targetId}::uuid, 'pending', 0, ${scheduledFor})
    ON CONFLICT (target_id, scheduled_for) DO NOTHING
    RETURNING id::text AS id
  `;
  return inserted[0]?.id ?? null;
}

async function lockMonitorTarget(tx: Queryable, id: string): Promise<MonitorTargetRow | null> {
  const rows = await tx<TargetSqlRow[]>`
    SELECT ${tx.unsafe(targetColumns)}
    FROM monitor_targets
    WHERE id = ${id}::uuid
    FOR UPDATE
  `;
  const row = rows[0];
  return row ? mapTarget(row) : null;
}

async function hasRunningJob(tx: Queryable, targetId: string): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    SELECT id::text AS id
    FROM collector_jobs
    WHERE target_id = ${targetId}::uuid AND status = 'running'
    LIMIT 1
    FOR UPDATE
  `;
  return rows.length > 0;
}

/**
 * Align pending jobs to a single schedule instant without deleting rows.
 * Failed retries leave collector_runs pointing at the same pending job id;
 * DELETE would violate collector_runs_job_id_fkey. Extras (rare) are parked
 * far ahead with unique scheduled_for so only one effective execution remains.
 */
async function realignPendingJobs(
  tx: Queryable,
  targetId: string,
  scheduledFor: Date,
  createIfMissing: boolean,
): Promise<string | null> {
  const pending = await tx<{ id: string }[]>`
    SELECT id::text AS id
    FROM collector_jobs
    WHERE target_id = ${targetId}::uuid AND status = 'pending'
    ORDER BY scheduled_for ASC, id ASC
    FOR UPDATE
  `;
  if (pending.length === 0) {
    if (!createIfMissing) return null;
    return insertJobIfIdle(tx, targetId, scheduledFor);
  }

  // Park non-primary pendings first so the primary can take scheduledFor uniquely.
  for (let i = 1; i < pending.length; i += 1) {
    const parkAt = new Date(Date.UTC(2099, 0, 1, 0, 0, i));
    await tx`
      UPDATE collector_jobs
      SET scheduled_for = ${parkAt}, updated_at = statement_timestamp()
      WHERE id = ${pending[i]!.id}::uuid AND status = 'pending'
    `;
  }

  const primaryId = pending[0]!.id;
  await tx`
    UPDATE collector_jobs
    SET scheduled_for = ${scheduledFor}, updated_at = statement_timestamp()
    WHERE id = ${primaryId}::uuid AND status = 'pending'
  `;
  return primaryId;
}

/** Optional test hooks for controlled lock-ordering races. Production omits these. */
export type MonitorScheduleHooks = {
  afterTargetLocked?: () => Promise<void>;
  afterDueTargetsLocked?: () => Promise<void>;
};

export async function updateMonitorTarget(
  sql: Sql,
  id: string,
  patch: {
    enabled?: boolean;
    intervalMinutes?: number;
    intervalMode?: 'auto' | 'fixed';
    tags?: string[];
    label?: string;
    /** Present = change plan. Explicit null clears plan (immediate). */
    startAt?: Date | null;
  },
  now: Date,
  hooks?: MonitorScheduleHooks,
): Promise<{
  status: UpdateMonitorTargetStatus;
  target: MonitorTargetRow | null;
  jobId: string | null;
}> {
  return sql.begin(async (tx) => {
    const existing = await lockMonitorTarget(tx, id);
    if (!existing) return { status: 'missing', target: null, jobId: null };
    if (existing.deletedAt) return { status: 'deleted', target: existing, jobId: null };
    if (hooks?.afterTargetLocked) await hooks.afterTargetLocked();
    if (existing.type === 'dynamic' && patch.intervalMode === 'auto') {
      throw new Error('动态只支持固定间隔，不能使用自动频率');
    }

    const reschedule = 'startAt' in patch;
    if (reschedule) {
      if (existing.type !== 'video') {
        return { status: 'invalid_start_type', target: existing, jobId: null };
      }
      if (existing.lastSuccessAt) {
        return { status: 'already_started', target: existing, jobId: null };
      }
      if (await hasRunningJob(tx, id)) {
        return { status: 'running', target: existing, jobId: null };
      }
    }

    const enabled = patch.enabled ?? null;
    const interval = patch.intervalMinutes ?? null;
    const intervalMode = patch.intervalMode ?? null;
    const label = patch.label ?? null;
    const tags = patch.tags === undefined ? null : pgTextArray(patch.tags);
    const resume = patch.enabled === true && !existing.enabled;
    const pause = patch.enabled === false && existing.enabled;

    const nextStartAt = reschedule ? (patch.startAt ?? null) : existing.startAt;
    const firstRunAt = effectiveFirstRunAt(now, nextStartAt);
    const dueNow = firstRunAt.getTime() <= now.getTime();

    // Resume respects max(now, startAt). Pause never auto-resumes on reschedule.
    let nextRunAt: Date | null = existing.nextRunAt;
    let touchSchedule = false;
    if (reschedule) {
      touchSchedule = true;
      nextRunAt = firstRunAt;
    } else if (resume) {
      touchSchedule = true;
      nextRunAt = firstRunAt;
    } else if (pause) {
      // Keep next_run_at; pending jobs stay but claim/enqueue gate on enabled.
      nextRunAt = existing.nextRunAt;
    }

    const rows = await tx<TargetSqlRow[]>`
      UPDATE monitor_targets SET
        enabled = COALESCE(${enabled}::boolean, enabled),
        interval_minutes = COALESCE(${interval}::int, interval_minutes),
        interval_mode = COALESCE(${intervalMode}::text, interval_mode),
        label = COALESCE(${label}::text, label),
        tags = COALESCE(${tags}::text[], tags),
        start_at = CASE
          WHEN ${reschedule}::boolean THEN ${nextStartAt}
          ELSE start_at
        END,
        next_run_at = CASE
          WHEN ${touchSchedule}::boolean THEN ${nextRunAt}
          ELSE next_run_at
        END,
        updated_at = now()
      WHERE id = ${id}::uuid AND deleted_at IS NULL
      RETURNING ${tx.unsafe(targetColumns)}
    `;
    const row = rows[0];
    if (!row) return { status: 'deleted', target: existing, jobId: null };

    let jobId: string | null = null;
    const after = mapTarget(row);
    if (reschedule) {
      // Always realign pendings to firstRunAt (may be future). Only insert when due+enabled.
      const createIfMissing = after.enabled && dueNow;
      jobId = await realignPendingJobs(tx, id, firstRunAt, createIfMissing);
    } else if (resume) {
      jobId = await realignPendingJobs(tx, id, firstRunAt, dueNow);
    }
    return { status: 'updated', target: after, jobId };
  });
}

export async function softDeleteMonitorTarget(
  sql: Sql,
  id: string,
): Promise<{ status: 'missing' | 'deleted' | 'removed'; target: MonitorTargetRow | null }> {
  const rows = await sql<TargetSqlRow[]>`
    UPDATE monitor_targets
    SET deleted_at = now(), enabled = false, updated_at = now()
    WHERE id = ${id}::uuid AND deleted_at IS NULL
    RETURNING ${sql.unsafe(targetColumns)}
  `;
  const removed = rows[0];
  if (removed) return { status: 'removed', target: mapTarget(removed) };
  const existing = await getMonitorTarget(sql, id);
  if (!existing) return { status: 'missing', target: null };
  return { status: 'deleted', target: existing };
}

export async function enqueueDueCollectorJobs(
  sql: Sql,
  hooks?: MonitorScheduleHooks,
): Promise<number> {
  // Lock due targets first (same order as reschedule/claim) so a concurrent
  // updateMonitorTarget cannot leave an old-snapshot pending beside a new one.
  return sql.begin(async (tx) => {
    const due = await tx<
      { id: string; next_run_at: Date; start_at: Date | null; enabled: boolean }[]
    >`
      SELECT t.id::text AS id, t.next_run_at, t.start_at, t.enabled
      FROM monitor_targets t
      WHERE t.deleted_at IS NULL
        AND t.enabled = true
        AND t.next_run_at IS NOT NULL
        AND t.next_run_at <= statement_timestamp()
        AND (t.start_at IS NULL OR t.start_at <= statement_timestamp())
        AND NOT EXISTS (
          SELECT 1 FROM collector_jobs j
          WHERE j.target_id = t.id AND j.status IN ('pending', 'running')
        )
      ORDER BY t.next_run_at ASC, t.id ASC
      FOR UPDATE OF t
    `;
    if (hooks?.afterDueTargetsLocked) await hooks.afterDueTargetsLocked();

    let inserted = 0;
    for (const row of due) {
      if (!row.enabled) continue;
      if (row.next_run_at.getTime() > Date.now()) continue;
      if (row.start_at && row.start_at.getTime() > Date.now()) continue;
      const busy = await tx<{ id: string }[]>`
        SELECT id::text AS id
        FROM collector_jobs
        WHERE target_id = ${row.id}::uuid
          AND status IN ('pending', 'running')
        LIMIT 1
      `;
      if (busy.length > 0) continue;
      const jobId = crypto.randomUUID();
      const created = await tx<{ id: string }[]>`
        INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
        VALUES (${jobId}::uuid, ${row.id}::uuid, 'pending', 0, ${row.next_run_at})
        ON CONFLICT (target_id, scheduled_for) DO NOTHING
        RETURNING id::text AS id
      `;
      if (created[0]?.id) inserted += 1;
    }
    return inserted;
  });
}

export async function claimNextCollectorJob(sql: Sql): Promise<ClaimedCollectorJob | null> {
  const rows = await sql<
    {
      id: string;
      target_id: string;
      attempts: number;
      scheduled_for: Date;
      type: MonitorTargetType;
      external_id: string;
      account_id: string | null;
    }[]
  >`
    WITH candidate AS (
      SELECT j.id, j.target_id
      FROM collector_jobs j
      JOIN monitor_targets t ON t.id = j.target_id
      WHERE j.status = 'pending'
        AND j.scheduled_for <= statement_timestamp()
        AND t.enabled = true
        AND t.deleted_at IS NULL
        AND (t.start_at IS NULL OR t.start_at <= statement_timestamp())
      ORDER BY j.scheduled_for, j.id
      FOR UPDATE OF j, t SKIP LOCKED
      LIMIT 1
    )
    UPDATE collector_jobs AS job
    SET status = 'running',
        started_at = statement_timestamp(),
        attempts = job.attempts + 1,
        error = NULL,
        updated_at = statement_timestamp()
    FROM candidate
    JOIN monitor_targets t ON t.id = candidate.target_id
    WHERE job.id = candidate.id
      AND (t.start_at IS NULL OR t.start_at <= statement_timestamp())
      AND t.enabled = true
      AND t.deleted_at IS NULL
    RETURNING job.id::text AS id,
      job.target_id::text AS target_id,
      job.attempts,
      job.scheduled_for,
      t."type" AS type,
      t.external_id,
      t.account_id::text AS account_id
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    targetId: row.target_id,
    targetType: row.type,
    externalId: row.external_id,
    attempts: row.attempts,
    scheduledFor: row.scheduled_for,
    accountId: row.account_id,
  };
}

export type SampleSource = 'import' | 'legacy_csv' | 'bilibili';

export type VideoSampleWrite = {
  bvid: string;
  title: string | null;
  sampledAt: Date;
  rawTime: string;
  sourceTimezone: string;
  timestampPrecision: 'minute' | 'second';
  viewCount: bigint | null;
  onlineViewers: bigint | null;
  onlineViewersRaw: string | null;
  likeCount: bigint | null;
  coinCount: bigint | null;
  favoriteCount: bigint | null;
  shareCount: bigint | null;
  danmakuCount: bigint | null;
  commentCount: bigint | null;
  source?: SampleSource;
  accountId?: string | null;
  collectorRunId?: string | null;
  collectedAt?: Date | null;
  extra?: Record<string, unknown>;
  cid?: string | null;
  pubdate?: Date | null;
  ownerMid?: string | null;
  ownerName?: string | null;
  coverUrl?: string | null;
  /** Present only when this sample came from a view payload. Empty names stay null. */
  partition?: {
    tid: number | null;
    tidV2: number | null;
    tname: string;
    tnameV2: string;
  };
};

function bigintText(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

function jsonValue(value: Record<string, unknown>): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

export async function writeVideoSampleWithin(
  tx: Queryable,
  sample: VideoSampleWrite,
): Promise<boolean> {
  const metadata: Record<string, unknown> = sample.coverUrl ? { pic: sample.coverUrl } : {};
  const hasPartition = sample.partition !== undefined;
  const partitionName = hasPartition
    ? partitionNameFromLabels(sample.partition?.tnameV2, sample.partition?.tname)
    : null;
  if (sample.partition) {
    metadata.tid = sample.partition.tid;
    metadata.tid_v2 = sample.partition.tidV2;
    metadata.tname = sample.partition.tname;
    metadata.tname_v2 = sample.partition.tnameV2;
  }
  if (sample.ownerMid) {
    await tx`
      INSERT INTO creators (mid, uname)
      VALUES (${sample.ownerMid}::bigint, ${sample.ownerName ?? null})
      ON CONFLICT (mid) DO UPDATE SET
        uname = COALESCE(EXCLUDED.uname, creators.uname),
        updated_at = now()
    `;
  }
  await tx`
    INSERT INTO videos (
      bvid, title, monitoring_enabled, mid, cid, pubdate, tid, tid_v2, partition_name, metadata
    )
    VALUES (
      ${sample.bvid},
      ${sample.title},
      true,
      ${sample.ownerMid ?? null}::bigint,
      ${sample.cid ?? null}::bigint,
      ${sample.pubdate ?? null},
      ${hasPartition ? (sample.partition?.tid ?? null) : null},
      ${hasPartition ? (sample.partition?.tidV2 ?? null) : null},
      ${partitionName},
      ${tx.json(jsonValue(metadata))}
    )
    ON CONFLICT (bvid) DO UPDATE SET
      monitoring_enabled = true,
      title = COALESCE(EXCLUDED.title, videos.title),
      mid = COALESCE(EXCLUDED.mid, videos.mid),
      cid = COALESCE(EXCLUDED.cid, videos.cid),
      pubdate = COALESCE(EXCLUDED.pubdate, videos.pubdate),
      tid = CASE
        WHEN ${hasPartition}::boolean THEN COALESCE(EXCLUDED.tid, videos.tid)
        ELSE videos.tid
      END,
      tid_v2 = CASE
        WHEN ${hasPartition}::boolean THEN COALESCE(EXCLUDED.tid_v2, videos.tid_v2)
        ELSE videos.tid_v2
      END,
      partition_name = CASE
        WHEN ${hasPartition}::boolean THEN COALESCE(EXCLUDED.partition_name, videos.partition_name)
        ELSE videos.partition_name
      END,
      metadata = videos.metadata || EXCLUDED.metadata,
      updated_at = now()
  `;
  const rows = await tx<{ id: string }[]>`
    INSERT INTO video_metric_samples (
      bvid, sampled_at, source_timezone, raw_time, timestamp_precision,
      view_count, online_viewers, online_viewers_raw, like_count, coin_count,
      favorite_count, share_count, danmaku_count, comment_count,
      source, account_id, collector_run_id, collected_at, extra
    ) VALUES (
      ${sample.bvid},
      ${sample.sampledAt},
      ${sample.sourceTimezone},
      ${sample.rawTime},
      ${sample.timestampPrecision},
      ${bigintText(sample.viewCount)}::bigint,
      ${bigintText(sample.onlineViewers)}::bigint,
      ${sample.onlineViewersRaw},
      ${bigintText(sample.likeCount)}::bigint,
      ${bigintText(sample.coinCount)}::bigint,
      ${bigintText(sample.favoriteCount)}::bigint,
      ${bigintText(sample.shareCount)}::bigint,
      ${bigintText(sample.danmakuCount)}::bigint,
      ${bigintText(sample.commentCount)}::bigint,
      ${sample.source ?? 'import'},
      ${sample.accountId ?? null}::uuid,
      ${sample.collectorRunId ?? null}::uuid,
      ${sample.collectedAt ?? null},
      ${tx.json(jsonValue(sample.extra ?? {}))}
    )
    ON CONFLICT (bvid, sampled_at) DO NOTHING
    RETURNING id::text AS id
  `;
  return rows.length > 0;
}

export async function writeVideoSample(sql: Sql, sample: VideoSampleWrite): Promise<boolean> {
  return sql.begin(async (tx) => writeVideoSampleWithin(tx, sample));
}

export type CreatorSampleWrite = {
  mid: string;
  uname: string | null;
  sampledAt: Date;
  rawTime: string;
  sourceTimezone: string;
  timestampPrecision: 'minute' | 'second';
  followerCount: bigint;
  followingCount?: bigint | null;
  source?: SampleSource;
  accountId?: string | null;
  collectorRunId?: string | null;
  collectedAt?: Date | null;
  extra?: Record<string, unknown>;
};

export async function writeCreatorSampleWithin(
  tx: Queryable,
  sample: CreatorSampleWrite,
): Promise<boolean> {
  await tx`
    INSERT INTO creators (mid, uname, monitoring_enabled)
    VALUES (${sample.mid}::bigint, ${sample.uname}, true)
    ON CONFLICT (mid) DO UPDATE SET
      monitoring_enabled = true,
      uname = COALESCE(EXCLUDED.uname, creators.uname),
      updated_at = now()
  `;
  const rows = await tx<{ id: string }[]>`
    INSERT INTO creator_follower_samples (
      mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count,
      following_count, source, account_id, collector_run_id, collected_at, extra
    ) VALUES (
      ${sample.mid}::bigint,
      ${sample.sampledAt},
      ${sample.sourceTimezone},
      ${sample.rawTime},
      ${sample.timestampPrecision},
      ${sample.followerCount.toString()}::bigint,
      ${bigintText(sample.followingCount ?? null)}::bigint,
      ${sample.source ?? 'import'},
      ${sample.accountId ?? null}::uuid,
      ${sample.collectorRunId ?? null}::uuid,
      ${sample.collectedAt ?? null},
      ${tx.json(jsonValue(sample.extra ?? {}))}
    )
    ON CONFLICT (mid, sampled_at) DO NOTHING
    RETURNING id::text AS id
  `;
  return rows.length > 0;
}

export async function writeCreatorSample(sql: Sql, sample: CreatorSampleWrite): Promise<boolean> {
  return sql.begin(async (tx) => writeCreatorSampleWithin(tx, sample));
}

export type TargetScheduleContext = {
  type: MonitorTargetType;
  intervalMode: 'auto' | 'fixed';
  intervalMinutes: number;
  pubdate: Date | null;
};

export type CollectorScheduleWrite = {
  minutes: number;
  persistMinutes: boolean;
};

export async function readTargetSchedule(
  sql: Queryable,
  targetId: string,
): Promise<TargetScheduleContext | null> {
  const rows = await sql<
    {
      type: MonitorTargetType;
      interval_mode: 'auto' | 'fixed';
      interval_minutes: number;
      pubdate: Date | null;
    }[]
  >`
    SELECT t.type, t.interval_mode, t.interval_minutes,
      CASE WHEN t.type = 'video' THEN v.pubdate ELSE NULL END AS pubdate
    FROM monitor_targets t
    LEFT JOIN videos v ON t.type = 'video' AND v.bvid = t.external_id
    WHERE t.id = ${targetId}::uuid
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    type: row.type,
    intervalMode: row.interval_mode,
    intervalMinutes: row.interval_minutes,
    pubdate: row.pubdate,
  };
}

export async function applyTargetSchedule(
  tx: Queryable,
  input: {
    targetId: string;
    finished: Date;
    success: boolean;
    error: string | null;
    schedule: CollectorScheduleWrite | null;
  },
): Promise<void> {
  const minutes = input.schedule?.minutes ?? null;
  const persist = input.schedule?.persistMinutes ?? false;
  if (input.success) {
    await tx`
      UPDATE monitor_targets
      SET last_run_at = ${input.finished},
          last_success_at = ${input.finished},
          last_error = NULL,
          interval_minutes = CASE
            WHEN ${persist}::boolean AND ${minutes}::int IS NOT NULL THEN ${minutes}::int
            ELSE interval_minutes
          END,
          next_run_at = ${input.finished} + (
            COALESCE(${minutes}::int, interval_minutes) * interval '1 minute'
          ),
          updated_at = ${input.finished}
      WHERE id = ${input.targetId}::uuid
    `;
    return;
  }
  await tx`
    UPDATE monitor_targets
    SET last_run_at = ${input.finished},
        last_error = ${input.error},
        interval_minutes = CASE
          WHEN ${persist}::boolean AND ${minutes}::int IS NOT NULL THEN ${minutes}::int
          ELSE interval_minutes
        END,
        next_run_at = ${input.finished} + (
          COALESCE(${minutes}::int, interval_minutes) * interval '1 minute'
        ),
        updated_at = ${input.finished}
    WHERE id = ${input.targetId}::uuid
  `;
}

export async function recordCollectorSuccess(
  sql: Sql,
  input: {
    jobId: string;
    targetId: string;
    samplesWritten: number;
    durationMs: number;
    startedAt: Date;
    schedule?: CollectorScheduleWrite;
  },
): Promise<{ runId: string }> {
  const runId = crypto.randomUUID();
  await sql.begin(async (tx) => {
    // Lock target before job so order matches reschedule (target → job).
    await lockMonitorTarget(tx, input.targetId);
    const finished = new Date();
    await tx`
      UPDATE collector_jobs
      SET status = 'succeeded', finished_at = ${finished}, error = NULL, updated_at = ${finished}
      WHERE id = ${input.jobId}::uuid
    `;
    await tx`
      INSERT INTO collector_runs (
        id, job_id, target_id, status, samples_written, duration_ms, error, started_at, finished_at
      ) VALUES (
        ${runId}::uuid,
        ${input.jobId}::uuid,
        ${input.targetId}::uuid,
        'succeeded',
        ${input.samplesWritten},
        ${input.durationMs},
        NULL,
        ${input.startedAt},
        ${finished}
      )
    `;
    await applyTargetSchedule(tx, {
      targetId: input.targetId,
      finished,
      success: true,
      error: null,
      schedule: input.schedule ?? null,
    });
  });
  return { runId };
}

export async function recordCollectorFailure(
  sql: Sql,
  input: {
    jobId: string;
    targetId: string;
    attempts: number;
    maxAttempts: number;
    error: string;
    durationMs: number;
    startedAt: Date;
    retryAt: Date | null;
    schedule?: CollectorScheduleWrite;
  },
): Promise<{ terminal: boolean; runId: string }> {
  const retryAt = input.retryAt;
  const terminal = input.attempts >= input.maxAttempts || retryAt === null;
  const runId = crypto.randomUUID();
  await sql.begin(async (tx) => {
    // Target before job: same order as updateMonitorTarget / hasRunningJob.
    await lockMonitorTarget(tx, input.targetId);
    const finished = new Date();
    if (terminal) {
      await tx`
        UPDATE collector_jobs
        SET status = 'failed',
            finished_at = ${finished},
            error = ${input.error},
            updated_at = ${finished}
        WHERE id = ${input.jobId}::uuid
      `;
      await applyTargetSchedule(tx, {
        targetId: input.targetId,
        finished,
        success: false,
        error: input.error,
        schedule: input.schedule ?? null,
      });
    } else {
      if (!retryAt) throw new Error('重试时间缺失');
      await tx`
        UPDATE collector_jobs
        SET status = 'pending',
            scheduled_for = ${retryAt},
            started_at = NULL,
            finished_at = NULL,
            error = ${input.error},
            updated_at = ${finished}
        WHERE id = ${input.jobId}::uuid
      `;
      await tx`
        UPDATE monitor_targets
        SET last_run_at = ${finished},
            last_error = ${input.error},
            next_run_at = ${retryAt},
            updated_at = ${finished}
        WHERE id = ${input.targetId}::uuid
      `;
    }
    await tx`
      INSERT INTO collector_runs (
        id, job_id, target_id, status, samples_written, duration_ms, error, started_at, finished_at
      ) VALUES (
        ${runId}::uuid,
        ${input.jobId}::uuid,
        ${input.targetId}::uuid,
        'failed',
        0,
        ${input.durationMs},
        ${input.error},
        ${input.startedAt},
        ${finished}
      )
    `;
  });
  return { terminal, runId };
}

type JobSqlRow = {
  id: string;
  target_id: string;
  target_type: MonitorTargetType;
  external_id: string;
  status: CollectorJobStatus;
  attempts: number;
  scheduled_for: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
  run_id: string | null;
  run_status: 'succeeded' | 'failed' | null;
  samples_written: number | null;
  duration_ms: number | null;
  run_error: string | null;
  run_finished_at: Date | null;
};

function mapJob(row: JobSqlRow): CollectorJobRow {
  return {
    id: row.id,
    targetId: row.target_id,
    targetType: row.target_type,
    externalId: row.external_id,
    status: row.status,
    attempts: row.attempts,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
    latestRun:
      row.run_id &&
      row.run_status &&
      row.run_finished_at &&
      row.samples_written != null &&
      row.duration_ms != null
        ? {
            id: row.run_id,
            status: row.run_status,
            samplesWritten: row.samples_written,
            durationMs: row.duration_ms,
            error: row.run_error,
            finishedAt: row.run_finished_at,
          }
        : null,
  };
}

const jobSelect = `
  SELECT j.id::text AS id,
    j.target_id::text AS target_id,
    t."type" AS target_type,
    t.external_id,
    j.status,
    j.attempts,
    j.scheduled_for,
    j.started_at,
    j.finished_at,
    j.error,
    r.id::text AS run_id,
    r.status AS run_status,
    r.samples_written,
    r.duration_ms,
    r.error AS run_error,
    r.finished_at AS run_finished_at
  FROM collector_jobs j
  JOIN monitor_targets t ON t.id = j.target_id
  LEFT JOIN LATERAL (
    SELECT id, status, samples_written, duration_ms, error, finished_at
    FROM collector_runs
    WHERE job_id = j.id
    ORDER BY finished_at DESC
    LIMIT 1
  ) r ON TRUE
`;

export async function getCollectorJob(sql: Queryable, id: string): Promise<CollectorJobRow | null> {
  const rows = await sql<JobSqlRow[]>`
    ${sql.unsafe(jobSelect)}
    WHERE j.id = ${id}::uuid
  `;
  const row = rows[0];
  return row ? mapJob(row) : null;
}

export async function listCollectorJobs(
  sql: Sql,
  input: { page: number; pageSize: number },
): Promise<{ items: CollectorJobRow[]; totalItems: number }> {
  const offset = (input.page - 1) * input.pageSize;
  const countRows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM collector_jobs
  `;
  const rows = await sql<JobSqlRow[]>`
    ${sql.unsafe(jobSelect)}
    ORDER BY j.scheduled_for DESC, j.created_at DESC
    LIMIT ${input.pageSize} OFFSET ${offset}
  `;
  return {
    items: rows.map(mapJob),
    totalItems: Number(countRows[0]?.count ?? '0'),
  };
}

export async function requestCollectorRun(
  sql: Sql,
  targetId: string,
  now: Date,
): Promise<
  | { status: 'missing' | 'deleted' | 'before_start'; job: null }
  | { status: 'queued'; job: CollectorJobRow; created: boolean }
> {
  return sql.begin(async (tx) => {
    const target = await lockMonitorTarget(tx, targetId);
    if (!target) return { status: 'missing' as const, job: null };
    if (target.deletedAt) return { status: 'deleted' as const, job: null };
    if (target.startAt && target.startAt.getTime() > now.getTime()) {
      return { status: 'before_start' as const, job: null };
    }
    const jobId = crypto.randomUUID();
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
      VALUES (${jobId}::uuid, ${targetId}::uuid, 'pending', 0, ${now})
      ON CONFLICT (target_id, scheduled_for) DO NOTHING
      RETURNING id::text AS id
    `;
    const id = inserted[0]?.id;
    if (!id) {
      const existing = await tx<{ id: string }[]>`
        SELECT id::text AS id
        FROM collector_jobs
        WHERE target_id = ${targetId}::uuid AND scheduled_for = ${now}
      `;
      const existingId = existing[0]?.id;
      if (!existingId) throw new Error('采集任务冲突后未能读回');
      const job = await getCollectorJob(tx, existingId);
      if (!job) throw new Error('采集任务冲突后未能读回');
      return { status: 'queued' as const, job, created: false };
    }
    const job = await getCollectorJob(tx, id);
    if (!job) throw new Error('采集任务写入后未能读回');
    return { status: 'queued' as const, job, created: true };
  });
}

export async function refreshCollectorHeartbeat(sql: Sql, instanceId: string): Promise<void> {
  await sql`
    UPDATE collector_heartbeats
    SET last_seen_at = statement_timestamp(), updated_at = statement_timestamp()
    WHERE instance_id = ${instanceId}
  `;
}

export async function upsertCollectorHeartbeat(
  sql: Sql,
  input: {
    instanceId: string;
    status: 'starting' | 'idle' | 'running' | 'stopped';
    currentJobId: string | null;
  },
): Promise<void> {
  await sql`
    INSERT INTO collector_heartbeats (instance_id, last_seen_at, status, current_job_id)
    VALUES (${input.instanceId}, statement_timestamp(), ${input.status}, ${input.currentJobId})
    ON CONFLICT (instance_id) DO UPDATE SET
      last_seen_at = statement_timestamp(),
      status = EXCLUDED.status,
      current_job_id = EXCLUDED.current_job_id,
      updated_at = statement_timestamp()
  `;
}

export async function countSamplesAt(
  sql: Sql,
  input:
    | { kind: 'video'; externalId: string; sampledAt: Date }
    | { kind: 'creator'; externalId: string; sampledAt: Date },
): Promise<number> {
  if (input.kind === 'video') {
    const rows = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM video_metric_samples
      WHERE bvid = ${input.externalId} AND sampled_at = ${input.sampledAt}
    `;
    return Number(rows[0]?.count ?? '0');
  }
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM creator_follower_samples
    WHERE mid = ${input.externalId}::bigint AND sampled_at = ${input.sampledAt}
  `;
  return Number(rows[0]?.count ?? '0');
}
