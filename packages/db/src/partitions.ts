import type postgres from 'postgres';
import type { Sql } from './client';

type Queryable = postgres.Sql | postgres.TransactionSql;

const PLACEHOLDER_NAMES = new Set(['未知', '其他', '其它']);

export const PARTITION_SOURCES = ['bilibili', 'import', 'manual', 'unknown'] as const;
export type PartitionSource = (typeof PARTITION_SOURCES)[number];

export const VIDEO_PARTITION_JOINS = `
LEFT JOIN bili_partitions partition_by_v2 ON partition_by_v2.tid = v.tid_v2
LEFT JOIN bili_partitions partition_by_tid ON partition_by_tid.tid = v.tid
`;

/** Prefer the stored name, then the tid_v2 dictionary row, then tid. Blank stays null. */
export const VIDEO_PARTITION_NAME_SQL = `
COALESCE(
  NULLIF(btrim(v.partition_name), ''),
  NULLIF(btrim(partition_by_v2.name), ''),
  NULLIF(btrim(partition_by_tid.name), '')
)
`;

export function realPartitionName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || PLACEHOLDER_NAMES.has(trimmed)) return null;
  return trimmed;
}

export function partitionNameFromLabels(tnameV2: unknown, tname: unknown): string | null {
  return realPartitionName(tnameV2) ?? realPartitionName(tname);
}

export type PartitionSeedRow = {
  tid: number;
  parentTid: number | null;
  name: string | null;
  source: PartitionSource;
};

function asTid(value: unknown, label: string): number {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  throw new Error(`${label} 不是整数 tid`);
}

function asSource(value: unknown): PartitionSource {
  if (value === undefined || value === null || value === '') return 'manual';
  if (typeof value === 'string' && (PARTITION_SOURCES as readonly string[]).includes(value)) {
    return value as PartitionSource;
  }
  throw new Error('分区来源必须是 bilibili、import、manual 或 unknown');
}

export function parsePartitionSeed(value: unknown): PartitionSeedRow[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === 'object' &&
        value !== null &&
        Array.isArray((value as { partitions?: unknown }).partitions)
      ? (value as { partitions: unknown[] }).partitions
      : null;
  if (!list) throw new Error('分区文件必须是数组，或 { partitions: [] }');
  return list.map((item, index) => {
    if (typeof item !== 'object' || item === null) throw new Error(`第 ${index + 1} 行不是对象`);
    const row = item as Record<string, unknown>;
    const parent = row.parentTid ?? row.parent_tid;
    return {
      tid: asTid(row.tid, `第 ${index + 1} 行 tid`),
      parentTid:
        parent === undefined || parent === null
          ? null
          : asTid(parent, `第 ${index + 1} 行 parentTid`),
      name: realPartitionName(row.name),
      source: asSource(row.source),
    };
  });
}

export async function seedPartitions(
  sql: Queryable,
  rows: readonly PartitionSeedRow[],
): Promise<number> {
  let written = 0;
  for (const row of rows) {
    await sql`
      INSERT INTO bili_partitions (tid, parent_tid, name, source)
      VALUES (${row.tid}, ${row.parentTid}, ${row.name}, ${row.source})
      ON CONFLICT (tid) DO UPDATE SET
        parent_tid = EXCLUDED.parent_tid,
        name = EXCLUDED.name,
        source = EXCLUDED.source,
        updated_at = now()
    `;
    written += 1;
  }
  return written;
}

export async function seedPartitionsFromJson(sql: Sql, raw: string): Promise<number> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error('分区文件不是 JSON');
  }
  return seedPartitions(sql, parsePartitionSeed(parsed));
}
