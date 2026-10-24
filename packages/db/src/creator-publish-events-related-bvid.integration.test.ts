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

async function insertVideoWithDescription(
  sql: Sql,
  input: {
    bvid: string;
    mid: string;
    pubdate: Date;
    description: string;
  },
): Promise<void> {
  await sql`INSERT INTO creators (mid) VALUES (${input.mid}::bigint) ON CONFLICT (mid) DO NOTHING`;
  await sql`
    INSERT INTO videos (bvid, mid, pubdate, description)
    VALUES (${input.bvid}, ${input.mid}::bigint, ${input.pubdate}, ${input.description})
  `;
}

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
    expect(listed.items.map((e) => e.externalId)).toEqual(['900000000000000002', VIDEO_BVID]);
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

  test('hides a same-day dynamic whose normalized title matches a video', async () => {
    if (!sql) return;
    const mid = '496445444';
    const now = new Date('2026-10-24T00:00:00.000Z');
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid,
      eventKind: 'video',
      externalId: 'BV1aa411c7m1',
      publishedAt: new Date('2026-10-11T10:00:00.000Z'),
      titleSnapshot: 'Hello, World! 测试',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid,
      eventKind: 'dynamic',
      externalId: '900000000000000201',
      publishedAt: new Date('2026-10-11T11:00:00.000Z'),
      titleSnapshot: 'hello，world   测试',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });

    const listed = await listCreatorPublishEvents(sql, { mid, limit: 50 });
    expect(listed.totalItems).toBe(1);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.eventKind).toBe('video');
    expect(listed.items[0]?.externalId).toBe('BV1aa411c7m1');
  });

  test('keeps a same-day dynamic with a different title', async () => {
    if (!sql) return;
    const mid = '496445555';
    const now = new Date('2026-10-24T00:00:00.000Z');
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid,
      eventKind: 'video',
      externalId: 'BV1bb411c7m2',
      publishedAt: new Date('2026-10-11T10:00:00.000Z'),
      titleSnapshot: '视频：A',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid,
      eventKind: 'dynamic',
      externalId: '900000000000000202',
      publishedAt: new Date('2026-10-11T11:00:00.000Z'),
      titleSnapshot: '动态：B',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });

    const listed = await listCreatorPublishEvents(sql, { mid, limit: 50 });
    expect(listed.totalItems).toBe(2);
    expect(listed.items).toHaveLength(2);
  });

  test('keeps same-title video and dynamic on different UTC days', async () => {
    if (!sql) return;
    const mid = '496445666';
    const now = new Date('2026-10-24T00:00:00.000Z');
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid,
      eventKind: 'video',
      externalId: 'BV1cc411c7m3',
      publishedAt: new Date('2026-10-12T23:30:00.000Z'),
      titleSnapshot: '同名标题',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid,
      eventKind: 'dynamic',
      externalId: '900000000000000203',
      publishedAt: new Date('2026-10-13T00:30:00.000Z'),
      titleSnapshot: '同名标题',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });

    const listed = await listCreatorPublishEvents(sql, { mid, limit: 50 });
    expect(listed.totalItems).toBe(2);
    expect(listed.items).toHaveLength(2);
  });

  test('hides a dynamic whose title prefixes a same-day video description', async () => {
    if (!sql) return;
    const mid = '496445777';
    const now = new Date('2026-10-24T00:00:00.000Z');
    const description =
      '被AppleWatch“救命”是真实经历。今年借由秋季发布会，从一个身体有点亚健康的用户角度，继续补充更多细节。';
    await insertVideoWithDescription(sql, {
      bvid: 'BV1dd411c7m4',
      mid,
      pubdate: new Date('2026-10-15T08:00:00.000Z'),
      description,
    });
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid,
      eventKind: 'dynamic',
      externalId: '900000000000000301',
      publishedAt: new Date('2026-10-15T09:00:00.000Z'),
      titleSnapshot: description.slice(0, 40),
      firstDiscoveredAt: now,
      source: 'bilibili',
    });

    const listed = await listCreatorPublishEvents(sql, { mid, limit: 50 });
    expect(listed.totalItems).toBe(0);
    expect(listed.items).toHaveLength(0);
  });

  test('keeps a same-day dynamic unrelated to a video description', async () => {
    if (!sql) return;
    const mid = '496445778';
    const now = new Date('2026-10-24T00:00:00.000Z');
    await insertVideoWithDescription(sql, {
      bvid: 'BV1ee411c7m5',
      mid,
      pubdate: new Date('2026-10-15T08:00:00.000Z'),
      description: '这是一段完全无关的视频简介，讲的是别的事情和别的主题。',
    });
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid,
      eventKind: 'dynamic',
      externalId: '900000000000000302',
      publishedAt: new Date('2026-10-15T09:00:00.000Z'),
      titleSnapshot: '今天出门散步看到了一只很可爱的猫',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });

    const listed = await listCreatorPublishEvents(sql, { mid, limit: 50 });
    expect(listed.totalItems).toBe(1);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.externalId).toBe('900000000000000302');
  });

  test('keeps a short dynamic title even when it prefixes a video description', async () => {
    if (!sql) return;
    const mid = '496445779';
    const now = new Date('2026-10-24T00:00:00.000Z');
    await insertVideoWithDescription(sql, {
      bvid: 'BV1ff411c7m6',
      mid,
      pubdate: new Date('2026-10-15T08:00:00.000Z'),
      description: '测试视频简介，后面还有很长的一段正文内容用于校验前缀。',
    });
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid,
      eventKind: 'dynamic',
      externalId: '900000000000000303',
      publishedAt: new Date('2026-10-15T09:00:00.000Z'),
      titleSnapshot: '测试',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });

    const listed = await listCreatorPublishEvents(sql, { mid, limit: 50 });
    expect(listed.totalItems).toBe(1);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.externalId).toBe('900000000000000303');
  });

  test('keeps a description-prefix dynamic on a different UTC day', async () => {
    if (!sql) return;
    const mid = '496445780';
    const now = new Date('2026-10-24T00:00:00.000Z');
    await insertVideoWithDescription(sql, {
      bvid: 'BV1gg411c7m7',
      mid,
      pubdate: new Date('2026-10-16T23:30:00.000Z'),
      description: '跨日视频简介：这是一段足够长的正文内容，用来验证同日判定边界。',
    });
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid,
      eventKind: 'dynamic',
      externalId: '900000000000000304',
      publishedAt: new Date('2026-10-17T00:30:00.000Z'),
      titleSnapshot: '跨日视频简介：这是一段足够长的正文内容',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });

    const listed = await listCreatorPublishEvents(sql, { mid, limit: 50 });
    expect(listed.totalItems).toBe(1);
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]?.externalId).toBe('900000000000000304');
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
