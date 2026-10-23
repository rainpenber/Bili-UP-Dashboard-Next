import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  getCreatorDiscoveryConfig,
  getVideoDenseCollectPlan,
  insertMonitorTarget,
  listCreatorPublishEvents,
  resolveDenseCollectMinutes,
  upsertCreatorDiscoveryConfig,
  type Sql,
} from '@studio/db';
import { applyDiscoveryRound } from './discovery-job';
import { installOfflineFetchGuard } from './network-guard';

installOfflineFetchGuard();

const MID = '10001';

describe('creator content discovery (offline)', () => {
  let sql: Sql | null = null;
  const created: string[] = [];

  beforeAll(async () => {
    const db = await createIsolatedTestDatabase();
    if (!db) return;
    created.push(db.databaseName);
    sql = db.sql;
    await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'creator',
      externalId: MID,
      label: '测试UP',
      tags: [],
      intervalMinutes: 240,
      intervalMode: 'auto',
      now: new Date('2026-10-23T00:00:00.000Z'),
    });
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    for (const name of created) await dropIsolatedTestDatabase(name).catch(() => undefined);
  });

  test('first success seeds watermark without historical events', async () => {
    if (!sql) return;
    const now = new Date('2026-10-23T01:00:00.000Z');
    await upsertCreatorDiscoveryConfig(sql, {
      mid: MID,
      enabled: true,
      discoverVideos: true,
      discoverDynamics: true,
      monitorNewVideos: true,
      now,
    });
    const config = await getCreatorDiscoveryConfig(sql, MID);
    expect(config?.enabled).toBe(true);

    const summary = await applyDiscoveryRound(sql, {
      config: (await getCreatorDiscoveryConfig(sql, MID))!,
      now,
      videos: [
        { bvid: 'BV1xx411c7mD', title: '旧视频', created: 1_700_000_000n, mid: MID },
        { bvid: 'BV1xx411c7mE', title: '旧视频2', created: 1_700_000_100n, mid: MID },
      ],
      dynamics: [{ dynamicId: '9001', publishedAtSec: 1_700_000_050n, title: '旧动态' }],
    });
    expect(summary.seededVideoWatermark).toBe(true);
    expect(summary.seededDynamicWatermark).toBe(true);
    expect(summary.videoEventsCreated).toBe(0);
    expect(summary.dynamicEventsCreated).toBe(0);
    const events = await listCreatorPublishEvents(sql, { mid: MID, limit: 50 });
    expect(events.totalItems).toBe(0);
  });

  test('newer mixed video/dynamic events are idempotent and cap auto-create at 2', async () => {
    if (!sql) return;
    const now = new Date('2026-10-23T02:00:00.000Z');
    const config = (await getCreatorDiscoveryConfig(sql, MID))!;
    const round1 = await applyDiscoveryRound(sql, {
      config,
      now,
      videos: [
        { bvid: 'BV1xx411c7mA', title: '新1', created: 1_700_100_001n, mid: MID },
        { bvid: 'BV1xx411c7mB', title: '新2', created: 1_700_100_002n, mid: MID },
        { bvid: 'BV1xx411c7mC', title: '新3', created: 1_700_100_003n, mid: MID },
      ],
      dynamics: [{ dynamicId: '9100', publishedAtSec: 1_700_100_010n, title: '新动态' }],
    });
    expect(round1.videoEventsCreated).toBe(3);
    expect(round1.dynamicEventsCreated).toBe(1);
    expect(round1.targetsCreated).toBe(2);
    expect(round1.targetsSuppressed).toBe(1);

    const after = (await getCreatorDiscoveryConfig(sql, MID))!;
    const round2 = await applyDiscoveryRound(sql, {
      config: after,
      now: new Date('2026-10-23T02:05:00.000Z'),
      videos: [
        { bvid: 'BV1xx411c7mA', title: '新1', created: 1_700_100_001n, mid: MID },
        { bvid: 'BV1xx411c7mB', title: '新2', created: 1_700_100_002n, mid: MID },
        { bvid: 'BV1xx411c7mC', title: '新3', created: 1_700_100_003n, mid: MID },
      ],
      dynamics: [{ dynamicId: '9100', publishedAtSec: 1_700_100_010n, title: '新动态' }],
    });
    expect(round2.videoEventsCreated).toBe(0);
    expect(round2.dynamicEventsCreated).toBe(0);
    expect(round2.targetsCreated).toBe(0);

    const events = await listCreatorPublishEvents(sql, { mid: MID, limit: 50 });
    expect(events.totalItems).toBe(4);
    expect(events.items.filter((e) => e.eventKind === 'dynamic')).toHaveLength(1);

    const db = sql;
    const plans = await Promise.all(
      events.items
        .filter((e) => e.eventKind === 'video' && e.monitoredTargetId)
        .map((e) => getVideoDenseCollectPlan(db, e.monitoredTargetId!)),
    );
    expect(plans.filter(Boolean).length).toBe(2);
  });

  test('dense plan switches 15 → 30 → normal from stored timestamps', () => {
    const activatedAt = new Date('2026-10-01T00:00:00.000Z');
    const plan = {
      targetId: '00000000-0000-4000-8000-000000000001',
      phase: 'dense15' as const,
      activatedAt,
      dense15Until: new Date(activatedAt.getTime() + 5 * 86_400_000),
      dense30Until: new Date(activatedAt.getTime() + 10 * 86_400_000),
      completedAt: null,
      createdAt: activatedAt,
      updatedAt: activatedAt,
    };
    expect(resolveDenseCollectMinutes(plan, new Date('2026-10-03T00:00:00.000Z')).minutes).toBe(15);
    expect(resolveDenseCollectMinutes(plan, new Date('2026-10-07T00:00:00.000Z')).minutes).toBe(30);
    expect(resolveDenseCollectMinutes(plan, new Date('2026-10-12T00:00:00.000Z')).phase).toBe(
      'normal',
    );
  });

  test('disabling discovery stops enabling without deleting events', async () => {
    if (!sql) return;
    const before = await listCreatorPublishEvents(sql, { mid: MID, limit: 50 });
    expect(before.totalItems).toBeGreaterThan(0);
    await upsertCreatorDiscoveryConfig(sql, {
      mid: MID,
      enabled: false,
      discoverVideos: false,
      discoverDynamics: false,
      monitorNewVideos: false,
      now: new Date('2026-10-23T03:00:00.000Z'),
    });
    const config = await getCreatorDiscoveryConfig(sql, MID);
    expect(config?.enabled).toBe(false);
    const after = await listCreatorPublishEvents(sql, { mid: MID, limit: 50 });
    expect(after.totalItems).toBe(before.totalItems);
  });
});
