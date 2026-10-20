import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase, type Sql } from '@studio/db';
import { createBilibiliProvider } from './bilibili-provider';
import { installOfflineFetchGuard } from './network-guard';
import { acquireRequestSlot } from './rate-limiter';
import type { HttpTransport } from './bilibili-transport';
import type { ThrottleClock } from './throttle';

installOfflineFetchGuard();

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

const ACCOUNT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';

describe('shared request slots', () => {
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

  test('two concurrent callers on one account cannot both pass the minute cap', async () => {
    if (!sql) return;
    const clock = fakeClock();
    const policy = { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 1 };
    await Promise.all([
      acquireRequestSlot(sql, ACCOUNT_A, policy, { clock, random: () => 0 }),
      acquireRequestSlot(sql, ACCOUNT_A, policy, { clock, random: () => 0 }),
    ]);
    expect(clock.elapsed()).toBe(60_000);
    const rows = await sql<{ count: number }[]>`
      SELECT count FROM collector_rate_state WHERE account_id = ${ACCOUNT_A}::uuid
    `;
    expect(rows[0]?.count).toBe(1);
  });

  test('a second account does not consume the first account budget', async () => {
    if (!sql) return;
    const clock = fakeClock();
    const policy = { minIntervalMs: 0, maxJitterMs: 0, maxPerMinute: 1 };
    const left = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11';
    const right = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb22';
    await Promise.all([
      acquireRequestSlot(sql, left, policy, { clock, random: () => 0 }),
      acquireRequestSlot(sql, right, policy, { clock, random: () => 0 }),
    ]);
    expect(clock.elapsed()).toBe(0);
  });

  test('view then online in one fetch waits at least minIntervalMs', async () => {
    if (!sql) return;
    const origin = 1_700_000_000_000;
    const clock = fakeClock();
    clock.now = () => origin + clock.elapsed();
    const seenAt: number[] = [];
    const transport: HttpTransport = async (request) => {
      seenAt.push(clock.now());
      const online = request.url.includes('/online/total');
      return {
        status: 200,
        headers: {},
        durationMs: 1,
        body: JSON.stringify(
          online
            ? { code: 0, data: { total: 3 } }
            : {
                code: 0,
                data: {
                  bvid: 'BV1jHnn63EEi',
                  cid: 5,
                  pubdate: 1_720_000_000,
                  title: '示例',
                  pic: 'https://i0.hdslb.com/a.jpg',
                  owner: { mid: 7, name: 'UP' },
                  stat: {
                    view: 1,
                    danmaku: 1,
                    reply: 1,
                    favorite: 1,
                    coin: 1,
                    share: 1,
                    like: 1,
                  },
                },
              },
        ),
      };
    };
    const interval = 30_000;
    const provider = createBilibiliProvider(
      {
        minIntervalMs: interval,
        maxJitterMs: 0,
        maxPerMinute: 2,
        timeoutMs: 1_000,
        dryRun: false,
        forcedAccountId: null,
        anonymousMinIntervalMs: interval,
      },
      {
        transport,
        sql,
        clock,
        random: () => 0,
      },
    );
    await provider.fetchVideo({
      bvid: 'BV1jHnn63EEi',
      sampledAt: new Date('2026-10-20T00:33:20.000Z'),
      collectedAt: new Date('2026-10-20T00:33:20.000Z'),
      cookieHeader: 'session=fixture',
      accountKey: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd5',
    });
    expect(seenAt).toHaveLength(2);
    const gap = (seenAt[1] ?? 0) - (seenAt[0] ?? 0);
    console.log(`view→online gap ${gap}ms`);
    expect(gap).toBeGreaterThanOrEqual(interval);
  });

  test('in-memory throttle also spaces the second request of one fetch', async () => {
    const clock = fakeClock();
    const seenAt: number[] = [];
    const transport: HttpTransport = async (request) => {
      seenAt.push(clock.now());
      const online = request.url.includes('/online/total');
      return {
        status: 200,
        headers: {},
        durationMs: 1,
        body: JSON.stringify(
          online
            ? { code: 0, data: { total: 3 } }
            : {
                code: 0,
                data: {
                  bvid: 'BV1jHnn63EEi',
                  cid: 5,
                  pubdate: 1_720_000_000,
                  title: '示例',
                  owner: { mid: 7, name: 'UP' },
                  stat: {
                    view: 1,
                    danmaku: 1,
                    reply: 1,
                    favorite: 1,
                    coin: 1,
                    share: 1,
                    like: 1,
                  },
                },
              },
        ),
      };
    };
    const interval = 30_000;
    const provider = createBilibiliProvider(
      {
        minIntervalMs: interval,
        maxJitterMs: 0,
        maxPerMinute: 2,
        timeoutMs: 1_000,
        dryRun: false,
        forcedAccountId: null,
        anonymousMinIntervalMs: interval,
      },
      { transport, clock, random: () => 0 },
    );
    await provider.fetchVideo({
      bvid: 'BV1jHnn63EEi',
      sampledAt: new Date('2026-10-20T00:33:20.000Z'),
      collectedAt: new Date('2026-10-20T00:33:20.000Z'),
      cookieHeader: 'session=fixture',
      accountKey: 'account-1',
    });
    const gap = (seenAt[1] ?? 0) - (seenAt[0] ?? 0);
    console.log(`in-memory view→online gap ${gap}ms`);
    expect(gap).toBeGreaterThanOrEqual(interval);
  });

  test('minimum interval is shared across two provider instances', async () => {
    if (!sql) return;
    const clock = fakeClock();
    const urls: string[] = [];
    const transport: HttpTransport = async (request) => {
      urls.push(request.url);
      const online = request.url.includes('/online/total');
      return {
        status: 200,
        headers: {},
        durationMs: 1,
        body: JSON.stringify(
          online
            ? { code: 0, data: { total: 3 } }
            : {
                code: 0,
                data: {
                  bvid: 'BV1xx411c7mD',
                  cid: 5,
                  pubdate: 1_720_000_000,
                  title: '示例',
                  pic: 'https://i0.hdslb.com/a.jpg',
                  owner: { mid: 7, name: 'UP' },
                  stat: {
                    view: 1,
                    danmaku: 1,
                    reply: 1,
                    favorite: 1,
                    coin: 1,
                    share: 1,
                    like: 1,
                  },
                },
              },
        ),
      };
    };
    const config = {
      minIntervalMs: 1_000,
      maxJitterMs: 0,
      maxPerMinute: 100,
      timeoutMs: 1_000,
      dryRun: false,
      forcedAccountId: null,
      anonymousMinIntervalMs: 1_000,
    };
    const first = createBilibiliProvider(config, {
      transport,
      sql,
      clock,
      random: () => 0,
    });
    const second = createBilibiliProvider(config, {
      transport,
      sql,
      clock,
      random: () => 0,
    });
    const input = {
      bvid: 'BV1xx411c7mD',
      sampledAt: new Date('2026-10-19T00:00:00.000Z'),
      collectedAt: new Date('2026-10-19T00:00:01.000Z'),
      cookieHeader: null,
      accountKey: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3',
    };
    await Promise.all([first.fetchVideo(input), second.fetchVideo(input)]);
    expect(urls).toHaveLength(4);
    expect(clock.elapsed()).toBe(3_000);
  });
});
