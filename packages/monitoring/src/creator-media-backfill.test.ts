import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase, type Sql } from '@studio/db';
import type { UpstreamCall } from './bilibili-failure';
import type { ParsedArchiveVideo } from './bilibili-discovery-parse';
import {
  backfillCreatorMedia,
  type CreatorMediaBackfillEffects,
  type CreatorMediaBackfillProvider,
} from './creator-media-backfill';
import type { BinaryTransport } from './image-asset';

const MID = '496445222';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

function video(bvid: string, created: number, pic?: string | null): ParsedArchiveVideo {
  return {
    bvid,
    title: bvid,
    created: BigInt(created),
    mid: MID,
    pic: pic === null ? null : (pic ?? `https://i0.hdslb.com/bfs/archive/${bvid}.jpg`),
  };
}

function silentEffects(): CreatorMediaBackfillEffects {
  return {
    resolveAccount: async () => null,
    cookieHeaderFor: async () => null,
    audit: async () => undefined,
  };
}

function providerFor(
  videos: ParsedArchiveVideo[],
  faceUrl = `https://i0.hdslb.com/bfs/face/${MID}.jpg`,
): CreatorMediaBackfillProvider {
  return {
    async fetchCreatorProfile() {
      const calls: UpstreamCall[] = [
        {
          endpoint: 'web_interface_card',
          statusCode: 200,
          bizCode: 0,
          durationMs: 1,
          error: null,
        },
      ];
      return { faceUrl, uname: 'GOAT前进', calls };
    },
    async fetchCreatorArchives() {
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
        videos,
        calls,
        page: { pn: 1, ps: 50, count: videos.length },
      };
    },
  };
}

function okDownload(hits: { url: string }[]): BinaryTransport {
  return async (request) => {
    hits.push({ url: request.url });
    return {
      status: 200,
      headers: { 'content-type': 'image/png' },
      body: PNG,
      finalUrl: request.url,
    };
  };
}

