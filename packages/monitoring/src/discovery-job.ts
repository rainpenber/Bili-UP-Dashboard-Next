import {
  DISCOVERY_AUTO_CREATE_LIMIT,
  ensureVideoDenseCollectPlan,
  findActiveVideoTargetId,
  getCreatorDiscoveryConfig,
  insertCreatorPublishEvent,
  insertMonitorTarget,
  linkPublishEventTarget,
  markDiscoveryRunResult,
  type ClaimedCollectorJob,
  type CollectorScheduleWrite,
  type CreatorDiscoveryConfigRow,
  type Sql,
} from '@studio/db';
import type { UpstreamCall } from './bilibili-failure';
import { BilibiliFailure } from './bilibili-failure';
import type { ParsedArchiveVideo, ParsedSpaceDynamic } from './bilibili-discovery-parse';
import { scrubCollectorError } from './credentials';

export type DiscoveryListProvider = {
  fetchCreatorArchives(input: {
    mid: string;
    cookieHeader: string | null;
    accountKey: string;
  }): Promise<{ videos: ParsedArchiveVideo[]; calls: UpstreamCall[] }>;
  fetchCreatorDynamics(input: {
    mid: string;
    cookieHeader: string | null;
    accountKey: string;
  }): Promise<{ dynamics: ParsedSpaceDynamic[]; calls: UpstreamCall[] }>;
};

export type DiscoveryJobEffects = {
  cookieHeaderFor(accountId: string): Promise<string | null>;
  resolveAccount(input: {
    targetAccountId: string | null;
    forcedAccountId: string | null;
  }): Promise<{ id: string; status: string } | null>;
  commitDiscovery(input: {
    jobId: string;
    targetId: string;
    startedAt: Date;
    durationMs: number;
    schedule: CollectorScheduleWrite;
    error: string | null;
    success: boolean;
  }): Promise<{ runId: string }>;
  deferJob(jobId: string, until: Date): Promise<void>;
  audit(input: {
    accountId: string | null;
    runId: string | null;
    calls: UpstreamCall[];
  }): Promise<void>;
};

const DISCOVERY_INTERVAL: CollectorScheduleWrite = { minutes: 5, persistMinutes: false };

export type DiscoveryRoundSummary = {
  seededVideoWatermark: boolean;
  seededDynamicWatermark: boolean;
  videoEventsCreated: number;
  dynamicEventsCreated: number;
  targetsCreated: number;
  targetsSuppressed: number;
  videoWatermarkCreated: bigint | null;
  dynamicWatermarkPubTs: bigint | null;
};

/**
 * Pure-ish round processing against fixed list samples (offline/mock + unit tests).
 * Does not invent events on empty failure — caller must not invoke after upstream failure.
 */
