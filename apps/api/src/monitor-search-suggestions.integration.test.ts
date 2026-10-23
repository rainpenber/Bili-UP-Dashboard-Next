import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { parseMonitorSearchSuggestionsResponse } from '@studio/contracts';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase, type Sql } from '@studio/db';
import { installOfflineFetchGuard } from '@studio/monitoring';
import { Hono } from 'hono';
import { createMonitorRoutes } from './monitor-routes';

describe('monitor search-suggestions HTTP', () => {
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
      INSERT INTO creators (mid, uname, category) VALUES
        (920001, '建议UP', '知识')
    `;
    await sql`
      INSERT INTO videos (bvid, mid, title, category) VALUES
        ('BV1suggaaaaa', 920001, '建议视频标题', '知识')
    `;
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  function http() {
    if (!app) throw new Error('app unavailable');
    return app;
  }

  test('returns grouped readable suggestions and validates query', async () => {
    if (!sql) return;
    const ok = await http().request(
      '/api/v1/monitor/search-suggestions?type=video&q=%E5%BB%BA%E8%AE%AE&limit=5',
    );
    expect(ok.status).toBe(200);
    const body = parseMonitorSearchSuggestionsResponse(await ok.json());
    expect(body.videos.some((item) => item.label === '建议视频标题')).toBe(true);
    expect(body.creators.some((item) => item.label === '建议UP')).toBe(true);

    const byCategory = await http().request(
      '/api/v1/monitor/search-suggestions?type=video&q=%E7%9F%A5',
    );
    expect(byCategory.status).toBe(200);
    const categoryBody = parseMonitorSearchSuggestionsResponse(await byCategory.json());
    expect(categoryBody.categories.some((item) => item.label === '知识')).toBe(true);

    const byBv = await http().request(
      '/api/v1/monitor/search-suggestions?type=video&q=BV1suggaaaaa',
    );
    expect(byBv.status).toBe(200);
    const bvBody = parseMonitorSearchSuggestionsResponse(await byBv.json());
    expect(bvBody.videos[0]?.label).toBe('建议视频标题');

    const badType = await http().request('/api/v1/monitor/search-suggestions?type=dynamic&q=a');
    expect(badType.status).toBe(400);

    const empty = await http().request('/api/v1/monitor/search-suggestions?type=video&q=');
    expect(empty.status).toBe(200);
    const emptyBody = parseMonitorSearchSuggestionsResponse(await empty.json());
    expect(emptyBody.videos).toEqual([]);
  });
});
