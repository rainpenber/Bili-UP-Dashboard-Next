import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';
import { insertCreatorPublishEvent, listCreatorPublishEvents } from './creator-discovery';
import type { Sql } from './client';

const MID = '496445222';
const VIDEO_BVID = 'BV1xx411c7mD';

describe('creator publish event related bvid', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('migration 024 can be applied repeatedly', async () => {
    if (!sql) return;
    const body = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../migrations/024_publish_event_related_bvid.sql',
      ),
      'utf8',
    );
    await sql.unsafe(body);
    await sql.unsafe(body);

    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'creator_publish_events'
        AND column_name = 'related_bvid'
    `;
    expect(columns).toHaveLength(1);

    const indexes = await sql<{ indexname: string }[]>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'creator_publish_events'
        AND indexname = 'creator_publish_events_mid_related_bvid'
    `;
    expect(indexes).toHaveLength(1);
  });

  test('list hides a dynamic whose related bvid has a video event', async () => {
    if (!sql) return;
    const now = new Date('2026-10-24T00:00:00.000Z');
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: MID,
      eventKind: 'video',
      externalId: VIDEO_BVID,
      publishedAt: new Date('2026-10-01T00:00:00.000Z'),
      titleSnapshot: '视频标题',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: MID,
      eventKind: 'dynamic',
      externalId: '900000000000000001',
      publishedAt: new Date('2026-10-01T00:00:01.000Z'),
      titleSnapshot: '动态正文',
      firstDiscoveredAt: now,
      relatedBvid: VIDEO_BVID,
      source: 'bilibili',
    });
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: MID,
      eventKind: 'dynamic',
      externalId: '900000000000000002',
      publishedAt: new Date('2026-10-01T00:00:02.000Z'),
      titleSnapshot: '普通图文',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });

    const listed = await listCreatorPublishEvents(sql, { mid: MID, limit: 50 });
    expect(listed.totalItems).toBe(2);
    expect(listed.items).toHaveLength(2);
    expect(listed.items.map((e) => e.externalId)).toEqual([VIDEO_BVID, '900000000000000002']);
    expect(listed.items[0]?.relatedBvid).toBeNull();
  });
});
