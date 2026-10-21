import type { Sql } from './client';
import type { MonitorTargetType } from './monitor-targets';

export type OpsJobReadStatus = 'pending' | 'running' | 'succeeded' | 'failed';

export type OpsJobReadFilter = {
  type: MonitorTargetType | null;
  targetId: string | null;
  externalId: string | null;
  q: string | null;
  status: OpsJobReadStatus | null;
  since: string;
  until: string;
  projectId: string | null;
};

export type OpsJobAttemptRead = {
  id: string;
  status: 'succeeded' | 'failed';
  samplesWritten: number;
  durationMs: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date;
};

export type OpsJobRead = {
  id: string;
  targetId: string;
  targetType: MonitorTargetType;
  externalId: string;
  label: string;
  displayName: string;
  coverUrl: string | null;
  targetDeleted: boolean;
  status: OpsJobReadStatus;
  attempts: number;
  scheduledFor: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  durationMs: number | null;
  samplesWritten: number | null;
  error: string | null;
  latestAttempt: OpsJobAttemptRead | null;
  projects: { id: string; name: string }[];
};

export type OpsJobGroupRead = {
  targetId: string;
  targetType: MonitorTargetType;
  externalId: string;
  label: string;
  displayName: string;
  coverUrl: string | null;
  targetDeleted: boolean;
  matchCount: number;
  jobs: OpsJobRead[];
};

export type OpsAttemptRead = {
  id: string;
  jobId: string;
  targetId: string;
  status: 'succeeded' | 'failed';
  samplesWritten: number;
  durationMs: number;
  error: string | null;
  startedAt: Date;
  finishedAt: Date;
};

export type OpsRequestRead = {
  id: string;
  runId: string | null;
  endpoint: string;
  statusCode: number | null;
  bizCode: number | null;
  durationMs: number;
  error: string | null;
  requestedAt: Date;
};

export type OpsLogRead = {
  id: string;
  ts: Date;
  level: string;
  service: string;
  event: string | null;
  message: string;
  requestId: string | null;
  runId: string | null;
  jobId: string | null;
  targetId: string | null;
  context: unknown;
};

export type OpsOperationRead = {
  id: string;
  ts: Date;
  event: string;
  message: string;
  requestId: string | null;
  targetId: string | null;
  context: unknown;
};

type JobSqlRow = {
  id: string;
  target_id: string;
  target_type: MonitorTargetType;
  external_id: string;
  label: string;
  display_name: string;
  cover_url: string | null;
  target_deleted: boolean;
  status: OpsJobReadStatus;
  attempts: number;
  scheduled_for: Date;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
  samples_written: number | null;
  error: string | null;
  latest_id: string | null;
  latest_status: 'succeeded' | 'failed' | null;
  latest_samples: number | null;
  latest_duration_ms: number | null;
  latest_error: string | null;
  latest_started_at: Date | null;
  latest_finished_at: Date | null;
  projects: unknown;
  match_count?: number;
};

const JOB_FROM = `
  FROM collector_jobs j
  JOIN monitor_targets t ON t.id = j.target_id
  LEFT JOIN videos v ON t.type = 'video' AND v.bvid = t.external_id
  LEFT JOIN creators cr ON t.type = 'creator' AND cr.mid::text = t.external_id
  LEFT JOIN dynamics dyn ON t.type = 'dynamic' AND dyn.dynamic_id = t.external_id
  LEFT JOIN LATERAL (
    SELECT id, status, samples_written, duration_ms, error, started_at, finished_at
    FROM collector_runs
    WHERE job_id = j.id
    ORDER BY finished_at DESC, id DESC
    LIMIT 1
  ) latest ON TRUE
  LEFT JOIN LATERAL (
    SELECT COALESCE(
      jsonb_agg(jsonb_build_object('id', rel.id, 'name', rel.name) ORDER BY rel.name, rel.id),
      '[]'::jsonb
    ) AS projects
    FROM (
      SELECT cp.id::text AS id, cp.name
      FROM project_publish_records r
      JOIN commercial_projects cp ON cp.id = r.project_id
      WHERE t.type = 'video' AND r.bvid = t.external_id
      UNION
      SELECT cp.id::text AS id, cp.name
      FROM project_monitor_contracts m
      JOIN commercial_projects cp ON cp.id = m.project_id
      WHERE t.type = 'video' AND m.bvid = t.external_id
    ) rel
  ) proj ON TRUE
`;

