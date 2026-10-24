import type { Sql } from './client';

/** Embedded in durable job.error / target.last_error for first-collect inaccessible waits. */
export const FIRST_ACCESS_WAITING_MARKER = '[first_access_waiting]';
export const FIRST_ACCESS_AWAITING_MANUAL_MARKER = '[first_access_awaiting_manual]';

export const FIRST_ACCESS_RETRY_MINUTES = 5;
export const FIRST_ACCESS_MAX_ATTEMPTS = 3;

export type FirstAccessInterventionStatus = 'waiting_confirmation' | 'awaiting_manual';

export type FirstAccessInterventionRow = {
  id: string;
  targetId: string;
  bvid: string;
  status: FirstAccessInterventionStatus;
  failureCount: number;
  reason: string;
  failedAt: Date;
};

export function isFirstAccessAwaitingManualError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.includes(FIRST_ACCESS_AWAITING_MANUAL_MARKER);
}

export function isFirstAccessWaitingError(error: string | null | undefined): boolean {
  return typeof error === 'string' && error.includes(FIRST_ACCESS_WAITING_MARKER);
}

export function parseFirstAccessFailureCount(error: string | null | undefined): number | null {
  if (!error) return null;
  const match = error.match(/失败\s+(\d+)\s*\/\s*(\d+)\s*次/);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Durable first-access wait / manual-intervention facts derived from target+job state.
 * Current round: the newest matching job by time (pending waiting beats an older
 * awaiting_manual failed job after manual-run). Pure read — no writes.
 */
export async function listFirstAccessInterventions(
  sql: Sql,
): Promise<FirstAccessInterventionRow[]> {
  const waitingLike = `%${FIRST_ACCESS_WAITING_MARKER}%`;
  const manualLike = `%${FIRST_ACCESS_AWAITING_MANUAL_MARKER}%`;
  const rows = await sql<
    {
      id: string;
      target_id: string;
      bvid: string;
      status: FirstAccessInterventionStatus;
      failure_count: number;
      reason: string;
      failed_at: Date;
    }[]
  >`
    SELECT
      j.id::text AS id,
      t.id::text AS target_id,
      t.external_id AS bvid,
      CASE
        WHEN j.status = 'failed'
          AND j.error LIKE ${manualLike}
          THEN 'awaiting_manual'::text
        ELSE 'waiting_confirmation'::text
      END AS status,
      COALESCE(
        NULLIF(
          substring(COALESCE(j.error, t.last_error, '') from '失败\\s+(\\d+)\\s*/\\s*\\d+\\s*次'),
          ''
        )::int,
        j.attempts
      ) AS failure_count,
      COALESCE(j.error, t.last_error, '') AS reason,
      COALESCE(j.finished_at, j.updated_at, t.updated_at) AS failed_at
    FROM monitor_targets t
    JOIN LATERAL (
      SELECT j2.*
      FROM collector_jobs j2
      WHERE j2.target_id = t.id
        AND (
          (j2.status = 'pending' AND j2.error LIKE ${waitingLike})
          OR (j2.status = 'failed' AND j2.error LIKE ${manualLike})
        )
      ORDER BY
        COALESCE(j2.updated_at, j2.finished_at, j2.created_at) DESC,
        j2.created_at DESC,
        j2.id DESC
      LIMIT 1
    ) j ON TRUE
    WHERE t.deleted_at IS NULL
      AND t.type = 'video'
      AND t.last_success_at IS NULL
      AND (
        t.last_error LIKE ${waitingLike}
        OR t.last_error LIKE ${manualLike}
        OR j.error LIKE ${waitingLike}
        OR j.error LIKE ${manualLike}
      )
    ORDER BY COALESCE(j.updated_at, j.finished_at, j.created_at) DESC, t.id ASC
  `;
  return rows.map((row) => ({
    id: row.id,
    targetId: row.target_id,
    bvid: row.bvid,
    status: row.status,
    failureCount: row.failure_count,
    reason: row.reason,
    failedAt: row.failed_at,
  }));
}
