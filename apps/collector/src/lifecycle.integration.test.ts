import { afterAll, describe, expect, test } from 'bun:test';
import { createRetainedTestDatabase, type Sql } from '@studio/db';
import { installOfflineFetchGuard } from '@studio/monitoring';
import {
  evidence,
  lifecycleChildEnv,
  parseLogEvent,
  spawnLifecycleProcess,
  type LifecycleChild,
} from '@studio/observability';
import { join } from 'node:path';

installOfflineFetchGuard();

const repoRoot = join(import.meta.dir, '../../..');
const open: Sql[] = [];

afterAll(async () => {
  for (const sql of open) await sql.end({ timeout: 5 }).catch(() => undefined);
});

function isEvent(line: string, event: string, instance: string): boolean {
  const parsed = parseLogEvent(line);
  return parsed?.event === event && parsed.instance === instance;
}

function spawnCollector(
  database: string,
  instance: string,
  extra: Record<string, string> = {},
): LifecycleChild {
  return spawnLifecycleProcess({
    cwd: repoRoot,
    script: 'apps/collector/src/index.ts',
    env: lifecycleChildEnv(database, {
      MONITOR_DATA_SOURCE: 'collector',
      COLLECTOR_INSTANCE_ID: instance,
      COLLECTOR_POLL_MS: '50',
      COLLECTOR_RATE_LIMIT_MS: '0',
      SOURCE_TIMEZONE: 'Asia/Shanghai',
      ...extra,
    }),
  });
}

async function insertDueVideo(sql: Sql, externalId: string) {
  await sql`
    INSERT INTO monitor_targets (
      id, "type", external_id, interval_minutes, interval_mode, source, next_run_at, enabled
    ) VALUES (
      ${crypto.randomUUID()}::uuid,
      'video',
      ${externalId},
      60,
      'fixed',
      'offline',
      ${new Date(Date.now() - 60_000)},
      true
    )
  `;
}

