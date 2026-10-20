import { createSql, runMigrations } from '@studio/db';
import { installOfflineFetchGuard } from '@studio/monitoring';
import {
  applyLifecycleTestSink,
  closeSqlWithin,
  createLogger,
  createPgLogSink,
  createShutdownController,
  lifecycleTestEnabled,
  readShutdownBudgets,
  scrubString,
  startAppLogRetention,
  type CurrentTaskResult,
  type ShutdownDiagnostic,
} from '@studio/observability';
import type { MonitorRefreshOptions } from './monitor-routes';
import { createApp } from './app';
import { mountApiRoutes } from './mount-api';

const port = Number(process.env.API_PORT ?? 3000);
const instance = process.env.HOSTNAME ?? 'api';
const envName = process.env.NODE_ENV ?? 'development';
const destination = (line: string) => {
  process.stdout.write(line);
};

function writeDiagnostic(record: ShutdownDiagnostic) {
  destination(
    `${JSON.stringify({
      level: record.level,
      time: new Date().toISOString(),
      service: 'api',
      instance,
      env: envName,
      msg: record.msg,
      event: record.event,
      requestId: null,
      jobId: null,
      runId: null,
      targetId: null,
      context: record.context,
    })}\n`,
  );
}

const sql = createSql();
await runMigrations(sql);
const sink = applyLifecycleTestSink(
  createPgLogSink(sql, { destination, service: 'api', instance, envName }),
  process.env,
);
const logger = createLogger({
  service: 'api',
  instance,
  envName,
  destination,
  sink,
});
const stopRetention = startAppLogRetention(sql, {
  onError: (message) => {
    logger.error('日志清理失败', { event: 'log.retention_failed', context: { error: message } });
  },
});
const app = createApp({ skipDb: true, logger });
const backgroundTasks: Promise<void>[] = [];
let backgroundFailed = false;

function trackBackfill(task: Promise<void>) {
  const settled = task.then(
    () => undefined,
    (error: unknown) => {
      backgroundFailed = true;
      writeDiagnostic({
        level: 'error',
        event: 'process.background_failed',
        msg: '后台任务失败',
        context: {
          error: scrubString(error instanceof Error ? error.message : 'background failed'),
        },
      });
    },
  );
  backgroundTasks.push(settled);
}

const monitor: MonitorRefreshOptions = { logger, onBackfill: trackBackfill };
if (lifecycleTestEnabled(process.env)) {
  const { applyLifecycleBackfillTestDeps } = await import('./lifecycle-backfill');
  applyLifecycleBackfillTestDeps(monitor, process.env);
}
mountApiRoutes(app, sql, monitor);

let draining = false;
let inflight = 0;
const idleWaiters: Array<() => void> = [];
let boundStop: ((closeActiveConnections?: boolean) => void) | undefined;

function rememberServer(server: unknown) {
  if (!server || typeof server !== 'object' || !('stop' in server)) return;
  const stop = server.stop;
  if (typeof stop !== 'function') return;
  boundStop = (closeActiveConnections?: boolean) => {
    stop.call(server, closeActiveConnections);
  };
}

function readLifecycleHoldMs(request: Request): number {
  if (!lifecycleTestEnabled(process.env)) return 0;
  const raw = request.headers.get('x-lifecycle-hold-ms');
  if (raw === null || raw.trim() === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 30_000) return 0;
  return value;
}

async function wrappedFetch(request: Request, server?: unknown): Promise<Response> {
  rememberServer(server);
  if (draining) {
    return new Response(JSON.stringify({ error: 'shutting_down' }), {
      status: 503,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
  }
  inflight += 1;
  try {
    const holdMs = readLifecycleHoldMs(request);
    if (holdMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, holdMs));
    }
    return await app.fetch(request);
  } finally {
    inflight -= 1;
    if (inflight === 0) {
      const waiters = idleWaiters.splice(0, idleWaiters.length);
      for (const waiter of waiters) waiter();
    }
  }
}

function waitForHttp(timeoutMs: number): Promise<'finished' | 'timed_out'> {
  if (inflight === 0) return Promise.resolve('finished');
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: 'finished' | 'timed_out') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const index = idleWaiters.indexOf(onIdle);
      if (index >= 0) idleWaiters.splice(index, 1);
      resolve(result);
    };
    const onIdle = () => finish('finished');
    const timer = setTimeout(() => finish('timed_out'), timeoutMs);
    idleWaiters.push(onIdle);
    if (inflight === 0) onIdle();
  });
}

function waitForBackground(timeoutMs: number): Promise<'finished' | 'timed_out'> {
  if (backgroundTasks.length === 0) return Promise.resolve('finished');
  const pending = Promise.all(backgroundTasks).then(() => 'finished' as const);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('timed_out'), timeoutMs);
    pending.then(() => {
      clearTimeout(timer);
      resolve('finished');
    });
  });
}

async function finishInFlight(timeoutMs: number): Promise<CurrentTaskResult> {
  const [http, background] = await Promise.all([
    waitForHttp(timeoutMs),
    waitForBackground(timeoutMs),
  ]);
  if (backgroundFailed) return 'failed';
  if (http === 'timed_out' || background === 'timed_out') return 'timed_out';
  return 'finished';
}

function readFillCount(env: NodeJS.ProcessEnv): number {
  if (!lifecycleTestEnabled(env)) return 0;
  const raw = env.LOG_TEST_FILL_RECORDS;
  if (raw === undefined || raw.trim() === '') return 0;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 0 || value > 1_000) {
    throw new Error('LOG_TEST_FILL_RECORDS 超出范围');
  }
  return value;
}

if (import.meta.main) {
  if (lifecycleTestEnabled(process.env)) {
    installOfflineFetchGuard();
    writeDiagnostic({
      level: 'info',
      event: 'lifecycle.offline_guard',
      msg: '测试进程已安装离线网络守卫',
      context: { provider: 'offline' },
    });
  }
  const shutdown = createShutdownController({
    budgets: readShutdownBudgets(process.env),
    writeDiagnostic,
    hooks: {
      stopAccepting() {
        draining = true;
      },
      finishCurrent(timeoutMs) {
        return finishInFlight(timeoutMs);
      },
      recordStopped() {
        return logger.notePersisted('info', 'API 停止', { event: 'service.stopped' });
      },
      flush(timeoutMs) {
        return logger.flushWithin(timeoutMs);
      },
      stopRetention() {
        stopRetention();
      },
      async closeResources(timeoutMs) {
        try {
          boundStop?.(true);
        } catch {
          // the listener may already be closed
        }
        await closeSqlWithin(sql, timeoutMs);
      },
    },
  });
  const onSignal = (signal: string) => {
    void shutdown.start(signal);
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
  // One explicit server. Do not also export a fetch default: Bun would start a second listener.
  const server = Bun.serve({ port, fetch: wrappedFetch });
  rememberServer(server);
  logger.info('API 启动', { event: 'service.started' });
  const fill = readFillCount(process.env);
  for (let index = 0; index < fill; index += 1) {
    logger.warn(`容量填充 ${index}`, { event: 'lifecycle.fill' });
  }
  console.log(
    `Studio API listening on http://localhost:${server.port} (MONITOR_DATA_SOURCE=${process.env.MONITOR_DATA_SOURCE ?? 'mock'})`,
  );
}
