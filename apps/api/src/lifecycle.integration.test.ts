import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRetainedTestDatabase, type Sql } from '@studio/db';
import { installOfflineFetchGuard } from '@studio/monitoring';
import {
  freeTcpPort,
  lifecycleChildEnv,
  parseLogEvent,
  spawnLifecycleProcess,
  type LifecycleChild,
} from '@studio/observability';

installOfflineFetchGuard();

const repoRoot = join(import.meta.dir, '../../..');
const assetsRoot = mkdtempSync(join(tmpdir(), 'api-lifecycle-assets-'));
const open: Sql[] = [];
const bvid = 'BV1aptest411';

afterAll(async () => {
  for (const sql of open) await sql.end({ timeout: 5 }).catch(() => undefined);
});

function evidence(payload: Record<string, unknown>) {
  console.log(`WP-R2-12B-EVIDENCE ${JSON.stringify(payload)}`);
}

function isEvent(line: string, event: string, instance: string): boolean {
  const parsed = parseLogEvent(line);
  return parsed?.event === event && parsed.instance === instance;
}

type StdoutRecord = { event?: string; context?: Record<string, unknown> };

function stdoutRecords(lines: string[]): StdoutRecord[] {
  return lines.flatMap((line) => {
    try {
      const value = JSON.parse(line) as StdoutRecord;
      return value.event ? [value] : [];
    } catch {
      return [];
    }
  });
}

function record(lines: string[], event: string): StdoutRecord | undefined {
  return stdoutRecords(lines).find((row) => row.event === event);
}

function assertNoSecret(text: string) {
  expect(text).not.toContain('plain-sess-value-9f3a');
  expect(text).not.toContain('plain-jct-value-9f3a');
  expect(text).not.toContain('abc.def-GHI_9');
}

function spawnApi(
  database: string,
  instance: string,
  port: number,
  extra: Record<string, string> = {},
): LifecycleChild {
  return spawnLifecycleProcess({
    cwd: repoRoot,
    script: 'apps/api/src/index.ts',
    env: lifecycleChildEnv(database, {
      MONITOR_DATA_SOURCE: 'mock',
      HOSTNAME: instance,
      API_PORT: String(port),
      MONITOR_ASSETS_ROOT: assetsRoot,
      ...extra,
    }),
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(port: number, child: LifecycleChild) {
  const deadline = Date.now() + 10_000;
  let last = '未连接';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return;
      last = String(response.status);
    } catch (error) {
      last = error instanceof Error ? error.message : 'connect failed';
    }
    await sleep(20);
  }
  throw new Error(
    `API 未就绪: ${last}\n${child.stderr.join('\n')}\n${child.lines.slice(-20).join('\n')}`,
  );
}

async function logEvents(sql: Sql, instance: string): Promise<Array<string | null>> {
  const rows = await sql<{ event: string | null }[]>`
    SELECT event FROM app_logs WHERE instance = ${instance} ORDER BY id
  `;
  return rows.map((row) => row.event);
}

async function waitForLogged(sql: Sql, instance: string, event: string) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM app_logs WHERE instance = ${instance} AND event = ${event}
    `;
    if ((rows[0]?.n ?? 0) > 0) return;
    await sleep(20);
  }
  throw new Error(`数据库未见 ${event}`);
}

type RefreshBody = { backfillRunId?: string; error?: string; requested?: number };

function startRefresh(port: number, hold: boolean) {
  const shot: { status: number; at: number; body: RefreshBody } = { status: 0, at: 0, body: {} };
  const done = (async () => {
    const response = await fetch(`http://127.0.0.1:${port}/api/v1/monitor/metadata/refresh`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(hold ? { 'x-lifecycle-hold': '1' } : {}),
      },
      body: JSON.stringify({ kind: 'video', ids: [bvid] }),
    });
    shot.status = response.status;
    shot.at = Date.now();
    shot.body = (await response.json()) as RefreshBody;
  })();
  return { done, shot };
}

async function openDb() {
  const isolated = await createRetainedTestDatabase('wp_r2_12b');
  open.push(isolated.sql);
  return isolated;
}

