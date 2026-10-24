export type MonitorDataSource = 'mock' | 'collector';

export function readMonitorDataSource(env: NodeJS.ProcessEnv = process.env): MonitorDataSource {
  const raw = env.MONITOR_DATA_SOURCE ?? 'mock';
  if (raw === 'mock' || raw === 'collector') return raw;
  throw new Error(
    `Invalid MONITOR_DATA_SOURCE=${raw}. Expected mock or collector. collector uses the offline provider and does not open Bilibili.`,
  );
}

export function assertNoBilibiliNetwork(url: string): void {
  if (/bilibili\.com/i.test(url) || /bilibili\.tv/i.test(url)) {
    throw new Error(`Blocked network access to Bilibili: ${url}`);
  }
}
