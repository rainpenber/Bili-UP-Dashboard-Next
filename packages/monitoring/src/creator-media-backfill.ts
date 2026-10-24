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
import { assetizeHdslbImage, httpsUrl, ImageReject, type BinaryTransport } from './image-asset';

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
  faceAssetId: string | null;
  coversAssetized: number;
  coversFailed: number;
  assetsReused: number;
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

async function readCreatorMediaIds(
  sql: Sql,
  mid: string,
): Promise<{ faceUrl: string | null; faceAssetId: string | null }> {
  const faceRows = await sql<{ face_url: string | null; face_asset_id: string | null }[]>`
    SELECT face_url, face_asset_id FROM creators WHERE mid = ${mid}::bigint LIMIT 1
  `;
  return {
    faceUrl: faceRows[0]?.face_url ?? null,
    faceAssetId: faceRows[0]?.face_asset_id ?? null,
  };
}

async function markFaceAssetFailure(sql: Sql, mid: string, message: string): Promise<void> {
  await sql`
    UPDATE creators SET
      metadata_error = ${message},
      metadata_state = CASE
        WHEN metadata_state = 'ok' THEN 'partial'
        ELSE metadata_state
      END,
      updated_at = now()
    WHERE mid = ${mid}::bigint
  `;
}

async function markCoverAssetFailure(sql: Sql, bvid: string, message: string): Promise<void> {
  await sql`
    UPDATE videos SET
      cover_state = 'failed',
      metadata_error = ${message},
      updated_at = now()
    WHERE bvid = ${bvid}
  `;
}

async function writeFaceAssetId(sql: Sql, mid: string, assetId: string): Promise<void> {
  await sql`
    UPDATE creators SET
      face_asset_id = COALESCE(${assetId}, face_asset_id),
      metadata_error = NULL,
      metadata_state = CASE
        WHEN metadata_state IN ('partial', 'failed', 'pending') THEN 'ok'
        ELSE metadata_state
      END,
      updated_at = now()
    WHERE mid = ${mid}::bigint
  `;
}

async function writeCoverAssetId(sql: Sql, bvid: string, assetId: string): Promise<void> {
  await sql`
    UPDATE videos SET
      cover_asset_id = COALESCE(${assetId}, cover_asset_id),
      cover_state = 'ok',
      metadata_error = NULL,
      updated_at = now()
    WHERE bvid = ${bvid}
  `;
}

/**
 * Backfill face_url + cover_url for a creator (recent ≤100 uploads), then
 * materialize local assets (same download/store path as metadata-refresh).
 * Idempotent; TTL 6h unless force. Asset failures are soft (continue).
 */
export async function backfillCreatorMedia(options: {
  sql: Sql;
  mid: string;
  force: boolean;
  provider: CreatorMediaBackfillProvider;
  effects: CreatorMediaBackfillEffects;
  forcedAccountId: string | null;
  download?: BinaryTransport | null;
  assetsRoot?: string | null;
  now?: Date;
}): Promise<CreatorMediaBackfillResponse> {
  const now = options.now ?? new Date();
  const status = await readCreatorMediaBackfillStatus(options.sql, options.mid, now);
  if (!options.force && !status.stale && status.lastSyncedAt) {
    const ids = await readCreatorMediaIds(options.sql, options.mid);
    return {
      ...status,
      cached: true,
      pagesFetched: 0,
      faceUrl: ids.faceUrl,
      faceAssetId: ids.faceAssetId,
      coversAssetized: 0,
      coversFailed: 0,
      assetsReused: 0,
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
  let faceAssetId: string | null = null;
  let faceUpdated = false;
  let coversUpdated = 0;
  let coversAssetized = 0;
  let coversFailed = 0;
  let assetsReused = 0;
  let pagesFetched = 0;
  const canAssetize = Boolean(options.download && options.assetsRoot);

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

    if (faceUrl && canAssetize) {
      const existing = await options.sql<{ face_asset_id: string | null }[]>`
        SELECT face_asset_id FROM creators WHERE mid = ${options.mid}::bigint LIMIT 1
      `;
      try {
        const result = await assetizeHdslbImage({
          sql: options.sql,
          assetsRoot: options.assetsRoot!,
          download: options.download!,
          url: faceUrl,
          kind: 'face',
          existingAssetId: existing[0]?.face_asset_id ?? null,
          now,
        });
        await writeFaceAssetId(options.sql, options.mid, result.assetId);
        faceAssetId = result.assetId;
        if (result.reused) assetsReused += 1;
      } catch (error) {
        if (!(error instanceof ImageReject)) throw error;
        await markFaceAssetFailure(options.sql, options.mid, scrubCollectorError(error));
      }
    } else if (faceUrl && !canAssetize) {
      await markFaceAssetFailure(options.sql, options.mid, '媒体资源目录或下载层未配置');
    } else {
      const ids = await readCreatorMediaIds(options.sql, options.mid);
      faceAssetId = ids.faceAssetId;
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

      if (!canAssetize) {
        await markCoverAssetFailure(options.sql, video.bvid, '媒体资源目录或下载层未配置');
        coversFailed += 1;
        continue;
      }

      const existing = await options.sql<{ cover_asset_id: string | null }[]>`
        SELECT cover_asset_id FROM videos WHERE bvid = ${video.bvid} LIMIT 1
      `;
      try {
        const result = await assetizeHdslbImage({
          sql: options.sql,
          assetsRoot: options.assetsRoot!,
          download: options.download!,
          url: coverUrl,
          kind: 'cover',
          existingAssetId: existing[0]?.cover_asset_id ?? null,
          now,
        });
        await writeCoverAssetId(options.sql, video.bvid, result.assetId);
        coversAssetized += 1;
        if (result.reused) assetsReused += 1;
      } catch (error) {
        if (!(error instanceof ImageReject)) throw error;
        await markCoverAssetFailure(options.sql, video.bvid, scrubCollectorError(error));
        coversFailed += 1;
      }
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

  if (!faceAssetId) {
    const ids = await readCreatorMediaIds(options.sql, options.mid);
    faceAssetId = ids.faceAssetId;
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
    faceAssetId,
    coversAssetized,
    coversFailed,
    assetsReused,
  };
}
