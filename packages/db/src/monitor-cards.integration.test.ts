import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  listMonitorCards,
  type MonitorCardRow,
  type Sql,
} from './index';

const IDS = {
  active: 'BV1activ1111',
  paused: 'BV1pausd1111',
  failed: 'BV1errvi1111',
  running: 'BV1runvi1111',
  fresh: 'BV1fresh1111',
  many: 'BV1manyv1111',
  plain: 'BV1unmon1111',
  contract: 'BV1contrac11',
  trap: 'BV1trapv1111',
  other: 'BV1other1111',
  page: 'BV1pagev1111',
} as const;

describe('monitor card read model', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
    const db = sql;
    await db`
      INSERT INTO creators (mid, uname, monitoring_enabled) VALUES
        (810001, '历史UP', true),
        (810002, '采集UP', false)
    `;
    await db`
      INSERT INTO videos (bvid, title, category, monitoring_enabled) VALUES
        (${IDS.active}, '采集中的视频', '游戏', false),
        (${IDS.paused}, '已暂停的视频', '游戏', true),
        (${IDS.failed}, '失败但仍启用', '知识', true),
        (${IDS.running}, '执行中的视频', '知识', false),
        (${IDS.many}, ${'多商单'.repeat(20)}, '商业', true),
        (${IDS.plain}, '仅历史未监控', '生活', true),
        (${IDS.contract}, '只有合同', '生活', true),
        (${IDS.trap}, '链接字段不是关联', '生活', true),
        (${IDS.other}, '合同上的另一个BV', '生活', true),
        (${IDS.page}, '第二页视频', '生活', true)
    `;
    await db`
      INSERT INTO video_metric_samples (
        bvid, sampled_at, source_timezone, raw_time, timestamp_precision, view_count
      ) VALUES
        (${IDS.plain}, '2026-01-01T00:00:00Z', 'Asia/Shanghai', '2026-01-01 08:00', 'minute', 3),
        (${IDS.active}, '2026-02-01T00:00:00Z', 'Asia/Shanghai', '2026-02-01 08:00', 'minute', 9)
    `;
    await db`
      INSERT INTO creator_follower_samples (
        mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count
      ) VALUES
        (810001, '2026-01-02T00:00:00Z', 'Asia/Shanghai', '2026-01-02 08:00', 'minute', 42)
    `;
    await db`
      INSERT INTO monitor_targets (
        id, "type", external_id, label, tags, enabled, interval_minutes, interval_mode,
        next_run_at, last_success_at, last_error, source
      ) VALUES
        ('10000000-0000-4000-8000-000000000001', 'video', ${IDS.active}, '采集中的视频', '{}', true, 15, 'auto', now(), now(), NULL, 'offline'),
        ('10000000-0000-4000-8000-000000000002', 'video', ${IDS.paused}, '已暂停的视频', '{kept}', false, 360, 'fixed', now(), NULL, NULL, 'offline'),
        ('10000000-0000-4000-8000-000000000003', 'video', ${IDS.failed}, '失败但仍启用', '{}', true, 15, 'auto', now(), NULL, '离线失败', 'offline'),
        ('10000000-0000-4000-8000-000000000004', 'video', ${IDS.running}, '执行中的视频', '{}', true, 15, 'auto', now(), NULL, NULL, 'offline'),
        ('10000000-0000-4000-8000-000000000005', 'video', ${IDS.fresh}, '尚无实体', '{}', true, 15, 'auto', NULL, NULL, NULL, 'offline'),
        ('10000000-0000-4000-8000-000000000006', 'video', ${IDS.many}, '多商单', '{}', true, 15, 'auto', now(), NULL, NULL, 'offline'),
        ('10000000-0000-4000-8000-000000000007', 'video', ${IDS.page}, '第二页', '{}', false, 15, 'auto', now(), NULL, NULL, 'offline'),
        ('10000000-0000-4000-8000-000000000008', 'creator', '810002', '采集UP', '{}', true, 240, 'auto', now(), now(), NULL, 'offline'),
        ('10000000-0000-4000-8000-000000000009', 'creator', '810003', '新UP', '{}', true, 240, 'auto', NULL, NULL, NULL, 'offline'),
        ('10000000-0000-4000-8000-000000000010', 'video', ${IDS.plain}, '已删除目标', '{}', true, 15, 'auto', now(), NULL, NULL, 'offline')
    `;
    await db`
      UPDATE monitor_targets
      SET deleted_at = now(), enabled = false
      WHERE id = '10000000-0000-4000-8000-000000000010'
    `;
    await db`
      INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for, started_at) VALUES
        ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'pending', 0, now(), NULL),
        ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'failed', 1, now(), now()),
        ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 'running', 1, now(), now())
    `;
    await db`
      INSERT INTO commercial_projects (id, name) VALUES
        ('30000000-0000-4000-8000-000000000001', '商单甲'),
        ('30000000-0000-4000-8000-000000000002', '商单乙'),
        ('30000000-0000-4000-8000-000000000003', '只在合同'),
        ('30000000-0000-4000-8000-000000000004', '错误链接')
    `;
    await db`
      INSERT INTO project_publish_records (project_id, bvid, published_at, idempotency_key) VALUES
        ('30000000-0000-4000-8000-000000000001', ${IDS.many}, now(), 'card-pub-1'),
        ('30000000-0000-4000-8000-000000000002', ${IDS.many}, now(), 'card-pub-2')
    `;
    await db`
      INSERT INTO project_monitor_contracts (id, project_id, bvid, linked_bvid) VALUES
        ('40000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', ${IDS.many}, NULL),
        ('40000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000002', ${IDS.many}, NULL),
        ('40000000-0000-4000-8000-000000000003', '30000000-0000-4000-8000-000000000003', ${IDS.contract}, NULL),
        ('40000000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000004', ${IDS.other}, ${IDS.trap})
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

  test('keeps target state across pages and ignores monitoring_enabled', async () => {
    if (!sql) return;
    const full = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: null,
    });
    expect(full.items.some((item) => item.externalId === IDS.fresh && !item.hasEntity)).toBe(true);
    expect(full.items.find((item) => item.externalId === IDS.plain)?.enabled).toBeNull();
    expect(full.items.find((item) => item.externalId === IDS.active)?.enabled).toBe(true);
    const legacy = full.items.find((item) => item.externalId === IDS.plain);
    expect(legacy?.hasEntity).toBe(true);
    expect(legacy?.targetId).toBeNull();

    const page1 = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 2,
      q: null,
      category: null,
    });
    const page2 = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 2,
      pageSize: 2,
      q: null,
      category: null,
    });
    expect(page1.totalItems).toBe(full.totalItems);
    expect(page2.totalItems).toBe(full.totalItems);
    expect(page1.totalItems).toBeGreaterThan(2);
    expect(page2.items.length).toBe(2);
    const seen = [...page1.items, ...page2.items];
    expect(seen.map((item) => item.externalId)).toEqual(
      full.items.slice(0, 4).map((item) => item.externalId),
    );
    for (const item of page2.items) {
      const match = full.items.find((row) => row.externalId === item.externalId) as MonitorCardRow;
      expect(item.enabled).toBe(match.enabled);
      expect(item.hasRunning).toBe(match.hasRunning);
      expect(item.hasPending).toBe(match.hasPending);
      expect(item.lastError).toBe(match.lastError);
    }
    expect(page2.items.some((item) => item.targetId)).toBe(true);

    const active = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'active',
      page: 1,
      pageSize: 50,
      q: null,
      category: null,
    });
    const paused = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'paused',
      page: 1,
      pageSize: 50,
      q: null,
      category: null,
    });
    const unmonitored = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'unmonitored',
      page: 1,
      pageSize: 50,
      q: null,
      category: null,
    });
    expect(active.totalItems + paused.totalItems + unmonitored.totalItems).toBe(full.totalItems);
    expect(unmonitored.items.some((item) => item.externalId === IDS.plain)).toBe(true);
    expect(active.items.some((item) => item.externalId === IDS.active)).toBe(true);
    expect(paused.items.map((item) => item.externalId).sort()).toEqual(
      [IDS.page, IDS.paused].sort(),
    );

    const found = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 8,
      q: '尚无实体',
      category: null,
    });
    expect(found.totalItems).toBe(1);
    expect(found.items[0]?.externalId).toBe(IDS.fresh);
    expect(found.items[0]?.hasSamples).toBe(false);

    const category = await listMonitorCards(db(), {
      type: 'video',
      monitor: 'all',
      page: 1,
      pageSize: 50,
      q: null,
      category: '商业',
    });
    expect(category.items.map((item) => item.externalId)).toEqual([IDS.many]);

    const many = full.items.find((item) => item.externalId === IDS.many);
    expect(many?.projects.map((project) => project.name).sort()).toEqual(
      ['商单乙', '商单甲'].sort(),
    );
    const contract = full.items.find((item) => item.externalId === IDS.contract);
    expect(contract?.projects.map((project) => project.id)).toEqual([
      '30000000-0000-4000-8000-000000000003',
    ]);
    const trap = full.items.find((item) => item.externalId === IDS.trap);
    expect(trap?.projects).toEqual([]);
    const other = full.items.find((item) => item.externalId === IDS.other);
    expect(other?.projects.map((project) => project.name)).toEqual(['错误链接']);

    const running = full.items.find((item) => item.externalId === IDS.running);
    expect(running?.hasRunning).toBe(true);
    expect(running?.enabled).toBe(true);
    const waiting = full.items.find((item) => item.externalId === IDS.active);
    expect(waiting?.hasPending).toBe(true);
    const failed = full.items.find((item) => item.externalId === IDS.failed);
    expect(failed?.lastError).toBe('离线失败');
    expect(failed?.hasPending).toBe(false);
    expect(failed?.enabled).toBe(true);

    const creators = await listMonitorCards(db(), {
      type: 'creator',
      monitor: 'all',
      page: 1,
      pageSize: 20,
      q: null,
      category: null,
    });
    expect(creators.totalItems).toBe(3);
    const historical = creators.items.find((item) => item.externalId === '810001');
    expect(historical?.targetId).toBeNull();
    expect(historical?.hasSamples).toBe(true);
    expect(historical?.followerCount).toBe('42');
    expect(historical?.projects).toEqual([]);
    const freshCreator = creators.items.find((item) => item.externalId === '810003');
    expect(freshCreator?.hasEntity).toBe(false);
    expect(freshCreator?.title).toBeNull();
    expect(freshCreator?.targetLabel).toBe('新UP');
  });
});
