import {
  claimNextCollectorJob,
  enqueueDueCollectorJobs,
  recordCollectorFailure,
  recordCollectorSuccess,
  upsertCollectorHeartbeat,
  writeCreatorSample,
  writeVideoSample,
  type Sql,
} from '@studio/db';
import {
  createOfflineProvider,
  truncateToUtcMinute,
  type MonitorProvider,
} from './offline-provider';

export type CollectorConfig = {
  pollMs: number;
  maxAttempts: number;
  backoffBaseMs: number;
  backoffCapMs: number;
  rateLimitMs: number;
  instanceId: string;
};

export type CollectorRunOutcome = 'idle' | 'succeeded' | 'failed';

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
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
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

export async function runCollectorOnce(options: {
  sql: Sql;
  provider: MonitorProvider;
  config: CollectorConfig;
  now?: Date;
  log?: (line: string) => void;
  instanceId?: string;
}): Promise<CollectorRunOutcome> {
  const log = options.log ?? (() => undefined);
  await enqueueDueCollectorJobs(options.sql);
  const job = await claimNextCollectorJob(options.sql);
  if (!job) return 'idle';
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
    const sampledAt = truncateToUtcMinute(startedAt);
    if (job.targetType === 'video') {
      const sample = await options.provider.collectVideo(job.externalId, sampledAt);
      const inserted = await writeVideoSample(options.sql, sample);
      await recordCollectorSuccess(options.sql, {
        jobId: job.id,
        targetId: job.targetId,
        samplesWritten: inserted ? 1 : 0,
        durationMs: Date.now() - startedMs,
        startedAt,
      });
    } else {
      const sample = await options.provider.collectCreator(job.externalId, sampledAt);
      const inserted = await writeCreatorSample(options.sql, sample);
      await recordCollectorSuccess(options.sql, {
        jobId: job.id,
        targetId: job.targetId,
        samplesWritten: inserted ? 1 : 0,
        durationMs: Date.now() - startedMs,
        startedAt,
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
    await recordCollectorFailure(options.sql, {
      jobId: job.id,
      targetId: job.targetId,
      attempts: job.attempts,
      maxAttempts: options.config.maxAttempts,
      error: message,
      durationMs: Math.max(0, Date.now() - startedMs),
      startedAt,
      retryAt,
    });
    log(`[collector] 任务失败 ${job.id} attempts=${job.attempts} error=${message}`);
    return 'failed';
  }
}

export async function runCollectorLoop(options: {
  sql: Sql;
  provider?: MonitorProvider;
  config: CollectorConfig;
  signal: AbortSignal;
  log?: (line: string) => void;
}): Promise<void> {
  const log = options.log ?? (() => undefined);
  const provider = options.provider ?? createOfflineProvider();
  let lastFinished = 0;
  log(`[collector] 开始轮询 instance=${options.config.instanceId}`);
  try {
    await upsertCollectorHeartbeat(options.sql, {
      instanceId: options.config.instanceId,
      status: 'starting',
      currentJobId: null,
    });
    while (!options.signal.aborted) {
      const wait = options.config.rateLimitMs - (Date.now() - lastFinished);
      if (lastFinished > 0 && wait > 0) await sleep(wait, options.signal);
      if (options.signal.aborted) break;
      await upsertCollectorHeartbeat(options.sql, {
        instanceId: options.config.instanceId,
        status: 'idle',
        currentJobId: null,
      });
      const outcome = await runCollectorOnce({
        sql: options.sql,
        provider,
        config: options.config,
        log,
        instanceId: options.config.instanceId,
      });
      if (outcome !== 'idle') lastFinished = Date.now();
      if (options.signal.aborted) break;
      if (outcome === 'idle') await sleep(options.config.pollMs, options.signal);
    }
  } finally {
    await upsertCollectorHeartbeat(options.sql, {
      instanceId: options.config.instanceId,
      status: 'stopped',
      currentJobId: null,
    }).catch(() => undefined);
    log(`[collector] 已退出 instance=${options.config.instanceId}`);
  }
}
