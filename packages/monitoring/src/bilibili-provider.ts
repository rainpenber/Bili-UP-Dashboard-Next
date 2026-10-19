import type { Sql } from '@studio/db';
import type { MonitorProvider } from './offline-provider';
import type { BilibiliRuntimeConfig } from './bilibili-config';
import {
  BilibiliFailure,
  classifyBilibiliResponse,
  type FailureKind,
  type UpstreamCall,
  type UpstreamEndpoint,
} from './bilibili-failure';
import {
  onlineRawFromPayload,
  parseOnlineTotal,
  parseRelation,
  parseView,
  readBizCode,
  type ParsedRelation,
  type ParsedView,
} from './bilibili-parse';
import { scrubSensitive } from './sensitive';
import {
  bilibiliHeaders,
  createLiveBilibiliTransport,
  guardTransport,
  type HttpTransport,
} from './bilibili-transport';
import { acquireRequestSlot, rateAccountId } from './rate-limiter';
import { createAccountThrottle, type ThrottleClock } from './throttle';

const VIEW_URL = 'https://api.bilibili.com/x/web-interface/view';
const ONLINE_URL = 'https://api.bilibili.com/x/player/online/total';
const RELATION_URL = 'https://api.bilibili.com/x/relation/stat';

export type VideoFetchResult = {
  bvid: string;
  sampledAt: Date;
  collectedAt: Date;
  view: ParsedView;
  online: { viewers: bigint | null; raw: string | null } | null;
  calls: UpstreamCall[];
  onlineFailure: { kind: FailureKind; message: string } | null;
  extra: Record<string, unknown>;
};

export type CreatorFetchResult = {
  mid: string;
  sampledAt: Date;
  collectedAt: Date;
  relation: ParsedRelation;
  calls: UpstreamCall[];
  extra: Record<string, unknown>;
};

export type BilibiliProvider = MonitorProvider & {
  readonly id: 'bilibili';
  fetchVideo(input: {
    bvid: string;
    sampledAt: Date;
    collectedAt: Date;
    cookieHeader: string | null;
    accountKey: string;
  }): Promise<VideoFetchResult>;
  fetchCreator(input: {
    mid: string;
    sampledAt: Date;
    collectedAt: Date;
    cookieHeader: string | null;
    accountKey: string;
  }): Promise<CreatorFetchResult>;
};

function endpointUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export function isBilibiliProvider(provider: MonitorProvider): provider is BilibiliProvider {
  return provider.id === 'bilibili';
}

