import type { Sql } from '@studio/db';
import {
  insertCollectorRequests,
  partitionNameFromLabels,
  resolveCollectorAccount,
} from '@studio/db';
import { scrubString, type StudioLogger } from '@studio/observability';
import { readBilibiliRuntimeConfig } from './bilibili-config';
import { classifyBilibiliResponse } from './bilibili-failure';
import { readBizCode } from './bilibili-parse';
import { bilibiliHeaders, guardTransport, type HttpTransport } from './bilibili-transport';
import {
  downloadHdslbImage,
  httpsUrl,
  ImageReject,
  storeImageBytes,
  type BinaryTransport,
} from './image-asset';
import { scrubSensitive } from './sensitive';
import { formatSourceMinute, truncateToUtcMinute } from './offline-provider';
import { acquireRequestSlot, ANONYMOUS_RATE_ACCOUNT_ID, type RatePolicy } from './rate-limiter';
import type { ThrottleClock } from './throttle';
import { parseViewDetail, type ParsedCard, type ParsedViewDetail } from './view-detail';
import type postgres from 'postgres';
import { readWebuiIds } from './webui-import';

function jsonValue(value: unknown): postgres.JSONValue {
  return JSON.parse(JSON.stringify(value)) as postgres.JSONValue;
}

const BVID = /^BV[1-9A-HJ-NP-Za-km-z]{10}$/;
const MID = /^[1-9][0-9]{0,18}$/;
const VIEW_DETAIL_URL = 'https://api.bilibili.com/x/web-interface/view/detail';
const RELATION_URL = 'https://api.bilibili.com/x/relation/stat';

export const BACKFILL_STALE_MS = 10 * 60 * 1000;

export type MetadataKind = 'video' | 'creator';
export type MetadataMode = 'bvid' | 'dir' | 'all-missing';
export type MetadataState = 'pending' | 'ok' | 'failed' | 'partial';
export type CoverState = 'pending' | 'ok' | 'failed' | 'none';

export type VideoRefreshResult = {
  bvid: string;
  cid: string | null;
  title: string | null;
  tags: string[];
  metadataState: MetadataState;
  coverState: CoverState;
};

export type CreatorRefreshResult = {
  mid: string;
  uname: string | null;
  metadataState: MetadataState;
  followerCount: string | null;
  faceAssetId: string | null;
};

export type MetadataRunView = {
  id: string;
  kind: MetadataKind;
  mode: MetadataMode;
  status: 'running' | 'succeeded' | 'failed' | 'aborted';
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  report: Record<string, unknown>;
  error: string | null;
};

export class BackfillConflict extends Error {
  readonly backfillRunId: string;

  constructor(backfillRunId: string) {
    super('已有元数据批次在运行');
    this.name = 'BackfillConflict';
    this.backfillRunId = backfillRunId;
  }
}

export class MetadataRequestError extends Error {
  readonly bizCode: number | null;
  readonly abort: boolean;

  constructor(message: string, bizCode: number | null, abort: boolean) {
    super(message);
    this.name = 'MetadataRequestError';
    this.bizCode = bizCode;
    this.abort = abort;
  }
}

export function scrubMetadataError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return scrubString(scrubSensitive(raw)).slice(0, 500);
}

export type MetadataRefreshDeps = {
  sql: Sql;
  transport: HttpTransport;
  download?: BinaryTransport;
  assetsRoot?: string | null;
  ratePolicy?: RatePolicy;
  clock?: ThrottleClock;
  random?: () => number;
  now?: () => Date;
  logger?: StudioLogger | null;
  env?: NodeJS.ProcessEnv;
  accountId?: string;
  /** Set for the duration of a batch so collector_requests.run_id can point at it. */
  backfillRunId?: string | null;
  /** Test hook, after the run is marked running and before the first item. */
  gate?: () => Promise<void>;
};

type ReportItem = {
  id: string;
  outcome: 'succeeded' | 'failed' | 'skipped';
  error: string | null;
};

type StoredReport = {
  heartbeatAt: string;
  items: ReportItem[];
  abortedBizCode?: number | null;
  abortedReason?: string;
};

function endpointUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

function isAbortCode(code: number | null): boolean {
  return code === -352 || code === -412 || code === -509;
}

async function rateAccount(deps: MetadataRefreshDeps): Promise<string> {
  if (deps.accountId) return deps.accountId;
  const env = deps.env ?? process.env;
  const forced = env.COLLECTOR_ACCOUNT_ID?.trim() || null;
  try {
    const account = await resolveCollectorAccount(deps.sql, {
      targetAccountId: null,
      forcedAccountId: forced,
    });
    if (account) return account.id;
  } catch {
    // No account table yet, or no default row: share the anonymous bucket.
  }
  return ANONYMOUS_RATE_ACCOUNT_ID;
}

async function takeSlot(deps: MetadataRefreshDeps): Promise<void> {
  const accountId = await rateAccount(deps);
  const config = readBilibiliRuntimeConfig(deps.env ?? process.env);
  const policy = deps.ratePolicy ?? {
    minIntervalMs:
      accountId === ANONYMOUS_RATE_ACCOUNT_ID
        ? Math.max(config.minIntervalMs, config.anonymousMinIntervalMs)
        : config.minIntervalMs,
    maxJitterMs: config.maxJitterMs,
    maxPerMinute: config.maxPerMinute,
  };
  await acquireRequestSlot(deps.sql, accountId, policy, {
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(deps.random ? { random: deps.random } : {}),
  });
}

function endpointOf(url: string): string {
  const path = new URL(url).pathname;
  if (path.endsWith('/view/detail')) return 'view/detail';
  if (path.endsWith('/relation/stat')) return 'relation/stat';
  return path;
}

async function auditRequest(
  deps: MetadataRefreshDeps,
  row: {
    endpoint: string;
    statusCode: number | null;
    bizCode: number | null;
    durationMs: number;
    error: string | null;
  },
): Promise<void> {
  const accountId = await rateAccount(deps);
  await insertCollectorRequests(deps.sql, [
    {
      accountId: accountId === ANONYMOUS_RATE_ACCOUNT_ID ? null : accountId,
      runId: deps.backfillRunId ?? null,
      endpoint: row.endpoint,
      statusCode: row.statusCode,
      bizCode: row.bizCode,
      durationMs: Math.max(0, Math.round(row.durationMs)),
      error: row.error === null ? null : scrubMetadataError(row.error),
    },
  ]);
}

async function getJson(
  deps: MetadataRefreshDeps,
  url: string,
  endpoint = endpointOf(url),
): Promise<unknown> {
  await takeSlot(deps);
  const started = Date.now();
  const transport = guardTransport(deps.transport);
  let response;
  try {
    response = await transport({ url, method: 'GET', headers: bilibiliHeaders(null) });
  } catch (error) {
    const message = scrubMetadataError(error);
    await auditRequest(deps, {
      endpoint,
      statusCode: null,
      bizCode: null,
      durationMs: Date.now() - started,
      error: message,
    });
    throw new MetadataRequestError(message, null, false);
  }
  let payload: unknown;
  try {
    payload = JSON.parse(response.body) as unknown;
  } catch {
    const message = '响应不是 JSON';
    await auditRequest(deps, {
      endpoint,
      statusCode: response.status,
      bizCode: null,
      durationMs: response.durationMs,
      error: message,
    });
    throw new MetadataRequestError(message, null, false);
  }
  const biz = readBizCode(payload);
  const kind = classifyBilibiliResponse({
    statusCode: response.status,
    bizCode: biz.code,
    timedOut: false,
  });
  const failure = kind
    ? scrubMetadataError(biz.message || `业务码 ${biz.code ?? response.status}`)
    : null;
  await auditRequest(deps, {
    endpoint,
    statusCode: response.status,
    bizCode: biz.code,
    durationMs: response.durationMs,
    error: failure,
  });
  if (kind === 'risk_control' || kind === 'rate_limited' || isAbortCode(biz.code)) {
    throw new MetadataRequestError(failure ?? '上游拒绝', biz.code, true);
  }
  if (kind) {
    throw new MetadataRequestError(failure ?? '上游拒绝', biz.code, false);
  }
  return payload;
}

