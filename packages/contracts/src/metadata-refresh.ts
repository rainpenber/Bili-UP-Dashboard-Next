export const METADATA_STATES = ['pending', 'ok', 'failed', 'partial'] as const;
export const COVER_STATES = ['pending', 'ok', 'failed', 'none'] as const;
export const BACKFILL_STATUSES = ['running', 'succeeded', 'failed', 'aborted'] as const;

export type MetadataStateName = (typeof METADATA_STATES)[number];
export type CoverStateName = (typeof COVER_STATES)[number];
export type BackfillStatusName = (typeof BACKFILL_STATUSES)[number];

export type VideoRefreshResponse = {
  bvid: string;
  cid: string | null;
  title: string | null;
  tags: string[];
  metadataState: MetadataStateName;
  coverState: CoverStateName;
};

export type MetadataRunResponse = {
  id: string;
  status: BackfillStatusName;
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  report: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value === 'string' && (allowed as readonly string[]).includes(value))
    return value as T;
  throw new Error(`invalid ${label}`);
}

function count(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`invalid ${label}`);
  }
  return value;
}

export function parseVideoRefreshResponse(value: unknown): VideoRefreshResponse {
  const row = asRecord(value);
  if (!row || typeof row.bvid !== 'string') throw new Error('invalid video refresh');
  if (row.cid !== null && typeof row.cid !== 'string') throw new Error('invalid cid');
  if (row.title !== null && typeof row.title !== 'string') throw new Error('invalid title');
  if (!Array.isArray(row.tags) || row.tags.some((tag) => typeof tag !== 'string')) {
    throw new Error('invalid tags');
  }
  return {
    bvid: row.bvid,
    cid: row.cid,
    title: row.title,
    tags: row.tags,
    metadataState: oneOf(row.metadataState, METADATA_STATES, 'metadataState'),
    coverState: oneOf(row.coverState, COVER_STATES, 'coverState'),
  };
}

export function parseMetadataRunResponse(value: unknown): MetadataRunResponse {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string') throw new Error('invalid metadata run');
  const report = asRecord(row.report);
  if (!report) throw new Error('invalid report');
  return {
    id: row.id,
    status: oneOf(row.status, BACKFILL_STATUSES, 'status'),
    requested: count(row.requested, 'requested'),
    succeeded: count(row.succeeded, 'succeeded'),
    failed: count(row.failed, 'failed'),
    skipped: count(row.skipped, 'skipped'),
    report,
  };
}
