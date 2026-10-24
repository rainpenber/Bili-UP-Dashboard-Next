import { runMigrations, createSql } from '@studio/db';
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
  type ShutdownDiagnostic,
} from '@studio/observability';
import { createApp } from './app';
import {
  LIFECYCLE_HOLD_HEADER,
  lifecycleMetadataOverrides,
  readLifecycleHoldMs,
} from './lifecycle-metadata';
import { mountApiRoutes } from './mount-api';
import { createProcessWork, httpRejected } from './process-work';

const port = Number(process.env.API_PORT ?? 3000);
const instance = process.env.HOSTNAME ?? 'api';
const envName = process.env.NODE_ENV ?? 'development';
const destination = (line: string) => {
  process.stdout.write(line);
};

function writeDiagnostic(record: ShutdownDiagnostic) {
  const context: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record.context)) {
    context[key] = typeof value === 'string' ? scrubString(value) : value;
  }
  destination(
    `${JSON.stringify({
      level: record.level,
      time: new Date().toISOString(),
      service: 'api',
      instance,
      env: envName,
      msg: scrubString(record.msg),
      event: record.event,
      requestId: null,
      jobId: null,
      runId: null,
      targetId: null,
      context,
    })}\n`,
  );
}

if (lifecycleTestEnabled(process.env)) installOfflineFetchGuard();

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
let server: ReturnType<typeof Bun.serve> | undefined;
let drainIncomplete = false;
const work = createProcessWork({
  inflightNetwork: () => (server ? server.pendingRequests + server.pendingWebSockets : 0),
});
const holdMs = readLifecycleHoldMs(process.env);
const app = createApp({ skipDb: true, logger });
mountApiRoutes(app, sql, {
  logger,
  onBackfill: (task) => work.trackBackground(task),
  ...lifecycleMetadataOverrides(process.env),
});

const shutdown = createShutdownController({
  budgets: readShutdownBudgets(process.env),
  writeDiagnostic,
  hooks: {
    stopAccepting() {
      work.stopAccepting();
    },
    async finishCurrent(timeoutMs) {
      const result = await work.finish(timeoutMs);
      drainIncomplete = result !== 'finished';
      if (result === 'failed') {
        writeDiagnostic({
          level: 'error',
          event: 'process.background_failed',
          msg: '后台工作异常结束',
          context: { error: work.failureMessage() ?? 'background failed' },
        });
      }
      if (
        result === 'timed_out' &&
        work.activeHttp === 0 &&
        work.activeBackground === 0 &&
        work.inflightNetwork() > 0
      ) {
        writeDiagnostic({
          level: 'error',
          event: 'process.response_undrained',
          msg: 'HTTP 响应尚未发送完成',
          context: { pendingRequests: work.inflightNetwork() },
        });
      }
      return result;
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
      const closingServer = server;
      server = undefined;
      if (closingServer) {
        await closingServer.stop(drainIncomplete).catch(() => undefined);
      }
      const closed = closeSqlWithin(sql, timeoutMs);
      if (lifecycleTestEnabled(process.env) && process.env.API_LIFECYCLE_CLOSE_HANG === '1') {
        await closed;
        writeDiagnostic({
          level: 'info',
          event: 'lifecycle.close_started',
          msg: '测试进程开始挂起资源关闭',
          context: { timeoutMs },
        });
        await new Promise<void>(() => undefined);
        return;
      }
      await closed;
    },
  },
});

const onSignal = (signal: string) => {
  void shutdown.start(signal);
};
process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

// 只启动这一个 Bun server。不要再 default export fetch，否则会再听一个端口。
server = Bun.serve({
  port,
  async fetch(request) {
    const outcome = await work.runHttp(async () => {
      if (holdMs > 0 && request.headers.get(LIFECYCLE_HOLD_HEADER) === '1') {
        writeDiagnostic({
          level: 'info',
          event: 'lifecycle.http_held',
          msg: '测试请求已进入并开始等待',
          context: { holdMs },
        });
        await new Promise((resolve) => setTimeout(resolve, holdMs));
      }
      return app.fetch(request);
    });
    if (outcome === httpRejected) {
      return new Response(JSON.stringify({ error: 'shutting down' }), {
        status: 503,
        headers: { 'content-type': 'application/json; charset=utf-8' },
      });
    }
    return outcome;
  },
});

if (lifecycleTestEnabled(process.env)) {
  writeDiagnostic({
    level: 'info',
    event: 'lifecycle.offline_guard',
    msg: '测试进程已安装离线网络守卫',
    context: {},
  });
}
logger.info('API 启动', { event: 'service.started' });

if (import.meta.main) {
  console.log(
    `Studio API listening on http://localhost:${port} (MONITOR_DATA_SOURCE=${process.env.MONITOR_DATA_SOURCE ?? 'mock'})`,
  );
}
