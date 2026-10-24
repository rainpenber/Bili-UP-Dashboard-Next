import {
  findActiveVideoTargetId,
  getCreatorUploadsSyncState,
  insertCreatorPublishEvent,
  upsertCreatorFaceUrl,
  upsertCreatorUploadsSyncState,
  upsertVideoArchiveMetadata,
  type Sql,
} from '@studio/db';
import { BilibiliFailure, type UpstreamCall } from './bilibili-failure';
import type { ParsedArchiveVideo } from './bilibili-discovery-parse';
import { scrubCollectorError } from './credentials';
import { httpsUrl } from './image-asset';

/** Keep in sync with packages/contracts CREATOR_UPLOADS_SYNC_*. */
export const CREATOR_UPLOADS_SYNC_TTL_MS = 6 * 60 * 60 * 1000;
export const CREATOR_UPLOADS_SYNC_MAX_VIDEOS = 100;
export const CREATOR_UPLOADS_SYNC_MAX_PAGES = 3;

export type CreatorUploadsSyncStatus = {
  mid: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  videoCount: number;
  eventsCreated: number;
  stale: boolean;
  ttlMs: number;
};

export type CreatorUploadsSyncResponse = CreatorUploadsSyncStatus & {
  cached: boolean;
  pagesFetched: number;
};

export type CreatorArchivesPageProvider = {
  fetchCreatorArchives(input: {
    mid: string;
    cookieHeader: string | null;
    accountKey: string;
    pn?: number;
    ps?: number;
  }): Promise<{
    videos: ParsedArchiveVideo[];
    calls: UpstreamCall[];
    page?: { pn: number; ps: number; count: number | null };
  }>;
  /** Optional: space card / acc info for face_url during uploads sync. */
  fetchCreatorProfile?(input: {
    mid: string;
    cookieHeader: string | null;
    accountKey: string;
  }): Promise<{
    faceUrl: string | null;
    uname: string | null;
    calls: UpstreamCall[];
  }>;
};

export type CreatorUploadsSyncEffects = {
  resolveAccount(input: {
    targetAccountId: string | null;
    forcedAccountId: string | null;
  }): Promise<{ id: string; status: string } | null>;
  cookieHeaderFor(accountId: string): Promise<string | null>;
  audit(input: {
    accountId: string | null;
    runId: string | null;
    calls: UpstreamCall[];
  }): Promise<void>;
};

const PAGE_SIZE = 50;

function toStatus(
  mid: string,
  state: {
    lastSyncedAt: Date | null;
    lastError: string | null;
    lastVideoCount: number;
    lastEventsCreated: number;
  } | null,
  now: Date,
): CreatorUploadsSyncStatus {
  const lastSyncedAt = state?.lastSyncedAt ?? null;
  const stale =
    lastSyncedAt === null || now.getTime() - lastSyncedAt.getTime() >= CREATOR_UPLOADS_SYNC_TTL_MS;
  return {
    mid,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    lastError: state?.lastError ?? null,
    videoCount: state?.lastVideoCount ?? 0,
    eventsCreated: state?.lastEventsCreated ?? 0,
    stale,
    ttlMs: CREATOR_UPLOADS_SYNC_TTL_MS,
  };
}

export async function readCreatorUploadsSyncStatus(
  sql: Sql,
  mid: string,
  now = new Date(),
): Promise<CreatorUploadsSyncStatus> {
  const state = await getCreatorUploadsSyncState(sql, mid);
  return toStatus(mid, state, now);
}

async function persistVideosAndEvents(
  sql: Sql,
  input: { mid: string; now: Date; videos: ParsedArchiveVideo[] },
): Promise<{ videoCount: number; eventsCreated: number }> {
  let eventsCreated = 0;
  const seen = new Set<string>();
  for (const video of input.videos) {
    if (seen.has(video.bvid)) continue;
    seen.add(video.bvid);
    const publishedAt = new Date(Number(video.created) * 1000);
    const ownerMid = video.mid && video.mid.length > 0 ? video.mid : input.mid;
    await upsertVideoArchiveMetadata(sql, {
      bvid: video.bvid,
      title: video.title,
      mid: ownerMid,
      pubdate: publishedAt,
      coverUrl: video.pic ? httpsUrl(video.pic) : null,
    });
    const existingTargetId = await findActiveVideoTargetId(sql, video.bvid);
    const inserted = await insertCreatorPublishEvent(sql, {
      id: crypto.randomUUID(),
      mid: input.mid,
      eventKind: 'video',
      externalId: video.bvid,
      publishedAt,
      titleSnapshot: video.title || video.bvid,
      firstDiscoveredAt: input.now,
      monitoredTargetId: existingTargetId,
      source: 'bilibili',
    });
    if (inserted.created) eventsCreated += 1;
  }
  return { videoCount: seen.size, eventsCreated };
}

