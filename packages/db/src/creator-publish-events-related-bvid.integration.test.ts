import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';
import { insertCreatorPublishEvent, listCreatorPublishEvents } from './creator-discovery';
import type { Sql } from './client';

const MID = '496445222';
const VIDEO_BVID = 'BV1xx411c7mD';
const BACKFILL_MID = '496445333';

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

  test('backfills related bvid on an existing dynamic without creating a row', async () => {
    if (!sql) return;
    const now = new Date('2026-10-24T00:00:00.000Z');
    const externalId = '900000000000000101';
    const first = await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: BACKFILL_MID,
      eventKind: 'dynamic',
      externalId,
      publishedAt: new Date('2026-10-02T00:00:00.000Z'),
      titleSnapshot: '动态正文',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });
    expect(first.created).toBe(true);
    expect(first.event.relatedBvid).toBeNull();

    const patched = await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: BACKFILL_MID,
      eventKind: 'dynamic',
      externalId,
      publishedAt: new Date('2026-10-02T00:00:00.000Z'),
      titleSnapshot: '动态正文',
      firstDiscoveredAt: now,
      relatedBvid: 'BV1backfill1',
      source: 'bilibili',
    });
    expect(patched.created).toBe(false);
    expect(patched.event.externalId).toBe(externalId);
    expect(patched.event.relatedBvid).toBe('BV1backfill1');

    const counts = await sql<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM creator_publish_events
      WHERE mid = ${BACKFILL_MID}
        AND event_kind = 'dynamic'
        AND external_id = ${externalId}
    `;
    expect(counts[0]?.count).toBe('1');
  });

  test('does not overwrite an existing related bvid', async () => {
    if (!sql) return;
    const now = new Date('2026-10-24T00:00:00.000Z');
    const externalId = '900000000000000102';
    const first = await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: BACKFILL_MID,
      eventKind: 'dynamic',
      externalId,
      publishedAt: new Date('2026-10-02T00:00:01.000Z'),
      titleSnapshot: '动态正文',
      firstDiscoveredAt: now,
      relatedBvid: 'BV1original',
      source: 'bilibili',
    });
    expect(first.created).toBe(true);

    const again = await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: BACKFILL_MID,
      eventKind: 'dynamic',
      externalId,
      publishedAt: new Date('2026-10-02T00:00:01.000Z'),
      titleSnapshot: '动态正文',
      firstDiscoveredAt: now,
      relatedBvid: 'BV1different',
      source: 'bilibili',
    });
    expect(again.created).toBe(false);
    expect(again.event.relatedBvid).toBe('BV1original');
  });

  test('new insert with related bvid reports created and stores the bvid', async () => {
    if (!sql) return;
    const now = new Date('2026-10-24T00:00:00.000Z');
    const result = await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: BACKFILL_MID,
      eventKind: 'dynamic',
      externalId: '900000000000000103',
      publishedAt: new Date('2026-10-02T00:00:02.000Z'),
      titleSnapshot: '动态正文',
      firstDiscoveredAt: now,
      relatedBvid: 'BV1fresh',
      source: 'bilibili',
    });
    expect(result.created).toBe(true);
    expect(result.event.relatedBvid).toBe('BV1fresh');
  });
});
