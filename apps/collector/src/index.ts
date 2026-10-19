import { collectorSchemaReady, createSql } from '@studio/db';
import {
  assertProviderCanStart,
  createMonitorProvider,
  installOfflineFetchGuard,
  readCollectorConfig,
  readCollectorProviderKind,
  runCollectorLoop,
} from '@studio/monitoring';
import { waitForReady } from './wait-for-schema';

const source = process.env.MONITOR_DATA_SOURCE ?? 'collector';
if (source !== 'mock' && source !== 'collector') {
  throw new Error(`Invalid MONITOR_DATA_SOURCE=${source}. collector 只接受 mock 或 collector。`);
}

const providerKind = readCollectorProviderKind(process.env);
assertProviderCanStart(providerKind, process.env);
if (providerKind === 'offline') installOfflineFetchGuard();

const provider = createMonitorProvider(providerKind, process.env);
const config = readCollectorConfig(process.env);
const sql = createSql();
await waitForReady(() => collectorSchemaReady(sql), { attempts: 30, delayMs: 2_000 });
const abort = new AbortController();

const stop = () => {
  console.log('[collector] 收到终止信号，完成当前任务后退出');
  abort.abort();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

try {
  await runCollectorLoop({
    sql,
    provider,
    config,
    signal: abort.signal,
    log: (line) => console.log(line),
  });
} finally {
  await sql.end({ timeout: 5 });
}
