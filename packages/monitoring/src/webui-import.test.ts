import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase, type Sql } from '@studio/db';
import { createLogger } from '@studio/observability';
import { installOfflineFetchGuard } from './network-guard';
import { importWebuiDirectory } from './webui-import';

installOfflineFetchGuard();

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'webui-meta-'));
  mkdirSync(join(root, 'videos'));
  mkdirSync(join(root, 'creators'));
  const videos = [
    { bvid: 'BV1xx411c7mD', title: '本地一', catagory: '狐正正', views: 11 },
    { bvid: 'BV1xx411c7mE', title: '本地二', catagory: '抽奖观测', views: 22 },
    { bvid: 'BV1xx411c7mF', title: '本地三', catagory: '事件观测', views: 33 },
  ];
  writeFileSync(join(root, 'videos.json'), `\uFEFF${JSON.stringify(videos)}`);
  writeFileSync(
    join(root, 'creators.json'),
    JSON.stringify([
      { mid: '100', name: '甲', followers: 9, lastUpdate: '2026-01-01', catagory: '长期观测' },
      { mid: 200, name: '乙', catagory: '事件观测' },
    ]),
  );
  writeFileSync(join(root, 'videos', 'BV1xx411c7mD_cover.png'), PNG);
  writeFileSync(join(root, 'videos', 'BV1xx411c7mE_cover.png'), PNG);
  writeFileSync(join(root, 'creators', '100_avatar.png'), PNG);
  return root;
}

describe('webui metadata import', () => {
  const created: string[] = [];

  afterAll(async () => {
    for (const name of created) await dropIsolatedTestDatabase(name).catch(() => undefined);
  });

  test('stores partial rows, dedupes bytes, and does not replace a bilibili title', async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    const sql: Sql = isolated.sql;
    try {
      const migration = readFileSync(
        new URL('../../db/migrations/008_webui_rate_state.sql', import.meta.url),
        'utf8',
      );
      await sql.unsafe(migration);
      await sql.unsafe(migration);

      const root = fixtureRoot();
      const assetsRoot = mkdtempSync(join(tmpdir(), 'webui-assets-'));
      await sql`
        INSERT INTO videos (bvid, title, metadata_source, metadata_state, cover_state)
        VALUES ('BV1xx411c7mD', '接口标题', 'bilibili', 'ok', 'ok')
      `;
      const dry = await importWebuiDirectory({ root, dryRun: true, sql, assetsRoot });
      expect(dry).toMatchObject({ dryRun: true, videos: 3, creators: 2, images: 3, batchId: null });
      const dryRows = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM videos`;
      expect(dryRows[0]?.n).toBe(1);

      const logger = createLogger({ service: 'collector', sql, instance: 'webui-test' });
      const applied = await importWebuiDirectory({ root, sql, assetsRoot, logger });
      expect(applied.dryRun).toBe(false);
      expect(applied.batchId).toBeTruthy();

      const videos = await sql<
        {
          bvid: string;
          title: string | null;
          category: string | null;
          metadata_state: string;
          metadata_source: string | null;
          cover_state: string;
          cover_asset_id: string | null;
          cid: string | null;
          pubdate: Date | null;
          views: string | null;
        }[]
      >`
        SELECT bvid, title, category, metadata_state, metadata_source, cover_state, cover_asset_id,
          cid::text AS cid, pubdate, metadata->'webui'->>'views' AS views
        FROM videos ORDER BY bvid
      `;
      const kept = videos.find((row) => row.bvid === 'BV1xx411c7mD');
      const second = videos.find((row) => row.bvid === 'BV1xx411c7mE');
      const missing = videos.find((row) => row.bvid === 'BV1xx411c7mF');
      expect(kept?.title).toBe('接口标题');
      expect(kept?.metadata_source).toBe('bilibili');
      expect(kept?.metadata_state).toBe('ok');
      expect(second).toMatchObject({
        title: '本地二',
        category: '抽奖观测',
        metadata_state: 'partial',
        metadata_source: 'webui',
        cover_state: 'ok',
        cid: null,
        pubdate: null,
        views: '22',
      });
      expect(second?.cover_asset_id).toBeTruthy();
      expect(missing).toMatchObject({
        title: '本地三',
        metadata_state: 'partial',
        cover_state: 'failed',
        cover_asset_id: null,
      });

      const creators = await sql<
        {
          mid: string;
          uname: string | null;
          face_url: string | null;
          category: string | null;
          metadata_state: string;
          face_asset_id: string | null;
          followers: string | null;
        }[]
      >`
        SELECT mid::text AS mid, uname, face_url, category, metadata_state, face_asset_id,
          metadata->'webui'->>'followers' AS followers
        FROM creators ORDER BY mid
      `;
      expect(creators[0]).toMatchObject({
        mid: '100',
        uname: '甲',
        face_url: null,
        category: '长期观测',
        metadata_state: 'partial',
        followers: '9',
      });
      expect(creators[0]?.face_asset_id).toBeTruthy();
      expect(creators[1]).toMatchObject({
        mid: '200',
        uname: '乙',
        face_url: null,
        face_asset_id: null,
        metadata_state: 'partial',
      });

      const tags = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM video_tags`;
      expect(tags[0]?.n).toBe(0);
      const assets = await sql<
        { n: number; origin: string; source_url: string | null; width: number; height: number }[]
      >`
        SELECT count(*)::int AS n, min(origin) AS origin, min(source_url) AS source_url,
          min(width) AS width, min(height) AS height
        FROM static_assets
      `;
      expect(assets[0]).toMatchObject({
        n: 1,
        origin: 'webui',
        source_url: null,
        width: 1,
        height: 1,
      });

      const events = await sql<{ event: string }[]>`
        SELECT event FROM app_logs WHERE event LIKE 'import.webui.%' ORDER BY event
      `;
      expect(events.map((row) => row.event)).toEqual([
        'import.webui.finished',
        'import.webui.started',
      ]);

      await importWebuiDirectory({ root, sql, assetsRoot, logger });
      const after = await sql<{ videos: number; assets: number }[]>`
        SELECT
          (SELECT count(*)::int FROM videos) AS videos,
          (SELECT count(*)::int FROM static_assets) AS assets
      `;
      expect(after[0]).toEqual({ videos: 3, assets: 1 });
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
