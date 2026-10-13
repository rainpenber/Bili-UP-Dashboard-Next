import type { Sql } from '@studio/db';
import { IMPORTER_VERSION, canonicalSourceKey } from './importer-version';
import type { CanonicalContentGroup } from './inventory';

export async function loadAppliedCanonicalKeySet(sql: Sql): Promise<Set<string>> {
  const rows = await sql<{ file_kind: string; entity_key: string; content_sha256: string }[]>`
    SELECT file_kind, entity_key, content_sha256
    FROM applied_canonical_sources
    WHERE importer_version = ${IMPORTER_VERSION}
  `;
  return new Set(
    rows.map((r) =>
      canonicalSourceKey({
        fileKind: r.file_kind,
        entityKey: r.entity_key,
        contentSha256: r.content_sha256,
      }),
    ),
  );
}

export function isGroupAlreadyApplied(
  applied: Set<string> | null,
  group: CanonicalContentGroup,
): boolean {
  if (!applied) return false;
  return applied.has(
    canonicalSourceKey({
      fileKind: group.fileKind,
      entityKey: group.entityKey,
      contentSha256: group.contentSha256,
    }),
  );
}
