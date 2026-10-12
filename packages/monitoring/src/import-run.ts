import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from '@studio/db';
import { assetIdFromContentSha256, guessMimeType } from './asset-id';
import { buildImportInventorySummary } from './inventory-summary';
import { IMPORTER_VERSION } from './importer-version';
import { runInventory, type CanonicalContentGroup, type InventoryResult } from './inventory';
import { parseMetricCsvWithStaging } from './metric-parse';
import type { MetricRowIssue } from './metric-rows';
import { normalizeCategory } from './metric-rows';
import { reportToMarkdown } from './report';
import { IMPORT_RUN_LOCK_KEY } from './import-advisory';
import {
  bulkInsertConflicts,
  bulkInsertDynamicSamples,
  bulkInsertFollowerSamples,
  bulkInsertSourceMetricRows,
  bulkInsertVideoSamples,
} from './import-bulk';
import { isGroupAlreadyApplied, loadAppliedCanonicalKeySet } from './import-applied-cache';
import { pgBigint } from './sql-values';
import type { ImportMode, ImportReport } from './types';
import type { InventoryEntry } from './types';

export type ImportOptions = {
  mode: ImportMode;
  backendRoot?: string;
  frontendRoot?: string;
  assetsRoot?: string | null;
  /** Root path for inventory summary (MOCK_DATA_ROOT); inferred when omitted. */
  mockDataRoot?: string;
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

function inferMockDataRoot(opts: ImportOptions): string {
  if (opts.mockDataRoot) return opts.mockDataRoot;
  if (opts.backendRoot) {
    const trimmed = opts.backendRoot.replace(/[/\\]backend$/, '');
    if (trimmed !== opts.backendRoot) return trimmed;
  }
  if (opts.frontendRoot) {
    const trimmed = opts.frontendRoot.replace(/[/\\]frontend$/, '');
    if (trimmed !== opts.frontendRoot) return trimmed;
  }
  return opts.backendRoot ?? opts.frontendRoot ?? '';
}

function accumulateParseStats(
  report: ImportReport,
  parsed: ReturnType<typeof parseMetricCsvWithStaging>,
): void {
  report.parsed += parsed.stagingRows.length;
  report.stagingRows += parsed.stagingRows.length;
  report.accepted += parsed.stagingRows.filter((r) => r.qualityFlags.includes('accepted')).length;
  for (const issue of parsed.issues) {
    if (issue.kind === 'reject') {
      report.rejected += 1;
      if (issue.message === 'invalid numeric cell') report.invalidNumeric += 1;
    }
    if (issue.kind === 'duplicate') report.duplicate += 1;
    if (issue.kind === 'conflict') report.conflict += 1;
  }
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

type PhysicalParse = {
  source: InventoryEntry;
  stagingRows: ReturnType<typeof parseMetricCsvWithStaging>['stagingRows'];
  issues: MetricRowIssue[];
  samples: ReturnType<typeof parseMetricCsvWithStaging>['samples'];
};

type ParsedGroup = {
  group: CanonicalContentGroup;
  skipCanonicalWrite: boolean;
  physicalParses: PhysicalParse[];
  followers: ReturnType<typeof parseMetricCsvWithStaging>['samples'];
  videos: ReturnType<typeof parseMetricCsvWithStaging>['samples'];
  dynamics: ReturnType<typeof parseMetricCsvWithStaging>['samples'];
};

function pickParseSource(group: CanonicalContentGroup): InventoryEntry {
  const backend = group.sources.find((s) => s.mirror === 'backend');
  if (backend) return backend;
  const frontend = group.sources.find((s) => s.mirror === 'frontend');
  if (frontend) return frontend;
  return group.sources[0]!;
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
  const assetsMode = opts.assetsRoot ? ('filesystem' as const) : ('placeholder_only' as const);
  const assetsInv = opts.assetsRoot
    ? await runInventory({ frontendRoot: opts.assetsRoot })
    : { backend: [], frontend: [], pathMirrors: [], canonicalGroups: [], unsupported: [] };
  const assetsEntries = [...assetsInv.backend, ...assetsInv.frontend];
  const mockDataRoot = inferMockDataRoot(opts);
  const inventorySummary = buildImportInventorySummary({
    mockDataRoot,
    inventory,
    backendRoot: opts.backendRoot ?? '',
    frontendRoot: opts.frontendRoot ?? '',
    assetsMode,
    assetsEntries,
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
    physicalMetricRows:
      inventorySummary.backend.physicalMetricRows + inventorySummary.frontend.physicalMetricRows,
    parsed: 0,
    accepted: 0,
    rejected: 0,
    invalidNumeric: 0,
    duplicate: 0,
    conflict: 0,
    pathDivergences: pathMirrorMismatches,
    stagingRows: 0,
    skippedAlreadyApplied: 0,
    inventorySummary,
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
  let canonicalGroupsPending = 0;
  const appliedCanonicalKeys =
    opts.sql && opts.mode === 'apply' ? await loadAppliedCanonicalKeySet(opts.sql) : null;

  for (const group of inventory.canonicalGroups) {
    const skipCanonicalWrite = isGroupAlreadyApplied(appliedCanonicalKeys, group);
    if (skipCanonicalWrite) {
      report.skippedAlreadyApplied += 1;
    } else {
      canonicalGroupsPending += 1;
    }

    const physicalParses: PhysicalParse[] = [];
    for (const source of group.sources) {
      const root = rootForMirror(source.mirror, opts);
      if (!root) continue;
      const text = readText(root, source.relativePath);
      const parsed = parseMetricCsvWithStaging({
        kind: group.fileKind as 'follower' | 'views' | 'detailcount',
        entityKey: group.entityKey,
        text,
        sourceTimezone: opts.sourceTimezone,
      });
      accumulateParseStats(report, parsed);
      physicalParses.push({
        source,
        stagingRows: parsed.stagingRows,
        issues: parsed.issues,
        samples: parsed.samples,
      });
    }

    const canonicalSource = pickParseSource(group);
    const canonicalParse =
      physicalParses.find(
        (p) =>
          p.source.relativePath === canonicalSource.relativePath &&
          p.source.mirror === canonicalSource.mirror,
      ) ?? physicalParses[0];

    parsedGroups.push({
      group,
      skipCanonicalWrite,
      physicalParses,
      followers: group.fileKind === 'follower' ? (canonicalParse?.samples ?? []) : [],
      videos: group.fileKind === 'views' ? (canonicalParse?.samples ?? []) : [],
      dynamics: group.fileKind === 'detailcount' ? (canonicalParse?.samples ?? []) : [],
    });
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

  if (report.stagingRows !== report.physicalMetricRows) {
    report.anomalies.push(
      `staging_rows (${report.stagingRows}) != physical_metric_rows (${report.physicalMetricRows})`,
    );
  }

  if (opts.mode === 'inventory') {
    return { inventory, report, markdown: reportToMarkdown(report), batchId };
  }

  if (!opts.sql) {
    return { inventory, report, markdown: reportToMarkdown(report), batchId };
  }

  const beforeFp = opts.mode === 'apply' ? await fingerprintBusinessData(opts.sql) : null;

  const writeCanonical = opts.mode === 'apply';
  let canonicalWrites = 0;

  try {
    await opts.sql.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(${IMPORT_RUN_LOCK_KEY})`;
      await tx`
        INSERT INTO import_batches (id, mode, source_timezone, status, importer_version, report_json)
        VALUES (${batchId}, ${opts.mode}, ${opts.sourceTimezone}, 'running', ${IMPORTER_VERSION}, ${JSON.stringify(report)}::jsonb)
      `;
      for (const pm of inventory.pathMirrors) {
        if (!pm.backend || !pm.frontend || pm.sha256Match !== false) continue;
        await tx`
          INSERT INTO import_conflicts_or_rejects (batch_id, source_file_id, kind, entity_type, entity_key, message, detail)
          VALUES (
            ${batchId},
            NULL,
            'path_divergence',
            ${pm.backend.kind},
            ${pm.backend.entityKey},
            'backend/frontend path mirror hash mismatch — retained both sources separately',
            ${JSON.stringify({
              relativePath: pm.relativePath,
              backendSha256: pm.backend.sha256,
              frontendSha256: pm.frontend.sha256,
              decision: 'retain_both_canonical_content_groups',
            })}::jsonb
          )
        `;
      }

      for (const bundle of parsedGroups) {
        const canonicalPath = `canonical/${bundle.group.fileKind}/${bundle.group.entityKey}/${bundle.group.contentSha256.slice(0, 16)}`;
        const canonicalRowCount =
          bundle.physicalParses.find((p) => p.source.sha256 === bundle.group.contentSha256)
            ?.stagingRows.length ??
          bundle.physicalParses[0]?.stagingRows.length ??
          0;

        const sourceFileRows = await tx<{ id: number }[]>`
          INSERT INTO source_files (batch_id, relative_path, sha256, mirror, file_kind, entity_key, row_count)
          VALUES (
            ${batchId},
            ${canonicalPath},
            ${bundle.group.contentSha256},
            'canonical',
            ${bundle.group.fileKind},
            ${bundle.group.entityKey},
            ${canonicalRowCount}
          )
          RETURNING id
        `;
        const canonicalFileId = sourceFileRows[0]?.id ?? null;
        if (!canonicalFileId) throw new Error('failed to insert canonical source_file');

        for (const physical of bundle.physicalParses) {
          const physicalRows = await tx<{ id: number }[]>`
            INSERT INTO source_files (batch_id, relative_path, sha256, mirror, file_kind, entity_key, row_count)
            VALUES (
              ${batchId},
              ${physical.source.relativePath},
              ${physical.source.sha256},
              ${physical.source.mirror},
              ${physical.source.kind},
              ${physical.source.entityKey},
              ${physical.stagingRows.length}
            )
            ON CONFLICT (batch_id, relative_path, mirror) DO UPDATE SET
              sha256 = EXCLUDED.sha256,
              row_count = EXCLUDED.row_count
            RETURNING id
          `;
          const physicalFileId = physicalRows[0]?.id ?? null;
          if (!physicalFileId) throw new Error('failed to insert physical source_file');

          await tx`
            INSERT INTO source_file_provenance (canonical_source_file_id, mirror, mirror_sha256, mirror_relative_path)
            VALUES (${canonicalFileId}, ${physical.source.mirror}, ${physical.source.sha256}, ${physical.source.relativePath})
            ON CONFLICT (canonical_source_file_id, mirror) DO UPDATE SET
              mirror_sha256 = EXCLUDED.mirror_sha256,
              mirror_relative_path = EXCLUDED.mirror_relative_path
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
                ${physical.source.mirror},
                ${physical.source.relativePath},
                ${physical.source.sha256},
                ${batchId}
              )
              ON CONFLICT DO NOTHING
            `;
          }

          await bulkInsertSourceMetricRows(tx as unknown as Sql, batchId, physicalFileId, physical.stagingRows);
          await bulkInsertConflicts(
            tx as unknown as Sql,
            batchId,
            physicalFileId,
            bundle.group.fileKind,
            bundle.group.entityKey,
            physical.issues,
          );
        }

        if (!writeCanonical || bundle.skipCanonicalWrite) continue;

        const followers = bundle.followers as import('./metric-rows').FollowerSample[];
        if (followers.length > 0) {
          maybeFailCanonicalWrite(opts, (canonicalWrites += followers.length));
          await bulkInsertFollowerSamples(
            tx as unknown as Sql,
            batchId,
            canonicalFileId,
            opts.sourceTimezone,
            followers,
          );
          for (const s of followers) touchCoverage(report, 'follower', s.sampledAt);
        }
        const videos = bundle.videos as import('./metric-rows').VideoSample[];
        if (videos.length > 0) {
          maybeFailCanonicalWrite(opts, (canonicalWrites += videos.length));
          await bulkInsertVideoSamples(
            tx as unknown as Sql,
            batchId,
            canonicalFileId,
            opts.sourceTimezone,
            videos,
          );
          for (const s of videos) touchCoverage(report, 'views', s.sampledAt);
        }
        const dynamics = bundle.dynamics as import('./metric-rows').DynamicSample[];
        if (dynamics.length > 0) {
          maybeFailCanonicalWrite(opts, (canonicalWrites += dynamics.length));
          await bulkInsertDynamicSamples(
            tx as unknown as Sql,
            batchId,
            canonicalFileId,
            opts.sourceTimezone,
            dynamics,
          );
          for (const s of dynamics) touchCoverage(report, 'detailcount', s.sampledAt);
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

      const afterFp = writeCanonical
        ? await fingerprintBusinessData(tx as unknown as Sql)
        : beforeFp;
      report.noOp =
        writeCanonical &&
        canonicalGroupsPending === 0 &&
        report.skippedAlreadyApplied > 0 &&
        beforeFp === afterFp;

      await tx`
        UPDATE import_batches
        SET status = 'completed', completed_at = now(), report_json = ${JSON.stringify(report)}::jsonb, content_fingerprint = ${afterFp}
        WHERE id = ${batchId}
      `;
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'import failed';
    report.anomalies.push(message);
    await opts.sql`
      INSERT INTO import_batches (id, mode, source_timezone, status, importer_version, report_json, error_message, completed_at)
      VALUES (
        ${batchId},
        ${opts.mode},
        ${opts.sourceTimezone},
        'failed',
        ${IMPORTER_VERSION},
        ${JSON.stringify(report)}::jsonb,
        ${message},
        now()
      )
      ON CONFLICT (id) DO UPDATE SET
        status = 'failed',
        error_message = EXCLUDED.error_message,
        report_json = EXCLUDED.report_json,
        completed_at = now()
    `;
    return {
      inventory,
      report,
      markdown: reportToMarkdown(report),
      batchId,
      failed: true,
    };
  }

  return { inventory, report, markdown: reportToMarkdown(report), batchId };
}

function maybeFailCanonicalWrite(opts: ImportOptions, canonicalWrites: number): void {
  if (
    opts.testFailAfterCanonicalWrites != null &&
    canonicalWrites > opts.testFailAfterCanonicalWrites
  ) {
    throw new Error('test_fail_after_canonical_writes');
  }
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
