import type {
  CircuitRow,
  ClaimedCollectorJob,
  CollectorScheduleWrite,
  CreatorSampleWrite,
  DynamicSampleWrite,
  ResolvedBiliAccount,
  TargetScheduleContext,
  VideoSampleWrite,
} from '@studio/db';
import {
  circuitCooldownMs,
  circuitIsOpen,
  FIRST_ACCESS_MAX_ATTEMPTS,
  formatFirstAccessError,
  planBilibiliFailure,
  BilibiliFailure,
} from './bilibili-failure';
import type { UpstreamCall } from './bilibili-failure';
import type { BilibiliProvider } from './bilibili-provider';
import { scrubCollectorError } from './credentials';
import type { CollectorLogger } from './collector-log';
import { decideSchedule, readFrequencyPolicy } from './frequency';
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
  readSchedule(targetId: string): Promise<TargetScheduleContext | null>;
  commitVideo(input: {
    jobId: string;
    targetId: string;
    startedAt: Date;
    durationMs: number;
    sample: VideoSampleWrite;
    schedule: CollectorScheduleWrite | null;
  }): Promise<{ inserted: boolean; runId: string }>;
  commitCreator(input: {
    jobId: string;
    targetId: string;
    startedAt: Date;
    durationMs: number;
    sample: CreatorSampleWrite;
    schedule: CollectorScheduleWrite | null;
  }): Promise<{ inserted: boolean; runId: string }>;
  commitDynamic(input: {
    jobId: string;
    targetId: string;
    startedAt: Date;
    durationMs: number;
    sample: DynamicSampleWrite;
    schedule: CollectorScheduleWrite | null;
  }): Promise<{ inserted: boolean; runId: string }>;
  failJob(input: {
    jobId: string;
    targetId: string;
    attempts: number;
    maxAttempts: number;
    error: string;
    schedule?: CollectorScheduleWrite;
    durationMs: number;
    startedAt: Date;
    retryAt: Date | null;
    /** Terminal first-access: clear next_run_at + disable in the fail transaction. */
    haltAutoSchedule?: boolean;
  }): Promise<{ runId: string | null; applied: boolean; halted?: boolean }>;
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

export type AutoVideoMetadataHook = {
  /**
   * After every successful video collect, attempt auto metadata enqueue.
   * Idempotent (has cover / active run → skip). Must not throw into the job path.
   */
  afterVideoCollectSuccess(bvid: string): Promise<void>;
};

