import { describe, expect, test } from 'bun:test';
import { readBilibiliRuntimeConfig, type BilibiliRuntimeConfig } from './bilibili-config';
import { BilibiliFailure } from './bilibili-failure';
import { createBilibiliProvider } from './bilibili-provider';
import { installOfflineFetchGuard } from './network-guard';
import type { HttpTransport, TransportRequest } from './bilibili-transport';

installOfflineFetchGuard();

const pubdate = 1_720_000_000;

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

function viewBody(reply = 7) {
  return {
    code: 0,
    message: '0',
    data: {
      bvid: 'BV1xx411c7mD',
      cid: 123456789,
      pubdate,
      title: '示例标题',
      pic: 'https://i0.hdslb.com/bfs/archive/example.jpg',
      owner: { mid: 42, name: '示例UP' },
      stat: {
        view: 1000,
        danmaku: 10,
        reply,
        favorite: 8,
        coin: 9,
        share: 3,
        like: 20,
      },
    },
  };
}

function scripted(handler: (request: TransportRequest) => { status?: number; body: unknown }): {
  transport: HttpTransport;
  urls: string[];
  cookies: Array<string | undefined>;
} {
  const urls: string[] = [];
  const cookies: Array<string | undefined> = [];
  const transport: HttpTransport = async (request) => {
    urls.push(request.url);
    cookies.push(request.headers.Cookie);
    const found = handler(request);
    return {
      status: found.status ?? 200,
      body: JSON.stringify(found.body),
      headers: {},
      durationMs: 4,
    };
  };
  return { transport, urls, cookies };
}

