import type { Sql } from '@studio/db';

/** Serialize import runs; must be taken on the same connection as the import transaction. */
export const IMPORT_RUN_LOCK_KEY = 915_002;

export async function countHeldImportAdvisoryLocks(sql: Sql): Promise<number> {
  const rows = await sql<{ c: string }[]>`
    SELECT count(*)::text AS c
    FROM pg_locks
    WHERE locktype = 'advisory'
      AND classid = 0
      AND objid = ${IMPORT_RUN_LOCK_KEY}
  `;
  return Number(rows[0]?.c ?? 0);
}
