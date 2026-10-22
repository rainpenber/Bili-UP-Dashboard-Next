import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { parseMonitorCardList, parsePinVideoResponse } from '@studio/contracts';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase, type Sql } from '@studio/db';
import { installOfflineFetchGuard } from '@studio/monitoring';
import { Hono } from 'hono';
import { createMonitorRoutes } from './monitor-routes';

describe('PATCH /videos/:bvid/pin', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let app: Hono | null = null;

  beforeAll(async () => {
    installOfflineFetchGuard();
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
    app = new Hono();
    app.route('/api/v1/monitor', createMonitorRoutes(sql));
    await sql`
      INSERT INTO videos (bvid, title, category, monitoring_enabled, pubdate) VALUES
        ('BV1pinok1111', '可置顶', '游戏', true, '2025-01-01T00:00:00Z'),
        ('BV1pinnoA111', '无时间', '游戏', true, NULL)
    `;
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  function http(): Hono {
    if (!app) throw new Error('app missing');
    return app;
  }

  async function pin(bvid: string, body: unknown) {
    return http().request(`/api/v1/monitor/videos/${bvid}/pin`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  test('pins and unpins idempotently, validates bvid, 404s missing', async () => {
    if (!sql || !app) return;
    const pinned = await pin('BV1pinok1111', { pinned: true });
    expect(pinned.status).toBe(200);
    const pinnedBody = parsePinVideoResponse(await pinned.json());
    expect(pinnedBody).toMatchObject({ bvid: 'BV1pinok1111', pinned: true });
    expect(pinnedBody.pinnedAt).toBeTruthy();

    const pinnedAgain = await pin('BV1pinok1111', { pinned: true });
    expect(pinnedAgain.status).toBe(200);
    expect(parsePinVideoResponse(await pinnedAgain.json()).pinned).toBe(true);

    const listed = parseMonitorCardList(
      await (
        await http().request(
          '/api/v1/monitor/cards?type=video&category=游戏&page=1&pageSize=8&sort=published_desc',
        )
      ).json(),
    );
    expect(listed.items[0]?.externalId).toBe('BV1pinok1111');
    expect(listed.items[0]?.pinned).toBe(true);

    const unpinned = await pin('BV1pinok1111', { pinned: false });
    expect(unpinned.status).toBe(200);
    expect(parsePinVideoResponse(await unpinned.json())).toEqual({
      bvid: 'BV1pinok1111',
      pinned: false,
      pinnedAt: null,
    });
    const unpinnedAgain = await pin('BV1pinok1111', { pinned: false });
    expect(unpinnedAgain.status).toBe(200);

    const badId = await pin('not-a-bvid', { pinned: true });
    expect(badId.status).toBe(400);
    expect(((await badId.json()) as { code: string }).code).toBe('invalid_external_id');

    const missing = await pin('BV1missngA11', { pinned: true });
    expect(missing.status).toBe(404);

    const badBody = await pin('BV1pinok1111', { pinned: 'yes' });
    expect(badBody.status).toBe(400);
  });

  test('null pubdate sorts after known times for both directions', async () => {
    if (!sql || !app) return;
    await pin('BV1pinok1111', { pinned: false });
    const desc = parseMonitorCardList(
      await (
        await http().request(
          '/api/v1/monitor/cards?type=video&category=游戏&page=1&pageSize=8&sort=published_desc',
        )
      ).json(),
    );
    expect(desc.items.map((item) => item.externalId)).toEqual(['BV1pinok1111', 'BV1pinnoA111']);
    const asc = parseMonitorCardList(
      await (
        await http().request(
          '/api/v1/monitor/cards?type=video&category=游戏&page=1&pageSize=8&sort=published_asc',
        )
      ).json(),
    );
    expect(asc.items.map((item) => item.externalId)).toEqual(['BV1pinok1111', 'BV1pinnoA111']);
  });
});