const JOB_SELECT = `
  SELECT
    j.id::text AS id,
    t.id::text AS target_id,
    t.type AS target_type,
    t.external_id,
    t.label,
    COALESCE(
      CASE WHEN t.type = 'video' THEN NULLIF(v.title, '') END,
      CASE WHEN t.type = 'creator' THEN NULLIF(cr.uname, '') END,
      CASE WHEN t.type = 'dynamic' THEN NULLIF(dyn.metadata->>'text', '') END,
      NULLIF(t.label, ''),
      t.external_id
    ) AS display_name,
    CASE
      WHEN t.type = 'video' THEN v.cover_url
      WHEN t.type = 'creator' THEN cr.face_url
      ELSE NULL
    END AS cover_url,
    (t.deleted_at IS NOT NULL) AS target_deleted,
    j.status,
    j.attempts,
    j.scheduled_for,
    j.started_at,
    j.finished_at,
    CASE
      WHEN j.started_at IS NULL THEN NULL
      WHEN j.status IN ('succeeded', 'failed') THEN latest.duration_ms
      WHEN j.status = 'running' THEN GREATEST(
        0,
        floor(extract(epoch FROM (statement_timestamp() - j.started_at)) * 1000)
      )::int
      ELSE NULL
    END AS duration_ms,
    CASE
      WHEN j.status IN ('succeeded', 'failed') THEN latest.samples_written
      ELSE NULL
    END AS samples_written,
    j.error,
    latest.id::text AS latest_id,
    latest.status AS latest_status,
    latest.samples_written AS latest_samples,
    latest.duration_ms AS latest_duration_ms,
    latest.error AS latest_error,
    latest.started_at AS latest_started_at,
    latest.finished_at AS latest_finished_at,
    proj.projects
`;

