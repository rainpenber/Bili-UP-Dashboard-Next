import type { Sql } from '@studio/db';
import {
  BackfillConflict,
  hasActiveVideoMetadataRefresh,
  scrubMetadataError,
  startMetadataBackfill,
  type MetadataRefreshDeps,
} from './metadata-refresh';

/** Marker in videos.metadata when auto refresh is waiting for a free backfill slot. */
export const AUTO_METADATA_REFRESH_KEY = 'auto_metadata_refresh';
export const AUTO_METADATA_REFRESH_QUEUED = 'queued';

export type AutoMetadataRefreshDeps = MetadataRefreshDeps & {
  onBackfill?: (task: Promise<void>) => void;
};

export type AutoMetadataEnqueueResult =
  | { status: 'started'; backfillRunId: string; done: Promise<void> }
  | { status: 'skipped'; reason: 'has_cover' | 'active' | 'not_needed' | 'no_assets' }
  | { status: 'deferred'; reason: 'backfill_busy' }
  | { status: 'error'; error: string };

function jsonMerge(sql: Sql, value: Record<string, unknown>) {
  return sql.json(JSON.parse(JSON.stringify(value)));
}

async function clearAutoQueued(sql: Sql, bvid: string): Promise<void> {
  await sql`
    UPDATE videos
    SET metadata = COALESCE(metadata, '{}'::jsonb) - ${AUTO_METADATA_REFRESH_KEY},
        updated_at = now()
    WHERE bvid = ${bvid}
  `;
}

async function markAutoQueued(sql: Sql, bvid: string): Promise<void> {
  await sql`
    UPDATE videos
    SET metadata = COALESCE(metadata, '{}'::jsonb) || ${jsonMerge(sql, {
      [AUTO_METADATA_REFRESH_KEY]: AUTO_METADATA_REFRESH_QUEUED,
    })},
        updated_at = now()
    WHERE bvid = ${bvid}
      AND cover_asset_id IS NULL
  `;
}

/**
 * After a video target's first successful metric collect, enqueue the existing
 * single-id metadata refresh when cover/metadata is still incomplete.
 * Never throws into the collector success path; failures are returned.
 */
export async function enqueueAutoVideoMetadataRefresh(
  deps: AutoMetadataRefreshDeps,
  bvid: string,
): Promise<AutoMetadataEnqueueResult> {
  if (!deps.assetsRoot || !deps.download) {
    return { status: 'skipped', reason: 'no_assets' };
  }

  try {
    const gate = await deps.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${`auto-meta-video:${bvid}`}))`;
      const rows = await tx<{ cover_asset_id: string | null }[]>`
        SELECT cover_asset_id FROM videos WHERE bvid = ${bvid}
      `;
      const row = rows[0];
      if (!row) return { action: 'skip' as const, reason: 'not_needed' as const };
      // Has cover → never re-queue / re-download (invariant 1).
      if (row.cover_asset_id) return { action: 'skip' as const, reason: 'has_cover' as const };
      // Trigger: cover_asset_id IS NULL (first collect leaves metadata_state pending).
      return { action: 'proceed' as const };
    });

    if (gate.action === 'skip') {
      await clearAutoQueued(deps.sql, bvid).catch(() => undefined);
      return { status: 'skipped', reason: gate.reason };
    }

    if (await hasActiveVideoMetadataRefresh(deps.sql, bvid)) {
      return { status: 'skipped', reason: 'active' };
    }

    try {
      // force: cover may still be null after a prior partial refresh (metadata ok, cover failed).
      const started = await startMetadataBackfill(deps, {
        kind: 'video',
        ids: [bvid],
        auto: true,
        force: true,
      });
      await clearAutoQueued(deps.sql, bvid).catch(() => undefined);
      deps.onBackfill?.(started.done);
      void started.done.catch(() => undefined);
      deps.logger?.info('首次采集后已自动入队元数据补全', {
        event: 'metadata.auto_enqueued',
        runId: started.backfillRunId,
        context: { bvid },
      });
      await deps.logger?.flush();
      return {
        status: 'started',
        backfillRunId: started.backfillRunId,
        done: started.done,
      };
    } catch (error) {
      if (error instanceof BackfillConflict) {
        await markAutoQueued(deps.sql, bvid);
        deps.logger?.info('元数据批次繁忙，已推迟自动补全', {
          event: 'metadata.auto_deferred',
          context: { bvid, backfillRunId: error.backfillRunId },
        });
        await deps.logger?.flush();
        return { status: 'deferred', reason: 'backfill_busy' };
      }
      throw error;
    }
  } catch (error) {
    const message = scrubMetadataError(error);
    deps.logger?.warn('自动元数据入队失败', {
      event: 'metadata.auto_enqueue_failed',
      context: { bvid, error: message },
    });
    await deps.logger?.flush();
    return { status: 'error', error: message };
  }
}

/**
 * Start at most `limit` deferred auto refreshes (videos marked queued after a busy backfill).
 * Does not scan all incomplete historical videos — only the explicit queue marker.
 */
export async function drainDeferredAutoVideoMetadataRefresh(
  deps: AutoMetadataRefreshDeps,
  limit = 1,
): Promise<number> {
  if (!deps.assetsRoot || !deps.download || limit <= 0) return 0;
  // Fixed JSON key (AUTO_METADATA_REFRESH_KEY); do not interpolate column names.
  const queued = await deps.sql<{ bvid: string }[]>`
    SELECT bvid
    FROM videos
    WHERE cover_asset_id IS NULL
      AND metadata->>'auto_metadata_refresh' = ${AUTO_METADATA_REFRESH_QUEUED}
    ORDER BY updated_at ASC, bvid
    LIMIT ${limit}
  `;
  let started = 0;
  for (const row of queued) {
    const result = await enqueueAutoVideoMetadataRefresh(deps, row.bvid);
    if (result.status === 'started') started += 1;
    if (result.status === 'deferred') break;
  }
  return started;
}