async function fetchImage(deps: MetadataRefreshDeps, url: string) {
  if (!deps.download) throw new ImageReject('status', '没有图片传输层');
  await takeSlot(deps);
  const started = Date.now();
  try {
    const image = await downloadHdslbImage(url, deps.download);
    await auditRequest(deps, {
      endpoint: 'image',
      statusCode: 200,
      bizCode: null,
      durationMs: Date.now() - started,
      error: null,
    });
    return image;
  } catch (error) {
    if (error instanceof ImageReject && (error.reason === 'scheme' || error.reason === 'host')) {
      throw error;
    }
    await auditRequest(deps, {
      endpoint: 'image',
      statusCode: null,
      bizCode: null,
      durationMs: Date.now() - started,
      error: scrubMetadataError(error),
    });
    throw error;
  }
}

function logItemFailed(
  deps: MetadataRefreshDeps,
  id: { bvid?: string; mid?: string },
  error: MetadataRequestError,
): void {
  deps.logger?.warn('元数据条目失败', {
    event: 'backfill.item_failed',
    ...(deps.backfillRunId ? { runId: deps.backfillRunId } : {}),
    context: {
      ...(id.bvid ? { bvid: id.bvid } : {}),
      ...(id.mid ? { mid: id.mid } : {}),
      code: error.bizCode,
      error: error.message,
    },
  });
}

export async function resolveMetadataIds(
  sql: Sql | null,
  input: {
    kind: MetadataKind;
    ids?: string[];
    dir?: string;
    allMissing?: boolean;
    limit?: number | null;
  },
): Promise<{ ids: string[]; mode: MetadataMode }> {
  const limit = input.limit ?? null;
  const clip = (ids: string[]) => (limit === null ? ids : ids.slice(0, limit));
  if (input.ids && input.ids.length > 0 && input.allMissing) {
    throw new Error('ids 与 allMissing 不能同时使用');
  }
  if (input.dir) {
    return { mode: 'dir', ids: clip(readWebuiIds(input.dir, input.kind)) };
  }
  if (input.ids && input.ids.length > 0) {
    return { mode: 'bvid', ids: clip(input.ids) };
  }
  if (input.allMissing) {
    if (!sql) throw new Error('all-missing 需要数据库连接');
    if (input.kind === 'video') {
      const rows = await sql<{ bvid: string }[]>`
        SELECT bvid FROM videos
        WHERE metadata_state <> 'ok'
        ORDER BY bvid
        LIMIT ${limit ?? 1_000_000}
      `;
      return { mode: 'all-missing', ids: rows.map((row) => row.bvid) };
    }
    const rows = await sql<{ mid: string }[]>`
      SELECT mid::text AS mid FROM creators
      WHERE metadata_state <> 'ok'
      ORDER BY mid
      LIMIT ${limit ?? 1_000_000}
    `;
    return { mode: 'all-missing', ids: rows.map((row) => row.mid) };
  }
  throw new Error('需要 --bvid、--mid、--dir 或 --all-missing');
}

async function readVideoResult(sql: Sql, bvid: string): Promise<VideoRefreshResult | null> {
  const rows = await sql<
    {
      bvid: string;
      cid: string | null;
      title: string | null;
      metadata_state: MetadataState;
      cover_state: CoverState;
    }[]
  >`
    SELECT bvid, cid::text AS cid, title, metadata_state, cover_state
    FROM videos WHERE bvid = ${bvid}
  `;
  const row = rows[0];
  if (!row) return null;
  const tags = await sql<{ tag: string }[]>`
    SELECT tag FROM video_tags WHERE bvid = ${bvid} ORDER BY ordinal, tag
  `;
  return {
    bvid: row.bvid,
    cid: row.cid,
    title: row.title,
    tags: tags.map((tag) => tag.tag),
    metadataState: row.metadata_state,
    coverState: row.cover_state,
  };
}

async function videoState(sql: Sql, bvid: string): Promise<MetadataState | null> {
  const rows = await sql<{ metadata_state: MetadataState }[]>`
    SELECT metadata_state FROM videos WHERE bvid = ${bvid}
  `;
  return rows[0]?.metadata_state ?? null;
}