function ilikePattern(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function integer(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.trunc(number);
}

function projectsOf(value: unknown): { id: string; name: string }[] {
  if (!Array.isArray(value)) return [];
  const items: { id: string; name: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { id?: unknown; name?: unknown };
    if (typeof row.id !== 'string') continue;
    items.push({ id: row.id, name: typeof row.name === 'string' ? row.name : '' });
  }
  return items;
}

function mapJob(row: JobSqlRow): OpsJobRead {
  const latest =
    row.latest_id &&
    row.latest_status &&
    row.latest_started_at &&
    row.latest_finished_at &&
    integer(row.latest_samples) !== null &&
    integer(row.latest_duration_ms) !== null
      ? {
          id: row.latest_id,
          status: row.latest_status,
          samplesWritten: integer(row.latest_samples) ?? 0,
          durationMs: integer(row.latest_duration_ms) ?? 0,
          error: row.latest_error,
          startedAt: row.latest_started_at,
          finishedAt: row.latest_finished_at,
        }
      : null;
  return {
    id: row.id,
    targetId: row.target_id,
    targetType: row.target_type,
    externalId: row.external_id,
    label: row.label,
    displayName: row.display_name,
    coverUrl: row.cover_url,
    targetDeleted: row.target_deleted,
    status: row.status,
    attempts: integer(row.attempts) ?? 0,
    scheduledFor: row.scheduled_for,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: integer(row.duration_ms),
    samplesWritten: integer(row.samples_written),
    error: row.error,
    latestAttempt: latest,
    projects: projectsOf(row.projects),
  };
}

function where(sql: Sql, filter: OpsJobReadFilter) {
  const pattern = filter.q ? ilikePattern(filter.q) : null;
  return sql`
    (${filter.type}::text IS NULL OR t.type = ${filter.type})
    AND (${filter.targetId}::uuid IS NULL OR t.id = ${filter.targetId}::uuid)
    AND (${filter.externalId}::text IS NULL OR t.external_id = ${filter.externalId})
    AND (${filter.status}::text IS NULL OR j.status = ${filter.status})
    AND (j.scheduled_for AT TIME ZONE 'Asia/Shanghai')::date >= ${filter.since}::date
    AND (j.scheduled_for AT TIME ZONE 'Asia/Shanghai')::date <= ${filter.until}::date
    AND (
      ${pattern}::text IS NULL
      OR t.label ILIKE ${pattern} ESCAPE '\\'
      OR t.external_id ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(v.title, '') ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(cr.uname, '') ILIKE ${pattern} ESCAPE '\\'
      OR (t.type = 'dynamic' AND COALESCE(dyn.metadata->>'text', '') ILIKE ${pattern} ESCAPE '\\')
    )
    AND (
      ${filter.projectId}::uuid IS NULL
      OR EXISTS (
        SELECT 1 FROM project_publish_records r
        WHERE r.project_id = ${filter.projectId}::uuid
          AND t.type = 'video'
          AND r.bvid = t.external_id
      )
      OR EXISTS (
        SELECT 1 FROM project_monitor_contracts m
        WHERE m.project_id = ${filter.projectId}::uuid
          AND t.type = 'video'
          AND m.bvid = t.external_id
      )
    )
  `;
}

export async function countOpsCollectorJobs(sql: Sql, filter: OpsJobReadFilter): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    ${sql.unsafe(JOB_FROM)}
    WHERE ${where(sql, filter)}
  `;
  return Number(rows[0]?.count ?? '0');
}

export async function listOpsCollectorJobs(
  sql: Sql,
  filter: OpsJobReadFilter,
  page: number,
  pageSize: number,
): Promise<OpsJobRead[]> {
  const offset = (page - 1) * pageSize;
  const rows = await sql<JobSqlRow[]>`
    ${sql.unsafe(JOB_SELECT)}
    ${sql.unsafe(JOB_FROM)}
    WHERE ${where(sql, filter)}
    ORDER BY j.scheduled_for DESC, j.id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  return rows.map(mapJob);
}

export async function countOpsCollectorJobGroups(
  sql: Sql,
  filter: OpsJobReadFilter,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM (
      SELECT t.id
      ${sql.unsafe(JOB_FROM)}
      WHERE ${where(sql, filter)}
      GROUP BY t.id
    ) groups
  `;
  return Number(rows[0]?.count ?? '0');
}

export async function listOpsCollectorJobGroups(
  sql: Sql,
  filter: OpsJobReadFilter,
  page: number,
  pageSize: number,
  jobsPerGroup: number,
): Promise<OpsJobGroupRead[]> {
  const offset = (page - 1) * pageSize;
  const rows = await sql<(JobSqlRow & { match_count: number; rn: number })[]>`
    WITH filtered AS (
      ${sql.unsafe(JOB_SELECT)}
      ${sql.unsafe(JOB_FROM)}
      WHERE ${where(sql, filter)}
    ),
    group_page AS (
      SELECT target_id, count(*)::int AS match_count, max(scheduled_for) AS latest
      FROM filtered
      GROUP BY target_id
      ORDER BY max(scheduled_for) DESC, target_id
      LIMIT ${pageSize} OFFSET ${offset}
    ),
    ranked AS (
      SELECT filtered.*, group_page.match_count, group_page.latest,
        row_number() OVER (
          PARTITION BY filtered.target_id
          ORDER BY filtered.scheduled_for DESC, filtered.id DESC
        ) AS rn
      FROM filtered
      JOIN group_page ON group_page.target_id = filtered.target_id
    )
    SELECT * FROM ranked
    WHERE rn <= ${jobsPerGroup}
    ORDER BY latest DESC, target_id, rn
  `;
  const groups = new Map<string, OpsJobGroupRead>();
  for (const row of rows) {
    const job = mapJob(row);
    const existing = groups.get(job.targetId);
    if (existing) {
      existing.jobs.push(job);
      continue;
    }
    groups.set(job.targetId, {
      targetId: job.targetId,
      targetType: job.targetType,
      externalId: job.externalId,
      label: job.label,
      displayName: job.displayName,
      coverUrl: job.coverUrl,
      targetDeleted: job.targetDeleted,
      matchCount: integer(row.match_count) ?? 0,
      jobs: [job],
    });
  }
  return [...groups.values()];
}

export async function readOpsCollectorJob(sql: Sql, id: string): Promise<OpsJobRead | null> {
  const rows = await sql<JobSqlRow[]>`
    ${sql.unsafe(JOB_SELECT)}
    ${sql.unsafe(JOB_FROM)}
    WHERE j.id = ${id}::uuid
  `;
  const row = rows[0];
  return row ? mapJob(row) : null;
}

export async function countOpsJobAttempts(sql: Sql, jobId: string): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM collector_runs WHERE job_id = ${jobId}::uuid
  `;
  return Number(rows[0]?.count ?? '0');
}

