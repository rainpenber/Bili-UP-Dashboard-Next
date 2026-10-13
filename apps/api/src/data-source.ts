export type MonitorDataSource = 'mock' | 'collector';

export function readMonitorDataSource(env: NodeJS.ProcessEnv = process.env): MonitorDataSource {
  const raw = env.MONITOR_DATA_SOURCE ?? 'mock';
  if (raw === 'mock') return 'mock';
  if (raw === 'collector') {
    throw new Error(
      'MONITOR_DATA_SOURCE=collector is not implemented in WP-001. Use mock for offline historical data.',
    );
  }
  throw new Error(`Invalid MONITOR_DATA_SOURCE=${raw}. Expected mock or collector.`);
}

export function assertNoBilibiliNetwork(url: string): void {
  if (/bilibili\.com/i.test(url) || /bilibili\.tv/i.test(url)) {
    throw new Error(`Blocked network access to Bilibili: ${url}`);
  }
}
