import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSql, runMigrations } from '@studio/db';
import { runImport } from './import-run';
import { IMPORTER_VERSION } from './importer-version';

const pgAvailable = Boolean(process.env.CI || process.env.POSTGRES_PASSWORD);
const mockRoot = join(import.meta.dir, '../fixtures/mock-data');
const backendRoot = join(mockRoot, 'backend');
const frontendRoot = join(mockRoot, 'frontend');
const assetsRoot = join(mockRoot, 'assets');

async function truncateAll(sql: ReturnType<typeof createSql>) {
  await sql`
    TRUNCATE source_metric_rows, import_conflicts_or_rejects, source_file_provenance, source_files,
      applied_canonical_sources, applied_source_provenance, applied_source_files,
      creator_follower_samples, video_metric_samples, dynamic_metric_samples,
      static_assets, creators, videos, dynamics, import_batches RESTART IDENTITY CASCADE
  `;
}

describe('mirror and canonical grouping', () => {
  test('same SHA different entity yields two canonical groups', async () => {
    const { runInventory } = await import('./inventory');
    const inv = await runInventory({ backendRoot, frontendRoot });
    const g3 = inv.canonicalGroups.find(
      (g) => g.entityKey === 'BVTEST003' && g.fileKind === 'views',
    );
    expect(g3).toBeDefined();
    const g1SameBytes = inv.canonicalGroups.find(
      (g) =>
        g.entityKey === 'BVTEST001' &&
        g.fileKind === 'views' &&
        g.contentSha256 === g3?.contentSha256,
    );
    expect(g1SameBytes).toBeDefined();
    expect(g1SameBytes?.entityKey).not.toBe(g3?.entityKey);
  });

  test('path mirror mismatch detected for divergent same-name file', async () => {
    const { runInventory } = await import('./inventory');
    const inv = await runInventory({ backendRoot, frontendRoot });
    const row = inv.pathMirrors.find((p) => p.relativePath === 'BVTEST001_views.csv');
    expect(row?.backend && row.frontend).toBeTruthy();
    expect(row?.sha256Match).toBe(false);
  });
});

describe('import evidence and idempotency', () => {
  const sql = pgAvailable ? createSql() : null;

  beforeAll(async () => {
    if (!sql) return;
    await runMigrations(sql);
    await truncateAll(sql);
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('preserves all CSV rows in staging including duplicates/conflicts', async () => {
    if (!sql) return;
    await truncateAll(sql);
    const result = await runImport({
      mode: 'dry_run',
      backendRoot,
      frontendRoot,
      assetsRoot,
      sourceTimezone: 'Asia/Shanghai',
      sql,
    });
    expect(result.report.stagingRows).toBeGreaterThan(0);
    const staging = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM source_metric_rows WHERE batch_id = ${result.batchId}
    `;
    expect(staging[0]?.c).toBe(String(result.report.stagingRows));
    const conflicts = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM import_conflicts_or_rejects WHERE batch_id = ${result.batchId}
    `;
    expect(Number(conflicts[0]?.c)).toBeGreaterThan(0);
  });

  test('apply rolls back canonical data on forced failure', async () => {
    if (!sql) return;
    await truncateAll(sql);
    const before = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM video_metric_samples
    `;
    const failed = await runImport({
      mode: 'apply',
      backendRoot,
      frontendRoot,
      assetsRoot,
      sourceTimezone: 'Asia/Shanghai',
      sql,
      testFailAfterCanonicalWrites: 0,
    });
    expect(failed.failed).toBe(true);
    const after = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM video_metric_samples
    `;
    expect(after[0]?.c).toBe(before[0]?.c);
    const applied = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM applied_canonical_sources WHERE importer_version = ${IMPORTER_VERSION}
    `;
    expect(applied[0]?.c).toBe('0');
  });

  test('repeat apply is no-op with stable business fingerprint', async () => {
    if (!sql) return;
    await truncateAll(sql);
    const first = await runImport({
      mode: 'apply',
      backendRoot,
      frontendRoot,
      assetsRoot,
      sourceTimezone: 'Asia/Shanghai',
      sql,
    });
    expect(first.failed).toBeFalsy();
    const fp1 = await sql<{ h: string }[]>`
      SELECT md5(string_agg(bvid || sampled_at::text, ',' ORDER BY bvid, sampled_at)) AS h FROM video_metric_samples
    `;
    const second = await runImport({
      mode: 'apply',
      backendRoot,
      frontendRoot,
      assetsRoot,
      sourceTimezone: 'Asia/Shanghai',
      sql,
    });
    expect(second.report.noOp).toBe(true);
    expect(second.report.skippedAlreadyApplied).toBeGreaterThan(0);
    const fp2 = await sql<{ h: string }[]>`
      SELECT md5(string_agg(bvid || sampled_at::text, ',' ORDER BY bvid, sampled_at)) AS h FROM video_metric_samples
    `;
    expect(fp1[0]?.h).toBe(fp2[0]?.h);
  });

  test('records single-source provenance for backend-only metric file', async () => {
    if (!sql) return;
    await truncateAll(sql);
    const result = await runImport({
      mode: 'apply',
      backendRoot,
      assetsRoot,
      sourceTimezone: 'Asia/Shanghai',
      sql,
    });
    expect(result.failed).toBeFalsy();
    const prov = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM applied_source_provenance WHERE source_role = 'backend'
    `;
    expect(Number(prov[0]?.c)).toBeGreaterThan(0);
  });
});
