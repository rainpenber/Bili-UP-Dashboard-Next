import { collectorSchemaReady, createSql } from '@studio/db';
import {
  assertProviderCanStart,
  createMonitorProvider,
  installOfflineFetchGuard,
  readCollectorConfig,
  readCollectorProviderKind,
  runCollectorLoop,
} from '@studio/monitoring';
import { createLogger, startAppLogRetention } from '@studio/observability';
import { waitForReady } from './wait-for-schema';

const source = process.env.MONITOR_DATA_SOURCE ?? 'collector';
if (source !== 'mock' && source !== 'collector') {
  throw new Error(`Invalid MONITOR_DATA_SOURCE=${source}. collector 只接受 mock 或 collector。`);
}

const providerKind = readCollectorProviderKind(process.env);
assertProviderCanStart(providerKind, process.env);
if (providerKind === 'offline') installOfflineFetchGuard();

const sql = createSql();
const provider = createMonitorProvider(providerKind, process.env, { sql });
const config = readCollectorConfig(process.env);
const logger = createLogger({
  service: 'collector',
  instance: config.instanceId,
  sql,
});
await waitForReady(() => collectorSchemaReady(sql), { attempts: 30, delayMs: 2_000 });
const stopRetention = startAppLogRetention(sql, {
  onError: (message) => {
    logger.error('日志清理失败', { event: 'log.retention_failed', context: { error: message } });
  },
});
const abort = new AbortController();

const stop = () => {
  logger.info('收到终止信号', { event: 'service.stopping' });
  abort.abort();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

try {
  logger.info('采集器启动', { event: 'service.started' });
  await runCollectorLoop({
    sql,
    provider,
    config,
    signal: abort.signal,
    log: (line) => {
      logger.info(line, { event: 'collector.line' });
    },
    logger,
  });
} finally {
  logger.info('采集器停止', { event: 'service.stopped' });
  await logger.flush();
  stopRetention();
  await sql.end({ timeout: 5 });
}
