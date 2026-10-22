import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  getStudioOwnerAccount,
  listMonitorCards,
  runMigrations,
  setVideoPinned,
  updateStudioOwnerAccount,
  type Sql,
} from './index';
import { DEFAULT_STUDIO_OWNER_MID } from './studio-owner-account';

const MINE = DEFAULT_STUDIO_OWNER_MID;
const OTHER_SAME_NAME = '1000000000000001';
const UNKNOWN = '2000000000000002';

const IDS = {
  mineOld: 'BV1mineold11',
  mineNew: 'BV1minenew11',
  mineMid: 'BV1minemid11',
  otherNamed: 'BV1othernm11',
  otherPinned: 'BV1otherpin1',
  nullMid: 'BV1nullmid11',
} as const;

describe('studio owner account + only-mine filter', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
    const applied = await runMigrations(sql);
    expect(applied.includes('015_studio_owner_account') || applied.length === 0).toBe(true);
    expect((await runMigrations(sql)).length).toBe(0);

    await sql`
      INSERT INTO creators (mid, uname, category) VALUES
        (${MINE}::bigint, '狐正正', '默认'),
        (${OTHER_SAME_NAME}::bigint, '狐正正', '默认')
    `;
    await sql`
      INSERT INTO videos (bvid, mid, title, category, monitoring_enabled, pubdate, pinned_at) VALUES
        (${IDS.mineOld}, ${MINE}::bigint, '我的旧', '游戏', true, '2024-01-01T00:00:00Z', NULL),
        (${IDS.mineNew}, ${MINE}::bigint, '我的新', '游戏', true, '2026-01-01T00:00:00Z', NULL),
        (${IDS.mineMid}, ${MINE}::bigint, '我的中', '游戏', true, '2025-06-01T00:00:00Z', '2026-02-01T00:00:00Z'),
        (${IDS.otherNamed}, ${OTHER_SAME_NAME}::bigint, '同名他人', '游戏', true, '2025-12-01T00:00:00Z', NULL),
        (${IDS.otherPinned}, ${OTHER_SAME_NAME}::bigint, '他人置顶', '游戏', true, '2023-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
        (${IDS.nullMid}, NULL, '无归属', '游戏', true, '2025-03-01T00:00:00Z', NULL)
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

  test('migration seeds default 狐正正 and does not overwrite updates', async () => {
    if (!sql) return;
    const seeded = await getStudioOwnerAccount(db());
    expect(seeded?.mid).toBe(MINE);
    expect(seeded?.displayName).toBe('狐正正');

    await updateStudioOwnerAccount(db(), { mid: OTHER_SAME_NAME, displayName: '临时改名' });
    expect((await runMigrations(db())).length).toBe(0);
    const kept = await getStudioOwnerAccount(db());
    expect(kept?.mid).toBe(OTHER_SAME_NAME);
    expect(kept?.displayName).toBe('临时改名');

    await updateStudioOwnerAccount(db(), { mid: MINE, displayName: '狐正正' });
  });

  test('onlyMine filters by mid before count/sort/page; same nickname different mid excluded', async () => {
    if (!sql) return;
    const all = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: '游戏',
      sort: 'published_desc',
    });
    expect(all.totalItems).toBe(6);

    const mine = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: '游戏',
      sort: 'published_desc',
      ownerMid: MINE,
    });
    expect(mine.totalItems).toBe(3);
    expect(mine.items.map((item) => item.externalId)).toEqual([
      IDS.mineMid,
      IDS.mineNew,
      IDS.mineOld,
    ]);
    expect(mine.items.every((item) => item.mid === MINE)).toBe(true);
    expect(mine.items.some((item) => item.externalId === IDS.otherNamed)).toBe(false);
  });

  test('pagination uses filtered total; pin sort still applies within mine set', async () => {
    if (!sql) return;
    const page1 = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 2,
      q: null,
      category: '游戏',
      sort: 'published_asc',
      ownerMid: MINE,
    });
    expect(page1.totalItems).toBe(3);
    expect(page1.items.map((item) => item.externalId)).toEqual([IDS.mineMid, IDS.mineOld]);

    const page2 = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 2,
      pageSize: 2,
      q: null,
      category: '游戏',
      sort: 'published_asc',
      ownerMid: MINE,
    });
    expect(page2.totalItems).toBe(3);
    expect(page2.items.map((item) => item.externalId)).toEqual([IDS.mineNew]);

    await setVideoPinned(db(), IDS.mineOld, true);
    const afterPin = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: '游戏',
      sort: 'published_desc',
      ownerMid: MINE,
    });
    expect(afterPin.items.map((item) => item.externalId)).toEqual([
      IDS.mineMid,
      IDS.mineOld,
      IDS.mineNew,
    ]);
    await setVideoPinned(db(), IDS.mineOld, false);
  });

  test('unknown owner mid yields empty filtered set; creators ignore ownerMid', async () => {
    if (!sql) return;
    const empty = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 8,
      q: null,
      category: null,
      sort: 'published_desc',
      ownerMid: UNKNOWN,
    });
    expect(empty.totalItems).toBe(0);
    expect(empty.items).toEqual([]);

    const creators = await listMonitorCards(db(), {
      type: 'creator',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: null,
      ownerMid: MINE,
    });
    expect(creators.totalItems).toBeGreaterThanOrEqual(2);
  });

  test('changing configured mid changes filtered totals', async () => {
    if (!sql) return;
    await updateStudioOwnerAccount(db(), { mid: OTHER_SAME_NAME, displayName: '同名他人' });
    const other = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: '游戏',
      sort: 'published_desc',
      ownerMid: OTHER_SAME_NAME,
    });
    expect(other.totalItems).toBe(2);
    expect(other.items.every((item) => item.mid === OTHER_SAME_NAME)).toBe(true);
    await updateStudioOwnerAccount(db(), { mid: MINE, displayName: '狐正正' });
  });
});
