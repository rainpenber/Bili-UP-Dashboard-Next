import { describe, expect, test } from 'bun:test';
import type { ClaimedCollectorJob, VideoSampleWrite } from '@studio/db';
import {
  BilibiliFailure,
  classifyBilibiliResponse,
  FIRST_ACCESS_RETRY_MINUTES,
  planBilibiliFailure,
  retryDelayMinutes,
} from './bilibili-failure';
import type { CollectorLogger } from './collector-log';
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
    fetchDynamic: async () => {
      throw new Error('动态详情尚未接入采集任务');
    },
    fetchCreatorArchives: async () => {
      throw new Error('unused');
    },
    fetchCreatorDynamics: async () => {
      throw new Error('unused');
    },
    collectDynamic: async () => {
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
    readSchedule: async () => ({
      type: 'video',
      intervalMode: 'auto',
      intervalMinutes: 60,
      pubdate: null,
      lastSuccessAt: null,
      densePlan: null,
    }),
    commitVideo: async (input) => {
      const key = `${input.sample.bvid}|${input.sample.sampledAt.toISOString()}`;
      if (videos.has(key)) return { inserted: false, runId: 'run-dup' };
      videos.set(key, input.sample);
      return { inserted: true, runId: 'run-1' };
    },
    commitCreator: async () => ({ inserted: true, runId: 'run-c' }),
    commitDynamic: async () => ({ inserted: true, runId: 'run-d' }),
    failJob: async () => ({ runId: 'run-fail', applied: true }),
    audit: async () => undefined,
    markUsed: async () => undefined,
  };
  return { videos, disabled, circuits, deferred, expired, ...base, ...patch };
}

