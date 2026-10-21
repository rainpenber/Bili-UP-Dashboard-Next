import type postgres from 'postgres';
import type { Sql } from './client';

type Queryable = postgres.Sql | postgres.TransactionSql;
type Tx = postgres.TransactionSql;

export type CollectorJobStatus = 'pending' | 'running' | 'succeeded' | 'failed';
export type MonitorTargetType = 'video' | 'creator' | 'dynamic';

/** Terminal message when a redundant pending is closed without inventing a collection failure run. */
export const SUPERSEDED_ACTIVE_JOB_ERROR = '被新的任务安排取代，不再执行';

/**
 * Narrow test-only hooks. Production callers omit these; do not expose as product API.
 * Fired after parent rows are locked (target, then job when applicable), before mutations.
 */
export type CollectorTargetTxHooks = {
  afterParentRowsLocked?: () => Promise<void>;
  /** After sample write inside a success commit, before closing the run — tests only. */
  afterSampleWritten?: () => Promise<void>;
};

/** Postgres SQLSTATE when FOR UPDATE NOWAIT cannot take a row lock. */
export const PG_LOCK_NOT_AVAILABLE = '55P03';

/**
 * Pick a scheduled_for that does not collide with UNIQUE(target_id, scheduled_for).
 * Preserves history rows; never parks at a far-future sentinel.
 */
export async function allocateUniqueScheduledFor(
  tx: Queryable,
  targetId: string,
  desired: Date,
  excludeJobId?: string | null,
): Promise<Date> {
  for (let n = 0; n < 10_000; n += 1) {
    const candidate = new Date(desired.getTime() + n);
    const rows = excludeJobId
      ? await tx<{ id: string }[]>`
          SELECT id::text AS id
          FROM collector_jobs
          WHERE target_id = ${targetId}::uuid
            AND scheduled_for = ${candidate}
            AND id <> ${excludeJobId}::uuid
          LIMIT 1
        `
      : await tx<{ id: string }[]>`
          SELECT id::text AS id
          FROM collector_jobs
          WHERE target_id = ${targetId}::uuid
            AND scheduled_for = ${candidate}
          LIMIT 1
        `;
    if (rows.length === 0) return candidate;
  }
  throw new Error('无法分配不冲突的 scheduled_for');
}

export function isLockNotAvailableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
  return code === PG_LOCK_NOT_AVAILABLE;
}

