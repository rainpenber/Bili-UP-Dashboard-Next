import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMonitorProvider, deterministicUnit, truncateToUtcMinute } from './offline-provider';
import { assertNoBilibiliNetwork, installOfflineFetchGuard } from './network-guard';
import { backoffDelayMs } from './collector-runner';

describe('offline provider', () => {
  test('same minute yields the same sample and does not call the network', async () => {
    const root = mkdtempSync(join(tmpdir(), 'offline-provider-'));
    mkdirSync(join(root, 'backend'));
    const provider = createMonitorProvider('offline', {
      MOCK_DATA_ROOT: root,
      SOURCE_TIMEZONE: 'Asia/Shanghai',
    });
    const minute = truncateToUtcMinute(new Date('2026-10-19T12:00:30.000Z'));
    const first = await provider.collectVideo('BV1xx411c7mD', minute);
    const second = await provider.collectVideo('BV1xx411c7mD', new Date(minute.getTime() + 15_000));
    expect(second.viewCount).toBe(first.viewCount);
    expect(second.sampledAt.toISOString()).toBe(first.sampledAt.toISOString());
    expect(first.rawTime).toBe('2026-10-19 20:00');
    expect(deterministicUnit('same')).toBe(deterministicUnit('same'));
  });

  test('missing fixture root fails closed', async () => {
    const provider = createMonitorProvider('offline', {
      MOCK_DATA_ROOT: '/tmp/studio-missing-offline-fixture',
    });
    await expect(provider.collectCreator('12345', new Date())).rejects.toThrow(
      /离线夹具目录不可用/,
    );
  });

  test('required fixture missing fails closed', async () => {
    const root = mkdtempSync(join(tmpdir(), 'offline-required-'));
    mkdirSync(join(root, 'backend'));
    const provider = createMonitorProvider('offline', {
      MOCK_DATA_ROOT: root,
      OFFLINE_REQUIRE_FIXTURE: '1',
    });
    await expect(provider.collectVideo('BV1xx411c7mD', new Date())).rejects.toThrow(/离线夹具缺失/);
  });

  test('unimplemented upstream provider fails closed', () => {
    expect(() => createMonitorProvider('bilibili')).toThrow(/fail closed/);
  });
});

describe('offline network guard', () => {
  test('any bilibili.com or bilibili.tv request fails the test', async () => {
    installOfflineFetchGuard();
    await expect(fetch('https://api.bilibili.com/x/web-interface/view')).rejects.toThrow(
      /Blocked network/,
    );
    await expect(fetch('https://www.bilibili.tv/en')).rejects.toThrow(/Blocked network/);
    expect(() => assertNoBilibiliNetwork('https://api.bilibili.com/x')).toThrow(/Blocked network/);
  });
});

describe('collector backoff', () => {
  test('doubles until the cap', () => {
    expect(backoffDelayMs(1, 1000, 5000)).toBe(1000);
    expect(backoffDelayMs(2, 1000, 5000)).toBe(2000);
    expect(backoffDelayMs(3, 1000, 5000)).toBe(4000);
    expect(backoffDelayMs(6, 1000, 5000)).toBe(5000);
  });
});
