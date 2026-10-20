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
  trackLifecycleBackfill,
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
const work = createProcessWork();
const holdMs = readLifecycleHoldMs(process.env);
const app = createApp({ skipDb: true, logger });
mountApiRoutes(app, sql, {
  logger,
  onBackfill: (task) =>
    trackLifecycleBackfill(process.env, task, (item) => work.trackBackground(item)),
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
      if (result === 'failed') {
        writeDiagnostic({
          level: 'error',
          event: 'process.background_failed',
          msg: '后台工作异常结束',
          context: { error: work.failureMessage() ?? 'background failed' },
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
    closeResources(timeoutMs) {
      const closed = closeSqlWithin(sql, timeoutMs);
      if (lifecycleTestEnabled(process.env) && process.env.API_LIFECYCLE_CLOSE_HANG === '1') {
        return closed.then(() => {
          writeDiagnostic({
            level: 'info',
            event: 'lifecycle.close_started',
            msg: '测试进程开始挂起资源关闭',
            context: { timeoutMs },
          });
          return new Promise<void>(() => undefined);
        });
      }
      return closed;
    },
  },
});

const onSignal = (signal: string) => {
  void shutdown.start(signal);
};
process.on('SIGTERM', () => onSignal('SIGTERM'));
process.on('SIGINT', () => onSignal('SIGINT'));

if (lifecycleTestEnabled(process.env)) {
  writeDiagnostic({
    level: 'info',
    event: 'lifecycle.offline_guard',
    msg: '测试进程已安装离线网络守卫',
    context: {},
  });
}
logger.info('API 启动', { event: 'service.started' });

// Bun 对入口的 default export 启动唯一 HTTP 服务器。不要再调用 Bun.serve。
export default {
  port,
  async fetch(request: Request): Promise<Response> {
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
};

if (import.meta.main) {
  console.log(
    `Studio API listening on http://localhost:${port} (MONITOR_DATA_SOURCE=${process.env.MONITOR_DATA_SOURCE ?? 'mock'})`,
  );
}
