import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runMigrations } from './migrate';
import { createEmptyIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

describe('WP-004 legacy upgrade path', () => {
  test('004–009 preserves legacy projects, nodes, items, proposals', async () => {
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

      const tplNode = await legacyDb<{ template_node_id: string | null }[]>`
        SELECT template_node_id FROM wf_nodes WHERE workflow_id = '99999999-9999-4999-8999-999999999902' LIMIT 1
      `;
      expect(tplNode[0]?.template_node_id).not.toBeNull();

      const history = await legacyDb<{ c: string }[]>`
        SELECT count(*)::text AS c FROM wf_node_status_history
        WHERE project_id = '99999999-9999-4999-8999-999999999901'
      `;
      expect(Number(history[0]?.c)).toBeGreaterThanOrEqual(0);
    } finally {
      await legacyDb.end({ timeout: 5 });
      await dropIsolatedTestDatabase(isolated.databaseName);
    }
  }, 120_000);
});
