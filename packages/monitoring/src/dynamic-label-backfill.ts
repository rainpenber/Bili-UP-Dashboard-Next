import type { Sql } from '@studio/db';
import { formatDynamicTargetLabel } from './dynamic-target-label';

/**
 * One-shot: rewrite dynamic targets whose label exactly equals the UP uname
 * (legacy discovery naming). Custom labels are left alone.
 */
export async function backfillDynamicTargetLabels(sql: Sql): Promise<{ updated: number }> {
  const rows = await sql<
    {
      id: string;
      external_id: string;
      label: string;
      uname: string | null;
      title_snapshot: string | null;
      text: string | null;
    }[]
  >`
    SELECT
      t.id::text AS id,
      t.external_id,
      t.label,
      c.uname,
      e.title_snapshot,
      d.metadata->>'text' AS text
    FROM monitor_targets t
    LEFT JOIN dynamics d ON d.dynamic_id = t.external_id
    LEFT JOIN creators c ON c.mid = d.mid
    LEFT JOIN LATERAL (
      SELECT title_snapshot
      FROM creator_publish_events pe
      WHERE pe.event_kind = 'dynamic'
        AND pe.external_id = t.external_id
      ORDER BY pe.first_discovered_at DESC
      LIMIT 1
    ) e ON TRUE
    WHERE t.type = 'dynamic'
      AND t.deleted_at IS NULL
      AND c.uname IS NOT NULL
      AND t.label = c.uname
  `;

  let updated = 0;
  for (const row of rows) {
    const source = row.title_snapshot?.trim() || row.text?.trim() || null;
    const next = formatDynamicTargetLabel({
      text: source,
      dynamicId: row.external_id,
    });
    if (next === row.label) continue;
    const touched = await sql<{ id: string }[]>`
      UPDATE monitor_targets
      SET label = ${next}, updated_at = now()
      WHERE id = ${row.id}::uuid
        AND deleted_at IS NULL
        AND label = ${row.label}
      RETURNING id::text AS id
    `;
    if (touched[0]) updated += 1;
  }
  return { updated };
}
