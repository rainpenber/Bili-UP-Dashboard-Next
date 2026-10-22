import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  listMonitorCards,
  runMigrations,
  setVideoPinned,
  type Sql,
} from './index';

const IDS = {
  oldPinned: 'BV1odpinA111',
  newPinned: 'BV1newpin111',
  midUnpinned: 'BV1midunpin1',
  nullPub: 'BV1nupubA111',
  newest: 'BV1newest111',
  oldest: 'BV1odestA111',
  twinA: 'BV1twinAAA11',
  twinB: 'BV1twinBBB11',
} as const;

describe('monitor card pin + published sort', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
    const applied = await runMigrations(sql);
    expect(applied.includes('014_video_pinned_at') || applied.length === 0).toBe(true);
    expect((await runMigrations(sql)).length).toBe(0);

    await sql`
      INSERT INTO videos (bvid, title, category, monitoring_enabled, pubdate, pinned_at) VALUES
        (${IDS.oldPinned}, '旧置顶', '游戏', true, '2024-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
        (${IDS.newPinned}, '新置顶', '游戏', true, '2025-06-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        (${IDS.midUnpinned}, '中间未置顶', '游戏', true, '2025-01-01T00:00:00Z', NULL),
        (${IDS.nullPub}, '无发布时间', '游戏', true, NULL, NULL),
        (${IDS.newest}, '最新未置顶', '游戏', true, '2026-03-01T00:00:00Z', NULL),
        (${IDS.oldest}, '最早未置顶', '游戏', true, '2023-01-01T00:00:00Z', NULL),
        (${IDS.twinA}, '同发布时间A', '游戏', true, '2024-06-15T00:00:00Z', NULL),
        (${IDS.twinB}, '同发布时间B', '游戏', true, '2024-06-15T00:00:00Z', NULL)
    `;
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  function db(): Sql {
    if (!sql) throw new Error('postgres unavailable');
    return sql;
  }

  test('pinned group first, then pubdate direction, nulls last, stable bvid', async () => {
    if (!sql) return;
    const desc = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: '游戏',
      sort: 'published_desc',
    });
    expect(desc.items.map((item) => item.externalId)).toEqual([
      IDS.newPinned,
      IDS.oldPinned,
      IDS.newest,
      IDS.midUnpinned,
      IDS.twinA,
      IDS.twinB,
      IDS.oldest,
      IDS.nullPub,
    ]);
    expect(desc.items.filter((item) => item.pinned).map((item) => item.externalId)).toEqual([
      IDS.newPinned,
      IDS.oldPinned,
    ]);

    const asc = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: '游戏',
      sort: 'published_asc',
    });
    expect(asc.items.map((item) => item.externalId)).toEqual([
      IDS.oldPinned,
      IDS.newPinned,
      IDS.oldest,
      IDS.twinA,
      IDS.twinB,
      IDS.midUnpinned,
      IDS.newest,
      IDS.nullPub,
    ]);
  });

  test('server sort is consistent across pages with no duplicates or gaps', async () => {
    if (!sql) return;
    const full = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: '游戏',
      sort: 'published_desc',
    });
    const page1 = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 3,
      q: null,
      category: '游戏',
      sort: 'published_desc',
    });
    const page2 = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 2,
      pageSize: 3,
      q: null,
      category: '游戏',
      sort: 'published_desc',
    });
    const page3 = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 3,
      pageSize: 3,
      q: null,
      category: '游戏',
      sort: 'published_desc',
    });
    const paged = [...page1.items, ...page2.items, ...page3.items];
    expect(paged.map((item) => item.externalId)).toEqual(full.items.map((item) => item.externalId));
    expect(new Set(paged.map((item) => item.externalId)).size).toBe(paged.length);
  });

  test('setVideoPinned is idempotent and returns null for missing videos', async () => {
    if (!sql) return;
    const first = await setVideoPinned(db(), IDS.oldest, true);
    expect(first?.pinnedAt).toBeTruthy();
    const again = await setVideoPinned(db(), IDS.oldest, true);
    expect(again?.pinnedAt).toBeTruthy();
    const cleared = await setVideoPinned(db(), IDS.oldest, false);
    expect(cleared?.pinnedAt).toBeNull();
    const clearedAgain = await setVideoPinned(db(), IDS.oldest, false);
    expect(clearedAgain?.pinnedAt).toBeNull();
    expect(await setVideoPinned(db(), 'BV1missngA11', true)).toBeNull();

    const after = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: '游戏',
      sort: 'published_desc',
    });
    expect(after.items[0]?.externalId).not.toBe(IDS.oldest);
    expect(after.items.find((item) => item.externalId === IDS.oldest)?.pinned).toBe(false);
  });

  test('creator list ignores video sort and stays sampled_at ordered', async () => {
    if (!sql) return;
    await db()`
      INSERT INTO creators (mid, uname, monitoring_enabled) VALUES
        (910001, 'UP甲', true),
        (910002, 'UP乙', true)
    `;
    await db()`
      INSERT INTO creator_follower_samples (
        mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count
      ) VALUES
        (910001, '2026-01-01T00:00:00Z', 'Asia/Shanghai', 't', 'minute', 1),
        (910002, '2026-02-01T00:00:00Z', 'Asia/Shanghai', 't', 'minute', 2)
    `;
    const listed = await listMonitorCards(db(), {
      type: 'creator',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: null,
      sort: 'published_asc',
    });
    const mids = listed.items
      .filter((item) => item.externalId === '910001' || item.externalId === '910002')
      .map((item) => item.externalId);
    expect(mids).toEqual(['910002', '910001']);
    expect(listed.items.every((item) => item.pinned === false)).toBe(true);
  });
});
