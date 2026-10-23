import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  listMonitorCards,
  listMonitorSearchSuggestions,
  type Sql,
} from './index';

describe('monitor search suggestions + q creator/category match', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
    const db = sql;
    await db`
      INSERT INTO creators (mid, uname, category, monitoring_enabled) VALUES
        (910001, '可读UP主甲', '知识', true),
        (910002, '可读UP主乙', '游戏', true)
    `;
    await db`
      INSERT INTO videos (bvid, mid, title, category, monitoring_enabled) VALUES
        ('BV1srchaaaaa', 910001, '可读视频标题甲', '知识', true),
        ('BV1srchbbbbb', 910002, '另一条视频', '游戏', true),
        ('BV1srchccccc', 910001, '前缀特殊_%后缀', '生活', true)
    `;
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  function db(): Sql {
    if (!sql) throw new Error('sql unavailable');
    return sql;
  }

  test('suggestions return readable labels for title, UP name, category, BV and MID', async () => {
    if (!sql) return;
    const byTitle = await listMonitorSearchSuggestions(db(), {
      q: '可读视频',
      type: 'video',
      limit: 5,
    });
    expect(byTitle.videos[0]?.label).toBe('可读视频标题甲');
    expect(byTitle.videos[0]?.value).toBe('BV1srchaaaaa');
    expect(byTitle.videos[0]?.secondary).toBe('可读UP主甲');
    expect(byTitle.videos[0]?.secondary).not.toContain('BV');

    const byBv = await listMonitorSearchSuggestions(db(), {
      q: 'BV1srchaaaaa',
      type: 'video',
      limit: 5,
    });
    expect(byBv.videos[0]?.label).toBe('可读视频标题甲');
    expect(byBv.videos[0]?.label).not.toBe('BV1srchaaaaa');
    expect(byBv.videos[0]?.secondary).toBe('可读UP主甲');
    expect(byBv.videos[0]?.value).toBe('BV1srchaaaaa');
    expect(byBv.videos[0]?.secondary).not.toContain('BV');

    const byUp = await listMonitorSearchSuggestions(db(), {
      q: '可读UP主甲',
      type: 'video',
      limit: 5,
    });
    expect(byUp.creators.some((item) => item.label === '可读UP主甲')).toBe(true);
    expect(byUp.creators.every((item) => item.secondary === 'UP 主')).toBe(true);
    expect(byUp.videos.some((item) => item.label === '可读视频标题甲')).toBe(true);

    const byMid = await listMonitorSearchSuggestions(db(), {
      q: '910001',
      type: 'video',
      limit: 5,
    });
    expect(byMid.creators[0]?.label).toBe('可读UP主甲');
    expect(byMid.creators[0]?.secondary).toBe('UP 主');
    expect(byMid.creators[0]?.value).toBe('910001');
    expect(byMid.creators[0]?.secondary).not.toContain('910001');

    const byCategory = await listMonitorSearchSuggestions(db(), {
      q: '知',
      type: 'video',
      limit: 5,
    });
    expect(byCategory.categories.some((item) => item.label === '知识')).toBe(true);

    const limited = await listMonitorSearchSuggestions(db(), {
      q: '视频',
      type: 'video',
      limit: 1,
    });
    expect(limited.videos.length).toBeLessThanOrEqual(1);
    expect(limited.creators.length).toBeLessThanOrEqual(1);
    expect(limited.categories.length).toBeLessThanOrEqual(1);
  });

  test('LIKE metacharacters are escaped and cards q matches creator name + category', async () => {
    if (!sql) return;
    const escaped = await listMonitorSearchSuggestions(db(), {
      q: '特殊_%',
      type: 'video',
      limit: 5,
    });
    expect(escaped.videos.map((item) => item.value)).toEqual(['BV1srchccccc']);

    const byCreatorName = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 20,
      q: '可读UP主甲',
      category: null,
    });
    expect(byCreatorName.items.map((item) => item.externalId).sort()).toEqual(
      ['BV1srchaaaaa', 'BV1srchccccc'].sort(),
    );

    const byCategoryQ = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 20,
      q: '游戏',
      category: null,
    });
    expect(byCategoryQ.items.map((item) => item.externalId)).toEqual(['BV1srchbbbbb']);

    const byMid = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 20,
      q: '910002',
      category: null,
    });
    expect(byMid.items.map((item) => item.externalId)).toEqual(['BV1srchbbbbb']);
  });
});
