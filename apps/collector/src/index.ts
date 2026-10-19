import { createSql, runMigrations } from '@studio/db';
import {
  createMonitorProvider,
  installOfflineFetchGuard,
  readCollectorConfig,
  runCollectorLoop,
} from '@studio/monitoring';

installOfflineFetchGuard();

const source = process.env.MONITOR_DATA_SOURCE ?? 'collector';
if (source !== 'mock' && source !== 'collector') {
  throw new Error(
    `Invalid MONITOR_DATA_SOURCE=${source}. collector 只运行离线适配器，不会访问 Bilibili。`,
  );
}

const providerKind = process.env.MONITOR_PROVIDER ?? 'offline';
const provider = createMonitorProvider(providerKind, process.env);
const config = readCollectorConfig(process.env);
const sql = createSql();
await runMigrations(sql);
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
