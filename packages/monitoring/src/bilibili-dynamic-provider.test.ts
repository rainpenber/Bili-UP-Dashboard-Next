import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase, type Sql } from '@studio/db';
import { readBilibiliRuntimeConfig, type BilibiliRuntimeConfig } from './bilibili-config';
import { BilibiliFailure, classifyBilibiliResponse } from './bilibili-failure';
import { createBilibiliProvider } from './bilibili-provider';
import {
  BILIBILI_REFERER,
  BILIBILI_USER_AGENT,
  TransportFailure,
  type HttpTransport,
  type TransportRequest,
} from './bilibili-transport';
import { installOfflineFetchGuard } from './network-guard';
import { createMonitorProvider } from './offline-provider';
import type { ThrottleClock } from './throttle';

installOfflineFetchGuard();

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/dynamic');
const DRAW_ID = '967717348014293017';
const ACCOUNT = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';

function config(patch: Partial<BilibiliRuntimeConfig> = {}): BilibiliRuntimeConfig {
  return {
    ...readBilibiliRuntimeConfig({}),
    minIntervalMs: 0,
    maxJitterMs: 0,
    maxPerMinute: 20,
    anonymousMinIntervalMs: 0,
    dryRun: false,
    ...patch,
  };
}

function drawPayload(): unknown {
  return JSON.parse(readFileSync(join(fixtureRoot, 'detail-draw.json'), 'utf8'));
}

function forwardPayload(): unknown {
  return JSON.parse(readFileSync(join(fixtureRoot, 'detail-forward.json'), 'utf8'));
}

function scripted(
  handler: (request: TransportRequest) => { status?: number; body?: unknown; raw?: string },
): {
  transport: HttpTransport;
  urls: string[];
  headers: TransportRequest['headers'][];
} {
  const urls: string[] = [];
  const headers: TransportRequest['headers'][] = [];
  const transport: HttpTransport = async (request) => {
    urls.push(request.url);
    headers.push(request.headers);
    const found = handler(request);
    return {
      status: found.status ?? 200,
      body: found.raw ?? JSON.stringify(found.body),
      headers: {},
      durationMs: 4,
    };
  };
  return { transport, urls, headers };
}

function dynamicInput(dynamicId = DRAW_ID, cookieHeader: string | null = null) {
  return {
    dynamicId,
    sampledAt: new Date('2026-10-21T01:02:00.000Z'),
    collectedAt: new Date('2026-10-21T01:02:03.000Z'),
    cookieHeader,
    accountKey: ACCOUNT,
  };
}

function viewBody() {
  return {
    code: 0,
    data: {
      bvid: 'BV1xx411c7mD',
      cid: 5,
      pubdate: 1_720_000_000,
      title: '示例',
      pic: 'https://i0.hdslb.com/a.jpg',
      owner: { mid: 7, name: 'UP' },
      stat: { view: 1, danmaku: 1, reply: 1, favorite: 1, coin: 1, share: 1, like: 1 },
    },
  };
}

function fakeClock(): ThrottleClock & { elapsed(): number } {
  let now = 0;
  return {
    now: () => now,
    sleep: async (ms: number) => {
      now += ms;
    },
    elapsed: () => now,
  };
}