describe('creator media backfill assetization', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;
  let assetsRoot = '';

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
    assetsRoot = mkdtempSync(join(tmpdir(), 'media-backfill-assets-'));
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

  test('assetizes face + covers on success', async () => {
    if (!sql) return;
    const hits: { url: string }[] = [];
    const now = new Date('2026-10-24T05:00:00.000Z');
    const first = await backfillCreatorMedia({
      sql,
      mid: MID,
      force: true,
      provider: providerFor([
        video('BV1aa411c7mA', 1_700_000_000),
        video('BV1bb411c7mB', 1_700_000_100),
      ]),
      effects: silentEffects(),
      forcedAccountId: null,
      download: okDownload(hits),
      assetsRoot,
      now,
    });
    expect(first.cached).toBe(false);
    expect(first.faceUpdated).toBe(true);
    expect(first.faceAssetId).toBeTruthy();
    expect(first.coversUpdated).toBe(2);
    expect(first.coversAssetized).toBe(2);
    expect(first.coversFailed).toBe(0);
    expect(first.assetsReused).toBe(0);
    expect(hits.length).toBe(3);

    const creator = await sql<{ face_asset_id: string | null; face_url: string | null }[]>`
      SELECT face_asset_id, face_url FROM creators WHERE mid = ${MID}::bigint
    `;
    expect(creator[0]?.face_asset_id).toBe(first.faceAssetId);
    expect(creator[0]?.face_url).toContain('hdslb.com');

    const covers = await sql<
      { bvid: string; cover_asset_id: string | null; cover_state: string }[]
    >`
      SELECT bvid, cover_asset_id, cover_state FROM videos
      WHERE mid = ${MID}::bigint ORDER BY bvid
    `;
    expect(covers).toHaveLength(2);
    expect(covers.every((row) => row.cover_asset_id !== null)).toBe(true);
    expect(covers.every((row) => row.cover_state === 'ok')).toBe(true);

    const assetCount = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM static_assets
    `;
    expect(assetCount[0]?.n).toBeGreaterThanOrEqual(1);
  });

  test('404 on one cover is soft-fail; face and other covers still succeed', async () => {
    if (!sql) return;
    const now = new Date('2026-10-24T06:00:00.000Z');
    const mid = '880880880';
    await sql`
      INSERT INTO creators (mid, uname, monitoring_enabled)
      VALUES (${mid}::bigint, '狐正正', true)
      ON CONFLICT (mid) DO NOTHING
    `;
    const existingTarget = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM monitor_targets
      WHERE "type" = 'creator' AND external_id = ${mid} AND deleted_at IS NULL
    `;
    if ((existingTarget[0]?.n ?? 0) === 0) {
      await sql`
        INSERT INTO monitor_targets (
          id, "type", external_id, label, tags, enabled, interval_minutes, interval_mode, source
        ) VALUES (
          ${crypto.randomUUID()}::uuid,
          'creator',
          ${mid},
          '狐正正',
          '{}',
          true,
          240,
          'fixed',
          'offline'
        )
      `;
    }

    const download: BinaryTransport = async (request) => {
      if (request.url.includes('BV1fail411c7')) {
        return { status: 404, headers: {}, body: new Uint8Array(), finalUrl: request.url };
      }
      return {
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: PNG,
        finalUrl: request.url,
      };
    };

    const result = await backfillCreatorMedia({
      sql,
      mid,
      force: true,
      provider: {
        async fetchCreatorProfile() {
          return {
            faceUrl: `https://i0.hdslb.com/bfs/face/${mid}.jpg`,
            uname: '狐正正',
            calls: [
              {
                endpoint: 'web_interface_card',
                statusCode: 200,
                bizCode: 0,
                durationMs: 1,
                error: null,
              },
            ],
          };
        },
        async fetchCreatorArchives() {
          return {
            videos: [
              {
                ...video('BV1ok411c7mA', 1_700_000_000, 'https://i0.hdslb.com/bfs/archive/ok.jpg'),
                mid,
              },
              {
                ...video(
                  'BV1fail411c7',
                  1_700_000_100,
                  'https://i0.hdslb.com/bfs/archive/BV1fail411c7.jpg',
                ),
                mid,
              },
            ],
            calls: [
              {
                endpoint: 'space_arc_search',
                statusCode: 200,
                bizCode: 0,
                durationMs: 1,
                error: null,
              },
            ],
            page: { pn: 1, ps: 50, count: 2 },
          };
        },
      },
      effects: silentEffects(),
      forcedAccountId: null,
      download,
      assetsRoot,
      now,
    });

    expect(result.faceAssetId).toBeTruthy();
    expect(result.coversAssetized).toBe(1);
    expect(result.coversFailed).toBe(1);
    expect(result.lastError).toBeNull();

    const rows = await sql<
      {
        bvid: string;
        cover_asset_id: string | null;
        cover_state: string;
        metadata_error: string | null;
      }[]
    >`
      SELECT bvid, cover_asset_id, cover_state, metadata_error
      FROM videos WHERE mid = ${mid}::bigint ORDER BY bvid
    `;
    const ok = rows.find((row) => row.bvid === 'BV1ok411c7mA');
    const failed = rows.find((row) => row.bvid === 'BV1fail411c7');
    expect(ok?.cover_asset_id).toBeTruthy();
    expect(ok?.cover_state).toBe('ok');
    expect(failed?.cover_asset_id).toBeNull();
    expect(failed?.cover_state).toBe('failed');
    expect(failed?.metadata_error).toBeTruthy();
  });

  test('force reuses existing assets for the same URL without new rows', async () => {
    if (!sql) return;
    const hits: { url: string }[] = [];
    const now = new Date('2026-10-24T07:00:00.000Z');
    const vids = [video('BV1cc411c7mC', 1_700_000_200)];
    const download = okDownload(hits);

    const first = await backfillCreatorMedia({
      sql,
      mid: MID,
      force: true,
      provider: providerFor(vids),
      effects: silentEffects(),
      forcedAccountId: null,
      download,
      assetsRoot,
      now,
    });
    expect(first.coversAssetized).toBe(1);
    expect(first.faceAssetId).toBeTruthy();

    const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM static_assets`;
    const beforeN = before[0]?.n ?? 0;
    const downloadsBefore = hits.length;

    const second = await backfillCreatorMedia({
      sql,
      mid: MID,
      force: true,
      provider: providerFor(vids),
      effects: silentEffects(),
      forcedAccountId: null,
      download,
      assetsRoot,
      now: new Date(now.getTime() + 60_000),
    });
    expect(second.cached).toBe(false);
    expect(second.assetsReused).toBeGreaterThan(0);
    expect(second.faceAssetId).toBe(first.faceAssetId);
    expect(hits.length).toBe(downloadsBefore);

    const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM static_assets`;
    expect(after[0]?.n).toBe(beforeN);
  });

  test('force re-assetizes historical cover_state=ok rows missing cover_asset_id', async () => {
    if (!sql) return;
    const bvid = 'BV1hist411c7';
    await sql`
      INSERT INTO videos (
        bvid, title, mid, pubdate, monitoring_enabled,
        cover_url, cover_state, cover_asset_id, metadata_state, metadata_source
      ) VALUES (
        ${bvid},
        '历史缺资产',
        ${MID}::bigint,
        ${new Date('2025-01-01T00:00:00.000Z')},
        false,
        ${`https://i0.hdslb.com/bfs/archive/${bvid}.jpg`},
        'ok',
        NULL,
        'ok',
        'bilibili'
      )
      ON CONFLICT (bvid) DO UPDATE SET
        cover_url = EXCLUDED.cover_url,
        cover_state = 'ok',
        cover_asset_id = NULL
    `;
    await sql`
      UPDATE creators SET face_asset_id = NULL, face_url = ${`https://i0.hdslb.com/bfs/face/${MID}.jpg`}
      WHERE mid = ${MID}::bigint
    `;

    const hits: { url: string }[] = [];
    const result = await backfillCreatorMedia({
      sql,
      mid: MID,
      force: true,
      provider: providerFor([video(bvid, 1_700_000_300)]),
      effects: silentEffects(),
      forcedAccountId: null,
      download: okDownload(hits),
      assetsRoot,
      now: new Date('2026-10-24T08:00:00.000Z'),
    });
    expect(result.coversAssetized).toBe(1);
    expect(result.faceAssetId).toBeTruthy();

    const [row] = await sql<{ cover_asset_id: string | null; cover_state: string }[]>`
      SELECT cover_asset_id, cover_state FROM videos WHERE bvid = ${bvid}
    `;
    expect(row?.cover_asset_id).toBeTruthy();
    expect(row?.cover_state).toBe('ok');
  });
});
