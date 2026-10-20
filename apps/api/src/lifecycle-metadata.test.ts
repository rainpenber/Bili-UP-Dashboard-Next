import { describe, expect, test } from 'bun:test';
import {
  lifecycleMetadataOverrides,
  offlineAssetDownload,
  offlineMetadataTransport,
  readLifecycleHoldMs,
} from './lifecycle-metadata';

describe('lifecycle metadata fixture', () => {
  test('offline transport and downloader do not call fetch', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      calls += 1;
      return original(...args);
    }) as typeof fetch;
    try {
      const transport = offlineMetadataTransport();
      const response = await transport({
        url: 'https://api.bilibili.com/x/web-interface/view/detail?bvid=BV1aptest411',
        method: 'GET',
        headers: {},
      });
      expect(response.body).toContain('BV1aptest411');
      expect(response.body).toContain('接口标题');
      const image = await offlineAssetDownload()({
        url: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
        headers: {},
      });
      expect(image.status).toBe(200);
      expect(image.body.byteLength).toBeGreaterThan(8);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = original;
    }
  });

  test('production env does not install the fixture or the hold', () => {
    expect(lifecycleMetadataOverrides({})).toEqual({});
    expect(
      lifecycleMetadataOverrides({
        API_LIFECYCLE_BACKFILL: 'hang',
        API_LIFECYCLE_HTTP_HOLD_MS: '600',
      }),
    ).toEqual({});
    expect(readLifecycleHoldMs({ API_LIFECYCLE_HTTP_HOLD_MS: '600' })).toBe(0);
  });

  test('bad lifecycle numbers fail closed', () => {
    expect(() =>
      readLifecycleHoldMs({ LOG_LIFECYCLE_TEST: '1', API_LIFECYCLE_HTTP_HOLD_MS: '0.5' }),
    ).toThrow('API_LIFECYCLE_HTTP_HOLD_MS');
    expect(() =>
      lifecycleMetadataOverrides({
        LOG_LIFECYCLE_TEST: '1',
        API_LIFECYCLE_BACKFILL_DELAY_MS: '-1',
      }),
    ).toThrow('API_LIFECYCLE_BACKFILL_DELAY_MS');
  });
});
