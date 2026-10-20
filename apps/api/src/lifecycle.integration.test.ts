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
});
