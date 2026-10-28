import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sql } from './client';
import { runMigrations } from './migrate';
import { assertIntegrationSql, isPostgresRequiredEnv } from './require-postgres';
import { createEmptyIsolatedTestDatabase, dropIsolatedTestDatabase } from './test-isolated-db';

describe('commercial migrations', () => {
  let sql: Sql | null = null;
  let databaseName: string | null = null;

  beforeAll(async () => {
    const isolated = await createEmptyIsolatedTestDatabase();
    if (!isolated && isPostgresRequiredEnv()) {
      throw new Error('PostgreSQL required in CI but isolated database setup failed');
    }
    sql = isolated?.sql ?? null;
    databaseName = isolated?.databaseName ?? null;
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('runMigrations is idempotent and seeds default template once', async () => {
    assertIntegrationSql(sql);
    const first = await runMigrations(sql);
    expect(first.some((v) => v.startsWith('004_commercial'))).toBe(true);

    const [countsAfterFirst] = await sql<{ nodes: string; edges: string; versions: string }[]>`
      SELECT
        (SELECT count(*)::text FROM wf_template_nodes WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111') AS nodes,
        (SELECT count(*)::text FROM wf_template_edges WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111') AS edges,
        (SELECT count(*)::text FROM wf_template_versions) AS versions
    `;
    expect(Number(countsAfterFirst?.nodes)).toBe(15);
    expect(Number(countsAfterFirst?.edges)).toBe(16);

    const second = await runMigrations(sql);
    expect(second.length).toBe(0);

    const [countsAfterSecond] = await sql<{ nodes: string; edges: string }[]>`
      SELECT
        (SELECT count(*)::text FROM wf_template_nodes WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111') AS nodes,
        (SELECT count(*)::text FROM wf_template_edges WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111') AS edges
    `;
    expect(countsAfterSecond?.nodes).toBe(countsAfterFirst?.nodes);
    expect(countsAfterSecond?.edges).toBe(countsAfterFirst?.edges);
  });

  test('028 adds 剪辑 to existing projects idempotently and rewires the production edges', async () => {
    assertIntegrationSql(sql);
    const projectId = 'f0120001-0001-4001-8001-000000000001';
    const workflowId = 'f0120002-0001-4001-8001-000000000002';
    await sql`
      INSERT INTO commercial_projects (id, name) VALUES (${projectId}, 'edit migration fixture')
    `;
    await sql`
      INSERT INTO project_workflows (id, project_id, template_version_id)
      VALUES (${workflowId}, ${projectId}, 'ffff1111-1111-4111-8111-111111111111')
    `;
    await sql`
      INSERT INTO wf_packages (id, workflow_id, name, sort_order)
      SELECT gen_random_uuid(), ${workflowId}, p.name, p.sort_order
      FROM wf_template_packages p
      WHERE p.template_version_id = 'ffff1111-1111-4111-8111-111111111111'
    `;

    // Build the pre-028 instance: no 剪辑, production bypasses straight to 审核.
    await sql`
      INSERT INTO wf_nodes (
        id, workflow_id, project_id, template_version_id, template_node_id, package_id,
        name, kind, phase, status, is_optional, pos_x, pos_y, source
      )
      SELECT
        gen_random_uuid(), ${workflowId}, ${projectId}, tn.template_version_id, tn.id,
        p.id, tn.name, tn.kind, tn.phase, 'not_reached', tn.is_optional, tn.pos_x, tn.pos_y,
        'template'
      FROM wf_template_nodes tn
      LEFT JOIN wf_template_packages tp
        ON tp.template_version_id = tn.template_version_id AND tp.id = tn.package_id
      LEFT JOIN wf_packages p
        ON p.workflow_id = ${workflowId} AND p.name = tp.name
      WHERE tn.template_version_id = 'ffff1111-1111-4111-8111-111111111111'
        AND tn.slug <> 'edit'
    `;
    await sql`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      SELECT gen_random_uuid(), CAST(${workflowId} AS uuid), f.id, t.id
      FROM wf_template_edges e
      JOIN wf_nodes f ON f.template_node_id = e.from_node_id AND f.workflow_id = ${workflowId}
      JOIN wf_nodes t ON t.template_node_id = e.to_node_id AND t.workflow_id = ${workflowId}
      WHERE e.template_version_id = 'ffff1111-1111-4111-8111-111111111111'
        AND e.from_node_id NOT IN (
          SELECT id FROM wf_template_nodes
          WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111' AND slug = 'edit'
        )
        AND e.to_node_id NOT IN (
          SELECT id FROM wf_template_nodes
          WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111' AND slug = 'edit'
        )
    `;
    await sql`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      SELECT gen_random_uuid(), CAST(${workflowId} AS uuid), f.id, t.id
      FROM wf_nodes f, wf_nodes t
      WHERE f.workflow_id = ${workflowId}
        AND t.workflow_id = ${workflowId}
        AND f.template_node_id = (
          SELECT id FROM wf_template_nodes
          WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111' AND slug = 'a_roll'
        )
        AND t.template_node_id = (
          SELECT id FROM wf_template_nodes
          WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111' AND slug = 'review'
        )
      UNION ALL
      SELECT gen_random_uuid(), CAST(${workflowId} AS uuid), f.id, t.id
      FROM wf_nodes f, wf_nodes t
      WHERE f.workflow_id = ${workflowId}
        AND t.workflow_id = ${workflowId}
        AND f.template_node_id = (
          SELECT id FROM wf_template_nodes
          WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111' AND slug = 'b_roll'
        )
        AND t.template_node_id = (
          SELECT id FROM wf_template_nodes
          WHERE template_version_id = 'ffff1111-1111-4111-8111-111111111111' AND slug = 'review'
        )
    `;

    const [before] = await sql<{ nodes: string }[]>`
      SELECT count(*)::text AS nodes FROM wf_nodes WHERE workflow_id = ${workflowId}
    `;
    expect(Number(before?.nodes)).toBe(14);

    const migration = readFileSync(
      join(import.meta.dir, '../migrations/028_add_edit_node.sql'),
      'utf8',
    );
    await sql.unsafe(migration);
    await sql.unsafe(migration);

    const [after] = await sql<{ nodes: string; edits: string }[]>`
      SELECT
        count(*)::text AS nodes,
        count(*) FILTER (WHERE t.slug = 'edit')::text AS edits
      FROM wf_nodes n
      JOIN wf_template_nodes t
        ON t.id = n.template_node_id AND t.template_version_id = n.template_version_id
      WHERE n.workflow_id = ${workflowId}
    `;
    expect(Number(after?.nodes)).toBe(15);
    expect(Number(after?.edits)).toBe(1);

    const [editNode] = await sql<{ id: string; status: string; package_id: string | null }[]>`
      SELECT n.id, n.status, n.package_id
      FROM wf_nodes n
      JOIN wf_template_nodes t
        ON t.id = n.template_node_id AND t.template_version_id = n.template_version_id
      WHERE n.workflow_id = ${workflowId} AND t.slug = 'edit'
    `;
    expect(editNode?.status).toBe('not_reached');
    expect(editNode?.package_id).not.toBeNull();

    const links = await sql<{ from_slug: string; to_slug: string }[]>`
      SELECT ft.slug AS from_slug, tt.slug AS to_slug
      FROM wf_edges e
      JOIN wf_nodes f ON f.id = e.from_node_id
      JOIN wf_template_nodes ft ON ft.id = f.template_node_id
      JOIN wf_nodes t ON t.id = e.to_node_id
      JOIN wf_template_nodes tt ON tt.id = t.template_node_id
      WHERE e.workflow_id = ${workflowId}
        AND (ft.slug = 'edit' OR tt.slug = 'edit')
    `;
    expect(links.map((link) => `${link.from_slug}->${link.to_slug}`).sort()).toEqual([
      'a_roll->edit',
      'b_roll->edit',
      'edit->ai_post',
    ]);

    const bypasses = await sql<{ from_slug: string; to_slug: string }[]>`
      SELECT ft.slug AS from_slug, tt.slug AS to_slug
      FROM wf_edges e
      JOIN wf_nodes f ON f.id = e.from_node_id
      JOIN wf_template_nodes ft ON ft.id = f.template_node_id
      JOIN wf_nodes t ON t.id = e.to_node_id
      JOIN wf_template_nodes tt ON tt.id = t.template_node_id
      WHERE e.workflow_id = ${workflowId}
        AND ft.slug IN ('a_roll', 'b_roll')
        AND tt.slug IN ('ai_post', 'review')
    `;
    expect(bypasses.length).toBe(0);
  }, 30_000);
});
