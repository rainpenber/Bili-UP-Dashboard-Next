import {
  claimNextCollectorJob,
  enqueueDueCollectorJobs,
  readTargetSchedule,
  recordCollectorFailure,
  recordCollectorSuccess,
  refreshCollectorHeartbeat,
  upsertCollectorHeartbeat,
  writeCreatorSample,
  writeVideoSample,
  type Sql,
} from '@studio/db';
import { createSqlBilibiliEffects } from './bilibili-effects';
import { runBilibiliJob, type BilibiliEffects } from './bilibili-job';
import { decideSchedule, readFrequencyPolicy } from './frequency';
import { isBilibiliProvider } from './bilibili-provider';
import { loadCollectorSecretKey, scrubCollectorError } from './credentials';
import type { CollectorLogger } from './collector-log';
import {
  createOfflineProvider,
  truncateToUtcMinute,
  type MonitorProvider,
} from './offline-provider';

export const COLLECTOR_HEARTBEAT_MS = 10_000;

export type CollectorConfig = {
  pollMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  rateLimitMs: number;
  instanceId: string;
};

function readInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`采集器配置超出范围: ${raw}`);
  }
  return value;
}

export function readCollectorConfig(env: NodeJS.ProcessEnv = process.env): CollectorConfig {
  const instanceId = env.COLLECTOR_INSTANCE_ID?.trim() || `collector-${crypto.randomUUID()}`;
  return {
    pollMs: readInt(env.COLLECTOR_POLL_MS, 1000, 50, 60_000),
    maxAttempts: readInt(env.COLLECTOR_MAX_ATTEMPTS, 3, 1, 10),
    backoffBaseMs: readInt(env.COLLECTOR_BACKOFF_BASE_MS, 15_000, 0, 3_600_000),
    backoffCapMs: readInt(env.COLLECTOR_BACKOFF_CAP_MS, 120_000, 0, 3_600_000),
    rateLimitMs: readInt(env.COLLECTOR_RATE_LIMIT_MS, 500, 0, 60_000),
    instanceId,
  };
}

export function backoffDelayMs(attempts: number, baseMs: number, capMs: number): number {
  const exponent = Math.min(Math.max(attempts, 1) - 1, 10);
  return Math.min(capMs, baseMs * 2 ** exponent);
}

export function clipCollectorError(error: unknown): string {
  return scrubCollectorError(error);
}

async function sleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export type CollectorRunOutcome = 'idle' | 'succeeded' | 'failed' | 'deferred';

export async function runCollectorOnce(options: {
  sql: Sql;
  provider: MonitorProvider;
  config: CollectorConfig;
  now?: Date;
  log?: (line: string) => void;
  logger?: CollectorLogger;
  instanceId?: string;
  env?: NodeJS.ProcessEnv;
  effects?: BilibiliEffects;
}): Promise<CollectorRunOutcome> {
  const log = options.log ?? (() => undefined);
  await enqueueDueCollectorJobs(options.sql);
  const job = await claimNextCollectorJob(options.sql);
  if (!job) return 'idle';
  const jobLog = options.logger?.child({ jobId: job.id, targetId: job.targetId });
  jobLog?.info('任务已领取', {
    event: 'job.claimed',
    context: { targetType: job.targetType, attempts: job.attempts },
  });
  if (options.instanceId) {
    await upsertCollectorHeartbeat(options.sql, {
      instanceId: options.instanceId,
      status: 'running',
      currentJobId: job.id,
    });
  }
  const startedAt = options.now ?? new Date();
  const startedMs = Date.now();
  log(
    `[collector] 开始执行任务 ${job.id} ${job.targetType} ${job.externalId} 第 ${job.attempts} 次`,
  );
  try {
    if (isBilibiliProvider(options.provider)) {
      const env = options.env ?? process.env;
      const forced = env.COLLECTOR_ACCOUNT_ID?.trim() ?? '';
      const effects =
        options.effects ??
        createSqlBilibiliEffects(options.sql, {
          secretKey: loadCollectorSecretKey(env.COLLECTOR_SECRET_KEY),
        });
      return await runBilibiliJob({
        job,
        provider: options.provider,
        effects,
        forcedAccountId: forced.length > 0 ? forced : null,
        maxAttempts: options.config.maxAttempts,
        now: startedAt,
        env,
        log,
        ...(jobLog ? { logger: jobLog } : {}),
      });
    }
    const sampledAt = truncateToUtcMinute(startedAt);
    if (job.targetType === 'video') {
      const sample = await options.provider.collectVideo(job.externalId, sampledAt);
      const inserted = await writeVideoSample(options.sql, sample);
      const committed = await recordCollectorSuccess(options.sql, {
        jobId: job.id,
        targetId: job.targetId,
        samplesWritten: inserted ? 1 : 0,
        durationMs: Date.now() - startedMs,
        startedAt,
        ...(await offlineSchedule(options.sql, job.targetId, startedAt, options.env)),
      });
      jobLog?.child({ runId: committed.runId })?.info('任务成功', {
        event: 'job.succeeded',
        context: { samplesWritten: inserted ? 1 : 0 },
      });
    } else {
      const sample = await options.provider.collectCreator(job.externalId, sampledAt);
      const inserted = await writeCreatorSample(options.sql, sample);
      const committed = await recordCollectorSuccess(options.sql, {
        jobId: job.id,
        targetId: job.targetId,
        samplesWritten: inserted ? 1 : 0,
        durationMs: Date.now() - startedMs,
        startedAt,
        ...(await offlineSchedule(options.sql, job.targetId, startedAt, options.env)),
      });
      jobLog?.child({ runId: committed.runId })?.info('任务成功', {
        event: 'job.succeeded',
        context: { samplesWritten: inserted ? 1 : 0 },
      });
    }
    log(`[collector] 任务成功 ${job.id}`);
    return 'succeeded';
  } catch (error) {
    const message = clipCollectorError(error);
    const delay = backoffDelayMs(
      job.attempts,
      options.config.backoffBaseMs,
      options.config.backoffCapMs,
    );
    const retryAt =
      job.attempts >= options.config.maxAttempts ? null : new Date(startedAt.getTime() + delay);
    const failed = await recordCollectorFailure(options.sql, {
      jobId: job.id,
      targetId: job.targetId,
      attempts: job.attempts,
      maxAttempts: options.config.maxAttempts,
      error: message,
      durationMs: Math.max(0, Date.now() - startedMs),
      startedAt,
      retryAt,
      ...(await offlineSchedule(options.sql, job.targetId, startedAt, options.env)),
    });
    jobLog?.child({ runId: failed.runId })?.error('任务失败', {
      event: 'job.failed',
      err: new Error(message),
      context: { attempts: job.attempts },
    });
    log(`[collector] 任务失败 ${job.id} attempts=${job.attempts} error=${message}`);
    return 'failed';
  }
}

