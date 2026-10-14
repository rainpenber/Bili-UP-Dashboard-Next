import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from './migrate';
import { createEmptyIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

const legacyDir = join(import.meta.dir, '../test/legacy_wp004');

async function applyLegacyHistoricalPath(
  db: NonNullable<Awaited<ReturnType<typeof createEmptyIsolatedTestDatabase>>>['sql'],
) {
  for (const file of [
    '001_monitoring.sql',
    '002_import_evidence.sql',
    '003_video_comment_count.sql',
  ]) {
    const body = readFileSync(join(import.meta.dir, '../migrations', file), 'utf8');
    await db.unsafe(body);
  }
  await db.unsafe(readFileSync(join(legacyDir, '004_projects_workflow.sql'), 'utf8'));
  await db.unsafe(readFileSync(join(legacyDir, '005_open_item_node_integrity.sql'), 'utf8'));
  await db.unsafe(readFileSync(join(legacyDir, '006_upgrade_fixture.sql'), 'utf8'));
}

describe('WP-004 legacy upgrade path', () => {
  test('real historical 004/005 then commercial migrations succeed', async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated) return;

    const legacyDb = isolated.sql;
    try {
      await applyLegacyHistoricalPath(legacyDb);
      await runMigrations(legacyDb);

      const projects = await legacyDb<{ c: string }[]>`
        SELECT count(*)::text AS c FROM commercial_projects WHERE id = '99999999-9999-4999-8999-999999999901'
      `;
      expect(projects[0]?.c).toBe('1');

      const wfTpl = await legacyDb<{ template_version_id: string }[]>`
        SELECT template_version_id FROM project_workflows WHERE project_id = '99999999-9999-4999-8999-999999999901'
      `;
      expect(wfTpl[0]?.template_version_id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

      const defaultTpl = await legacyDb<{ c: string }[]>`
        SELECT count(*)::text AS c FROM wf_template_versions WHERE id = 'ffff1111-1111-4111-8111-111111111111'
      `;
      expect(Number(defaultTpl[0]?.c)).toBe(1);

      const tplEdges = await legacyDb<{ c: string }[]>`
        SELECT count(*)::text AS c FROM wf_template_edges
        WHERE template_version_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
      `;
      expect(Number(tplEdges[0]?.c)).toBeGreaterThanOrEqual(7);

      const nodes = await legacyDb<{ c: string }[]>`
        SELECT count(*)::text AS c FROM wf_nodes WHERE workflow_id = '99999999-9999-4999-8999-999999999902'
      `;
      expect(Number(nodes[0]?.c)).toBe(2);

      const items = await legacyDb<{ title: string }[]>`
        SELECT title FROM open_items WHERE id = '99999999-9999-4999-8999-999999999905'
      `;
      expect(items[0]?.title).toBe('Legacy 待办');

      const history = await legacyDb<
        { node_id: string; to_status: string; detail: { note?: string } | null; changed_at: Date }[]
      >`
        SELECT node_id, to_status, detail, changed_at FROM wf_node_status_history
        WHERE project_id = '99999999-9999-4999-8999-999999999901'
          AND node_id = '99999999-9999-4999-8999-999999999904'
      `;
      expect(history.length).toBe(1);
      expect(history[0]?.to_status).toBe('in_progress');
      expect(history[0]?.detail?.note).toBe('Legacy 状态备注：甲方已确认大纲方向');
      expect(history[0]?.changed_at.toISOString()).toBe('2020-06-15T08:30:00.000Z');

      const legacyTable = await legacyDb<{ reg: string | null }[]>`
        SELECT to_regclass('public._legacy_wp004_projects')::text AS reg
      `;
      expect(legacyTable[0]?.reg).not.toBeNull();
    } finally {
      await legacyDb.end({ timeout: 5 });
      await dropIsolatedTestDatabase(isolated.databaseName);
    }
  }, 120_000);

  test('minimal legacy fixture still upgrades', async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated) return;

    const legacyDb = isolated.sql;
    try {
      for (const file of [
        '001_monitoring.sql',
        '002_import_evidence.sql',
        '003_video_comment_count.sql',
      ]) {
        const body = readFileSync(join(import.meta.dir, '../migrations', file), 'utf8');
        await legacyDb.unsafe(body);
      }
      const legacySeed = readFileSync(
        join(import.meta.dir, '../test/legacy_wp004_minimal.sql'),
        'utf8',
      );
      await legacyDb.unsafe(legacySeed);
      await runMigrations(legacyDb);
      const edges = await legacyDb<{ c: string }[]>`
        SELECT count(*)::text AS c FROM wf_edges WHERE workflow_id IN (
          SELECT id FROM project_workflows WHERE project_id = '99999999-9999-4999-8999-999999999901'
        )
      `;
      expect(Number(edges[0]?.c)).toBeGreaterThanOrEqual(1);
    } finally {
      await legacyDb.end({ timeout: 5 });
      await dropIsolatedTestDatabase(isolated.databaseName);
    }
  }, 120_000);
});
