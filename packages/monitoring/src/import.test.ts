import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createSql, runMigrations } from '@studio/db';
import { runImport } from './import-run';
import { runInventory } from './inventory';

const fixtureBackend = join(import.meta.dir, '../fixtures/backend');
const fixtureFrontend = join(import.meta.dir, '../fixtures/frontend');

const pgAvailable = Boolean(process.env.POSTGRES_PASSWORD || process.env.CI);

describe('inventory', () => {
  test('lists unsupported commentlist explicitly', async () => {
    const inv = await runInventory({ backendRoot: fixtureBackend, frontendRoot: fixtureFrontend });
    const comment = inv.unsupported.find((u) => u.kind === 'commentlist');
    expect(comment).toBeDefined();
    expect(comment?.note).toContain('unsupported');
    const mirror = inv.groups.find((g) => g.relativePath === 'BVTEST001_views.csv');
    expect(mirror?.sha256Match).toBe(true);
  });
});

describe('import apply idempotency', () => {
  const sql = pgAvailable ? createSql() : null;

  beforeAll(async () => {
    if (!sql) return;
    await runMigrations(sql);
    await sql`TRUNCATE import_conflicts_or_rejects, source_file_provenance, source_files, applied_source_files, creator_follower_samples, video_metric_samples, dynamic_metric_samples, creators, videos, dynamics, import_batches RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  test('apply then re-apply is no-op', async () => {
    if (!sql) {
      expect(true).toBe(true);
      return;
    }
    const first = await runImport({
      mode: 'apply',
      backendRoot: fixtureBackend,
      frontendRoot: fixtureFrontend,
      assetsRoot: join(fixtureFrontend, 'meta'),
      sourceTimezone: 'Asia/Shanghai',
      sql,
    });
    expect(first.report.accepted).toBeGreaterThan(0);
    const fp1 = await sql<{ c: string }[]>`SELECT count(*)::text AS c FROM video_metric_samples`;
    const second = await runImport({
      mode: 'apply',
      backendRoot: fixtureBackend,
      frontendRoot: fixtureFrontend,
      assetsRoot: join(fixtureFrontend, 'meta'),
      sourceTimezone: 'Asia/Shanghai',
      sql,
    });
    expect(second.report.noOp).toBe(true);
    const fp2 = await sql<{ c: string }[]>`SELECT count(*)::text AS c FROM video_metric_samples`;
    expect(fp1[0]?.c).toBe(fp2[0]?.c);
  });
});