describe('fetchDynamic', () => {
  test('offline provider does not grow a dynamic fetch method', () => {
    const provider = createMonitorProvider('offline', {
      MOCK_DATA_ROOT: '/tmp/studio-dynamic-provider-offline',
    });
    expect('fetchDynamic' in provider).toBe(false);
  });

  test('one documented detail response is one request and keeps the string id', async () => {
    const { transport, urls, headers } = scripted(() => ({ body: drawPayload() }));
    const provider = createBilibiliProvider(config(), { transport, random: () => 0 });
    const input = dynamicInput(DRAW_ID, 'SESSDATA=fixture-token');
    const result = await provider.fetchDynamic(input);
    expect(result.dynamicId).toBe(DRAW_ID);
    expect(result.detail.likeCount).toBe(65n);
    expect(result.detail.commentCount).toBe(34n);
    expect(result.detail.repostCount).toBe(2n);
    expect(result.detail.authorMid).toBe('645769214');
    expect(result.sampledAt).toBe(input.sampledAt);
    expect(result.collectedAt).toBe(input.collectedAt);
    expect(urls).toHaveLength(1);
    const url = new URL(urls[0] ?? '');
    expect(url.origin + url.pathname).toBe(
      'https://api.bilibili.com/x/polymer/web-dynamic/v1/detail',
    );
    expect(url.searchParams.get('id')).toBe(DRAW_ID);
    expect([...url.searchParams.keys()]).toEqual(['id']);
    expect(headers[0]).toEqual({
      'User-Agent': BILIBILI_USER_AGENT,
      Referer: BILIBILI_REFERER,
      Cookie: 'SESSDATA=fixture-token',
    });
    expect(result.calls).toEqual([
      {
        endpoint: 'dynamic_detail',
        statusCode: 200,
        bizCode: 0,
        durationMs: 4,
        error: null,
      },
    ]);
    expect(JSON.stringify(result.calls)).not.toContain('fixture-token');
  });

  test('a forward keeps this item’s counts and does not issue another request', async () => {
    const { transport, urls } = scripted(() => ({ body: forwardPayload() }));
    const provider = createBilibiliProvider(config(), { transport });
    const result = await provider.fetchDynamic(dynamicInput('966692349750018048'));
    expect(urls).toHaveLength(1);
    expect(result.detail.likeCount).toBe(3088n);
    expect(result.detail.commentCount).toBe(88n);
    expect(result.detail.repostCount).toBe(12n);
    expect(result.detail.authorName).toBe('合成转发者');
    expect(result.detail.text).toBe('转发附言，不是原帖正文');
  });

  test('classifies documented and existing failure codes without a second call', async () => {
    const cases: Array<{ body: unknown; status?: number; kind: string; bizCode: number | null }> = [
      { body: { code: -101, message: '账号未登录' }, kind: 'unauthorized', bizCode: -101 },
      { body: { code: -352, message: '风控' }, kind: 'risk_control', bizCode: -352 },
      { body: { code: -412, message: '风控' }, kind: 'risk_control', bizCode: -412 },
      { body: { code: 0, message: '0' }, status: 412, kind: 'risk_control', bizCode: 0 },
      { body: { code: -509, message: '请求过于频繁' }, kind: 'rate_limited', bizCode: -509 },
      { body: { code: -404, message: '啥都木有' }, kind: 'not_found', bizCode: -404 },
      { body: { code: 0, message: '0' }, status: 404, kind: 'not_found', bizCode: 0 },
      { body: { code: 0, message: '0' }, status: 503, kind: 'retryable', bizCode: 0 },
      { body: { code: 4101139, message: '4101139' }, kind: 'retryable', bizCode: 4101139 },
    ];
    expect(classifyBilibiliResponse({ statusCode: 200, bizCode: 4101139, timedOut: false })).toBe(
      'retryable',
    );
    for (const item of cases) {
      const { transport, urls } = scripted(() =>
        item.status === undefined ? { body: item.body } : { body: item.body, status: item.status },
      );
      const provider = createBilibiliProvider(config(), { transport });
      const error = await provider.fetchDynamic(dynamicInput()).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(BilibiliFailure);
      expect(error).toMatchObject({
        kind: item.kind,
        endpoint: 'dynamic_detail',
        bizCode: item.bizCode,
      });
      expect(urls).toHaveLength(1);
      expect(urls[0]).not.toContain('w_rid');
      expect(urls[0]).not.toContain('wts=');
      expect(urls[0]).not.toContain('/nav');
      expect(urls[0]).not.toContain('qrcode');
      expect(urls[0]).not.toContain('/feed/');
    }
  });

  test('invalid JSON, a missing item, and a mismatched id fail after exactly one request', async () => {
    const cases: Array<{ raw?: string; body?: unknown; message: string }> = [
      { raw: '{', message: '响应不是 JSON' },
      { body: { code: 0, data: {} }, message: '动态详情缺少 item' },
      {
        body: {
          code: 0,
          data: { item: { id_str: '326122895', modules: { module_stat: { like: { count: 9 } } } } },
        },
        message: '动态 id 与请求不一致',
      },
    ];
    for (const item of cases) {
      const { transport, urls } = scripted(() =>
        item.raw === undefined ? { body: item.body } : { raw: item.raw },
      );
      const provider = createBilibiliProvider(config(), { transport });
      const error = await provider
        .fetchDynamic(dynamicInput(DRAW_ID, 'SESSDATA=fixture-token'))
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ kind: 'retryable', endpoint: 'dynamic_detail' });
      expect(error instanceof Error ? error.message : '').toContain(item.message);
      expect(error instanceof Error ? error.message : '').not.toContain('fixture-token');
      expect(urls).toHaveLength(1);
    }
  });

  test('a timeout is the existing retryable failure and does not retry', async () => {
    let calls = 0;
    const transport: HttpTransport = async () => {
      calls += 1;
      throw new TransportFailure('上游请求超时 SESSDATA=fixture-token', true);
    };
    const provider = createBilibiliProvider(config(), { transport });
    const error = await provider
      .fetchDynamic(dynamicInput(DRAW_ID, 'SESSDATA=fixture-token'))
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      kind: 'retryable',
      endpoint: 'dynamic_detail',
      statusCode: null,
      bizCode: null,
    });
    expect(error instanceof BilibiliFailure ? error.calls : []).toHaveLength(1);
    expect(error instanceof Error ? error.message : '').toContain('超时');
    expect(error instanceof Error ? error.message : '').not.toContain('fixture-token');
    expect(calls).toBe(1);
  });

  test('dry-run logs the detail url and does not call transport', async () => {
    let called = false;
    const transport: HttpTransport = async () => {
      called = true;
      throw new Error('network');
    };
    const lines: string[] = [];
    const provider = createBilibiliProvider(config({ dryRun: true }), {
      transport,
      log: (line) => lines.push(line),
    });
    const error = await provider
      .fetchDynamic(dynamicInput(DRAW_ID, 'SESSDATA=fixture-token'))
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ kind: 'dry_run', endpoint: 'dynamic_detail', calls: [] });
    expect(called).toBe(false);
    expect(lines.join('\n')).toContain(
      `dry-run GET https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${DRAW_ID}`,
    );
    expect(lines.join('\n')).not.toContain('fixture-token');
  });

  test('an invalid id does not build a request, even in dry-run', async () => {
    let called = false;
    const transport: HttpTransport = async () => {
      called = true;
      throw new Error('network');
    };
    const lines: string[] = [];
    for (const dryRun of [false, true]) {
      const provider = createBilibiliProvider(config({ dryRun }), {
        transport,
        log: (line) => lines.push(line),
      });
      for (const dynamicId of ['', '0', '01', '12.5', 'SESSDATA=fixture-token']) {
        const error = await provider
          .fetchDynamic(dynamicInput(dynamicId, 'SESSDATA=fixture-token'))
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(BilibiliFailure);
        expect(error instanceof Error ? error.message : '').toBe('动态 id 必须是十进制整数字符串');
        expect(error instanceof Error ? error.message : '').not.toContain('fixture-token');
      }
    }
    expect(called).toBe(false);
    expect(lines).toEqual([]);
  });

  test('video, dynamic, and creator calls share one in-memory budget', async () => {
    const clock = fakeClock();
    const urls: string[] = [];
    const transport: HttpTransport = async (request) => {
      urls.push(request.url);
      const path = new URL(request.url).pathname;
      const body = path.endsWith('/detail')
        ? drawPayload()
        : path.endsWith('/stat')
          ? { code: 0, data: { mid: 7, following: 1, follower: 2 } }
          : path.endsWith('/online/total')
            ? { code: 0, data: { total: 3 } }
            : viewBody();
      return { status: 200, headers: {}, durationMs: 1, body: JSON.stringify(body) };
    };
    const provider = createBilibiliProvider(
      config({ minIntervalMs: 1_000, anonymousMinIntervalMs: 1_000, maxPerMinute: 100 }),
      { transport, clock, random: () => 0 },
    );
    const sampledAt = new Date('2026-10-21T00:00:00.000Z');
    const collectedAt = new Date('2026-10-21T00:00:01.000Z');
    await provider.fetchVideo({
      bvid: 'BV1xx411c7mD',
      sampledAt,
      collectedAt,
      cookieHeader: null,
      accountKey: ACCOUNT,
    });
    await provider.fetchDynamic(dynamicInput());
    await provider.fetchCreator({
      mid: '7',
      sampledAt,
      collectedAt,
      cookieHeader: null,
      accountKey: ACCOUNT,
    });
    expect(urls.map((url) => new URL(url).pathname)).toEqual([
      '/x/web-interface/view',
      '/x/player/online/total',
      '/x/polymer/web-dynamic/v1/detail',
      '/x/relation/stat',
    ]);
    expect(clock.elapsed()).toBe(3_000);
  });

  test('anonymous dynamic calls use the shared anonymous interval', async () => {
    const clock = fakeClock();
    const transport: HttpTransport = async () => ({
      status: 200,
      headers: {},
      durationMs: 1,
      body: JSON.stringify(drawPayload()),
    });
    const provider = createBilibiliProvider(
      config({ minIntervalMs: 0, anonymousMinIntervalMs: 5_000, maxPerMinute: 100 }),
      { transport, clock, random: () => 0 },
    );
    await provider.fetchDynamic(dynamicInput());
    await provider.fetchDynamic(dynamicInput());
    expect(clock.elapsed()).toBe(5_000);
  });
});