/**
 * Sync recent uploads for a creator into videos + creator_publish_events.
 * Max 100 videos / 3 pages. TTL 6h unless force. Never creates monitor targets.
 */
export async function syncCreatorUploads(options: {
  sql: Sql;
  mid: string;
  force: boolean;
  provider: CreatorArchivesPageProvider;
  effects: CreatorUploadsSyncEffects;
  forcedAccountId: string | null;
  now?: Date;
}): Promise<CreatorUploadsSyncResponse> {
  const now = options.now ?? new Date();
  const status = await readCreatorUploadsSyncStatus(options.sql, options.mid, now);
  if (!options.force && !status.stale && status.lastSyncedAt) {
    return {
      ...status,
      cached: true,
      pagesFetched: 0,
    };
  }

  const account = await options.effects.resolveAccount({
    targetAccountId: null,
    forcedAccountId: options.forcedAccountId,
  });
  let cookie: string | null = null;
  if (account) {
    try {
      cookie = await options.effects.cookieHeaderFor(account.id);
    } catch (error) {
      const message = scrubCollectorError(error);
      await upsertCreatorUploadsSyncState(options.sql, {
        mid: options.mid,
        lastSyncedAt: status.lastSyncedAt ? new Date(status.lastSyncedAt) : null,
        lastError: message,
        lastVideoCount: status.videoCount,
        lastEventsCreated: status.eventsCreated,
        now,
      });
      throw new BilibiliFailure({
        message,
        kind: 'retryable',
        endpoint: 'space_arc_search',
        statusCode: null,
        bizCode: null,
        calls: [],
      });
    }
  }

  const calls: UpstreamCall[] = [];
  const collected: ParsedArchiveVideo[] = [];
  let pagesFetched = 0;
  try {
    for (let pn = 1; pn <= CREATOR_UPLOADS_SYNC_MAX_PAGES; pn += 1) {
      if (collected.length >= CREATOR_UPLOADS_SYNC_MAX_VIDEOS) break;
      const page = await options.provider.fetchCreatorArchives({
        mid: options.mid,
        cookieHeader: cookie,
        accountKey: account?.id ?? 'anonymous',
        pn,
        ps: PAGE_SIZE,
      });
      calls.push(...page.calls);
      pagesFetched += 1;
      if (page.videos.length === 0) break;
      for (const video of page.videos) {
        if (collected.length >= CREATOR_UPLOADS_SYNC_MAX_VIDEOS) break;
        collected.push(video);
      }
      if (page.videos.length < PAGE_SIZE) break;
      const total = page.page?.count;
      if (typeof total === 'number' && pn * PAGE_SIZE >= total) break;
    }
  } catch (error) {
    const message = scrubCollectorError(error);
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
    await upsertCreatorUploadsSyncState(options.sql, {
      mid: options.mid,
      lastSyncedAt: status.lastSyncedAt ? new Date(status.lastSyncedAt) : null,
      lastError: message,
      lastVideoCount: status.videoCount,
      lastEventsCreated: status.eventsCreated,
      now,
    });
    throw failure;
  }

  if (options.provider.fetchCreatorProfile) {
    try {
      const profile = await options.provider.fetchCreatorProfile({
        mid: options.mid,
        cookieHeader: cookie,
        accountKey: account?.id ?? 'anonymous',
      });
      calls.push(...profile.calls);
      if (profile.faceUrl || profile.uname) {
        await upsertCreatorFaceUrl(options.sql, {
          mid: options.mid,
          faceUrl: profile.faceUrl ? httpsUrl(profile.faceUrl) : null,
          uname: profile.uname,
        });
      }
    } catch (error) {
      // Face is best-effort during uploads sync; covers/events still commit.
      if (error instanceof BilibiliFailure) calls.push(...error.calls);
    }
  }

  const written = await persistVideosAndEvents(options.sql, {
    mid: options.mid,
    now,
    videos: collected,
  });
  await options.effects.audit({
    accountId: account?.id ?? null,
    runId: null,
    calls,
  });
  const saved = await upsertCreatorUploadsSyncState(options.sql, {
    mid: options.mid,
    lastSyncedAt: now,
    lastError: null,
    lastVideoCount: written.videoCount,
    lastEventsCreated: written.eventsCreated,
    now,
  });
  return {
    mid: options.mid,
    cached: false,
    lastSyncedAt: saved.lastSyncedAt?.toISOString() ?? now.toISOString(),
    lastError: null,
    videoCount: written.videoCount,
    eventsCreated: written.eventsCreated,
    pagesFetched,
    stale: false,
    ttlMs: CREATOR_UPLOADS_SYNC_TTL_MS,
  };
}
