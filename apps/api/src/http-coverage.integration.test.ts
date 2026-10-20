import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseCommercialDefaultTemplate,
  parseCommercialNodeWriteResponse,
  parseCommercialOpenItemWriteResponse,
  parseCommercialProjectDetail,
  parseCommercialProjectList,
  parseCommercialProjectWorkflow,
  parseCommercialPublishResponse,
  parseCommercialStepResponse,
  parseCommercialWriteError,
  parseHealthResponse,
  parseMetadataRunResponse,
  parseMonitorTargetCreateResponse,
  parseMonitorTargetList,
  parseVideoRefreshResponse,
} from '@studio/contracts';
import { createRetainedTestDatabase, writeVideoSample, type Sql } from '@studio/db';
import {
  createMonitorProvider,
  runCollectorOnce,
  type CollectorConfig,
  type HttpTransport,
} from '@studio/monitoring';
import { createApp, type ApiRequestObservation } from './app';
import {
  buildHttpCoverageReport,
  renderHttpCoverageMarkdown,
  type TestOutcome,
} from './http-coverage-report';
import { mountApiRoutes } from './mount-api';
import { listRegisteredApiRoutes, routeKey } from './route-catalog';

const MOCK_ROOT = join(import.meta.dir, '../../../packages/monitoring/fixtures/mock-data');
const REPORT_JSON = join(import.meta.dir, '../../../docs/architecture/http-coverage.json');
const REPORT_MD = join(import.meta.dir, '../../../docs/architecture/http-coverage.md');
const INVENTORY_PATH = join(import.meta.dir, '../../../docs/architecture/api-inventory.json');
const DEFAULT_TEMPLATE = 'ffff1111-1111-4111-8111-111111111111';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

type Hit = ApiRequestObservation & { test: string };
type InventoryCaller = { file: string; evidence: string };

const hits: Hit[] = [];
const testOutcomes = new Map<string, TestOutcome>();
const injectedUrls: string[] = [];
const outboundFetches: string[] = [];
let currentTest = 'setup';
let sql: Sql | null = null;
let databaseName = '';
let app: ReturnType<typeof createApp> | null = null;
let releaseGate: (() => void) | null = null;
let gatePromise: Promise<void> | null = null;
const backfills: Promise<void>[] = [];
const nativeFetch = globalThis.fetch;

function holdGate(): void {
  gatePromise = new Promise((resolve) => {
    releaseGate = resolve;
  });
}

function openGate(): void {
  releaseGate?.();
  releaseGate = null;
  gatePromise = null;
}

function detail(bvid: string) {
  return {
    code: 0,
    message: '0',
    data: {
      View: {
        bvid,
        cid: 55,
        title: `已拉取 ${bvid}`,
        pubdate: 1_720_000_000,
        duration: 10,
        desc: 'd',
        tname: '生活',
        tname_v2: '日常',
        tid: 95,
        tid_v2: 2102,
        pic: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
        owner: { mid: 7, name: 'UP' },
      },
      Tags: [{ tag_name: '标签' }],
      Card: { card: JSON.stringify({ name: 'UP' }) },
    },
  };
}

function fastConfig(instanceId: string): CollectorConfig {
  return {
    pollMs: 20,
    maxAttempts: 3,
    backoffBaseMs: 0,
    backoffCapMs: 0,
    rateLimitMs: 0,
    instanceId,
  };
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  return text ? (JSON.parse(text) as unknown) : null;
}

