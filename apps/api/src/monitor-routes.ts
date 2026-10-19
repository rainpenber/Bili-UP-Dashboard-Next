import {
  bigintToJson,
  parseIsoDateParam,
  parseMetricsLimit,
  parseMonitorPage,
  parseMonitorPageSize,
  MONITOR_MAX_METRICS_LIMIT,
  type Paginated,
  type CreatorListItem,
  type DynamicListItem,
  type VideoListItem,
  type VideoMetricPoint,
  type CreatorMetricPoint,
  type DynamicMetricPoint,
} from '@studio/contracts';
import { VIDEO_PARTITION_JOINS, VIDEO_PARTITION_NAME_SQL, type Sql } from '@studio/db';
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
import { Hono } from 'hono';
import { readAssetsRoot } from './assets-config';
import { registerMonitorTargetRoutes } from './monitor-target-routes';

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

export function createMonitorRoutes(db: Sql, refreshDeps: MonitorRefreshOptions = {}) {
  const app = new Hono();
  registerMonitorTargetRoutes(app, db);
  const deps = () => buildRefreshDeps(db, refreshDeps);

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
      }[]
    >`
      SELECT v.bvid, v.title, v.category, v.mid, v.monitoring_enabled, v.archived_at, v.deleted_at,
        v.cover_asset_id, v.tid, v.tid_v2,
        ${db.unsafe(VIDEO_PARTITION_NAME_SQL)} AS partition_name,
        v.metadata
      FROM videos v
      ${db.unsafe(VIDEO_PARTITION_JOINS)}
      WHERE v.bvid = ${bvid}
    `;
    const row = rows[0];
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.json({
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
    });
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
        }[]
      >`
        SELECT d.dynamic_id, d.mid, d.category, d.monitoring_enabled, d.archived_at, d.deleted_at,
          m.sampled_at, m.like_count, m.repost_count, m.comment_count
        FROM dynamics d
        LEFT JOIN LATERAL (
          SELECT sampled_at, like_count, repost_count, comment_count
          FROM dynamic_metric_samples s WHERE s.dynamic_id = d.dynamic_id ORDER BY sampled_at DESC LIMIT 1
        ) m ON TRUE
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
      }[]
    >`
      SELECT dynamic_id, mid, category, monitoring_enabled, archived_at, deleted_at, metadata
      FROM dynamics WHERE dynamic_id = ${dynamicId}
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

  app.post('/videos/:bvid/refresh', async (c) => {
    try {
      const body = await readJsonBody(c.req.raw);
      const force = body.force === true || c.req.query('force') === 'true';
      const result = await refreshVideo(deps(), c.req.param('bvid'), force);
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
      const result = await refreshCreator(deps(), c.req.param('mid'), force);
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
      const started = await startMetadataBackfill(deps(), {
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
