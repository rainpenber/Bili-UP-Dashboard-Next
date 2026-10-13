import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildConnectionString, readDbConfigFromEnv } from './config';
import { createSql } from './client';
import { runMigrations } from './migrate';
import { postgresAvailable } from './postgres-available';

describe('WP-004 legacy upgrade path', () => {
  test('004–009 preserves legacy projects, nodes, items, proposals', async () => {
    if (!(await postgresAvailable())) return;

    const cfg = readDbConfigFromEnv();
    const admin = createSql();
    const dbName = `wp004_upg_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    try {
      await admin.unsafe(`CREATE DATABASE "${dbName}"`);
    } catch (err) {
      await admin.end({ timeout: 5 });
      // Shared CI Postgres may forbid CREATE DATABASE; skip instead of mutating public schema.
      if (process.env.CI) return;
      throw err;
    }
    await admin.end({ timeout: 5 });

    const legacyDb = createSql(buildConnectionString({ ...cfg, database: dbName }));
    const adminDrop = createSql();
    try {
      for (const file of ['001_monitoring.sql', '002_import_evidence.sql', '003_video_comment_count.sql']) {
        const body = readFileSync(join(import.meta.dir, '../migrations', file), 'utf8');
        await legacyDb.unsafe(body);
      }
      const legacySeed = readFileSync(join(import.meta.dir, '../test/legacy_wp004_minimal.sql'), 'utf8');
      await legacyDb.unsafe(legacySeed);
      await runMigrations(legacyDb);
      const projects = await legacyDb<{ c: string }[]>`
        SELECT count(*)::text AS c FROM commercial_projects WHERE id = '99999999-9999-4999-8999-999999999901'
      `;
      expect(projects[0]?.c).toBe('1');
      const nodes = await legacyDb<{ c: string }[]>`
        SELECT count(*)::text AS c FROM wf_nodes WHERE workflow_id = '99999999-9999-4999-8999-999999999902'
      `;
      expect(Number(nodes[0]?.c)).toBe(2);
      const items = await legacyDb<{ title: string }[]>`
        SELECT title FROM open_items WHERE id = '99999999-9999-4999-8999-999999999905'
      `;
      expect(items[0]?.title).toBe('Legacy 待办');
      const proposals = await legacyDb<{ c: string }[]>`
        SELECT count(*)::text AS c FROM hermes_write_proposals WHERE id = '99999999-9999-4999-8999-999999999906'
      `;
      expect(proposals[0]?.c).toBe('1');
      const edges = await legacyDb<{ c: string }[]>`
        SELECT count(*)::text AS c FROM wf_edges WHERE workflow_id IN (
          SELECT id FROM project_workflows WHERE project_id = '99999999-9999-4999-8999-999999999901'
        )
      `;
      expect(Number(edges[0]?.c)).toBeGreaterThanOrEqual(1);
    } finally {
      await legacyDb.end({ timeout: 5 });
      await adminDrop.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
      await adminDrop.end({ timeout: 5 });
    }
  }, 120_000);
});
