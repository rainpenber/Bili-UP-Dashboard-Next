import { afterAll, describe, expect, test } from 'bun:test';
import { createRetainedTestDatabase, type Sql } from '@studio/db';
import { installOfflineFetchGuard } from '@studio/monitoring';
import {
  evidence,
  freeTcpPort,
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

async function logsFor(sql: Sql, instance: string) {
  return sql<{ event: string | null; message: string }[]>`
    SELECT event, message
    FROM app_logs
    WHERE instance = ${instance}
    ORDER BY id
  `;
}

async function waitHealth(port: number, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let last = 'none';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) {
        await response.arrayBuffer();
        return;
      }
      last = String(response.status);
      await response.arrayBuffer();
    } catch (error) {
      last = error instanceof Error ? error.message : 'fetch failed';
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`API 未监听: ${last}`);
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
      API_PORT: String(port),
      HOSTNAME: instance,
      ...extra,
    }),
  });
}

describe('API process shutdown', () => {
  test('SIGTERM flushes the startup tail exactly once', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port);
    try {
      const seenAt = await child.waitForLine(
        (line) => isEvent(line, 'service.started', instance),
        15_000,
      );
      await waitHealth(port, 240);
      const signaledAt = Date.now();
      expect(signaledAt - seenAt).toBeLessThan(250);
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const rows = await logsFor(isolated.sql, instance);
      expect(exitCode).toBe(0);
      expect(rows.map((row) => row.event)).toEqual(['service.started', 'service.stopped']);
      expect(child.lines.some((line) => line.includes('lifecycle.offline_guard'))).toBe(true);
      evidence({
        case: 'api-sigterm-tail',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        exitCode,
        signalLagMs: signaledAt - seenAt,
        logCount: rows.length,
        events: rows.map((row) => row.event),
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('SIGINT finishes the current request, refuses new work, and is idempotent', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port);
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitHealth(port, 2_000);
      const held = fetch(`http://127.0.0.1:${port}/api/health`, {
        headers: { 'x-lifecycle-hold-ms': '700' },
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      const signaledAt = Date.now();
      child.kill('SIGINT');
      child.kill('SIGTERM');
      let status = 0;
      for (let attempt = 0; attempt < 25 && status !== 503; attempt += 1) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`);
          status = response.status;
          await response.arrayBuffer();
        } catch {
          status = 0;
        }
        if (status !== 503) await new Promise((resolve) => setTimeout(resolve, 15));
      }
      const heldResponse = await held;
      expect(heldResponse.status).toBe(200);
      expect(status).toBe(503);
      const exitCode = await child.exited;
      const elapsed = Date.now() - signaledAt;
      const rows = await logsFor(isolated.sql, instance);
      expect(exitCode).toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(400);
      expect(rows.filter((row) => row.event === 'service.stopped')).toHaveLength(1);
      expect(rows.filter((row) => row.event === 'service.started')).toHaveLength(1);
      evidence({
        case: 'api-sigint-inflight',
        database: isolated.databaseName,
        instance,
        signal: 'SIGINT',
        duplicateSignal: 'SIGTERM',
        exitCode,
        elapsedMs: elapsed,
        refusedStatus: status,
        logCount: rows.length,
        events: rows.map((row) => row.event),
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a hung sink hits the flush deadline and does not exit 0', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      LOG_SINK_TEST: 'hang',
      LOG_FLUSH_DEADLINE_MS: '400',
      PROCESS_EXIT_BUDGET_MS: '1500',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitHealth(port, 2_000);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsed = Date.now() - signaledAt;
      const stdout = child.lines.join('\n');
      expect(exitCode).not.toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(350);
      expect(elapsed).toBeLessThan(2_200);
      expect(
        stdout.includes('log.flush_timeout') || stdout.includes('process.shutdown_incomplete'),
      ).toBe(true);
      evidence({
        case: 'api-sink-hang',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        exitCode,
        elapsedMs: elapsed,
        flushDeadlineMs: 400,
        exitBudgetMs: 1500,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a failing sink is not reported as a clean exit and does not leak the fixture secret', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, { LOG_SINK_TEST: 'error' });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitHealth(port, 2_000);
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const stdout = [...child.lines, ...child.stderr].join('\n');
      const rows = await logsFor(isolated.sql, instance);
      expect(exitCode).toBe(1);
      expect(stdout).toContain('log.sink_failed');
      expect(stdout).not.toContain('plain-sess-value-9f3a');
      expect(stdout).not.toContain('plain-jct-value-9f3a');
      expect(stdout).not.toContain('abc.def-GHI_9');
      expect(JSON.stringify(rows)).not.toContain('plain-sess-value-9f3a');
      evidence({
        case: 'api-sink-error',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        exitCode,
        logCount: rows.length,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a full in-flight queue still persists the stop event after the sink recovers', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      LOG_QUEUE_MAX_RECORDS: '20',
      LOG_TEST_FILL_RECORDS: '19',
      LOG_SINK_TEST: 'delay',
      LOG_SINK_TEST_DELAY_MS: '1500',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitHealth(port, 1_000);
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const rows = await logsFor(isolated.sql, instance);
      expect(exitCode).toBe(0);
      expect(child.lines.some((line) => line.includes('log.queue_overflow'))).toBe(true);
      expect(rows.filter((row) => row.event === 'service.started')).toHaveLength(1);
      expect(rows.filter((row) => row.event === 'service.stopped')).toHaveLength(1);
      expect(rows.filter((row) => row.event === 'lifecycle.fill')).toHaveLength(19);
      evidence({
        case: 'api-full-queue-stop-event',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        exitCode,
        logCount: rows.length,
        maxRecords: 20,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a full queue that never drains does not report a successful exit', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      LOG_QUEUE_MAX_RECORDS: '20',
      LOG_TEST_FILL_RECORDS: '19',
      LOG_SINK_TEST: 'hang',
      LOG_FLUSH_DEADLINE_MS: '400',
      PROCESS_EXIT_BUDGET_MS: '1500',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitHealth(port, 2_000);
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      const exitCode = await child.exited;
      const elapsed = Date.now() - signaledAt;
      const stdout = child.lines.join('\n');
      const rows = await logsFor(isolated.sql, instance);
      expect(exitCode).not.toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(350);
      expect(elapsed).toBeLessThan(2_200);
      expect(stdout).toContain('process.shutdown_incomplete');
      expect(stdout).toContain('"stopEventAccepted":false');
      expect(rows.filter((row) => row.event === 'service.stopped')).toHaveLength(0);
      evidence({
        case: 'api-full-queue-stop-timeout',
        database: isolated.databaseName,
        instance,
        signal: 'SIGTERM',
        exitCode,
        elapsedMs: elapsed,
        stoppedRows: 0,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('SIGINT waits for an accepted offline backfill and a duplicate signal stays single', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      LOG_TEST_BACKFILL_HOLD_MS: '600',
      LOG_FLUSH_DEADLINE_MS: '400',
      PROCESS_EXIT_BUDGET_MS: '2500',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitHealth(port, 2_000);
      const accepted = await fetch(`http://127.0.0.1:${port}/api/v1/monitor/metadata/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'video', ids: ['BV1aptest411'] }),
      });
      expect(accepted.status).toBe(202);
      const body = (await accepted.json()) as { backfillRunId: string };
      const signaledAt = Date.now();
      child.kill('SIGINT');
      child.kill('SIGTERM');
      let status = 0;
      for (let attempt = 0; attempt < 20 && status !== 503; attempt += 1) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/health`);
          status = response.status;
          await response.arrayBuffer();
        } catch {
          status = 0;
        }
        if (status !== 503) await new Promise((resolve) => setTimeout(resolve, 15));
      }
      const exitCode = await child.exited;
      const elapsed = Date.now() - signaledAt;
      const rows = await logsFor(isolated.sql, instance);
      const runs = await isolated.sql<{ status: string }[]>`
        SELECT status FROM backfill_runs WHERE id = ${body.backfillRunId}::uuid
      `;
      expect(status).toBe(503);
      expect(exitCode).toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(400);
      expect(runs[0]?.status).toBe('succeeded');
      expect(rows.filter((row) => row.event === 'service.stopped')).toHaveLength(1);
      expect(rows.some((row) => row.event === 'backfill.finished')).toBe(true);
      evidence({
        case: 'api-backfill-sigint',
        database: isolated.databaseName,
        instance,
        backfillRunId: body.backfillRunId,
        signal: 'SIGINT',
        duplicateSignal: 'SIGTERM',
        exitCode,
        elapsedMs: elapsed,
        runStatus: runs[0]?.status ?? null,
        refusedStatus: status,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);

  test('a backfill that outlives the exit budget is not a successful shutdown', async () => {
    const isolated = await createRetainedTestDatabase('wp_r2_12');
    open.push(isolated.sql);
    const instance = `api-${crypto.randomUUID()}`;
    const port = await freeTcpPort();
    const child = spawnApi(isolated.databaseName, instance, port, {
      LOG_TEST_BACKFILL_HANG: '1',
      LOG_FLUSH_DEADLINE_MS: '300',
      PROCESS_EXIT_BUDGET_MS: '1200',
    });
    try {
      await child.waitForLine((line) => isEvent(line, 'service.started', instance), 15_000);
      await waitHealth(port, 2_000);
      const accepted = await fetch(`http://127.0.0.1:${port}/api/v1/monitor/metadata/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'video', ids: ['BV1aptest411'] }),
      });
      expect(accepted.status).toBe(202);
      const body = (await accepted.json()) as { backfillRunId: string };
      const signaledAt = Date.now();
      child.kill('SIGTERM');
      child.kill('SIGINT');
      const exitCode = await child.exited;
      const elapsed = Date.now() - signaledAt;
      const runs = await isolated.sql<{ status: string }[]>`
        SELECT status FROM backfill_runs WHERE id = ${body.backfillRunId}::uuid
      `;
      const rows = await logsFor(isolated.sql, instance);
      expect(exitCode).not.toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeLessThan(3_000);
      expect(runs[0]?.status).toBe('running');
      expect(rows.filter((row) => row.event === 'service.stopped')).toHaveLength(1);
      evidence({
        case: 'api-backfill-hang',
        database: isolated.databaseName,
        instance,
        backfillRunId: body.backfillRunId,
        signal: 'SIGTERM',
        duplicateSignal: 'SIGINT',
        exitCode,
        elapsedMs: elapsed,
        runStatus: runs[0]?.status ?? null,
      });
    } finally {
      child.dispose();
    }
  }, 40_000);
});