export async function listOpsJobAttempts(
  sql: Sql,
  jobId: string,
  page: number,
  pageSize: number,
): Promise<OpsAttemptRead[]> {
  const offset = (page - 1) * pageSize;
  const rows = await sql<
    {
      id: string;
      job_id: string;
      target_id: string;
      status: 'succeeded' | 'failed';
      samples_written: number;
      duration_ms: number;
      error: string | null;
      started_at: Date;
      finished_at: Date;
    }[]
  >`
    SELECT id::text AS id, job_id::text AS job_id, target_id::text AS target_id, status,
      samples_written, duration_ms, error, started_at, finished_at
    FROM collector_runs
    WHERE job_id = ${jobId}::uuid
    ORDER BY started_at DESC, id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  return rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    targetId: row.target_id,
    status: row.status,
    samplesWritten: integer(row.samples_written) ?? 0,
    durationMs: integer(row.duration_ms) ?? 0,
    error: row.error,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  }));
}

const REQUEST_CAP = 20;
const LOG_CAP = 20;

export async function listOpsRequestsForRuns(
  sql: Sql,
  runIds: string[],
): Promise<{ items: OpsRequestRead[]; truncatedRunIds: string[] }> {
  if (runIds.length === 0) return { items: [], truncatedRunIds: [] };
  const rows = await sql<
    {
      id: string;
      run_id: string | null;
      endpoint: string;
      status_code: number | null;
      biz_code: number | null;
      duration_ms: number;
      error: string | null;
      requested_at: Date;
      rn: number;
      total: number;
    }[]
  >`
    SELECT id::text AS id, run_id::text AS run_id, endpoint, status_code, biz_code, duration_ms,
      error, requested_at, rn, total
    FROM (
      SELECT id, run_id, endpoint, status_code, biz_code, duration_ms, error, requested_at,
        row_number() OVER (PARTITION BY run_id ORDER BY requested_at DESC, id DESC) AS rn,
        count(*) OVER (PARTITION BY run_id) AS total
      FROM collector_requests
      WHERE run_id IN ${sql(runIds)}
    ) ranked
    WHERE rn <= ${REQUEST_CAP}
    ORDER BY requested_at DESC, id DESC
  `;
  const truncated = new Set<string>();
  const items = rows.map((row) => {
    if ((integer(row.total) ?? 0) > REQUEST_CAP && row.run_id) truncated.add(row.run_id);
    return {
      id: row.id,
      runId: row.run_id,
      endpoint: row.endpoint,
      statusCode: integer(row.status_code),
      bizCode: integer(row.biz_code),
      durationMs: integer(row.duration_ms) ?? 0,
      error: row.error,
      requestedAt: row.requested_at,
    };
  });
  return { items, truncatedRunIds: [...truncated] };
}

export async function listOpsLogsForRuns(
  sql: Sql,
  runIds: string[],
): Promise<{ items: OpsLogRead[]; truncatedRunIds: string[] }> {
  if (runIds.length === 0) return { items: [], truncatedRunIds: [] };
  const rows = await sql<
    {
      id: string;
      ts: Date;
      level: string;
      service: string;
      event: string | null;
      message: string;
      request_id: string | null;
      run_id: string | null;
      job_id: string | null;
      target_id: string | null;
      context: unknown;
      rn: number;
      total: number;
    }[]
  >`
    SELECT id::text AS id, ts, level, service, event, message, request_id, run_id::text AS run_id,
      job_id::text AS job_id, target_id::text AS target_id, context, rn, total
    FROM (
      SELECT id, ts, level, service, event, message, request_id, run_id, job_id, target_id, context,
        row_number() OVER (PARTITION BY run_id ORDER BY ts DESC, id DESC) AS rn,
        count(*) OVER (PARTITION BY run_id) AS total
      FROM app_logs
      WHERE run_id IN ${sql(runIds)}
    ) ranked
    WHERE rn <= ${LOG_CAP}
    ORDER BY ts DESC, id DESC
  `;
  const truncated = new Set<string>();
  const items = rows.map((row) => {
    if ((integer(row.total) ?? 0) > LOG_CAP && row.run_id) truncated.add(row.run_id);
    return mapLog(row);
  });
  return { items, truncatedRunIds: [...truncated] };
}

function mapLog(row: {
  id: string;
  ts: Date;
  level: string;
  service: string;
  event: string | null;
  message: string;
  request_id: string | null;
  run_id: string | null;
  job_id: string | null;
  target_id: string | null;
  context: unknown;
}): OpsLogRead {
  return {
    id: row.id,
    ts: row.ts,
    level: row.level,
    service: row.service,
    event: row.event,
    message: row.message,
    requestId: row.request_id,
    runId: row.run_id,
    jobId: row.job_id,
    targetId: row.target_id,
    context: row.context,
  };
}

export async function listOpsJobLevelLogs(
  sql: Sql,
  jobId: string,
): Promise<{ items: OpsLogRead[]; truncated: boolean }> {
  const rows = await sql<
    {
      id: string;
      ts: Date;
      level: string;
      service: string;
      event: string | null;
      message: string;
      request_id: string | null;
      run_id: string | null;
      job_id: string | null;
      target_id: string | null;
      context: unknown;
    }[]
  >`
    SELECT id::text AS id, ts, level, service, event, message, request_id, run_id::text AS run_id,
      job_id::text AS job_id, target_id::text AS target_id, context
    FROM app_logs
    WHERE job_id = ${jobId}::uuid AND run_id IS NULL
    ORDER BY ts DESC, id DESC
    LIMIT ${LOG_CAP + 1}
  `;
  return {
    items: rows.slice(0, LOG_CAP).map(mapLog),
    truncated: rows.length > LOG_CAP,
  };
}

export async function readOpsLogRetention(
  sql: Sql,
  days: number,
  now = new Date(),
): Promise<{ days: number; cutoff: Date; oldestStoredAt: Date | null }> {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = await sql<{ oldest: Date | null }[]>`
    SELECT min(ts) AS oldest FROM app_logs
  `;
  return { days, cutoff, oldestStoredAt: rows[0]?.oldest ?? null };
}

export async function searchOpsCollectorTargets(
  sql: Sql,
  input: { q: string; type: MonitorTargetType | null; limit: number },
): Promise<
  {
    id: string;
    type: MonitorTargetType;
    externalId: string;
    label: string;
    displayName: string;
    deleted: boolean;
  }[]
> {
  const pattern = ilikePattern(input.q);
  const rows = await sql<
    {
      id: string;
      type: MonitorTargetType;
      external_id: string;
      label: string;
      display_name: string;
      deleted: boolean;
    }[]
  >`
    SELECT t.id::text AS id, t.type, t.external_id, t.label,
      COALESCE(
        CASE WHEN t.type = 'video' THEN NULLIF(v.title, '') END,
        CASE WHEN t.type = 'creator' THEN NULLIF(cr.uname, '') END,
        CASE WHEN t.type = 'dynamic' THEN NULLIF(dyn.metadata->>'text', '') END,
        NULLIF(t.label, ''),
        t.external_id
      ) AS display_name,
      (t.deleted_at IS NOT NULL) AS deleted
    FROM monitor_targets t
    LEFT JOIN videos v ON t.type = 'video' AND v.bvid = t.external_id
    LEFT JOIN creators cr ON t.type = 'creator' AND cr.mid::text = t.external_id
    LEFT JOIN dynamics dyn ON t.type = 'dynamic' AND dyn.dynamic_id = t.external_id
    WHERE (
      t.label ILIKE ${pattern} ESCAPE '\\'
      OR t.external_id ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(v.title, '') ILIKE ${pattern} ESCAPE '\\'
      OR COALESCE(cr.uname, '') ILIKE ${pattern} ESCAPE '\\'
      OR (t.type = 'dynamic' AND COALESCE(dyn.metadata->>'text', '') ILIKE ${pattern} ESCAPE '\\')
    )
      AND (${input.type}::text IS NULL OR t.type = ${input.type})
    ORDER BY (t.deleted_at IS NOT NULL), t.updated_at DESC, t.id
    LIMIT ${input.limit}
  `;
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    externalId: row.external_id,
    label: row.label,
    displayName: row.display_name,
    deleted: row.deleted,
  }));
}

export async function searchOpsProjects(
  sql: Sql,
  input: { q: string; limit: number },
): Promise<{ id: string; name: string }[]> {
  const pattern = ilikePattern(input.q);
  const rows = await sql<{ id: string; name: string }[]>`
    SELECT id::text AS id, name
    FROM commercial_projects
    WHERE name ILIKE ${pattern} ESCAPE '\\' OR id::text ILIKE ${pattern} ESCAPE '\\'
    ORDER BY name, id
    LIMIT ${input.limit}
  `;
  return rows;
}

export async function countOpsOperations(
  sql: Sql,
  filter: {
    events: readonly string[];
    targetId: string | null;
    requestId: string | null;
    actionEvent: string | null;
    since: string;
    until: string;
  },
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM app_logs
    WHERE event IN ${sql([...filter.events])}
      AND (${filter.actionEvent}::text IS NULL OR event = ${filter.actionEvent})
      AND (${filter.targetId}::uuid IS NULL OR target_id = ${filter.targetId}::uuid)
      AND (${filter.requestId}::text IS NULL OR request_id = ${filter.requestId})
      AND (ts AT TIME ZONE 'Asia/Shanghai')::date >= ${filter.since}::date
      AND (ts AT TIME ZONE 'Asia/Shanghai')::date <= ${filter.until}::date
  `;
  return Number(rows[0]?.count ?? '0');
}

