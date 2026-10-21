import {
  decodeOpsCursor,
  encodeOpsCursor,
  parseIsoDateParam,
  parseOpsLimit,
  type OpsCircuit,
  type OpsDebugBundle,
  type OpsDebugCreator,
  type OpsDebugTarget,
  type OpsDebugVideo,
  type OpsHealth,
  type OpsHeartbeat,
  type OpsLog,
  type OpsPage,
  type OpsRequest,
  type OpsRun,
  type OpsRunDetail,
  type OpsSummary,
  type OpsTargetStatus,
} from '@studio/contracts';
import { VIDEO_PARTITION_JOINS, VIDEO_PARTITION_NAME_SQL, type Sql } from '@studio/db';
import { readMetadataRun } from '@studio/monitoring';
import { scrubString, scrubValue } from '@studio/observability';
import { Hono } from 'hono';
import { registerOpsRecordRoutes } from './ops-record-routes';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_MS = 30_000;
const RUN_LOG_LIMIT = 200;

type Ctx = {
  req: { query: (name: string) => string | undefined; param: (name: string) => string };
  json: (body: unknown, status?: number) => Response;
};

function cleanText(value: string | null): string | null {
  if (value === null) return null;
  const text = scrubString(value);
  return text.length === 0 ? null : text;
}

function cleanContext(value: unknown): Record<string, unknown> {
  const scrubbed = scrubValue(value ?? {});
  if (!scrubbed || typeof scrubbed !== 'object' || Array.isArray(scrubbed)) return {};
  return scrubbed as Record<string, unknown>;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function count(value: unknown): number {
  const number = typeof value === 'number' ? value : Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.trunc(number);
}

function parseUuid(raw: string | undefined, name: string): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  if (!UUID.test(raw.trim())) throw new Error(`invalid ${name}`);
  return raw.trim();
}

function parseStatus(raw: string | undefined): 'succeeded' | 'failed' | null {
  if (raw === undefined || raw.trim() === '' || raw === 'all') return null;
  if (raw === 'succeeded' || raw === 'failed') return raw;
  throw new Error('invalid status');
}

function parseLevel(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '' || raw === 'all') return null;
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') return raw;
  throw new Error('invalid level');
}

function parseService(raw: string | undefined): 'api' | 'collector' | null {
  if (raw === undefined || raw.trim() === '' || raw === 'all') return null;
  if (raw === 'api' || raw === 'collector') return raw;
  throw new Error('invalid service');
}

function parseSearch(raw: string | undefined): string | null {
  if (raw === undefined || raw.trim() === '') return null;
  return raw.trim().slice(0, 200);
}

