import type {
  CircuitRow,
  ClaimedCollectorJob,
  CreatorSampleWrite,
  ResolvedBiliAccount,
  VideoSampleWrite,
} from '@studio/db';
import {
  circuitCooldownMs,
  circuitIsOpen,
  planBilibiliFailure,
  BilibiliFailure,
} from './bilibili-failure';
import type { UpstreamCall } from './bilibili-failure';
import type { BilibiliProvider } from './bilibili-provider';
import { scrubCollectorError } from './credentials';
import { formatSourceMinute } from './offline-provider';

export type BilibiliEffects = {
  resolveAccount(input: {
    targetAccountId: string | null;
    forcedAccountId: string | null;
  }): Promise<ResolvedBiliAccount | null>;
  readCircuit(accountId: string): Promise<CircuitRow | null>;
  openCircuit(input: { accountId: string; resumeAt: Date; reason: string }): Promise<void>;
  clearCircuit(accountId: string): Promise<void>;
  expireAccount(accountId: string): Promise<void>;
  disableTarget(targetId: string, error: string): Promise<void>;
  deferJob(jobId: string, until: Date): Promise<void>;
  cookieHeaderFor(accountId: string): Promise<string | null>;
  commitVideo(input: {
    jobId: string;
    targetId: string;
    startedAt: Date;
    durationMs: number;
    sample: VideoSampleWrite;
  }): Promise<{ inserted: boolean; runId: string }>;
  commitCreator(input: {
    jobId: string;
    targetId: string;
    startedAt: Date;
    durationMs: number;
    sample: CreatorSampleWrite;
  }): Promise<{ inserted: boolean; runId: string }>;
  failJob(input: {
    jobId: string;
    targetId: string;
    attempts: number;
    maxAttempts: number;
    error: string;
    durationMs: number;
    startedAt: Date;
    retryAt: Date | null;
  }): Promise<{ runId: string }>;
  audit(input: {
    accountId: string | null;
    runId: string | null;
    calls: UpstreamCall[];
  }): Promise<void>;
  markUsed(accountId: string): Promise<void>;
};

function precisionOf(date: Date): 'minute' | 'second' {
  return date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0 ? 'minute' : 'second';
}

function accountKey(account: ResolvedBiliAccount | null): string {
  return account?.id ?? 'anonymous';
}

export async function runBilibiliJob(options: {
  job: ClaimedCollectorJob;
  provider: BilibiliProvider;
  effects: BilibiliEffects;
  forcedAccountId: string | null;
  maxAttempts: number;
  now: Date;
  log?: (line: string) => void;
}): Promise<'succeeded' | 'failed' | 'deferred'> {
  const log = options.log ?? (() => undefined);
  const startedAt = options.now;
  const startedMs = Date.now();
  const account = await options.effects.resolveAccount({
    targetAccountId: options.job.accountId,
    forcedAccountId: options.forcedAccountId,
  });
  if (account && account.status === 'expired') {
    await options.effects.deferJob(
      options.job.id,
      new Date(options.now.getTime() + 60 * 60 * 1000),
    );
    log(`[collector] 账号已过期，推迟任务 ${options.job.id}`);
    return 'deferred';
  }
  if (account) {
    const circuit = await options.effects.readCircuit(account.id);
    if (circuit && circuitIsOpen(circuit.resumeAt, options.now)) {
      await options.effects.deferJob(options.job.id, circuit.resumeAt);
      log(`[collector] 熔断未结束，推迟任务 ${options.job.id}`);
      return 'deferred';
    }
    if (circuit) await options.effects.clearCircuit(account.id);
  }

  let cookie: string | null = null;
  if (account) {
    try {
      cookie = await options.effects.cookieHeaderFor(account.id);
    } catch (error) {
      await options.effects.expireAccount(account.id);
      await options.effects.deferJob(
        options.job.id,
        new Date(options.now.getTime() + 60 * 60 * 1000),
      );
      log(`[collector] ${scrubCollectorError(error)}`);
      return 'deferred';
    }
  }

  try {
    if (options.job.targetType === 'video') {
      const fetched = await options.provider.fetchVideo({
        bvid: options.job.externalId,
        sampledAt: options.job.scheduledFor,
        collectedAt: options.now,
        cookieHeader: cookie,
        accountKey: accountKey(account),
      });
      const sample: VideoSampleWrite = {
        bvid: fetched.bvid,
        title: fetched.view.title,
        sampledAt: options.job.scheduledFor,
        rawTime: formatSourceMinute(options.job.scheduledFor, 'Asia/Shanghai'),
        sourceTimezone: 'Asia/Shanghai',
        timestampPrecision: precisionOf(options.job.scheduledFor),
        viewCount: fetched.view.viewCount,
        onlineViewers: fetched.online?.viewers ?? null,
        onlineViewersRaw: fetched.online?.raw ?? null,
        likeCount: fetched.view.likeCount,
        coinCount: fetched.view.coinCount,
        favoriteCount: fetched.view.favoriteCount,
        shareCount: fetched.view.shareCount,
        danmakuCount: fetched.view.danmakuCount,
        commentCount: fetched.view.commentCount,
        source: 'bilibili',
        accountId: account?.id ?? null,
        collectedAt: options.now,
        extra: fetched.extra,
        cid: fetched.view.cid,
        pubdate: fetched.view.pubdate,
        ownerMid: fetched.view.ownerMid,
        ownerName: fetched.view.ownerName,
        coverUrl: fetched.view.coverUrl,
      };
      const committed = await options.effects.commitVideo({
        jobId: options.job.id,
        targetId: options.job.targetId,
        startedAt,
        durationMs: Math.max(0, Date.now() - startedMs),
        sample,
      });
      await options.effects.audit({
        accountId: account?.id ?? null,
        runId: committed.runId,
        calls: fetched.calls,
      });
      if (account) await options.effects.markUsed(account.id);
      await applyOnlineAccountEffect(options, account, fetched.onlineFailure);
      log(`[collector] 任务成功 ${options.job.id} inserted=${committed.inserted}`);
      return 'succeeded';
    }

    const fetched = await options.provider.fetchCreator({
      mid: options.job.externalId,
      sampledAt: options.job.scheduledFor,
      collectedAt: options.now,
      cookieHeader: cookie,
      accountKey: accountKey(account),
    });
    const sample: CreatorSampleWrite = {
      mid: fetched.mid,
      uname: null,
      sampledAt: options.job.scheduledFor,
      rawTime: formatSourceMinute(options.job.scheduledFor, 'Asia/Shanghai'),
      sourceTimezone: 'Asia/Shanghai',
      timestampPrecision: precisionOf(options.job.scheduledFor),
      followerCount: fetched.relation.followerCount,
      followingCount: fetched.relation.followingCount,
      source: 'bilibili',
      accountId: account?.id ?? null,
      collectedAt: options.now,
      extra: fetched.extra,
    };
    const committed = await options.effects.commitCreator({
      jobId: options.job.id,
      targetId: options.job.targetId,
      startedAt,
      durationMs: Math.max(0, Date.now() - startedMs),
      sample,
    });
    await options.effects.audit({
      accountId: account?.id ?? null,
      runId: committed.runId,
      calls: fetched.calls,
    });
    if (account) await options.effects.markUsed(account.id);
    log(`[collector] 任务成功 ${options.job.id} inserted=${committed.inserted}`);
    return 'succeeded';
  } catch (error) {
    return handleFailure(options, account, error, startedAt, startedMs, log);
  }
}