describe('api process shutdown', () => {
  test('SIGTERM flushes the startup tail once and leaves collector jobs pending', async () => {
    const isolated = await openDb();
    const targetId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    await isolated.sql`
      INSERT INTO monitor_targets (id, "type", external_id, interval_minutes, source)
      VALUES (${targetId}::uuid, 'video', 'BV1xx411c7mD', 60, 'offline')
    `;
    await isolated.sql`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
      VALUES (${jobId}::uuid, ${targetId}::uuid, 'pending', 0, now())
    `;
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port);
    try {
      const seenAt = await child.waitForLine(
        (line) => isEvent(line, 'service.started', instance),
        15_000,
      );
      const signaledAt = Date.now();
      expect(signaledAt - seenAt).toBeLessThan(300);
      child.kill('SIGTERM');
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const events = await logEvents(isolated.sql, instance);
      const jobs = await isolated.sql<{ status: string }[]>`
        SELECT status FROM collector_jobs WHERE id = ${jobId}::uuid
      `;
      const stdout = child.lines.join('\n');
      expect(exitCode).toBe(0);
      expect(events).toEqual(['service.started', 'service.stopped']);
      expect(jobs[0]?.status).toBe('pending');
      expect(stdout).toContain('lifecycle.offline_guard');
      expect(child.stderr.join('\n')).toBe('');
      evidence({
        case: 'api-sigterm-tail',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        duplicateSignal: 'SIGTERM',
        exitCode,
        elapsedMs,
        signalLagMs: signaledAt - seenAt,
        events,
        collectorJob: jobs[0]?.status,
        stderr: '',
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('SIGINT and a duplicate signal flush one stop tail', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port);
    try {
      const seenAt = await child.waitForLine(
        (line) => isEvent(line, 'service.started', instance),
        15_000,
      );
      const signaledAt = Date.now();
      expect(signaledAt - seenAt).toBeLessThan(300);
      child.kill('SIGINT');
      child.kill('SIGINT');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const events = await logEvents(isolated.sql, instance);
      expect(exitCode).toBe(0);
      expect(events).toEqual(['service.started', 'service.stopped']);
      expect(child.stderr.join('\n')).toBe('');
      evidence({
        case: 'api-sigint-tail',
        database: isolated.databaseName,
        instance,
        signal: 'SIGINT',
        duplicateSignal: 'SIGINT',
        exitCode,
        elapsedMs,
        signalLagMs: signaledAt - seenAt,
        events,
        stderr: '',
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('an in-flight database request finishes and a new request is 503', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      API_LIFECYCLE_HTTP_HOLD_MS: '700',
      LOG_FLUSH_DEADLINE_MS: '400',
      PROCESS_EXIT_BUDGET_MS: '2500',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitForHealth(port, child);
      const first = fetch(`http://127.0.0.1:${port}/api/v1/monitor/videos`, {
        headers: { 'x-lifecycle-hold': '1' },
      });
      await child.waitForLine((line) => isEvent(line, 'lifecycle.http_held', instance), 10_000);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      await sleep(40);
      child.kill('SIGTERM');
      const deadline = Date.now() + 500;
      let forbiddenStatus = 0;
      let forbiddenBody = '';
      while (Date.now() < deadline) {
        const response = await fetch(`http://127.0.0.1:${port}/api/v1/monitor/videos`);
        forbiddenStatus = response.status;
        forbiddenBody = await response.text();
        if (forbiddenStatus === 503) break;
        await sleep(15);
      }
      const completed = await first;
      const list = (await completed.json()) as { totalItems?: number };
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const events = await logEvents(isolated.sql, instance);
      expect(forbiddenStatus).toBe(503);
      expect(JSON.parse(forbiddenBody)).toEqual({ error: 'shutting down' });
      expect(completed.status).toBe(200);
      expect(child.lines.join('\n')).toContain('process.signal_duplicate');
      expect(list.totalItems).toBe(0);
      expect(exitCode).toBe(0);
      expect(elapsedMs).toBeGreaterThanOrEqual(450);
      expect(elapsedMs).toBeLessThan(2_200);
      expect(events.filter((event) => event === 'service.stopped')).toEqual(['service.stopped']);
      evidence({
        case: 'api-inflight-http',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        duplicateSignal: 'SIGTERM',
        exitCode,
        elapsedMs,
        inflightStatus: completed.status,
        totalItems: list.totalItems,
        rejectedStatus: forbiddenStatus,
        events,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a backfill accepted before SIGTERM finishes and writes the video', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      API_LIFECYCLE_BACKFILL_DELAY_MS: '600',
      LOG_FLUSH_DEADLINE_MS: '500',
      PROCESS_EXIT_BUDGET_MS: '3000',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitForHealth(port, child);
      const pending = startRefresh(port, false);
      await pending.done;
      expect(pending.shot.status).toBe(202);
      expect(child.lines.some((line) => isEvent(line, 'backfill.started', instance))).toBe(true);
      expect(child.lines.some((line) => isEvent(line, 'lifecycle.http_held', instance))).toBe(
        false,
      );
      const signaledAt = Date.now();
      expect(pending.shot.at).toBeLessThanOrEqual(signaledAt);
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const events = await logEvents(isolated.sql, instance);
      const runs = await isolated.sql<{ id: string; status: string }[]>`
        SELECT id::text AS id, status FROM backfill_runs
      `;
      const videos = await isolated.sql<
        { title: string | null; metadata_state: string; cover_state: string }[]
      >`
        SELECT title, metadata_state, cover_state FROM videos WHERE bvid = ${bvid}
      `;
      expect(exitCode).toBe(0);
      expect(elapsedMs).toBeGreaterThanOrEqual(300);
      expect(runs[0]?.status).toBe('succeeded');
      expect(videos[0]).toMatchObject({
        title: '接口标题',
        metadata_state: 'ok',
        cover_state: 'ok',
      });
      expect(events).toContain('backfill.finished');
      expect(events.filter((event) => event === 'service.stopped')).toHaveLength(1);
      evidence({
        case: 'api-backfill-after-202',
        database: isolated.databaseName,
        instance,
        runId: runs[0]?.id,
        runStatus: runs[0]?.status,
        signal: 'SIGTERM',
        signaledAfterHttp: true,
        exitCode,
        elapsedMs,
        events,
        video: videos[0],
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a backfill accepted before SIGTERM and then hung is not success', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      API_LIFECYCLE_BACKFILL: 'hang',
      LOG_FLUSH_DEADLINE_MS: '300',
      PROCESS_EXIT_BUDGET_MS: '1600',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitForHealth(port, child);
      const pending = startRefresh(port, false);
      await pending.done;
      expect(pending.shot.status).toBe(202);
      expect(child.lines.some((line) => isEvent(line, 'backfill.started', instance))).toBe(true);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const events = await logEvents(isolated.sql, instance);
      const runs = await isolated.sql<{ id: string; status: string }[]>`
        SELECT id::text AS id, status FROM backfill_runs
      `;
      const videos = await isolated.sql<{ bvid: string }[]>`
        SELECT bvid FROM videos WHERE bvid = ${bvid}
      `;
      const incomplete = record(child.lines, 'process.shutdown_incomplete');
      expect(exitCode).not.toBe(0);
      expect(elapsedMs).toBeGreaterThanOrEqual(500);
      expect(elapsedMs).toBeLessThan(3_000);
      expect(runs[0]?.status).toBe('running');
      expect(videos).toHaveLength(0);
      expect(incomplete?.context?.task).toBe('timed_out');
      expect(events).not.toContain('backfill.finished');
      evidence({
        case: 'api-backfill-hang-after-202',
        database: isolated.databaseName,
        instance,
        runId: runs[0]?.id,
        runStatus: runs[0]?.status,
        signal: 'SIGTERM',
        signaledAfterHttp: true,
        exitCode,
        elapsedMs,
        task: incomplete?.context?.task,
        events,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('HTTP entered before SIGTERM can register a slow backfill afterwards', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      API_LIFECYCLE_HTTP_HOLD_MS: '600',
      API_LIFECYCLE_BACKFILL_DELAY_MS: '400',
      LOG_FLUSH_DEADLINE_MS: '800',
      PROCESS_EXIT_BUDGET_MS: '4000',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitForHealth(port, child);
      const pending = startRefresh(port, true);
      await child.waitForLine((line) => isEvent(line, 'lifecycle.http_held', instance), 10_000);
      expect(child.lines.some((line) => isEvent(line, 'backfill.started', instance))).toBe(false);
      expect(pending.shot.status).toBe(0);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      await pending.done;
      expect(pending.shot.status).toBe(202);
      expect(pending.shot.at).toBeGreaterThan(signaledAt);
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const events = await logEvents(isolated.sql, instance);
      const runs = await isolated.sql<{ id: string; status: string }[]>`
        SELECT id::text AS id, status FROM backfill_runs
      `;
      const videos = await isolated.sql<
        { title: string | null; metadata_state: string; cover_state: string }[]
      >`
        SELECT title, metadata_state, cover_state FROM videos WHERE bvid = ${bvid}
      `;
      expect(exitCode).toBe(0);
      expect(elapsedMs).toBeGreaterThanOrEqual(700);
      expect(runs[0]?.id).toBe(pending.shot.body.backfillRunId);
      expect(runs[0]?.status).toBe('succeeded');
      expect(videos[0]).toMatchObject({
        title: '接口标题',
        metadata_state: 'ok',
        cover_state: 'ok',
      });
      expect(events).toContain('backfill.started');
      expect(events).toContain('backfill.finished');
      expect(events.filter((event) => event === 'service.stopped')).toHaveLength(1);
      evidence({
        case: 'api-late-backfill-success',
        database: isolated.databaseName,
        instance,
        runId: runs[0]?.id,
        runStatus: runs[0]?.status,
        signal: 'SIGTERM',
        httpStatusAtSignal: 0,
        httpStatus: pending.shot.status,
        responseAfterSignalMs: pending.shot.at - signaledAt,
        exitCode,
        elapsedMs,
        events,
        video: videos[0],
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('HTTP entered before SIGTERM can register a hung backfill afterwards', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      API_LIFECYCLE_HTTP_HOLD_MS: '600',
      API_LIFECYCLE_BACKFILL: 'hang',
      LOG_FLUSH_DEADLINE_MS: '400',
      PROCESS_EXIT_BUDGET_MS: '2200',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitForHealth(port, child);
      const pending = startRefresh(port, true);
      await child.waitForLine((line) => isEvent(line, 'lifecycle.http_held', instance), 10_000);
      expect(child.lines.some((line) => isEvent(line, 'backfill.started', instance))).toBe(false);
      expect(pending.shot.status).toBe(0);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      await pending.done;
      expect(pending.shot.status).toBe(202);
      expect(pending.shot.at).toBeGreaterThan(signaledAt);
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const events = await logEvents(isolated.sql, instance);
      const runs = await isolated.sql<{ id: string; status: string }[]>`
        SELECT id::text AS id, status FROM backfill_runs
      `;
      const videos = await isolated.sql<{ bvid: string }[]>`
        SELECT bvid FROM videos WHERE bvid = ${bvid}
      `;
      const incomplete = record(child.lines, 'process.shutdown_incomplete');
      expect(exitCode).not.toBe(0);
      expect(elapsedMs).toBeGreaterThanOrEqual(1_000);
      expect(elapsedMs).toBeLessThan(4_000);
      expect(runs[0]?.status).toBe('running');
      expect(videos).toHaveLength(0);
      expect(incomplete?.context?.task).toBe('timed_out');
      expect(events).toContain('backfill.started');
      expect(events).not.toContain('backfill.finished');
      evidence({
        case: 'api-late-backfill-hang',
        database: isolated.databaseName,
        instance,
        runId: runs[0]?.id,
        runStatus: runs[0]?.status,
        signal: 'SIGTERM',
        httpStatusAtSignal: 0,
        httpStatus: pending.shot.status,
        responseAfterSignalMs: pending.shot.at - signaledAt,
        exitCode,
        elapsedMs,
        task: incomplete?.context?.task,
        events,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('an active backfill rejection is scrubbed and is not exit 0', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      API_LIFECYCLE_BACKFILL: 'reject',
      API_LIFECYCLE_BACKFILL_DELAY_MS: '500',
      LOG_FLUSH_DEADLINE_MS: '600',
      PROCESS_EXIT_BUDGET_MS: '3000',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitForHealth(port, child);
      const pending = startRefresh(port, false);
      await pending.done;
      expect(pending.shot.status).toBe(202);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const text = `${child.lines.join('\n')}\n${child.stderr.join('\n')}`;
      const stored = await isolated.sql<{ message: string; context: string }[]>`
        SELECT message, context::text AS context FROM app_logs WHERE instance = ${instance}
      `;
      const incomplete = record(child.lines, 'process.background_failed');
      const shutdown = record(child.lines, 'process.shutdown_incomplete');
      assertNoSecret(text);
      assertNoSecret(stored.map((row) => `${row.message} ${row.context}`).join('\n'));
      expect(exitCode).not.toBe(0);
      expect(String(incomplete?.context?.error ?? '')).toContain('metadata-backfill-rejected');
      expect(shutdown?.context?.task).toBe('failed');
      expect(await logEvents(isolated.sql, instance)).toContain('service.stopped');
      evidence({
        case: 'api-backfill-reject',
        database: isolated.databaseName,
        instance,
        runId: pending.shot.body.backfillRunId,
        signal: 'SIGTERM',
        exitCode,
        elapsedMs,
        task: shutdown?.context?.task,
        error: incomplete?.context?.error,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a backfill rejection that already settled does not fail the next exit', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      API_LIFECYCLE_BACKFILL: 'reject',
      LOG_FLUSH_DEADLINE_MS: '800',
      PROCESS_EXIT_BUDGET_MS: '2500',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitForHealth(port, child);
      const pending = startRefresh(port, false);
      await pending.done;
      expect(pending.shot.status).toBe(202);
      await waitForLogged(isolated.sql, instance, 'backfill.finished');
      await sleep(80);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const stdout = child.lines.join('\n');
      const events = await logEvents(isolated.sql, instance);
      assertNoSecret(`${stdout}\n${child.stderr.join('\n')}`);
      expect(exitCode).toBe(0);
      expect(elapsedMs).toBeLessThan(2_000);
      expect(stdout).not.toContain('process.shutdown_incomplete');
      expect(stdout).not.toContain('process.background_failed');
      expect(events).toContain('backfill.finished');
      expect(events.filter((event) => event === 'service.stopped')).toHaveLength(1);
      evidence({
        case: 'api-settled-rejection-then-exit',
        database: isolated.databaseName,
        instance,
        runId: pending.shot.body.backfillRunId,
        signal: 'SIGTERM',
        exitCode,
        elapsedMs,
        events,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a slow sink still persists the API stop tail', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      LOG_SINK_TEST: 'delay',
      LOG_SINK_TEST_DELAY_MS: '400',
      LOG_FLUSH_DEADLINE_MS: '2000',
      PROCESS_EXIT_BUDGET_MS: '4000',
    });
    try {
      const seenAt = await child.waitForLine(
        (line) => isEvent(line, 'service.started', instance),
        15_000,
      );
      const signaledAt = Date.now();
      expect(signaledAt - seenAt).toBeLessThan(300);
      child.kill('SIGINT');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const events = await logEvents(isolated.sql, instance);
      expect(exitCode).toBe(0);
      expect(elapsedMs).toBeGreaterThanOrEqual(300);
      expect(events).toEqual(['service.started', 'service.stopped']);
      evidence({
        case: 'api-slow-sink',
        database: isolated.databaseName,
        instance,
        signal: 'SIGINT',
        exitCode,
        elapsedMs,
        events,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a failing sink is scrubbed and is not exit 0', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      LOG_SINK_TEST: 'error',
      LOG_FLUSH_DEADLINE_MS: '1000',
      PROCESS_EXIT_BUDGET_MS: '2500',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const stdout = child.lines.join('\n');
      const incomplete = record(child.lines, 'process.shutdown_incomplete');
      assertNoSecret(`${stdout}\n${child.stderr.join('\n')}`);
      expect(exitCode).not.toBe(0);
      expect(stdout).toContain('log.sink_failed');
      expect(incomplete?.context?.flushOk).toBe(false);
      expect(await logEvents(isolated.sql, instance)).not.toContain('service.stopped');
      evidence({
        case: 'api-sink-error',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        exitCode,
        elapsedMs,
        flushReason: incomplete?.context?.flushReason,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a hung sink hits the flush deadline from the API entry', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      LOG_SINK_TEST: 'hang',
      LOG_FLUSH_DEADLINE_MS: '400',
      PROCESS_EXIT_BUDGET_MS: '1500',
    });
    try {
      const seenAt = await child.waitForLine(
        (line) => isEvent(line, 'service.started', instance),
        15_000,
      );
      const signaledAt = Date.now();
      expect(signaledAt - seenAt).toBeLessThan(300);
      child.kill('SIGINT');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const stdout = child.lines.join('\n');
      expect(exitCode).not.toBe(0);
      expect(elapsedMs).toBeGreaterThanOrEqual(350);
      expect(elapsedMs).toBeLessThan(3_000);
      expect(
        stdout.includes('log.flush_timeout') || stdout.includes('process.shutdown_incomplete'),
      ).toBe(true);
      expect(await logEvents(isolated.sql, instance)).not.toContain('service.stopped');
      evidence({
        case: 'api-sink-hang',
        database: isolated.databaseName,
        instance,
        signal: 'SIGINT',
        exitCode,
        elapsedMs,
        flushDeadlineMs: 400,
        exitBudgetMs: 1500,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a full queue persists the stop tail after the accepted batch drains', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      LOG_QUEUE_MAX_RECORDS: '1',
      LOG_SINK_TEST: 'delay',
      LOG_SINK_TEST_DELAY_MS: '400',
    });
    try {
      const seenAt = await child.waitForLine(
        (line) => isEvent(line, 'service.started', instance),
        15_000,
      );
      const signaledAt = Date.now();
      expect(signaledAt - seenAt).toBeLessThan(300);
      child.kill('SIGINT');
      await sleep(30);
      child.kill('SIGINT');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const events = await logEvents(isolated.sql, instance);
      const stdout = child.lines.join('\n');
      expect(exitCode).toBe(0);
      expect(stdout).toContain('log.queue_overflow');
      expect(stdout).toContain('process.signal_duplicate');
      expect(events).toEqual(['service.started', 'service.stopped']);
      evidence({
        case: 'api-full-budget-stop-recovered',
        database: isolated.databaseName,
        instance,
        signal: 'SIGINT',
        duplicateSignal: 'SIGINT',
        exitCode,
        elapsedMs,
        signalLagMs: signaledAt - seenAt,
        events,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a full queue that cannot accept the stop tail exits non-zero', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      LOG_QUEUE_MAX_RECORDS: '1',
      LOG_SINK_TEST: 'hang',
      LOG_FLUSH_DEADLINE_MS: '400',
      PROCESS_EXIT_BUDGET_MS: '1500',
    });
    try {
      const seenAt = await child.waitForLine(
        (line) => isEvent(line, 'service.started', instance),
        15_000,
      );
      const signaledAt = Date.now();
      expect(signaledAt - seenAt).toBeLessThan(300);
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const events = await logEvents(isolated.sql, instance);
      const incomplete = record(child.lines, 'process.shutdown_incomplete');
      expect(exitCode).not.toBe(0);
      expect(elapsedMs).toBeGreaterThanOrEqual(350);
      expect(elapsedMs).toBeLessThan(2_500);
      expect(incomplete?.context?.stopEventAccepted).toBe(false);
      expect(events).not.toContain('service.stopped');
      evidence({
        case: 'api-full-budget-stop-rejected',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        exitCode,
        elapsedMs,
        signalLagMs: signaledAt - seenAt,
        stopEventAccepted: false,
        events,
        flushDeadlineMs: 400,
        exitBudgetMs: 1500,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('resource close is bounded by the API shutdown deadline', async () => {
    const isolated = await openDb();
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      API_LIFECYCLE_CLOSE_HANG: '1',
      LOG_FLUSH_DEADLINE_MS: '300',
      PROCESS_EXIT_BUDGET_MS: '1500',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsedMs = Date.now() - signaledAt;
      const stdout = child.lines.join('\n');
      expect(stdout).toContain('lifecycle.close_started');
      expect(exitCode === 0 || exitCode === 2).toBe(true);
      expect(elapsedMs).toBeGreaterThanOrEqual(900);
      expect(elapsedMs).toBeLessThan(3_500);
      if (exitCode === 0) expect(stdout).not.toContain('process.exit_budget_exceeded');
      if (exitCode === 2) expect(stdout).toContain('process.exit_budget_exceeded');
      const probe = await isolated.sql<{ ok: number }[]>`SELECT 1 AS ok`;
      expect(probe[0]?.ok).toBe(1);
      evidence({
        case: 'api-close-deadline',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        exitCode,
        elapsedMs,
        exitBudgetMs: 1500,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('startup without PostgreSQL fails closed', async () => {
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnLifecycleProcess({
      cwd: repoRoot,
      script: 'apps/api/src/index.ts',
      env: lifecycleChildEnv('studio_ci', {
        POSTGRES_HOST: '127.0.0.1',
        POSTGRES_PORT: '1',
        MONITOR_DATA_SOURCE: 'mock',
        HOSTNAME: instance,
        API_PORT: String(port),
      }),
    });
    try {
      const exitCode = await Promise.race([
        child.exited,
        sleep(8_000).then(() => {
          child.kill('SIGKILL');
          return -1;
        }),
      ]);
      const started = child.lines.some((line) => isEvent(line, 'service.started', instance));
      expect(exitCode).not.toBe(0);
      expect(exitCode).not.toBe(-1);
      expect(started).toBe(false);
      evidence({
        case: 'api-postgres-missing',
        instance,
        exitCode,
        started,
      });
    } finally {
      child.dispose();
    }
  }, 20_000);
});
