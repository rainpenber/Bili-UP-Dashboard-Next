import {
  bigintToJson,
  MonitorContractError,
  parseCreatorMid,
  parseCreatorVideosLimit,
  parseCreatorVideosOffset,
  parseIsoDateParam,
  parseMetricsLimit,
  parseMonitorPage,
  parseMonitorPageSize,
  parsePinVideoRequest,
  parsePinVideoResponse,
  parseVideoBvidParam,
  MONITOR_MAX_METRICS_LIMIT,
  type Paginated,
  type CreatorListItem,
  type CreatorVideoItem,
  type CreatorVideoList,
  type DynamicListItem,
  type DynamicTargetRef,
  type VideoDetail,
  type VideoListItem,
  type VideoMetricPoint,
  type CreatorMetricPoint,
  type DynamicMetricPoint,
  type VideoCreatorSummary,
} from '@studio/contracts';
import {
  setVideoPinned,
  VIDEO_PARTITION_JOINS,
  VIDEO_PARTITION_NAME_SQL,
  type Sql,
} from '@studio/db';
import {
  BackfillConflict,
  MetadataRequestError,
  createLiveBilibiliTransport,
  createLiveImageTransport,
  readBilibiliRuntimeConfig,
  readMetadataRun,
  refreshCreator,
  refreshVideo,
  startMetadataBackfill,
  type MetadataKind,
  type MetadataRefreshDeps,
} from '@studio/monitoring';
import type { StudioLogger } from '@studio/observability';
import { Hono } from 'hono';
import { readAssetsRoot } from './assets-config';
import { registerCreatorDiscoveryRoutes } from './creator-discovery-routes';
import { registerMonitorCardRoutes } from './monitor-card-routes';
import { registerMonitorSearchSuggestionRoutes } from './monitor-search-suggestion-routes';
import { registerMonitorTargetRoutes } from './monitor-target-routes';
import { registerStudioOwnerRoutes } from './studio-owner-routes';

type MonitorStatusFilter = 'all' | 'active' | 'archived' | 'deleted';

function parseStatus(raw: string | undefined): MonitorStatusFilter {
  if (!raw || raw === 'all') return 'all';
  if (raw === 'active' || raw === 'archived' || raw === 'deleted') return raw;
  throw new Error('invalid status');
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  const parsed = JSON.parse(text) as unknown;
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('invalid body');
  }
  return parsed as Record<string, unknown>;
}

export type MonitorRefreshOptions = Partial<MetadataRefreshDeps> & {
  onBackfill?: (task: Promise<void>) => void;
};

function buildRefreshDeps(db: Sql, refreshDeps: MonitorRefreshOptions): MetadataRefreshDeps {
  const config = readBilibiliRuntimeConfig(refreshDeps.env);
  return {
    ...refreshDeps,
    sql: db,
    transport: refreshDeps.transport ?? createLiveBilibiliTransport(config.timeoutMs),
    download: refreshDeps.download ?? createLiveImageTransport(config.timeoutMs),
    assetsRoot:
      refreshDeps.assetsRoot === undefined
        ? readAssetsRoot(refreshDeps.env)
        : refreshDeps.assetsRoot,
  };
}

function refreshDepsFor(
  c: { get: (key: string) => unknown },
  base: MetadataRefreshDeps,
): MetadataRefreshDeps {
  const candidate = c.get('log');
  if (
    candidate &&
    typeof candidate === 'object' &&
    'info' in candidate &&
    'warn' in candidate &&
    'flush' in candidate
  ) {
    return { ...base, logger: candidate as StudioLogger };
  }
  return base;
}

function toDynamicTargetRef(row: {
  target_id: string | null;
  target_enabled: boolean | null;
  target_interval_minutes: number | null;
  target_interval_mode: 'auto' | 'fixed' | null;
  target_last_success_at: Date | null;
  target_last_error: string | null;
}): DynamicTargetRef | null {
  if (!row.target_id || row.target_enabled == null || row.target_interval_minutes == null) {
    return null;
  }
  const intervalMode = row.target_interval_mode ?? 'fixed';
  return {
    id: row.target_id,
    enabled: row.target_enabled,
    intervalMinutes: row.target_interval_minutes,
    intervalMode,
    lastSuccessAt: row.target_last_success_at?.toISOString() ?? null,
    lastError: row.target_last_error,
  };
}

