import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase, type Sql } from '@studio/db';
import { createApp } from './app';
import { mountApiRoutes } from './mount-api';

const DYNAMIC_ID = '1241488471951933462';
const MID = '496445222';
const PUBLISHED_AT = '2026-08-28T13:29:00+08:00';

describe('manual creator publish events', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let app: ReturnType<typeof createApp> | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
    app = createApp({ skipDb: true });
    mountApiRoutes(app, sql);

    await sql`
      INSERT INTO creators (mid, uname, monitoring_enabled)
      VALUES (${MID}::bigint, 'GOAT前进', true)
    `;
    await sql`
      INSERT INTO monitor_targets (
        id, "type", external_id, label, tags, enabled, interval_minutes, interval_mode, source
      ) VALUES (
        ${crypto.randomUUID()}::uuid,
        'creator',
        ${MID},
        'GOAT前进',
        '{}',
        true,
        240,
        'fixed',
        'offline'
      )
    `;
    await sql`
      INSERT INTO monitor_targets (
        id, "type", external_id, label, tags, enabled, interval_minutes, interval_mode, source
      ) VALUES (
        ${crypto.randomUUID()}::uuid,
        'dynamic',
        ${DYNAMIC_ID},
        '抽PS5和GTA6啦!',
        '{}',
        true,
        60,
        'fixed',
        'offline'
      )
    `;
    await sql`
      INSERT INTO dynamics (dynamic_id, mid, monitoring_enabled, metadata)
      VALUES (
        ${DYNAMIC_ID},
        ${MID}::bigint,
        true,
        ${sql.json({
          author_name: 'GOAT前进',
          text: '抽PS5和GTA6啦!',
          published_at: '2026-08-28T05:29:00.000Z',
        })}
      )
    `;
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('POST create / idempotent / DELETE manual_only / 404', async () => {
    if (!sql || !app) return;

    const create = await app.request(`/api/v1/monitor/creators/${MID}/publish-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventKind: 'dynamic',
        externalId: DYNAMIC_ID,
        publishedAt: PUBLISHED_AT,
        title: '抽PS5和GTA6啦!',
      }),
    });
    expect(create.status).toBe(200);
    const created = (await create.json()) as {
      created: boolean;
      monitored: boolean;
      monitoredTargetId: string | null;
      event: {
        id: string;
        source: string;
        titleSnapshot: string;
        externalId: string;
      };
    };
    expect(created.created).toBe(true);
    expect(created.monitored).toBe(true);
    expect(created.monitoredTargetId).toBeTruthy();
    expect(created.event.source).toBe('manual');
    expect(created.event.titleSnapshot).toBe('抽PS5和GTA6啦!');
    expect(created.event.externalId).toBe(DYNAMIC_ID);

    const listed = await app.request(
      `/api/v1/monitor/creators/${MID}/publish-events?page=1&pageSize=20`,
    );
    expect(listed.status).toBe(200);
    const listBody = (await listed.json()) as {
      totalItems: number;
      items: { source: string; externalId: string; monitored: boolean }[];
    };
    expect(listBody.totalItems).toBe(1);
    expect(listBody.items[0]).toMatchObject({
      source: 'manual',
      externalId: DYNAMIC_ID,
      monitored: true,
    });

    const again = await app.request(`/api/v1/monitor/creators/${MID}/publish-events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventKind: 'dynamic',
        externalId: DYNAMIC_ID,
        publishedAt: PUBLISHED_AT,
        title: '应被忽略的新标题',
      }),
    });
    expect(again.status).toBe(200);
    const againBody = (await again.json()) as {
      created: boolean;
      event: { id: string; titleSnapshot: string };
    };
    expect(againBody.created).toBe(false);
    expect(againBody.event.id).toBe(created.event.id);
    expect(againBody.event.titleSnapshot).toBe('抽PS5和GTA6啦!');

    const listedAgain = await app.request(
      `/api/v1/monitor/creators/${MID}/publish-events?page=1&pageSize=20`,
    );
    const listAgain = (await listedAgain.json()) as { totalItems: number };
    expect(listAgain.totalItems).toBe(1);

    const bilibiliId = crypto.randomUUID();
    await sql`
      INSERT INTO creator_publish_events (
        id, mid, event_kind, external_id, published_at, title_snapshot,
        first_discovered_at, source
      ) VALUES (
        ${bilibiliId}::uuid,
        ${MID},
        'dynamic',
        '900000000000000001',
        ${new Date('2026-09-01T00:00:00.000Z')},
        '自动发现',
        ${new Date()},
        'bilibili'
      )
    `;
    const deny = await app.request(`/api/v1/monitor/creators/${MID}/publish-events/${bilibiliId}`, {
      method: 'DELETE',
    });
    expect(deny.status).toBe(409);
    const denyBody = (await deny.json()) as { code: string };
    expect(denyBody.code).toBe('manual_only');

    const removed = await app.request(
      `/api/v1/monitor/creators/${MID}/publish-events/${created.event.id}`,
      { method: 'DELETE' },
    );
    expect(removed.status).toBe(204);

    const gone = await app.request(
      `/api/v1/monitor/creators/${MID}/publish-events/${created.event.id}`,
      { method: 'DELETE' },
    );
    expect(gone.status).toBe(404);

    const empty = await app.request(
      `/api/v1/monitor/creators/${MID}/publish-events?page=1&pageSize=20`,
    );
    const emptyBody = (await empty.json()) as { totalItems: number; items: unknown[] };
    // bilibili-sourced event remains
    expect(emptyBody.totalItems).toBe(1);
    expect(emptyBody.items).toHaveLength(1);
  }, 30_000);

  test('list hides dynamic events that duplicate an existing video bvid', async () => {
    if (!sql || !app) return;
    const before = await app.request(
      `/api/v1/monitor/creators/${MID}/publish-events?page=1&pageSize=200`,
    );
    const beforeBody = (await before.json()) as { totalItems: number };

    const videoBvid = 'BV1xx411c7mD';
    const videoId = crypto.randomUUID();
    const relatedDynamicId = crypto.randomUUID();
    const plainDynamicId = crypto.randomUUID();
    await sql`
      INSERT INTO creator_publish_events (
        id, mid, event_kind, external_id, published_at, title_snapshot,
        first_discovered_at, source
      ) VALUES (
        ${videoId}::uuid,
        ${MID},
        'video',
        ${videoBvid},
        ${new Date('2026-10-02T00:00:00.000Z')},
        '视频标题',
        ${new Date()},
        'bilibili'
      )
    `;
    await sql`
      INSERT INTO creator_publish_events (
        id, mid, event_kind, external_id, published_at, title_snapshot,
        first_discovered_at, source, related_bvid
      ) VALUES (
        ${relatedDynamicId}::uuid,
        ${MID},
        'dynamic',
        '900000000000000002',
        ${new Date('2026-10-02T00:00:01.000Z')},
        '动态正文',
        ${new Date()},
        'bilibili',
        ${videoBvid}
      )
    `;
    await sql`
      INSERT INTO creator_publish_events (
        id, mid, event_kind, external_id, published_at, title_snapshot,
        first_discovered_at, source
      ) VALUES (
        ${plainDynamicId}::uuid,
        ${MID},
        'dynamic',
        '900000000000000003',
        ${new Date('2026-10-02T00:00:02.000Z')},
        '普通图文',
        ${new Date()},
        'bilibili'
      )
    `;

    const listed = await app.request(
      `/api/v1/monitor/creators/${MID}/publish-events?page=1&pageSize=200`,
    );
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      totalItems: number;
      items: { id: string; relatedBvid?: string }[];
    };
    expect(body.totalItems).toBe(beforeBody.totalItems + 2);
    expect(body.totalItems).toBe(body.items.length);
    const ids = body.items.map((item) => item.id);
    expect(ids).toContain(videoId);
    expect(ids).toContain(plainDynamicId);
    expect(ids).not.toContain(relatedDynamicId);
  }, 30_000);
});