async function creatorState(sql: Sql, mid: string): Promise<MetadataState | null> {
  const rows = await sql<{ metadata_state: MetadataState }[]>`
    SELECT metadata_state FROM creators WHERE mid = ${mid}::bigint
  `;
  return rows[0]?.metadata_state ?? null;
}

async function markVideoError(sql: Sql, bvid: string, message: string): Promise<void> {
  await sql`
    INSERT INTO videos (bvid, metadata_state, metadata_error)
    VALUES (${bvid}, 'failed', ${message})
    ON CONFLICT (bvid) DO UPDATE SET
      metadata_state = 'failed',
      metadata_error = EXCLUDED.metadata_error,
      updated_at = now()
  `;
}

async function markCreatorError(sql: Sql, mid: string, message: string): Promise<void> {
  await sql`
    INSERT INTO creators (mid, metadata_state, metadata_error)
    VALUES (${mid}::bigint, 'failed', ${message})
    ON CONFLICT (mid) DO UPDATE SET
      metadata_state = 'failed',
      metadata_error = EXCLUDED.metadata_error,
      updated_at = now()
  `;
}

async function applyVideoDetail(
  deps: MetadataRefreshDeps,
  bvid: string,
  detail: ParsedViewDetail,
): Promise<void> {
  const sql = deps.sql;
  const partitionName = partitionNameFromLabels(detail.tnameV2, detail.tname);
  const coverUrl = detail.pic ? httpsUrl(detail.pic) : null;
  let assetId: string | null = null;
  let picFailed = false;
  if (coverUrl && deps.assetsRoot && deps.download) {
    try {
      const image = await fetchImage(deps, coverUrl);
      const stored = await storeImageBytes(sql, {
        assetsRoot: deps.assetsRoot,
        bytes: image.bytes,
        mime: image.mime,
        width: image.width,
        height: image.height,
        kind: 'cover',
        origin: 'bilibili',
        sourceUrl: image.finalUrl,
        importBatchId: null,
        fetchedAt: deps.now?.() ?? new Date(),
      });
      assetId = stored.assetId;
    } catch (error) {
      if (!(error instanceof ImageReject)) throw error;
      picFailed = true;
    }
  } else if (coverUrl) {
    picFailed = true;
  }
  const metadata = {
    aid: detail.aid,
    tid: detail.tid,
    tid_v2: detail.tidV2,
    tname: detail.tname,
    tname_v2: detail.tnameV2,
    pic: coverUrl,
  };
  await sql.begin(async (tx) => {
    if (detail.ownerMid) {
      await tx`
        INSERT INTO creators (mid, uname)
        VALUES (${detail.ownerMid}::bigint, ${detail.ownerName})
        ON CONFLICT (mid) DO UPDATE SET
          uname = COALESCE(creators.uname, EXCLUDED.uname),
          updated_at = now()
      `;
    }
    await tx`
      INSERT INTO videos (
        bvid, title, description, duration_seconds, cover_url, cover_state, cover_asset_id,
        metadata_state, metadata_source, metadata_fetched_at, metadata_error,
        tid, tid_v2, partition_name, cid, pubdate, mid, metadata
      ) VALUES (
        ${bvid},
        ${detail.title},
        ${detail.description},
        ${detail.durationSeconds},
        ${coverUrl},
        ${assetId ? 'ok' : picFailed ? 'failed' : 'none'},
        ${assetId},
        'ok',
        'bilibili',
        now(),
        NULL,
        ${detail.tid},
        ${detail.tidV2},
        ${partitionName},
        ${detail.cid}::bigint,
        ${detail.pubdate},
        ${detail.ownerMid}::bigint,
        ${tx.json(jsonValue(metadata))}
      )
      ON CONFLICT (bvid) DO UPDATE SET
        title = COALESCE(EXCLUDED.title, videos.title),
        description = COALESCE(EXCLUDED.description, videos.description),
        duration_seconds = COALESCE(EXCLUDED.duration_seconds, videos.duration_seconds),
        cover_url = COALESCE(EXCLUDED.cover_url, videos.cover_url),
        cover_asset_id = COALESCE(EXCLUDED.cover_asset_id, videos.cover_asset_id),
        cover_state = CASE
          WHEN EXCLUDED.cover_asset_id IS NOT NULL THEN 'ok'
          WHEN ${picFailed}::boolean THEN 'failed'
          WHEN videos.cover_state = 'ok' THEN videos.cover_state
          ELSE EXCLUDED.cover_state
        END,
        metadata_state = 'ok',
        metadata_source = 'bilibili',
        metadata_fetched_at = now(),
        metadata_error = NULL,
        tid = COALESCE(EXCLUDED.tid, videos.tid),
        tid_v2 = COALESCE(EXCLUDED.tid_v2, videos.tid_v2),
        partition_name = EXCLUDED.partition_name,
        cid = COALESCE(EXCLUDED.cid, videos.cid),
        pubdate = COALESCE(EXCLUDED.pubdate, videos.pubdate),
        mid = COALESCE(EXCLUDED.mid, videos.mid),
        metadata = videos.metadata || EXCLUDED.metadata,
        updated_at = now()
    `;
    if (detail.tags) {
      await tx`DELETE FROM video_tags WHERE bvid = ${bvid}`;
      for (let ordinal = 0; ordinal < detail.tags.length; ordinal += 1) {
        const tag = detail.tags[ordinal];
        if (!tag) continue;
        await tx`
          INSERT INTO video_tags (bvid, tag, ordinal, source)
          VALUES (${bvid}, ${tag}, ${ordinal}, 'bilibili')
        `;
      }
    }
  });
}