export function createMonitorRoutes(db: Sql, refreshDeps: MonitorRefreshOptions = {}) {
  const app = new Hono();
  registerMonitorTargetRoutes(app, db);
  registerMonitorCardRoutes(app, db);
  registerMonitorSearchSuggestionRoutes(app, db);
  registerCreatorDiscoveryRoutes(app, db);
  registerStudioOwnerRoutes(app, db);
  const deps = (c?: { get: (key: string) => unknown }) => {
    const base = buildRefreshDeps(db, refreshDeps);
    return c ? refreshDepsFor(c, base) : base;
  };

  app.get('/videos', async (c) => {
    try {
      const page = parseMonitorPage(c.req.query('page'));
      const pageSize = parseMonitorPageSize(c.req.query('pageSize'));
      const category = c.req.query('category') ?? null;
      const q = c.req.query('q') ?? null;
      const status = parseStatus(c.req.query('status'));
      const offset = (page - 1) * pageSize;

      const countRows = await db<{ count: string }[]>`
        SELECT count(*)::text AS count FROM videos v
        WHERE
          (${status} = 'all' OR (${status} = 'active' AND v.deleted_at IS NULL AND v.archived_at IS NULL)
            OR (${status} = 'archived' AND v.archived_at IS NOT NULL AND v.deleted_at IS NULL)
            OR (${status} = 'deleted' AND v.deleted_at IS NOT NULL))
        AND (${category}::text IS NULL OR v.category = ${category})
        AND (${q}::text IS NULL OR v.title ILIKE ${q ? `%${q}%` : null} OR v.bvid ILIKE ${q ? `%${q}%` : null})
      `;
      const totalItems = Number(countRows[0]?.count ?? '0');
      const rows = await db<
        {
          bvid: string;
          title: string | null;
          category: string | null;
          mid: bigint | null;
          monitoring_enabled: boolean;
          archived_at: Date | null;
          deleted_at: Date | null;
          cover_asset_id: string | null;
          tid: number | null;
          tid_v2: number | null;
          partition_name: string | null;
          sampled_at: Date | null;
          view_count: bigint | null;
          online_viewers: bigint | null;
          online_viewers_raw: string | null;
          like_count: bigint | null;
        }[]
      >`
        SELECT v.bvid, v.title, v.category, v.mid, v.monitoring_enabled, v.archived_at, v.deleted_at, v.cover_asset_id,
          v.tid, v.tid_v2, ${db.unsafe(VIDEO_PARTITION_NAME_SQL)} AS partition_name,
          m.sampled_at, m.view_count, m.online_viewers, m.online_viewers_raw, m.like_count
        FROM videos v
        ${db.unsafe(VIDEO_PARTITION_JOINS)}
        LEFT JOIN LATERAL (
          SELECT sampled_at, view_count, online_viewers, online_viewers_raw, like_count
          FROM video_metric_samples s WHERE s.bvid = v.bvid ORDER BY sampled_at DESC LIMIT 1
        ) m ON TRUE
        WHERE
          (${status} = 'all' OR (${status} = 'active' AND v.deleted_at IS NULL AND v.archived_at IS NULL)
            OR (${status} = 'archived' AND v.archived_at IS NOT NULL AND v.deleted_at IS NULL)
            OR (${status} = 'deleted' AND v.deleted_at IS NOT NULL))
        AND (${category}::text IS NULL OR v.category = ${category})
        AND (${q}::text IS NULL OR v.title ILIKE ${q ? `%${q}%` : null} OR v.bvid ILIKE ${q ? `%${q}%` : null})
        ORDER BY m.sampled_at DESC NULLS LAST, v.bvid
        LIMIT ${pageSize} OFFSET ${offset}
      `;

      const items: VideoListItem[] = rows.map((r) => ({
        bvid: r.bvid,
        title: r.title,
        category: r.category,
        mid: r.mid != null ? bigintToJson(r.mid) : null,
        monitoringEnabled: r.monitoring_enabled,
        archivedAt: r.archived_at?.toISOString() ?? null,
        deletedAt: r.deleted_at?.toISOString() ?? null,
        coverAssetId: r.cover_asset_id,
        tid: r.tid,
        tidV2: r.tid_v2,
        partitionName: r.partition_name,
        latestMetrics: {
          sampledAt: r.sampled_at?.toISOString() ?? null,
          viewCount: bigintToJson(r.view_count),
          onlineViewers: bigintToJson(r.online_viewers),
          onlineViewersRaw: r.online_viewers_raw,
          likeCount: bigintToJson(r.like_count),
        },
      }));

      const body: Paginated<VideoListItem> = {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
        items,
      };
      return c.json(body);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.get('/videos/:bvid', async (c) => {
    const bvid = c.req.param('bvid');
    const rows = await db<
      {
        bvid: string;
        title: string | null;
        category: string | null;
        mid: bigint | null;
        monitoring_enabled: boolean;
        archived_at: Date | null;
        deleted_at: Date | null;
        cover_asset_id: string | null;
        tid: number | null;
        tid_v2: number | null;
        partition_name: string | null;
        metadata: Record<string, unknown>;
        creator_mid: bigint | null;
        creator_uname: string | null;
        creator_face_asset_id: string | null;
        creator_monitoring_enabled: boolean | null;
        follower_latest: bigint | null;
        follower_sampled_at: Date | null;
      }[]
    >`
      SELECT v.bvid, v.title, v.category, v.mid, v.monitoring_enabled, v.archived_at, v.deleted_at,
        v.cover_asset_id, v.tid, v.tid_v2,
        ${db.unsafe(VIDEO_PARTITION_NAME_SQL)} AS partition_name,
        v.metadata,
        c.mid AS creator_mid,
        c.uname AS creator_uname,
        c.face_asset_id AS creator_face_asset_id,
        c.monitoring_enabled AS creator_monitoring_enabled,
        f.follower_count AS follower_latest,
        f.sampled_at AS follower_sampled_at
      FROM videos v
      ${db.unsafe(VIDEO_PARTITION_JOINS)}
      LEFT JOIN creators c ON c.mid = v.mid
      LEFT JOIN LATERAL (
        SELECT s.follower_count, s.sampled_at
        FROM creator_follower_samples s
        WHERE s.mid = v.mid
        ORDER BY s.sampled_at DESC
        LIMIT 1
      ) f ON TRUE
      WHERE v.bvid = ${bvid}
    `;
    const row = rows[0];
    if (!row) return c.json({ error: 'not found' }, 404);
    const creator: VideoCreatorSummary | null =
      row.mid == null || row.creator_mid == null
        ? null
        : {
            mid: bigintToJson(row.creator_mid)!,
            uname: row.creator_uname,
            faceAssetId: row.creator_face_asset_id,
            followerLatest: bigintToJson(row.follower_latest),
            followerSampledAt: row.follower_sampled_at?.toISOString() ?? null,
            monitoringEnabled: row.creator_monitoring_enabled ?? false,
          };
    const body: VideoDetail = {
      bvid: row.bvid,
      title: row.title,
      category: row.category,
      mid: row.mid != null ? bigintToJson(row.mid) : null,
      monitoringEnabled: row.monitoring_enabled,
      archivedAt: row.archived_at?.toISOString() ?? null,
      deletedAt: row.deleted_at?.toISOString() ?? null,
      coverAssetId: row.cover_asset_id,
      tid: row.tid,
      tidV2: row.tid_v2,
      partitionName: row.partition_name,
      metadata: row.metadata,
      creator,
    };
    return c.json(body);
  });

  app.get('/videos/:bvid/metrics', async (c) => {
    try {
      const bvid = c.req.param('bvid');
      const from = parseIsoDateParam(c.req.query('from'), 'from');
      const to = parseIsoDateParam(c.req.query('to'), 'to');
      const limit = parseMetricsLimit(c.req.query('limit'));
      const rows = await db<
        {
          sampled_at: Date;
          raw_time: string;
          source_timezone: string;
          timestamp_precision: 'minute' | 'second';
          view_count: bigint | null;
          online_viewers: bigint | null;
          online_viewers_raw: string | null;
          like_count: bigint | null;
          coin_count: bigint | null;
          favorite_count: bigint | null;
          share_count: bigint | null;
          danmaku_count: bigint | null;
          comment_count: bigint | null;
        }[]
      >`
        SELECT sampled_at, raw_time, source_timezone, timestamp_precision,
          view_count, online_viewers, online_viewers_raw, like_count, coin_count, favorite_count, share_count, danmaku_count, comment_count
        FROM (
          SELECT sampled_at, raw_time, source_timezone, timestamp_precision,
            view_count, online_viewers, online_viewers_raw, like_count, coin_count, favorite_count, share_count, danmaku_count, comment_count
          FROM video_metric_samples
          WHERE bvid = ${bvid}
          AND (${from}::timestamptz IS NULL OR sampled_at >= ${from})
          AND (${to}::timestamptz IS NULL OR sampled_at <= ${to})
          ORDER BY sampled_at DESC
          LIMIT ${limit}
        ) recent
        ORDER BY sampled_at ASC
      `;
      const items: VideoMetricPoint[] = rows.map((r) => ({
        sampledAt: r.sampled_at.toISOString(),
        rawTime: r.raw_time,
        sourceTimezone: r.source_timezone,
        timestampPrecision: r.timestamp_precision,
        viewCount: bigintToJson(r.view_count),
        onlineViewers: bigintToJson(r.online_viewers),
        onlineViewersRaw: r.online_viewers_raw,
        likeCount: bigintToJson(r.like_count),
        coinCount: bigintToJson(r.coin_count),
        favoriteCount: bigintToJson(r.favorite_count),
        shareCount: bigintToJson(r.share_count),
        danmakuCount: bigintToJson(r.danmaku_count),
        commentCount: bigintToJson(r.comment_count),
      }));
      return c.json({ bvid, limit: Math.min(limit, MONITOR_MAX_METRICS_LIMIT), items });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.get('/creators', async (c) => {
    try {
      const page = parseMonitorPage(c.req.query('page'));
      const pageSize = parseMonitorPageSize(c.req.query('pageSize'));
      const category = c.req.query('category') ?? null;
      const q = c.req.query('q') ?? null;
      const status = parseStatus(c.req.query('status'));
      const offset = (page - 1) * pageSize;
      const countRows = await db<{ count: string }[]>`
        SELECT count(*)::text AS count FROM creators c
        WHERE
          (${status} = 'all' OR (${status} = 'active' AND c.deleted_at IS NULL AND c.archived_at IS NULL)
            OR (${status} = 'archived' AND c.archived_at IS NOT NULL AND c.deleted_at IS NULL)
            OR (${status} = 'deleted' AND c.deleted_at IS NOT NULL))
        AND (${category}::text IS NULL OR c.category = ${category})
        AND (${q}::text IS NULL OR c.uname ILIKE ${q ? `%${q}%` : null} OR c.mid::text ILIKE ${q ? `%${q}%` : null})
      `;
      const totalItems = Number(countRows[0]?.count ?? '0');
      const rows = await db<
        {
          mid: bigint;
          uname: string | null;
          category: string | null;
          monitoring_enabled: boolean;
          archived_at: Date | null;
          deleted_at: Date | null;
          face_asset_id: string | null;
          sampled_at: Date | null;
          follower_count: bigint | null;
        }[]
      >`
        SELECT c.mid, c.uname, c.category, c.monitoring_enabled, c.archived_at, c.deleted_at, c.face_asset_id,
          m.sampled_at, m.follower_count
        FROM creators c
        LEFT JOIN LATERAL (
          SELECT sampled_at, follower_count FROM creator_follower_samples s WHERE s.mid = c.mid ORDER BY sampled_at DESC LIMIT 1
        ) m ON TRUE
        WHERE
          (${status} = 'all' OR (${status} = 'active' AND c.deleted_at IS NULL AND c.archived_at IS NULL)
            OR (${status} = 'archived' AND c.archived_at IS NOT NULL AND c.deleted_at IS NULL)
            OR (${status} = 'deleted' AND c.deleted_at IS NOT NULL))
        AND (${category}::text IS NULL OR c.category = ${category})
        AND (${q}::text IS NULL OR c.uname ILIKE ${q ? `%${q}%` : null} OR c.mid::text ILIKE ${q ? `%${q}%` : null})
        ORDER BY m.sampled_at DESC NULLS LAST, c.mid
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      const items: CreatorListItem[] = rows.map((r) => ({
        mid: bigintToJson(r.mid)!,
        uname: r.uname,
        category: r.category,
        monitoringEnabled: r.monitoring_enabled,
        archivedAt: r.archived_at?.toISOString() ?? null,
        deletedAt: r.deleted_at?.toISOString() ?? null,
        faceAssetId: r.face_asset_id,
        latestMetrics: {
          sampledAt: r.sampled_at?.toISOString() ?? null,
          followerCount: bigintToJson(r.follower_count),
        },
      }));
      return c.json({
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
        items,
      } satisfies Paginated<CreatorListItem>);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.get('/creators/:mid/videos', async (c) => {
    try {
      const mid = parseCreatorMid(c.req.param('mid'));
      const limit = parseCreatorVideosLimit(c.req.query('limit'));
      const offset = parseCreatorVideosOffset(c.req.query('offset'));
      const rows = await db<
        {
          mid: bigint;
          total: string;
          bvid: string | null;
          title: string | null;
          cover_asset_id: string | null;
          pubdate: Date | null;
          archived_at: Date | null;
          partition_name: string | null;
          sampled_at: Date | null;
          view_count: bigint | null;
          like_count: bigint | null;
          comment_count: bigint | null;
          online_viewers: bigint | null;
        }[]
      >`
        SELECT
          c.mid,
          (
            SELECT count(*)::text
            FROM videos counted
            WHERE counted.mid = c.mid
              AND counted.deleted_at IS NULL
          ) AS total,
          v.bvid,
          v.title,
          v.cover_asset_id,
          v.pubdate,
          v.archived_at,
          ${db.unsafe(VIDEO_PARTITION_NAME_SQL)} AS partition_name,
          m.sampled_at,
          m.view_count,
          m.like_count,
          m.comment_count,
          m.online_viewers
        FROM creators c
        LEFT JOIN LATERAL (
          SELECT
            vid.bvid,
            vid.title,
            vid.cover_asset_id,
            vid.pubdate,
            vid.archived_at,
            vid.tid,
            vid.tid_v2,
            vid.partition_name
          FROM videos vid
          WHERE vid.mid = c.mid
            AND vid.deleted_at IS NULL
          ORDER BY vid.pubdate DESC NULLS LAST, vid.bvid
          LIMIT ${limit} OFFSET ${offset}
        ) v ON TRUE
        ${db.unsafe(VIDEO_PARTITION_JOINS)}
        LEFT JOIN LATERAL (
          SELECT
            s.sampled_at,
            s.view_count,
            s.like_count,
            s.comment_count,
            s.online_viewers
          FROM video_metric_samples s
          WHERE s.bvid = v.bvid
          ORDER BY s.sampled_at DESC
          LIMIT 1
        ) m ON TRUE
        WHERE c.mid = ${mid}
      `;
      const first = rows[0];
      if (!first) return c.json({ error: 'not found' }, 404);
      const items: CreatorVideoItem[] = [];
      for (const row of rows) {
        if (!row.bvid) continue;
        items.push({
          bvid: row.bvid,
          title: row.title,
          coverAssetId: row.cover_asset_id,
          pubdate: row.pubdate?.toISOString() ?? null,
          partitionName: row.partition_name,
          archivedAt: row.archived_at?.toISOString() ?? null,
          latest: row.sampled_at
            ? {
                sampledAt: row.sampled_at.toISOString(),
                viewCount: bigintToJson(row.view_count),
                likeCount: bigintToJson(row.like_count),
                commentCount: bigintToJson(row.comment_count),
                onlineViewers: bigintToJson(row.online_viewers),
              }
            : null,
        });
      }
      const body: CreatorVideoList = {
        mid: bigintToJson(first.mid)!,
        total: Number(first.total),
        items,
      };
      return c.json(body);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.get('/creators/:mid', async (c) => {
    const mid = c.req.param('mid');
    const rows = await db`
      SELECT mid, uname, category, monitoring_enabled, archived_at, deleted_at, face_asset_id, metadata
      FROM creators WHERE mid = ${mid}
    `;
    const row = rows[0] as
      | {
          mid: bigint;
          uname: string | null;
          category: string | null;
          monitoring_enabled: boolean;
          archived_at: Date | null;
          deleted_at: Date | null;
          face_asset_id: string | null;
          metadata: Record<string, unknown>;
        }
      | undefined;
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({
      mid: bigintToJson(row.mid),
      uname: row.uname,
      category: row.category,
      monitoringEnabled: row.monitoring_enabled,
      archivedAt: row.archived_at?.toISOString() ?? null,
      deletedAt: row.deleted_at?.toISOString() ?? null,
      faceAssetId: row.face_asset_id,
      metadata: row.metadata,
    });
  });

  app.get('/creators/:mid/metrics', async (c) => {
    try {
      const mid = c.req.param('mid');
      const from = parseIsoDateParam(c.req.query('from'), 'from');
      const to = parseIsoDateParam(c.req.query('to'), 'to');
      const limit = parseMetricsLimit(c.req.query('limit'));
      const rows = await db`
        SELECT sampled_at, raw_time, source_timezone, timestamp_precision, follower_count
        FROM (
          SELECT sampled_at, raw_time, source_timezone, timestamp_precision, follower_count
          FROM creator_follower_samples
          WHERE mid = ${mid}
          AND (${from}::timestamptz IS NULL OR sampled_at >= ${from})
          AND (${to}::timestamptz IS NULL OR sampled_at <= ${to})
          ORDER BY sampled_at DESC
          LIMIT ${limit}
        ) recent
        ORDER BY sampled_at ASC
      `;
      const typedRows = rows as unknown as {
        sampled_at: Date;
        raw_time: string;
        source_timezone: string;
        timestamp_precision: 'minute' | 'second';
        follower_count: bigint;
      }[];
      const items: CreatorMetricPoint[] = typedRows.map((r) => ({
        sampledAt: r.sampled_at.toISOString(),
        rawTime: r.raw_time,
        sourceTimezone: r.source_timezone,
        timestampPrecision: r.timestamp_precision,
        followerCount: bigintToJson(r.follower_count)!,
      }));
      return c.json({ mid: mid.toString(), limit, items });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.get('/dynamics', async (c) => {
    try {
      const page = parseMonitorPage(c.req.query('page'));
      const pageSize = parseMonitorPageSize(c.req.query('pageSize'));
      const status = parseStatus(c.req.query('status'));
      const offset = (page - 1) * pageSize;
      const countRows = await db<{ count: string }[]>`
        SELECT count(*)::text AS count FROM dynamics d
        WHERE
          (${status} = 'all' OR (${status} = 'active' AND d.deleted_at IS NULL AND d.archived_at IS NULL)
            OR (${status} = 'archived' AND d.archived_at IS NOT NULL AND d.deleted_at IS NULL)
            OR (${status} = 'deleted' AND d.deleted_at IS NOT NULL))
      `;
      const totalItems = Number(countRows[0]?.count ?? '0');
      const rows = await db<
        {
          dynamic_id: string;
          mid: bigint | null;
          category: string | null;
          monitoring_enabled: boolean;
          archived_at: Date | null;
          deleted_at: Date | null;
          sampled_at: Date | null;
          like_count: bigint | null;
          repost_count: bigint | null;
          comment_count: bigint | null;
          target_id: string | null;
          target_enabled: boolean | null;
          target_interval_minutes: number | null;
          target_interval_mode: 'auto' | 'fixed' | null;
          target_last_success_at: Date | null;
          target_last_error: string | null;
        }[]
      >`
        SELECT d.dynamic_id, d.mid, d.category, d.monitoring_enabled, d.archived_at, d.deleted_at,
          m.sampled_at, m.like_count, m.repost_count, m.comment_count,
          t.id::text AS target_id, t.enabled AS target_enabled,
          t.interval_minutes AS target_interval_minutes, t.interval_mode AS target_interval_mode,
          t.last_success_at AS target_last_success_at, t.last_error AS target_last_error
        FROM dynamics d
        LEFT JOIN LATERAL (
          SELECT sampled_at, like_count, repost_count, comment_count
          FROM dynamic_metric_samples s WHERE s.dynamic_id = d.dynamic_id ORDER BY sampled_at DESC LIMIT 1
        ) m ON TRUE
        LEFT JOIN monitor_targets t
          ON t.type = 'dynamic' AND t.external_id = d.dynamic_id AND t.deleted_at IS NULL
        WHERE
          (${status} = 'all' OR (${status} = 'active' AND d.deleted_at IS NULL AND d.archived_at IS NULL)
            OR (${status} = 'archived' AND d.archived_at IS NOT NULL AND d.deleted_at IS NULL)
            OR (${status} = 'deleted' AND d.deleted_at IS NOT NULL))
        ORDER BY m.sampled_at DESC NULLS LAST, d.dynamic_id
        LIMIT ${pageSize} OFFSET ${offset}
      `;
      const items: DynamicListItem[] = rows.map((r) => ({
        dynamicId: r.dynamic_id,
        mid: r.mid != null ? bigintToJson(r.mid) : null,
        category: r.category,
        monitoringEnabled: r.monitoring_enabled,
        archivedAt: r.archived_at?.toISOString() ?? null,
        deletedAt: r.deleted_at?.toISOString() ?? null,
        target: toDynamicTargetRef(r),
        latestMetrics: {
          sampledAt: r.sampled_at?.toISOString() ?? null,
          likeCount: bigintToJson(r.like_count),
          repostCount: bigintToJson(r.repost_count),
          commentCount: bigintToJson(r.comment_count),
        },
      }));
      return c.json({
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
        items,
      } satisfies Paginated<DynamicListItem>);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.get('/dynamics/:id', async (c) => {
    const dynamicId = c.req.param('id');
    const rows = await db<
      {
        dynamic_id: string;
        mid: bigint | null;
        category: string | null;
        monitoring_enabled: boolean;
        archived_at: Date | null;
        deleted_at: Date | null;
        metadata: Record<string, unknown>;
        target_id: string | null;
        target_enabled: boolean | null;
        target_interval_minutes: number | null;
        target_interval_mode: 'auto' | 'fixed' | null;
        target_last_success_at: Date | null;
        target_last_error: string | null;
      }[]
    >`
      SELECT d.dynamic_id, d.mid, d.category, d.monitoring_enabled, d.archived_at, d.deleted_at, d.metadata,
        t.id::text AS target_id, t.enabled AS target_enabled,
        t.interval_minutes AS target_interval_minutes, t.interval_mode AS target_interval_mode,
        t.last_success_at AS target_last_success_at, t.last_error AS target_last_error
      FROM dynamics d
      LEFT JOIN monitor_targets t
        ON t.type = 'dynamic' AND t.external_id = d.dynamic_id AND t.deleted_at IS NULL
      WHERE d.dynamic_id = ${dynamicId}
    `;
    const row = rows[0];
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({
      dynamicId: row.dynamic_id,
      mid: row.mid != null ? bigintToJson(row.mid) : null,
      category: row.category,
      monitoringEnabled: row.monitoring_enabled,
      archivedAt: row.archived_at?.toISOString() ?? null,
      deletedAt: row.deleted_at?.toISOString() ?? null,
      metadata: row.metadata,
      target: toDynamicTargetRef(row),
    });
  });

  app.get('/dynamics/:id/metrics', async (c) => {
    try {
      const dynamicId = c.req.param('id');
      const from = parseIsoDateParam(c.req.query('from'), 'from');
      const to = parseIsoDateParam(c.req.query('to'), 'to');
      const limit = parseMetricsLimit(c.req.query('limit'));
      const rows = await db<
        {
          sampled_at: Date;
          raw_time: string;
          source_timezone: string;
          timestamp_precision: 'minute' | 'second';
          like_count: bigint | null;
          repost_count: bigint | null;
          comment_count: bigint | null;
        }[]
      >`
        SELECT sampled_at, raw_time, source_timezone, timestamp_precision, like_count, repost_count, comment_count
        FROM (
          SELECT sampled_at, raw_time, source_timezone, timestamp_precision, like_count, repost_count, comment_count
          FROM dynamic_metric_samples
          WHERE dynamic_id = ${dynamicId}
          AND (${from}::timestamptz IS NULL OR sampled_at >= ${from})
          AND (${to}::timestamptz IS NULL OR sampled_at <= ${to})
          ORDER BY sampled_at DESC
          LIMIT ${limit}
        ) recent
        ORDER BY sampled_at ASC
      `;
      const items: DynamicMetricPoint[] = rows.map((r) => ({
        sampledAt: r.sampled_at.toISOString(),
        rawTime: r.raw_time,
        sourceTimezone: r.source_timezone,
        timestampPrecision: r.timestamp_precision,
        likeCount: bigintToJson(r.like_count),
        repostCount: bigintToJson(r.repost_count),
        commentCount: bigintToJson(r.comment_count),
      }));
      return c.json({ dynamicId, limit, items });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : 'bad request' }, 400);
    }
  });

  app.patch('/videos/:bvid/pin', async (c) => {
    try {
      const bvid = parseVideoBvidParam(c.req.param('bvid'));
      const body = parsePinVideoRequest(await readJsonBody(c.req.raw));
      const updated = await setVideoPinned(db, bvid, body.pinned);
      if (!updated) {
        return c.json({ error: '未找到该视频', code: 'not_found' }, 404);
      }
      return c.json(
        parsePinVideoResponse({
          bvid: updated.bvid,
          pinned: updated.pinnedAt != null,
          pinnedAt: updated.pinnedAt ? updated.pinnedAt.toISOString() : null,
        }),
      );
    } catch (err) {
      if (err instanceof MonitorContractError) {
        return c.json({ error: err.message, code: err.code }, 400);
      }
      if (err instanceof SyntaxError) {
        return c.json({ error: '请求体不是合法 JSON', code: 'invalid_body' }, 400);
      }
      return c.json(
        { error: err instanceof Error ? err.message : '请求无法处理', code: 'internal' },
        500,
      );
    }
  });

  app.post('/videos/:bvid/refresh', async (c) => {
    try {
      const body = await readJsonBody(c.req.raw);
      const force = body.force === true || c.req.query('force') === 'true';
      const result = await refreshVideo(deps(c), c.req.param('bvid'), force);
      return c.json(result);
    } catch (error) {
      if (error instanceof MetadataRequestError) {
        const status =
          error.bizCode === -404 || error.message.includes('404') ? 404 : error.abort ? 503 : 502;
        return c.json({ error: error.message, bizCode: error.bizCode }, status);
      }
      return c.json({ error: error instanceof Error ? error.message : 'bad request' }, 400);
    }
  });

  app.post('/creators/:mid/refresh', async (c) => {
    try {
      const body = await readJsonBody(c.req.raw);
      const force = body.force === true || c.req.query('force') === 'true';
      const result = await refreshCreator(deps(c), c.req.param('mid'), force);
      return c.json(result);
    } catch (error) {
      if (error instanceof MetadataRequestError) {
        const status = error.bizCode === -404 ? 404 : error.abort ? 503 : 502;
        return c.json({ error: error.message, bizCode: error.bizCode }, status);
      }
      return c.json({ error: error instanceof Error ? error.message : 'bad request' }, 400);
    }
  });

  app.post('/metadata/refresh', async (c) => {
    try {
      const body = await readJsonBody(c.req.raw);
      const kind = body.kind;
      if (kind !== 'video' && kind !== 'creator') throw new Error('invalid kind');
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id): id is string => typeof id === 'string')
        : undefined;
      const allMissing = body.allMissing === true;
      const force = body.force === true;
      const started = await startMetadataBackfill(deps(c), {
        kind: kind as MetadataKind,
        ...(ids && ids.length > 0 ? { ids } : {}),
        ...(allMissing ? { allMissing: true } : {}),
        force,
      });
      refreshDeps.onBackfill?.(started.done);
      void started.done.catch(() => undefined);
      return c.json({ backfillRunId: started.backfillRunId, requested: started.requested }, 202);
    } catch (error) {
      if (error instanceof BackfillConflict) {
        return c.json({ error: error.message, backfillRunId: error.backfillRunId }, 409);
      }
      return c.json({ error: error instanceof Error ? error.message : 'bad request' }, 400);
    }
  });

  app.get('/metadata/runs/:id', async (c) => {
    const id = c.req.param('id');
    if (!UUID.test(id)) return c.json({ error: 'invalid id' }, 400);
    const run = await readMetadataRun(db, id);
    if (!run) return c.json({ error: 'not found' }, 404);
    return c.json({
      id: run.id,
      status: run.status,
      requested: run.requested,
      succeeded: run.succeeded,
      failed: run.failed,
      skipped: run.skipped,
      report: run.report,
    });
  });

  return app;
}
