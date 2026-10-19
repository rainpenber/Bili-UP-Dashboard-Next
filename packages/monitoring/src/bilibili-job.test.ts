import { describe, expect, test } from 'bun:test';
import type { ClaimedCollectorJob, VideoSampleWrite } from '@studio/db';
import { BilibiliFailure, planBilibiliFailure, retryDelayMinutes } from './bilibili-failure';
import type { BilibiliEffects } from './bilibili-job';
import { runBilibiliJob } from './bilibili-job';
import type { BilibiliProvider, VideoFetchResult } from './bilibili-provider';

function job(patch: Partial<ClaimedCollectorJob> = {}): ClaimedCollectorJob {
  return {
    id: 'job-1',
    targetId: 'target-1',
    targetType: 'video',
    externalId: 'BV1xx411c7mD',
    attempts: 1,
    scheduledFor: new Date('2026-10-19T01:02:03.000Z'),
    accountId: null,
    ...patch,
  };
}

function provider(fetchVideo: BilibiliProvider['fetchVideo']): BilibiliProvider {
  return {
    id: 'bilibili',
    collectVideo: async () => {
      throw new Error('unused');
    },
    collectCreator: async () => {
      throw new Error('unused');
    },
    fetchVideo,
    fetchCreator: async () => {
      throw new Error('unused');
    },
  };
}

function effects(patch: Partial<BilibiliEffects> = {}): BilibiliEffects & {
  videos: Map<string, VideoSampleWrite>;
  disabled: string[];
  circuits: Array<{ accountId: string; resumeAt: Date }>;
  deferred: Date[];
  expired: string[];
} {
  const videos = new Map<string, VideoSampleWrite>();
  const disabled: string[] = [];
  const circuits: Array<{ accountId: string; resumeAt: Date }> = [];
  const deferred: Date[] = [];
  const expired: string[] = [];
  const base: BilibiliEffects = {
    resolveAccount: async () => null,
    readCircuit: async () => null,
    openCircuit: async (input) => {
      circuits.push(input);
    },
    clearCircuit: async () => undefined,
    expireAccount: async (accountId) => {
      expired.push(accountId);
    },
    disableTarget: async (targetId) => {
      disabled.push(targetId);
    },
    deferJob: async (_jobId, until) => {
      deferred.push(until);
    },
    cookieHeaderFor: async () => null,
    commitVideo: async (input) => {
      const key = `${input.sample.bvid}|${input.sample.sampledAt.toISOString()}`;
      if (videos.has(key)) return { inserted: false, runId: 'run-dup' };
      videos.set(key, input.sample);
      return { inserted: true, runId: 'run-1' };
    },
    commitCreator: async () => ({ inserted: true, runId: 'run-c' }),
    failJob: async () => ({ runId: 'run-fail' }),
    audit: async () => undefined,
    markUsed: async () => undefined,
  };
  return { videos, disabled, circuits, deferred, expired, ...base, ...patch };
}

const view: VideoFetchResult = {
  bvid: 'BV1xx411c7mD',
  sampledAt: new Date('2026-10-19T01:02:03.000Z'),
  collectedAt: new Date('2026-10-19T01:02:09.000Z'),
  view: {
    cid: '99',
    pubdate: new Date('2026-10-18T00:00:00.000Z'),
    title: '标题',
    ownerMid: '7',
    ownerName: 'UP',
    coverUrl: null,
    viewCount: 11n,
    danmakuCount: 2n,
    commentCount: 7n,
    favoriteCount: 3n,
    coinCount: 4n,
    shareCount: 5n,
    likeCount: 6n,
  },
  online: { viewers: 1234n, raw: '1234+' },
  calls: [],
  onlineFailure: null,
  extra: {},
};

describe('bilibili failure plans', () => {
  test('backs off by minutes and caps at 30', () => {
    expect(retryDelayMinutes(1)).toBe(2);
    expect(retryDelayMinutes(2)).toBe(4);
    expect(retryDelayMinutes(5)).toBe(30);
    const now = new Date('2026-10-19T00:00:00.000Z');
    const retry = planBilibiliFailure({
      kind: 'retryable',
      attempts: 1,
      maxAttempts: 3,
      now,
    });
    expect(retry).toMatchObject({ action: 'retry', terminal: false });
    if (retry.action === 'retry') {
      expect(retry.retryAt?.toISOString()).toBe('2026-10-19T00:02:00.000Z');
    }
    const risk = planBilibiliFailure({
      kind: 'risk_control',
      attempts: 1,
      maxAttempts: 3,
      now,
    });
    if (risk.action === 'circuit') {
      expect(risk.resumeAt.toISOString()).toBe('2026-10-19T00:30:00.000Z');
    }
    const limited = planBilibiliFailure({
      kind: 'rate_limited',
      attempts: 1,
      maxAttempts: 3,
      now,
    });
    if (limited.action === 'circuit') {
      expect(limited.resumeAt.toISOString()).toBe('2026-10-19T01:00:00.000Z');
    }
  });
});

