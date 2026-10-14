import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import type { Sql } from './client';
import { assertIntegrationSql, isPostgresRequiredEnv } from './require-postgres';
import { createIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

const DEFAULT_TEMPLATE = 'ffff1111-1111-4111-8111-111111111111';

async function expectDbError(fn: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  let thrown: unknown;
  try {
    await fn();
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeDefined();
  const message =
    thrown instanceof Error
      ? thrown.message
      : typeof thrown === 'object' && thrown !== null && 'message' in thrown
        ? String((thrown as { message: unknown }).message)
        : String(thrown);
  expect(message).toMatch(pattern);
}

async function seedMinimalProject(
  sql: Sql,
  projectId: string,
  workflowId: string,
  nodeIds: [string, string, string],
): Promise<void> {
  await sql`
    INSERT INTO commercial_projects (id, name) VALUES (${projectId}, ${'Test ' + projectId.slice(0, 8)})
  `;
  await sql`
    INSERT INTO project_workflows (id, project_id, template_version_id)
    VALUES (${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE})
  `;
  for (let i = 0; i < nodeIds.length; i++) {
    const nodeId = nodeIds[i]!;
    await sql`
      INSERT INTO wf_nodes (id, workflow_id, project_id, template_version_id, name, is_optional)
      VALUES (${nodeId}, ${workflowId}, ${projectId}, ${DEFAULT_TEMPLATE}, ${'N' + i}, FALSE)
    `;
  }
}

describe('commercial domain DB invariants', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createIsolatedTestDatabase();
    if (!isolated && isPostgresRequiredEnv()) {
      throw new Error('PostgreSQL required in CI but isolated database setup failed');
    }
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('default template seed counts are stable', async () => {
    assertIntegrationSql(sql);
    const [row] = await sql<{ nodes: string; edges: string }[]>`
      SELECT
        (SELECT count(*)::text FROM wf_template_nodes WHERE template_version_id = ${DEFAULT_TEMPLATE}) AS nodes,
        (SELECT count(*)::text FROM wf_template_edges WHERE template_version_id = ${DEFAULT_TEMPLATE}) AS edges
    `;
    expect(Number(row?.nodes)).toBe(13);
    expect(Number(row?.edges)).toBe(15);
  });

  test('rejects cross-project open item node reference', async () => {
    assertIntegrationSql(sql);
    const p1 = 'a1000001-0001-4001-8001-000000000001';
    const p2 = 'a1000001-0001-4001-8001-000000000002';
    const w1 = 'a2000001-0001-4001-8001-000000000001';
    const w2 = 'a2000001-0001-4001-8001-000000000002';
    const n1 = 'a3000001-0001-4001-8001-000000000001';
    const n2 = 'a3000001-0001-4001-8001-000000000002';
    await seedMinimalProject(sql, p1, w1, [
      n1,
      'a3000001-0001-4001-8001-000000000011',
      'a3000001-0001-4001-8001-000000000012',
    ]);
    await seedMinimalProject(sql, p2, w2, [
      n2,
      'a3000001-0001-4001-8001-000000000021',
      'a3000001-0001-4001-8001-000000000022',
    ]);

    await expectDbError(
      () => sql!`
        INSERT INTO open_items (id, project_id, workflow_node_id, title)
        VALUES (${'a4000001-0001-4001-8001-000000000001'}, ${p1}, ${n2}, 'cross project')
      `,
      /foreign key|violates foreign key constraint/i,
    );
  });

  test('rejects workflow edge across different workflow instances', async () => {
    assertIntegrationSql(sql);
    const p1 = 'b1000001-0001-4001-8001-000000000001';
    const p2 = 'b1000001-0001-4001-8001-000000000002';
    const w1 = 'b2000001-0001-4001-8001-000000000001';
    const w2 = 'b2000001-0001-4001-8001-000000000002';
    const n1a = 'b3000001-0001-4001-8001-000000000001';
    const n2a = 'b3000001-0001-4001-8001-000000000002';
    const nOther = 'b3000001-0001-4001-8001-000000000099';
    await seedMinimalProject(sql, p1, w1, [n1a, n2a, 'b3000001-0001-4001-8001-000000000003']);
    await seedMinimalProject(sql, p2, w2, [
      nOther,
      'b3000001-0001-4001-8001-000000000004',
      'b3000001-0001-4001-8001-000000000005',
    ]);

    await expectDbError(
      () => sql!`
        INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
        VALUES (${'b4000001-0001-4001-8001-000000000001'}, ${w1}, ${n1a}, ${nOther})
      `,
      /foreign key|violates foreign key constraint/i,
    );
  });

  test('rejects instance workflow edge cycle', async () => {
    assertIntegrationSql(sql);
    const p = 'c1000001-0001-4001-8001-000000000001';
    const w = 'c2000001-0001-4001-8001-000000000001';
    const n0 = 'c3000001-0001-4001-8001-000000000001';
    const n1 = 'c3000001-0001-4001-8001-000000000002';
    const n2 = 'c3000001-0001-4001-8001-000000000003';
    await seedMinimalProject(sql, p, w, [n0, n1, n2]);
    await sql`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id) VALUES
        (${'c4000001-0001-4001-8001-000000000001'}, ${w}, ${n0}, ${n1}),
        (${'c4000001-0001-4001-8001-000000000002'}, ${w}, ${n1}, ${n2})
    `;

    await expectDbError(
      () => sql!`
        INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
        VALUES (${'c4000001-0001-4001-8001-000000000003'}, ${w}, ${n2}, ${n0})
      `,
      /cycle/i,
    );
  });

  test('rejects self-loop edge via check constraint', async () => {
    assertIntegrationSql(sql);
    const p = 'd1000001-0001-4001-8001-000000000001';
    const w = 'd2000001-0001-4001-8001-000000000001';
    const n0 = 'd3000001-0001-4001-8001-000000000001';
    await seedMinimalProject(sql, p, w, [
      n0,
      'd3000001-0001-4001-8001-000000000002',
      'd3000001-0001-4001-8001-000000000003',
    ]);

    await expectDbError(
      () => sql!`
        INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
        VALUES (${'d4000001-0001-4001-8001-000000000001'}, ${w}, ${n0}, ${n0})
      `,
      /check constraint|wf_edges_check|cycle/i,
    );
  });

  test('rejects not_applicable on required node', async () => {
    assertIntegrationSql(sql);
    const p = 'e1000001-0001-4001-8001-000000000001';
    const w = 'e2000001-0001-4001-8001-000000000001';
    const n0 = 'e3000001-0001-4001-8001-000000000001';
    await seedMinimalProject(sql, p, w, [
      n0,
      'e3000001-0001-4001-8001-000000000002',
      'e3000001-0001-4001-8001-000000000003',
    ]);

    await expectDbError(
      () => sql!`UPDATE wf_nodes SET status = 'not_applicable' WHERE id = ${n0}`,
      /check constraint|wf_nodes_check/i,
    );
  });

  test('allows not_applicable only on optional nodes', async () => {
    assertIntegrationSql(sql);
    const p = 'f1000001-0001-4001-8001-000000000001';
    const w = 'f2000001-0001-4001-8001-000000000001';
    const n0 = 'f3000001-0001-4001-8001-000000000001';
    await seedMinimalProject(sql, p, w, [
      n0,
      'f3000001-0001-4001-8001-000000000002',
      'f3000001-0001-4001-8001-000000000003',
    ]);
    await sql`UPDATE wf_nodes SET is_optional = TRUE WHERE id = ${n0}`;
    await sql`UPDATE wf_nodes SET status = 'not_applicable' WHERE id = ${n0}`;
    const [row] = await sql<{ status: string }[]>`SELECT status FROM wf_nodes WHERE id = ${n0}`;
    expect(row?.status).toBe('not_applicable');
  });

  test('published template version and children are immutable', async () => {
    assertIntegrationSql(sql);
    await expectDbError(
      () => sql!`
        UPDATE wf_template_nodes SET name = 'mutated' WHERE id = 'dddddddd-dddd-4ddd-8ddd-ddddddddd001'
      `,
      /immutable/i,
    );

    const draftId = 'f5000001-0001-4001-8001-000000000001';
    await sql`
      INSERT INTO wf_template_versions (id, slug, name, version, is_draft, is_default, published_at)
      VALUES (${draftId}, 'draft_only', 'Draft', 1, TRUE, FALSE, NULL)
    `;
    const draftNode = 'f5000002-0001-4001-8001-000000000002';
    await sql`
      INSERT INTO wf_template_nodes (id, template_version_id, slug, name)
      VALUES (${draftNode}, ${draftId}, 'step_a', 'Step A')
    `;
    await sql`
      UPDATE wf_template_versions SET is_draft = FALSE, published_at = now() WHERE id = ${draftId}
    `;
    await expectDbError(
      () => sql!`UPDATE wf_template_nodes SET name = 'nope' WHERE id = ${draftNode}`,
      /immutable/i,
    );
  });

  test('rejects cross-version template edge endpoints', async () => {
    assertIntegrationSql(sql);
    const v2 = 'f6000001-0001-4001-8001-000000000001';
    const nV2 = 'f6000002-0001-4001-8001-000000000002';
    await sql`
      INSERT INTO wf_template_versions (id, slug, name, version, is_draft, is_default, published_at)
      VALUES (${v2}, 'draft_only_2', 'Draft 2', 2, TRUE, FALSE, NULL)
    `;
    await sql`
      INSERT INTO wf_template_nodes (id, template_version_id, slug, name)
      VALUES (${nV2}, ${v2}, 'only', 'Only')
    `;

    await expectDbError(
      () => sql!`
        INSERT INTO wf_template_edges (id, template_version_id, from_node_id, to_node_id)
        VALUES (
          ${'f6000003-0001-4001-8001-000000000003'},
          ${v2},
          'dddddddd-dddd-4ddd-8ddd-ddddddddd001',
          ${nV2}
        )
      `,
      /foreign key|violates foreign key constraint/i,
    );
  });

  test('rejects wf_nodes template_version_id mismatch with workflow', async () => {
    assertIntegrationSql(sql);
    const otherVersion = 'f7000001-0001-4001-8001-000000000001';
    await sql`
      INSERT INTO wf_template_versions (id, slug, name, version, is_draft, is_default, published_at)
      VALUES (${otherVersion}, 'other_tpl', 'Other', 9, TRUE, FALSE, NULL)
    `;
    const p = 'f7000002-0001-4001-8001-000000000002';
    const w = 'f7000003-0001-4001-8001-000000000003';
    await seedMinimalProject(sql, p, w, [
      'f7000004-0001-4001-8001-000000000004',
      'f7000005-0001-4001-8001-000000000005',
      'f7000006-0001-4001-8001-000000000006',
    ]);

    await expectDbError(
      () => sql!`
        INSERT INTO wf_nodes (id, workflow_id, project_id, template_version_id, name)
        VALUES (
          ${'f7000007-0001-4001-8001-000000000007'},
          ${w},
          ${p},
          ${otherVersion},
          'wrong version'
        )
      `,
      /template_version_id must match/i,
    );
  });

  test('rejects cross-project primary block pin', async () => {
    assertIntegrationSql(sql);
    const p1 = '01000001-0001-4001-8001-000000000001';
    const p2 = '01000001-0001-4001-8001-000000000002';
    const w1 = '02000001-0001-4001-8001-000000000001';
    const n1 = '03000001-0001-4001-8001-000000000001';
    await seedMinimalProject(sql, p1, w1, [
      n1,
      '03000001-0001-4001-8001-000000000002',
      '03000001-0001-4001-8001-000000000003',
    ]);
    await seedMinimalProject(sql, p2, '02000001-0001-4001-8001-000000000002', [
      '03000001-0001-4001-8001-000000000099',
      '03000001-0001-4001-8001-000000000098',
      '03000001-0001-4001-8001-000000000097',
    ]);
    const itemP2 = '04000001-0001-4001-8001-000000000001';
    await sql`
      INSERT INTO open_items (id, project_id, title) VALUES (${itemP2}, ${p2}, 'other project item')
    `;

    await expectDbError(
      () => sql!`
        UPDATE wf_nodes SET primary_block_pinned_item_id = ${itemP2} WHERE id = ${n1}
      `,
      /foreign key|violates foreign key constraint/i,
    );
  });

  test('deleting pinned open item clears primary block pin via trigger', async () => {
    assertIntegrationSql(sql);
    const p = '11000001-0001-4001-8001-000000000001';
    const w = '12000001-0001-4001-8001-000000000001';
    const n = '13000001-0001-4001-8001-000000000001';
    await seedMinimalProject(sql, p, w, [
      n,
      '13000001-0001-4001-8001-000000000002',
      '13000001-0001-4001-8001-000000000003',
    ]);
    const itemId = '14000001-0001-4001-8001-000000000001';
    await sql`
      INSERT INTO open_items (id, project_id, blocks_node_id, title, impact)
      VALUES (${itemId}, ${p}, ${n}, 'blocker', 'blocking')
    `;
    await sql`UPDATE wf_nodes SET primary_block_pinned_item_id = ${itemId} WHERE id = ${n}`;

    await sql`DELETE FROM open_items WHERE id = ${itemId}`;
    const [row] = await sql<{ pin: string | null }[]>`
      SELECT primary_block_pinned_item_id AS pin FROM wf_nodes WHERE id = ${n}
    `;
    expect(row?.pin).toBeNull();
  });
});
