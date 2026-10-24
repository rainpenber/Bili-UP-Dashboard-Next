import type { Sql } from './client';

/** Default personal Bilibili UID (狐正正). Decimal string — never coerce with Number. */
export const DEFAULT_STUDIO_OWNER_MID = '3493141386627335';
export const DEFAULT_STUDIO_OWNER_DISPLAY_NAME = '狐正正';

export type StudioOwnerAccountRow = {
  mid: string;
  displayName: string;
  updatedAt: Date;
};

type SqlOwnerRow = {
  mid: string;
  display_name: string;
  updated_at: Date;
};

function mapRow(row: SqlOwnerRow): StudioOwnerAccountRow {
  return {
    mid: row.mid,
    displayName: row.display_name,
    updatedAt: row.updated_at,
  };
}

/** Read the singleton owner account. Null only if the row was deleted outside migrations. */
export async function getStudioOwnerAccount(sql: Sql): Promise<StudioOwnerAccountRow | null> {
  const rows = await sql<SqlOwnerRow[]>`
    SELECT mid::text AS mid, display_name, updated_at
    FROM studio_owner_account
    WHERE id = 1
  `;
  const row = rows[0];
  return row ? mapRow(row) : null;
}

/**
 * Replace the singleton owner mid + display name.
 * mid must already be a validated decimal string (no Number coercion).
 */
export async function updateStudioOwnerAccount(
  sql: Sql,
  input: { mid: string; displayName: string },
): Promise<StudioOwnerAccountRow> {
  const rows = await sql<SqlOwnerRow[]>`
    INSERT INTO studio_owner_account (id, mid, display_name, updated_at)
    VALUES (1, ${input.mid}::bigint, ${input.displayName}, now())
    ON CONFLICT (id) DO UPDATE SET
      mid = EXCLUDED.mid,
      display_name = EXCLUDED.display_name,
      updated_at = now()
    RETURNING mid::text AS mid, display_name, updated_at
  `;
  const row = rows[0];
  if (!row) throw new Error('studio_owner_account upsert failed');
  return mapRow(row);
}