export type LockedMonitorTarget = {
  id: string;
  type: MonitorTargetType;
  externalId: string;
  label: string;
  tags: string[];
  enabled: boolean;
  intervalMinutes: number;
  intervalMode: 'auto' | 'fixed';
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  source: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

export type LockedCollectorJob = {
  id: string;
  targetId: string;
  status: CollectorJobStatus;
  attempts: number;
  scheduledFor: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
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
  next_run_at: Date | null;
  last_run_at: Date | null;
  last_success_at: Date | null;
  last_error: string | null;
  source: string;
  created_at: Date;
  updated_at: Date;
  deleted_at: Date | null;
};

type JobLockSqlRow = {
  id: string;
  target_id: string;
  status: CollectorJobStatus;
  attempts: number;
  scheduled_for: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error: string | null;
};

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

function mapTarget(row: TargetSqlRow): LockedMonitorTarget {
  return {
    id: row.id,
    type: row.type,
    externalId: row.external_id,
    label: row.label,
    tags: readTags(row.tags),
    enabled: row.enabled,
    intervalMinutes: row.interval_minutes,
    intervalMode: row.interval_mode,
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

function mapLockedJob(row: JobLockSqlRow): LockedCollectorJob {
  return {
    id: row.id,
    targetId: row.target_id,
    status: row.status,
    attempts: row.attempts,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    error: row.error,
  };
}

const targetColumns = `
  id, "type", external_id, label, tags, enabled, interval_minutes, interval_mode,
  next_run_at, last_run_at, last_success_at, last_error, source,
  created_at, updated_at, deleted_at
`;

/** Lock one monitor_targets row. Callers that touch multiple targets must sort ids first. */
export async function lockMonitorTargetForUpdate(
  tx: Queryable,
  targetId: string,
): Promise<LockedMonitorTarget | null> {
  const rows = await tx<TargetSqlRow[]>`
    SELECT ${tx.unsafe(targetColumns)}
    FROM monitor_targets
    WHERE id = ${targetId}::uuid
    FOR UPDATE
  `;
  const row = rows[0];
  return row ? mapTarget(row) : null;
}

export async function lockCollectorJobForUpdate(
  tx: Queryable,
  jobId: string,
): Promise<LockedCollectorJob | null> {
  const rows = await tx<JobLockSqlRow[]>`
    SELECT id::text AS id,
      target_id::text AS target_id,
      status,
      attempts,
      scheduled_for,
      started_at,
      finished_at,
      error
    FROM collector_jobs
    WHERE id = ${jobId}::uuid
    FOR UPDATE
  `;
  const row = rows[0];
  return row ? mapLockedJob(row) : null;
}

export async function listActiveJobsForUpdate(
  tx: Queryable,
  targetId: string,
): Promise<LockedCollectorJob[]> {
  const rows = await tx<JobLockSqlRow[]>`
    SELECT id::text AS id,
      target_id::text AS target_id,
      status,
      attempts,
      scheduled_for,
      started_at,
      finished_at,
      error
    FROM collector_jobs
    WHERE target_id = ${targetId}::uuid
      AND status IN ('pending', 'running')
    ORDER BY
      CASE status WHEN 'running' THEN 0 ELSE 1 END,
      scheduled_for ASC,
      id ASC
    FOR UPDATE
  `;
  return rows.map(mapLockedJob);
}

async function countRunsForJob(tx: Queryable, jobId: string): Promise<number> {
  const rows = await tx<{ count: string }[]>`
    SELECT count(*)::text AS count FROM collector_runs WHERE job_id = ${jobId}::uuid
  `;
  return Number(rows[0]?.count ?? '0');
}

/**
 * Close a redundant pending without fabricating a collection-failure run/sample.
 * Unreferenced pendings are deleted; jobs with runs are terminal-failed in place.
 * Never call on running jobs.
 */
export async function terminateSupersededPending(tx: Queryable, jobId: string): Promise<void> {
  const job = await lockCollectorJobForUpdate(tx, jobId);
  if (!job || job.status !== 'pending') return;
  const runs = await countRunsForJob(tx, jobId);
  if (runs === 0) {
    await tx`
      DELETE FROM collector_jobs
      WHERE id = ${jobId}::uuid AND status = 'pending'
    `;
    return;
  }
  await tx`
    UPDATE collector_jobs
    SET status = 'failed',
        finished_at = statement_timestamp(),
        error = ${SUPERSEDED_ACTIVE_JOB_ERROR},
        updated_at = statement_timestamp()
    WHERE id = ${jobId}::uuid AND status = 'pending'
  `;
}

function pickKeeper(
  active: LockedCollectorJob[],
  preferJobId: string | null | undefined,
  nextRunAt: Date | null,
): LockedCollectorJob {
  const running = active.filter((job) => job.status === 'running');
  if (running[0]) return running[0];
  if (preferJobId) {
    const preferred = active.find((job) => job.id === preferJobId && job.status === 'pending');
    if (preferred) return preferred;
  }
  if (nextRunAt) {
    const matched = active.find(
      (job) => job.status === 'pending' && job.scheduledFor.getTime() === nextRunAt.getTime(),
    );
    if (matched) return matched;
  }
  const pending = active.find((job) => job.status === 'pending');
  if (pending) return pending;
  return active[0]!;
}

/**
 * Converge when the target row is already locked in this transaction.
 * Locks jobs only after the target (target → job order).
 */
export async function convergeActiveJobsUnderTargetLock(
  tx: Queryable,
  target: LockedMonitorTarget,
  preferJobId?: string | null,
): Promise<string | null> {
  const active = await listActiveJobsForUpdate(tx, target.id);
  if (active.length === 0) return null;
  const keeper = pickKeeper(active, preferJobId, target.nextRunAt);
  for (const job of active) {
    if (job.id === keeper.id) continue;
    if (job.status === 'running') continue;
    await terminateSupersededPending(tx, job.id);
  }
  return keeper.id;
}

/**
 * Ensure at most one effective execution opportunity per target.
 * Running jobs are never failed. Extra pendings are deleted or terminal-failed.
 * Always locks the target first.
 */
export async function convergeActiveJobs(
  tx: Queryable,
  targetId: string,
  preferJobId?: string | null,
): Promise<string | null> {
  const target = await lockMonitorTargetForUpdate(tx, targetId);
  if (!target) return null;
  return convergeActiveJobsUnderTargetLock(tx, target, preferJobId);
}

export async function findActiveJob(
  tx: Queryable,
  targetId: string,
): Promise<LockedCollectorJob | null> {
  const rows = await tx<JobLockSqlRow[]>`
    SELECT id::text AS id,
      target_id::text AS target_id,
      status,
      attempts,
      scheduled_for,
      started_at,
      finished_at,
      error
    FROM collector_jobs
    WHERE target_id = ${targetId}::uuid
      AND status IN ('pending', 'running')
    ORDER BY
      CASE status WHEN 'running' THEN 0 ELSE 1 END,
      scheduled_for ASC,
      id ASC
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapLockedJob(row) : null;
}

/** Target-only transaction: lock monitor_targets before any job/run/sample work. */
export async function withMonitorTargetTransaction<T>(
  sql: Sql,
  targetId: string,
  fn: (tx: Tx, target: LockedMonitorTarget | null) => Promise<T>,
  hooks?: CollectorTargetTxHooks,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    const target = await lockMonitorTargetForUpdate(tx, targetId);
    if (hooks?.afterParentRowsLocked) await hooks.afterParentRowsLocked();
    return fn(tx, target);
  });
  return result as T;
}

/**
 * Target → job lock order before inserting runs or writing samples.
 * Validates job belongs to target and (optionally) is in an allowed status.
 */
export async function withMonitorTargetAndJobTransaction<T>(
  sql: Sql,
  input: {
    targetId: string;
    jobId: string;
    requireStatuses?: readonly CollectorJobStatus[];
  },
  fn: (tx: Tx, ctx: { target: LockedMonitorTarget; job: LockedCollectorJob }) => Promise<T>,
  hooks?: CollectorTargetTxHooks,
): Promise<T> {
  const result = await sql.begin(async (tx) => {
    const target = await lockMonitorTargetForUpdate(tx, input.targetId);
    if (!target) throw new Error('监控目标不存在');
    const job = await lockCollectorJobForUpdate(tx, input.jobId);
    if (!job) throw new Error('采集任务不存在');
    if (job.targetId !== input.targetId) {
      throw new Error('采集任务不属于该监控目标');
    }
    if (input.requireStatuses && !input.requireStatuses.includes(job.status)) {
      throw new Error(`采集任务状态不是 ${input.requireStatuses.join('/')}`);
    }
    if (hooks?.afterParentRowsLocked) await hooks.afterParentRowsLocked();
    return fn(tx, { target, job });
  });
  return result as T;
}

/** Stable multi-target lock helper: always lock by sorted uuid order. */
export async function lockMonitorTargetsInOrder(
  tx: Queryable,
  targetIds: readonly string[],
): Promise<LockedMonitorTarget[]> {
  const unique = [...new Set(targetIds)].sort();
  const locked: LockedMonitorTarget[] = [];
  for (const id of unique) {
    const row = await lockMonitorTargetForUpdate(tx, id);
    if (row) locked.push(row);
  }
  return locked;
}
