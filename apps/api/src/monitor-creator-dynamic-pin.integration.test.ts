import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  parseMonitorCardList,
  parsePinEntityResponse,
  parseDynamicListQuery,
} from '@studio/contracts';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase, type Sql } from '@studio/db';
import { installOfflineFetchGuard } from '@studio/monitoring';
import { Hono } from 'hono';
import { createMonitorRoutes } from './monitor-routes';

describe('creator + dynamic pin and sort', () => {
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
      INSERT INTO creators (mid, uname, monitoring_enabled) VALUES
        (710001, '甲UP', true),
        (710002, '乙UP', true)
    `;
    await sql`
      INSERT INTO creator_follower_samples (
        mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count
      ) VALUES
        (710001, '2026-01-01T00:00:00Z', 'Asia/Shanghai', 't', 'minute', 10),
        (710002, '2026-02-01T00:00:00Z', 'Asia/Shanghai', 't', 'minute', 99)
    `;
    await sql`
      INSERT INTO dynamics (dynamic_id, mid, monitoring_enabled) VALUES
        ('966692349750011111', 710001, true),
        ('966692349750022222', 710002, true)
    `;
    await sql`
      INSERT INTO dynamic_metric_samples (
        dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision,
        like_count, repost_count, comment_count
      ) VALUES
        ('966692349750011111', '2026-01-01T00:00:00Z', 'Asia/Shanghai', 't', 'minute', 5, 1, 50),
        ('966692349750022222', '2026-02-01T00:00:00Z', 'Asia/Shanghai', 't', 'minute', 80, 2, 3)
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

  test('PATCH creator pin is idempotent and surfaces on cards list', async () => {
    if (!sql || !app) return;
    const pinned = await http().request('/api/v1/monitor/creators/710001/pin', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });
    expect(pinned.status).toBe(200);
    expect(parsePinEntityResponse(await pinned.json()).pinned).toBe(true);

    const again = await http().request('/api/v1/monitor/creators/710001/pin', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });
    expect(again.status).toBe(200);

    const listed = parseMonitorCardList(
      await (
        await http().request(
          '/api/v1/monitor/cards?type=creator&page=1&pageSize=8&sort=sampled_desc',
        )
      ).json(),
    );
    expect(listed.items[0]?.externalId).toBe('710001');
    expect(listed.items[0]?.pinned).toBe(true);

    const followers = parseMonitorCardList(
      await (
        await http().request(
          '/api/v1/monitor/cards?type=creator&page=1&pageSize=8&sort=followers_desc',
        )
      ).json(),
    );
    expect(followers.items[0]?.externalId).toBe('710001');
    expect(followers.items.map((item) => item.externalId)).toEqual(['710001', '710002']);

    const badSort = await http().request(
      '/api/v1/monitor/cards?type=creator&page=1&pageSize=8&sort=published_desc',
    );
    expect(badSort.status).toBe(400);

    const missing = await http().request('/api/v1/monitor/creators/999999999/pin', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });
    expect(missing.status).toBe(404);

    await http().request('/api/v1/monitor/creators/710001/pin', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: false }),
    });
  });

  test('PATCH dynamic pin + GET /dynamics sort', async () => {
    if (!sql || !app) return;
    expect(parseDynamicListQuery({}).sort).toBe('sampled_desc');
    expect(() => parseDynamicListQuery({ sort: 'published_desc' })).toThrow(/排序/);

    const pinned = await http().request('/api/v1/monitor/dynamics/966692349750011111/pin', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });
    expect(pinned.status).toBe(200);
    expect(parsePinEntityResponse(await pinned.json())).toMatchObject({ pinned: true });

    const likes = (await (
      await http().request('/api/v1/monitor/dynamics?page=1&pageSize=8&sort=likes_desc')
    ).json()) as { items: { dynamicId: string; pinned: boolean }[] };
    expect(likes.items[0]?.dynamicId).toBe('966692349750011111');
    expect(likes.items[0]?.pinned).toBe(true);

    const comments = (await (
      await http().request('/api/v1/monitor/dynamics?page=1&pageSize=8&sort=comments_desc')
    ).json()) as { items: { dynamicId: string }[] };
    expect(comments.items.map((item) => item.dynamicId)).toEqual([
      '966692349750011111',
      '966692349750022222',
    ]);

    const bad = await http().request('/api/v1/monitor/dynamics?page=1&sort=views');
    expect(bad.status).toBe(400);

    const missing = await http().request('/api/v1/monitor/dynamics/966692349750099999/pin', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pinned: true }),
    });
    expect(missing.status).toBe(404);
  });
});
