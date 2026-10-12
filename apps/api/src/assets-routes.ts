import { readFileSync, existsSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { Sql } from '@studio/db';
import { Hono } from 'hono';
import { PLACEHOLDER_SVG } from './asset-placeholder';
import { readAssetsRoot } from './assets-config';

function safeJoinRoot(root: string, relativePath: string): string | null {
  const normalizedRoot = normalize(root);
  const target = normalize(join(root, relativePath));
  if (!target.startsWith(normalizedRoot)) return null;
  return target;
}

export function createAssetsRoutes(db: Sql) {
  const app = new Hono();

  app.get('/:assetId', async (c) => {
    const assetId = c.req.param('assetId');
    const rows = await db`
      SELECT asset_id, relative_path, mime_type FROM static_assets WHERE asset_id = ${assetId}
    `;
    const row = rows[0] as
      { asset_id: string; relative_path: string; mime_type: string | null } | undefined;

    if (!row) {
      return c.body(PLACEHOLDER_SVG, 200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=60',
        'X-Asset-Status': 'placeholder',
      });
    }

    const root = readAssetsRoot();
    if (!root) {
      return c.body(PLACEHOLDER_SVG, 200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=60',
        'X-Asset-Status': 'missing-root',
      });
    }

    const abs = safeJoinRoot(root, row.relative_path);
    if (!abs || !existsSync(abs)) {
      return c.body(PLACEHOLDER_SVG, 200, {
        'Content-Type': 'image/svg+xml',
        'Cache-Control': 'public, max-age=60',
        'X-Asset-Status': 'missing-file',
      });
    }

    const bytes = readFileSync(abs);
    const mime = row.mime_type ?? 'application/octet-stream';
    return c.body(bytes, 200, {
      'Content-Type': mime,
      'Cache-Control': 'public, max-age=3600',
      'X-Asset-Status': 'ok',
    });
  });

  return app;
}