async function applyOnlineAccountEffect(
  options: {
    effects: BilibiliEffects;
    now: Date;
    log?: (line: string) => void;
  },
  account: ResolvedBiliAccount | null,
  onlineFailure: { kind: string; message: string } | null,
): Promise<void> {
  if (!onlineFailure || !account) return;
  const cooldown = circuitCooldownMs(
    onlineFailure.kind === 'risk_control' || onlineFailure.kind === 'rate_limited'
      ? onlineFailure.kind
      : 'retryable',
  );
  if (cooldown !== null) {
    await options.effects.openCircuit({
      accountId: account.id,
      resumeAt: new Date(options.now.getTime() + cooldown),
      reason: onlineFailure.message,
    });
    return;
  }
  if (onlineFailure.kind === 'unauthorized') {
    await options.effects.expireAccount(account.id);
  }
}

async function handleFailure(
  options: {
    job: ClaimedCollectorJob;
    effects: BilibiliEffects;
    maxAttempts: number;
    now: Date;
  },
  account: ResolvedBiliAccount | null,
  error: unknown,
  startedAt: Date,
  startedMs: number,
  log: (line: string) => void,
): Promise<'succeeded' | 'failed' | 'deferred'> {
  const failure =
    error instanceof BilibiliFailure
      ? error
      : new BilibiliFailure({
          message: scrubCollectorError(error),
          kind: 'retryable',
          endpoint: 'view',
          statusCode: null,
          bizCode: null,
          calls: [],
        });
  const message = scrubCollectorError(failure);
  if (failure.kind === 'dry_run') {
    const plan = planBilibiliFailure({
      kind: 'dry_run',
      attempts: options.job.attempts,
      maxAttempts: options.maxAttempts,
      now: options.now,
    });
    if (plan.action === 'dry_run') {
      log(`[collector] ${message}`);
      await options.effects.deferJob(options.job.id, plan.deferUntil);
      return 'deferred';
    }
  }
  const plan = planBilibiliFailure({
    kind: failure.kind,
    attempts: options.job.attempts,
    maxAttempts: options.maxAttempts,
    now: options.now,
  });
  if (plan.action === 'expire') {
    if (account) await options.effects.expireAccount(account.id);
    await options.effects.audit({
      accountId: account?.id ?? null,
      runId: null,
      calls: failure.calls,
    });
    await options.effects.deferJob(options.job.id, plan.deferUntil);
    log(`[collector] 账号未登录，推迟任务 ${options.job.id}`);
    return 'deferred';
  }
  if (plan.action === 'disable') {
    await options.effects.disableTarget(options.job.targetId, message);
  }
  if (plan.action === 'circuit' && account) {
    await options.effects.openCircuit({
      accountId: account.id,
      resumeAt: plan.resumeAt,
      reason: message,
    });
  }
  const retryAt = plan.action === 'retry' || plan.action === 'circuit' ? plan.retryAt : null;
  const failed = await options.effects.failJob({
    jobId: options.job.id,
    targetId: options.job.targetId,
    attempts: options.job.attempts,
    maxAttempts: options.maxAttempts,
    error: message,
    durationMs: Math.max(0, Date.now() - startedMs),
    startedAt,
    retryAt,
  });
  await options.effects.audit({
    accountId: account?.id ?? null,
    runId: failed.runId,
    calls: failure.calls,
  });
  log(`[collector] 任务失败 ${options.job.id} ${message}`);
  return 'failed';
}
