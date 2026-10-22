import type { Sql } from './client';

export type MonitorCardKind = 'video' | 'creator';
export type MonitorCardFilter = 'all' | 'active' | 'paused' | 'unmonitored';
export type MonitorCardSort = 'published_desc' | 'published_asc';

export type MonitorCardQuery = {
  type: MonitorCardKind;
  monitor: MonitorCardFilter;
  page: number;
  pageSize: number;
  q: string | null;
  category: string | null;
  /** Video-only. Ignored for creators (sampled_at DESC). Default published_desc. */
  sort?: MonitorCardSort | null;
  /**
   * Video-only exact mid filter (decimal string). Applied before count/sort/page.
   * Null/undefined = no mid filter. Creators ignore this.
   */
  ownerMid?: string | null;
  /** Exact identity read. Ignores list filters so detail matches the stored target. */
  externalId?: string | null;
};

export type MonitorCardProjectRow = {
  id: string;
  name: string;
};

export type MonitorCardRow = {
  type: MonitorCardKind;
  externalId: string;
  title: string | null;
  category: string | null;
  imageAssetId: string | null;
  mid: string | null;
  hasEntity: boolean;
  hasSamples: boolean;
  pinned: boolean;
  pinnedAt: Date | null;
  pubdate: Date | null;
  targetId: string | null;
  targetLabel: string | null;
  tags: string[];
  enabled: boolean | null;
  intervalMinutes: number | null;
  intervalMode: 'auto' | 'fixed' | null;
  startAt: Date | null;
  nextRunAt: Date | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  hasRunning: boolean;
  hasPending: boolean;
  projects: MonitorCardProjectRow[];
  sampledAt: Date | null;
  viewCount: string | null;
  onlineViewers: string | null;
  onlineViewersRaw: string | null;
  likeCount: string | null;
  followerCount: string | null;
};

type SqlCardRow = {
  total_items: number;
  external_id: string | null;
  title: string | null;
  category: string | null;
  image_asset_id: string | null;
  mid: string | null;
  has_entity: boolean | null;
  has_samples: boolean | null;
  pinned_at: Date | null;
  pubdate: Date | null;
  target_id: string | null;
  target_label: string | null;
  tags: string[] | null;
  enabled: boolean | null;
  interval_minutes: number | null;
  interval_mode: 'auto' | 'fixed' | null;
  start_at: Date | null;
  next_run_at: Date | null;
  last_run_at: Date | null;
  last_success_at: Date | null;
  last_error: string | null;
  has_running: boolean | null;
  has_pending: boolean | null;
  projects: MonitorCardProjectRow[] | string | null;
  sampled_at: Date | null;
  view_count: string | number | bigint | null;
  online_viewers: string | number | bigint | null;
  online_viewers_raw: string | null;
  like_count: string | number | bigint | null;
  follower_count: string | number | bigint | null;
};

/**
 * Videos (or creators) FULL OUTER JOIN active monitor_targets.
 * Targets may exist before the entity row. Deleted targets are not a second
 * current object. Project links use publish/contract bvid only — not linked_bvid.
 */
const VIDEO_UNIFIED = `
SELECT
  COALESCE(e.external_id, t.external_id) AS external_id,
  e.title AS title,
  e.category AS category,
  e.mid::text AS mid,
  e.cover_asset_id AS image_asset_id,
  (e.external_id IS NOT NULL) AS has_entity,
  (e.sampled_at IS NOT NULL) AS has_samples,
  e.pinned_at,
  e.pubdate,
  e.sampled_at,
  e.view_count,
  e.online_viewers,
  e.online_viewers_raw,
  e.like_count,
  NULL::bigint AS follower_count,
  t.id::text AS target_id,
  t.label AS target_label,
  COALESCE(t.tags, '{}'::text[]) AS tags,
  t.enabled,
  t.interval_minutes,
  t.interval_mode,
  t.start_at,
  t.next_run_at,
  t.last_run_at,
  t.last_success_at,
  t.last_error
FROM (
  SELECT
    v.bvid AS external_id,
    v.title,
    v.category,
    v.mid,
    v.cover_asset_id,
    v.pinned_at,
    v.pubdate,
    m.sampled_at,
    m.view_count,
    m.online_viewers,
    m.online_viewers_raw,
    m.like_count
  FROM videos v
  LEFT JOIN LATERAL (
    SELECT sampled_at, view_count, online_viewers, online_viewers_raw, like_count
    FROM video_metric_samples s
    WHERE s.bvid = v.bvid
    ORDER BY sampled_at DESC
    LIMIT 1
  ) m ON TRUE
) e
FULL OUTER JOIN (
  SELECT
    id, external_id, label, tags, enabled, interval_minutes, interval_mode,
    start_at, next_run_at, last_run_at, last_success_at, last_error
  FROM monitor_targets
  WHERE "type" = 'video' AND deleted_at IS NULL
) t ON t.external_id = e.external_id
`;