describe('bilibili provider fixtures', () => {
  test('view maps every stat, including reply to comment_count, plus identity fields', async () => {
    const { transport, urls, cookies } = scripted((request) => {
      const url = new URL(request.url);
      if (url.pathname.endsWith('/online/total')) {
        return { body: { code: 0, data: { total: '1234+' } } };
      }
      return { body: viewBody() };
    });
    const provider = createBilibiliProvider(config(), { transport, random: () => 0 });
    const collectedAt = new Date(pubdate * 1000 + 24 * 60 * 60 * 1000);
    const sampledAt = new Date('2026-10-19T01:02:00.000Z');
    const result = await provider.fetchVideo({
      bvid: 'BV1xx411c7mD',
      sampledAt,
      collectedAt,
      cookieHeader: 'session=fixture',
      accountKey: 'account-1',
    });
    expect(result.view.viewCount).toBe(1000n);
    expect(result.view.danmakuCount).toBe(10n);
    expect(result.view.commentCount).toBe(7n);
    expect(result.view.favoriteCount).toBe(8n);
    expect(result.view.coinCount).toBe(9n);
    expect(result.view.shareCount).toBe(3n);
    expect(result.view.likeCount).toBe(20n);
    expect(result.view.cid).toBe('123456789');
    expect(result.view.pubdate.toISOString()).toBe(new Date(pubdate * 1000).toISOString());
    expect(result.view.title).toBe('示例标题');
    expect(result.view.ownerMid).toBe('42');
    expect(result.view.ownerName).toBe('示例UP');
    expect(result.view.coverUrl).toContain('example.jpg');
    expect(result.online).toEqual({ viewers: 1234n, raw: '1234+' });
    expect(result.sampledAt).toBe(sampledAt);
    expect(urls).toHaveLength(2);
    expect(urls.join(' ')).not.toContain('w_rid');
    expect(urls.join(' ')).not.toContain('wts=');
    expect(urls[1]).toContain('cid=123456789');
    expect(cookies).toEqual(['session=fixture', 'session=fixture']);
  });

  test('fetches online viewers for a 30 day old video', async () => {
    const { transport, urls } = scripted((request) => {
      if (new URL(request.url).pathname.endsWith('/online/total')) {
        return { body: { code: 0, data: { total: 12 } } };
      }
      return { body: viewBody() };
    });
    const provider = createBilibiliProvider(config(), { transport });
    const result = await provider.fetchVideo({
      bvid: 'BV1xx411c7mD',
      sampledAt: new Date(pubdate * 1000),
      collectedAt: new Date(pubdate * 1000 + 30 * 24 * 60 * 60 * 1000),
      cookieHeader: null,
      accountKey: 'anonymous',
    });
    expect(urls).toHaveLength(2);
    expect(result.online).toEqual({ viewers: 12n, raw: '12' });
  });

  test('a failed online call stores null viewers and keeps the raw text', async () => {
    const { transport } = scripted((request) => {
      if (new URL(request.url).pathname.endsWith('/online/total')) {
        return { body: { code: -400, message: '错误', data: { total: '88+' } } };
      }
      return { body: viewBody() };
    });
    const provider = createBilibiliProvider(config(), { transport });
    const result = await provider.fetchVideo({
      bvid: 'BV1xx411c7mD',
      sampledAt: new Date(),
      collectedAt: new Date(),
      cookieHeader: null,
      accountKey: 'anonymous',
    });
    expect(result.online).toEqual({ viewers: null, raw: '88+' });
    expect(result.view.commentCount).toBe(7n);
    expect(result.onlineFailure?.kind).toBe('retryable');
  });

  test('classifies -404, -352, -509, -101 and HTTP 500 without a live network', async () => {
    const cases: Array<{ body: unknown; status?: number; kind: string }> = [
      { body: { code: -404, message: '啥都木有' }, kind: 'not_found' },
      { body: { code: -352, message: '风控' }, kind: 'risk_control' },
      { body: { code: -412, message: '风控' }, kind: 'risk_control' },
      { body: { code: -509, message: '请求过于频繁' }, kind: 'rate_limited' },
      { body: { code: -101, message: '账号未登录' }, kind: 'unauthorized' },
      { body: { code: 0 }, status: 503, kind: 'retryable' },
    ];
    for (const item of cases) {
      const { transport } = scripted(() =>
        item.status === undefined ? { body: item.body } : { body: item.body, status: item.status },
      );
      const provider = createBilibiliProvider(config(), { transport });
      await expect(
        provider.fetchVideo({
          bvid: 'BV1xx411c7mD',
          sampledAt: new Date(),
          collectedAt: new Date(pubdate * 1000),
          cookieHeader: 'session=fixture-token',
          accountKey: 'a',
        }),
      ).rejects.toMatchObject({ kind: item.kind });
    }
  });

  test('a failure message does not echo the cookie', async () => {
    const { transport } = scripted(() => ({ body: { code: -352, message: '风控' } }));
    const provider = createBilibiliProvider(config(), { transport });
    const error = await provider
      .fetchVideo({
        bvid: 'BV1xx411c7mD',
        sampledAt: new Date(),
        collectedAt: new Date(),
        cookieHeader: 'SESSDATA=fixture-token',
        accountKey: 'a',
      })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(BilibiliFailure);
    expect(error instanceof Error ? error.message : '').not.toContain('fixture-token');
  });

  test('dry-run prints the view url and does not call transport', async () => {
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
    await expect(
      provider.fetchVideo({
        bvid: 'BV1xx411c7mD',
        sampledAt: new Date(),
        collectedAt: new Date(),
        cookieHeader: 'SESSDATA=fixture-token',
        accountKey: 'a',
      }),
    ).rejects.toMatchObject({ kind: 'dry_run' });
    expect(called).toBe(false);
    expect(lines.join('\n')).toContain('/x/web-interface/view?bvid=BV1xx411c7mD');
    expect(lines.join('\n')).not.toContain('fixture-token');
  });

  test('relation/stat maps follower and following', async () => {
    const { transport, urls } = scripted(() => ({
      body: { code: 0, data: { mid: 42, following: 15, follower: 900 } },
    }));
    const provider = createBilibiliProvider(config(), { transport });
    const result = await provider.fetchCreator({
      mid: '42',
      sampledAt: new Date('2026-10-19T01:00:00.000Z'),
      collectedAt: new Date(),
      cookieHeader: null,
      accountKey: 'anonymous',
    });
    expect(result.relation).toEqual({ followerCount: 900n, followingCount: 15n });
    expect(urls[0]).toContain('vmid=42');
    expect(urls[0]).not.toContain('w_rid');
  });
});
