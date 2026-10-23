import type { Sql } from './client';

export type MonitorSearchSuggestionKind = 'video' | 'creator' | 'category';

export type MonitorSearchSuggestionRow = {
  kind: MonitorSearchSuggestionKind;
  label: string;
  secondary: string | null;
  value: string;
};

export type MonitorSearchSuggestionsResult = {
  videos: MonitorSearchSuggestionRow[];
  creators: MonitorSearchSuggestionRow[];
  categories: MonitorSearchSuggestionRow[];
};

function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

/**
 * Search suggestions across the full monitor corpus (not the current page).
 * Escapes LIKE metacharacters; never concatenates SQL from user input.
 * Each group is capped by `limit` (caller should pass ≤5).
 */
export async function listMonitorSearchSuggestions(
  sql: Sql,
  input: { q: string; type: 'video' | 'creator'; limit: number },
): Promise<MonitorSearchSuggestionsResult> {
  const q = input.q.trim();
  const limit = Math.max(1, Math.min(5, Math.floor(input.limit)));
  if (q === '') {
    return { videos: [], creators: [], categories: [] };
  }
  const pattern = likePattern(q);

  if (input.type === 'creator') {
    const creators = await sql<
      { mid: string; uname: string | null; target_label: string | null }[]
    >`
      SELECT
        COALESCE(e.mid, t.external_id)::text AS mid,
        e.uname,
        t.label AS target_label
      FROM (
        SELECT c.mid::text AS mid, c.uname
        FROM creators c
        WHERE c.deleted_at IS NULL
      ) e
      FULL OUTER JOIN (
        SELECT external_id, label
        FROM monitor_targets
        WHERE "type" = 'creator' AND deleted_at IS NULL
      ) t ON t.external_id = e.mid
      WHERE COALESCE(e.mid, t.external_id) IS NOT NULL
        AND (
          COALESCE(e.mid, t.external_id) = ${q}
          OR COALESCE(e.uname, '') ILIKE ${pattern} ESCAPE '\\'
          OR COALESCE(t.label, '') ILIKE ${pattern} ESCAPE '\\'
        )
      ORDER BY
        CASE
          WHEN COALESCE(e.mid, t.external_id) = ${q} THEN 0
          WHEN lower(COALESCE(e.uname, '')) = lower(${q}) THEN 1
          ELSE 2
        END,
        COALESCE(e.uname, t.label, e.mid, t.external_id) ASC
      LIMIT ${limit}
    `;
    return {
      videos: [],
      creators: creators.map((row) => {
        const mid = row.mid;
        const label = (row.uname?.trim() || row.target_label?.trim() || mid).trim();
        return {
          kind: 'creator' as const,
          label,
          secondary: mid === label ? null : mid,
          value: mid,
        };
      }),
      categories: [],
    };
  }

  const [videos, creators, categories] = await Promise.all([
    sql<
      {
        bvid: string;
        title: string | null;
        target_label: string | null;
        creator_name: string | null;
      }[]
    >`
      SELECT
        COALESCE(e.bvid, t.external_id) AS bvid,
        e.title,
        t.label AS target_label,
        e.creator_name
      FROM (
        SELECT
          v.bvid,
          v.title,
          cr.uname AS creator_name
        FROM videos v
        LEFT JOIN creators cr ON cr.mid = v.mid AND cr.deleted_at IS NULL
        WHERE v.deleted_at IS NULL
      ) e
      FULL OUTER JOIN (
        SELECT external_id, label
        FROM monitor_targets
        WHERE "type" = 'video' AND deleted_at IS NULL
      ) t ON t.external_id = e.bvid
      WHERE COALESCE(e.bvid, t.external_id) IS NOT NULL
        AND (
          COALESCE(e.bvid, t.external_id) = ${q}
          OR COALESCE(e.title, '') ILIKE ${pattern} ESCAPE '\\'
          OR COALESCE(t.label, '') ILIKE ${pattern} ESCAPE '\\'
          OR COALESCE(e.creator_name, '') ILIKE ${pattern} ESCAPE '\\'
        )
      ORDER BY
        CASE
          WHEN COALESCE(e.bvid, t.external_id) = ${q} THEN 0
          WHEN lower(COALESCE(e.title, '')) = lower(${q}) THEN 1
          ELSE 2
        END,
        COALESCE(e.title, t.label, e.bvid, t.external_id) ASC
      LIMIT ${limit}
    `,
    sql<{ mid: string; uname: string | null; target_label: string | null }[]>`
      SELECT
        COALESCE(e.mid, t.external_id)::text AS mid,
        e.uname,
        t.label AS target_label
      FROM (
        SELECT c.mid::text AS mid, c.uname
        FROM creators c
        WHERE c.deleted_at IS NULL
      ) e
      FULL OUTER JOIN (
        SELECT external_id, label
        FROM monitor_targets
        WHERE "type" = 'creator' AND deleted_at IS NULL
      ) t ON t.external_id = e.mid
      WHERE COALESCE(e.mid, t.external_id) IS NOT NULL
        AND (
          COALESCE(e.mid, t.external_id) = ${q}
          OR COALESCE(e.uname, '') ILIKE ${pattern} ESCAPE '\\'
          OR COALESCE(t.label, '') ILIKE ${pattern} ESCAPE '\\'
        )
      ORDER BY
        CASE
          WHEN COALESCE(e.mid, t.external_id) = ${q} THEN 0
          WHEN lower(COALESCE(e.uname, '')) = lower(${q}) THEN 1
          ELSE 2
        END,
        COALESCE(e.uname, t.label, e.mid, t.external_id) ASC
      LIMIT ${limit}
    `,
    sql<{ category: string }[]>`
      SELECT DISTINCT category
      FROM (
        SELECT category FROM videos
        WHERE deleted_at IS NULL AND category IS NOT NULL AND btrim(category) <> ''
        UNION
        SELECT category FROM creators
        WHERE deleted_at IS NULL AND category IS NOT NULL AND btrim(category) <> ''
      ) cats
      WHERE category IS NOT NULL
        AND category ILIKE ${pattern} ESCAPE '\\'
      ORDER BY category ASC
      LIMIT ${limit}
    `,
  ]);

  return {
    videos: videos.map((row) => {
      const bvid = row.bvid;
      const label = (row.title?.trim() || row.target_label?.trim() || bvid).trim();
      const parts = [row.creator_name?.trim() || null, bvid].filter((part): part is string =>
        Boolean(part),
      );
      return {
        kind: 'video' as const,
        label,
        secondary: parts.length > 0 ? parts.join(' · ') : null,
        value: bvid,
      };
    }),
    creators: creators.map((row) => {
      const mid = row.mid;
      const label = (row.uname?.trim() || row.target_label?.trim() || mid).trim();
      return {
        kind: 'creator' as const,
        label,
        secondary: mid === label ? null : mid,
        value: mid,
      };
    }),
    categories: categories.map((row) => ({
      kind: 'category' as const,
      label: row.category,
      secondary: null,
      value: row.category,
    })),
  };
}