async function offlineSchedule(
  sql: Sql,
  targetId: string,
  now: Date,
  env: NodeJS.ProcessEnv | undefined,
): Promise<{ schedule: ReturnType<typeof decideSchedule> } | Record<string, never>> {
  const context = await readTargetSchedule(sql, targetId);
  if (!context) return {};
  return {
    schedule: decideSchedule(
      {
        type: context.type,
        mode: context.intervalMode,
        fixedMinutes: context.intervalMinutes,
        pubdate: context.pubdate,
      },
      now,
      readFrequencyPolicy(env ?? process.env),
    ),
  };
}

export async function runCollectorLoop(options: {
  sql: Sql;
  provider?: MonitorProvider;
  config: CollectorConfig;
  signal: AbortSignal;
  log?: (line: string) => void;
  logger?: CollectorLogger;
}): Promise<void> {
  const log = options.log ?? (() => undefined);
  const provider = options.provider ?? createOfflineProvider();
  let lastFinished = 0;
  log(`[collector] 开始轮询 instance=${options.config.instanceId}`);
  let heartbeatChain = Promise.resolve();
  const beat = (
    status: 'starting' | 'idle' | 'running' | 'stopped',
    currentJobId: string | null,
  ) => {
    heartbeatChain = heartbeatChain
      .then(() =>
        upsertCollectorHeartbeat(options.sql, {
          instanceId: options.config.instanceId,
          status,
          currentJobId,
        }),
      )
      .then(
        () => undefined,
        () => undefined,
      );
    return heartbeatChain;
  };
  const timer = setInterval(() => {
    heartbeatChain = heartbeatChain
      .then(() => refreshCollectorHeartbeat(options.sql, options.config.instanceId))
      .then(
        () => undefined,
        () => undefined,
      );
  }, COLLECTOR_HEARTBEAT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    await beat('starting', null);
    while (!options.signal.aborted) {
      const wait = options.config.rateLimitMs - (Date.now() - lastFinished);
      if (lastFinished > 0 && wait > 0) await sleep(wait, options.signal);
      if (options.signal.aborted) break;
      await beat('idle', null);
      const outcome = await runCollectorOnce({
        sql: options.sql,
        provider,
        config: options.config,
        log,
        ...(options.logger ? { logger: options.logger } : {}),
        instanceId: options.config.instanceId,
        env: process.env,
      });
      if (outcome !== 'idle') lastFinished = Date.now();
      if (options.signal.aborted) break;
      if (outcome === 'idle') await sleep(options.config.pollMs, options.signal);
    }
  } finally {
    clearInterval(timer);
    await beat('stopped', null);
    log(`[collector] 已退出 instance=${options.config.instanceId}`);
  }
}
