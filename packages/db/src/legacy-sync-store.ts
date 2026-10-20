import type postgres from 'postgres';
import type { Sql } from './client';

type Queryable = postgres.Sql | postgres.TransactionSql;
type ReservedSql = Sql & { release(): void };

/** Session lock for one legacy CSV sync process. Distinct from import and migration locks. */
export const LEGACY_SYNC_LOCK_KEY = 915_010;

export type LegacyCheckpoint = {
  relativePath: string;
  fileKind: 'video' | 'follower';
  entityKey: string;
  byteOffset: number;
  prefixSha256: string;
  boundarySha256: string;
  boundaryLength: number;
  headerLine: string;
};

export type LegacySyncRoundRow = {
  status: 'succeeded' | 'failed';
  startedAt: Date;
  finishedAt: Date;
  durationMs: number;
  inserted: number;
  conflicts: number;
  rejected: number;
  filesSeen: number;
  filesSkipped: number;
  filesFailed: number;
  error: string | null;
  report: Record<string, unknown>;
};

export type LegacySyncStatus = {
  status: 'never' | 'succeeded' | 'failed';
  inserted: number;
  conflicts: number;
  rejected: number;
  durationMs: number | null;
  lastSuccessAt: string | null;
  filesSeen: number;
  filesSkipped: number;
  filesFailed: number;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type CheckpointRow = {
  relative_path: string;
  file_kind: 'video' | 'follower';
  entity_key: string;
  byte_offset: string | number;
  prefix_sha256: string;
  boundary_sha256: string;
  boundary_length: number;
  header_line: string;
};

function asOffset(value: string | number): number {
  const offset = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('检查点偏移无效');
  return offset;
}

function mapCheckpoint(row: CheckpointRow): LegacyCheckpoint {
  return {
    relativePath: row.relative_path,
    fileKind: row.file_kind,
    entityKey: row.entity_key,
    byteOffset: asOffset(row.byte_offset),
    prefixSha256: row.prefix_sha256,
    boundarySha256: row.boundary_sha256,
    boundaryLength: row.boundary_length,
    headerLine: row.header_line,
  };
}

export async function legacySyncSchemaReady(sql: Queryable): Promise<boolean> {
  const rows = await sql<{ ready: boolean }[]>`
    SELECT (
      to_regclass('public.legacy_csv_sync_checkpoints') IS NOT NULL
      AND to_regclass('public.legacy_csv_sync_rounds') IS NOT NULL
    ) AS ready
  `;
  return rows[0]?.ready === true;
}

export async function acquireLegacySyncLock(
  sql: Sql,
): Promise<{ release(): Promise<void> } | null> {
  const reserved = await (sql as Sql & { reserve(): Promise<ReservedSql> }).reserve();
  let locked = false;
  try {
    const rows = await reserved<{ locked: boolean }[]>`
      SELECT pg_try_advisory_lock(${LEGACY_SYNC_LOCK_KEY}::bigint) AS locked
    `;
    locked = rows[0]?.locked === true;
    if (!locked) {
      reserved.release();
      return null;
    }
    return {
      async release() {
        try {
          await reserved`SELECT pg_advisory_unlock(${LEGACY_SYNC_LOCK_KEY}::bigint)`;
        } finally {
          reserved.release();
        }
      },
    };
  } catch (error) {
    if (locked) {
      await reserved`SELECT pg_advisory_unlock(${LEGACY_SYNC_LOCK_KEY}::bigint)`.catch(
        () => undefined,
      );
    }
    reserved.release();
    throw error;
  }
}

export async function countLegacySyncLocks(sql: Queryable): Promise<number> {
  const rows = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n
    FROM pg_locks
    WHERE locktype = 'advisory'
      AND classid = 0
      AND objid = ${LEGACY_SYNC_LOCK_KEY}
      AND granted
  `;
  return rows[0]?.n ?? 0;
}

export async function readLegacyCheckpoint(
  sql: Queryable,
  relativePath: string,
): Promise<LegacyCheckpoint | null> {
  const rows = await sql<CheckpointRow[]>`
    SELECT relative_path, file_kind, entity_key, byte_offset, prefix_sha256,
      boundary_sha256, boundary_length, header_line
    FROM legacy_csv_sync_checkpoints
    WHERE relative_path = ${relativePath}
  `;
  const row = rows[0];
  return row ? mapCheckpoint(row) : null;
}

export async function listLegacyCheckpoints(sql: Queryable): Promise<LegacyCheckpoint[]> {
  const rows = await sql<CheckpointRow[]>`
    SELECT relative_path, file_kind, entity_key, byte_offset, prefix_sha256,
      boundary_sha256, boundary_length, header_line
    FROM legacy_csv_sync_checkpoints
    ORDER BY relative_path
  `;
  return rows.map(mapCheckpoint);
}

export async function writeLegacyCheckpoint(tx: Queryable, row: LegacyCheckpoint): Promise<void> {
  await tx`
    INSERT INTO legacy_csv_sync_checkpoints (
      relative_path, file_kind, entity_key, byte_offset, prefix_sha256,
      boundary_sha256, boundary_length, header_line, updated_at
    ) VALUES (
      ${row.relativePath},
      ${row.fileKind},
      ${row.entityKey},
      ${row.byteOffset},
      ${row.prefixSha256},
      ${row.boundarySha256},
      ${row.boundaryLength},
      ${row.headerLine},
      statement_timestamp()
    )
    ON CONFLICT (relative_path) DO UPDATE SET
      file_kind = EXCLUDED.file_kind,
      entity_key = EXCLUDED.entity_key,
      byte_offset = EXCLUDED.byte_offset,
      prefix_sha256 = EXCLUDED.prefix_sha256,
      boundary_sha256 = EXCLUDED.boundary_sha256,
      boundary_length = EXCLUDED.boundary_length,
      header_line = EXCLUDED.header_line,
      updated_at = statement_timestamp()
  `;
}

async function countTimestamps(
  load: (slice: string[]) => Promise<{ n: number }[]>,
  sampledAt: readonly Date[],
): Promise<number> {
  if (sampledAt.length === 0) return 0;
  let total = 0;
  for (let index = 0; index < sampledAt.length; index += 2000) {
    const slice = sampledAt.slice(index, index + 2000).map((value) => value.toISOString());
    const rows = await load(slice);
    total += rows[0]?.n ?? 0;
  }
  return total;
}

export async function countExistingVideoSamples(
  sql: Queryable,
  bvid: string,
  sampledAt: readonly Date[],
): Promise<number> {
  return countTimestamps(
    (slice) => sql<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM video_metric_samples
      WHERE bvid = ${bvid}
        AND sampled_at = ANY(${slice}::timestamptz[])
    `,
    sampledAt,
  );
}

