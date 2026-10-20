import { collectorSchemaReady, createSql } from '@studio/db';
import {
  assertProviderCanStart,
  createMonitorProvider,
  installOfflineFetchGuard,
  readCollectorConfig,
  readCollectorProviderKind,
  runCollectorLoop,
} from '@studio/monitoring';
import {
  applyLifecycleTestSink,
  closeSqlWithin,
  createLogger,
  createPgLogSink,
  createShutdownController,
  lifecycleTestEnabled,
  readShutdownBudgets,
  startAppLogRetention,
  type ShutdownDiagnostic,
} from '@studio/observability';
import { applyLifecycleTestProvider } from './lifecycle-test';
import { waitForReady } from './wait-for-schema';

const source = process.env.MONITOR_DATA_SOURCE ?? 'collector';
if (source !== 'mock' && source !== 'collector') {
  throw new Error(`Invalid MONITOR_DATA_SOURCE=${source}. collector 只接受 mock 或 collector。`);
}

const providerKind = readCollectorProviderKind(process.env);
assertProviderCanStart(providerKind, process.env);
if (providerKind === 'offline' || lifecycleTestEnabled(process.env)) installOfflineFetchGuard();

const sql = createSql();
const provider = applyLifecycleTestProvider(
  createMonitorProvider(providerKind, process.env, { sql }),
  process.env,
);
const config = readCollectorConfig(process.env);
const instance = config.instanceId;
const envName = process.env.NODE_ENV ?? 'development';
const destination = (line: string) => {
  process.stdout.write(line);
};

function writeDiagnostic(record: ShutdownDiagnostic) {
  destination(
    `${JSON.stringify({
      level: record.level,
      time: new Date().toISOString(),
      service: 'collector',
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

const sink = applyLifecycleTestSink(
  createPgLogSink(sql, { destination, service: 'collector', instance, envName }),
  process.env,
);
const logger = createLogger({
  service: 'collector',
  instance,
  envName,
  destination,
  sink,
});
await waitForReady(() => collectorSchemaReady(sql), { attempts: 30, delayMs: 2_000 });
const stopRetention = startAppLogRetention(sql, {
  onError: (message) => {
    logger.error('日志清理失败', { event: 'log.retention_failed', context: { error: message } });
  },
});
const abort = new AbortController();
let loopPromise: Promise<void> = Promise.resolve();

const shutdown = createShutdownController({
  budgets: readShutdownBudgets(process.env),
  writeDiagnostic,
  hooks: {
    stopAccepting() {
      abort.abort();
    },
    finishCurrent(timeoutMs) {
      return raceLoop(loopPromise, timeoutMs);
    },
    recordStopped() {
      logger.info('采集器停止', { event: 'service.stopped' });
    },
    flush(timeoutMs) {
      return logger.flushWithin(timeoutMs);
    },
    stopRetention() {
      stopRetention();
    },
    closeResources(timeoutMs) {
      return closeSqlWithin(sql, timeoutMs);
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
    context: { provider: providerKind },
  });
}

logger.info('采集器启动', { event: 'service.started' });
try {
  loopPromise = runCollectorLoop({
    sql,
    provider,
    config,
    signal: abort.signal,
    log: (line) => {
      logger.info(line, { event: 'collector.line' });
    },
    logger,
  });
  await loopPromise;
} finally {
  await shutdown.join('collector-loop-ended');
}

function raceLoop(loop: Promise<void>, timeoutMs: number): Promise<'finished' | 'timed_out'> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: 'finished' | 'timed_out') => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => finish('timed_out'), timeoutMs);
    loop.then(
      () => finish('finished'),
      () => finish('finished'),
    );
  });
}
