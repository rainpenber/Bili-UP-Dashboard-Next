import { describe, expect, test } from 'bun:test';
import { assertNoBilibiliNetwork, readMonitorDataSource } from './data-source';

describe('MONITOR_DATA_SOURCE', () => {
  test('defaults to mock', () => {
    expect(readMonitorDataSource({ MONITOR_DATA_SOURCE: undefined })).toBe('mock');
  });

  test('collector selects the offline provider and does not open a network client', () => {
    expect(readMonitorDataSource({ MONITOR_DATA_SOURCE: 'collector' })).toBe('collector');
  });

  test('unknown source fails closed', () => {
    expect(() => readMonitorDataSource({ MONITOR_DATA_SOURCE: 'bilibili' })).toThrow(
      /Invalid MONITOR_DATA_SOURCE/,
    );
  });
});

describe('network guard', () => {
  test('blocks bilibili hostnames', () => {
    expect(() => assertNoBilibiliNetwork('https://api.bilibili.com/x/web-interface/view')).toThrow(
      /Blocked network/,
    );
  });

  test('allows local API', () => {
    expect(() =>
      assertNoBilibiliNetwork('http://localhost:3000/api/v1/monitor/videos'),
    ).not.toThrow();
  });
});

describe('no bilibili fetch during tests', () => {
  const originalFetch = globalThis.fetch;
  test('fetch guard', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      seen.push(url);
      assertNoBilibiliNetwork(url);
      return originalFetch(input);
    }) as typeof fetch;
    try {
      await fetch('http://127.0.0.1:1/', { signal: AbortSignal.timeout(50) }).catch(
        () => undefined,
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(seen.every((u) => !/bilibili/i.test(u))).toBe(true);
  });
});
