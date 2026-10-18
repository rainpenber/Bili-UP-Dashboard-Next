import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSql, runMigrations } from '@studio/db';
import { runImport } from '@studio/monitoring';
import { createApp } from './app';

const pgAvailable = Boolean(process.env.CI || process.env.POSTGRES_PASSWORD);

describe('monitor API integration', () => {
  const sql = pgAvailable ? createSql() : null;
  let app: ReturnType<typeof createApp>;

  beforeAll(async () => {
    if (!sql) return;
    await runMigrations(sql);
    await sql`TRUNCATE source_metric_rows, import_conflicts_or_rejects, source_file_provenance, source_files, applied_canonical_sources, applied_source_provenance, applied_source_files, creator_follower_samples, video_metric_samples, dynamic_metric_samples, static_assets, creators, videos, dynamics, import_batches RESTART IDENTITY CASCADE`;
    const fixtureBackend = join(import.meta.dir, '../../../packages/monitoring/fixtures/backend');
    const fixtureFrontend = join(import.meta.dir, '../../../packages/monitoring/fixtures/frontend');
    const assetsRoot = join(fixtureFrontend, 'meta');
    process.env.MONITOR_ASSETS_ROOT = assetsRoot;
    await runImport({
      mode: 'apply',
      backendRoot: fixtureBackend,
      frontendRoot: fixtureFrontend,
      assetsRoot,
      sourceTimezone: 'Asia/Shanghai',
      sql,
    });
    app = createApp({ skipDb: true });
    // mount routes manually with shared sql
    const { createMonitorRoutes } = await import('./monitor-routes');
    const { createAssetsRoutes } = await import('./assets-routes');
    app.route('/api/v1/monitor', createMonitorRoutes(sql));
    app.route('/api/v1/assets', createAssetsRoutes(sql));
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('lists videos with pagination', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/monitor/videos?page=1&pageSize=8');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pageSize).toBe(8);
    expect(body.items.length).toBeGreaterThan(0);
    expect(typeof body.items[0].latestMetrics.viewCount).toBe('string');
  });

  test('metrics limit cap returns 400 when invalid', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/monitor/videos/BVTEST001/metrics?limit=not-a-number');
    expect(res.status).toBe(400);
  });

  test('video metrics expose nullable commentCount', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/monitor/videos/BVTEST001/metrics?limit=10');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items[0]).toHaveProperty('commentCount');
    expect(body.items[0].commentCount).toBeNull();
  });

  test('dynamic detail 404 for unknown id', async () => {
    if (!sql) return;
    const res = await app.request('/api/v1/monitor/dynamics/__missing__');
    expect(res.status).toBe(404);
  });

  test('metrics limit keeps the newest samples in chronological order', async () => {
    if (!sql || !app) return;
    const db = sql;
    const bvid = 'BVLIMITWIN01';
    const rows: { sampledAt: string; viewCount: number; onlineViewers: number }[] = [
      { sampledAt: '2024-01-01T00:00:00.000Z', viewCount: 1, onlineViewers: 10 },
      { sampledAt: '2024-06-01T00:00:00.000Z', viewCount: 2, onlineViewers: 9 },
      { sampledAt: '2025-01-01T00:00:00.000Z', viewCount: 3, onlineViewers: 8 },
      { sampledAt: '2025-05-17T09:52:00.000Z', viewCount: 40889, onlineViewers: 4 },
      { sampledAt: '2026-10-12T11:09:00.000Z', viewCount: 55300, onlineViewers: 1 },
    ];
    try {
      await db`
        INSERT INTO videos (bvid, title)
        VALUES (${bvid}, 'limit window')
      `;
      for (const row of rows) {
        await db`
          INSERT INTO video_metric_samples (
            bvid, sampled_at, source_timezone, raw_time, timestamp_precision, view_count, online_viewers
          ) VALUES (
            ${bvid}, ${row.sampledAt}, 'Asia/Shanghai', ${row.sampledAt}, 'minute', ${row.viewCount}, ${row.onlineViewers}
          )
        `;
      }

      const limit = 2;
      const res = await app.request(`/api/v1/monitor/videos/${bvid}/metrics?limit=${limit}`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        limit: number;
        items: { sampledAt: string; viewCount: string | null; onlineViewers: string | null }[];
      };
      expect(body.limit).toBe(limit);
      expect(body.items).toHaveLength(limit);
      expect(body.items.map((item) => item.sampledAt)).toEqual([
        '2025-05-17T09:52:00.000Z',
        '2026-10-12T11:09:00.000Z',
      ]);
      const times = body.items.map((item) => Date.parse(item.sampledAt));
      expect(times[0]).toBeLessThan(times[1]!);

      const [dbLatest] = await db<
        { sampled_at: Date; view_count: bigint; online_viewers: bigint }[]
      >`
        SELECT sampled_at, view_count, online_viewers
        FROM video_metric_samples
        WHERE bvid = ${bvid}
        ORDER BY sampled_at DESC
        LIMIT 1
      `;
      const newest = body.items.at(-1);
      expect(newest?.sampledAt).toBe(dbLatest?.sampled_at.toISOString());
      expect(newest?.viewCount).toBe(dbLatest?.view_count.toString());
      expect(newest?.onlineViewers).toBe(dbLatest?.online_viewers.toString());
      expect(newest?.viewCount).toBe('55300');
      expect(newest?.onlineViewers).toBe('1');

      const bounded = await app.request(
        `/api/v1/monitor/videos/${bvid}/metrics?limit=${limit}&to=2025-06-01T00:00:00.000Z`,
      );
      const boundedBody = (await bounded.json()) as {
        items: { sampledAt: string; viewCount: string | null }[];
      };
      expect(boundedBody.items).toHaveLength(limit);
      expect(boundedBody.items.at(-1)?.sampledAt).toBe('2025-05-17T09:52:00.000Z');
      expect(boundedBody.items.at(-1)?.viewCount).toBe('40889');
      expect(boundedBody.items.some((item) => item.sampledAt.startsWith('2026-'))).toBe(false);
    } finally {
      await db`DELETE FROM video_metric_samples WHERE bvid = ${bvid}`;
      await db`DELETE FROM videos WHERE bvid = ${bvid}`;
    }
  });

  test('serves registered cover asset or placeholder', async () => {
    if (!sql) return;
    const list = await app.request('/api/v1/monitor/videos?page=1');
    const body = await list.json();
    const coverId = body.items[0]?.coverAssetId as string | null;
    const assetRes = await app.request(
      `/api/v1/assets/${encodeURIComponent(coverId ?? '__missing__')}`,
    );
    expect(assetRes.status).toBe(200);
    expect(assetRes.headers.get('X-Asset-Status')).toMatch(/ok|placeholder|missing-file/);
  });
});
