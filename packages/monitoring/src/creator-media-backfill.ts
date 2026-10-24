import {
  getCreatorMediaBackfillState,
  upsertCreatorFaceUrl,
  upsertCreatorMediaBackfillState,
  upsertVideoArchiveMetadata,
  type Sql,
} from '@studio/db';
import { BilibiliFailure, type UpstreamCall } from './bilibili-failure';
import type { ParsedArchiveVideo } from './bilibili-discovery-parse';
import { scrubCollectorError } from './credentials';
import { httpsUrl } from './image-asset';

/** Keep in sync with packages/contracts CREATOR_MEDIA_BACKFILL_*. */
export const CREATOR_MEDIA_BACKFILL_TTL_MS = 6 * 60 * 60 * 1000;
export const CREATOR_MEDIA_BACKFILL_MAX_VIDEOS = 100;
export const CREATOR_MEDIA_BACKFILL_MAX_PAGES = 3;

export type CreatorMediaBackfillStatus = {
  mid: string;
  lastSyncedAt: string | null;
  lastError: string | null;
  faceUpdated: boolean;
  coversUpdated: number;
  stale: boolean;
  ttlMs: number;
};

export type CreatorMediaBackfillResponse = CreatorMediaBackfillStatus & {
  cached: boolean;
  pagesFetched: number;
  faceUrl: string | null;
};

export type CreatorMediaBackfillProvider = {
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
  fetchCreatorProfile(input: {
    mid: string;
    cookieHeader: string | null;
    accountKey: string;
  }): Promise<{
    faceUrl: string | null;
    uname: string | null;
    calls: UpstreamCall[];
  }>;
};

export type CreatorMediaBackfillEffects = {
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
    lastFaceUpdated: boolean;
    lastCoversUpdated: number;
  } | null,
  now: Date,
): CreatorMediaBackfillStatus {
  const lastSyncedAt = state?.lastSyncedAt ?? null;
  const stale =
    lastSyncedAt === null ||
    now.getTime() - lastSyncedAt.getTime() >= CREATOR_MEDIA_BACKFILL_TTL_MS;
  return {
    mid,
    lastSyncedAt: lastSyncedAt?.toISOString() ?? null,
    lastError: state?.lastError ?? null,
    faceUpdated: state?.lastFaceUpdated ?? false,
    coversUpdated: state?.lastCoversUpdated ?? 0,
    stale,
    ttlMs: CREATOR_MEDIA_BACKFILL_TTL_MS,
  };
}

export async function readCreatorMediaBackfillStatus(
  sql: Sql,
  mid: string,
  now = new Date(),
): Promise<CreatorMediaBackfillStatus> {
  const state = await getCreatorMediaBackfillState(sql, mid);
  return toStatus(mid, state, now);
}

/**
 * Backfill face_url + cover_url for a creator (recent ≤100 uploads).
 * Idempotent; TTL 6h unless force. Does not download images to disk.
 */
export async function backfillCreatorMedia(options: {
  sql: Sql;
  mid: string;
  force: boolean;
  provider: CreatorMediaBackfillProvider;
  effects: CreatorMediaBackfillEffects;
  forcedAccountId: string | null;
  now?: Date;
}): Promise<CreatorMediaBackfillResponse> {
  const now = options.now ?? new Date();
  const status = await readCreatorMediaBackfillStatus(options.sql, options.mid, now);
  if (!options.force && !status.stale && status.lastSyncedAt) {
    const faceRows = await options.sql<{ face_url: string | null }[]>`
      SELECT face_url FROM creators WHERE mid = ${options.mid}::bigint LIMIT 1
    `;
    return {
      ...status,
      cached: true,
      pagesFetched: 0,
      faceUrl: faceRows[0]?.face_url ?? null,
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
      await upsertCreatorMediaBackfillState(options.sql, {
        mid: options.mid,
        lastSyncedAt: status.lastSyncedAt ? new Date(status.lastSyncedAt) : null,
        lastError: message,
        lastFaceUpdated: status.faceUpdated,
        lastCoversUpdated: status.coversUpdated,
        now,
      });
      throw new BilibiliFailure({
        message,
        kind: 'retryable',
        endpoint: 'web_interface_card',
        statusCode: null,
        bizCode: null,
        calls: [],
      });
    }
  }

  const calls: UpstreamCall[] = [];
  let faceUrl: string | null = null;
  let faceUpdated = false;
  let coversUpdated = 0;
  let pagesFetched = 0;

  try {
    const profile = await options.provider.fetchCreatorProfile({
      mid: options.mid,
      cookieHeader: cookie,
      accountKey: account?.id ?? 'anonymous',
    });
    calls.push(...profile.calls);
    faceUrl = profile.faceUrl ? httpsUrl(profile.faceUrl) : null;
    if (faceUrl || profile.uname) {
      await upsertCreatorFaceUrl(options.sql, {
        mid: options.mid,
        faceUrl,
        uname: profile.uname,
      });
      faceUpdated = Boolean(faceUrl);
    }

    const collected: ParsedArchiveVideo[] = [];
    for (let pn = 1; pn <= CREATOR_MEDIA_BACKFILL_MAX_PAGES; pn += 1) {
      if (collected.length >= CREATOR_MEDIA_BACKFILL_MAX_VIDEOS) break;
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
        if (collected.length >= CREATOR_MEDIA_BACKFILL_MAX_VIDEOS) break;
        collected.push(video);
      }
      if (page.videos.length < PAGE_SIZE) break;
      const total = page.page?.count;
      if (typeof total === 'number' && pn * PAGE_SIZE >= total) break;
    }

    for (const video of collected) {
      const coverUrl = video.pic ? httpsUrl(video.pic) : null;
      if (!coverUrl) continue;
      const ownerMid = video.mid && video.mid.length > 0 ? video.mid : options.mid;
      await upsertVideoArchiveMetadata(options.sql, {
        bvid: video.bvid,
        title: video.title,
        mid: ownerMid,
        pubdate: new Date(Number(video.created) * 1000),
        coverUrl,
      });
      coversUpdated += 1;
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
    await upsertCreatorMediaBackfillState(options.sql, {
      mid: options.mid,
      lastSyncedAt: status.lastSyncedAt ? new Date(status.lastSyncedAt) : null,
      lastError: message,
      lastFaceUpdated: status.faceUpdated,
      lastCoversUpdated: status.coversUpdated,
      now,
    });
    throw failure;
  }

  await options.effects.audit({
    accountId: account?.id ?? null,
    runId: null,
    calls,
  });
  const saved = await upsertCreatorMediaBackfillState(options.sql, {
    mid: options.mid,
    lastSyncedAt: now,
    lastError: null,
    lastFaceUpdated: faceUpdated,
    lastCoversUpdated: coversUpdated,
    now,
  });
  return {
    mid: options.mid,
    cached: false,
    lastSyncedAt: saved.lastSyncedAt?.toISOString() ?? now.toISOString(),
    lastError: null,
    faceUpdated,
    coversUpdated,
    pagesFetched,
    stale: false,
    ttlMs: CREATOR_MEDIA_BACKFILL_TTL_MS,
    faceUrl,
  };
}