const CREATOR_UNIFIED = `
SELECT
  COALESCE(e.external_id, t.external_id) AS external_id,
  e.title AS title,
  e.category AS category,
  COALESCE(e.mid, t.external_id)::text AS mid,
  e.face_asset_id AS image_asset_id,
  (e.external_id IS NOT NULL) AS has_entity,
  (e.sampled_at IS NOT NULL) AS has_samples,
  NULL::timestamptz AS pinned_at,
  NULL::timestamptz AS pubdate,
  e.sampled_at,
  NULL::bigint AS view_count,
  NULL::bigint AS online_viewers,
  NULL::text AS online_viewers_raw,
  NULL::bigint AS like_count,
  e.follower_count,
  t.id::text AS target_id,
  t.label AS target_label,
  COALESCE(t.tags, '{}'::text[]) AS tags,
  t.enabled,
  t.interval_minutes,
  t.interval_mode,
  t.start_at,
  t.next_run_at,
  t.last_run_at,
  t.last_success_at,
  t.last_error
FROM (
  SELECT
    c.mid::text AS external_id,
    c.uname AS title,
    c.category,
    c.mid::text AS mid,
    c.face_asset_id,
    f.sampled_at,
    f.follower_count
  FROM creators c
  LEFT JOIN LATERAL (
    SELECT sampled_at, follower_count
    FROM creator_follower_samples s
    WHERE s.mid = c.mid
    ORDER BY sampled_at DESC
    LIMIT 1
  ) f ON TRUE
) e
FULL OUTER JOIN (
  SELECT
    id, external_id, label, tags, enabled, interval_minutes, interval_mode,
    start_at, next_run_at, last_run_at, last_success_at, last_error
  FROM monitor_targets
  WHERE "type" = 'creator' AND deleted_at IS NULL
) t ON t.external_id = e.external_id
`;

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function asCount(value: string | number | bigint | null): string | null {
  if (value === null || value === undefined) return null;
  return BigInt(value).toString();
}

function asProjects(value: MonitorCardProjectRow[] | string | null): MonitorCardProjectRow[] {
  if (!value) return [];
  const parsed = typeof value === 'string' ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed)) return [];
  const projects: MonitorCardProjectRow[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { id?: unknown; name?: unknown };
    if (typeof record.id !== 'string' || typeof record.name !== 'string') continue;
    projects.push({ id: record.id, name: record.name });
  }
  return projects;
}

function mapRow(type: MonitorCardKind, row: SqlCardRow): MonitorCardRow | null {
  if (!row.external_id) return null;
  return {
    type,
    externalId: row.external_id,
    title: row.title,
    category: row.category,
    imageAssetId: row.image_asset_id,
    mid: row.mid,
    hasEntity: row.has_entity === true,
    hasSamples: row.has_samples === true,
    pinned: type === 'video' && row.pinned_at != null,
    pinnedAt: type === 'video' ? row.pinned_at : null,
    pubdate: type === 'video' ? row.pubdate : null,
    targetId: row.target_id,
    targetLabel: row.target_label,
    tags: row.tags ?? [],
    enabled: row.enabled,
    intervalMinutes: row.interval_minutes,
    intervalMode: row.interval_mode,
    startAt: row.start_at,
    nextRunAt: row.next_run_at,
    lastRunAt: row.last_run_at,
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    hasRunning: row.has_running === true,
    hasPending: row.has_pending === true,
    projects: type === 'video' ? asProjects(row.projects) : [],
    sampledAt: row.sampled_at,
    viewCount: asCount(row.view_count),
    onlineViewers: asCount(row.online_viewers),
    onlineViewersRaw: row.online_viewers_raw,
    likeCount: asCount(row.like_count),
    followerCount: asCount(row.follower_count),
  };
}

