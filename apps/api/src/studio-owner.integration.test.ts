import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  DEFAULT_STUDIO_OWNER_MID,
  parseMonitorCardList,
  parseStudioOwnerAccount,
} from '@studio/contracts';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  updateStudioOwnerAccount,
  type Sql,
} from '@studio/db';
import { installOfflineFetchGuard } from '@studio/monitoring';
import { Hono } from 'hono';
import { createMonitorRoutes } from './monitor-routes';

const OTHER = '1000000000000001';

describe('studio owner settings + onlyMine cards', () => {
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
      INSERT INTO creators (mid, uname) VALUES
        (${DEFAULT_STUDIO_OWNER_MID}::bigint, '狐正正'),
        (${OTHER}::bigint, '狐正正')
    `;
    await sql`
      INSERT INTO videos (bvid, mid, title, category, monitoring_enabled, pubdate) VALUES
        ('BV1mineaaaaa', ${DEFAULT_STUDIO_OWNER_MID}::bigint, '我的A', '游戏', true, '2025-01-01T00:00:00Z'),
        ('BV1minebbbbb', ${DEFAULT_STUDIO_OWNER_MID}::bigint, '我的B', '游戏', true, '2025-02-01T00:00:00Z'),
        ('BV1mineccccc', ${DEFAULT_STUDIO_OWNER_MID}::bigint, '我的C', '游戏', true, '2025-03-01T00:00:00Z'),
        ('BV1othaaaaaa', ${OTHER}::bigint, '他人', '游戏', true, '2025-04-01T00:00:00Z')
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

  test('GET/PUT owner-account persist and reject illegal UID', async () => {
    if (!sql || !app) return;
    const got = await http().request('/api/v1/monitor/settings/owner-account');
    expect(got.status).toBe(200);
    const body = parseStudioOwnerAccount(await got.json());
    expect(body.mid).toBe(DEFAULT_STUDIO_OWNER_MID);
    expect(body.displayName).toBe('狐正正');

    const bad = await http().request('/api/v1/monitor/settings/owner-account', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mid: '01', displayName: 'x' }),
    });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { code: string }).code).toBe('invalid_owner_mid');

    const emptyName = await http().request('/api/v1/monitor/settings/owner-account', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mid: DEFAULT_STUDIO_OWNER_MID, displayName: '  ' }),
    });
    expect(emptyName.status).toBe(400);

    const unknownOk = await http().request('/api/v1/monitor/settings/owner-account', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mid: '3000000000000003', displayName: '未知UID' }),
    });
    expect(unknownOk.status).toBe(200);
    expect(parseStudioOwnerAccount(await unknownOk.json()).mid).toBe('3000000000000003');

    await updateStudioOwnerAccount(sql, {
      mid: DEFAULT_STUDIO_OWNER_MID,
      displayName: '狐正正',
    });
  });

  test('onlyMine filters server-side before page; invalid flag 400; off restores full list', async () => {
    if (!sql || !app) return;
    const filtered = parseMonitorCardList(
      await (
        await http().request(
          '/api/v1/monitor/cards?type=video&category=游戏&page=1&pageSize=2&onlyMine=1&sort=published_asc',
        )
      ).json(),
    );
    expect(filtered.totalItems).toBe(3);
    expect(filtered.items.map((item) => item.externalId)).toEqual(['BV1mineaaaaa', 'BV1minebbbbb']);
    expect(filtered.items.every((item) => item.mid === DEFAULT_STUDIO_OWNER_MID)).toBe(true);

    const page2 = parseMonitorCardList(
      await (
        await http().request(
          '/api/v1/monitor/cards?type=video&category=游戏&page=2&pageSize=2&onlyMine=1&sort=published_asc',
        )
      ).json(),
    );
    expect(page2.totalItems).toBe(3);
    expect(page2.items.map((item) => item.externalId)).toEqual(['BV1mineccccc']);

    const badFlag = await http().request('/api/v1/monitor/cards?type=video&onlyMine=yes');
    expect(badFlag.status).toBe(400);

    const all = parseMonitorCardList(
      await (
        await http().request('/api/v1/monitor/cards?type=video&category=游戏&page=1&pageSize=50')
      ).json(),
    );
    expect(all.totalItems).toBe(4);

    await updateStudioOwnerAccount(sql, { mid: '3000000000000003', displayName: '未知' });
    const empty = parseMonitorCardList(
      await (
        await http().request(
          '/api/v1/monitor/cards?type=video&category=游戏&page=1&pageSize=8&onlyMine=1',
        )
      ).json(),
    );
    expect(empty.totalItems).toBe(0);
    await updateStudioOwnerAccount(sql, {
      mid: DEFAULT_STUDIO_OWNER_MID,
      displayName: '狐正正',
    });
  });

  test('onlyMine does not affect creator cards', async () => {
    if (!sql || !app) return;
    const creators = parseMonitorCardList(
      await (
        await http().request('/api/v1/monitor/cards?type=creator&page=1&pageSize=50&onlyMine=1')
      ).json(),
    );
    expect(creators.totalItems).toBeGreaterThanOrEqual(2);
  });
});
