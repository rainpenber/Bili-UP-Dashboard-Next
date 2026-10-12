import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from '@studio/db';
import { assetIdFromContentSha256, guessMimeType } from './asset-id';
import { IMPORTER_VERSION } from './importer-version';
import { runInventory, type CanonicalContentGroup, type InventoryResult } from './inventory';
import { parseMetricCsvWithStaging } from './metric-parse';
import { normalizeCategory } from './metric-rows';
import { reportToMarkdown } from './report';
import { pgBigint } from './sql-values';
import type { ImportMode, ImportReport } from './types';

const IMPORT_RUN_LOCK_KEY = 915_002;


export type ImportOptions = {
  mode: ImportMode;
  backendRoot?: string;
  frontendRoot?: string;
  assetsRoot?: string;
  sourceTimezone: string;
  sql?: Sql;
  /** Test-only: throw after N canonical metric writes inside apply transaction. */
  testFailAfterCanonicalWrites?: number;
};

function readText(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

function rootForMirror(mirror: 'backend' | 'frontend', opts: ImportOptions): string | undefined {
  return mirror === 'backend' ? opts.backendRoot : opts.frontendRoot;
}

async function fingerprintBusinessData(sql: Sql): Promise<string> {
  const rows = await sql<{ h: string }[]>`
    SELECT md5(
      coalesce((SELECT string_agg(mid::text || '|' || follower_count::text, ',' ORDER BY mid, sampled_at) FROM creator_follower_samples), '') ||
      coalesce((SELECT string_agg(bvid || '|' || coalesce(view_count::text,'') , ',' ORDER BY bvid, sampled_at) FROM video_metric_samples), '') ||
      coalesce((SELECT string_agg(dynamic_id || '|' || coalesce(like_count::text,''), ',' ORDER BY dynamic_id, sampled_at) FROM dynamic_metric_samples), '')
    ) AS h
  `;
  return rows[0]?.h ?? '';
}

async function isCanonicalAlreadyApplied(sql: Sql, group: CanonicalContentGroup): Promise<boolean> {
  const rows = await sql<{ ok: number }[]>`
    SELECT 1 AS ok FROM applied_canonical_sources
    WHERE importer_version = ${IMPORTER_VERSION}
      AND file_kind = ${group.fileKind}
      AND entity_key = ${group.entityKey}
      AND content_sha256 = ${group.contentSha256}
    LIMIT 1
  `;
  return rows.length > 0;
}

type ParsedGroup = {
  group: CanonicalContentGroup;
  parseSourcePath: string;
  parseMirror: 'backend' | 'frontend';
  followers: ReturnType<typeof parseMetricCsvWithStaging>['samples'];
  videos: ReturnType<typeof parseMetricCsvWithStaging>['samples'];
  dynamics: ReturnType<typeof parseMetricCsvWithStaging>['samples'];
  stagingRows: ReturnType<typeof parseMetricCsvWithStaging>['stagingRows'];
  issues: ReturnType<typeof parseMetricCsvWithStaging>['issues'];
};

function pickParseSource(group: CanonicalContentGroup): {
  path: string;
  mirror: 'backend' | 'frontend';
} {
  const backend = group.sources.find((s) => s.mirror === 'backend');
  if (backend) return { path: backend.relativePath, mirror: 'backend' };
  const frontend = group.sources.find((s) => s.mirror === 'frontend');
  if (frontend) return { path: frontend.relativePath, mirror: 'frontend' };
  return {
    path: group.sources[0]?.relativePath ?? '',
    mirror: group.sources[0]?.mirror ?? 'backend',
  };
}

export async function runImport(opts: ImportOptions): Promise<{
  inventory: InventoryResult;
  report: ImportReport;
  markdown: string;
  batchId: string;
  failed?: boolean;
}> {
  const inventory = await runInventory({
    ...(opts.backendRoot ? { backendRoot: opts.backendRoot } : {}),
    ...(opts.frontendRoot ? { frontendRoot: opts.frontendRoot } : {}),
  });
  const batchId = crypto.randomUUID();
  const pathMirrorMismatches = inventory.pathMirrors.filter(
    (p) => p.backend && p.frontend && p.sha256Match === false,
  ).length;

  const report: ImportReport = {
    mode: opts.mode,
    sourceTimezone: opts.sourceTimezone,
    importerVersion: IMPORTER_VERSION,
    fileCount: inventory.backend.length + inventory.frontend.length,
    mirrorGroups: inventory.pathMirrors.length,
    pathMirrorMismatches,
    canonicalGroups: inventory.canonicalGroups.length,
    parsed: 0,
    accepted: 0,
    rejected: 0,
    duplicate: 0,
    conflict: 0,
    stagingRows: 0,
    skippedAlreadyApplied: 0,
    unsupported: inventory.unsupported.map(
      (u) => `${u.mirror}:${u.relativePath} (${u.kind})${u.note ? `: ${u.note}` : ''}`,
    ),
    entities: { creators: 0, videos: 0, dynamics: 0 },
    timeCoverage: {
      follower: { min: null, max: null },
      views: { min: null, max: null },
      detailcount: { min: null, max: null },
    },
    anomalies: [],
    noOp: false,
  };

  const parsedGroups: ParsedGroup[] = [];
  const groupsToApply: ParsedGroup[] = [];

  for (const group of inventory.canonicalGroups) {
    const already =
      opts.sql && opts.mode === 'apply' ? await isCanonicalAlreadyApplied(opts.sql, group) : false;
    if (already) {
      report.skippedAlreadyApplied += 1;
      continue;
    }
    const { path, mirror } = pickParseSource(group);
    const root = rootForMirror(mirror, opts);
    if (!root) continue;
    const text = readText(root, path);
    const parsed = parseMetricCsvWithStaging({
      kind: group.fileKind as 'follower' | 'views' | 'detailcount',
      entityKey: group.entityKey,
      text,
      sourceTimezone: opts.sourceTimezone,
    });
    report.parsed += parsed.stagingRows.length;
    report.stagingRows += parsed.stagingRows.length;
    report.accepted += parsed.stagingRows.filter((r) => r.qualityFlags.includes('accepted')).length;
    for (const issue of parsed.issues) {
      if (issue.kind === 'reject') report.rejected += 1;
      if (issue.kind === 'duplicate') report.duplicate += 1;
      if (issue.kind === 'conflict') report.conflict += 1;
    }
    const bundle: ParsedGroup = {
      group,
      parseSourcePath: path,
      parseMirror: mirror,
      followers: group.fileKind === 'follower' ? parsed.samples : [],
      videos: group.fileKind === 'views' ? parsed.samples : [],
      dynamics: group.fileKind === 'detailcount' ? parsed.samples : [],
      stagingRows: parsed.stagingRows,
      issues: parsed.issues,
    };
    parsedGroups.push(bundle);
    groupsToApply.push(bundle);
  }

  const creatorIds = new Set<string>();
  const videoIds = new Set<string>();
  const dynamicIds = new Set<string>();
  for (const g of parsedGroups) {
    if (g.group.fileKind === 'follower') creatorIds.add(g.group.entityKey);
    if (g.group.fileKind === 'views') videoIds.add(g.group.entityKey);
    if (g.group.fileKind === 'detailcount') dynamicIds.add(g.group.entityKey);
  }
  report.entities.creators = creatorIds.size;
  report.entities.videos = videoIds.size;
  report.entities.dynamics = dynamicIds.size;

  if (opts.mode === 'inventory') {
    return { inventory, report, markdown: reportToMarkdown(report), batchId };
  }

  if (!opts.sql) {
    return { inventory, report, markdown: reportToMarkdown(report), batchId };
  }

  const beforeFp = opts.mode === 'apply' ? await fingerprintBusinessData(opts.sql) : null;

  await opts.sql`SELECT pg_advisory_lock(${IMPORT_RUN_LOCK_KEY})`;
  try {
    await opts.sql`
      INSERT INTO import_batches (id, mode, source_timezone, status, importer_version, report_json)
      VALUES (${batchId}, ${opts.mode}, ${opts.sourceTimezone}, 'running', ${IMPORTER_VERSION}, ${JSON.stringify(report)}::jsonb)
    `;

    const writeCanonical = opts.mode === 'apply';
    let canonicalWrites = 0;

    await opts.sql.begin(async (tx) => {
      for (const bundle of parsedGroups) {
        const canonicalPath = `canonical/${bundle.group.fileKind}/${bundle.group.entityKey}/${bundle.group.contentSha256.slice(0, 16)}`;
        const sourceFileRows = await tx<{ id: number }[]>`
          INSERT INTO source_files (batch_id, relative_path, sha256, mirror, file_kind, entity_key, row_count)
          VALUES (
            ${batchId},
            ${canonicalPath},
            ${bundle.group.contentSha256},
            'canonical',
            ${bundle.group.fileKind},
            ${bundle.group.entityKey},
            ${bundle.stagingRows.length}
          )
          RETURNING id
        `;
        const canonicalFileId = sourceFileRows[0]?.id ?? null;
        if (!canonicalFileId) throw new Error('failed to insert canonical source_file');

        for (const source of bundle.group.sources) {
          await tx`
            INSERT INTO source_files (batch_id, relative_path, sha256, mirror, file_kind, entity_key, row_count)
            VALUES (
              ${batchId},
              ${source.relativePath},
              ${source.sha256},
              ${source.mirror},
              ${source.kind},
              ${source.entityKey},
              ${bundle.stagingRows.length}
            )
            ON CONFLICT (batch_id, relative_path, mirror) DO NOTHING
          `;
          await tx`
            INSERT INTO source_file_provenance (canonical_source_file_id, mirror, mirror_sha256, mirror_relative_path)
            VALUES (${canonicalFileId}, ${source.mirror}, ${source.sha256}, ${source.relativePath})
            ON CONFLICT DO NOTHING
          `;
          if (writeCanonical) {
            await tx`
              INSERT INTO applied_source_provenance (
                importer_version, file_kind, entity_key, content_sha256, source_role, relative_path, source_sha256, first_applied_batch_id
              ) VALUES (
                ${IMPORTER_VERSION},
                ${bundle.group.fileKind},
                ${bundle.group.entityKey},
                ${bundle.group.contentSha256},
                ${source.mirror},
                ${source.relativePath},
                ${source.sha256},
                ${batchId}
              )
              ON CONFLICT DO NOTHING
            `;
          }
        }

        for (const row of bundle.stagingRows) {
          await tx`
            INSERT INTO source_metric_rows (
              batch_id, source_file_id, row_index, entity_type, entity_key, sampled_at, raw_time, payload, quality_flags, is_canonical
            ) VALUES (
              ${batchId},
              ${canonicalFileId},
              ${row.rowIndex},
              ${row.entityType},
              ${row.entityKey},
              ${row.sampledAt},
              ${row.rawTime},
              ${JSON.stringify(row.payload)}::jsonb,
              ${row.qualityFlags},
              ${row.isCanonical}
            )
          `;
        }

        for (const issue of bundle.issues) {
          await tx`
            INSERT INTO import_conflicts_or_rejects (batch_id, source_file_id, kind, entity_type, entity_key, sampled_at, message, detail)
            VALUES (
              ${batchId},
              ${canonicalFileId},
              ${issue.kind},
              ${bundle.group.fileKind},
              ${bundle.group.entityKey},
              ${issue.detail?.sampledAt ? new Date(String(issue.detail.sampledAt)) : null},
              ${issue.message},
              ${JSON.stringify(issue.detail ?? {})}::jsonb
            )
          `;
        }

        if (!writeCanonical) continue;

        for (const s of bundle.followers as import('./metric-rows').FollowerSample[]) {
          canonicalWrites += 1;
          if (
            opts.testFailAfterCanonicalWrites != null &&
            canonicalWrites > opts.testFailAfterCanonicalWrites
          ) {
            throw new Error('test_fail_after_canonical_writes');
          }
          await tx`
            INSERT INTO creators (mid) VALUES (${pgBigint(s.mid)}) ON CONFLICT (mid) DO NOTHING
          `;
          await tx`
            INSERT INTO creator_follower_samples (
              mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count, import_batch_id, source_file_id
            ) VALUES (
              ${pgBigint(s.mid)}, ${s.sampledAt}, ${opts.sourceTimezone}, ${s.rawTime}, ${s.precision}, ${pgBigint(s.followerCount)}, ${batchId}, ${canonicalFileId}
            )
            ON CONFLICT (mid, sampled_at) DO NOTHING
          `;
          touchCoverage(report, 'follower', s.sampledAt);
        }
        for (const s of bundle.videos as import('./metric-rows').VideoSample[]) {
          canonicalWrites += 1;
          if (
            opts.testFailAfterCanonicalWrites != null &&
            canonicalWrites > opts.testFailAfterCanonicalWrites
          ) {
            throw new Error('test_fail_after_canonical_writes');
          }
          await tx`
            INSERT INTO videos (bvid) VALUES (${s.bvid}) ON CONFLICT (bvid) DO NOTHING
          `;
          await tx`
            INSERT INTO video_metric_samples (
              bvid, sampled_at, source_timezone, raw_time, timestamp_precision,
              view_count, online_viewers, online_viewers_raw,
              like_count, coin_count, favorite_count, share_count, danmaku_count,
              import_batch_id, source_file_id
            ) VALUES (
              ${s.bvid}, ${s.sampledAt}, ${opts.sourceTimezone}, ${s.rawTime}, ${s.precision},
              ${pgBigint(s.viewCount)}, ${pgBigint(s.onlineViewers)}, ${s.onlineViewersRaw},
              ${pgBigint(s.likeCount)}, ${pgBigint(s.coinCount)}, ${pgBigint(s.favoriteCount)}, ${pgBigint(s.shareCount)}, ${pgBigint(s.danmakuCount)},
              ${batchId}, ${canonicalFileId}
            )
            ON CONFLICT (bvid, sampled_at) DO NOTHING
          `;
          touchCoverage(report, 'views', s.sampledAt);
        }
        for (const s of bundle.dynamics as import('./metric-rows').DynamicSample[]) {
          canonicalWrites += 1;
          if (
            opts.testFailAfterCanonicalWrites != null &&
            canonicalWrites > opts.testFailAfterCanonicalWrites
          ) {
            throw new Error('test_fail_after_canonical_writes');
          }
          await tx`
            INSERT INTO dynamics (dynamic_id) VALUES (${s.dynamicId}) ON CONFLICT (dynamic_id) DO NOTHING
          `;
          await tx`
            INSERT INTO dynamic_metric_samples (
              dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision,
              like_count, repost_count, comment_count, import_batch_id, source_file_id
            ) VALUES (
              ${s.dynamicId}, ${s.sampledAt}, ${opts.sourceTimezone}, ${s.rawTime}, ${s.precision},
              ${pgBigint(s.likeCount)}, ${pgBigint(s.repostCount)}, ${pgBigint(s.commentCount)}, ${batchId}, ${canonicalFileId}
            )
            ON CONFLICT (dynamic_id, sampled_at) DO NOTHING
          `;
          touchCoverage(report, 'detailcount', s.sampledAt);
        }

        await tx`
          INSERT INTO applied_canonical_sources (
            importer_version, file_kind, entity_key, content_sha256, first_applied_batch_id, last_applied_batch_id
          ) VALUES (
            ${IMPORTER_VERSION},
            ${bundle.group.fileKind},
            ${bundle.group.entityKey},
            ${bundle.group.contentSha256},
            ${batchId},
            ${batchId}
          )
          ON CONFLICT (importer_version, file_kind, entity_key, content_sha256)
          DO UPDATE SET last_applied_batch_id = ${batchId}, applied_at = now()
        `;
      }

      if (writeCanonical && opts.assetsRoot) {
        await ingestStaticAssets(tx as unknown as Sql, opts, batchId);
        await ingestStaticMetadata(tx as unknown as Sql, opts, batchId);
      }
    });

    const afterFp = writeCanonical ? await fingerprintBusinessData(opts.sql) : beforeFp;
    report.noOp =
      writeCanonical &&
      groupsToApply.length === 0 &&
      report.skippedAlreadyApplied > 0 &&
      beforeFp === afterFp;

    await opts.sql`
      UPDATE import_batches
      SET status = 'completed', completed_at = now(), report_json = ${JSON.stringify(report)}::jsonb, content_fingerprint = ${afterFp}
      WHERE id = ${batchId}
    `;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'import failed';
    report.anomalies.push(message);
    await opts.sql`
      UPDATE import_batches
      SET status = 'failed', completed_at = now(), error_message = ${message}, report_json = ${JSON.stringify(report)}::jsonb
      WHERE id = ${batchId}
    `;
    return {
      inventory,
      report,
      markdown: reportToMarkdown(report),
      batchId,
      failed: true,
    };
  } finally {
    await opts.sql`SELECT pg_advisory_unlock(${IMPORT_RUN_LOCK_KEY})`;
  }

  return { inventory, report, markdown: reportToMarkdown(report), batchId };
}

function touchCoverage(report: ImportReport, key: string, at: Date) {
  const slot = report.timeCoverage[key] ?? { min: null, max: null };
  const iso = at.toISOString();
  if (!slot.min || iso < slot.min) slot.min = iso;
  if (!slot.max || iso > slot.max) slot.max = iso;
  report.timeCoverage[key] = slot;
}

async function ingestStaticAssets(tx: Sql, opts: ImportOptions, batchId: string) {
  if (!opts.assetsRoot) return;
  const inv = await runInventory({ frontendRoot: opts.assetsRoot });
  for (const entry of [...inv.backend, ...inv.frontend].filter((e) => e.kind === 'static_image')) {
    const assetId = assetIdFromContentSha256(entry.sha256);
    const mime = guessMimeType(entry.relativePath);
    await tx`
      INSERT INTO static_assets (asset_id, content_sha256, mime_type, relative_path, import_batch_id)
      VALUES (${assetId}, ${entry.sha256}, ${mime}, ${entry.relativePath}, ${batchId})
      ON CONFLICT (asset_id) DO UPDATE SET
        content_sha256 = EXCLUDED.content_sha256,
        mime_type = COALESCE(EXCLUDED.mime_type, static_assets.mime_type),
        relative_path = EXCLUDED.relative_path,
        import_batch_id = EXCLUDED.import_batch_id
    `;
  }
}

async function ingestStaticMetadata(tx: Sql, opts: ImportOptions, batchId: string) {
  if (!opts.assetsRoot) return;
  void batchId;
  const inv = await runInventory({ frontendRoot: opts.assetsRoot });
  const images = [...inv.backend, ...inv.frontend].filter((e) => e.kind === 'static_image');
  const assetByPath = new Map(
    images.map((e) => [e.relativePath, assetIdFromContentSha256(e.sha256)] as const),
  );
  for (const entry of [...inv.backend, ...inv.frontend].filter((e) => e.kind === 'static_json')) {
    const text = readText(opts.assetsRoot!, entry.relativePath);
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(text) as Record<string, unknown>;
    } catch {
      continue;
    }
    const category = normalizeCategory(meta);
    const bvid = typeof meta.bvid === 'string' ? meta.bvid : null;
    const mid = meta.mid != null ? BigInt(String(meta.mid)) : null;
    const title = typeof meta.title === 'string' ? meta.title : null;
    const coverPath =
      typeof meta.cover === 'string'
        ? meta.cover.replace(/\\/g, '/')
        : typeof meta.pic === 'string'
          ? meta.pic.replace(/\\/g, '/')
          : null;
    const linkedAssetId = coverPath ? assetByPath.get(coverPath) : undefined;
    if (bvid) {
      await tx`
        INSERT INTO videos (bvid, mid, title, category, cover_asset_id, metadata)
        VALUES (${bvid}, ${pgBigint(mid)}, ${title}, ${category}, ${linkedAssetId ?? null}, ${JSON.stringify(meta)}::jsonb)
        ON CONFLICT (bvid) DO UPDATE SET
          title = COALESCE(EXCLUDED.title, videos.title),
          category = COALESCE(EXCLUDED.category, videos.category),
          cover_asset_id = COALESCE(EXCLUDED.cover_asset_id, videos.cover_asset_id),
          metadata = videos.metadata || EXCLUDED.metadata,
          updated_at = now()
      `;
    }
  }
}