export async function runBilibiliJob(options: {
  job: ClaimedCollectorJob;
  provider: BilibiliProvider;
  effects: BilibiliEffects;
  forcedAccountId: string | null;
  maxAttempts: number;
  now: Date;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  logger?: CollectorLogger;
  /** Optional auto metadata refresh when cover/metadata still missing (WP-R2-MON-03). */
  autoVideoMetadata?: AutoVideoMetadataHook;
}): Promise<'succeeded' | 'failed' | 'deferred'> {
  const log = options.log ?? (() => undefined);
  const startedAt = options.now;
  const startedMs = Date.now();
  const env = options.env ?? process.env;
  const scheduleContext = await options.effects.readSchedule(options.job.targetId);
  const preferredAccountId = options.forcedAccountId ?? options.job.accountId;
  const account = await options.effects.resolveAccount({
    targetAccountId: options.job.accountId,
    forcedAccountId: options.forcedAccountId,
  });
  if (!account && preferredAccountId) {
    log(
      `[collector] 跳过不可用账号 ${preferredAccountId}（需 active、有凭据且 Cookie 未过期；已撤销或过期账号不会被选中）`,
    );
  }
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
    if (circuit) {
      await options.effects.clearCircuit(account.id);
      options.logger?.info('熔断关闭', {
        event: 'circuit.close',
        context: { accountId: account.id },
      });
    }
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
        partition: {
          tid: fetched.view.tid,
          tidV2: fetched.view.tidV2,
          tname: fetched.view.tname,
          tnameV2: fetched.view.tnameV2,
        },
      };
      const committed = await options.effects.commitVideo({
        jobId: options.job.id,
        targetId: options.job.targetId,
        startedAt,
        durationMs: Math.max(0, Date.now() - startedMs),
        sample,
        schedule: scheduleFrom(scheduleContext, options.now, fetched.view.pubdate, env),
      });
      await runPostCommitHelpers(options, account, committed.runId, fetched.calls, async () => {
        await applyOnlineAccountEffect(options, account, fetched.onlineFailure);
        // Every successful video collect may enqueue; skip is decided by cover/active/busy.
        if (options.autoVideoMetadata) {
          await options.autoVideoMetadata.afterVideoCollectSuccess(fetched.bvid);
        }
      });
      options.logger?.child({ runId: committed.runId })?.info('任务成功', {
        event: 'job.succeeded',
        context: { inserted: committed.inserted },
      });
      log(`[collector] 任务成功 ${options.job.id} inserted=${committed.inserted}`);
      return 'succeeded';
    }

    if (options.job.targetType === 'creator') {
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
        schedule: scheduleFrom(scheduleContext, options.now, null, env),
      });
      await runPostCommitHelpers(options, account, committed.runId, fetched.calls);
      options.logger?.child({ runId: committed.runId })?.info('任务成功', {
        event: 'job.succeeded',
        context: { inserted: committed.inserted },
      });
      log(`[collector] 任务成功 ${options.job.id} inserted=${committed.inserted}`);
      return 'succeeded';
    }

    const fetched = await options.provider.fetchDynamic({
      dynamicId: options.job.externalId,
      sampledAt: options.job.scheduledFor,
      collectedAt: options.now,
      cookieHeader: cookie,
      accountKey: accountKey(account),
    });
    if (fetched.detail.dynamicId !== options.job.externalId) {
      throw new Error('动态样本身份与目标不一致');
    }
    const detail = fetched.detail;
    const sample: DynamicSampleWrite = {
      dynamicId: options.job.externalId,
      dynamicType: detail.dynamicType,
      visible: detail.visible,
      authorMid: detail.authorMid,
      authorName: detail.authorName,
      faceUrl: detail.faceUrl,
      publishedAt: detail.publishedAt,
      publishedText: detail.publishedText,
      text: detail.text,
      majorType: detail.majorType,
      likeCount: detail.likeCount,
      repostCount: detail.repostCount,
      commentCount: detail.commentCount,
      sampledAt: options.job.scheduledFor,
      rawTime: formatSourceMinute(options.job.scheduledFor, 'Asia/Shanghai'),
      sourceTimezone: 'Asia/Shanghai',
      timestampPrecision: precisionOf(options.job.scheduledFor),
      source: 'bilibili',
      accountId: account?.id ?? null,
      collectorRunId: null,
      collectedAt: options.now,
      extra: fetched.extra,
    };
    const committed = await options.effects.commitDynamic({
      jobId: options.job.id,
      targetId: options.job.targetId,
      startedAt,
      durationMs: Math.max(0, Date.now() - startedMs),
      sample,
      schedule: scheduleFrom(scheduleContext, options.now, null, env),
    });
    await runPostCommitHelpers(options, account, committed.runId, fetched.calls);
    options.logger?.child({ runId: committed.runId })?.info('任务成功', {
      event: 'job.succeeded',
      context: { inserted: committed.inserted },
    });
    log(`[collector] 任务成功 ${options.job.id} inserted=${committed.inserted}`);
    return 'succeeded';
  } catch (error) {
    return handleFailure(
      options,
      account,
      error,
      startedAt,
      startedMs,
      log,
      scheduleFrom(scheduleContext, options.now, scheduleContext?.pubdate ?? null, env),
      scheduleContext,
    );
  }
}

function scheduleFrom(
  context: TargetScheduleContext | null,
  now: Date,
  pubdate: Date | null,
  env: NodeJS.ProcessEnv,
): CollectorScheduleWrite | null {
  if (!context) return null;
  if (context.type === 'video' && context.densePlan && context.densePlan.phase !== 'normal') {
    const plan = context.densePlan;
    if (now.getTime() < plan.dense15Until.getTime()) {
      return { minutes: 15, persistMinutes: true };
    }
    if (now.getTime() < plan.dense30Until.getTime()) {
      return { minutes: 30, persistMinutes: true };
    }
    // Past 10-day window: fall through to age-tier / fixed policy.
  }
  const type = context.type;
  if (type === 'discovery') {
    return decideSchedule(
      {
        type: 'discovery',
        mode: 'fixed',
        fixedMinutes: context.intervalMinutes,
        pubdate: null,
      },
      now,
      readFrequencyPolicy(env),
    );
  }
  return decideSchedule(
    {
      type,
      mode: context.intervalMode,
      fixedMinutes: context.intervalMinutes,
      pubdate: type === 'video' ? pubdate : null,
    },
    now,
    readFrequencyPolicy(env),
  );
}