export async function countExistingFollowerSamples(
  sql: Queryable,
  mid: string,
  sampledAt: readonly Date[],
): Promise<number> {
  return countTimestamps(
    (slice) => sql<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM creator_follower_samples
      WHERE mid = ${mid}::bigint
        AND sampled_at = ANY(${slice}::timestamptz[])
    `,
    sampledAt,
  );
}

export async function insertLegacySyncRound(
  sql: Queryable,
  input: LegacySyncRoundRow & { id: string },
): Promise<void> {
  const error = input.error === null ? null : input.error.slice(0, 2000);
  await sql`
    INSERT INTO legacy_csv_sync_rounds (
      id, status, started_at, finished_at, duration_ms, inserted, conflicts, rejected,
      files_seen, files_skipped, files_failed, error_message, report_json
    ) VALUES (
      ${input.id}::uuid,
      ${input.status},
      ${input.startedAt},
      ${input.finishedAt},
      ${input.durationMs},
      ${input.inserted},
      ${input.conflicts},
      ${input.rejected},
      ${input.filesSeen},
      ${input.filesSkipped},
      ${input.filesFailed},
      ${error},
      ${sql.json(JSON.parse(JSON.stringify(input.report)) as postgres.JSONValue)}
    )
  `;
}

export async function readLegacySyncStatus(sql: Queryable): Promise<LegacySyncStatus> {
  const latest = await sql<
    {
      status: 'succeeded' | 'failed';
      inserted: number;
      conflicts: number;
      rejected: number;
      duration_ms: number | null;
      files_seen: number;
      files_skipped: number;
      files_failed: number;
      error_message: string | null;
      started_at: Date;
      finished_at: Date | null;
    }[]
  >`
    SELECT status, inserted, conflicts, rejected, duration_ms, files_seen, files_skipped,
      files_failed, error_message, started_at, finished_at
    FROM legacy_csv_sync_rounds
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `;
  const success = await sql<{ finished_at: Date | null }[]>`
    SELECT finished_at
    FROM legacy_csv_sync_rounds
    WHERE status = 'succeeded' AND finished_at IS NOT NULL
    ORDER BY finished_at DESC
    LIMIT 1
  `;
  const lastSuccessAt = success[0]?.finished_at ? success[0].finished_at.toISOString() : null;
  const row = latest[0];
  if (!row) {
    return {
      status: 'never',
      inserted: 0,
      conflicts: 0,
      rejected: 0,
      durationMs: null,
      lastSuccessAt,
      filesSeen: 0,
      filesSkipped: 0,
      filesFailed: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
  }
  return {
    status: row.status,
    inserted: row.inserted,
    conflicts: row.conflicts,
    rejected: row.rejected,
    durationMs: row.duration_ms,
    lastSuccessAt,
    filesSeen: row.files_seen,
    filesSkipped: row.files_skipped,
    filesFailed: row.files_failed,
    error: row.error_message,
    startedAt: row.started_at.toISOString(),
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}