async function waitHeartbeat(sql: Sql, instance: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM collector_heartbeats WHERE instance_id = ${instance}
    `;
    if (rows[0]) return rows[0].status;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  return '';
}

describe('collector process shutdown', () => {
  test('SIGINT flushes the startup tail after a real heartbeat', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `collector-${crypto.randomUUID()}`;
    const child = spawnCollector(isolated.databaseName, instance);
    try {
      const seenAt = await child.waitForLine(
        (line) => isEvent(line, 'service.started', instance),
        15_000,
      );
      const heartbeat = await waitHeartbeat(isolated.sql, instance, 200);
      const signaledAt = Date.now();
      expect(heartbeat.length).toBeGreaterThan(0);
      expect(signaledAt - seenAt).toBeLessThan(250);
      child.kill('SIGINT');
      const exitCode = await child.exited;
      const rows = await isolated.sql<{ event: string | null }[]>`
        SELECT event FROM app_logs WHERE instance = ${instance} ORDER BY id
      `;
      expect(exitCode).toBe(0);
      expect(rows.map((row) => row.event)).toEqual(['service.started', 'service.stopped']);
      expect(child.lines.some((line) => line.includes('lifecycle.offline_guard'))).toBe(true);
      evidence({
        case: 'collector-sigint-tail',
        database: isolated.databaseName,
        instance,
        signal: 'SIGINT',
        exitCode,
        signalLagMs: signaledAt - seenAt,
        heartbeat,
        logCount: rows.length,
        events: rows.map((row) => row.event),
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('SIGTERM lets the current offline job finish and does not claim the next one', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    await insertDueVideo(isolated.sql, 'BV1xx411c7mD');
    await insertDueVideo(isolated.sql, 'BV1xx411c7mE');
    const instance = `collector-${crypto.randomUUID()}`;
    const child = spawnCollector(isolated.databaseName, instance, {
      COLLECTOR_TEST_TASK_DELAY_MS: '800',
    });
    try {
      const deadline = Date.now() + 10_000;
      let running = false;
      while (Date.now() < deadline) {
        const rows = await isolated.sql<{ status: string }[]>`
          SELECT status FROM collector_jobs
        `;
        if (rows.some((row) => row.status === 'running')) {
          running = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      expect(running).toBe(true);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsed = Date.now() - signaledAt;
      const jobs = await isolated.sql<{ status: string; external_id: string }[]>`
        SELECT j.status, t.external_id
        FROM collector_jobs j
        JOIN monitor_targets t ON t.id = j.target_id
        ORDER BY t.external_id
      `;
      const runs = await isolated.sql<{ id: string }[]>`
        SELECT id::text AS id FROM collector_runs ORDER BY finished_at
      `;
      const rows = await isolated.sql<{ event: string | null }[]>`
        SELECT event FROM app_logs WHERE instance = ${instance} ORDER BY id
      `;
      expect(exitCode).toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(400);
      expect(jobs.filter((job) => job.status === 'succeeded')).toHaveLength(1);
      expect(jobs.filter((job) => job.status === 'pending')).toHaveLength(1);
      expect(rows.filter((row) => row.event === 'service.stopped')).toHaveLength(1);
      evidence({
        case: 'collector-sigterm-current-task',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        duplicateSignal: 'SIGTERM',
        exitCode,
        elapsedMs: elapsed,
        jobs,
        runIds: runs.map((run) => run.id),
        logCount: rows.length,
        events: rows.map((row) => row.event),
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a hung current task is cut by the exit budget and is not success', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    await insertDueVideo(isolated.sql, 'BV1xx411c7mD');
    const instance = `collector-${crypto.randomUUID()}`;
    const child = spawnCollector(isolated.databaseName, instance, {
      COLLECTOR_TEST_TASK_HANG: '1',
      LOG_FLUSH_DEADLINE_MS: '300',
      PROCESS_EXIT_BUDGET_MS: '1200',
    });
    try {
      const deadline = Date.now() + 10_000;
      let running = false;
      while (Date.now() < deadline) {
        const rows = await isolated.sql<{ status: string }[]>`SELECT status FROM collector_jobs`;
        if (rows.some((row) => row.status === 'running')) {
          running = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      expect(running).toBe(true);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsed = Date.now() - signaledAt;
      const jobs = await isolated.sql<{ status: string }[]>`SELECT status FROM collector_jobs`;
      const stdout = child.lines.join('\n');
      expect(exitCode).not.toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeLessThan(3_000);
      expect(jobs.some((job) => job.status === 'succeeded')).toBe(false);
      expect(stdout).toContain('process.shutdown_incomplete');
      evidence({
        case: 'collector-task-hang',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        exitCode,
        elapsedMs: elapsed,
        flushDeadlineMs: 300,
        exitBudgetMs: 1200,
        jobs: jobs.map((job) => job.status),
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a hung sink hits the flush deadline after heartbeat', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `collector-${crypto.randomUUID()}`;
    const child = spawnCollector(isolated.databaseName, instance, {
      LOG_SINK_TEST: 'hang',
      LOG_FLUSH_DEADLINE_MS: '400',
      PROCESS_EXIT_BUDGET_MS: '1500',
    });
    try {
      const seenAt = await child.waitForLine(
        (line) => isEvent(line, 'service.started', instance),
        15_000,
      );
      const heartbeat = await waitHeartbeat(isolated.sql, instance, 2_000);
      expect(heartbeat.length).toBeGreaterThan(0);
      const signaledAt = Date.now();
      child.kill('SIGINT');
      const exitCode = await child.exited;
      const elapsed = Date.now() - signaledAt;
      const stdout = child.lines.join('\n');
      expect(exitCode).not.toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(350);
      expect(elapsed).toBeLessThan(2_500);
      expect(
        stdout.includes('log.flush_timeout') || stdout.includes('process.shutdown_incomplete'),
      ).toBe(true);
      expect(signaledAt).toBeGreaterThan(seenAt);
      evidence({
        case: 'collector-sink-hang',
        database: isolated.databaseName,
        instance,
        signal: 'SIGINT',
        exitCode,
        elapsedMs: elapsed,
        heartbeat,
        flushDeadlineMs: 400,
        exitBudgetMs: 1500,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a collector loop rejection is flushed and is not exit 0', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `fatal-loop-${crypto.randomUUID()}`;
    const child = spawnCollector(isolated.databaseName, instance, { COLLECTOR_POLL_MS: '50' });
    let renamed = false;
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await isolated.sql`ALTER TABLE collector_jobs RENAME TO collector_jobs_hidden`;
      renamed = true;
      const exitCode = await child.exited;
      const stdout = child.lines.join('\n');
      const rows = await isolated.sql<{ event: string | null }[]>`
        SELECT event FROM app_logs WHERE instance = ${instance} ORDER BY id
      `;
      expect(exitCode).not.toBe(0);
      expect(stdout).toContain('process.loop_failed');
      expect(stdout).toContain('collector_jobs');
      expect(rows.filter((row) => row.event === 'service.started')).toHaveLength(1);
      expect(rows.filter((row) => row.event === 'service.stopped')).toHaveLength(1);
      evidence({
        case: 'collector-loop-reject',
        database: isolated.databaseName,
        instance,
        exitCode,
        logCount: rows.length,
        events: rows.map((row) => row.event),
      });
    } finally {
      if (renamed) {
        await isolated.sql`ALTER TABLE collector_jobs_hidden RENAME TO collector_jobs`;
      }
      child.dispose();
    }
  }, 40_000);
});