async function readCreatorResult(sql: Sql, mid: string): Promise<CreatorRefreshResult | null> {
  const rows = await sql<
    {
      mid: string;
      uname: string | null;
      metadata_state: MetadataState;
      face_asset_id: string | null;
      follower_count: string | null;
    }[]
  >`
    SELECT c.mid::text AS mid, c.uname, c.metadata_state, c.face_asset_id,
      s.follower_count::text AS follower_count
    FROM creators c
    LEFT JOIN LATERAL (
      SELECT follower_count FROM creator_follower_samples
      WHERE mid = c.mid ORDER BY sampled_at DESC LIMIT 1
    ) s ON TRUE
    WHERE c.mid = ${mid}::bigint
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    mid: row.mid,
    uname: row.uname,
    metadataState: row.metadata_state,
    followerCount: row.follower_count,
    faceAssetId: row.face_asset_id,
  };
}

async function applyCreator(
  deps: MetadataRefreshDeps,
  mid: string,
  followerCount: bigint,
  card: ParsedCard | null,
): Promise<void> {
  const now = deps.now?.() ?? new Date();
  const sampledAt = truncateToUtcMinute(now);
  await deps.sql`
    INSERT INTO creators (mid)
    VALUES (${mid}::bigint)
    ON CONFLICT (mid) DO NOTHING
  `;
  await deps.sql`
    INSERT INTO creator_follower_samples (
      mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count,
      source, collected_at, extra
    ) VALUES (
      ${mid}::bigint,
      ${sampledAt},
      'Asia/Shanghai',
      ${formatSourceMinute(sampledAt, 'Asia/Shanghai')},
      'minute',
      ${followerCount.toString()}::bigint,
      'bilibili',
      ${now},
      ${deps.sql.json(jsonValue({}))}
    )
    ON CONFLICT (mid, sampled_at) DO NOTHING
  `;
  let faceAssetId: string | null = null;
  let faceFailed = false;
  const faceUrl = card?.face ? httpsUrl(card.face) : null;
  if (faceUrl && deps.download && deps.assetsRoot) {
    try {
      const image = await fetchImage(deps, faceUrl);
      const stored = await storeImageBytes(deps.sql, {
        assetsRoot: deps.assetsRoot,
        bytes: image.bytes,
        mime: image.mime,
        width: image.width,
        height: image.height,
        kind: 'face',
        origin: 'bilibili',
        sourceUrl: image.finalUrl,
        importBatchId: null,
        fetchedAt: now,
      });
      faceAssetId = stored.assetId;
    } catch (error) {
      if (!(error instanceof ImageReject)) throw error;
      faceFailed = true;
    }
  }
  const usable = card !== null && (card.name !== null || card.face !== null);
  const metadataState: MetadataState = !usable || faceFailed ? 'partial' : 'ok';
  const metadataError = faceFailed ? '头像下载被拒绝' : null;
  await deps.sql`
    UPDATE creators SET
      uname = COALESCE(${card?.name ?? null}, uname),
      face_url = COALESCE(${faceUrl}, face_url),
      face_asset_id = COALESCE(${faceAssetId}, face_asset_id),
      metadata_state = ${metadataState},
      metadata_source = 'bilibili',
      metadata_fetched_at = now(),
      metadata_error = ${metadataError},
      updated_at = now()
    WHERE mid = ${mid}::bigint
  `;
}

async function creatorVideoBvid(sql: Sql, mid: string): Promise<string | null> {
  const rows = await sql<{ bvid: string }[]>`
    SELECT bvid FROM videos WHERE mid = ${mid}::bigint ORDER BY bvid LIMIT 1
  `;
  return rows[0]?.bvid ?? null;
}

export async function refreshVideo(
  deps: MetadataRefreshDeps,
  bvid: string,
  force = false,
): Promise<VideoRefreshResult> {
  if (!BVID.test(bvid)) throw new Error('bvid 不合法');
  if (!force && (await videoState(deps.sql, bvid)) === 'ok') {
    const current = await readVideoResult(deps.sql, bvid);
    if (current) return current;
  }
  try {
    const payload = await getJson(deps, endpointUrl(VIEW_DETAIL_URL, { bvid }));
    const detail = parseViewDetail(payload);
    await applyVideoDetail(deps, bvid, detail);
  } catch (error) {
    const wrapped =
      error instanceof MetadataRequestError
        ? error
        : new MetadataRequestError(scrubMetadataError(error), null, false);
    await markVideoError(deps.sql, bvid, wrapped.message);
    logItemFailed(deps, { bvid }, wrapped);
    await deps.logger?.flush();
    throw wrapped;
  }
  const stored = await readVideoResult(deps.sql, bvid);
  if (!stored) throw new Error('视频写入后无法读取');
  return stored;
}

export async function refreshCreator(
  deps: MetadataRefreshDeps,
  mid: string,
  force = false,
): Promise<CreatorRefreshResult> {
  if (!MID.test(mid)) throw new Error('mid 不合法');
  if (!force && (await creatorState(deps.sql, mid)) === 'ok') {
    const current = await readCreatorResult(deps.sql, mid);
    if (current) return current;
  }
  try {
    const relationPayload = await getJson(deps, endpointUrl(RELATION_URL, { vmid: mid }));
    const relation = asRelation(relationPayload);
    let card: ParsedCard | null = null;
    const bvid = await creatorVideoBvid(deps.sql, mid);
    if (bvid) {
      try {
        const detailPayload = await getJson(deps, endpointUrl(VIEW_DETAIL_URL, { bvid }), 'card');
        card = parseViewDetail(detailPayload).card;
      } catch (error) {
        if (error instanceof MetadataRequestError && error.abort) throw error;
        card = null;
      }
    }
    await applyCreator(deps, mid, relation, card);
  } catch (error) {
    const wrapped =
      error instanceof MetadataRequestError
        ? error
        : new MetadataRequestError(scrubMetadataError(error), null, false);
    await markCreatorError(deps.sql, mid, wrapped.message);
    logItemFailed(deps, { mid }, wrapped);
    await deps.logger?.flush();
    throw wrapped;
  }
  const stored = await readCreatorResult(deps.sql, mid);
  if (!stored) throw new Error('创作者写入后无法读取');
  return stored;
}

function asRelation(payload: unknown): bigint {
  if (typeof payload !== 'object' || payload === null) throw new Error('relation/stat 缺少 data');
  const data = (payload as { data?: unknown }).data;
  if (typeof data !== 'object' || data === null) throw new Error('relation/stat 缺少 data');
  const follower = (data as { follower?: unknown }).follower;
  if (typeof follower === 'number' && Number.isFinite(follower))
    return BigInt(Math.trunc(follower));
  if (typeof follower === 'string' && /^-?\d+$/.test(follower)) return BigInt(follower);
  throw new Error('relation/stat 缺少 follower');
}

export async function reapStaleBackfillRuns(
  sql: Sql,
  now = new Date(),
  staleMs = BACKFILL_STALE_MS,
): Promise<number> {
  const cutoff = new Date(now.getTime() - staleMs);
  const rows = await sql<{ id: string }[]>`
    UPDATE backfill_runs
    SET status = 'aborted',
        finished_at = ${now},
        error = '10 分钟无进展，批次已中止',
        report = report || ${sql.json(jsonValue({ abortedReason: 'stale' }))}
    WHERE status = 'running'
      AND COALESCE((report->>'heartbeatAt')::timestamptz, started_at) < ${cutoff}
    RETURNING id::text AS id
  `;
  return rows.length;
}

async function claimRun(
  sql: Sql,
  input: { kind: MetadataKind; mode: MetadataMode; requested: number; now: Date },
): Promise<{ id: string } | { conflictId: string }> {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext('metadata-backfill'))`;
    const cutoff = new Date(input.now.getTime() - BACKFILL_STALE_MS);
    await tx`
      UPDATE backfill_runs
      SET status = 'aborted',
          finished_at = ${input.now},
          error = '10 分钟无进展，批次已中止',
          report = report || ${tx.json(jsonValue({ abortedReason: 'stale' }))}
      WHERE status = 'running'
        AND COALESCE((report->>'heartbeatAt')::timestamptz, started_at) < ${cutoff}
    `;
    const running = await tx<{ id: string }[]>`
      SELECT id::text AS id FROM backfill_runs WHERE status = 'running' LIMIT 1
    `;
    const conflict = running[0];
    if (conflict) return { conflictId: conflict.id };
    const id = crypto.randomUUID();
    const report: StoredReport = { heartbeatAt: input.now.toISOString(), items: [] };
    await tx`
      INSERT INTO backfill_runs (
        id, kind, mode, status, requested, succeeded, failed, skipped, started_at, report
      ) VALUES (
        ${id}::uuid,
        ${input.kind},
        ${input.mode},
        'running',
        ${input.requested},
        0,
        0,
        0,
        ${input.now},
        ${tx.json(jsonValue(report))}
      )
    `;
    return { id };
  });
}

