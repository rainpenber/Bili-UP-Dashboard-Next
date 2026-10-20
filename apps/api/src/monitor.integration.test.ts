import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSql, runMigrations, type Sql } from '@studio/db';
import { runImport } from '@studio/monitoring';
import { Hono } from 'hono';
import { createApp } from './app';
import { createMonitorRoutes } from './monitor-routes';

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

  describe('creator and video crosslink', () => {
    const ownerMid = '9000000000000101';
    const quietMid = '9000000000000102';
    const sortMid = '9000000000000201';
    const pageMid = '9000000000000202';
    const emptyMid = '9000000000000203';
    const followerSampledAt = '2026-10-19T18:59:59.000Z';
    const newerVideoSampledAt = '2026-08-02T00:00:00.000Z';
    const stats = { queries: 0 };
    let crosslink: Hono;

    function countingDb(base: Sql): Sql {
      const wrapped = ((...args: unknown[]) => {
        stats.queries += 1;
        return (base as unknown as (...inner: unknown[]) => unknown)(...args);
      }) as Sql;
      wrapped.unsafe = base.unsafe.bind(base);
      return wrapped;
    }

    beforeAll(async () => {
      if (!sql) return;
      const db = sql;
      crosslink = new Hono();
      crosslink.route('/api/v1/monitor', createMonitorRoutes(countingDb(db)));

      await db`
        INSERT INTO creators (mid, uname, face_asset_id, monitoring_enabled)
        VALUES
          (${ownerMid}, '狐正正', 'a_face_xlink', true),
          (${quietMid}, '无粉丝', NULL, false),
          (${sortMid}, '排序作者', NULL, true),
          (${pageMid}, '分页作者', NULL, true),
          (${emptyMid}, '空视频', NULL, true)
      `;
      await db`
        INSERT INTO videos (bvid, title, mid, cover_asset_id, partition_name, pubdate, archived_at, deleted_at)
        VALUES
          ('BVCLOWN001', '有作者', ${ownerMid}, 'a_cover_owner', '影视', '2026-08-01T00:00:00.000Z', NULL, NULL),
          ('BVCLQUIET1', '无粉丝样本', ${quietMid}, NULL, NULL, NULL, NULL, NULL),
          ('BVCLNULL01', '未关联作者', NULL, NULL, NULL, NULL, NULL, NULL),
          ('BVCLORD002', '最新发布', ${sortMid}, 'a_cover_x', '影视', '2026-08-01T00:00:00.000Z', NULL, NULL),
          ('BVCLORD000', '同日较早序号', ${sortMid}, NULL, NULL, '2026-05-01T00:00:00.000Z', NULL, NULL),
          ('BVCLORD001', '同日已归档', ${sortMid}, NULL, NULL, '2026-05-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z', NULL),
          ('BVCLORD003', '更早无样本', ${sortMid}, NULL, NULL, '2026-01-01T00:00:00.000Z', NULL, NULL),
          ('BVCLORDNUL', '无发布日', ${sortMid}, NULL, NULL, NULL, NULL, NULL),
          ('BVCLORDDEL', '已软删除', ${sortMid}, NULL, NULL, '2026-12-01T00:00:00.000Z', NULL, '2026-12-02T00:00:00.000Z')
      `;
      for (let i = 0; i <= 100; i += 1) {
        const bvid = `BVCLP${String(i).padStart(4, '0')}`;
        const pubdate = new Date(Date.UTC(2026, 0, 1 + i)).toISOString();
        await db`
          INSERT INTO videos (bvid, title, mid, pubdate)
          VALUES (${bvid}, ${`分页 ${i}`}, ${pageMid}, ${pubdate})
        `;
      }
      await db`
        INSERT INTO videos (bvid, title, mid, pubdate, deleted_at)
        VALUES ('BVCLPDEL0', '分页里的软删除', ${pageMid}, '2026-12-01T00:00:00.000Z', '2026-12-02T00:00:00.000Z')
      `;
      await db`
        INSERT INTO creator_follower_samples (
          mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count
        ) VALUES
          (${ownerMid}, '2026-10-01T00:00:00.000Z', 'Asia/Shanghai', '2026-10-01 08:00', 'minute', 100),
          (${ownerMid}, ${followerSampledAt}, 'Asia/Shanghai', '2026-10-19 18:59', 'second', 51733)
      `;
      await db`
        INSERT INTO video_metric_samples (
          bvid, sampled_at, source_timezone, raw_time, timestamp_precision,
          view_count, like_count, comment_count, online_viewers
        ) VALUES
          ('BVCLORD002', '2026-08-01T00:00:00.000Z', 'Asia/Shanghai', '2026-08-01 08:00', 'minute', 10, 1, 0, 9),
          ('BVCLORD002', ${newerVideoSampledAt}, 'Asia/Shanghai', '2026-08-02 08:00', 'minute', 623, 34, 8, 1)
      `;
    });

    afterAll(async () => {
      if (!sql) return;
      const db = sql;
      await db`DELETE FROM video_metric_samples WHERE bvid LIKE 'BVCL%'`;
      await db`DELETE FROM videos WHERE bvid LIKE 'BVCL%'`;
      await db`
        DELETE FROM creator_follower_samples
        WHERE mid IN (${ownerMid}, ${quietMid}, ${sortMid}, ${pageMid}, ${emptyMid})
      `;
      await db`
        DELETE FROM creators
        WHERE mid IN (${ownerMid}, ${quietMid}, ${sortMid}, ${pageMid}, ${emptyMid})
      `;
    });

    test('video detail embeds the creator and the newest follower sample in one query', async () => {
      if (!sql) return;
      stats.queries = 0;
      const res = await crosslink.request('/api/v1/monitor/videos/BVCLOWN001');
      expect(res.status).toBe(200);
      expect(stats.queries).toBe(1);
      const body = await res.json();
      expect(body.creator).toEqual({
        mid: ownerMid,
        uname: '狐正正',
        faceAssetId: 'a_face_xlink',
        followerLatest: '51733',
        followerSampledAt,
        monitoringEnabled: true,
      });
      expect(typeof body.creator.followerLatest).toBe('string');
    });

    test('video detail keeps creator fields null when the author has no follower sample', async () => {
      if (!sql) return;
      const res = await crosslink.request('/api/v1/monitor/videos/BVCLQUIET1');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mid).toBe(quietMid);
      expect(body.creator).toEqual({
        mid: quietMid,
        uname: '无粉丝',
        faceAssetId: null,
        followerLatest: null,
        followerSampledAt: null,
        monitoringEnabled: false,
      });
    });

    test('video detail returns creator null when mid is null', async () => {
      if (!sql) return;
      const res = await crosslink.request('/api/v1/monitor/videos/BVCLNULL01');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.mid).toBeNull();
      expect(body.creator).toBeNull();
    });

    test('creator videos are ordered, exclude soft deletes, and keep the newest sample', async () => {
      if (!sql) return;
      stats.queries = 0;
      const res = await crosslink.request(
        `/api/v1/monitor/creators/${sortMid}/videos?limit=20&offset=0`,
      );
      expect(res.status).toBe(200);
      expect(stats.queries).toBe(1);
      const body = await res.json();
      expect(body.mid).toBe(sortMid);
      expect(body.total).toBe(5);
      expect(body.items.map((item: { bvid: string }) => item.bvid)).toEqual([
        'BVCLORD002',
        'BVCLORD000',
        'BVCLORD001',
        'BVCLORD003',
        'BVCLORDNUL',
      ]);
      expect(body.items[0]).toMatchObject({
        bvid: 'BVCLORD002',
        title: '最新发布',
        coverAssetId: 'a_cover_x',
        pubdate: '2026-08-01T00:00:00.000Z',
        partitionName: '影视',
        archivedAt: null,
        latest: {
          sampledAt: newerVideoSampledAt,
          viewCount: '623',
          likeCount: '34',
          commentCount: '8',
          onlineViewers: '1',
        },
      });
      expect(body.items[2].archivedAt).toBe('2026-06-01T00:00:00.000Z');
      expect(body.items[3].latest).toBeNull();
      expect(body.items[4].pubdate).toBeNull();
      expect(body.items.some((item: { bvid: string }) => item.bvid === 'BVCLORDDEL')).toBe(false);
    });

    test('creator videos paging defaults, caps, and stops past the end', async () => {
      if (!sql) return;
      const first = await crosslink.request(`/api/v1/monitor/creators/${pageMid}/videos`);
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody.total).toBe(101);
      expect(firstBody.items).toHaveLength(20);
      expect(firstBody.items[0].bvid).toBe('BVCLP0100');
      expect(firstBody.items[19].bvid).toBe('BVCLP0081');
      expect(firstBody.items.some((item: { bvid: string }) => item.bvid === 'BVCLPDEL0')).toBe(
        false,
      );

      const capped = await crosslink.request(
        `/api/v1/monitor/creators/${pageMid}/videos?limit=1000&offset=0`,
      );
      const cappedBody = await capped.json();
      expect(cappedBody.items).toHaveLength(100);
      expect(cappedBody.total).toBe(101);
      expect(cappedBody.items[0].bvid).toBe('BVCLP0100');
      expect(cappedBody.items[99].bvid).toBe('BVCLP0001');

      const tail = await crosslink.request(
        `/api/v1/monitor/creators/${pageMid}/videos?limit=20&offset=100`,
      );
      const tailBody = await tail.json();
      expect(tailBody.total).toBe(101);
      expect(tailBody.items.map((item: { bvid: string }) => item.bvid)).toEqual(['BVCLP0000']);

      const past = await crosslink.request(
        `/api/v1/monitor/creators/${pageMid}/videos?limit=20&offset=101`,
      );
      const pastBody = await past.json();
      expect(past.status).toBe(200);
      expect(pastBody).toEqual({ mid: pageMid, total: 101, items: [] });

      const one = await crosslink.request(
        `/api/v1/monitor/creators/${pageMid}/videos?limit=1&offset=0`,
      );
      const oneBody = await one.json();
      expect(oneBody.items).toHaveLength(1);
      expect(oneBody.items[0].bvid).toBe('BVCLP0100');
      expect(oneBody.total).toBe(101);
    });

    test('creator with no videos returns an empty list', async () => {
      if (!sql) return;
      const res = await crosslink.request(`/api/v1/monitor/creators/${emptyMid}/videos`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ mid: emptyMid, total: 0, items: [] });
    });

    test('unknown creator videos return 404', async () => {
      if (!sql) return;
      const res = await crosslink.request('/api/v1/monitor/creators/999999999999999/videos');
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not found' });
    });

    test('creator videos reject invalid mid, limit, and offset', async () => {
      if (!sql) return;
      const badMid = await crosslink.request('/api/v1/monitor/creators/not-a-mid/videos');
      expect(badMid.status).toBe(400);
      const badLimit = await crosslink.request(
        `/api/v1/monitor/creators/${emptyMid}/videos?limit=0`,
      );
      expect(badLimit.status).toBe(400);
      const badOffset = await crosslink.request(
        `/api/v1/monitor/creators/${emptyMid}/videos?offset=-1`,
      );
      expect(badOffset.status).toBe(400);
    });

    test('a full creator video page is still one SQL statement', async () => {
      if (!sql) return;
      stats.queries = 0;
      const res = await crosslink.request(`/api/v1/monitor/creators/${pageMid}/videos?limit=20`);
      expect(res.status).toBe(200);
      expect(stats.queries).toBe(1);
      const body = await res.json();
      expect(body.items).toHaveLength(20);
    });
  });
});