async function expectStatus(res: Response, status: number): Promise<unknown> {
  const body = await readJson(res);
  if (res.status !== status) {
    throw new Error(`expected ${status}, got ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

function testChecked(
  title: string,
  id: string,
  fn: () => Promise<void> | void,
  timeout?: number,
): void {
  test(
    title,
    async () => {
      currentTest = id;
      try {
        await fn();
        testOutcomes.set(id, 'passed');
      } catch (error) {
        testOutcomes.set(id, 'failed');
        throw error;
      }
    },
    timeout,
  );
}

function json(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  if (!app) throw new Error('app missing');
  return app.request(path, init);
}

describe('HTTP API coverage against isolated Postgres', () => {
  beforeAll(async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      outboundFetches.push(url);
      if (/bilibili\.(com|tv)/i.test(url) || /hdslb\.com/i.test(url)) {
        throw new Error(`unexpected upstream ${url}`);
      }
      return nativeFetch(input, init);
    }) as typeof fetch;

    const isolated = await createRetainedTestDatabase('wp_r2_11');
    sql = isolated.sql;
    databaseName = isolated.databaseName;
    const assetsRoot = mkdtemp(join(tmpdir(), 'wp-r2-11-assets-'));
    const transport: HttpTransport = async (request) => {
      injectedUrls.push(request.url);
      const url = new URL(request.url);
      if (url.pathname.endsWith('/relation/stat')) {
        const mid = url.searchParams.get('vmid') ?? '';
        if (mid === '880404') {
          return {
            status: 200,
            headers: {},
            durationMs: 1,
            body: JSON.stringify({ code: -404, message: 'not found' }),
          };
        }
        return {
          status: 200,
          headers: {},
          durationMs: 1,
          body: JSON.stringify({ code: 0, data: { follower: 4242 } }),
        };
      }
      const bvid = url.searchParams.get('bvid') ?? '';
      if (bvid === 'BV1metafaaax') {
        return {
          status: 200,
          headers: {},
          durationMs: 1,
          body: JSON.stringify({ code: -404, message: '稿件不可见' }),
        };
      }
      return { status: 200, headers: {}, durationMs: 1, body: JSON.stringify(detail(bvid)) };
    };
    app = createApp({
      skipDb: true,
      onRequest: (observation) => {
        hits.push({ ...observation, test: currentTest });
      },
    });
    mountApiRoutes(app, isolated.sql, {
      transport,
      download: async (request) => ({
        status: 200,
        headers: { 'content-type': 'image/png' },
        body: PNG,
        finalUrl: request.url,
      }),
      assetsRoot,
      ratePolicy: { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 100 },
      gate: () => gatePromise ?? Promise.resolve(),
      onBackfill: (task) => {
        backfills.push(task);
      },
    });
  }, 60_000);

  afterAll(async () => {
    globalThis.fetch = nativeFetch;
    writeCoverageReport();
    if (sql) await sql.end({ timeout: 5 });
  });

  testChecked('health responses match the contract', 'health', async () => {
    const root = parseHealthResponse(await expectStatus(await api('/health'), 200));
    const apiHealth = parseHealthResponse(await expectStatus(await api('/api/health'), 200));
    expect(root.service).toBe(apiHealth.service);
    expect(root.status).toBe('ok');
    expect(apiHealth.version).toBe(root.version);
  });

  testChecked(
    'monitor reads keep sentinels, nulls, ranges, and cross links',
    'monitor-read',
    async () => {
      const db = needSql();
      const mid = '910000000000001';
      const otherMid = '910000000000002';
      await db`
      INSERT INTO creators (mid, uname, category, monitoring_enabled)
      VALUES
        (${mid}::bigint, '哨兵作者', '生活', true),
        (${otherMid}::bigint, '另一作者', '知识', true)
    `;
      await db`
      INSERT INTO bili_partitions (tid, parent_tid, name, source)
      VALUES (2102, 95, '日常', 'manual')
    `;
      await db`
      INSERT INTO videos (
        bvid, title, category, mid, monitoring_enabled, tid, tid_v2, partition_name, cover_asset_id
      ) VALUES (
        'BV1readsent1', '哨兵标题甲', '生活', ${mid}::bigint, true, 95, 2102, '日常', 'asset-sentinel'
      )
    `;
      await db`
      INSERT INTO videos (bvid, title, category, monitoring_enabled, archived_at)
      VALUES ('BV1archived1', '已归档视频', '生活', true, now())
    `;
      await db`
      INSERT INTO videos (bvid, title, monitoring_enabled, deleted_at)
      VALUES ('BV1deletedxx', '已删除视频', true, now())
    `;
      const samples = [
        {
          at: new Date('2026-01-01T02:00:00.000Z'),
          raw: '2026-01-01 10:00',
          view: 111n,
          online: 0n,
          onlineRaw: '0',
          like: 11n,
          coin: 12n,
          favorite: 13n,
          share: 14n,
          danmaku: 15n,
          comment: null,
        },
        {
          at: new Date('2026-01-01T03:00:00.000Z'),
          raw: '2026-01-01 11:00',
          view: 222n,
          online: null,
          onlineRaw: null,
          like: 21n,
          coin: 22n,
          favorite: 23n,
          share: 24n,
          danmaku: 25n,
          comment: 333n,
        },
        {
          at: new Date('2026-01-01T04:00:00.000Z'),
          raw: '2026-01-01 12:00',
          view: 666n,
          online: 555n,
          onlineRaw: '555',
          like: 31n,
          coin: 32n,
          favorite: 33n,
          share: 34n,
          danmaku: 35n,
          comment: 444n,
        },
      ];
      for (const sample of samples) {
        expect(
          await writeVideoSample(db, {
            bvid: 'BV1readsent1',
            title: '哨兵标题甲',
            sampledAt: sample.at,
            rawTime: sample.raw,
            sourceTimezone: 'Asia/Shanghai',
            timestampPrecision: 'minute',
            viewCount: sample.view,
            onlineViewers: sample.online,
            onlineViewersRaw: sample.onlineRaw,
            likeCount: sample.like,
            coinCount: sample.coin,
            favoriteCount: sample.favorite,
            shareCount: sample.share,
            danmakuCount: sample.danmaku,
            commentCount: sample.comment,
            source: 'import',
          }),
        ).toBe(true);
      }
      await db`
      INSERT INTO creator_follower_samples (
        mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count
      ) VALUES
        (${mid}::bigint, ${samples[0]!.at}, 'Asia/Shanghai', '2026-01-01 10:00', 'minute', 888::bigint),
        (${mid}::bigint, ${samples[2]!.at}, 'Asia/Shanghai', '2026-01-01 12:00', 'minute', 999::bigint),
        (${otherMid}::bigint, ${samples[0]!.at}, 'Asia/Shanghai', '2026-01-01 10:00', 'minute', 101::bigint)
    `;
      await db`
      INSERT INTO dynamics (dynamic_id, mid, category, monitoring_enabled, metadata)
      VALUES ('dyn-sentinel-1', ${mid}::bigint, '生活', true, '{"kind":"sentinel"}'::jsonb)
    `;
      await db`
      INSERT INTO dynamic_metric_samples (
        dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision,
        like_count, repost_count, comment_count
      ) VALUES
        ('dyn-sentinel-1', ${samples[0]!.at}, 'Asia/Shanghai', '2026-01-01 10:00', 'minute', 901, 801, NULL),
        ('dyn-sentinel-1', ${samples[2]!.at}, 'Asia/Shanghai', '2026-01-01 12:00', 'minute', 903, 803, 703)
    `;

      const listed = (await expectStatus(
        await api('/api/v1/monitor/videos?page=1&pageSize=10&q=哨兵标题甲&status=active'),
        200,
      )) as {
        items: {
          bvid: string;
          partitionName: string | null;
          latestMetrics: { viewCount: string | null; onlineViewers: string | null };
        }[];
      };
      expect(listed.items.map((item) => item.bvid)).toEqual(['BV1readsent1']);
      expect(listed.items[0]?.partitionName).toBe('日常');
      expect(listed.items[0]?.latestMetrics.viewCount).toBe('666');
      expect(listed.items[0]?.latestMetrics.onlineViewers).toBe('555');

      const archived = (await expectStatus(
        await api('/api/v1/monitor/videos?status=archived&q=已归档'),
        200,
      )) as { items: { bvid: string }[] };
      expect(archived.items.map((item) => item.bvid)).toEqual(['BV1archived1']);
      const deleted = (await expectStatus(
        await api('/api/v1/monitor/videos?status=deleted'),
        200,
      )) as { items: { bvid: string }[] };
      expect(deleted.items.some((item) => item.bvid === 'BV1deletedxx')).toBe(true);
      await expectStatus(await api('/api/v1/monitor/videos?page=0'), 400);

      const video = (await expectStatus(await api('/api/v1/monitor/videos/BV1readsent1'), 200)) as {
        bvid: string;
        partitionName: string | null;
        tidV2: number | null;
        mid: string | null;
        creator: { mid: string; followerLatest: string | null } | null;
      };
      expect(video.partitionName).toBe('日常');
      expect(video.tidV2).toBe(2102);
      expect(video.mid).toBe(mid);
      expect(video.creator?.followerLatest).toBe('999');
      await expectStatus(await api('/api/v1/monitor/videos/BV1missingxx'), 404);

      const history = (await expectStatus(
        await api('/api/v1/monitor/videos/BV1readsent1/metrics?limit=2'),
        200,
      )) as {
        limit: number;
        items: {
          viewCount: string | null;
          onlineViewers: string | null;
          commentCount: string | null;
          likeCount: string | null;
          rawTime: string;
          sourceTimezone: string;
        }[];
      };
      expect(history.limit).toBe(2);
      expect(history.items.map((item) => item.viewCount)).toEqual(['222', '666']);
      expect(history.items[0]?.onlineViewers).toBeNull();
      expect(history.items[0]?.commentCount).toBe('333');
      expect(history.items[1]?.onlineViewers).toBe('555');
      expect(history.items[1]?.likeCount).toBe('31');
      expect(history.items[1]?.rawTime).toBe('2026-01-01 12:00');
      expect(history.items[1]?.sourceTimezone).toBe('Asia/Shanghai');
      const oldest = (await expectStatus(
        await api(
          '/api/v1/monitor/videos/BV1readsent1/metrics?from=2026-01-01T02:00:00.000Z&to=2026-01-01T02:00:00.000Z',
        ),
        200,
      )) as {
        items: {
          viewCount: string | null;
          onlineViewers: string | null;
          commentCount: string | null;
        }[];
      };
      expect(oldest.items).toHaveLength(1);
      expect(oldest.items[0]?.viewCount).toBe('111');
      expect(oldest.items[0]?.onlineViewers).toBe('0');
      expect(oldest.items[0]?.commentCount).toBeNull();
      await expectStatus(await api('/api/v1/monitor/videos/BV1readsent1/metrics?limit=0'), 400);

      const creators = (await expectStatus(
        await api('/api/v1/monitor/creators?page=1&pageSize=1&q=哨兵作者'),
        200,
      )) as {
        totalItems: number;
        items: { mid: string; latestMetrics: { followerCount: string | null } }[];
      };
      expect(creators.totalItems).toBe(1);
      expect(creators.items[0]?.mid).toBe(mid);
      expect(creators.items[0]?.latestMetrics.followerCount).toBe('999');
      const creator = (await expectStatus(await api(`/api/v1/monitor/creators/${mid}`), 200)) as {
        mid: string;
        uname: string;
      };
      expect(creator.uname).toBe('哨兵作者');
      await expectStatus(await api('/api/v1/monitor/creators/not-a-mid/videos'), 400);
      await expectStatus(await api('/api/v1/monitor/creators/910000000000099'), 404);
      const fans = (await expectStatus(
        await api(`/api/v1/monitor/creators/${mid}/metrics?limit=1`),
        200,
      )) as { items: { followerCount: string }[] };
      expect(fans.items.map((item) => item.followerCount)).toEqual(['999']);
      const videos = (await expectStatus(
        await api(`/api/v1/monitor/creators/${mid}/videos?limit=10&offset=0`),
        200,
      )) as {
        total: number;
        items: {
          bvid: string;
          latest: { viewCount: string | null; commentCount: string | null } | null;
        }[];
      };
      expect(videos.total).toBe(1);
      expect(videos.items[0]?.bvid).toBe('BV1readsent1');
      expect(videos.items[0]?.latest?.viewCount).toBe('666');
      expect(videos.items[0]?.latest?.commentCount).toBe('444');

      const dynamics = (await expectStatus(await api('/api/v1/monitor/dynamics?page=1'), 200)) as {
        items: {
          dynamicId: string;
          latestMetrics: { likeCount: string | null; commentCount: string | null };
        }[];
      };
      const dynamic = dynamics.items.find((item) => item.dynamicId === 'dyn-sentinel-1');
      expect(dynamic?.latestMetrics.likeCount).toBe('903');
      expect(dynamic?.latestMetrics.commentCount).toBe('703');
      const dynamicDetail = (await expectStatus(
        await api('/api/v1/monitor/dynamics/dyn-sentinel-1'),
        200,
      )) as { dynamicId: string; mid: string | null };
      expect(dynamicDetail.mid).toBe(mid);
      await expectStatus(await api('/api/v1/monitor/dynamics/missing-dynamic'), 404);
      const dynamicHistory = (await expectStatus(
        await api('/api/v1/monitor/dynamics/dyn-sentinel-1/metrics?limit=1'),
        200,
      )) as {
        items: {
          likeCount: string | null;
          repostCount: string | null;
          commentCount: string | null;
        }[];
      };
      expect(dynamicHistory.items[0]).toMatchObject({
        likeCount: '903',
        repostCount: '803',
        commentCount: '703',
      });
      const dynamicNull = (await expectStatus(
        await api(
          '/api/v1/monitor/dynamics/dyn-sentinel-1/metrics?from=2026-01-01T02:00:00.000Z&to=2026-01-01T02:00:00.000Z',
        ),
        200,
      )) as { items: { commentCount: string | null; likeCount: string | null }[] };
      expect(dynamicNull.items[0]?.commentCount).toBeNull();
      expect(dynamicNull.items[0]?.likeCount).toBe('901');
    },
    30_000,
  );

  testChecked(
    'monitor targets persist 240, fixed range, auto tiers, and refusals',
    'monitor-targets',
    async () => {
      const db = needSql();
      const now = new Date();
      const age = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      await db`
      INSERT INTO videos (bvid, title, pubdate) VALUES
        ('BV1autonearA', '自动近', ${age(1)}),
        ('BV1autotweve', '自动中', ${age(10)}),
        ('BV1autofarAA', '自动远', ${age(20)}),
        ('BV1fixedhnda', '固定', ${age(40)})
    `;
      const creator = parseMonitorTargetCreateResponse(
        await expectStatus(
          await api(
            '/api/v1/monitor/targets',
            json('POST', {
              type: 'creator',
              externalId: '240240',
              label: '作者240',
              intervalMinutes: 240,
            }),
          ),
          200,
        ),
      );
      expect(creator.created).toBe(true);
      expect(creator.target.intervalMinutes).toBe(240);
      expect(creator.target.intervalMode).toBe('auto');
      const fixed = parseMonitorTargetCreateResponse(
        await expectStatus(
          await api(
            '/api/v1/monitor/targets',
            json('POST', {
              type: 'video',
              externalId: 'BV1fixedhnda',
              intervalMinutes: 120,
              intervalMode: 'fixed',
            }),
          ),
          200,
        ),
      );
      expect(fixed.target.intervalMode).toBe('fixed');
      expect(fixed.target.intervalMinutes).toBe(120);
      const edge = parseMonitorTargetCreateResponse(
        await expectStatus(
          await api(
            '/api/v1/monitor/targets',
            json('POST', {
              type: 'creator',
              externalId: '100801',
              intervalMinutes: 10080,
              intervalMode: 'fixed',
            }),
          ),
          200,
        ),
      );
      const low = parseMonitorTargetCreateResponse(
        await expectStatus(
          await api(
            '/api/v1/monitor/targets',
            json('POST', {
              type: 'creator',
              externalId: '55',
              intervalMinutes: 5,
              intervalMode: 'fixed',
            }),
          ),
          200,
        ),
      );
      for (const bvid of ['BV1autonearA', 'BV1autotweve', 'BV1autofarAA']) {
        await expectStatus(
          await api(
            '/api/v1/monitor/targets',
            json('POST', { type: 'video', externalId: bvid, intervalMode: 'auto' }),
          ),
          200,
        );
      }
      const [storedCreator] = await db<{ interval_minutes: number; interval_mode: string }[]>`
      SELECT interval_minutes, interval_mode FROM monitor_targets
      WHERE "type" = 'creator' AND external_id = '240240' AND deleted_at IS NULL
    `;
      expect(storedCreator).toEqual({ interval_minutes: 240, interval_mode: 'auto' });

      const beforeIllegal = await db<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM monitor_targets`;
      await expectStatus(
        await api(
          '/api/v1/monitor/targets',
          json('POST', { type: 'video', externalId: 'BVTEST001' }),
        ),
        400,
      );
      await expectStatus(
        await api(
          '/api/v1/monitor/targets',
          json('POST', { type: 'creator', externalId: '77', intervalMinutes: 4 }),
        ),
        400,
      );
      await expectStatus(
        await api(
          '/api/v1/monitor/targets',
          json('POST', { type: 'creator', externalId: '78', intervalMinutes: 10081 }),
        ),
        400,
      );
      await expectStatus(
        await api(
          '/api/v1/monitor/targets',
          json('POST', { type: 'creator', externalId: '79', intervalMode: 'weekly' }),
        ),
        400,
      );
      const afterIllegal = await db<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM monitor_targets`;
      expect(afterIllegal[0]?.count).toBe(beforeIllegal[0]?.count);

      const duplicate = parseMonitorTargetCreateResponse(
        await expectStatus(
          await api(
            '/api/v1/monitor/targets',
            json('POST', {
              type: 'creator',
              externalId: '240240',
              label: '另一条',
              intervalMinutes: 60,
            }),
          ),
          200,
        ),
      );
      expect(duplicate.created).toBe(false);
      expect(duplicate.code).toBe('target_exists');
      expect(duplicate.target.id).toBe(creator.target.id);
      expect(duplicate.target.label).toBe('作者240');

      const patched = (await expectStatus(
        await api(
          `/api/v1/monitor/targets/${fixed.target.id}`,
          json('PATCH', {
            label: '固定一百二',
            tags: ['tier'],
            intervalMinutes: 120,
            intervalMode: 'fixed',
          }),
        ),
        200,
      )) as {
        target: { label: string; tags: string[]; intervalMode: string; intervalMinutes: number };
      };
      expect(patched.target.label).toBe('固定一百二');
      expect(patched.target.tags).toEqual(['tier']);
      expect(patched.target.intervalMode).toBe('fixed');
      await expectStatus(
        await api('/api/v1/monitor/targets/not-a-uuid', json('PATCH', { enabled: false })),
        400,
      );
      await expectStatus(
        await api(
          '/api/v1/monitor/targets/00000000-0000-4000-8000-000000000000',
          json('PATCH', { enabled: false }),
        ),
        404,
      );

      const paused = parseMonitorTargetCreateResponse(
        await expectStatus(
          await api(
            '/api/v1/monitor/targets',
            json('POST', {
              type: 'video',
              externalId: 'BV1pausemeAA',
              intervalMode: 'fixed',
              intervalMinutes: 60,
            }),
          ),
          200,
        ),
      );
      await expectStatus(
        await api(`/api/v1/monitor/targets/${paused.target.id}`, json('PATCH', { enabled: false })),
        200,
      );
      const [pausedJobs] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM collector_jobs WHERE target_id = ${paused.target.id}::uuid
    `;
      await db`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp() + interval '7 days'
      WHERE status = 'pending' AND target_id <> ${paused.target.id}::uuid
    `;
      expect(
        await runCollectorOnce({
          sql: db,
          provider: createMonitorProvider('offline', { SOURCE_TIMEZONE: 'Asia/Shanghai' }),
          config: fastConfig('pause-check'),
        }),
      ).toBe('idle');
      const [pausedJobsAfter] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM collector_jobs WHERE target_id = ${paused.target.id}::uuid
    `;
      expect(pausedJobsAfter?.count).toBe(pausedJobs?.count);
      await expectStatus(
        await api(`/api/v1/monitor/targets/${paused.target.id}`, json('PATCH', { enabled: true })),
        200,
      );
      await db`
      UPDATE collector_jobs
      SET scheduled_for = statement_timestamp()
      WHERE status = 'pending'
    `;

      const outcomes: string[] = [];
      for (let index = 0; index < 20; index += 1) {
        const outcome = await runCollectorOnce({
          sql: db,
          provider: createMonitorProvider('offline', { SOURCE_TIMEZONE: 'Asia/Shanghai' }),
          config: fastConfig(`http-${index}`),
        });
        outcomes.push(outcome);
        if (outcome === 'idle') break;
      }
      expect(outcomes).toContain('succeeded');
      expect(outcomes.at(-1)).toBe('idle');

      const listed = parseMonitorTargetList(
        await expectStatus(await api('/api/v1/monitor/targets?page=1&pageSize=50'), 200),
      );
      const minutesOf = (externalId: string) =>
        listed.items.find((item) => item.externalId === externalId);
      expect(minutesOf('240240')).toMatchObject({ intervalMinutes: 240, intervalMode: 'auto' });
      expect(minutesOf('BV1autonearA')).toMatchObject({
        intervalMinutes: 15,
        intervalMode: 'auto',
      });
      expect(minutesOf('BV1autotweve')).toMatchObject({
        intervalMinutes: 120,
        intervalMode: 'auto',
      });
      expect(minutesOf('BV1autofarAA')).toMatchObject({
        intervalMinutes: 360,
        intervalMode: 'auto',
      });
      expect(minutesOf('BV1fixedhnda')).toMatchObject({
        intervalMinutes: 120,
        intervalMode: 'fixed',
      });
      expect(minutesOf('100801')).toMatchObject({ intervalMinutes: 10080, intervalMode: 'fixed' });
      expect(minutesOf('55')).toMatchObject({ intervalMinutes: 5, intervalMode: 'fixed' });
      expect(minutesOf(edge.target.externalId)?.lastSuccessAt).toBeTruthy();
      expect(minutesOf(low.target.externalId)?.lastSuccessAt).toBeTruthy();

      const runTarget = parseMonitorTargetCreateResponse(
        await expectStatus(
          await api(
            '/api/v1/monitor/targets',
            json('POST', {
              type: 'video',
              externalId: 'BV1runonceAA',
              label: '立即运行',
              intervalMode: 'fixed',
              intervalMinutes: 60,
            }),
          ),
          200,
        ),
      );
      const createdJobs = await db<{ id: string }[]>`
      SELECT id::text AS id FROM collector_jobs
      WHERE target_id = ${runTarget.target.id}::uuid
      ORDER BY scheduled_for, id
    `;
      expect(createdJobs).toHaveLength(1);
      const createJobId = createdJobs[0]?.id;
      if (!createJobId) throw new Error('missing create job');
      const [beforeRunSample] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM video_metric_samples WHERE bvid = 'BV1runonceAA'
    `;
      expect(beforeRunSample?.count ?? '0').toBe('0');
      const immediate = (await expectStatus(
        await api(`/api/v1/monitor/targets/${runTarget.target.id}/run`, { method: 'POST' }),
        200,
      )) as {
        created: boolean;
        job: { id: string; targetId: string; status: string };
      };
      expect(immediate.job.targetId).toBe(runTarget.target.id);
      expect(immediate.job.status).toBe('pending');
      expect(immediate.created).toBe(true);
      expect(immediate.job.id).not.toBe(createJobId);
      const repeated = (await expectStatus(
        await api(`/api/v1/monitor/targets/${runTarget.target.id}/run`, { method: 'POST' }),
        200,
      )) as { created: boolean; job: { id: string } };
      if (repeated.created) {
        expect(repeated.job.id).not.toBe(immediate.job.id);
      } else {
        expect(repeated.job.id).toBe(immediate.job.id);
      }
      await db`
      UPDATE collector_jobs
      SET scheduled_for = scheduled_for + interval '7 days'
      WHERE status = 'pending' AND id <> ${immediate.job.id}::uuid
    `;
      const provider = createMonitorProvider('offline', { SOURCE_TIMEZONE: 'Asia/Shanghai' });
      const runOutcomes: string[] = [];
      for (let index = 0; index < 5; index += 1) {
        const outcome = await runCollectorOnce({
          sql: db,
          provider,
          config: fastConfig(`run-job-${index}`),
        });
        runOutcomes.push(outcome);
        if (outcome === 'idle') break;
      }
      expect(runOutcomes).toContain('succeeded');
      const [runJob] = await db<{ status: string; target_id: string }[]>`
      SELECT status, target_id::text AS target_id
      FROM collector_jobs WHERE id = ${immediate.job.id}::uuid
    `;
      expect(runJob).toEqual({ status: 'succeeded', target_id: runTarget.target.id });
      const [createJob] = await db<{ status: string }[]>`
      SELECT status FROM collector_jobs WHERE id = ${createJobId}::uuid
    `;
      expect(createJob?.status).toBe('pending');
      const [runRow] = await db<{ id: string; samples_written: number }[]>`
      SELECT id::text AS id, samples_written
      FROM collector_runs
      WHERE job_id = ${immediate.job.id}::uuid AND target_id = ${runTarget.target.id}::uuid
    `;
      expect(runRow?.samples_written).toBe(1);
      const storedSamples = await db<
        {
          view_count: string;
          sampled_at: Date;
          comment_count: string | null;
          source_timezone: string;
        }[]
      >`
      SELECT view_count::text AS view_count, sampled_at, comment_count::text AS comment_count,
        source_timezone
      FROM video_metric_samples WHERE bvid = 'BV1runonceAA'
    `;
      expect(storedSamples).toHaveLength(1);
      const stored = storedSamples[0];
      if (!stored) throw new Error('missing run sample');
      const expectedSample = await provider.collectVideo('BV1runonceAA', stored.sampled_at);
      expect(stored.view_count).toBe(expectedSample.viewCount.toString());
      expect(stored.comment_count).toBe(expectedSample.commentCount.toString());
      expect(stored.source_timezone).toBe('Asia/Shanghai');
      const metrics = (await expectStatus(
        await api('/api/v1/monitor/videos/BV1runonceAA/metrics?limit=5'),
        200,
      )) as { items: { viewCount: string | null; commentCount: string | null }[] };
      expect(metrics.items.map((item) => item.viewCount)).toEqual([stored.view_count]);
      expect(metrics.items[0]?.commentCount).toBe(stored.comment_count);
      const jobs = (await expectStatus(
        await api('/api/v1/monitor/jobs?page=1&pageSize=50'),
        200,
      )) as {
        items: {
          id: string;
          targetId: string;
          status: string;
          latestRun: { id: string; samplesWritten: number } | null;
        }[];
      };
      const listedJob = jobs.items.find((item) => item.id === immediate.job.id);
      expect(listedJob).toMatchObject({
        targetId: runTarget.target.id,
        status: 'succeeded',
        latestRun: { id: runRow?.id, samplesWritten: 1 },
      });

      const removed = parseMonitorTargetCreateResponse(
        await expectStatus(
          await api(
            '/api/v1/monitor/targets',
            json('POST', { type: 'video', externalId: 'BV1removemeA' }),
          ),
          200,
        ),
      );
      const removedRun = (await expectStatus(
        await api(`/api/v1/monitor/targets/${removed.target.id}/run`, { method: 'POST' }),
        200,
      )) as { job: { id: string; status: string } };
      expect(removedRun.job.status).toBe('pending');
      expect(removedRun.job.id).not.toBe(immediate.job.id);
      const deleted = (await expectStatus(
        await api(`/api/v1/monitor/targets/${removed.target.id}`, { method: 'DELETE' }),
        200,
      )) as { deleted: boolean; target: { deletedAt: string | null } };
      expect(deleted.deleted).toBe(true);
      expect(deleted.target.deletedAt).not.toBeNull();
      const [stillThere] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM monitor_targets WHERE id = ${removed.target.id}::uuid
    `;
      expect(stillThere?.count).toBe('1');
      await expectStatus(
        await api(`/api/v1/monitor/targets/${removed.target.id}/run`, { method: 'POST' }),
        409,
      );
      await expectStatus(
        await api(`/api/v1/monitor/targets/${removed.target.id}`, { method: 'DELETE' }),
        409,
      );
      const hidden = parseMonitorTargetList(
        await expectStatus(await api('/api/v1/monitor/targets'), 200),
      );
      expect(hidden.items.some((item) => item.id === removed.target.id)).toBe(false);
      const visible = parseMonitorTargetList(
        await expectStatus(await api('/api/v1/monitor/targets?includeDeleted=1&pageSize=50'), 200),
      );
      expect(visible.items.some((item) => item.id === removed.target.id)).toBe(true);
      const [keptSample] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM video_metric_samples WHERE bvid = 'BV1runonceAA'
    `;
      expect(keptSample?.count).toBe('1');
      const [removedSamples] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM video_metric_samples WHERE bvid = 'BV1removemeA'
    `;
      expect(removedSamples?.count ?? '0').toBe('0');
    },
    60_000,
  );

  testChecked(
    'metadata refresh waits for injected results and does not fetch upstream',
    'metadata-refresh',
    async () => {
      const db = needSql();
      const [before] = await db<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM backfill_runs`;
      await expectStatus(
        await api('/api/v1/monitor/metadata/refresh', json('POST', { kind: 'nope' })),
        400,
      );
      const [afterReject] = await db<
        { count: string }[]
      >`SELECT count(*)::text AS count FROM backfill_runs`;
      expect(afterReject?.count).toBe(before?.count);
      await expectStatus(await api('/api/v1/monitor/metadata/runs/not-a-uuid'), 400);
      await expectStatus(
        await api('/api/v1/monitor/metadata/runs/00000000-0000-4000-8000-000000000099'),
        404,
      );

      holdGate();
      const started = (await expectStatus(
        await api(
          '/api/v1/monitor/metadata/refresh',
          json('POST', { kind: 'video', ids: ['BV1metarefaa'] }),
        ),
        202,
      )) as { backfillRunId: string; requested: number };
      expect(started.requested).toBe(1);
      const running = parseMetadataRunResponse(
        await expectStatus(
          await api(`/api/v1/monitor/metadata/runs/${started.backfillRunId}`),
          200,
        ),
      );
      expect(running.status).toBe('running');
      await expectStatus(
        await api(
          '/api/v1/monitor/metadata/refresh',
          json('POST', { kind: 'video', ids: ['BV1metapart1'] }),
        ),
        409,
      );
      const [runningRows] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM backfill_runs WHERE status = 'running'
    `;
      expect(runningRows?.count).toBe('1');
      openGate();
      await backfills.at(-1);
      const done = parseMetadataRunResponse(
        await expectStatus(await api(`/api/v1/ops/metadata/runs/${started.backfillRunId}`), 200),
      );
      expect(done.status).toBe('succeeded');
      expect(done.succeeded).toBe(1);
      const [title] = await db<{ title: string | null }[]>`
      SELECT title FROM videos WHERE bvid = 'BV1metarefaa'
    `;
      expect(title?.title).toContain('BV1metarefaa');

      const callsAfterSuccess = injectedUrls.length;
      const cached = parseVideoRefreshResponse(
        await expectStatus(
          await api('/api/v1/monitor/videos/BV1metarefaa/refresh', json('POST', { force: false })),
          200,
        ),
      );
      expect(cached.metadataState).toBe('ok');
      expect(cached.bvid).toBe('BV1metarefaa');
      expect(injectedUrls.length).toBe(callsAfterSuccess);

      const failed = await api(
        '/api/v1/monitor/videos/BV1metafaaax/refresh',
        json('POST', { force: true }),
      );
      expect(failed.status).toBe(404);
      const failedBody = (await readJson(failed)) as { error: string };
      expect(failedBody.error).not.toContain('SESSDATA');

      const partial = (await expectStatus(
        await api(
          '/api/v1/monitor/metadata/refresh',
          json('POST', { kind: 'video', ids: ['BV1metapart1', 'BV1metafaaax'], force: true }),
        ),
        202,
      )) as { backfillRunId: string };
      await backfills.at(-1);
      const partialRun = parseMetadataRunResponse(
        await expectStatus(
          await api(`/api/v1/monitor/metadata/runs/${partial.backfillRunId}`),
          200,
        ),
      );
      expect(partialRun.succeeded).toBe(1);
      expect(partialRun.failed).toBe(1);
      expect(partialRun.status).toBe('succeeded');

      const allFailed = (await expectStatus(
        await api(
          '/api/v1/monitor/metadata/refresh',
          json('POST', { kind: 'video', ids: ['BV1metafaaax'], force: true }),
        ),
        202,
      )) as { backfillRunId: string };
      await backfills.at(-1);
      const failedRun = parseMetadataRunResponse(
        await expectStatus(
          await api(`/api/v1/monitor/metadata/runs/${allFailed.backfillRunId}`),
          200,
        ),
      );
      expect(failedRun.status).toBe('failed');
      expect(failedRun.succeeded).toBe(0);
      expect(failedRun.failed).toBe(1);

      await db`
      INSERT INTO creators (mid, uname) VALUES (880001, '待刷新')
      ON CONFLICT (mid) DO NOTHING
    `;
      await db`
      INSERT INTO videos (bvid, title, mid) VALUES ('BV1cardforup', '卡片视频', 880001)
    `;
      const creator = (await expectStatus(
        await api('/api/v1/monitor/creators/880001/refresh', json('POST', { force: true })),
        200,
      )) as {
        mid: string;
        followerCount: string | null;
        metadataState: string;
        uname: string | null;
      };
      expect(creator.mid).toBe('880001');
      expect(creator.followerCount).toBe('4242');
      expect(creator.metadataState).toBe('ok');
      const [fans] = await db<{ follower_count: string }[]>`
      SELECT follower_count::text AS follower_count
      FROM creator_follower_samples WHERE mid = 880001 ORDER BY sampled_at DESC LIMIT 1
    `;
      expect(fans?.follower_count).toBe('4242');
      const creatorFailed = await api(
        '/api/v1/monitor/creators/880404/refresh',
        json('POST', { force: true }),
      );
      expect(creatorFailed.status).toBe(404);
    },
    30_000,
  );

  testChecked('assets serve isolated bytes, cache, and missing states', 'assets', async () => {
    const db = needSql();
    const root = mkdtemp(join(tmpdir(), 'wp-r2-11-asset-files-'));
    const relative = 'covers/sentinel.png';
    const absolute = join(root, relative);
    mkdirSync(join(root, 'covers'), { recursive: true });
    writeFileSync(absolute, PNG);
    const sha = createHash('sha256').update(PNG).digest('hex');
    const previous = process.env.MONITOR_ASSETS_ROOT;
    process.env.MONITOR_ASSETS_ROOT = root;
    try {
      await db`
        INSERT INTO static_assets (asset_id, content_sha256, mime_type, relative_path, origin, kind)
        VALUES
          ('asset-ok', ${sha}, 'image/png', ${relative}, 'manual', 'cover'),
          ('asset-missing-file', ${sha}, 'image/png', 'covers/absent.png', 'manual', 'cover')
      `;
      const ok = await api('/api/v1/assets/asset-ok');
      expect(ok.status).toBe(200);
      expect(ok.headers.get('x-asset-status')).toBe('ok');
      expect(ok.headers.get('etag')).toBe(`"${sha}"`);
      expect(Buffer.from(await ok.arrayBuffer())).toEqual(PNG);
      const cached = await api('/api/v1/assets/asset-ok', {
        headers: { 'if-none-match': `"${sha}"` },
      });
      expect(cached.status).toBe(304);
      expect(cached.headers.get('x-asset-status')).toBe('ok');
      const missingFile = await api('/api/v1/assets/asset-missing-file');
      expect(missingFile.status).toBe(200);
      expect(missingFile.headers.get('x-asset-status')).toBe('missing-file');
      const missing = await api('/api/v1/assets/asset-does-not-exist');
      expect(missing.status).toBe(200);
      expect(missing.headers.get('x-asset-status')).toBe('placeholder');
    } finally {
      if (previous === undefined) delete process.env.MONITOR_ASSETS_ROOT;
      else process.env.MONITOR_ASSETS_ROOT = previous;
    }
  });

  testChecked(
    'csv import persists batches, rejects, and a no-op repeat',
    'imports',
    async () => {
      const db = needSql();
      const previousRoot = process.env.MOCK_DATA_ROOT;
      const previousAssets = process.env.MONITOR_ASSETS_ROOT;
      process.env.MOCK_DATA_ROOT = MOCK_ROOT;
      try {
        const before = await fixtureImportCounts(db);
        expect(before.fixtureVideos).toBe(0);
        expect(before.fixtureFans).toBe(0);
        const [batchesBefore] = await db<
          { count: string }[]
        >`SELECT count(*)::text AS count FROM import_batches`;
        await expectStatus(
          await api('/api/v1/imports/csv', json('POST', { mode: 'sideways' })),
          400,
        );
        await expectStatus(await api('/api/v1/imports/csv', { method: 'POST', body: '{' }), 400);
        const [afterReject] = await db<{ count: string }[]>`
        SELECT count(*)::text AS count FROM import_batches
      `;
        expect(afterReject?.count).toBe(batchesBefore?.count);
        await expectStatus(await api(`/api/v1/imports/${randomUUID()}`), 404);

        const dry = (await expectStatus(
          await api(
            '/api/v1/imports/csv',
            json('POST', { mode: 'dry-run', sourceTimezone: 'Asia/Shanghai' }),
          ),
          200,
        )) as { batchId: string; status: string; report: { stagingRows: number } };
        expect(dry.status).toBe('completed');
        expect(dry.report.stagingRows).toBeGreaterThan(0);
        const dryRead = (await expectStatus(await api(`/api/v1/imports/${dry.batchId}`), 200)) as {
          status: string;
          evidence: { stagingRows: number };
        };
        expect(dryRead.status).toBe('completed');
        expect(dryRead.evidence.stagingRows).toBeGreaterThan(0);
        const afterDry = await fixtureImportCounts(db);
        expect(afterDry).toEqual(before);
        const [dryMetrics] = await db<{ count: string }[]>`
        SELECT count(*)::text AS count FROM video_metric_samples WHERE import_batch_id = ${dry.batchId}
      `;
        const [dryFans] = await db<{ count: string }[]>`
        SELECT count(*)::text AS count FROM creator_follower_samples WHERE import_batch_id = ${dry.batchId}
      `;
        expect(dryMetrics?.count ?? '0').toBe('0');
        expect(dryFans?.count ?? '0').toBe('0');

        const applied = (await expectStatus(
          await api(
            '/api/v1/imports/csv',
            json('POST', { mode: 'apply', sourceTimezone: 'Asia/Shanghai' }),
          ),
          200,
        )) as {
          batchId: string;
          report: {
            rejected: number;
            invalidNumeric: number;
            duplicate: number;
            noOp: boolean;
            unsupported: string[];
          };
        };
        expect(applied.report.noOp).toBe(false);
        expect(applied.report.invalidNumeric).toBeGreaterThan(0);
        const imported = (await expectStatus(
          await api('/api/v1/monitor/videos/BVTEST002/metrics?limit=10'),
          200,
        )) as {
          items: {
            sampledAt: string;
            rawTime: string;
            sourceTimezone: string;
            viewCount: string | null;
            onlineViewers: string | null;
            likeCount: string | null;
            commentCount: string | null;
          }[];
        };
        expect(imported.items).toHaveLength(1);
        expect(imported.items[0]).toMatchObject({
          sampledAt: '2025-02-01T04:00:00.000Z',
          rawTime: '2025-02-01 12:00',
          sourceTimezone: 'Asia/Shanghai',
          viewCount: '10',
          onlineViewers: '5',
          likeCount: '0',
          coinCount: '0',
          favoriteCount: '0',
          shareCount: '0',
          danmakuCount: '0',
          commentCount: null,
        });
        const [storedImport] = await db<
          {
            view_count: string;
            comment_count: string | null;
            batch_id: string;
            source_timezone: string;
            raw_time: string;
          }[]
        >`
        SELECT view_count::text AS view_count, comment_count::text AS comment_count,
          import_batch_id::text AS batch_id, source_timezone, raw_time
        FROM video_metric_samples WHERE bvid = 'BVTEST002'
      `;
        expect(storedImport).toEqual({
          view_count: '10',
          comment_count: null,
          batch_id: applied.batchId,
          source_timezone: 'Asia/Shanghai',
          raw_time: '2025-02-01 12:00',
        });
        const earlyVideo = (await expectStatus(
          await api(
            '/api/v1/monitor/videos/BVTEST001/metrics?from=2025-01-01T02:01:00.000Z&to=2025-01-01T02:01:00.000Z',
          ),
          200,
        )) as {
          items: { viewCount: string | null; commentCount: string | null; rawTime: string }[];
        };
        expect(earlyVideo.items).toEqual([
          expect.objectContaining({
            viewCount: '101',
            commentCount: null,
            rawTime: '2025-01-01 10:01',
          }),
        ]);
        const fans = (await expectStatus(
          await api('/api/v1/monitor/creators/12345/metrics?limit=5'),
          200,
        )) as { items: { followerCount: string; rawTime: string; sourceTimezone: string }[] };
        expect(fans.items).toEqual([
          expect.objectContaining({
            followerCount: '10',
            rawTime: '2025-02-01 12:00',
            sourceTimezone: 'Asia/Shanghai',
          }),
        ]);
        expect(applied.report.unsupported.join('\n')).toContain('BVTEST_BAD_views.csv');
        const [plusReject] = await db<{ message: string; detail: string }[]>`
        SELECT message, detail::text AS detail
        FROM import_conflicts_or_rejects
        WHERE batch_id = ${applied.batchId}
          AND entity_key = 'BVTEST001'
          AND message = 'invalid numeric cell'
      `;
        expect(plusReject?.detail).toContain('在线观看人数');
        const [plusStaging] = await db<{ payload: string; flags: string[] }[]>`
        SELECT payload::text AS payload, quality_flags AS flags
        FROM source_metric_rows
        WHERE batch_id = ${applied.batchId}
          AND entity_key = 'BVTEST001'
          AND payload::text LIKE '%1000+%'
      `;
        expect(plusStaging?.payload).toContain('1000+');
        expect(plusStaging?.flags).toContain('rejected');
        const [plusSample] = await db<{ count: string }[]>`
        SELECT count(*)::text AS count FROM video_metric_samples
        WHERE bvid = 'BVTEST001' AND online_viewers_raw = '1000+'
      `;
        expect(plusSample?.count ?? '0').toBe('0');
        const [fanConflict] = await db<{ message: string; detail: string }[]>`
        SELECT message, detail::text AS detail
        FROM import_conflicts_or_rejects
        WHERE batch_id = ${applied.batchId} AND entity_key = '12345'
      `;
        expect(fanConflict?.message).toContain('different value');
        expect(fanConflict?.detail).toContain('11');
        const afterApply = await fixtureImportCounts(db);
        expect(afterApply.sentinel).toBe(before.sentinel);
        expect(afterApply.fixtureVideos).toBeGreaterThan(0);
        const again = (await expectStatus(
          await api('/api/v1/imports/csv', json('POST', { mode: 'apply' })),
          200,
        )) as { report: { noOp: boolean } };
        expect(again.report.noOp).toBe(true);
        const afterRepeat = await fixtureImportCounts(db);
        expect(afterRepeat).toEqual(afterApply);
        const [stillFirstBatch] = await db<{ count: string }[]>`
        SELECT count(*)::text AS count FROM video_metric_samples
        WHERE bvid = 'BVTEST002' AND import_batch_id = ${applied.batchId}
      `;
        expect(stillFirstBatch?.count).toBe('1');
      } finally {
        if (previousRoot === undefined) delete process.env.MOCK_DATA_ROOT;
        else process.env.MOCK_DATA_ROOT = previousRoot;
        if (previousAssets === undefined) delete process.env.MONITOR_ASSETS_ROOT;
        else process.env.MONITOR_ASSETS_ROOT = previousAssets;
      }
    },
    30_000,
  );

  testChecked(
    'commercial writes round-trip and refusals leave no residue',
    'commercial',
    async () => {
      const db = needSql();
      const template = parseCommercialDefaultTemplate(
        await expectStatus(await api('/api/v1/commercial/templates/default'), 200),
      );
      expect(template.nodes.length).toBeGreaterThan(0);
      await expectStatus(await api('/api/v1/commercial/projects/not-a-uuid'), 400);
      await expectStatus(
        await api('/api/v1/commercial/projects/00000000-0000-4000-8000-000000000077'),
        404,
      );

      const projectId = await createProject(db, '联调项目');
      const otherId = await createProject(db, '另一个项目');
      const list = parseCommercialProjectList(
        await expectStatus(await api('/api/v1/commercial/projects'), 200),
      );
      expect(list.items.some((item) => item.id === projectId)).toBe(true);
      const detail = parseCommercialProjectDetail(
        await expectStatus(await api(`/api/v1/commercial/projects/${projectId}`), 200),
      );
      expect(detail.publish.published).toBe(false);
      let tokens = await loadTokens(projectId);
      expect(tokens.size).toBe(14);

      const [auditsBefore] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM domain_audit_events WHERE project_id = ${projectId}
    `;
      const blocked = await api(
        `/api/v1/commercial/projects/${projectId}/nodes/${tokens.get('大纲')!.id}/advance`,
        json('POST', { expectedUpdatedAt: tokens.get('大纲')!.updatedAt }),
      );
      const blockedBody = parseCommercialWriteError(await expectStatus(blocked, 409));
      expect(blockedBody.code).toBe('predecessors_incomplete');
      expect(await statusOf(db, projectId, '大纲')).toBe('not_reached');
      const [auditsAfter] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM domain_audit_events WHERE project_id = ${projectId}
    `;
      expect(auditsAfter?.count).toBe(auditsBefore?.count);

      const skipped = await postNode(projectId, tokens, '汇合节点', 'skip');
      expect(parseCommercialNodeWriteResponse(await expectStatus(skipped, 200)).node.status).toBe(
        'not_applicable',
      );
      tokens = await loadTokens(projectId);

      const advanced = parseCommercialNodeWriteResponse(
        await expectStatus(await postNode(projectId, tokens, '询单', 'advance'), 200),
      );
      expect(advanced.node.status).toBe('in_progress');
      tokens = await loadTokens(projectId);
      const completed = parseCommercialNodeWriteResponse(
        await expectStatus(await postNode(projectId, tokens, '询单', 'complete'), 200),
      );
      expect(completed.node.status).toBe('completed');
      tokens = await loadTokens(projectId);

      const staleToken = tokens.get('大纲')!.updatedAt;
      const planned = parseCommercialNodeWriteResponse(
        await expectStatus(
          await postNode(projectId, tokens, '大纲', 'plan', { plannedAt: '2026-04-02' }),
          200,
        ),
      );
      expect(planned.node.status).toBe('not_reached');
      expect(Date.parse(planned.node.plannedAt ?? '')).toBe(
        Date.parse('2026-04-02T00:00:00+08:00'),
      );
      tokens = await loadTokens(projectId);
      const stale = await postNode(projectId, tokens, '大纲', 'plan', {
        expectedUpdatedAt: staleToken,
        plannedAt: '2026-05-01',
      });
      expect(parseCommercialWriteError(await expectStatus(stale, 409)).code).toBe('stale_write');
      const [plannedRow] = await db<{ planned_at: Date | null }[]>`
      SELECT planned_at FROM wf_nodes WHERE project_id = ${projectId} AND name = '大纲'
    `;
      expect(plannedRow?.planned_at?.toISOString()).toBe('2026-04-01T16:00:00.000Z');
      await expectStatus(
        await postNode(projectId, tokens, '大纲', 'plan', {
          plannedAt: '2026-04-02T00:00:00.000Z',
        }),
        400,
      );

      const stepped = parseCommercialStepResponse(
        await expectStatus(await postStage(projectId, tokens, 'write_outline', 'forward'), 200),
      );
      expect(stepped.nodes.find((node) => node.name === '大纲')?.status).toBe('in_progress');
      tokens = await loadTokens(projectId);

      const blockedNode = parseCommercialNodeWriteResponse(
        await expectStatus(
          await postNode(projectId, tokens, '大纲', 'block', { reason: '等确认' }),
          200,
        ),
      );
      expect(blockedNode.node.status).toBe('blocked');
      tokens = await loadTokens(projectId);
      const unblocked = parseCommercialNodeWriteResponse(
        await expectStatus(await postNode(projectId, tokens, '大纲', 'unblock'), 200),
      );
      expect(unblocked.node.status).toBe('in_progress');
      const firstPin = blockedNode.pinnedItem;
      if (!firstPin) throw new Error('expected the first pinned item');
      const closedFirst = parseCommercialOpenItemWriteResponse(
        await expectStatus(
          await api(
            `/api/v1/commercial/projects/${projectId}/open-items/${firstPin.id}/close`,
            json('POST', {
              expectedUpdatedAt: firstPin.updatedAt,
              closeConclusion: '先解除残留阻塞',
            }),
          ),
          200,
        ),
      );
      expect(closedFirst.item.lifecycle).toBe('closed');
      tokens = await loadTokens(projectId);

      const pinBlock = parseCommercialNodeWriteResponse(
        await expectStatus(
          await postNode(projectId, tokens, '大纲', 'block', { reason: '等甲方' }),
          200,
        ),
      );
      const pin = pinBlock.pinnedItem;
      if (!pin) throw new Error('expected pinned item');
      const closed = parseCommercialOpenItemWriteResponse(
        await expectStatus(
          await api(
            `/api/v1/commercial/projects/${projectId}/open-items/${pin.id}/close`,
            json('POST', { expectedUpdatedAt: pin.updatedAt, closeConclusion: '确认了' }),
          ),
          200,
        ),
      );
      expect(closed.item.lifecycle).toBe('closed');
      expect(await statusOf(db, projectId, '大纲')).toBe('in_progress');
      tokens = await loadTokens(projectId);

      const cancelBlock = parseCommercialNodeWriteResponse(
        await expectStatus(
          await postNode(projectId, tokens, '大纲', 'block', { reason: '改期' }),
          200,
        ),
      );
      const cancelPin = cancelBlock.pinnedItem;
      if (!cancelPin) throw new Error('expected cancel item');
      const [itemsBeforeBlank] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM open_items
      WHERE id = ${cancelPin.id} AND lifecycle = 'open'
    `;
      await expectStatus(
        await api(
          `/api/v1/commercial/projects/${projectId}/open-items/${cancelPin.id}/cancel`,
          json('POST', { expectedUpdatedAt: cancelPin.updatedAt, cancelReason: '   ' }),
        ),
        409,
      );
      const [itemsAfterBlank] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM open_items
      WHERE id = ${cancelPin.id} AND lifecycle = 'open'
    `;
      expect(itemsAfterBlank?.count).toBe(itemsBeforeBlank?.count);
      const cancelled = parseCommercialOpenItemWriteResponse(
        await expectStatus(
          await api(
            `/api/v1/commercial/projects/${projectId}/open-items/${cancelPin.id}/cancel`,
            json('POST', { expectedUpdatedAt: cancelPin.updatedAt, cancelReason: '不再跟踪' }),
          ),
          200,
        ),
      );
      expect(cancelled.item.lifecycle).toBe('cancelled');
      tokens = await loadTokens(projectId);

      const rolled = parseCommercialNodeWriteResponse(
        await expectStatus(await postNode(projectId, tokens, '大纲', 'rollback'), 200),
      );
      expect(rolled.node.status).toBe('not_reached');
      tokens = await loadTokens(projectId);

      const requiredSkip = await postNode(projectId, tokens, '文案', 'skip');
      expect(parseCommercialWriteError(await expectStatus(requiredSkip, 409)).code).toBe(
        'constraint_violation',
      );
      expect(await statusOf(db, projectId, '文案')).toBe('not_reached');

      const nodeStep = parseCommercialStepResponse(
        await expectStatus(await postNodeStep(projectId, tokens, '文案', 'forward'), 200),
      );
      expect(nodeStep.nodes.find((node) => node.name === '文案')?.status).toBe('in_progress');
      expect(await statusOf(db, projectId, '大纲')).toBe('completed');
      tokens = await loadTokens(projectId);
      const copyBlock = parseCommercialNodeWriteResponse(
        await expectStatus(
          await postNode(projectId, tokens, '文案', 'block', { reason: '等甲方' }),
          200,
        ),
      );
      expect(copyBlock.node.status).toBe('blocked');
      tokens = await loadTokens(projectId);
      const [openBefore] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM open_items WHERE project_id = ${projectId} AND lifecycle = 'open'
    `;
      const confirm = parseCommercialWriteError(
        await expectStatus(await postNodeStep(projectId, tokens, '文案', 'forward'), 409),
      );
      expect(confirm.code).toBe('confirmation_required');
      const [openAfter] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM open_items WHERE project_id = ${projectId} AND lifecycle = 'open'
    `;
      expect(openAfter?.count).toBe(openBefore?.count);
      expect(await statusOf(db, projectId, '文案')).toBe('blocked');
      const forced = parseCommercialStepResponse(
        await expectStatus(
          await postNodeStep(projectId, tokens, '文案', 'forward', { force: true }),
          200,
        ),
      );
      expect(forced.nodes.find((node) => node.name === '文案')?.status).toBe('in_progress');
      tokens = await loadTokens(projectId);

      const [otherAuditsBefore] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM domain_audit_events WHERE project_id = ${otherId}
    `;
      const foreign = await api(
        `/api/v1/commercial/projects/${otherId}/nodes/${tokens.get('文案')!.id}/advance`,
        json('POST', { expectedUpdatedAt: tokens.get('文案')!.updatedAt }),
      );
      expect(foreign.status).toBe(404);
      const [otherAuditsAfter] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM domain_audit_events WHERE project_id = ${otherId}
    `;
      expect(otherAuditsAfter?.count).toBe(otherAuditsBefore?.count);

      await completeName(db, projectId, '文案');
      await completeName(db, projectId, '预拍摄');
      await completeName(db, projectId, 'A-roll 拍摄');
      await completeName(db, projectId, 'B-roll 素材');
      await completeName(db, projectId, 'AI 后期');
      await completeName(db, projectId, '审核');
      tokens = await loadTokens(projectId);
      const publishNode = tokens.get('发布');
      if (!publishNode) throw new Error('missing 发布');
      if (publishNode.status === 'not_reached') {
        await expectStatus(await postNode(projectId, tokens, '发布', 'advance'), 200);
        tokens = await loadTokens(projectId);
      }
      const publishBody = {
        expectedUpdatedAt: tokens.get('发布')!.updatedAt,
        idempotencyKey: 'http-cover-publish-1',
        platform: 'bilibili',
        bvid: 'BV1httpcover1',
        videoUrl: 'https://www.bilibili.com/video/BV1httpcover1',
        publishSource: 'web',
      };
      const published = parseCommercialPublishResponse(
        await expectStatus(await postNode(projectId, tokens, '发布', 'publish', publishBody), 200),
      );
      expect(published.publish.bvid).toBe('BV1httpcover1');
      expect(published.node.status).toBe('completed');
      expect(published.idempotentReplay).toBe(false);
      tokens = await loadTokens(projectId);
      const replay = parseCommercialPublishResponse(
        await expectStatus(
          await postNode(projectId, tokens, '发布', 'publish', {
            ...publishBody,
            expectedUpdatedAt: tokens.get('发布')!.updatedAt,
          }),
          200,
        ),
      );
      expect(replay.idempotentReplay).toBe(true);
      const [publishRows] = await db<{ count: string }[]>`
      SELECT count(*)::text AS count FROM project_publish_records WHERE project_id = ${projectId}
    `;
      expect(publishRows?.count).toBe('1');
      const publishedDetail = parseCommercialProjectDetail(
        await expectStatus(await api(`/api/v1/commercial/projects/${projectId}`), 200),
      );
      expect(publishedDetail.publish.bvid).toBe('BV1httpcover1');
      const graph = parseCommercialProjectWorkflow(
        await expectStatus(await api(`/api/v1/commercial/projects/${projectId}/workflow`), 200),
      );
      expect(graph.nodes.find((node) => node.name === '发布')?.status).toBe('completed');
    },
    60_000,
  );

  testChecked(
    'ops reads isolated logs with filters, pages, links, and redaction',
    'ops',
    async () => {
      const db = needSql();
      const [run] = await db<{ id: string; target_id: string }[]>`
      SELECT id::text AS id, target_id::text AS target_id
      FROM collector_runs WHERE status = 'succeeded' ORDER BY finished_at DESC LIMIT 1
    `;
      if (!run) throw new Error('expected a collector run');
      const failedRunId = randomUUID();
      await db`
      INSERT INTO collector_runs (
        id, job_id, target_id, status, samples_written, duration_ms, error, started_at, finished_at
      )
      SELECT ${failedRunId}::uuid, job_id, target_id, 'failed', 0, 5,
        'SESSDATA=supersecret; bili_jct=tok', statement_timestamp(), statement_timestamp()
      FROM collector_runs WHERE id = ${run.id}::uuid
    `;
      await db`
      INSERT INTO collector_requests (
        run_id, endpoint, status_code, biz_code, duration_ms, error
      ) VALUES (
        ${run.id}::uuid, 'view/detail', 200, 0, 4, 'cookie SESSDATA=supersecret'
      )
    `;
      await db`
      INSERT INTO app_logs (ts, level, service, event, message, request_id, run_id, context)
      VALUES
        (statement_timestamp(), 'error', 'api', 'http.error', 'boom SESSDATA=supersecret', 'req-sentinel', ${run.id}::uuid, '{"password":"hidden","note":"visible"}'::jsonb),
        (statement_timestamp() - interval '2 seconds', 'info', 'collector', 'job.succeeded', '哨兵日志', 'req-info', NULL, '{}'::jsonb),
        (statement_timestamp() - interval '1 second', 'warn', 'api', 'http.warn', '另一条', 'req-warn', NULL, '{}'::jsonb)
    `;
      await db`
      INSERT INTO collector_heartbeats (instance_id, last_seen_at, status)
      VALUES ('http-coverage', statement_timestamp(), 'idle')
      ON CONFLICT (instance_id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, status = EXCLUDED.status
    `;
      const accountId = randomUUID();
      await db`
      INSERT INTO bili_accounts (id, status, note) VALUES (${accountId}::uuid, 'active', 'fixture')
    `;
      await db`
      INSERT INTO collector_circuits (account_id, opened_at, resume_at, consecutive_failures, reason)
      VALUES (
        ${accountId}::uuid, statement_timestamp(), statement_timestamp() + interval '1 hour', 2,
        'SESSDATA=supersecret'
      )
    `;

      const summary = (await expectStatus(await api('/api/v1/ops/summary'), 200)) as {
        heartbeats: { instance: string }[];
        circuits: { reason: string }[];
        targets: { label: string }[];
        samplesToday: { videos: number };
        recentErrorCount: number;
      };
      expect(summary.heartbeats.some((item) => item.instance === 'http-coverage')).toBe(true);
      expect(summary.targets.some((item) => item.label === '作者240')).toBe(true);
      expect(summary.samplesToday.videos).toBeGreaterThan(0);
      expect(summary.recentErrorCount).toBeGreaterThan(0);
      expect(JSON.stringify(summary)).not.toContain('supersecret');
      expect(summary.circuits[0]?.reason).toContain('[redacted]');

      const failed = (await expectStatus(
        await api('/api/v1/ops/runs?status=failed&limit=10'),
        200,
      )) as {
        items: { id: string; error: string | null }[];
      };
      expect(failed.items.some((item) => item.id === failedRunId)).toBe(true);
      expect(JSON.stringify(failed)).not.toContain('supersecret');
      const page = (await expectStatus(await api('/api/v1/ops/runs?limit=1'), 200)) as {
        items: { id: string }[];
        nextCursor: string | null;
      };
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeTruthy();
      const next = (await expectStatus(
        await api(`/api/v1/ops/runs?limit=1&cursor=${encodeURIComponent(page.nextCursor ?? '')}`),
        200,
      )) as { items: { id: string }[] };
      expect(next.items[0]?.id).not.toBe(page.items[0]?.id);

      const detail = (await expectStatus(await api(`/api/v1/ops/runs/${run.id}`), 200)) as {
        run: { id: string };
        requests: { error: string | null; runId: string | null }[];
        logs: { runId: string | null; message: string }[];
      };
      expect(detail.run.id).toBe(run.id);
      expect(detail.requests.some((item) => item.runId === run.id)).toBe(true);
      expect(detail.logs.some((item) => item.runId === run.id)).toBe(true);
      expect(JSON.stringify(detail)).not.toContain('supersecret');
      await expectStatus(await api('/api/v1/ops/runs/not-a-uuid'), 400);
      await expectStatus(await api('/api/v1/ops/runs/00000000-0000-4000-8000-000000000088'), 404);

      const requests = (await expectStatus(
        await api('/api/v1/ops/requests?endpoint=view/detail&limit=5'),
        200,
      )) as { items: { endpoint: string; error: string | null }[] };
      expect(requests.items.length).toBeGreaterThan(0);
      expect(requests.items.every((item) => item.endpoint === 'view/detail')).toBe(true);
      expect(JSON.stringify(requests)).not.toContain('supersecret');

      const logs = (await expectStatus(
        await api('/api/v1/ops/logs?level=error&service=api&requestId=req-sentinel&q=boom&limit=5'),
        200,
      )) as { items: { message: string; context: Record<string, unknown> }[] };
      expect(logs.items).toHaveLength(1);
      expect(logs.items[0]?.message).toContain('[redacted]');
      expect(logs.items[0]?.message).not.toContain('supersecret');
      expect(logs.items[0]?.context.password).toBeUndefined();
      expect(logs.items[0]?.context.note).toBe('visible');
      const logPage = (await expectStatus(await api('/api/v1/ops/logs?limit=1'), 200)) as {
        items: { id: string }[];
        nextCursor: string | null;
      };
      expect(logPage.nextCursor).toBeTruthy();
      const logNext = (await expectStatus(
        await api(
          `/api/v1/ops/logs?limit=1&cursor=${encodeURIComponent(logPage.nextCursor ?? '')}`,
        ),
        200,
      )) as { items: { id: string }[] };
      expect(logNext.items[0]?.id).not.toBe(logPage.items[0]?.id);
      await expectStatus(await api('/api/v1/ops/logs?level=nope'), 400);

      const health = (await expectStatus(await api('/api/v1/ops/health'), 200)) as {
        lastHeartbeatAt: string | null;
        stale: boolean;
        queueBacklog: number;
      };
      expect(health.lastHeartbeatAt).toBeTruthy();
      expect(health.stale).toBe(false);
      expect(health.queueBacklog).toBeGreaterThanOrEqual(0);

      const bundle = (await expectStatus(
        await api(`/api/v1/ops/debug/bundle?runId=${run.id}`),
        200,
      )) as { run: { id: string } | null; schemaVersion: string };
      expect(bundle.run?.id).toBe(run.id);
      expect(bundle.schemaVersion.length).toBeGreaterThan(0);
      expect(JSON.stringify(bundle)).not.toContain('supersecret');
      await expectStatus(await api('/api/v1/ops/debug/bundle'), 400);
      await expectStatus(await api('/api/v1/ops/metadata/runs/not-a-uuid'), 400);
    },
    30_000,
  );

  testChecked('registered routes, inventory, and executed requests reconcile', 'reconcile', () => {
    const registered = listRegisteredApiRoutes().map(routeKey);
    const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as {
      routes: { method: string; path: string }[];
    };
    const listed = inventory.routes.map((route) => routeKey(route)).sort();
    expect(listed).toEqual(registered);
    const executed = new Map<string, Hit[]>();
    for (const hit of hits) {
      const key = routeKey(hit);
      const list = executed.get(key) ?? [];
      list.push(hit);
      executed.set(key, list);
    }
    const missing = registered.filter(
      (key) => !(executed.get(key) ?? []).some((hit) => hit.status < 400),
    );
    expect(missing).toEqual([]);
    testOutcomes.set('reconcile', 'passed');
    writeCoverageReport();
    const report = JSON.parse(readFileSync(REPORT_JSON, 'utf8')) as {
      registeredCount: number;
      executedCount: number;
      httpSuccessCount: number;
      acceptedCount: number;
      acceptancePassed: boolean;
      upstreamFetchCount: number;
      databaseName: string;
    };
    expect(report.registeredCount).toBe(registered.length);
    expect(report.executedCount).toBe(registered.length);
    expect(report.httpSuccessCount).toBe(registered.length);
    expect(report.acceptedCount).toBe(registered.length);
    expect(report.acceptancePassed).toBe(true);
    expect(report.upstreamFetchCount).toBe(0);
    expect(report.databaseName).toBe(databaseName);
    expect(injectedUrls.length).toBeGreaterThan(0);
    expect(injectedUrls.every((url) => /bilibili\.com|hdslb\.com/i.test(url))).toBe(true);
    expect(outboundFetches.filter((url) => /bilibili\.(com|tv)|hdslb\.com/i.test(url))).toEqual([]);
  });
});

function needSql(): Sql {
  if (!sql) throw new Error('postgres missing');
  return sql;
}

function mkdtemp(prefix: string): string {
  const dir = join(prefix);
  mkdirSync(dir, { recursive: true });
  return dir;
}

type Tokens = Map<string, { id: string; updatedAt: string; status: string }>;

async function loadTokens(projectId: string): Promise<Tokens> {
  const graph = parseCommercialProjectWorkflow(
    await expectStatus(await api(`/api/v1/commercial/projects/${projectId}/workflow`), 200),
  );
  return new Map(graph.nodes.map((node) => [node.name, node]));
}

async function postNode(
  projectId: string,
  tokens: Tokens,
  name: string,
  action: string,
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const node = tokens.get(name);
  if (!node) throw new Error(`missing ${name}`);
  return api(
    `/api/v1/commercial/projects/${projectId}/nodes/${node.id}/${action}`,
    json('POST', {
      expectedUpdatedAt: node.updatedAt,
      ...extra,
    }),
  );
}

async function postNodeStep(
  projectId: string,
  tokens: Tokens,
  name: string,
  direction: 'forward' | 'rollback',
  extra: Record<string, unknown> = {},
): Promise<Response> {
  const node = tokens.get(name);
  if (!node) throw new Error(`missing ${name}`);
  return api(
    `/api/v1/commercial/projects/${projectId}/nodes/${node.id}/step`,
    json('POST', { expectedUpdatedAt: node.updatedAt, direction, ...extra }),
  );
}

async function postStage(
  projectId: string,
  tokens: Tokens,
  stageId: string,
  direction: 'forward' | 'rollback',
): Promise<Response> {
  const names =
    stageId === 'write_outline' ? ['大纲'] : stageId === 'copy_prep' ? ['文案', '预拍摄'] : [];
  return api(
    `/api/v1/commercial/projects/${projectId}/stages/${stageId}/step`,
    json('POST', {
      direction,
      tokens: names.map((name) => {
        const node = tokens.get(name);
        if (!node) throw new Error(`missing ${name}`);
        return { nodeId: node.id, expectedUpdatedAt: node.updatedAt };
      }),
    }),
  );
}

async function completeName(db: Sql, projectId: string, name: string): Promise<void> {
  let tokens = await loadTokens(projectId);
  const current = tokens.get(name);
  if (!current) throw new Error(`missing ${name}`);
  if (current.status === 'not_reached') {
    const advanced = parseCommercialNodeWriteResponse(
      await expectStatus(await postNode(projectId, tokens, name, 'advance'), 200),
    );
    expect(advanced.node.status).toBe('in_progress');
    tokens = await loadTokens(projectId);
  }
  if (tokens.get(name)?.status === 'in_progress') {
    const completed = parseCommercialNodeWriteResponse(
      await expectStatus(await postNode(projectId, tokens, name, 'complete'), 200),
    );
    expect(completed.node.status).toBe('completed');
  }
}

async function statusOf(db: Sql, projectId: string, name: string): Promise<string> {
  const [row] = await db<{ status: string }[]>`
    SELECT status FROM wf_nodes WHERE project_id = ${projectId} AND name = ${name}
  `;
  if (!row) throw new Error(`missing ${name}`);
  return row.status;
}

async function createProject(db: Sql, name: string): Promise<string> {
  const projectId = randomUUID();
  const workflowId = randomUUID();
  await db`INSERT INTO commercial_projects (id, name) VALUES (${projectId}, ${name})`;
  await db`
    INSERT INTO project_workflows (id, project_id, template_version_id)
    VALUES (${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE})
  `;
  const packages = await db<{ id: string; name: string; sort_order: number }[]>`
    SELECT id, name, sort_order FROM wf_template_packages WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  const packageMap = new Map<string, string>();
  for (const pkg of packages) {
    const id = randomUUID();
    packageMap.set(pkg.id, id);
    await db`
      INSERT INTO wf_packages (id, workflow_id, name, sort_order)
      VALUES (${id}, ${workflowId}, ${pkg.name}, ${pkg.sort_order})
    `;
  }
  const nodes = await db<
    {
      id: string;
      name: string;
      kind: string;
      phase: string;
      is_optional: boolean;
      pos_x: number;
      pos_y: number;
      package_id: string | null;
    }[]
  >`
    SELECT id, name, kind, phase, is_optional, pos_x, pos_y, package_id
    FROM wf_template_nodes WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  const nodeMap = new Map<string, string>();
  for (const node of nodes) {
    const id = randomUUID();
    nodeMap.set(node.id, id);
    const packageId = node.package_id ? (packageMap.get(node.package_id) ?? null) : null;
    await db`
      INSERT INTO wf_nodes (
        id, workflow_id, project_id, template_version_id, template_node_id, package_id,
        name, kind, phase, status, is_optional, pos_x, pos_y, source
      ) VALUES (
        ${id}, ${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE}, ${node.id}, ${packageId},
        ${node.name}, ${node.kind}, ${node.phase}, 'not_reached', ${node.is_optional},
        ${node.pos_x}, ${node.pos_y}, 'template'
      )
    `;
  }
  const edges = await db<{ from_node_id: string; to_node_id: string }[]>`
    SELECT from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${DEFAULT_TEMPLATE}
  `;
  for (const edge of edges) {
    const fromId = nodeMap.get(edge.from_node_id);
    const toId = nodeMap.get(edge.to_node_id);
    if (!fromId || !toId) throw new Error('template edge endpoint missing');
    await db`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      VALUES (${randomUUID()}, ${workflowId}, ${fromId}, ${toId})
    `;
  }
  return projectId;
}

function writeCoverageReport(): void {
  const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as {
    routes: {
      method: string;
      path: string;
      frontendCallers: InventoryCaller[];
      readWrite?: string;
    }[];
  };
  const report = buildHttpCoverageReport({
    registered: listRegisteredApiRoutes(),
    inventory: inventory.routes,
    hits,
    testOutcomes,
    databaseName: databaseName || null,
    upstreamFetchCount: outboundFetches.filter((url) => /bilibili\.(com|tv)|hdslb\.com/i.test(url))
      .length,
    injectedTransportCalls: injectedUrls.length,
  });
  mkdirSync(join(import.meta.dir, '../../../docs/architecture'), { recursive: true });
  writeFileSync(REPORT_JSON, `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(REPORT_MD, renderHttpCoverageMarkdown(report));
  spawnSync('bunx', ['prettier', '--write', REPORT_MD, REPORT_JSON], {
    cwd: join(import.meta.dir, '../../..'),
    stdio: 'ignore',
  });
}

async function fixtureImportCounts(db: Sql): Promise<{
  fixtureVideos: number;
  fixtureFans: number;
  sentinel: number;
}> {
  const [videos] = await db<{ count: string }[]>`
    SELECT count(*)::text AS count FROM video_metric_samples
    WHERE bvid IN ('BVTEST001', 'BVTEST002', 'BVTEST003', 'BVTEST_BAD')
  `;
  const [fans] = await db<{ count: string }[]>`
    SELECT count(*)::text AS count FROM creator_follower_samples WHERE mid = 12345
  `;
  const [sentinel] = await db<{ count: string }[]>`
    SELECT count(*)::text AS count FROM video_metric_samples WHERE bvid = 'BV1readsent1'
  `;
  return {
    fixtureVideos: Number(videos?.count ?? '0'),
    fixtureFans: Number(fans?.count ?? '0'),
    sentinel: Number(sentinel?.count ?? '0'),
  };
}
