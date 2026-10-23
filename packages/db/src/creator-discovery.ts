import type postgres from 'postgres';
import type { Sql } from './client';
import { effectiveFirstRunAt, type MonitorTargetRow } from './monitor-targets';

type Queryable = postgres.Sql | postgres.TransactionSql;

function pgTextArray(values: readonly string[]): string {
  if (values.length === 0) return '{}';
  return `{${values.map((value) => `"${value}"`).join(',')}}`;
}

export type DenseCollectPhase = 'dense15' | 'dense30' | 'normal';

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
  createdAt: Date;
  updatedAt: Date;
};

export type CreatorPublishEventKind = 'video' | 'dynamic';

export type CreatorPublishEventRow = {
  id: string;
  mid: string;
  eventKind: CreatorPublishEventKind;
  externalId: string;
  publishedAt: Date;
  titleSnapshot: string;
  firstDiscoveredAt: Date;
  source: 'bilibili';
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
  created_at: Date;
  updated_at: Date;
};

type EventSqlRow = {
  id: string;
  mid: string;
  event_kind: CreatorPublishEventKind;
  external_id: string;
  published_at: Date;
  title_snapshot: string;
  first_discovered_at: Date;
  source: 'bilibili';
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
  },
): Promise<void> {
  const suppress = input.suppressedAutoCreateDelta ?? 0;
  if (!input.success) {
    // Failure: keep watermarks / last success; record error only (no fake events).
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
  },
): Promise<{ event: CreatorPublishEventRow; created: boolean }> {
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
      'bilibili',
      ${input.monitoredTargetId ?? null}
    )
    ON CONFLICT (event_kind, external_id) DO NOTHING
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
    WHERE event_kind = ${input.eventKind}
      AND external_id = ${input.externalId}
  `;
  const row = existing[0];
  if (!row) throw new Error('发布事件冲突后未能读回');
  return { event: mapEvent(row), created: false };
}

export async function linkPublishEventTarget(
  sql: Queryable,
  input: { eventKind: CreatorPublishEventKind; externalId: string; targetId: string },
): Promise<void> {
  await sql`
    UPDATE creator_publish_events
    SET monitored_target_id = ${input.targetId}::uuid
    WHERE event_kind = ${input.eventKind}
      AND external_id = ${input.externalId}
      AND monitored_target_id IS NULL
  `;
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