export async function applyDiscoveryRound(
  sql: Sql,
  input: {
    config: CreatorDiscoveryConfigRow;
    now: Date;
    videos: ParsedArchiveVideo[];
    dynamics: ParsedSpaceDynamic[];
  },
): Promise<DiscoveryRoundSummary> {
  const { config, now } = input;
  let videoWatermark = config.videoWatermarkCreated;
  let dynamicWatermark = config.dynamicWatermarkPubTs;
  let seededVideoWatermark = false;
  let seededDynamicWatermark = false;
  let videoEventsCreated = 0;
  let dynamicEventsCreated = 0;
  let targetsCreated = 0;
  let targetsSuppressed = 0;

  if (config.discoverVideos) {
    const maxCreated =
      input.videos.length === 0
        ? null
        : input.videos.reduce((max, v) => (v.created > max ? v.created : max), 0n);
    if (videoWatermark === null) {
      // First success: seed watermark, do not emit historical backlog as "new".
      videoWatermark = maxCreated ?? BigInt(Math.floor(now.getTime() / 1000));
      seededVideoWatermark = true;
    } else {
      const newer = input.videos
        .filter((v) => v.created > videoWatermark!)
        .sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : 0));
      let autoSlots = DISCOVERY_AUTO_CREATE_LIMIT;
      for (const video of newer) {
        const publishedAt = new Date(Number(video.created) * 1000);
        const existingTargetId = await findActiveVideoTargetId(sql, video.bvid);
        const inserted = await insertCreatorPublishEvent(sql, {
          id: crypto.randomUUID(),
          mid: config.mid,
          eventKind: 'video',
          externalId: video.bvid,
          publishedAt,
          titleSnapshot: video.title,
          firstDiscoveredAt: now,
          monitoredTargetId: existingTargetId,
        });
        if (inserted.created) videoEventsCreated += 1;

        if (config.monitorNewVideos) {
          if (existingTargetId) {
            await linkPublishEventTarget(sql, {
              mid: config.mid,
              eventKind: 'video',
              externalId: video.bvid,
              targetId: existingTargetId,
            });
          } else if (autoSlots > 0) {
            const created = await insertMonitorTarget(sql, {
              id: crypto.randomUUID(),
              type: 'video',
              externalId: video.bvid,
              label: video.title.slice(0, 80) || video.bvid,
              tags: ['auto-discovery'],
              intervalMinutes: 15,
              intervalMode: 'auto',
              now,
            });
            if (created.created) {
              targetsCreated += 1;
              autoSlots -= 1;
              await ensureVideoDenseCollectPlan(sql, {
                targetId: created.target.id,
                activatedAt: now,
              });
            }
            await linkPublishEventTarget(sql, {
              mid: config.mid,
              eventKind: 'video',
              externalId: video.bvid,
              targetId: created.target.id,
            });
          } else if (!existingTargetId) {
            targetsSuppressed += 1;
          }
        }
        if (video.created > (videoWatermark ?? 0n)) videoWatermark = video.created;
      }
    }
  }

  if (config.discoverDynamics) {
    const maxPub =
      input.dynamics.length === 0
        ? null
        : input.dynamics.reduce((max, d) => (d.publishedAtSec > max ? d.publishedAtSec : max), 0n);
    if (dynamicWatermark === null) {
      dynamicWatermark = maxPub ?? BigInt(Math.floor(now.getTime() / 1000));
      seededDynamicWatermark = true;
    } else {
      const newer = input.dynamics
        .filter((d) => d.publishedAtSec > dynamicWatermark!)
        .sort((a, b) =>
          a.publishedAtSec < b.publishedAtSec ? -1 : a.publishedAtSec > b.publishedAtSec ? 1 : 0,
        );
      for (const dyn of newer) {
        const publishedAt = new Date(Number(dyn.publishedAtSec) * 1000);
        const inserted = await insertCreatorPublishEvent(sql, {
          id: crypto.randomUUID(),
          mid: config.mid,
          eventKind: 'dynamic',
          externalId: dyn.dynamicId,
          publishedAt,
          titleSnapshot: dyn.title || '动态',
          firstDiscoveredAt: now,
          monitoredTargetId: null,
        });
        if (inserted.created) dynamicEventsCreated += 1;
        if (dyn.publishedAtSec > (dynamicWatermark ?? 0n)) {
          dynamicWatermark = dyn.publishedAtSec;
        }
      }
    }
  }

  await markDiscoveryRunResult(sql, {
    mid: config.mid,
    now,
    success: true,
    error: null,
    videoWatermarkCreated: videoWatermark,
    dynamicWatermarkPubTs: dynamicWatermark,
    suppressedAutoCreateDelta: targetsSuppressed,
  });

  return {
    seededVideoWatermark,
    seededDynamicWatermark,
    videoEventsCreated,
    dynamicEventsCreated,
    targetsCreated,
    targetsSuppressed,
    videoWatermarkCreated: videoWatermark,
    dynamicWatermarkPubTs: dynamicWatermark,
  };
}