function capturingLogger() {
  const events: {
    level: string;
    event?: string;
    runId?: string;
    jobId?: string;
    targetId?: string;
  }[] = [];
  function make(bindings: { jobId?: string; runId?: string; targetId?: string }): CollectorLogger {
    const record = (level: string, fields?: { event?: string }) => {
      const entry: {
        level: string;
        event?: string;
        runId?: string;
        jobId?: string;
        targetId?: string;
      } = { level };
      if (fields?.event) entry.event = fields.event;
      if (bindings.jobId) entry.jobId = bindings.jobId;
      if (bindings.runId) entry.runId = bindings.runId;
      if (bindings.targetId) entry.targetId = bindings.targetId;
      events.push(entry);
    };
    return {
      child(extra) {
        return make({ ...bindings, ...extra });
      },
      debug(_message, fields) {
        record('debug', fields);
      },
      info(_message, fields) {
        record('info', fields);
      },
      warn(_message, fields) {
        record('warn', fields);
      },
      error(_message, fields) {
        record('error', fields);
      },
    };
  }
  return { logger: make({}), events };
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
    tid: 95,
    tidV2: 2102,
    tname: '',
    tnameV2: '',
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

  test('first-access not_found waits five minutes then terminals at three', () => {
    const now = new Date('2026-10-19T00:00:00.000Z');
    const first = planBilibiliFailure({
      kind: 'not_found',
      attempts: 1,
      maxAttempts: 3,
      now,
      firstAccessWait: true,
    });
    expect(first).toMatchObject({ action: 'first_access_retry', terminal: false });
    if (first.action === 'first_access_retry') {
      expect(first.retryAt?.toISOString()).toBe(
        new Date(now.getTime() + FIRST_ACCESS_RETRY_MINUTES * 60_000).toISOString(),
      );
    }
    const third = planBilibiliFailure({
      kind: 'not_found',
      attempts: 3,
      maxAttempts: 3,
      now,
      firstAccessWait: true,
    });
    expect(third).toMatchObject({
      action: 'first_access_retry',
      terminal: true,
      retryAt: null,
    });
    expect(planBilibiliFailure({ kind: 'not_found', attempts: 1, maxAttempts: 3, now })).toEqual({
      action: 'disable',
      terminal: true,
    });
  });

  test('HTTP 404 with biz -101 is unauthorized, not not_found', () => {
    expect(classifyBilibiliResponse({ statusCode: 404, bizCode: -101, timedOut: false })).toBe(
      'unauthorized',
    );
    expect(classifyBilibiliResponse({ statusCode: 200, bizCode: -404, timedOut: false })).toBe(
      'not_found',
    );
    expect(classifyBilibiliResponse({ statusCode: 404, bizCode: 0, timedOut: false })).toBe(
      'not_found',
    );
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

  test('post-commit audit/markUsed failures keep succeeded and do not call failJob', async () => {
    let failCalls = 0;
    const store = effects({
      audit: async () => {
        throw new Error('audit-down');
      },
      markUsed: async () => {
        throw new Error('mark-used-down');
      },
      failJob: async () => {
        failCalls += 1;
        return { runId: 'should-not', applied: true };
      },
    });
    const { logger, events } = capturingLogger();
    const outcome = await runBilibiliJob({
      job: job(),
      provider: provider(async () => view),
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: new Date('2026-10-19T01:03:00.000Z'),
      logger,
    });
    expect(outcome).toBe('succeeded');
    expect(store.videos.size).toBe(1);
    expect(failCalls).toBe(0);
    expect(events.some((row) => row.event === 'job.post_commit_helper_failed')).toBe(true);
    expect(events.some((row) => row.event === 'job.succeeded')).toBe(true);
  });

  test('post-commit markUsed failure with account keeps succeeded and does not call failJob', async () => {
    let failCalls = 0;
    let markUsedCalls = 0;
    let auditCalls = 0;
    let commitCalls = 0;
    const store = effects({
      resolveAccount: async () => ({ id: 'acc-mark', status: 'active', mid: '42' }),
      cookieHeaderFor: async () => 'SESSDATA=test',
      audit: async () => {
        auditCalls += 1;
      },
      markUsed: async () => {
        markUsedCalls += 1;
        throw new Error('mark-used-down');
      },
      failJob: async () => {
        failCalls += 1;
        return { runId: 'should-not', applied: true };
      },
    });
    const baseCommit = store.commitVideo;
    store.commitVideo = async (input) => {
      commitCalls += 1;
      return baseCommit(input);
    };
    const { logger, events } = capturingLogger();
    const outcome = await runBilibiliJob({
      job: job({ accountId: 'acc-mark' }),
      provider: provider(async () => view),
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: new Date('2026-10-19T01:03:00.000Z'),
      logger,
    });
    expect(outcome).toBe('succeeded');
    expect(auditCalls).toBe(1);
    expect(markUsedCalls).toBe(1);
    expect(commitCalls).toBe(1);
    expect(store.videos.size).toBe(1);
    expect(failCalls).toBe(0);
    expect(events.some((row) => row.event === 'job.post_commit_helper_failed')).toBe(true);
    expect(events.some((row) => row.event === 'job.succeeded')).toBe(true);
  });

  test('never-succeeded video -404 schedules first-access retry instead of disable', async () => {
    const failCalls: Array<{ retryAt: Date | null; error: string; haltAutoSchedule?: boolean }> =
      [];
    const store = effects({
      failJob: async (input) => {
        failCalls.push({
          retryAt: input.retryAt,
          error: input.error,
          ...(input.haltAutoSchedule ? { haltAutoSchedule: true } : {}),
        });
        return { runId: 'run-fail', applied: true };
      },
    });
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
      job: job({ attempts: 1 }),
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: new Date('2026-10-19T00:00:00.000Z'),
    });
    expect(outcome).toBe('failed');
    expect(store.disabled).toEqual([]);
    expect(failCalls).toHaveLength(1);
    expect(failCalls[0]?.retryAt?.toISOString()).toBe('2026-10-19T00:05:00.000Z');
    expect(failCalls[0]?.error).toContain('[first_access_waiting]');
    expect(failCalls[0]?.error).toContain('失败 1/3 次');
    expect(calls).toBe(1);
  });

  test('never-succeeded video -404 third failure halts via failJob (no separate disable)', async () => {
    const failCalls: Array<{ retryAt: Date | null; error: string; haltAutoSchedule?: boolean }> =
      [];
    const store = effects({
      failJob: async (input) => {
        failCalls.push({
          retryAt: input.retryAt,
          error: input.error,
          ...(input.haltAutoSchedule ? { haltAutoSchedule: true } : {}),
        });
        // Halt is applied inside the fail transaction; surface halted=true.
        return { runId: 'run-fail', applied: true, halted: true };
      },
    });
    const current = provider(async () => {
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
      job: job({ attempts: 3 }),
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: new Date('2026-10-19T00:00:00.000Z'),
    });
    expect(outcome).toBe('failed');
    // Disable is folded into failJob; effects.disableTarget must not race separately.
    expect(store.disabled).toEqual([]);
    expect(failCalls[0]?.retryAt).toBeNull();
    expect(failCalls[0]?.haltAutoSchedule).toBe(true);
    expect(failCalls[0]?.error).toContain('[first_access_awaiting_manual]');
  });

  test('already-succeeded video -404 disables the target and does not retry', async () => {
    const store = effects({
      readSchedule: async () => ({
        type: 'video',
        intervalMode: 'auto',
        intervalMinutes: 60,
        pubdate: new Date('2026-10-01T00:00:00.000Z'),
        lastSuccessAt: new Date('2026-10-18T00:00:00.000Z'),
        densePlan: null,
      }),
    });
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
    const logs = capturingLogger();
    const first = await runBilibiliJob({
      job: job({ accountId: 'acc-1' }),
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now,
      logger: logs.logger.child({ jobId: 'job-1', targetId: 'target-1' }),
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
      logger: logs.logger,
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
      logger: logs.logger,
    });
    expect(after).toBe('succeeded');
    expect(fetches).toBe(2);
    expect(circuit.current).toBeNull();
    expect(logs.events.map((entry) => entry.event)).toEqual([
      'circuit.open',
      'job.failed',
      'circuit.close',
      'job.succeeded',
    ]);
    expect(logs.events[1]?.runId).toBe('run-fail');
    expect(logs.events[3]?.runId).toBe('run-1');
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

describe('dynamic job dispatch', () => {
  test('stores scheduledFor and does not fetch a creator or video', async () => {
    const scheduledFor = new Date('2026-10-21T03:04:05.000Z');
    const collectedAt = new Date('2026-10-21T03:09:05.000Z');
    let dynamicCalls = 0;
    let creatorCalls = 0;
    const captured: Array<{
      sampledAt: Date;
      collectedAt: Date | null;
      likeCount: bigint | null;
      commentCount: bigint | null;
      dynamicId: string;
      scheduleMinutes: number | undefined;
    }> = [];
    const store = effects({
      readSchedule: async () => ({
        type: 'dynamic',
        intervalMode: 'fixed',
        intervalMinutes: 60,
        pubdate: new Date('2020-01-01T00:00:00.000Z'),
        lastSuccessAt: null,
        densePlan: null,
      }),
      commitDynamic: async (input) => {
        captured.push({
          sampledAt: input.sample.sampledAt,
          collectedAt: input.sample.collectedAt,
          likeCount: input.sample.likeCount,
          commentCount: input.sample.commentCount,
          dynamicId: input.sample.dynamicId,
          scheduleMinutes: input.schedule?.minutes,
        });
        expect(input.schedule?.persistMinutes).toBe(false);
        return { inserted: true, runId: 'run-dyn' };
      },
    });
    const current = provider(async () => {
      throw new Error('video fetch');
    });
    current.fetchCreator = async () => {
      creatorCalls += 1;
      throw new Error('creator fetch');
    };
    current.fetchDynamic = async (input) => {
      dynamicCalls += 1;
      expect(input.dynamicId).toBe('966692349750018048');
      expect(input.sampledAt.toISOString()).toBe(scheduledFor.toISOString());
      return {
        dynamicId: input.dynamicId,
        sampledAt: new Date('1999-01-01T00:00:00.000Z'),
        collectedAt: input.collectedAt,
        detail: {
          dynamicId: input.dynamicId,
          dynamicType: 'DYNAMIC_TYPE_WORD',
          visible: true,
          authorMid: '42',
          authorName: '作者',
          faceUrl: null,
          publishedAt: null,
          publishedText: null,
          text: '正文',
          majorType: null,
          likeCount: 0n,
          commentCount: null,
          repostCount: 7n,
        },
        calls: [
          {
            endpoint: 'dynamic_detail',
            statusCode: 200,
            bizCode: 0,
            durationMs: 1,
            error: null,
          },
        ],
        extra: {},
      };
    };
    const outcome = await runBilibiliJob({
      job: job({
        targetType: 'dynamic',
        externalId: '966692349750018048',
        scheduledFor,
      }),
      provider: current,
      effects: store,
      forcedAccountId: null,
      maxAttempts: 3,
      now: collectedAt,
    });
    expect(outcome).toBe('succeeded');
    expect(dynamicCalls).toBe(1);
    expect(creatorCalls).toBe(0);
    expect(store.videos.size).toBe(0);
    expect(captured).toEqual([
      {
        sampledAt: scheduledFor,
        collectedAt,
        likeCount: 0n,
        commentCount: null,
        dynamicId: '966692349750018048',
        scheduleMinutes: 60,
      },
    ]);
  });
});
