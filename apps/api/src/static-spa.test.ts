import { describe, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from './app';

describe('WEB_STATIC_ROOT SPA serving', () => {
  test('serves index.html for non-API GET routes when static root is set', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title>', 'utf8');

    const prev = process.env.WEB_STATIC_ROOT;
    process.env.WEB_STATIC_ROOT = dir;
    try {
      const app = createApp({ skipDb: true });
      const res = await app.request('http://localhost/monitoring');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('spa');
    } finally {
      if (prev === undefined) delete process.env.WEB_STATIC_ROOT;
      else process.env.WEB_STATIC_ROOT = prev;
    }
  });

  test('SPA shell is never cached and hashed assets are immutable', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'web-dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>spa</title>', 'utf8');

    const prev = process.env.WEB_STATIC_ROOT;
    process.env.WEB_STATIC_ROOT = dir;
    try {
      const app = createApp({ skipDb: true });
      const shell = await app.request('http://localhost/monitoring/creators/1');
      expect(shell.headers.get('cache-control')).toContain('no-store');
    } finally {
      if (prev === undefined) delete process.env.WEB_STATIC_ROOT;
      else process.env.WEB_STATIC_ROOT = prev;
    }
  });

  test('API routes are not replaced by SPA fallback', async () => {
    const app = createApp({ skipDb: true });
    const res = await app.request('http://localhost/api/health');
    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('ok');
  });
});
