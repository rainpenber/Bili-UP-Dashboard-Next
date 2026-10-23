import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase, type Sql } from '@studio/db';
import type { UpstreamCall } from './bilibili-failure';
import type { ParsedArchiveVideo } from './bilibili-discovery-parse';
import {
  CREATOR_UPLOADS_SYNC_TTL_MS,
  readCreatorUploadsSyncStatus,
  syncCreatorUploads,
  type CreatorArchivesPageProvider,
  type CreatorUploadsSyncEffects,
} from './creator-uploads-sync';

const MID = '496445222';

function video(bvid: string, created: number, title = bvid): ParsedArchiveVideo {
  return { bvid, title, created: BigInt(created), mid: MID };
}

type CountingProvider = CreatorArchivesPageProvider & { readonly hitCount: number };

function mockProvider(pages: ParsedArchiveVideo[][]): CountingProvider {
  let hits = 0;
  return {
    async fetchCreatorArchives(input) {
      hits += 1;
      const pn = input.pn ?? 1;
      const list = pages[pn - 1] ?? [];
      const calls: UpstreamCall[] = [
        {
          endpoint: 'space_arc_search',
          statusCode: 200,
          bizCode: 0,
          durationMs: 1,
          error: null,
        },
      ];
      return {
        videos: list,
        calls,
        page: { pn, ps: input.ps ?? 50, count: pages.flat().length },
      };
    },
    get hitCount() {
      return hits;
    },
  };
}

function silentEffects(): CreatorUploadsSyncEffects {
  return {
    resolveAccount: async () => null,
    cookieHeaderFor: async () => null,
    audit: async () => undefined,
  };
}

describe('creator uploads sync', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    if (!sql) return;
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
  }, 60_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('writes videos + bilibili events; second call is cached; force refreshes', async () => {
    if (!sql) return;
    const now = new Date('2026-10-23T12:00:00.000Z');
    const provider = mockProvider([
      [video('BV1aa411c7mA', 1_700_000_000, '片A'), video('BV1bb411c7mB', 1_700_000_100, '片B')],
    ]);

    const first = await syncCreatorUploads({
      sql,
      mid: MID,
      force: false,
      provider,
      effects: silentEffects(),
      forcedAccountId: null,
      now,
    });
    expect(first.cached).toBe(false);
    expect(first.videoCount).toBe(2);
    expect(first.eventsCreated).toBe(2);
    expect(first.pagesFetched).toBe(1);
    expect(provider.hitCount).toBe(1);

    const videos = await sql<{ bvid: string; monitoring_enabled: boolean }[]>`
      SELECT bvid, monitoring_enabled FROM videos WHERE mid = ${MID}::bigint ORDER BY bvid
    `;
    expect(videos.map((row) => row.bvid)).toEqual(['BV1aa411c7mA', 'BV1bb411c7mB']);
    expect(videos.every((row) => row.monitoring_enabled === false)).toBe(true);

    const events = await sql<{ source: string; external_id: string }[]>`
      SELECT source, external_id FROM creator_publish_events
      WHERE mid = ${MID} AND event_kind = 'video'
      ORDER BY external_id
    `;
    expect(events).toHaveLength(2);
    expect(events.every((row) => row.source === 'bilibili')).toBe(true);

    const second = await syncCreatorUploads({
      sql,
      mid: MID,
      force: false,
      provider,
      effects: silentEffects(),
      forcedAccountId: null,
      now: new Date(now.getTime() + 60_000),
    });
    expect(second.cached).toBe(true);
    expect(second.pagesFetched).toBe(0);
    expect(provider.hitCount).toBe(1);

    const status = await readCreatorUploadsSyncStatus(sql, MID, now);
    expect(status.stale).toBe(false);
    expect(status.videoCount).toBe(2);

    const staleStatus = await readCreatorUploadsSyncStatus(
      sql,
      MID,
      new Date(now.getTime() + CREATOR_UPLOADS_SYNC_TTL_MS + 1),
    );
    expect(staleStatus.stale).toBe(true);

    const forced = await syncCreatorUploads({
      sql,
      mid: MID,
      force: true,
      provider: mockProvider([[video('BV1aa411c7mA', 1_700_000_000, '片A')]]),
      effects: silentEffects(),
      forcedAccountId: null,
      now: new Date(now.getTime() + 120_000),
    });
    expect(forced.cached).toBe(false);
    expect(forced.eventsCreated).toBe(0);
    expect(forced.videoCount).toBe(1);
  });

  test('does not overwrite manual publish events', async () => {
    if (!sql) return;
    const bvid = 'BV1cc411c7mC';
    await sql`
      INSERT INTO creator_publish_events (
        id, mid, event_kind, external_id, published_at, title_snapshot,
        first_discovered_at, source
      ) VALUES (
        ${crypto.randomUUID()}::uuid,
        ${MID},
        'video',
        ${bvid},
        ${new Date('2026-01-01T00:00:00.000Z')},
        '手动标题',
        ${new Date('2026-01-01T00:00:00.000Z')},
        'manual'
      )
    `;
    const result = await syncCreatorUploads({
      sql,
      mid: MID,
      force: true,
      provider: mockProvider([[video(bvid, 1_700_000_200, '上游标题')]]),
      effects: silentEffects(),
      forcedAccountId: null,
      now: new Date('2026-10-23T18:00:00.000Z'),
    });
    expect(result.eventsCreated).toBe(0);
    const [row] = await sql<{ source: string; title_snapshot: string }[]>`
      SELECT source, title_snapshot FROM creator_publish_events
      WHERE mid = ${MID} AND external_id = ${bvid}
    `;
    expect(row?.source).toBe('manual');
    expect(row?.title_snapshot).toBe('手动标题');
  });

  test('caps at 100 videos across at most 3 pages', async () => {
    if (!sql) return;
    const validBvid = (n: number) => {
      const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
      let s = 'BV1';
      let x = n + 1000;
      for (let i = 0; i < 9; i += 1) {
        s += alphabet[x % alphabet.length]!;
        x = Math.floor(x / alphabet.length) + 17;
      }
      return s;
    };
    const p1 = Array.from({ length: 50 }, (_, i) => video(validBvid(i), 1_700_000_000 + i));
    const p2 = Array.from({ length: 50 }, (_, i) => video(validBvid(50 + i), 1_700_000_050 + i));
    const p3 = Array.from({ length: 50 }, (_, i) => video(validBvid(100 + i), 1_700_000_100 + i));
    const provider = mockProvider([p1, p2, p3]);
    const result = await syncCreatorUploads({
      sql,
      mid: MID,
      force: true,
      provider,
      effects: silentEffects(),
      forcedAccountId: null,
      now: new Date('2026-10-24T00:00:00.000Z'),
    });
    expect(result.videoCount).toBe(100);
    expect(result.pagesFetched).toBeLessThanOrEqual(3);
    expect(provider.hitCount).toBe(2);
  });
});