describe('fetchDynamic shares the sql rate budget', () => {
  const created: string[] = [];
  let sql: Sql | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated) return;
    created.push(isolated.databaseName);
    sql = isolated.sql;
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    for (const name of created) await dropIsolatedTestDatabase(name).catch(() => undefined);
  });

  test('video, dynamic, and creator calls consume one account row', async () => {
    if (!sql) return;
    const clock = fakeClock();
    const urls: string[] = [];
    const transport: HttpTransport = async (request) => {
      urls.push(request.url);
      const path = new URL(request.url).pathname;
      const body = path.endsWith('/detail')
        ? drawPayload()
        : path.endsWith('/stat')
          ? { code: 0, data: { mid: 7, following: 1, follower: 2 } }
          : path.endsWith('/online/total')
            ? { code: 0, data: { total: 3 } }
            : viewBody();
      return { status: 200, headers: {}, durationMs: 1, body: JSON.stringify(body) };
    };
    const runtime = config({
      minIntervalMs: 1_000,
      anonymousMinIntervalMs: 1_000,
      maxPerMinute: 100,
    });
    const videoProvider = createBilibiliProvider(runtime, {
      transport,
      sql,
      clock,
      random: () => 0,
    });
    const dynamicProvider = createBilibiliProvider(runtime, {
      transport,
      sql,
      clock,
      random: () => 0,
    });
    const sampledAt = new Date('2026-10-21T00:00:00.000Z');
    const collectedAt = new Date('2026-10-21T00:00:01.000Z');
    await videoProvider.fetchVideo({
      bvid: 'BV1xx411c7mD',
      sampledAt,
      collectedAt,
      cookieHeader: null,
      accountKey: ACCOUNT,
    });
    await dynamicProvider.fetchDynamic(dynamicInput());
    await videoProvider.fetchCreator({
      mid: '7',
      sampledAt,
      collectedAt,
      cookieHeader: null,
      accountKey: ACCOUNT,
    });
    expect(urls).toHaveLength(4);
    expect(clock.elapsed()).toBe(3_000);
    const rows = await sql<{ count: number }[]>`
      SELECT count FROM collector_rate_state WHERE account_id = ${ACCOUNT}::uuid
    `;
    expect(Number(rows[0]?.count)).toBe(4);
  });
});