async function applyOnlineAccountEffect(
  options: {
    effects: BilibiliEffects;
    now: Date;
    log?: (line: string) => void;
    logger?: CollectorLogger;
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
    const resumeAt = new Date(options.now.getTime() + cooldown);
    await options.effects.openCircuit({
      accountId: account.id,
      resumeAt,
      reason: onlineFailure.message,
    });
    options.logger?.warn('熔断打开', {
      event: 'circuit.open',
      context: { accountId: account.id, resumeAt: resumeAt.toISOString() },
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
    logger?: CollectorLogger;
  },
  account: ResolvedBiliAccount | null,
  error: unknown,
  startedAt: Date,
  startedMs: number,
  log: (line: string) => void,
  schedule: CollectorScheduleWrite | null,
  scheduleContext: TargetScheduleContext | null,
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
  const scrubbed = scrubCollectorError(failure);
  if (failure.kind === 'dry_run') {
    const plan = planBilibiliFailure({
      kind: 'dry_run',
      attempts: options.job.attempts,
      maxAttempts: options.maxAttempts,
      now: options.now,
    });
    if (plan.action === 'dry_run') {
      log(`[collector] ${scrubbed}`);
      await options.effects.deferJob(options.job.id, plan.deferUntil);
      return 'deferred';
    }
  }
  // First-access wait: never-succeeded video + upstream-confirmed inaccessible only.
  // Network / auth / risk / rate-limit and already-succeeded videos keep prior paths.
  const firstAccessWait =
    failure.kind === 'not_found' &&
    options.job.targetType === 'video' &&
    scheduleContext !== null &&
    scheduleContext.lastSuccessAt === null;
  const plan = planBilibiliFailure({
    kind: failure.kind,
    attempts: options.job.attempts,
    maxAttempts: firstAccessWait ? FIRST_ACCESS_MAX_ATTEMPTS : options.maxAttempts,
    now: options.now,
    firstAccessWait,
  });
  const message =
    plan.action === 'first_access_retry'
      ? formatFirstAccessError({
          upstreamMessage: scrubbed,
          attempts: options.job.attempts,
          terminal: plan.terminal,
        })
      : scrubbed;
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
    options.logger?.warn('熔断打开', {
      event: 'circuit.open',
      context: { accountId: account.id, resumeAt: plan.resumeAt.toISOString() },
    });
  }
  const retryAt =
    plan.action === 'retry' || plan.action === 'circuit' || plan.action === 'first_access_retry'
      ? plan.retryAt
      : null;
  const haltAutoSchedule = plan.action === 'first_access_retry' && plan.terminal;
  const failed = await options.effects.failJob({
    jobId: options.job.id,
    targetId: options.job.targetId,
    attempts: options.job.attempts,
    maxAttempts:
      plan.action === 'first_access_retry' ? FIRST_ACCESS_MAX_ATTEMPTS : options.maxAttempts,
    error: message,
    durationMs: Math.max(0, Date.now() - startedMs),
    startedAt,
    retryAt,
    ...(haltAutoSchedule ? { haltAutoSchedule: true } : {}),
    ...(schedule ? { schedule } : {}),
  });
  if (!failed.applied) {
    // Collection already committed; do not invent a failed run or reactivate the job.
    log(`[collector] 任务已终态，忽略迟到失败处理 ${options.job.id}`);
    return 'succeeded';
  }
  // Halt (disable + clear cursor) is applied inside failJob's locked transaction.
  if (haltAutoSchedule && failed.halted !== false) {
    options.logger?.warn('首次采集达到上限，待人工介入', {
      event: 'monitor.target.first_access_exhausted',
      context: {
        targetId: options.job.targetId,
        jobId: options.job.id,
        externalId: options.job.externalId,
        attempts: options.job.attempts,
        maxAttempts: FIRST_ACCESS_MAX_ATTEMPTS,
        halted: failed.halted === true,
      },
    });
  }
  await options.effects.audit({
    accountId: account?.id ?? null,
    runId: failed.runId,
    calls: failure.calls,
  });
  if (failed.runId) {
    options.logger?.child({ runId: failed.runId })?.error('任务失败', {
      event: 'job.failed',
      context: { attempts: options.job.attempts },
      err: new Error(message),
    });
  } else {
    options.logger?.error('任务失败', {
      event: 'job.failed',
      context: { attempts: options.job.attempts },
      err: new Error(message),
    });
  }
  log(`[collector] 任务失败 ${options.job.id} ${message}`);
  return 'failed';
}

/** Audit / markUsed after a successful commit must not rewrite the collection outcome. */
async function runPostCommitHelpers(
  options: {
    effects: BilibiliEffects;
    logger?: CollectorLogger;
    job: { id: string };
  },
  account: { id: string } | null,
  runId: string,
  calls: UpstreamCall[],
  extra?: () => Promise<void>,
): Promise<void> {
  try {
    await options.effects.audit({
      accountId: account?.id ?? null,
      runId,
      calls,
    });
    if (account) await options.effects.markUsed(account.id);
    if (extra) await extra();
  } catch (error) {
    const message = scrubCollectorError(error);
    options.logger?.warn('提交后辅助操作失败', {
      event: 'job.post_commit_helper_failed',
      context: { jobId: options.job.id, runId, error: message },
    });
  }
}
