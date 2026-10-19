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

export function assetEtag(contentSha256: string): string {
  return `"${contentSha256}"`;
}

export function assetEtagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((part) => part.trim())
    .some((part) => part === etag || part === `W/${etag}`);
}

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const PLACEHOLDER_CACHE = 'public, max-age=60';

function placeholder(status: 'placeholder' | 'missing-root' | 'missing-file') {
  return new Response(PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': PLACEHOLDER_CACHE,
      'Content-Length': String(Buffer.byteLength(PLACEHOLDER_SVG)),
      'X-Asset-Status': status,
    },
  });
}

export function createAssetsRoutes(db: Sql) {
  const app = new Hono();

  app.get('/:assetId', async (c) => {
    const assetId = c.req.param('assetId');
    const rows = await db<
      {
        asset_id: string;
        relative_path: string;
        mime_type: string | null;
        content_sha256: string;
      }[]
    >`
      SELECT asset_id, relative_path, mime_type, content_sha256
      FROM static_assets
      WHERE asset_id = ${assetId}
    `;
    const row = rows[0];

    if (!row) return placeholder('placeholder');

    const root = readAssetsRoot();
    if (!root) return placeholder('missing-root');

    const abs = safeJoinRoot(root, row.relative_path);
    if (!abs || !existsSync(abs)) return placeholder('missing-file');

    const bytes = readFileSync(abs);
    const etag = assetEtag(row.content_sha256);
    if (assetEtagMatches(c.req.header('if-none-match'), etag)) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: etag,
          'Cache-Control': IMMUTABLE_CACHE,
          'X-Asset-Status': 'ok',
        },
      });
    }
    const mime = row.mime_type ?? 'application/octet-stream';
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Cache-Control': IMMUTABLE_CACHE,
        ETag: etag,
        'Content-Length': String(bytes.byteLength),
        'X-Asset-Status': 'ok',
      },
    });
  });

  return app;
}