export async function listOpsOperations(
  sql: Sql,
  filter: {
    events: readonly string[];
    targetId: string | null;
    requestId: string | null;
    actionEvent: string | null;
    since: string;
    until: string;
  },
  page: number,
  pageSize: number,
): Promise<OpsOperationRead[]> {
  const offset = (page - 1) * pageSize;
  const rows = await sql<
    {
      id: string;
      ts: Date;
      event: string;
      message: string;
      request_id: string | null;
      target_id: string | null;
      context: unknown;
    }[]
  >`
    SELECT id::text AS id, ts, event, message, request_id, target_id::text AS target_id, context
    FROM app_logs
    WHERE event IN ${sql([...filter.events])}
      AND (${filter.actionEvent}::text IS NULL OR event = ${filter.actionEvent})
      AND (${filter.targetId}::uuid IS NULL OR target_id = ${filter.targetId}::uuid)
      AND (${filter.requestId}::text IS NULL OR request_id = ${filter.requestId})
      AND (ts AT TIME ZONE 'Asia/Shanghai')::date >= ${filter.since}::date
      AND (ts AT TIME ZONE 'Asia/Shanghai')::date <= ${filter.until}::date
    ORDER BY ts DESC, id DESC
    LIMIT ${pageSize} OFFSET ${offset}
  `;
  return rows.map((row) => ({
    id: row.id,
    ts: row.ts,
    event: row.event ?? '',
    message: row.message,
    requestId: row.request_id,
    targetId: row.target_id,
    context: row.context,
  }));
}
