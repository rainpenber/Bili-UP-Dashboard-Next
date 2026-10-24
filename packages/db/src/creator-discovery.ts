import type postgres from 'postgres';
import type { Sql } from './client';
import { effectiveFirstRunAt, type MonitorTargetRow } from './monitor-targets';

type Queryable = postgres.Sql | postgres.TransactionSql;

function pgTextArray(values: readonly string[]): string {
  if (values.length === 0) return '{}';
  return `{${values.map((value) => `"${value}"`).join(',')}}`;
}

export type DenseCollectPhase = 'dense15' | 'dense30' | 'normal';

/** Max skip rows exposed on discovery config (persisted + API). */
export const DISCOVERY_LAST_SKIPS_LIMIT = 20;

export type DiscoveryItemSkip = {
  externalId: string;
  reason: string;
};

export type CreatorDiscoveryConfigRow = {
  mid: string;
  enabled: boolean;
  discoverVideos: boolean;
  discoverDynamics: boolean;
  monitorNewVideos: boolean;
  discoveryTargetId: string | null;
  videoWatermarkCreated: bigint | null;
  dynamicWatermarkPubTs: bigint | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  lastRunAt: Date | null;
  suppressedAutoCreateTotal: number;
  lastSkippedCount: number;
  lastSkips: DiscoveryItemSkip[];
  createdAt: Date;
  updatedAt: Date;
};

export type CreatorPublishEventKind = 'video' | 'dynamic';
export type CreatorPublishEventSource = 'bilibili' | 'manual';

export type CreatorPublishEventRow = {
  id: string;
  mid: string;
  eventKind: CreatorPublishEventKind;
  externalId: string;
  publishedAt: Date;
  titleSnapshot: string;
  firstDiscoveredAt: Date;
  source: CreatorPublishEventSource;
  monitoredTargetId: string | null;
  createdAt: Date;
};

export type VideoDenseCollectPlanRow = {
  targetId: string;
  phase: DenseCollectPhase;
  activatedAt: Date;
  dense15Until: Date;
  dense30Until: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const DISCOVERY_INTERVAL_MINUTES = 5;
const DENSE15_DAYS = 5;
const DENSE30_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
export const DISCOVERY_AUTO_CREATE_LIMIT = 2;

type ConfigSqlRow = {
  mid: string;
  enabled: boolean;
  discover_videos: boolean;
  discover_dynamics: boolean;
  monitor_new_videos: boolean;
  discovery_target_id: string | null;
  video_watermark_created: string | null;
  dynamic_watermark_pub_ts: string | null;
  last_success_at: Date | null;
  last_error: string | null;
  last_run_at: Date | null;
  suppressed_auto_create_total: number;
  last_skipped_count: number;
  last_skips: unknown;
  created_at: Date;
  updated_at: Date;
};

function mapDiscoverySkips(value: unknown): DiscoveryItemSkip[] {
  if (!Array.isArray(value)) return [];
  const out: DiscoveryItemSkip[] = [];
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const row = entry as Record<string, unknown>;
    if (typeof row.externalId !== 'string' || typeof row.reason !== 'string') continue;
    out.push({ externalId: row.externalId, reason: row.reason });
    if (out.length >= DISCOVERY_LAST_SKIPS_LIMIT) break;
  }
  return out;
}

type EventSqlRow = {
  id: string;
  mid: string;
  event_kind: CreatorPublishEventKind;
  external_id: string;
  published_at: Date;
  title_snapshot: string;
  first_discovered_at: Date;
  source: CreatorPublishEventSource;
  monitored_target_id: string | null;
  created_at: Date;
};

