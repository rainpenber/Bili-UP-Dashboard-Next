import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  createIsolatedTestDatabase,
  dropIsolatedTestDatabase,
  insertCreatorPublishEvent,
  insertMonitorTarget,
  type Sql,
} from '@studio/db';
import type { UpstreamCall } from './bilibili-failure';
import type { ParsedSpaceDynamic } from './bilibili-discovery-parse';
import {
  CREATOR_DYNAMICS_SYNC_TTL_MS,
  readCreatorDynamicsSyncStatus,
  syncCreatorDynamics,
  type CreatorDynamicsPageProvider,
  type CreatorDynamicsSyncEffects,
} from './creator-dynamics-sync';

const MID = '3493141386627335';

function dyn(id: string, sec: number, title: string): ParsedSpaceDynamic {
  return { dynamicId: id, publishedAtSec: BigInt(sec), title, text: title };
}

describe('creator dynamics sync', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
    await insertMonitorTarget(sql, {
      id: crypto.randomUUID(),
      type: 'creator',
      externalId: MID,
      label: '狐正正',
      tags: [],
      intervalMinutes: 240,
      intervalMode: 'auto',
      now: new Date(),
    });
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('writes dynamic publish events and respects TTL cache', async () => {
    if (!sql) return;
    let pages = 0;
    const provider: CreatorDynamicsPageProvider = {
      async fetchCreatorDynamics() {
        pages += 1;
        const calls: UpstreamCall[] = [
          {
            endpoint: 'space_dynamic_feed',
            statusCode: 200,
            bizCode: 0,
            durationMs: 1,
            error: null,
          },
        ];
        return {
          dynamics: [
            dyn('900000000000000001', 1_700_000_001, '动态甲正文'),
            dyn('900000000000000002', 1_700_000_002, '动态乙正文'),
            dyn('900000000000000003', 1_700_000_003, '动态丙正文'),
          ],
          calls,
          offset: null,
          hasMore: false,
        };
      },
    };
    const effects: CreatorDynamicsSyncEffects = {
      resolveAccount: async () => null,
      cookieHeaderFor: async () => null,
      audit: async () => undefined,
    };
    const first = await syncCreatorDynamics({
      sql,
      mid: MID,
      force: false,
      provider,
      effects,
      forcedAccountId: null,
    });
    expect(first.cached).toBe(false);
    expect(first.createdCount).toBe(3);
    expect(first.dynamicCount).toBe(3);
    expect(pages).toBe(1);

    const status = await readCreatorDynamicsSyncStatus(sql, MID);
    expect(status.stale).toBe(false);
    expect(status.ttlMs).toBe(CREATOR_DYNAMICS_SYNC_TTL_MS);

    const second = await syncCreatorDynamics({
      sql,
      mid: MID,
      force: false,
      provider,
      effects,
      forcedAccountId: null,
    });
    expect(second.cached).toBe(true);
    expect(second.pagesFetched).toBe(0);
    expect(pages).toBe(1);

    const rows = await sql<{ n: string }[]>`
      SELECT count(*)::text AS n FROM creator_publish_events
      WHERE mid = ${MID} AND event_kind = 'dynamic' AND source = 'bilibili'
    `;
    expect(Number(rows[0]?.n)).toBe(3);
  });

  test('skips AV dynamic when the same bvid already has a video event', async () => {
    if (!sql) return;
    const now = new Date('2026-10-24T00:00:00.000Z');
    const bvid = 'BV1xx411c7mZ';
    await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: MID,
      eventKind: 'video',
      externalId: bvid,
      publishedAt: new Date('2026-10-24T00:00:00.000Z'),
      titleSnapshot: '视频标题',
      firstDiscoveredAt: now,
      source: 'bilibili',
    });
    const provider: CreatorDynamicsPageProvider = {
      async fetchCreatorDynamics() {
        return {
          dynamics: [
            {
              dynamicId: '900000000000000010',
              publishedAtSec: 1_700_000_010n,
              title: '动态正文',
              text: '动态正文',
              bvid,
            },
            {
              dynamicId: '900000000000000011',
              publishedAtSec: 1_700_000_011n,
              title: '普通图文',
              text: '普通图文',
            },
          ],
          calls: [],
          offset: null,
          hasMore: false,
        };
      },
    };
    const result = await syncCreatorDynamics({
      sql,
      mid: MID,
      force: true,
      provider,
      effects: {
        resolveAccount: async () => null,
        cookieHeaderFor: async () => null,
        audit: async () => undefined,
      },
      forcedAccountId: null,
      now,
    });
    expect(result.createdCount).toBe(1);
    expect(result.skippedDuplicates).toBe(1);

    const rows = await sql<{ external_id: string; related_bvid: string | null }[]>`
      SELECT external_id, related_bvid
      FROM creator_publish_events
      WHERE mid = ${MID}
        AND event_kind = 'dynamic'
        AND external_id IN ('900000000000000010', '900000000000000011')
      ORDER BY external_id
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.external_id).toBe('900000000000000011');
    expect(rows[0]?.related_bvid).toBeNull();
  });
});
