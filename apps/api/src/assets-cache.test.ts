import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import type { Sql } from '@studio/db';
import { assetEtag, assetEtagMatches, createAssetsRoutes } from './assets-routes';
import { Hono } from 'hono';

describe('asset cache headers', () => {
  test('serves immutable bytes with an etag and answers 304', async () => {
    const root = mkdtempSync(join(tmpdir(), 'asset-cache-'));
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'cover.bin'), 'image-bytes');
    const previous = process.env.MONITOR_ASSETS_ROOT;
    process.env.MONITOR_ASSETS_ROOT = root;
    const sha = 'a'.repeat(64);
    const sql = (async () => [
      {
        asset_id: 'asset-1',
        relative_path: 'cover.bin',
        mime_type: 'image/jpeg',
        content_sha256: sha,
      },
    ]) as unknown as Sql;
    const app = new Hono();
    app.route('/api/v1/assets', createAssetsRoutes(sql));
    try {
      const etag = assetEtag(sha);
      expect(assetEtagMatches(`${etag}, W/"other"`, etag)).toBe(true);
      const first = await app.request('/api/v1/assets/asset-1');
      expect(first.status).toBe(200);
      expect(first.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(first.headers.get('etag')).toBe(etag);
      expect(first.headers.get('content-length')).toBe(String(Buffer.byteLength('image-bytes')));
      expect(first.headers.get('x-asset-status')).toBe('ok');
      const second = await app.request('/api/v1/assets/asset-1', {
        headers: { 'if-none-match': etag },
      });
      expect(second.status).toBe(304);
      expect(second.headers.get('etag')).toBe(etag);
      expect(await second.text()).toBe('');
    } finally {
      if (previous === undefined) delete process.env.MONITOR_ASSETS_ROOT;
      else process.env.MONITOR_ASSETS_ROOT = previous;
    }
  });
});