async function saveProgress(
  sql: Sql,
  id: string,
  counts: { succeeded: number; failed: number; skipped: number },
  report: StoredReport,
  finish: { status: 'succeeded' | 'failed' | 'aborted'; error: string | null } | null,
): Promise<void> {
  if (finish) {
    await sql`
      UPDATE backfill_runs SET
        status = ${finish.status},
        succeeded = ${counts.succeeded},
        failed = ${counts.failed},
        skipped = ${counts.skipped},
        finished_at = now(),
        error = ${finish.error},
        report = ${sql.json(jsonValue(report))}
      WHERE id = ${id}::uuid
    `;
    return;
  }
  await sql`
    UPDATE backfill_runs SET
      succeeded = ${counts.succeeded},
      failed = ${counts.failed},
      skipped = ${counts.skipped},
      report = ${sql.json(jsonValue(report))}
    WHERE id = ${id}::uuid
  `;
}

async function executeRun(
  deps: MetadataRefreshDeps,
  run: { id: string; kind: MetadataKind; ids: string[]; force: boolean },
): Promise<void> {
  const now = () => deps.now?.() ?? new Date();
  if (deps.gate) await deps.gate();
  const report: StoredReport = { heartbeatAt: now().toISOString(), items: [] };
  const counts = { succeeded: 0, failed: 0, skipped: 0 };
  const finishStatus = (failedAll: boolean) => (failedAll ? 'failed' : 'succeeded');
  try {
    for (const id of run.ids) {
      report.heartbeatAt = now().toISOString();
      const state =
        run.kind === 'video' ? await videoState(deps.sql, id) : await creatorState(deps.sql, id);
      if (!run.force && state === 'ok') {
        counts.skipped += 1;
        report.items.push({ id, outcome: 'skipped', error: null });
        await saveProgress(deps.sql, run.id, counts, report, null);
        continue;
      }
      try {
        if (run.kind === 'video') await refreshVideo(deps, id, true);
        else await refreshCreator(deps, id, true);
        counts.succeeded += 1;
        report.items.push({ id, outcome: 'succeeded', error: null });
      } catch (error) {
        const message = scrubMetadataError(error);
        counts.failed += 1;
        report.items.push({ id, outcome: 'failed', error: message });
        if (error instanceof MetadataRequestError && error.abort) {
          report.abortedBizCode = error.bizCode;
          report.heartbeatAt = now().toISOString();
          await saveProgress(deps.sql, run.id, counts, report, {
            status: 'aborted',
            error: message,
          });
          deps.logger?.warn('元数据批次已中止', {
            event: 'backfill.aborted',
            runId: run.id,
            context: { bizCode: error.bizCode },
          });
          await deps.logger?.flush();
          return;
        }
      }
      report.heartbeatAt = now().toISOString();
      await saveProgress(deps.sql, run.id, counts, report, null);
    }
    const status = finishStatus(counts.succeeded === 0 && counts.failed > 0);
    await saveProgress(deps.sql, run.id, counts, report, { status, error: null });
    deps.logger?.info('元数据批次结束', {
      event: 'backfill.finished',
      runId: run.id,
      context: { status, ...counts },
    });
    await deps.logger?.flush();
  } catch (error) {
    const message = scrubMetadataError(error);
    report.heartbeatAt = now().toISOString();
    await saveProgress(deps.sql, run.id, counts, report, { status: 'failed', error: message });
    deps.logger?.error('元数据批次失败', {
      event: 'backfill.finished',
      runId: run.id,
      err: new Error(message),
    });
    await deps.logger?.flush();
  }
}

