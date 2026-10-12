import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from '@studio/db';
import { runInventory, type InventoryResult } from './inventory';
import {
  parseMetricCsv,
  normalizeCategory,
  type FollowerSample,
  type VideoSample,
  type DynamicSample,
} from './metric-rows';
import { reportToMarkdown } from './report';
import { assetIdFromContentSha256, guessMimeType } from './asset-id';
import { pgBigint } from './sql-values';
import type { ImportMode, ImportReport, MirrorGroup } from './types';

export type ImportOptions = {
  mode: ImportMode;
  backendRoot?: string;
  frontendRoot?: string;
  assetsRoot?: string;
  sourceTimezone: string;
  sql?: Sql;
};

function pickCanonicalPath(
  group: MirrorGroup,
): { path: string; mirror: 'backend' | 'frontend' } | null {
  if (group.backend) return { path: group.backend.relativePath, mirror: 'backend' };
  if (group.frontend) return { path: group.frontend.relativePath, mirror: 'frontend' };
  return null;
}

function readText(root: string, relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
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

export async function runImport(opts: ImportOptions): Promise<{
  inventory: InventoryResult;
  report: ImportReport;
  markdown: string;
  batchId: string;
}> {
  const inventory = await runInventory({
    ...(opts.backendRoot ? { backendRoot: opts.backendRoot } : {}),
    ...(opts.frontendRoot ? { frontendRoot: opts.frontendRoot } : {}),
  });
  const batchId = crypto.randomUUID();
  const report: ImportReport = {
    mode: opts.mode,
    sourceTimezone: opts.sourceTimezone,
    fileCount: inventory.groups.length,
    mirrorGroups: inventory.groups.length,
    parsed: 0,
    accepted: 0,
    rejected: 0,
    duplicate: 0,
    conflict: 0,
    unsupported: inventory.unsupported.map(
      (u) => `${u.relativePath} (${u.kind})${u.note ? `: ${u.note}` : ''}`,
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

  const metricGroups = inventory.groups.filter((g) => {
    const entry = g.backend ?? g.frontend;
    return entry?.supported && ['follower', 'views', 'detailcount'].includes(entry.kind);
  });

  type ParsedBundle = {
    group: MirrorGroup;
    sha256: string;
    kind: string;
    entityKey: string;
    followers: FollowerSample[];
    videos: VideoSample[];
    dynamics: DynamicSample[];
  };

  const bundles: ParsedBundle[] = [];
  for (const group of metricGroups) {
    const entry = group.backend ?? group.frontend;
    if (!entry?.entityKey) continue;
    const canonical = pickCanonicalPath(group);
    if (!canonical) continue;
    const root = canonical.mirror === 'backend' ? opts.backendRoot : opts.frontendRoot;
    if (!root) continue;
    const sha256 = group.canonicalSha256 ?? entry.sha256;
    if (opts.sql && opts.mode === 'apply') {
      const applied = await opts.sql<{ sha256: string }[]>`
        SELECT sha256 FROM applied_source_files WHERE sha256 = ${sha256}
      `;
      if (applied.length > 0) {
        continue;
      }
    }
    const text = readText(root, canonical.path);
    const parsed = parseMetricCsv({
      kind: entry.kind as 'follower' | 'views' | 'detailcount',
      entityKey: entry.entityKey,
      text,
      sourceTimezone: opts.sourceTimezone,
    });
    report.parsed += parsed.samples.length;
    for (const issue of parsed.issues) {
      if (issue.kind === 'reject') report.rejected += 1;
      if (issue.kind === 'duplicate') report.duplicate += 1;
      if (issue.kind === 'conflict') report.conflict += 1;
    }
    report.accepted += parsed.samples.length;
    bundles.push({
      group,
      sha256,
      kind: entry.kind,
      entityKey: entry.entityKey,
      followers: entry.kind === 'follower' ? (parsed.samples as FollowerSample[]) : [],
      videos: entry.kind === 'views' ? (parsed.samples as VideoSample[]) : [],
      dynamics: entry.kind === 'detailcount' ? (parsed.samples as DynamicSample[]) : [],
    });
  }

  const creatorIds = new Set<string>();
  const videoIds = new Set<string>();
  const dynamicIds = new Set<string>();

  for (const b of bundles) {
    if (b.kind === 'follower') creatorIds.add(b.entityKey);
    if (b.kind === 'views') videoIds.add(b.entityKey);
    if (b.kind === 'detailcount') dynamicIds.add(b.entityKey);
  }
  report.entities.creators = creatorIds.size;
  report.entities.videos = videoIds.size;
  report.entities.dynamics = dynamicIds.size;

  if (opts.mode === 'inventory') {
    return { inventory, report, markdown: reportToMarkdown(report), batchId };
  }

  const beforeFp =
    opts.sql && opts.mode === 'apply' ? await fingerprintBusinessData(opts.sql) : null;

  if (opts.sql) {
    await opts.sql`
      INSERT INTO import_batches (id, mode, source_timezone, report_json)
      VALUES (${batchId}, ${opts.mode}, ${opts.sourceTimezone}, ${JSON.stringify(report)}::jsonb)
    `;
  }

  if (opts.sql && opts.mode === 'apply') {
    for (const b of bundles) {
      const canonical = pickCanonicalPath(b.group);
      if (!canonical) continue;
      const sourceRows = await opts.sql<{ id: number }[]>`
        INSERT INTO source_files (batch_id, relative_path, sha256, mirror, file_kind, entity_key, row_count)
        VALUES (
          ${batchId},
          ${canonical.path},
          ${b.sha256},
          'canonical',
          ${b.kind},
          ${b.entityKey},
          ${b.followers.length + b.videos.length + b.dynamics.length}
        )
        RETURNING id
      `;
      const sourceFileId: number | null = sourceRows[0]?.id ?? null;
      if (b.group.backend && b.group.frontend && sourceFileId) {
        await opts.sql`
          INSERT INTO source_file_provenance (canonical_source_file_id, mirror, mirror_sha256, mirror_relative_path)
          VALUES
            (${sourceFileId}, 'backend', ${b.group.backend.sha256}, ${b.group.backend.relativePath}),
            (${sourceFileId}, 'frontend', ${b.group.frontend.sha256}, ${b.group.frontend.relativePath})
          ON CONFLICT DO NOTHING
        `;
      }
      for (const s of b.followers) {
        await opts.sql`
          INSERT INTO creators (mid) VALUES (${pgBigint(s.mid)}) ON CONFLICT (mid) DO NOTHING
        `;
        await opts.sql`
          INSERT INTO creator_follower_samples (
            mid, sampled_at, source_timezone, raw_time, timestamp_precision, follower_count, import_batch_id, source_file_id
          ) VALUES (
            ${pgBigint(s.mid)}, ${s.sampledAt}, ${opts.sourceTimezone}, ${s.rawTime}, ${s.precision}, ${pgBigint(s.followerCount)}, ${batchId}, ${sourceFileId}
          )
          ON CONFLICT (mid, sampled_at) DO NOTHING
        `;
        touchCoverage(report, 'follower', s.sampledAt);
      }
      for (const s of b.videos) {
        await opts.sql`
          INSERT INTO videos (bvid) VALUES (${s.bvid}) ON CONFLICT (bvid) DO NOTHING
        `;
        await opts.sql`
          INSERT INTO video_metric_samples (
            bvid, sampled_at, source_timezone, raw_time, timestamp_precision,
            view_count, online_viewers, online_viewers_raw,
            like_count, coin_count, favorite_count, share_count, danmaku_count,
            import_batch_id, source_file_id
          ) VALUES (
            ${s.bvid}, ${s.sampledAt}, ${opts.sourceTimezone}, ${s.rawTime}, ${s.precision},
            ${pgBigint(s.viewCount)}, ${pgBigint(s.onlineViewers)}, ${s.onlineViewersRaw},
            ${pgBigint(s.likeCount)}, ${pgBigint(s.coinCount)}, ${pgBigint(s.favoriteCount)}, ${pgBigint(s.shareCount)}, ${pgBigint(s.danmakuCount)},
            ${batchId}, ${sourceFileId}
          )
          ON CONFLICT (bvid, sampled_at) DO NOTHING
        `;
        touchCoverage(report, 'views', s.sampledAt);
      }
      for (const s of b.dynamics) {
        await opts.sql`
          INSERT INTO dynamics (dynamic_id) VALUES (${s.dynamicId}) ON CONFLICT (dynamic_id) DO NOTHING
        `;
        await opts.sql`
          INSERT INTO dynamic_metric_samples (
            dynamic_id, sampled_at, source_timezone, raw_time, timestamp_precision,
            like_count, repost_count, comment_count, import_batch_id, source_file_id
          ) VALUES (
            ${s.dynamicId}, ${s.sampledAt}, ${opts.sourceTimezone}, ${s.rawTime}, ${s.precision},
            ${pgBigint(s.likeCount)}, ${pgBigint(s.repostCount)}, ${pgBigint(s.commentCount)}, ${batchId}, ${sourceFileId}
          )
          ON CONFLICT (dynamic_id, sampled_at) DO NOTHING
        `;
        touchCoverage(report, 'detailcount', s.sampledAt);
      }
      await opts.sql`
        INSERT INTO applied_source_files (sha256, relative_path, file_kind, entity_key, first_applied_batch_id, last_applied_batch_id)
        VALUES (${b.sha256}, ${canonical.path}, ${b.kind}, ${b.entityKey}, ${batchId}, ${batchId})
        ON CONFLICT (sha256) DO UPDATE SET last_applied_batch_id = ${batchId}, applied_at = now()
      `;
    }

    if (opts.assetsRoot) {
      const assetByPath = await ingestStaticAssets(opts, batchId);
      await ingestStaticMetadata(opts, batchId, assetByPath);
    }

    const afterFp = await fingerprintBusinessData(opts.sql);
    report.noOp = beforeFp === afterFp && bundles.length === 0;
    await opts.sql`
      UPDATE import_batches
      SET completed_at = now(), report_json = ${JSON.stringify(report)}::jsonb, content_fingerprint = ${afterFp}
      WHERE id = ${batchId}
    `;
  }

  if (opts.sql && opts.mode === 'dry_run') {
    await opts.sql`
      UPDATE import_batches SET completed_at = now(), report_json = ${JSON.stringify(report)}::jsonb WHERE id = ${batchId}
    `;
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

async function ingestStaticAssets(
  opts: ImportOptions,
  batchId: string,
): Promise<Map<string, string>> {
  const pathToAssetId = new Map<string, string>();
  if (!opts.assetsRoot || !opts.sql) return pathToAssetId;
  const inv = await runInventory({ frontendRoot: opts.assetsRoot });
  for (const group of inv.groups) {
    const entry = group.frontend ?? group.backend;
    if (!entry || entry.kind !== 'static_image') continue;
    const assetId = assetIdFromContentSha256(entry.sha256);
    const mime = guessMimeType(entry.relativePath);
    await opts.sql`
      INSERT INTO static_assets (asset_id, content_sha256, mime_type, relative_path, import_batch_id)
      VALUES (${assetId}, ${entry.sha256}, ${mime}, ${entry.relativePath}, ${batchId})
      ON CONFLICT (asset_id) DO UPDATE SET
        content_sha256 = EXCLUDED.content_sha256,
        mime_type = COALESCE(EXCLUDED.mime_type, static_assets.mime_type),
        relative_path = EXCLUDED.relative_path,
        import_batch_id = EXCLUDED.import_batch_id
    `;
    pathToAssetId.set(entry.relativePath, assetId);
  }
  return pathToAssetId;
}

function resolveMetaAssetPath(meta: Record<string, unknown>): string | null {
  for (const key of ['cover', 'pic', 'face', 'avatar']) {
    const value = meta[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value.replace(/\\/g, '/');
    }
  }
  return null;
}

async function ingestStaticMetadata(
  opts: ImportOptions,
  batchId: string,
  assetByPath: Map<string, string>,
) {
  if (!opts.assetsRoot || !opts.sql) return;
  const inv = await runInventory({ frontendRoot: opts.assetsRoot });
  for (const group of inv.groups) {
    const entry = group.frontend ?? group.backend;
    if (!entry || entry.kind !== 'static_json') continue;
    const text = readText(opts.assetsRoot, entry.relativePath);
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
    const assetPath = resolveMetaAssetPath(meta);
    const linkedAssetId = assetPath ? assetByPath.get(assetPath) : undefined;

    if (bvid) {
      await opts.sql`
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
    if (mid != null && !bvid) {
      const uname = typeof meta.name === 'string' ? meta.name : null;
      await opts.sql`
        INSERT INTO creators (mid, uname, category, face_asset_id, metadata)
        VALUES (${pgBigint(mid)}, ${uname}, ${category}, ${linkedAssetId ?? null}, ${JSON.stringify(meta)}::jsonb)
        ON CONFLICT (mid) DO UPDATE SET
          uname = COALESCE(EXCLUDED.uname, creators.uname),
          category = COALESCE(EXCLUDED.category, creators.category),
          face_asset_id = COALESCE(EXCLUDED.face_asset_id, creators.face_asset_id),
          metadata = creators.metadata || EXCLUDED.metadata,
          updated_at = now()
      `;
    }
    const dynamicId =
      typeof meta.dynamic_id === 'string'
        ? meta.dynamic_id
        : typeof meta.detail_id === 'string'
          ? meta.detail_id
          : null;
    if (dynamicId) {
      await opts.sql`
        INSERT INTO dynamics (dynamic_id, mid, category, metadata)
        VALUES (${dynamicId}, ${pgBigint(mid)}, ${category}, ${JSON.stringify(meta)}::jsonb)
        ON CONFLICT (dynamic_id) DO UPDATE SET
          category = COALESCE(EXCLUDED.category, dynamics.category),
          metadata = dynamics.metadata || EXCLUDED.metadata,
          updated_at = now()
      `;
    }
    void batchId;
  }
}