function ilikePattern(raw: string): string {
  return `%${raw.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function cursorPart(cursor: Record<string, string> | null, key: string): string | null {
  const value = cursor?.[key];
  return value && value.length > 0 ? value : null;
}

async function send<T>(c: Ctx, body: T, status = 200): Promise<Response> {
  return c.json(body, status);
}

function guard(handler: (c: Ctx) => Promise<Response>) {
  return async (c: Ctx) => {
    try {
      return await handler(c);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'bad request';
      if (message.startsWith('invalid')) return c.json({ error: message }, 400);
      throw error;
    }
  };
}

function mapHeartbeat(row: {
  instance_id: string;
  status: OpsHeartbeat['status'];
  last_seen_at: Date;
  current_job_id: string | null;
}): OpsHeartbeat {
  return {
    instance: row.instance_id,
    status: row.status,
    lastSeenAt: row.last_seen_at.toISOString(),
    currentJobId: row.current_job_id,
  };
}

function mapCircuit(row: {
  account_id: string;
  opened_at: Date;
  resume_at: Date;
  consecutive_failures: number;
  reason: string;
}): OpsCircuit {
  return {
    accountId: row.account_id,
    openedAt: row.opened_at.toISOString(),
    resumeAt: row.resume_at.toISOString(),
    consecutiveFailures: count(row.consecutive_failures),
    reason: cleanText(row.reason) ?? '-',
  };
}

function mapRun(row: {
  id: string;
  target_id: string;
  target_label: string;
  status: 'succeeded' | 'failed';
  samples_written: number;
  duration_ms: number;
  error: string | null;
  started_at: Date;
  finished_at: Date;
}): OpsRun {
  return {
    id: row.id,
    targetId: row.target_id,
    targetLabel: row.target_label,
    status: row.status,
    samplesWritten: count(row.samples_written),
    durationMs: count(row.duration_ms),
    error: cleanText(row.error),
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at.toISOString(),
  };
}

function mapRequest(row: {
  id: string;
  endpoint: string;
  status_code: number | null;
  biz_code: number | null;
  duration_ms: number;
  error: string | null;
  requested_at: Date;
  run_id: string | null;
}): OpsRequest {
  return {
    id: row.id,
    endpoint: scrubString(row.endpoint),
    statusCode: row.status_code === null ? null : count(row.status_code),
    bizCode: row.biz_code === null ? null : Math.trunc(Number(row.biz_code)),
    durationMs: count(row.duration_ms),
    error: cleanText(row.error),
    requestedAt: row.requested_at.toISOString(),
    runId: row.run_id,
  };
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
  context: unknown;
}): OpsLog {
  return {
    id: row.id,
    ts: row.ts.toISOString(),
    level: row.level,
    service: row.service,
    event: cleanText(row.event),
    message: cleanText(row.message) ?? '',
    requestId: row.request_id,
    runId: row.run_id,
    context: cleanContext(row.context),
  };
}

async function readHeartbeats(db: Sql): Promise<OpsHeartbeat[]> {
  const rows = await db<
    {
      instance_id: string;
      status: OpsHeartbeat['status'];
      last_seen_at: Date;
      current_job_id: string | null;
    }[]
  >`
    SELECT instance_id, status, last_seen_at, current_job_id::text AS current_job_id
    FROM collector_heartbeats
    ORDER BY last_seen_at DESC, instance_id
  `;
  return rows.map(mapHeartbeat);
}

async function readCircuits(db: Sql, activeOnly: boolean): Promise<OpsCircuit[]> {
  const rows = await db<
    {
      account_id: string;
      opened_at: Date;
      resume_at: Date;
      consecutive_failures: number;
      reason: string;
    }[]
  >`
    SELECT account_id::text AS account_id, opened_at, resume_at, consecutive_failures, reason
    FROM collector_circuits
    WHERE (${activeOnly}::boolean = false OR resume_at > now())
    ORDER BY opened_at DESC
    LIMIT 50
  `;
  return rows.map(mapCircuit);
}

async function readRun(db: Sql, id: string): Promise<OpsRun | null> {
  const rows = await db<
    {
      id: string;
      target_id: string;
      target_label: string;
      status: 'succeeded' | 'failed';
      samples_written: number;
      duration_ms: number;
      error: string | null;
      started_at: Date;
      finished_at: Date;
    }[]
  >`
    SELECT r.id::text AS id, r.target_id::text AS target_id, COALESCE(t.label, '') AS target_label,
      r.status, r.samples_written, r.duration_ms, r.error, r.started_at, r.finished_at
    FROM collector_runs r
    JOIN monitor_targets t ON t.id = r.target_id
    WHERE r.id = ${id}::uuid
  `;
  const row = rows[0];
  return row ? mapRun(row) : null;
}

async function readRequestsForRun(db: Sql, runId: string): Promise<OpsRequest[]> {
  const rows = await db<
    {
      id: string;
      endpoint: string;
      status_code: number | null;
      biz_code: number | null;
      duration_ms: number;
      error: string | null;
      requested_at: Date;
      run_id: string | null;
    }[]
  >`
    SELECT id::text AS id, endpoint, status_code, biz_code, duration_ms, error, requested_at,
      run_id::text AS run_id
    FROM collector_requests
    WHERE run_id = ${runId}::uuid
    ORDER BY requested_at ASC, id ASC
  `;
  return rows.map(mapRequest);
}

async function readLogsForRun(db: Sql, runId: string): Promise<OpsLog[]> {
  const rows = await db<
    {
      id: string;
      ts: Date;
      level: string;
      service: string;
      event: string | null;
      message: string;
      request_id: string | null;
      run_id: string | null;
      context: unknown;
    }[]
  >`
    SELECT id::text AS id, ts, level, service, event, message, request_id, run_id::text AS run_id, context
    FROM (
      SELECT id, ts, level, service, event, message, request_id, run_id, context
      FROM app_logs
      WHERE run_id = ${runId}::uuid
      ORDER BY ts DESC, id DESC
      LIMIT ${RUN_LOG_LIMIT}
    ) tail
    ORDER BY ts ASC, id ASC
  `;
  return rows.map(mapLog);
}

export function createOpsRoutes(db: Sql) {
  const app = new Hono();

  app.get(
    '/summary',
    guard(async (c) => {
      const [
        heartbeats,
        queueRows,
        failedRows,
        circuits,
        targets,
        videoSamples,
        creatorSamples,
        errors,
      ] = await Promise.all([
        readHeartbeats(db),
        db<{ due: number; running: number }[]>`
            SELECT
              count(*) FILTER (WHERE status = 'pending' AND scheduled_for <= now())::int AS due,
              count(*) FILTER (WHERE status = 'running')::int AS running
            FROM collector_jobs
          `,
        db<{ failed: number }[]>`
            SELECT count(*)::int AS failed
            FROM collector_runs
            WHERE status = 'failed' AND finished_at >= now() - interval '24 hours'
          `,
        readCircuits(db, true),
        db<
          {
            id: string;
            label: string;
            type: 'video' | 'creator';
            last_success_at: Date | null;
            last_error: string | null;
          }[]
        >`
            SELECT id::text AS id, label, type, last_success_at, last_error
            FROM monitor_targets
            WHERE deleted_at IS NULL
            ORDER BY label, id
          `,
        db<{ count: number }[]>`
            SELECT count(*)::int AS count
            FROM video_metric_samples
            WHERE COALESCE(collected_at, sampled_at) >= (
              date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
            )
          `,
        db<{ count: number }[]>`
            SELECT count(*)::int AS count
            FROM creator_follower_samples
            WHERE COALESCE(collected_at, sampled_at) >= (
              date_trunc('day', now() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
            )
          `,
        db<{ count: number }[]>`
            SELECT count(*)::int AS count
            FROM app_logs
            WHERE level = 'error' AND ts >= now() - interval '1 hour'
          `,
      ]);
      const targetItems: OpsTargetStatus[] = targets.map((row) => ({
        targetId: row.id,
        label: row.label,
        type: row.type,
        lastSuccessAt: iso(row.last_success_at),
        lastError: cleanText(row.last_error),
      }));
      const body: OpsSummary = {
        heartbeats,
        queue: {
          due: count(queueRows[0]?.due),
          running: count(queueRows[0]?.running),
          failed24h: count(failedRows[0]?.failed),
        },
        circuits,
        targets: targetItems,
        samplesToday: {
          videos: count(videoSamples[0]?.count),
          creators: count(creatorSamples[0]?.count),
        },
        recentErrorCount: count(errors[0]?.count),
      };
      return send(c, body);
    }),
  );

  app.get(
    '/runs',
    guard(async (c) => {
      const limit = parseOpsLimit(c.req.query('limit'));
      const status = parseStatus(c.req.query('status'));
      const targetId = parseUuid(c.req.query('targetId'), 'targetId');
      const since = parseIsoDateParam(c.req.query('since'), 'since');
      const until = parseIsoDateParam(c.req.query('until'), 'until');
      const cursor = decodeOpsCursor(c.req.query('cursor'));
      const cursorStarted = cursorPart(cursor, 'startedAt');
      const cursorId = cursorPart(cursor, 'id');
      if ((cursorStarted === null) !== (cursorId === null)) throw new Error('invalid cursor');
      if (cursorId && !UUID.test(cursorId)) throw new Error('invalid cursor');
      if (cursorStarted && Number.isNaN(Date.parse(cursorStarted)))
        throw new Error('invalid cursor');
      const rows = await db<
        {
          id: string;
          target_id: string;
          target_label: string;
          status: 'succeeded' | 'failed';
          samples_written: number;
          duration_ms: number;
          error: string | null;
          started_at: Date;
          finished_at: Date;
        }[]
      >`
        SELECT r.id::text AS id, r.target_id::text AS target_id, COALESCE(t.label, '') AS target_label,
          r.status, r.samples_written, r.duration_ms, r.error, r.started_at, r.finished_at
        FROM collector_runs r
        JOIN monitor_targets t ON t.id = r.target_id
        WHERE (${status}::text IS NULL OR r.status = ${status})
          AND (${targetId}::uuid IS NULL OR r.target_id = ${targetId}::uuid)
          AND (${since}::timestamptz IS NULL OR r.started_at >= ${since})
          AND (${until}::timestamptz IS NULL OR r.started_at <= ${until})
          AND (
            ${cursorStarted}::timestamptz IS NULL
            OR (r.started_at, r.id) < (${cursorStarted}::timestamptz, ${cursorId}::uuid)
          )
        ORDER BY r.started_at DESC, r.id DESC
        LIMIT ${limit + 1}
      `;
      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, limit) : rows).map(mapRun);
      const last = items.at(-1);
      const body: OpsPage<OpsRun> = {
        items,
        nextCursor:
          hasMore && last ? encodeOpsCursor({ startedAt: last.startedAt, id: last.id }) : null,
        limit,
      };
      return send(c, body);
    }),
  );

  app.get(
    '/runs/:id',
    guard(async (c) => {
      const id = parseUuid(c.req.param('id'), 'runId');
      if (!id) throw new Error('invalid runId');
      const run = await readRun(db, id);
      if (!run) return c.json({ error: 'not found' }, 404);
      const body: OpsRunDetail = {
        run,
        requests: await readRequestsForRun(db, id),
        logs: await readLogsForRun(db, id),
      };
      return send(c, body);
    }),
  );

  app.get(
    '/requests',
    guard(async (c) => {
      const limit = parseOpsLimit(c.req.query('limit'));
      const endpoint = parseSearch(c.req.query('endpoint'));
      const since = parseIsoDateParam(c.req.query('since'), 'since');
      const cursor = decodeOpsCursor(c.req.query('cursor'));
      const cursorId = cursorPart(cursor, 'id');
      if (cursor && Object.keys(cursor).some((key) => key !== 'id'))
        throw new Error('invalid cursor');
      if (cursorId !== null && !/^\d+$/.test(cursorId)) throw new Error('invalid cursor');
      const rows = await db<
        {
          id: string;
          endpoint: string;
          status_code: number | null;
          biz_code: number | null;
          duration_ms: number;
          error: string | null;
          requested_at: Date;
          run_id: string | null;
        }[]
      >`
        SELECT id::text AS id, endpoint, status_code, biz_code, duration_ms, error, requested_at,
          run_id::text AS run_id
        FROM collector_requests
        WHERE (${endpoint}::text IS NULL OR endpoint = ${endpoint})
          AND (${since}::timestamptz IS NULL OR requested_at >= ${since})
          AND (${cursorId}::bigint IS NULL OR id < ${cursorId}::bigint)
        ORDER BY id DESC
        LIMIT ${limit + 1}
      `;
      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, limit) : rows).map(mapRequest);
      const last = items.at(-1);
      const body: OpsPage<OpsRequest> = {
        items,
        nextCursor: hasMore && last ? encodeOpsCursor({ id: last.id }) : null,
        limit,
      };
      return send(c, body);
    }),
  );

  app.get(
    '/logs',
    guard(async (c) => {
      const limit = parseOpsLimit(c.req.query('limit'));
      const level = parseLevel(c.req.query('level'));
      const service = parseService(c.req.query('service'));
      const runId = parseUuid(c.req.query('runId'), 'runId');
      const requestId = parseSearch(c.req.query('requestId'));
      const targetId = parseUuid(c.req.query('targetId'), 'targetId');
      const q = parseSearch(c.req.query('q'));
      const since = parseIsoDateParam(c.req.query('since'), 'since');
      const until = parseIsoDateParam(c.req.query('until'), 'until');
      const includeHttp = c.req.query('includeHttp') === '1';
      const attention = c.req.query('attention') === '1' && level === null;
      const pattern = q ? ilikePattern(q) : null;
      const cursor = decodeOpsCursor(c.req.query('cursor'));
      const cursorTs = cursorPart(cursor, 'ts');
      const cursorId = cursorPart(cursor, 'id');
      if ((cursorTs === null) !== (cursorId === null)) throw new Error('invalid cursor');
      if (cursorId !== null && !/^\d+$/.test(cursorId)) throw new Error('invalid cursor');
      if (cursorTs && Number.isNaN(Date.parse(cursorTs))) throw new Error('invalid cursor');
      const rows = await db<
        {
          id: string;
          ts: Date;
          level: string;
          service: string;
          event: string | null;
          message: string;
          request_id: string | null;
          run_id: string | null;
          context: unknown;
        }[]
      >`
        SELECT id::text AS id, ts, level, service, event, message, request_id, run_id::text AS run_id, context
        FROM app_logs
        WHERE (${level}::text IS NULL OR level = ${level})
          AND (${attention}::boolean = false OR level IN ('warn', 'error'))
          AND (${service}::text IS NULL OR service = ${service})
          AND (${runId}::uuid IS NULL OR run_id = ${runId}::uuid)
          AND (${requestId}::text IS NULL OR request_id = ${requestId})
          AND (${since}::timestamptz IS NULL OR ts >= ${since})
          AND (${until}::timestamptz IS NULL OR ts <= ${until})
          AND (${includeHttp}::boolean OR event IS DISTINCT FROM 'http.request')
          AND (
            ${targetId}::uuid IS NULL
            OR target_id = ${targetId}::uuid
            OR job_id IN (SELECT id FROM collector_jobs WHERE target_id = ${targetId}::uuid)
            OR run_id IN (SELECT id FROM collector_runs WHERE target_id = ${targetId}::uuid)
          )
          AND (
            ${pattern}::text IS NULL
            OR message ILIKE ${pattern} ESCAPE '\\'
            OR COALESCE(event, '') ILIKE ${pattern} ESCAPE '\\'
          )
          AND (
            ${cursorTs}::timestamptz IS NULL
            OR (ts, id) < (${cursorTs}::timestamptz, ${cursorId}::bigint)
          )
        ORDER BY ts DESC, id DESC
        LIMIT ${limit + 1}
      `;
      const hasMore = rows.length > limit;
      const items = (hasMore ? rows.slice(0, limit) : rows).map(mapLog);
      const last = items.at(-1);
      const totals = await db<{ count: number }[]>`
        SELECT count(*)::int AS count
        FROM app_logs
        WHERE (${level}::text IS NULL OR level = ${level})
          AND (${attention}::boolean = false OR level IN ('warn', 'error'))
          AND (${service}::text IS NULL OR service = ${service})
          AND (${runId}::uuid IS NULL OR run_id = ${runId}::uuid)
          AND (${requestId}::text IS NULL OR request_id = ${requestId})
          AND (${since}::timestamptz IS NULL OR ts >= ${since})
          AND (${until}::timestamptz IS NULL OR ts <= ${until})
          AND (${includeHttp}::boolean OR event IS DISTINCT FROM 'http.request')
          AND (
            ${targetId}::uuid IS NULL
            OR target_id = ${targetId}::uuid
            OR job_id IN (SELECT id FROM collector_jobs WHERE target_id = ${targetId}::uuid)
            OR run_id IN (SELECT id FROM collector_runs WHERE target_id = ${targetId}::uuid)
          )
          AND (
            ${pattern}::text IS NULL
            OR message ILIKE ${pattern} ESCAPE '\\'
            OR COALESCE(event, '') ILIKE ${pattern} ESCAPE '\\'
          )
      `;
      const body: OpsPage<OpsLog> & { total: number } = {
        items,
        nextCursor: hasMore && last ? encodeOpsCursor({ ts: last.ts, id: last.id }) : null,
        limit,
        total: count(totals[0]?.count),
      };
      return send(c, body);
    }),
  );

  app.get(
    '/health',
    guard(async () => {
      const [heartbeats, backlog, success] = await Promise.all([
        db<{ last_seen_at: Date | null }[]>`
          SELECT max(last_seen_at) AS last_seen_at FROM collector_heartbeats
        `,
        db<{ count: number }[]>`
          SELECT count(*)::int AS count FROM collector_jobs WHERE status = 'pending'
        `,
        db<{ finished_at: Date | null }[]>`
          SELECT max(finished_at) AS finished_at FROM collector_runs WHERE status = 'succeeded'
        `,
      ]);
      const lastSeen = heartbeats[0]?.last_seen_at ?? null;
      const stale = lastSeen === null || Date.now() - lastSeen.getTime() > STALE_MS;
      const body: OpsHealth = {
        lastHeartbeatAt: iso(lastSeen),
        stale,
        queueBacklog: count(backlog[0]?.count),
        lastSuccessAt: iso(success[0]?.finished_at ?? null),
      };
      return Response.json(body);
    }),
  );

  app.get(
    '/debug/bundle',
    guard(async (c) => {
      const runId = parseUuid(c.req.query('runId'), 'runId');
      if (!runId) throw new Error('invalid runId');
      const run = await readRun(db, runId);
      const [versions, heartbeats, circuits] = await Promise.all([
        db<{ version: string }[]>`
          SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1
        `,
        readHeartbeats(db),
        readCircuits(db, false),
      ]);
      let target: OpsDebugTarget | null = null;
      let video: OpsDebugVideo | null = null;
      let creator: OpsDebugCreator | null = null;
      if (run) {
        const targets = await db<
          {
            id: string;
            type: string;
            external_id: string;
            label: string;
            enabled: boolean;
            last_success_at: Date | null;
            last_error: string | null;
          }[]
        >`
          SELECT id::text AS id, type, external_id, label, enabled, last_success_at, last_error
          FROM monitor_targets
          WHERE id = ${run.targetId}::uuid
        `;
        const row = targets[0];
        if (row) {
          target = {
            id: row.id,
            type: row.type,
            externalId: row.external_id,
            label: row.label,
            enabled: row.enabled,
            lastSuccessAt: iso(row.last_success_at),
            lastError: cleanText(row.last_error),
          };
          if (row.type === 'video') video = await readVideo(db, row.external_id);
          if (row.type === 'creator') creator = await readCreator(db, row.external_id);
        }
      }
      const body: OpsDebugBundle = {
        schemaVersion: versions[0]?.version ?? '009_refresh_request_audit',
        generatedAt: new Date().toISOString(),
        run,
        target,
        requests: run ? await readRequestsForRun(db, runId) : [],
        logs: run ? await readLogsForRun(db, runId) : [],
        video,
        creator,
        heartbeats,
        circuits,
      };
      return send(c, body);
    }),
  );

  app.get(
    '/metadata/runs/:id',
    guard(async (c) => {
      const id = parseUuid(c.req.param('id'), 'id');
      if (!id) throw new Error('invalid id');
      const run = await readMetadataRun(db, id);
      if (!run) return c.json({ error: 'not found' }, 404);
      return send(c, {
        id: run.id,
        status: run.status,
        requested: run.requested,
        succeeded: run.succeeded,
        failed: run.failed,
        skipped: run.skipped,
        report: run.report,
      });
    }),
  );

  registerOpsRecordRoutes(app, db);
  return app;
}

async function readVideo(db: Sql, bvid: string): Promise<OpsDebugVideo | null> {
  const rows = await db<
    {
      bvid: string;
      title: string | null;
      description: string | null;
      duration_seconds: number | null;
      cover_url: string | null;
      cover_state: string;
      metadata_state: string;
      metadata_source: string | null;
      metadata_fetched_at: Date | null;
      metadata_error: string | null;
      cid: string | null;
      pubdate: Date | null;
      tid: number | null;
      tid_v2: number | null;
      partition_name: string | null;
    }[]
  >`
    SELECT v.bvid, v.title, v.description, v.duration_seconds, v.cover_url, v.cover_state, v.metadata_state,
      v.metadata_source, v.metadata_fetched_at, v.metadata_error, v.cid::text AS cid, v.pubdate,
      v.tid, v.tid_v2, ${db.unsafe(VIDEO_PARTITION_NAME_SQL)} AS partition_name
    FROM videos v
    ${db.unsafe(VIDEO_PARTITION_JOINS)}
    WHERE v.bvid = ${bvid}
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    bvid: row.bvid,
    title: cleanText(row.title),
    description: cleanText(row.description),
    durationSeconds: row.duration_seconds === null ? null : count(row.duration_seconds),
    coverUrl: cleanText(row.cover_url),
    coverState: row.cover_state,
    metadataState: row.metadata_state,
    metadataSource: row.metadata_source,
    metadataFetchedAt: iso(row.metadata_fetched_at),
    metadataError: cleanText(row.metadata_error),
    cid: row.cid,
    pubdate: iso(row.pubdate),
    tid: row.tid,
    tidV2: row.tid_v2,
    partitionName: cleanText(row.partition_name),
  };
}

async function readCreator(db: Sql, mid: string): Promise<OpsDebugCreator | null> {
  if (!/^[1-9][0-9]{0,18}$/.test(mid)) return null;
  const rows = await db<
    {
      mid: string;
      uname: string | null;
      face_url: string | null;
      metadata_state: string;
      metadata_source: string | null;
      metadata_fetched_at: Date | null;
      metadata_error: string | null;
    }[]
  >`
    SELECT mid::text AS mid, uname, face_url, metadata_state, metadata_source,
      metadata_fetched_at, metadata_error
    FROM creators
    WHERE mid = ${mid}::bigint
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    mid: row.mid,
    uname: cleanText(row.uname),
    faceUrl: cleanText(row.face_url),
    metadataState: row.metadata_state,
    metadataSource: row.metadata_source,
    metadataFetchedAt: iso(row.metadata_fetched_at),
    metadataError: cleanText(row.metadata_error),
  };
}