export async function startMetadataBackfill(
  deps: MetadataRefreshDeps,
  input: {
    kind: MetadataKind;
    ids?: string[];
    dir?: string;
    allMissing?: boolean;
    limit?: number | null;
    force?: boolean;
  },
): Promise<{ backfillRunId: string; requested: number; done: Promise<void> }> {
  const resolved = await resolveMetadataIds(deps.sql, input);
  const now = deps.now?.() ?? new Date();
  const claimed = await claimRun(deps.sql, {
    kind: input.kind,
    mode: resolved.mode,
    requested: resolved.ids.length,
    now,
  });
  if ('conflictId' in claimed) throw new BackfillConflict(claimed.conflictId);
  deps.backfillRunId = claimed.id;
  deps.logger?.info('元数据批次开始', {
    event: 'backfill.started',
    runId: claimed.id,
    context: { kind: input.kind, mode: resolved.mode, requested: resolved.ids.length },
  });
  await deps.logger?.flush();
  const done = executeRun(deps, {
    id: claimed.id,
    kind: input.kind,
    ids: resolved.ids,
    force: input.force === true,
  });
  return { backfillRunId: claimed.id, requested: resolved.ids.length, done };
}

export async function readMetadataRun(sql: Sql, id: string): Promise<MetadataRunView | null> {
  await reapStaleBackfillRuns(sql);
  const rows = await sql<
    {
      id: string;
      kind: MetadataKind;
      mode: MetadataMode;
      status: MetadataRunView['status'];
      requested: number;
      succeeded: number;
      failed: number;
      skipped: number;
      report: Record<string, unknown>;
      error: string | null;
    }[]
  >`
    SELECT id::text AS id, kind, mode, status, requested, succeeded, failed, skipped, report, error
    FROM backfill_runs
    WHERE id = ${id}::uuid
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    kind: row.kind,
    mode: row.mode,
    status: row.status,
    requested: row.requested,
    succeeded: row.succeeded,
    failed: row.failed,
    skipped: row.skipped,
    report: row.report ?? {},
    error: row.error ? scrubString(row.error) : null,
  };
}