export async function runDiscoveryJob(options: {
  sql: Sql;
  job: ClaimedCollectorJob;
  provider: DiscoveryListProvider;
  effects: DiscoveryJobEffects;
  forcedAccountId: string | null;
  now: Date;
  log?: (line: string) => void;
}): Promise<'succeeded' | 'failed' | 'deferred'> {
  const log = options.log ?? (() => undefined);
  const startedAt = options.now;
  const startedMs = Date.now();
  const mid = options.job.externalId;
  const config = await getCreatorDiscoveryConfig(options.sql, mid);
  if (!config || !config.enabled) {
    await options.effects.commitDiscovery({
      jobId: options.job.id,
      targetId: options.job.targetId,
      startedAt,
      durationMs: Math.max(0, Date.now() - startedMs),
      schedule: DISCOVERY_INTERVAL,
      error: null,
      success: true,
    });
    log(`[collector] 发现已关闭，跳过 ${options.job.id}`);
    return 'succeeded';
  }

  const account = await options.effects.resolveAccount({
    targetAccountId: options.job.accountId,
    forcedAccountId: options.forcedAccountId,
  });
  let cookie: string | null = null;
  if (account) {
    try {
      cookie = await options.effects.cookieHeaderFor(account.id);
    } catch (error) {
      await markDiscoveryRunResult(options.sql, {
        mid,
        now: options.now,
        success: false,
        error: scrubCollectorError(error),
      });
      await options.effects.deferJob(
        options.job.id,
        new Date(options.now.getTime() + 15 * 60 * 1000),
      );
      return 'deferred';
    }
  }

  const calls: UpstreamCall[] = [];
  let videos: ParsedArchiveVideo[] = [];
  let dynamics: ParsedSpaceDynamic[] = [];
  try {
    if (config.discoverVideos) {
      const archived = await options.provider.fetchCreatorArchives({
        mid,
        cookieHeader: cookie,
        accountKey: account?.id ?? 'anonymous',
      });
      calls.push(...archived.calls);
      videos = archived.videos;
    }
    if (config.discoverDynamics) {
      const feed = await options.provider.fetchCreatorDynamics({
        mid,
        cookieHeader: cookie,
        accountKey: account?.id ?? 'anonymous',
      });
      calls.push(...feed.calls);
      dynamics = feed.dynamics;
    }
  } catch (error) {
    const message = scrubCollectorError(error);
    await markDiscoveryRunResult(options.sql, {
      mid,
      now: options.now,
      success: false,
      error: message,
    });
    const failure =
      error instanceof BilibiliFailure
        ? error
        : new BilibiliFailure({
            message,
            kind: 'retryable',
            endpoint: 'space_arc_search',
            statusCode: null,
            bizCode: null,
            calls,
          });
    await options.effects.audit({
      accountId: account?.id ?? null,
      runId: null,
      calls: failure.calls.length > 0 ? failure.calls : calls,
    });
    // Keep last success watermarks; schedule backoff on the discovery target.
    const backoffMin = failure.kind === 'risk_control' || failure.kind === 'rate_limited' ? 30 : 5;
    await options.effects.commitDiscovery({
      jobId: options.job.id,
      targetId: options.job.targetId,
      startedAt,
      durationMs: Math.max(0, Date.now() - startedMs),
      schedule: { minutes: backoffMin, persistMinutes: false },
      error: message,
      success: false,
    });
    log(`[collector] 发现失败 ${options.job.id} ${message}`);
    return 'failed';
  }

  const summary = await applyDiscoveryRound(options.sql, {
    config,
    now: options.now,
    videos,
    dynamics,
  });
  const committed = await options.effects.commitDiscovery({
    jobId: options.job.id,
    targetId: options.job.targetId,
    startedAt,
    durationMs: Math.max(0, Date.now() - startedMs),
    schedule: DISCOVERY_INTERVAL,
    error: null,
    success: true,
  });
  await options.effects.audit({
    accountId: account?.id ?? null,
    runId: committed.runId,
    calls,
  });
  log(
    `[collector] 发现成功 ${options.job.id} videos=${summary.videoEventsCreated} dynamics=${summary.dynamicEventsCreated} targets=${summary.targetsCreated} suppressed=${summary.targetsSuppressed}`,
  );
  return 'succeeded';
}