type DenseSqlRow = {
  target_id: string;
  phase: DenseCollectPhase;
  activated_at: Date;
  dense15_until: Date;
  dense30_until: Date;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

function mapConfig(row: ConfigSqlRow): CreatorDiscoveryConfigRow {
  return {
    mid: row.mid,
    enabled: row.enabled,
    discoverVideos: row.discover_videos,
    discoverDynamics: row.discover_dynamics,
    monitorNewVideos: row.monitor_new_videos,
    discoveryTargetId: row.discovery_target_id,
    videoWatermarkCreated:
      row.video_watermark_created === null ? null : BigInt(row.video_watermark_created),
    dynamicWatermarkPubTs:
      row.dynamic_watermark_pub_ts === null ? null : BigInt(row.dynamic_watermark_pub_ts),
    lastSuccessAt: row.last_success_at,
    lastError: row.last_error,
    lastRunAt: row.last_run_at,
    suppressedAutoCreateTotal: row.suppressed_auto_create_total,
    lastSkippedCount: row.last_skipped_count,
    lastSkips: mapDiscoverySkips(row.last_skips),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEvent(row: EventSqlRow): CreatorPublishEventRow {
  return {
    id: row.id,
    mid: row.mid,
    eventKind: row.event_kind,
    externalId: row.external_id,
    publishedAt: row.published_at,
    titleSnapshot: row.title_snapshot,
    firstDiscoveredAt: row.first_discovered_at,
    source: row.source,
    monitoredTargetId: row.monitored_target_id,
    createdAt: row.created_at,
  };
}

function mapDense(row: DenseSqlRow): VideoDenseCollectPlanRow {
  return {
    targetId: row.target_id,
    phase: row.phase,
    activatedAt: row.activated_at,
    dense15Until: row.dense15_until,
    dense30Until: row.dense30_until,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const configColumns = `
  mid, enabled, discover_videos, discover_dynamics, monitor_new_videos,
  discovery_target_id, video_watermark_created, dynamic_watermark_pub_ts,
  last_success_at, last_error, last_run_at, suppressed_auto_create_total,
  last_skipped_count, last_skips,
  created_at, updated_at
`;

export async function getCreatorDiscoveryConfig(
  sql: Queryable,
  mid: string,
): Promise<CreatorDiscoveryConfigRow | null> {
  const rows = await sql<ConfigSqlRow[]>`
    SELECT ${sql.unsafe(configColumns)}
    FROM creator_discovery_configs
    WHERE mid = ${mid}
  `;
  const row = rows[0];
  return row ? mapConfig(row) : null;
}

/** Default-off config shape when the user has never saved discovery settings. */
export function defaultCreatorDiscoveryConfig(mid: string): CreatorDiscoveryConfigRow {
  const now = new Date(0);
  return {
    mid,
    enabled: false,
    discoverVideos: false,
    discoverDynamics: false,
    monitorNewVideos: false,
    discoveryTargetId: null,
    videoWatermarkCreated: null,
    dynamicWatermarkPubTs: null,
    lastSuccessAt: null,
    lastError: null,
    lastRunAt: null,
    suppressedAutoCreateTotal: 0,
    lastSkippedCount: 0,
    lastSkips: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function upsertCreatorDiscoveryConfig(
  sql: Sql,
  input: {
    mid: string;
    enabled: boolean;
    discoverVideos: boolean;
    discoverDynamics: boolean;
    monitorNewVideos: boolean;
    now: Date;
  },
): Promise<{ config: CreatorDiscoveryConfigRow; discoveryTarget: MonitorTargetRow | null }> {
  if (input.enabled && !input.discoverVideos && !input.discoverDynamics) {
    throw new Error('开启发现时至少勾选视频或动态');
  }
  if (input.monitorNewVideos && !input.discoverVideos) {
    throw new Error('同时监控新视频数据需要先开启发现视频');
  }

  return sql.begin(async (tx) => {
    let discoveryTarget: MonitorTargetRow | null = null;
    let discoveryTargetId: string | null = null;

    if (input.enabled) {
      const existing = await tx<ConfigSqlRow[]>`
        SELECT ${tx.unsafe(configColumns)}
        FROM creator_discovery_configs
        WHERE mid = ${input.mid}
      `;
      const priorTargetId = existing[0]?.discovery_target_id ?? null;
      if (priorTargetId) {
        await tx`
          UPDATE monitor_targets
          SET enabled = true,
              interval_minutes = ${DISCOVERY_INTERVAL_MINUTES},
              interval_mode = 'fixed',
              next_run_at = CASE
                WHEN next_run_at IS NULL OR next_run_at > ${input.now} THEN ${input.now}
                ELSE next_run_at
              END,
              updated_at = ${input.now},
              deleted_at = NULL
          WHERE id = ${priorTargetId}::uuid
        `;
        discoveryTargetId = priorTargetId;
      } else {
        // Reuse active discovery identity if config row was wiped but target remains.
        const byIdentity = await tx<{ id: string }[]>`
          SELECT id::text AS id
          FROM monitor_targets
          WHERE "type" = 'discovery'
            AND external_id = ${input.mid}
            AND deleted_at IS NULL
          LIMIT 1
        `;
        if (byIdentity[0]) {
          discoveryTargetId = byIdentity[0].id;
          await tx`
            UPDATE monitor_targets
            SET enabled = true,
                interval_minutes = ${DISCOVERY_INTERVAL_MINUTES},
                interval_mode = 'fixed',
                next_run_at = CASE
                  WHEN next_run_at IS NULL OR next_run_at > ${input.now} THEN ${input.now}
                  ELSE next_run_at
                END,
                updated_at = ${input.now}
            WHERE id = ${discoveryTargetId}::uuid
          `;
        } else {
          const id = crypto.randomUUID();
          const firstRunAt = effectiveFirstRunAt(input.now, null);
          await tx`
            INSERT INTO monitor_targets (
              id, "type", external_id, label, tags, enabled, interval_minutes, interval_mode,
              start_at, next_run_at, source
            ) VALUES (
              ${id}::uuid,
              'discovery',
              ${input.mid},
              ${`发现 ${input.mid}`},
              ${pgTextArray(['discovery'])}::text[],
              true,
              ${DISCOVERY_INTERVAL_MINUTES},
              'fixed',
              NULL,
              ${firstRunAt},
              'offline'
            )
          `;
          const jobId = crypto.randomUUID();
          await tx`
            INSERT INTO collector_jobs (id, target_id, status, attempts, scheduled_for)
            VALUES (${jobId}::uuid, ${id}::uuid, 'pending', 0, ${firstRunAt})
          `;
          discoveryTargetId = id;
        }
      }
    } else {
      const existing = await tx<ConfigSqlRow[]>`
        SELECT ${tx.unsafe(configColumns)}
        FROM creator_discovery_configs
        WHERE mid = ${input.mid}
      `;
      discoveryTargetId = existing[0]?.discovery_target_id ?? null;
      if (discoveryTargetId) {
        await tx`
          UPDATE monitor_targets
          SET enabled = false,
              next_run_at = NULL,
              updated_at = ${input.now}
          WHERE id = ${discoveryTargetId}::uuid
            AND deleted_at IS NULL
        `;
      }
      // Soft-disable only: keep historical publish events.
    }

    const rows = await tx<ConfigSqlRow[]>`
      INSERT INTO creator_discovery_configs (
        mid, enabled, discover_videos, discover_dynamics, monitor_new_videos,
        discovery_target_id, updated_at
      ) VALUES (
        ${input.mid},
        ${input.enabled},
        ${input.discoverVideos},
        ${input.discoverDynamics},
        ${input.monitorNewVideos},
        ${discoveryTargetId},
        ${input.now}
      )
      ON CONFLICT (mid) DO UPDATE SET
        enabled = EXCLUDED.enabled,
        discover_videos = EXCLUDED.discover_videos,
        discover_dynamics = EXCLUDED.discover_dynamics,
        monitor_new_videos = EXCLUDED.monitor_new_videos,
        discovery_target_id = COALESCE(EXCLUDED.discovery_target_id, creator_discovery_configs.discovery_target_id),
        updated_at = EXCLUDED.updated_at
      RETURNING ${tx.unsafe(configColumns)}
    `;
    const config = mapConfig(rows[0]!);
    if (!discoveryTarget && config.discoveryTargetId) {
      const targets = await tx`
        SELECT id, "type", external_id, label, tags, enabled, interval_minutes, interval_mode,
          start_at, next_run_at, last_run_at, last_success_at, last_error, source,
          created_at, updated_at, deleted_at
        FROM monitor_targets
        WHERE id = ${config.discoveryTargetId}::uuid
      `;
      const t = targets[0] as
        | {
            id: string;
            type: 'discovery';
            external_id: string;
            label: string;
            tags: string[] | string;
            enabled: boolean;
            interval_minutes: number;
            interval_mode: 'auto' | 'fixed';
            start_at: Date | null;
            next_run_at: Date | null;
            last_run_at: Date | null;
            last_success_at: Date | null;
            last_error: string | null;
            source: string;
            created_at: Date;
            updated_at: Date;
            deleted_at: Date | null;
          }
        | undefined;
      if (t) {
        discoveryTarget = {
          id: t.id,
          type: t.type,
          externalId: t.external_id,
          label: t.label,
          tags: Array.isArray(t.tags) ? t.tags : [],
          enabled: t.enabled,
          intervalMinutes: t.interval_minutes,
          intervalMode: t.interval_mode,
          startAt: t.start_at,
          nextRunAt: t.next_run_at,
          lastRunAt: t.last_run_at,
          lastSuccessAt: t.last_success_at,
          lastError: t.last_error,
          source: t.source,
          createdAt: t.created_at,
          updatedAt: t.updated_at,
          deletedAt: t.deleted_at,
        };
      }
    }
    return { config, discoveryTarget };
  });
}

export function clipDiscoverySkips(skips: readonly DiscoveryItemSkip[]): DiscoveryItemSkip[] {
  return skips.slice(0, DISCOVERY_LAST_SKIPS_LIMIT).map((skip) => ({
    externalId: skip.externalId.slice(0, 64),
    reason: skip.reason.slice(0, 500),
  }));
}

export async function markDiscoveryRunResult(
  sql: Queryable,
  input: {
    mid: string;
    now: Date;
    success: boolean;
    error: string | null;
    videoWatermarkCreated?: bigint | null;
    dynamicWatermarkPubTs?: bigint | null;
    suppressedAutoCreateDelta?: number;
    /** Per-item skips from this round; persisted on success (list request ok). */
    skips?: readonly DiscoveryItemSkip[];
  },
): Promise<void> {
  const suppress = input.suppressedAutoCreateDelta ?? 0;
  if (!input.success) {
    // Failure: keep watermarks / last success; record error only (no fake events).
    // Do not overwrite last_skips — those describe the last successful list round.
    await sql`
      UPDATE creator_discovery_configs
      SET last_run_at = ${input.now},
          last_error = ${input.error},
          updated_at = ${input.now}
      WHERE mid = ${input.mid}
    `;
    return;
  }
  const videoWm =
    input.videoWatermarkCreated === undefined || input.videoWatermarkCreated === null
      ? null
      : input.videoWatermarkCreated.toString();
  const dynWm =
    input.dynamicWatermarkPubTs === undefined || input.dynamicWatermarkPubTs === null
      ? null
      : input.dynamicWatermarkPubTs.toString();
  const rawSkips = input.skips ?? [];
  const skips = clipDiscoverySkips(rawSkips);
  const skippedCount = rawSkips.length;
  await sql`
    UPDATE creator_discovery_configs
    SET last_run_at = ${input.now},
        last_success_at = ${input.now},
        last_error = NULL,
        video_watermark_created = CASE
          WHEN ${videoWm}::text IS NULL THEN video_watermark_created
          ELSE ${videoWm}::bigint
        END,
        dynamic_watermark_pub_ts = CASE
          WHEN ${dynWm}::text IS NULL THEN dynamic_watermark_pub_ts
          ELSE ${dynWm}::bigint
        END,
        suppressed_auto_create_total = suppressed_auto_create_total + ${suppress},
        last_skipped_count = ${skippedCount},
        last_skips = ${sql.json(JSON.parse(JSON.stringify(skips)) as postgres.JSONValue)},
        updated_at = ${input.now}
    WHERE mid = ${input.mid}
  `;
}

export async function insertCreatorPublishEvent(
  sql: Queryable,
  input: {
    id: string;
    mid: string;
    eventKind: CreatorPublishEventKind;
    externalId: string;
    publishedAt: Date;
    titleSnapshot: string;
    firstDiscoveredAt: Date;
    monitoredTargetId?: string | null;
    source?: CreatorPublishEventSource;
  },
): Promise<{ event: CreatorPublishEventRow; created: boolean }> {
  const source = input.source ?? 'bilibili';
  const inserted = await sql<EventSqlRow[]>`
    INSERT INTO creator_publish_events (
      id, mid, event_kind, external_id, published_at, title_snapshot,
      first_discovered_at, source, monitored_target_id
    ) VALUES (
      ${input.id}::uuid,
      ${input.mid},
      ${input.eventKind},
      ${input.externalId},
      ${input.publishedAt},
      ${input.titleSnapshot},
      ${input.firstDiscoveredAt},
      ${source},
      ${input.monitoredTargetId ?? null}
    )
    ON CONFLICT (mid, event_kind, external_id) DO NOTHING
    RETURNING
      id, mid, event_kind, external_id, published_at, title_snapshot,
      first_discovered_at, source, monitored_target_id, created_at
  `;
  if (inserted[0]) return { event: mapEvent(inserted[0]), created: true };
  const existing = await sql<EventSqlRow[]>`
    SELECT
      id, mid, event_kind, external_id, published_at, title_snapshot,
      first_discovered_at, source, monitored_target_id, created_at
    FROM creator_publish_events
    WHERE mid = ${input.mid}
      AND event_kind = ${input.eventKind}
      AND external_id = ${input.externalId}
  `;
  const row = existing[0];
  if (!row) throw new Error('发布事件冲突后未能读回');
  return { event: mapEvent(row), created: false };
}

export async function linkPublishEventTarget(
  sql: Queryable,
  input: {
    mid: string;
    eventKind: CreatorPublishEventKind;
    externalId: string;
    targetId: string;
  },
): Promise<void> {
  await sql`
    UPDATE creator_publish_events
    SET monitored_target_id = ${input.targetId}::uuid
    WHERE mid = ${input.mid}
      AND event_kind = ${input.eventKind}
      AND external_id = ${input.externalId}
      AND monitored_target_id IS NULL
  `;
}

export async function getCreatorPublishEventById(
  sql: Queryable,
  input: { mid: string; eventId: string },
): Promise<CreatorPublishEventRow | null> {
  const rows = await sql<EventSqlRow[]>`
    SELECT
      id, mid, event_kind, external_id, published_at, title_snapshot,
      first_discovered_at, source, monitored_target_id, created_at
    FROM creator_publish_events
    WHERE mid = ${input.mid}
      AND id = ${input.eventId}::uuid
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapEvent(row) : null;
}

export async function deleteManualCreatorPublishEvent(
  sql: Queryable,
  input: { mid: string; eventId: string },
): Promise<'deleted' | 'not_found' | 'manual_only'> {
  const existing = await getCreatorPublishEventById(sql, input);
  if (!existing) return 'not_found';
  if (existing.source !== 'manual') return 'manual_only';
  await sql`
    DELETE FROM creator_publish_events
    WHERE mid = ${input.mid}
      AND id = ${input.eventId}::uuid
      AND source = 'manual'
  `;
  return 'deleted';
}

export async function findActivePublishMonitorTargetId(
  sql: Queryable,
  input: { eventKind: CreatorPublishEventKind; externalId: string },
): Promise<string | null> {
  const type = input.eventKind;
  const rows = await sql<{ id: string }[]>`
    SELECT id::text AS id
    FROM monitor_targets
    WHERE "type" = ${type}
      AND external_id = ${input.externalId}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export async function listCreatorPublishEvents(
  sql: Queryable,
  input: {
    mid: string;
    from?: Date | null;
    to?: Date | null;
    limit: number;
    offset?: number;
  },
): Promise<{ items: CreatorPublishEventRow[]; totalItems: number }> {
  const from = input.from ?? null;
  const to = input.to ?? null;
  const offset = input.offset ?? 0;
  const countRows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM creator_publish_events
    WHERE mid = ${input.mid}
      AND (${from}::timestamptz IS NULL OR published_at >= ${from})
      AND (${to}::timestamptz IS NULL OR published_at <= ${to})
  `;
  const rows = await sql<EventSqlRow[]>`
    SELECT
      id, mid, event_kind, external_id, published_at, title_snapshot,
      first_discovered_at, source, monitored_target_id, created_at
    FROM creator_publish_events
    WHERE mid = ${input.mid}
      AND (${from}::timestamptz IS NULL OR published_at >= ${from})
      AND (${to}::timestamptz IS NULL OR published_at <= ${to})
    ORDER BY published_at ASC, id ASC
    LIMIT ${input.limit} OFFSET ${offset}
  `;
  return {
    items: rows.map(mapEvent),
    totalItems: Number(countRows[0]?.count ?? '0'),
  };
}

export async function ensureVideoDenseCollectPlan(
  sql: Queryable,
  input: { targetId: string; activatedAt: Date },
): Promise<{ plan: VideoDenseCollectPlanRow; created: boolean }> {
  const dense15Until = new Date(input.activatedAt.getTime() + DENSE15_DAYS * DAY_MS);
  const dense30Until = new Date(input.activatedAt.getTime() + DENSE30_DAYS * DAY_MS);
  const inserted = await sql<DenseSqlRow[]>`
    INSERT INTO video_dense_collect_plans (
      target_id, phase, activated_at, dense15_until, dense30_until, updated_at
    ) VALUES (
      ${input.targetId}::uuid,
      'dense15',
      ${input.activatedAt},
      ${dense15Until},
      ${dense30Until},
      ${input.activatedAt}
    )
    ON CONFLICT (target_id) DO NOTHING
    RETURNING
      target_id, phase, activated_at, dense15_until, dense30_until,
      completed_at, created_at, updated_at
  `;
  if (inserted[0]) return { plan: mapDense(inserted[0]), created: true };
  const existing = await sql<DenseSqlRow[]>`
    SELECT
      target_id, phase, activated_at, dense15_until, dense30_until,
      completed_at, created_at, updated_at
    FROM video_dense_collect_plans
    WHERE target_id = ${input.targetId}::uuid
  `;
  const row = existing[0];
  if (!row) throw new Error('密集采集计划冲突后未能读回');
  return { plan: mapDense(row), created: false };
}

export async function getVideoDenseCollectPlan(
  sql: Queryable,
  targetId: string,
): Promise<VideoDenseCollectPlanRow | null> {
  const rows = await sql<DenseSqlRow[]>`
    SELECT
      target_id, phase, activated_at, dense15_until, dense30_until,
      completed_at, created_at, updated_at
    FROM video_dense_collect_plans
    WHERE target_id = ${targetId}::uuid
  `;
  const row = rows[0];
  return row ? mapDense(row) : null;
}

/**
 * Advance dense phase from stored switch times (idempotent; no date recalculation).
 * Returns minutes for the active dense window, or null when normal (caller uses age tiers).
 */
export function resolveDenseCollectMinutes(
  plan: VideoDenseCollectPlanRow,
  now: Date,
): { phase: DenseCollectPhase; minutes: number | null; shouldPersistPhase: boolean } {
  if (plan.phase === 'normal') {
    return { phase: 'normal', minutes: null, shouldPersistPhase: false };
  }
  if (now.getTime() < plan.dense15Until.getTime()) {
    return {
      phase: 'dense15',
      minutes: 15,
      shouldPersistPhase: plan.phase !== 'dense15',
    };
  }
  if (now.getTime() < plan.dense30Until.getTime()) {
    return {
      phase: 'dense30',
      minutes: 30,
      shouldPersistPhase: plan.phase !== 'dense30',
    };
  }
  return {
    phase: 'normal',
    minutes: null,
    // Reaching here means the stored phase is still dense15/dense30 past dense30_until.
    shouldPersistPhase: true,
  };
}

export async function persistDenseCollectPhase(
  sql: Queryable,
  input: { targetId: string; phase: DenseCollectPhase; now: Date },
): Promise<void> {
  if (input.phase === 'normal') {
    await sql`
      UPDATE video_dense_collect_plans
      SET phase = 'normal',
          completed_at = COALESCE(completed_at, ${input.now}),
          updated_at = ${input.now}
      WHERE target_id = ${input.targetId}::uuid
        AND phase <> 'normal'
    `;
    return;
  }
  await sql`
    UPDATE video_dense_collect_plans
    SET phase = ${input.phase},
        updated_at = ${input.now}
    WHERE target_id = ${input.targetId}::uuid
      AND phase <> 'normal'
      AND phase IS DISTINCT FROM ${input.phase}
  `;
}

/** Find active video monitor target for a bvid, if any. */
export async function findActiveVideoTargetId(
  sql: Queryable,
  bvid: string,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    SELECT id::text AS id
    FROM monitor_targets
    WHERE "type" = 'video'
      AND external_id = ${bvid}
      AND deleted_at IS NULL
    LIMIT 1
  `;
  return rows[0]?.id ?? null;
}

export type CreatorUploadsSyncStateRow = {
  mid: string;
  lastSyncedAt: Date | null;
  lastError: string | null;
  lastVideoCount: number;
  lastEventsCreated: number;
  updatedAt: Date;
};

type UploadsSyncSqlRow = {
  mid: string;
  last_synced_at: Date | null;
  last_error: string | null;
  last_video_count: number;
  last_events_created: number;
  updated_at: Date;
};

function mapUploadsSync(row: UploadsSyncSqlRow): CreatorUploadsSyncStateRow {
  return {
    mid: row.mid,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    lastVideoCount: row.last_video_count,
    lastEventsCreated: row.last_events_created,
    updatedAt: row.updated_at,
  };
}

export async function getCreatorUploadsSyncState(
  sql: Queryable,
  mid: string,
): Promise<CreatorUploadsSyncStateRow | null> {
  const rows = await sql<UploadsSyncSqlRow[]>`
    SELECT
      mid, last_synced_at, last_error, last_video_count, last_events_created, updated_at
    FROM creator_uploads_sync_state
    WHERE mid = ${mid}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapUploadsSync(row) : null;
}

export async function upsertCreatorUploadsSyncState(
  sql: Queryable,
  input: {
    mid: string;
    lastSyncedAt: Date | null;
    lastError: string | null;
    lastVideoCount: number;
    lastEventsCreated: number;
    now: Date;
  },
): Promise<CreatorUploadsSyncStateRow> {
  const rows = await sql<UploadsSyncSqlRow[]>`
    INSERT INTO creator_uploads_sync_state (
      mid, last_synced_at, last_error, last_video_count, last_events_created, updated_at
    ) VALUES (
      ${input.mid},
      ${input.lastSyncedAt},
      ${input.lastError},
      ${input.lastVideoCount},
      ${input.lastEventsCreated},
      ${input.now}
    )
    ON CONFLICT (mid) DO UPDATE SET
      last_synced_at = EXCLUDED.last_synced_at,
      last_error = EXCLUDED.last_error,
      last_video_count = EXCLUDED.last_video_count,
      last_events_created = EXCLUDED.last_events_created,
      updated_at = EXCLUDED.updated_at
    RETURNING
      mid, last_synced_at, last_error, last_video_count, last_events_created, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('投稿同步状态写入后未能读回');
  return mapUploadsSync(row);
}

/**
 * Upsert archive-list metadata into videos without enabling monitoring.
 * Does not invent cid (space arc search has no cid).
 * When `coverUrl` is present, writes cover_url and marks cover_state/metadata_state ok.
 */
export async function upsertVideoArchiveMetadata(
  sql: Queryable,
  input: {
    bvid: string;
    title: string;
    mid: string;
    pubdate: Date;
    coverUrl?: string | null;
  },
): Promise<void> {
  const coverUrl = input.coverUrl?.trim() || null;
  const fetchedAt = coverUrl ? new Date() : null;
  await sql`
    INSERT INTO creators (mid)
    VALUES (${input.mid}::bigint)
    ON CONFLICT (mid) DO NOTHING
  `;
  await sql`
    INSERT INTO videos (
      bvid, title, mid, pubdate, monitoring_enabled,
      cover_url, cover_state, metadata_state, metadata_source, metadata_fetched_at
    )
    VALUES (
      ${input.bvid},
      ${input.title},
      ${input.mid}::bigint,
      ${input.pubdate},
      false,
      ${coverUrl},
      ${coverUrl ? 'ok' : 'pending'},
      ${coverUrl ? 'ok' : 'pending'},
      ${coverUrl ? 'bilibili' : null},
      ${fetchedAt}
    )
    ON CONFLICT (bvid) DO UPDATE SET
      title = COALESCE(NULLIF(EXCLUDED.title, ''), videos.title),
      mid = COALESCE(EXCLUDED.mid, videos.mid),
      pubdate = COALESCE(EXCLUDED.pubdate, videos.pubdate),
      cover_url = COALESCE(EXCLUDED.cover_url, videos.cover_url),
      cover_state = CASE
        WHEN EXCLUDED.cover_url IS NOT NULL THEN 'ok'
        ELSE videos.cover_state
      END,
      metadata_state = CASE
        WHEN EXCLUDED.cover_url IS NOT NULL AND videos.metadata_state IN ('pending', 'partial', 'failed')
          THEN 'ok'
        WHEN EXCLUDED.cover_url IS NOT NULL AND videos.metadata_state IS NULL
          THEN 'ok'
        ELSE videos.metadata_state
      END,
      metadata_source = CASE
        WHEN EXCLUDED.cover_url IS NOT NULL THEN COALESCE(videos.metadata_source, 'bilibili')
        ELSE videos.metadata_source
      END,
      metadata_fetched_at = CASE
        WHEN EXCLUDED.cover_url IS NOT NULL THEN COALESCE(videos.metadata_fetched_at, now())
        ELSE videos.metadata_fetched_at
      END,
      updated_at = now()
  `;
}

export type CreatorDynamicsSyncStateRow = {
  mid: string;
  lastSyncedAt: Date | null;
  lastError: string | null;
  lastDynamicCount: number;
  lastEventsCreated: number;
  updatedAt: Date;
};

type DynamicsSyncSqlRow = {
  mid: string;
  last_synced_at: Date | null;
  last_error: string | null;
  last_dynamic_count: number;
  last_events_created: number;
  updated_at: Date;
};

function mapDynamicsSync(row: DynamicsSyncSqlRow): CreatorDynamicsSyncStateRow {
  return {
    mid: row.mid,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    lastDynamicCount: row.last_dynamic_count,
    lastEventsCreated: row.last_events_created,
    updatedAt: row.updated_at,
  };
}

export async function getCreatorDynamicsSyncState(
  sql: Queryable,
  mid: string,
): Promise<CreatorDynamicsSyncStateRow | null> {
  const rows = await sql<DynamicsSyncSqlRow[]>`
    SELECT
      mid, last_synced_at, last_error, last_dynamic_count, last_events_created, updated_at
    FROM creator_dynamics_sync_state
    WHERE mid = ${mid}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapDynamicsSync(row) : null;
}

export async function upsertCreatorDynamicsSyncState(
  sql: Queryable,
  input: {
    mid: string;
    lastSyncedAt: Date | null;
    lastError: string | null;
    lastDynamicCount: number;
    lastEventsCreated: number;
    now: Date;
  },
): Promise<CreatorDynamicsSyncStateRow> {
  const rows = await sql<DynamicsSyncSqlRow[]>`
    INSERT INTO creator_dynamics_sync_state (
      mid, last_synced_at, last_error, last_dynamic_count, last_events_created, updated_at
    ) VALUES (
      ${input.mid},
      ${input.lastSyncedAt},
      ${input.lastError},
      ${input.lastDynamicCount},
      ${input.lastEventsCreated},
      ${input.now}
    )
    ON CONFLICT (mid) DO UPDATE SET
      last_synced_at = EXCLUDED.last_synced_at,
      last_error = EXCLUDED.last_error,
      last_dynamic_count = EXCLUDED.last_dynamic_count,
      last_events_created = EXCLUDED.last_events_created,
      updated_at = EXCLUDED.updated_at
    RETURNING
      mid, last_synced_at, last_error, last_dynamic_count, last_events_created, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('动态同步状态写入后未能读回');
  return mapDynamicsSync(row);
}

export type CreatorMediaBackfillStateRow = {
  mid: string;
  lastSyncedAt: Date | null;
  lastError: string | null;
  lastFaceUpdated: boolean;
  lastCoversUpdated: number;
  updatedAt: Date;
};

type MediaBackfillSqlRow = {
  mid: string;
  last_synced_at: Date | null;
  last_error: string | null;
  last_face_updated: boolean;
  last_covers_updated: number;
  updated_at: Date;
};

function mapMediaBackfill(row: MediaBackfillSqlRow): CreatorMediaBackfillStateRow {
  return {
    mid: row.mid,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    lastFaceUpdated: row.last_face_updated,
    lastCoversUpdated: row.last_covers_updated,
    updatedAt: row.updated_at,
  };
}

export async function getCreatorMediaBackfillState(
  sql: Queryable,
  mid: string,
): Promise<CreatorMediaBackfillStateRow | null> {
  const rows = await sql<MediaBackfillSqlRow[]>`
    SELECT
      mid, last_synced_at, last_error, last_face_updated, last_covers_updated, updated_at
    FROM creator_media_backfill_state
    WHERE mid = ${mid}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? mapMediaBackfill(row) : null;
}

export async function upsertCreatorMediaBackfillState(
  sql: Queryable,
  input: {
    mid: string;
    lastSyncedAt: Date | null;
    lastError: string | null;
    lastFaceUpdated: boolean;
    lastCoversUpdated: number;
    now: Date;
  },
): Promise<CreatorMediaBackfillStateRow> {
  const rows = await sql<MediaBackfillSqlRow[]>`
    INSERT INTO creator_media_backfill_state (
      mid, last_synced_at, last_error, last_face_updated, last_covers_updated, updated_at
    ) VALUES (
      ${input.mid},
      ${input.lastSyncedAt},
      ${input.lastError},
      ${input.lastFaceUpdated},
      ${input.lastCoversUpdated},
      ${input.now}
    )
    ON CONFLICT (mid) DO UPDATE SET
      last_synced_at = EXCLUDED.last_synced_at,
      last_error = EXCLUDED.last_error,
      last_face_updated = EXCLUDED.last_face_updated,
      last_covers_updated = EXCLUDED.last_covers_updated,
      updated_at = EXCLUDED.updated_at
    RETURNING
      mid, last_synced_at, last_error, last_face_updated, last_covers_updated, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('媒体回填状态写入后未能读回');
  return mapMediaBackfill(row);
}

/** Write creator face_url (+ optional uname) without downloading assets. */
export async function upsertCreatorFaceUrl(
  sql: Queryable,
  input: { mid: string; faceUrl: string | null; uname?: string | null },
): Promise<void> {
  const faceUrl = input.faceUrl?.trim() || null;
  const uname = input.uname?.trim() || null;
  const fetchedAt = faceUrl ? new Date() : null;
  await sql`
    INSERT INTO creators (mid, uname, face_url, metadata_state, metadata_source, metadata_fetched_at)
    VALUES (
      ${input.mid}::bigint,
      ${uname},
      ${faceUrl},
      ${faceUrl ? 'ok' : 'pending'},
      ${faceUrl ? 'bilibili' : null},
      ${fetchedAt}
    )
    ON CONFLICT (mid) DO UPDATE SET
      uname = COALESCE(EXCLUDED.uname, creators.uname),
      face_url = COALESCE(EXCLUDED.face_url, creators.face_url),
      metadata_state = CASE
        WHEN EXCLUDED.face_url IS NOT NULL THEN 'ok'
        ELSE creators.metadata_state
      END,
      metadata_source = CASE
        WHEN EXCLUDED.face_url IS NOT NULL THEN COALESCE(creators.metadata_source, 'bilibili')
        ELSE creators.metadata_source
      END,
      metadata_fetched_at = CASE
        WHEN EXCLUDED.face_url IS NOT NULL THEN now()
        ELSE creators.metadata_fetched_at
      END,
      updated_at = now()
  `;
}