export function createBilibiliProvider(
  config: BilibiliRuntimeConfig,
  overrides: {
    transport?: HttpTransport;
    random?: () => number;
    clock?: ThrottleClock;
    log?: (line: string) => void;
    /** When set, every upstream call shares the database rate budget. */
    sql?: Sql;
  } = {},
): BilibiliProvider {
  const transport = guardTransport(
    overrides.transport ?? createLiveBilibiliTransport(config.timeoutMs),
  );
  const throttle = overrides.sql
    ? null
    : createAccountThrottle({
        minIntervalMs: config.minIntervalMs,
        maxJitterMs: config.maxJitterMs,
        maxPerMinute: config.maxPerMinute,
        ...(overrides.random ? { random: overrides.random } : {}),
        ...(overrides.clock ? { clock: overrides.clock } : {}),
      });
  const log = overrides.log ?? (() => undefined);

  async function waitTurn(accountKey: string, interval: number): Promise<void> {
    if (overrides.sql) {
      await acquireRequestSlot(
        overrides.sql,
        rateAccountId(accountKey),
        {
          minIntervalMs: interval,
          maxJitterMs: config.maxJitterMs,
          maxPerMinute: config.maxPerMinute,
        },
        {
          ...(overrides.random ? { random: overrides.random } : {}),
          ...(overrides.clock ? { clock: overrides.clock } : {}),
        },
      );
      return;
    }
    if (!throttle) throw new Error('限流器未初始化');
    await throttle.wait(accountKey, interval);
  }

  async function request(
    endpoint: UpstreamEndpoint,
    url: string,
    cookieHeader: string | null,
    accountKey: string,
    calls: UpstreamCall[],
  ): Promise<unknown> {
    const interval = cookieHeader
      ? config.minIntervalMs
      : Math.max(config.minIntervalMs, config.anonymousMinIntervalMs);
    await waitTurn(accountKey, interval);
    let response;
    try {
      response = await transport({ url, method: 'GET', headers: bilibiliHeaders(cookieHeader) });
    } catch (error) {
      const message = scrubSensitive(error instanceof Error ? error.message : '上游网络失败');
      const call: UpstreamCall = {
        endpoint,
        statusCode: null,
        bizCode: null,
        durationMs: 0,
        error: message,
      };
      calls.push(call);
      throw new BilibiliFailure({
        message,
        kind: 'retryable',
        endpoint,
        statusCode: null,
        bizCode: null,
        calls: [...calls],
      });
    }
    let payload: unknown;
    try {
      payload = JSON.parse(response.body) as unknown;
    } catch {
      const call: UpstreamCall = {
        endpoint,
        statusCode: response.status,
        bizCode: null,
        durationMs: response.durationMs,
        error: '响应不是 JSON',
      };
      calls.push(call);
      throw new BilibiliFailure({
        message: `${endpoint} 响应不是 JSON`,
        kind: 'retryable',
        endpoint,
        statusCode: response.status,
        bizCode: null,
        calls: [...calls],
      });
    }
    const biz = readBizCode(payload);
    const kind = classifyBilibiliResponse({
      statusCode: response.status,
      bizCode: biz.code,
      timedOut: false,
    });
    const call: UpstreamCall = {
      endpoint,
      statusCode: response.status,
      bizCode: biz.code,
      durationMs: response.durationMs,
      error: kind ? biz.message || kind : null,
    };
    calls.push(call);
    if (kind) {
      const detail = biz.message ? ` ${biz.message}` : '';
      throw new BilibiliFailure({
        message: scrubSensitive(`${endpoint} 业务码 ${biz.code ?? response.status}${detail}`),
        kind,
        endpoint,
        statusCode: response.status,
        bizCode: biz.code,
        calls: [...calls],
        payload,
      });
    }
    return payload;
  }

  return {
    id: 'bilibili',
    async collectVideo() {
      throw new Error('bilibili 视频采集请走 fetchVideo');
    },
    async collectCreator() {
      throw new Error('bilibili UP 主采集请走 fetchCreator');
    },
    async fetchVideo(input) {
      const viewUrl = endpointUrl(VIEW_URL, { bvid: input.bvid });
      if (config.dryRun) {
        const message = `dry-run GET ${viewUrl}\ndry-run GET ${ONLINE_URL}?bvid=${input.bvid}`;
        log(`[collector] ${message}`);
        throw new BilibiliFailure({
          message,
          kind: 'dry_run',
          endpoint: 'view',
          statusCode: null,
          bizCode: null,
          calls: [],
        });
      }
      const calls: UpstreamCall[] = [];
      const payload = await request('view', viewUrl, input.cookieHeader, input.accountKey, calls);
      let view;
      try {
        view = parseView(payload);
      } catch (error) {
        throw new BilibiliFailure({
          message: scrubSensitive(error instanceof Error ? error.message : 'view 解析失败'),
          kind: 'retryable',
          endpoint: 'view',
          statusCode: calls.at(-1)?.statusCode ?? null,
          bizCode: calls.at(-1)?.bizCode ?? null,
          calls: [...calls],
        });
      }
      let online: { viewers: bigint | null; raw: string | null } | null = null;
      let onlineFailure: VideoFetchResult['onlineFailure'] = null;
      const onlineUrl = endpointUrl(ONLINE_URL, { bvid: input.bvid, cid: view.cid });
      try {
        const onlinePayload = await request(
          'online',
          onlineUrl,
          input.cookieHeader,
          input.accountKey,
          calls,
        );
        try {
          online = parseOnlineTotal(onlinePayload);
        } catch (error) {
          online = { viewers: null, raw: onlineRawFromPayload(onlinePayload) };
          onlineFailure = {
            kind: 'retryable',
            message: scrubSensitive(error instanceof Error ? error.message : 'online 解析失败'),
          };
        }
      } catch (error) {
        if (!(error instanceof BilibiliFailure)) throw error;
        online = { viewers: null, raw: onlineRawFromPayload(error.payload) };
        onlineFailure = { kind: error.kind, message: error.message };
      }
      const extra: Record<string, unknown> = {
        online: online !== null && online.viewers !== null ? 'fetched' : 'failed',
      };
      if (onlineFailure) extra.onlineError = onlineFailure.kind;
      return {
        bvid: input.bvid,
        sampledAt: input.sampledAt,
        collectedAt: input.collectedAt,
        view,
        online,
        calls,
        onlineFailure,
        extra,
      };
    },
    async fetchCreator(input) {
      const url = endpointUrl(RELATION_URL, { vmid: input.mid });
      if (config.dryRun) {
        const message = `dry-run GET ${url}`;
        log(`[collector] ${message}`);
        throw new BilibiliFailure({
          message,
          kind: 'dry_run',
          endpoint: 'relation_stat',
          statusCode: null,
          bizCode: null,
          calls: [],
        });
      }
      const calls: UpstreamCall[] = [];
      const payload = await request(
        'relation_stat',
        url,
        input.cookieHeader,
        input.accountKey,
        calls,
      );
      let relation;
      try {
        relation = parseRelation(payload);
      } catch (error) {
        throw new BilibiliFailure({
          message: scrubSensitive(error instanceof Error ? error.message : 'relation 解析失败'),
          kind: 'retryable',
          endpoint: 'relation_stat',
          statusCode: calls.at(-1)?.statusCode ?? null,
          bizCode: calls.at(-1)?.bizCode ?? null,
          calls: [...calls],
        });
      }
      return {
        mid: input.mid,
        sampledAt: input.sampledAt,
        collectedAt: input.collectedAt,
        relation,
        calls,
        extra: {},
      };
    },
  };
}