describe('bilibili job orchestration', () => {
  test('replaying one job keeps a single sample on the scheduled bucket', async () => {
    const store = effects();
    const current = provider(async () => view);
    const scheduled = job();
    const first = await runBilibiliJob({
      job: scheduled,
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: new Date('2026-10-19T01:03:00.000Z'),
    });
    const second = await runBilibiliJob({
      job: scheduled,
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: new Date('2026-10-19T01:09:00.000Z'),
    });
    expect(first).toBe('succeeded');
    expect(second).toBe('succeeded');
    expect(store.videos.size).toBe(1);
    const sample = [...store.videos.values()][0];
    expect(sample?.commentCount).toBe(7n);
    expect(sample?.sampledAt.toISOString()).toBe(scheduled.scheduledFor.toISOString());
    expect(sample?.collectedAt?.toISOString()).toBe('2026-10-19T01:03:00.000Z');
    expect(sample?.onlineViewers).toBe(1234n);
    expect(sample?.onlineViewersRaw).toBe('1234+');
  });

  test('-404 disables the target and does not retry', async () => {
    const store = effects();
    let calls = 0;
    const current = provider(async () => {
      calls += 1;
      throw new BilibiliFailure({
        message: 'view 业务码 -404',
        kind: 'not_found',
        endpoint: 'view',
        statusCode: 200,
        bizCode: -404,
        calls: [],
      });
    });
    const outcome = await runBilibiliJob({
      job: job(),
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: new Date('2026-10-19T00:00:00.000Z'),
    });
    expect(outcome).toBe('failed');
    expect(store.disabled).toEqual(['target-1']);
    expect(store.deferred).toHaveLength(0);
    expect(calls).toBe(1);
  });

  test('-352 delays later jobs for that account until the circuit cools down', async () => {
    const now = new Date('2026-10-19T00:00:00.000Z');
    const circuit: {
      current: { resumeAt: Date; reason: string; consecutiveFailures: number } | null;
    } = {
      current: null,
    };
    let fetches = 0;
    const store = effects({
      resolveAccount: async () => ({ id: 'acc-1', status: 'active', mid: '7' }),
      readCircuit: async () => circuit.current,
      openCircuit: async (input) => {
        circuit.current = {
          resumeAt: input.resumeAt,
          reason: input.reason,
          consecutiveFailures: 1,
        };
      },
      clearCircuit: async () => {
        circuit.current = null;
      },
    });
    const current = provider(async () => {
      fetches += 1;
      if (fetches === 1) {
        throw new BilibiliFailure({
          message: 'view 业务码 -352',
          kind: 'risk_control',
          endpoint: 'view',
          statusCode: 200,
          bizCode: -352,
          calls: [],
        });
      }
      return view;
    });
    const first = await runBilibiliJob({
      job: job({ accountId: 'acc-1' }),
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now,
    });
    expect(first).toBe('failed');
    expect(circuit.current?.resumeAt.toISOString()).toBe('2026-10-19T00:30:00.000Z');
    const during = await runBilibiliJob({
      job: job({ id: 'job-2', accountId: 'acc-1' }),
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: new Date('2026-10-19T00:10:00.000Z'),
    });
    expect(during).toBe('deferred');
    expect(fetches).toBe(1);
    const after = await runBilibiliJob({
      job: job({ id: 'job-3', accountId: 'acc-1' }),
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: new Date('2026-10-19T00:30:00.000Z'),
    });
    expect(after).toBe('succeeded');
    expect(fetches).toBe(2);
    expect(circuit.current).toBeNull();
  });

  test('-101 marks the account expired and does not keep calling', async () => {
    const store = effects({
      resolveAccount: async () => ({ id: 'acc-1', status: 'active', mid: '7' }),
    });
    const current = provider(async () => {
      throw new BilibiliFailure({
        message: 'view 业务码 -101',
        kind: 'unauthorized',
        endpoint: 'view',
        statusCode: 200,
        bizCode: -101,
        calls: [],
      });
    });
    const outcome = await runBilibiliJob({
      job: job({ accountId: 'acc-1' }),
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: new Date('2026-10-19T00:00:00.000Z'),
    });
    expect(outcome).toBe('deferred');
    expect(store.expired).toEqual(['acc-1']);
    expect(store.videos.size).toBe(0);
  });
});
