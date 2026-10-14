import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createSql, postgresAvailable, runMigrations } from '@studio/db';
import { countHeldImportAdvisoryLocks } from './import-advisory';
import { runImport } from './import-run';
import { writeScaleMockDataTree } from './scale-fixture';

/** 101+101 tree with modest row counts — validates bulk path without 309k-row runtime. */
const SCALE_ROWS_PER_FILE = 12;
/** Dry-run + apply against real PostgreSQL can exceed Bun's default 5s test timeout. */
const SCALE_IMPORT_TEST_TIMEOUT_MS = 180_000;
const CONCURRENT_IMPORT_TEST_TIMEOUT_MS = 120_000;

describe('import advisory lock lifecycle', () => {
  let sql: ReturnType<typeof createSql> | null = null;
  let scaleRoot = '';
  const mockRoot = join(import.meta.dir, '../fixtures/mock-data');
  const backendRoot = join(mockRoot, 'backend');
  const frontendRoot = join(mockRoot, 'frontend');
  const assetsRoot = join(mockRoot, 'assets');

  beforeAll(async () => {
    if (!(await postgresAvailable())) return;
    sql = createSql();
    await runMigrations(sql);
    scaleRoot = mkdtempSync(join(tmpdir(), 'mock-scale-'));
    writeScaleMockDataTree(scaleRoot, { rowsPerFile: SCALE_ROWS_PER_FILE });
  });

  afterAll(async () => {
    if (scaleRoot) rmSync(scaleRoot, { recursive: true, force: true });
    if (sql) await sql.end({ timeout: 5 });
  });

  async function truncateAll() {
    if (!sql) return;
    await sql`
      TRUNCATE source_metric_rows, import_conflicts_or_rejects, source_file_provenance, source_files,
        applied_canonical_sources, applied_source_provenance, applied_source_files,
        creator_follower_samples, video_metric_samples, dynamic_metric_samples,
        static_assets, creators, videos, dynamics, import_batches RESTART IDENTITY CASCADE
    `;
  }

  test('releases advisory lock after failed apply', async () => {
    if (!sql) return;
    await truncateAll();
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
    expect(await countHeldImportAdvisoryLocks(sql)).toBe(0);
  });

  test(
    'concurrent imports do not deadlock',
    async () => {
      if (!sql) return;
      await truncateAll();
      const scaleBackend = join(scaleRoot, 'backend');
      const scaleFrontend = join(scaleRoot, 'frontend');
      const scaleAssets = join(scaleRoot, 'assets');

      const race = Promise.race([
        (async () => {
          const first = runImport({
            mode: 'dry_run',
            mockDataRoot: scaleRoot,
            backendRoot: scaleBackend,
            frontendRoot: scaleFrontend,
            assetsRoot: scaleAssets,
            sourceTimezone: 'Asia/Shanghai',
            sql,
          });
          const second = runImport({
            mode: 'dry_run',
            mockDataRoot: scaleRoot,
            backendRoot: scaleBackend,
            frontendRoot: scaleFrontend,
            assetsRoot: scaleAssets,
            sourceTimezone: 'Asia/Shanghai',
            sql,
          });
          const [a, b] = await Promise.all([first, second]);
          expect(a.failed).toBeFalsy();
          expect(b.failed).toBeFalsy();
        })(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('concurrent imports timed out after 120s')), 120_000),
        ),
      ]);
      await race;
      expect(await countHeldImportAdvisoryLocks(sql)).toBe(0);
    },
    { timeout: CONCURRENT_IMPORT_TEST_TIMEOUT_MS },
  );

  test(
    '101+101 scale dry-run and apply complete',
    async () => {
      if (!sql) return;
      await truncateAll();
      const scaleBackend = join(scaleRoot, 'backend');
      const scaleFrontend = join(scaleRoot, 'frontend');
      const scaleAssets = join(scaleRoot, 'assets');

      const dry = await runImport({
        mode: 'dry_run',
        mockDataRoot: scaleRoot,
        backendRoot: scaleBackend,
        frontendRoot: scaleFrontend,
        assetsRoot: scaleAssets,
        sourceTimezone: 'Asia/Shanghai',
        sql,
      });
      expect(dry.failed).toBeFalsy();
      expect(dry.report.inventorySummary.backend.fileCount).toBe(101);
      expect(dry.report.inventorySummary.frontend.fileCount).toBe(101);
      expect(dry.report.inventorySummary.mirrors.exactSha256Matches).toBe(100);
      expect(dry.report.stagingRows).toBe(dry.report.physicalMetricRows);

      const apply = await runImport({
        mode: 'apply',
        mockDataRoot: scaleRoot,
        backendRoot: scaleBackend,
        frontendRoot: scaleFrontend,
        assetsRoot: scaleAssets,
        sourceTimezone: 'Asia/Shanghai',
        sql,
      });
      expect(apply.failed).toBeFalsy();
      expect(apply.report.inventorySummary.mirrors.backendOnlyCommentlistFiles).toBe(1);
      expect(apply.report.inventorySummary.mirrors.frontendOnlyViewsFiles).toBe(1);
    },
    { timeout: SCALE_IMPORT_TEST_TIMEOUT_MS },
  );
});