export async function listMonitorCards(
  sql: Sql,
  query: MonitorCardQuery,
): Promise<{ items: MonitorCardRow[]; totalItems: number }> {
  const page = Math.max(1, Math.floor(query.page));
  const pageSize = Math.min(50, Math.max(1, Math.floor(query.pageSize)));
  const offset = (page - 1) * pageSize;
  const externalId = query.externalId ?? null;
  const q = externalId ? null : query.q;
  const category = externalId ? null : query.category;
  const monitor = query.monitor;
  /** Exact mid filter for「只看我的」; never applied to creator lists or identity reads. */
  const ownerMid = externalId || query.type !== 'video' || !query.ownerMid ? null : query.ownerMid;
  const pattern = q ? likePattern(q) : null;
  const unified = query.type === 'video' ? VIDEO_UNIFIED : CREATOR_UNIFIED;
  const videoSort = query.sort === 'published_asc' ? 'published_asc' : 'published_desc';
  const orderBy =
    query.type === 'video'
      ? videoSort === 'published_asc'
        ? sql`ORDER BY (pinned_at IS NOT NULL) DESC, pubdate ASC NULLS LAST, external_id ASC`
        : sql`ORDER BY (pinned_at IS NOT NULL) DESC, pubdate DESC NULLS LAST, external_id ASC`
      : sql`ORDER BY sampled_at DESC NULLS LAST, external_id ASC`;
  const rows = await sql<SqlCardRow[]>`
    WITH unified AS (
      ${sql.unsafe(unified)}
    ),
    filtered AS (
      SELECT * FROM unified u
      WHERE (${externalId}::text IS NULL OR u.external_id = ${externalId})
        AND (
          ${externalId}::text IS NOT NULL
          OR ${q}::text IS NULL
          OR u.external_id ILIKE ${pattern} ESCAPE '\\'
          OR COALESCE(u.title, '') ILIKE ${pattern} ESCAPE '\\'
          OR COALESCE(u.target_label, '') ILIKE ${pattern} ESCAPE '\\'
        )
        AND (
          ${externalId}::text IS NOT NULL
          OR ${category}::text IS NULL
          OR u.category = ${category}
        )
        AND (
          ${externalId}::text IS NOT NULL
          OR ${monitor}::text = 'all'
          OR (${monitor}::text = 'active' AND u.target_id IS NOT NULL AND u.enabled IS TRUE)
          OR (${monitor}::text = 'paused' AND u.target_id IS NOT NULL AND u.enabled IS FALSE)
          OR (${monitor}::text = 'unmonitored' AND u.target_id IS NULL)
        )
        AND (
          ${ownerMid}::text IS NULL
          OR u.mid = ${ownerMid}
        )
    ),
    counted AS (
      SELECT count(*)::int AS total_items FROM filtered
    ),
    card_page AS (
      SELECT * FROM filtered
      ${orderBy}
      LIMIT ${pageSize} OFFSET ${offset}
    )
    SELECT
      counted.total_items,
      card_page.external_id,
      card_page.title,
      card_page.category,
      card_page.image_asset_id,
      card_page.mid,
      card_page.has_entity,
      card_page.has_samples,
      card_page.pinned_at,
      card_page.pubdate,
      card_page.target_id,
      card_page.target_label,
      card_page.tags,
      card_page.enabled,
      card_page.interval_minutes,
      card_page.interval_mode,
      card_page.start_at,
      card_page.next_run_at,
      card_page.last_run_at,
      card_page.last_success_at,
      card_page.last_error,
      card_page.sampled_at,
      card_page.view_count,
      card_page.online_viewers,
      card_page.online_viewers_raw,
      card_page.like_count,
      card_page.follower_count,
      COALESCE(jobs.has_running, false) AS has_running,
      COALESCE(jobs.has_pending, false) AS has_pending,
      COALESCE(proj.projects, '[]'::jsonb) AS projects
    FROM counted
    LEFT JOIN card_page ON TRUE
    LEFT JOIN LATERAL (
      SELECT
        bool_or(j.status = 'running') AS has_running,
        bool_or(j.status = 'pending') AS has_pending
      FROM collector_jobs j
      WHERE card_page.target_id IS NOT NULL
        AND j.target_id = card_page.target_id::uuid
    ) jobs ON TRUE
    LEFT JOIN LATERAL (
      SELECT COALESCE(
        jsonb_agg(jsonb_build_object('id', rel.id, 'name', rel.name) ORDER BY rel.name, rel.id),
        '[]'::jsonb
      ) AS projects
      FROM (
        SELECT cp.id::text AS id, cp.name
        FROM project_publish_records r
        JOIN commercial_projects cp ON cp.id = r.project_id
        WHERE card_page.external_id IS NOT NULL
          AND r.bvid = card_page.external_id
        UNION
        SELECT cp.id::text AS id, cp.name
        FROM project_monitor_contracts m
        JOIN commercial_projects cp ON cp.id = m.project_id
        WHERE card_page.external_id IS NOT NULL
          AND m.bvid = card_page.external_id
      ) rel
    ) proj ON ${query.type}::text = 'video'
  `;
  const totalItems = Number(rows[0]?.total_items ?? 0);
  const items = rows.flatMap((row) => {
    const mapped = mapRow(query.type, row);
    return mapped ? [mapped] : [];
  });
  return { items, totalItems };
}

/** Pin or unpin a video row. Returns null when the bvid does not exist. Idempotent. */
export async function setVideoPinned(
  sql: Sql,
  bvid: string,
  pinned: boolean,
): Promise<{ bvid: string; pinnedAt: Date | null } | null> {
  const rows = await sql<{ bvid: string; pinned_at: Date | null }[]>`
    UPDATE videos
    SET
      pinned_at = CASE WHEN ${pinned}::boolean THEN now() ELSE NULL END,
      updated_at = now()
    WHERE bvid = ${bvid}
    RETURNING bvid, pinned_at
  `;
  const row = rows[0];
  if (!row) return null;
  return { bvid: row.bvid, pinnedAt: row.pinned_at };
}

export async function getMonitorCard(
  sql: Sql,
  type: MonitorCardKind,
  externalId: string,
): Promise<MonitorCardRow | null> {
  const listed = await listMonitorCards(sql, {
    type,
    monitor: 'all',
    page: 1,
    pageSize: 1,
    q: null,
    category: null,
    externalId,
  });
  return listed.items[0] ?? null;
}
