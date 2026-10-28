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
  }, 30_000);

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
    if (databaseName) await dropIsolatedTestDatabase(databaseName);
  });

  test('default template seed is 14 nodes, 16 edges, and one explicit merge', async () => {
    assertIntegrationSql(sql);
    const [counts] = await sql<
      { nodes: string; edges: string; draft: boolean; is_default: boolean }[]
    >`
      SELECT
        (SELECT count(*)::text FROM wf_template_nodes WHERE template_version_id = ${DEFAULT_TEMPLATE}) AS nodes,
        (SELECT count(*)::text FROM wf_template_edges WHERE template_version_id = ${DEFAULT_TEMPLATE}) AS edges,
        v.is_draft AS draft,
        v.is_default AS is_default
      FROM wf_template_versions v
      WHERE v.id = ${DEFAULT_TEMPLATE}
    `;
    expect(Number(counts?.nodes)).toBe(14);
    expect(Number(counts?.edges)).toBe(16);
    expect(counts?.draft).toBe(false);
    expect(counts?.is_default).toBe(true);

    const nodes = await sql<
      { name: string; kind: string; is_optional: boolean; in_package: boolean }[]
    >`
      SELECT name, kind, is_optional, package_id IS NOT NULL AS in_package
      FROM wf_template_nodes
      WHERE template_version_id = ${DEFAULT_TEMPLATE}
    `;
    const merge = nodes.filter((node) => node.kind === 'merge');
    expect(merge).toEqual([
      { name: '汇合节点', kind: 'merge', is_optional: true, in_package: false },
    ]);
    expect(nodes.filter((node) => node.kind === 'stage')).toHaveLength(13);
    expect(
      nodes
        .filter((node) => node.in_package)
        .map((node) => node.name)
        .sort(),
    ).toEqual(['A-roll 拍摄', 'AI 后期', 'B-roll 素材'].sort());

    const edges = await sql<{ from_name: string; to_name: string }[]>`
      SELECT fn.name AS from_name, tn.name AS to_name
      FROM wf_template_edges e
      JOIN wf_template_nodes fn
        ON fn.id = e.from_node_id AND fn.template_version_id = e.template_version_id
      JOIN wf_template_nodes tn
        ON tn.id = e.to_node_id AND tn.template_version_id = e.template_version_id
      WHERE e.template_version_id = ${DEFAULT_TEMPLATE}
    `;
    const pairs = edges.map((edge) => `${edge.from_name}->${edge.to_name}`).sort();
    expect(pairs).toEqual(
      [
        'A-roll 拍摄->审核',
        'AI 后期->审核',
        'B-roll 素材->审核',
        '汇合节点->A-roll 拍摄',
        '汇合节点->AI 后期',
        '汇合节点->B-roll 素材',
        '发布->全平台分发',
        '发布->其他',
        '发布->数据维护',
        '发布->结算',
        '大纲->文案',
        '大纲->预拍摄',
        '审核->发布',
        '文案->汇合节点',
        '询单->大纲',
        '预拍摄->汇合节点',
      ].sort(),
    );
    const segment = pairs.filter(
      (pair) =>
        pair.endsWith('->汇合节点') ||
        pair.startsWith('汇合节点->A-roll 拍摄') ||
        pair.startsWith('汇合节点->B-roll 素材') ||
        pair.startsWith('汇合节点->AI 后期'),
    );
    expect(segment).toHaveLength(5);
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

  test('allows not_applicable on a required node after the optional check is dropped', async () => {
    assertIntegrationSql(sql);
    const p = 'e1000001-0001-4001-8001-000000000001';
    const w = 'e2000001-0001-4001-8001-000000000001';
    const n0 = 'e3000001-0001-4001-8001-000000000001';
    await seedMinimalProject(sql, p, w, [
      n0,
      'e3000001-0001-4001-8001-000000000002',
      'e3000001-0001-4001-8001-000000000003',
    ]);

    const [before] = await sql<{ is_optional: boolean }[]>`
      SELECT is_optional FROM wf_nodes WHERE id = ${n0}
    `;
    expect(before?.is_optional).toBe(false);

    await sql`UPDATE wf_nodes SET status = 'not_applicable' WHERE id = ${n0}`;
    const [row] = await sql<{ status: string }[]>`SELECT status FROM wf_nodes WHERE id = ${n0}`;
    expect(row?.status).toBe('not_applicable');
  });

  test('drops only the optional not_applicable check and keeps the status whitelist', async () => {
    assertIntegrationSql(sql);
    const constraints = await sql<{ conname: string }[]>`
      SELECT conname
      FROM pg_constraint
      WHERE conrelid = 'wf_nodes'::regclass AND contype = 'c'
    `;
    const names = constraints.map((row) => row.conname);
    expect(names).not.toContain('wf_nodes_check');
    expect(names).toContain('wf_nodes_status_check');

    const p = 'e4000001-0001-4001-8001-000000000001';
    const w = 'e5000001-0001-4001-8001-000000000001';
    const n0 = 'e6000001-0001-4001-8001-000000000001';
    await seedMinimalProject(sql, p, w, [
      n0,
      'e6000001-0001-4001-8001-000000000002',
      'e6000001-0001-4001-8001-000000000003',
    ]);
    await expectDbError(
      () => sql!`UPDATE wf_nodes SET status = 'not_a_status' WHERE id = ${n0}`,
      /check constraint|wf_nodes_status_check/i,
    );
  });

  test('still allows not_applicable on an optional node', async () => {
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

  test('rejects unknown node kind and defaults omitted kind to stage', async () => {
    assertIntegrationSql(sql);
    const draftId = 'aa300001-0001-4001-8001-000000000001';
    await sql`
      INSERT INTO wf_template_versions (id, slug, name, version, is_draft, is_default, published_at)
      VALUES (${draftId}, 'kind_probe', 'Kind probe', 1, TRUE, FALSE, NULL)
    `;
    const templateNode = 'aa300002-0001-4001-8001-000000000002';
    await sql`
      INSERT INTO wf_template_nodes (id, template_version_id, slug, name)
      VALUES (${templateNode}, ${draftId}, 'plain', 'Plain')
    `;
    const [draftKind] = await sql<{ kind: string }[]>`
      SELECT kind FROM wf_template_nodes WHERE id = ${templateNode}
    `;
    expect(draftKind?.kind).toBe('stage');
    await expectDbError(
      () => sql!`
        INSERT INTO wf_template_nodes (id, template_version_id, slug, name, kind)
        VALUES (${'aa300003-0001-4001-8001-000000000003'}, ${draftId}, 'bad', 'Bad', 'fan')
      `,
      /wf_template_nodes_kind_check|check constraint/i,
    );

    const projectId = 'aa300004-0001-4001-8001-000000000004';
    const workflowId = 'aa300005-0001-4001-8001-000000000005';
    const nodeId = 'aa300006-0001-4001-8001-000000000006';
    await seedMinimalProject(sql, projectId, workflowId, [
      nodeId,
      'aa300007-0001-4001-8001-000000000007',
      'aa300008-0001-4001-8001-000000000008',
    ]);
    const [instanceKind] = await sql<
      { kind: string }[]
    >`SELECT kind FROM wf_nodes WHERE id = ${nodeId}`;
    expect(instanceKind?.kind).toBe('stage');
    await expectDbError(
      () => sql!`UPDATE wf_nodes SET kind = 'inferred' WHERE id = ${nodeId}`,
      /wf_nodes_kind_check|check constraint/i,
    );
  });

  test('merge node keeps ordinary status, including block without a reason and not_applicable', async () => {
    assertIntegrationSql(sql);
    const projectId = 'aa400001-0001-4001-8001-000000000001';
    const workflowId = 'aa400002-0001-4001-8001-000000000002';
    const nodeId = 'aa400003-0001-4001-8001-000000000003';
    await seedMinimalProject(sql, projectId, workflowId, [
      nodeId,
      'aa400004-0001-4001-8001-000000000004',
      'aa400005-0001-4001-8001-000000000005',
    ]);
    await sql`
      UPDATE wf_nodes
      SET kind = 'merge', is_optional = TRUE
      WHERE id = ${nodeId}
    `;
    await sql`UPDATE wf_nodes SET status = 'in_progress' WHERE id = ${nodeId}`;
    await sql`UPDATE wf_nodes SET status = 'blocked' WHERE id = ${nodeId}`;
    await sql`UPDATE wf_nodes SET status = 'not_applicable' WHERE id = ${nodeId}`;
    const [row] = await sql<{ status: string; kind: string }[]>`
      SELECT status, kind FROM wf_nodes WHERE id = ${nodeId}
    `;
    expect(row).toEqual({ status: 'not_applicable', kind: 'merge' });

    await sql`
      INSERT INTO domain_audit_events (project_id, entity_type, entity_id, action, detail, source)
      VALUES (${projectId}, 'wf_nodes', ${nodeId}, 'status_changed', ${JSON.stringify({ kind: 'merge' })}::jsonb, 'web')
    `;
    const [audit] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c
      FROM domain_audit_events
      WHERE project_id = ${projectId} AND entity_id = ${nodeId} AND action = 'status_changed'
    `;
    expect(Number(audit?.c)).toBe(1);
  });

  test('deletes a referenced template package and keeps template_version_id', async () => {
    assertIntegrationSql(sql);
    const versionId = 'aa100001-0001-4001-8001-000000000001';
    const packageId = 'aa100002-0001-4001-8001-000000000002';
    const nodeId = 'aa100003-0001-4001-8001-000000000003';
    await sql`
      INSERT INTO wf_template_versions (id, slug, name, version, is_draft, is_default, published_at)
      VALUES (${versionId}, 'pkg_delete_template', 'Pkg delete', 1, TRUE, FALSE, NULL)
    `;
    await sql`
      INSERT INTO wf_template_packages (id, template_version_id, name)
      VALUES (${packageId}, ${versionId}, '临时包')
    `;
    await sql`
      INSERT INTO wf_template_nodes (id, template_version_id, package_id, slug, name)
      VALUES (${nodeId}, ${versionId}, ${packageId}, 'inside', '包内节点')
    `;

    await sql`DELETE FROM wf_template_packages WHERE id = ${packageId}`;

    const packages = await sql<{ id: string }[]>`
      SELECT id FROM wf_template_packages WHERE id = ${packageId}
    `;
    expect(packages).toHaveLength(0);
    const [node] = await sql<{ template_version_id: string; package_id: string | null }[]>`
      SELECT template_version_id, package_id FROM wf_template_nodes WHERE id = ${nodeId}
    `;
    expect(node?.template_version_id).toBe(versionId);
    expect(node?.package_id).toBeNull();
  });

  test('deletes a referenced instance package and keeps workflow_id', async () => {
    assertIntegrationSql(sql);
    const projectId = 'aa200001-0001-4001-8001-000000000001';
    const workflowId = 'aa200002-0001-4001-8001-000000000002';
    const packageId = 'aa200003-0001-4001-8001-000000000003';
    const nodeId = 'aa200004-0001-4001-8001-000000000004';
    await seedMinimalProject(sql, projectId, workflowId, [
      nodeId,
      'aa200005-0001-4001-8001-000000000005',
      'aa200006-0001-4001-8001-000000000006',
    ]);
    await sql`
      INSERT INTO wf_packages (id, workflow_id, name)
      VALUES (${packageId}, ${workflowId}, '实例包')
    `;
    await sql`UPDATE wf_nodes SET package_id = ${packageId} WHERE id = ${nodeId}`;

    await sql`DELETE FROM wf_packages WHERE id = ${packageId}`;

    const packages = await sql<
      { id: string }[]
    >`SELECT id FROM wf_packages WHERE id = ${packageId}`;
    expect(packages).toHaveLength(0);
    const [node] = await sql<{ workflow_id: string; package_id: string | null }[]>`
      SELECT workflow_id, package_id FROM wf_nodes WHERE id = ${nodeId}
    `;
    expect(node?.workflow_id).toBe(workflowId);
    expect(node?.package_id).toBeNull();
  });

  test('published template package delete does not clear package membership', async () => {
    assertIntegrationSql(sql);
    const packageId = 'cccccccc-cccc-4ccc-8ccc-cccccccccc01';
    const [before] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_template_nodes WHERE package_id = ${packageId}
    `;
    expect(Number(before?.c)).toBe(3);
    await expectDbError(
      () => sql!`DELETE FROM wf_template_packages WHERE id = ${packageId}`,
      /immutable/i,
    );
    const [pkg] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_template_packages WHERE id = ${packageId}
    `;
    const [after] = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_template_nodes WHERE package_id = ${packageId}
    `;
    expect(Number(pkg?.c)).toBe(1);
    expect(Number(after?.c)).toBe(3);
  });

  test('no ON DELETE SET NULL foreign key includes an owner column', async () => {
    assertIntegrationSql(sql);
    const rows = await sql<{ columns: string[] }[]>`
      SELECT (
        SELECT array_agg(a.attname ORDER BY k.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
      ) AS columns
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.confdeltype = 'n'
    `;
    for (const row of rows) {
      expect(row.columns).not.toContain('template_version_id');
      expect(row.columns).not.toContain('workflow_id');
    }
    const owners = await sql<{ attname: string; attnotnull: boolean }[]>`
      SELECT a.attname, a.attnotnull
      FROM pg_attribute a
      WHERE a.attname IN ('template_version_id', 'workflow_id')
        AND a.attrelid IN ('wf_template_nodes'::regclass, 'wf_nodes'::regclass)
        AND NOT a.attisdropped
    `;
    expect(owners.length).toBeGreaterThan(0);
    for (const owner of owners) {
      expect(owner.attnotnull).toBe(true);
    }
  });

  test('publishing a later template does not rewrite an existing instance graph', async () => {
    assertIntegrationSql(sql);
    const projectId = 'aa500001-0001-4001-8001-000000000001';
    const workflowId = 'aa500002-0001-4001-8001-000000000002';
    const nodeId = 'aa500003-0001-4001-8001-000000000003';
    await seedMinimalProject(sql, projectId, workflowId, [
      nodeId,
      'aa500004-0001-4001-8001-000000000004',
      'aa500005-0001-4001-8001-000000000005',
    ]);
    await sql`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      VALUES (
        ${'aa500006-0001-4001-8001-000000000006'},
        ${workflowId},
        ${nodeId},
        ${'aa500004-0001-4001-8001-000000000004'}
      )
    `;
    const [before] = await sql<{ nodes: string; edges: string; template_version_id: string }[]>`
      SELECT
        (SELECT count(*)::text FROM wf_nodes WHERE workflow_id = ${workflowId}) AS nodes,
        (SELECT count(*)::text FROM wf_edges WHERE workflow_id = ${workflowId}) AS edges,
        template_version_id
      FROM project_workflows
      WHERE id = ${workflowId}
    `;

    const nextVersion = 'aa500010-0001-4001-8001-000000000010';
    await sql`
      INSERT INTO wf_template_versions (id, slug, name, version, is_draft, is_default, published_at)
      VALUES (${nextVersion}, 'default_sponsorship', '默认商单流程', 2, TRUE, FALSE, NULL)
    `;
    await sql`
      INSERT INTO wf_template_nodes (id, template_version_id, slug, name, kind)
      VALUES (${'aa500011-0001-4001-8001-000000000011'}, ${nextVersion}, 'only', '仅新版本', 'stage')
    `;
    await sql`
      UPDATE wf_template_versions
      SET is_draft = FALSE, published_at = now()
      WHERE id = ${nextVersion}
    `;

    const [after] = await sql<{ nodes: string; edges: string; template_version_id: string }[]>`
      SELECT
        (SELECT count(*)::text FROM wf_nodes WHERE workflow_id = ${workflowId}) AS nodes,
        (SELECT count(*)::text FROM wf_edges WHERE workflow_id = ${workflowId}) AS edges,
        template_version_id
      FROM project_workflows
      WHERE id = ${workflowId}
    `;
    expect(after).toEqual(before);
    expect(after?.template_version_id).toBe(DEFAULT_TEMPLATE);

    const laterProject = 'aa500020-0001-4001-8001-000000000020';
    const laterWorkflow = 'aa500021-0001-4001-8001-000000000021';
    await sql`INSERT INTO commercial_projects (id, name) VALUES (${laterProject}, 'Later project')`;
    await sql`
      INSERT INTO project_workflows (id, project_id, template_version_id)
      VALUES (${laterWorkflow}, ${laterProject}, ${nextVersion})
    `;
    const [pinned] = await sql<{ template_version_id: string }[]>`
      SELECT template_version_id FROM project_workflows WHERE id = ${workflowId}
    `;
    const [later] = await sql<{ template_version_id: string }[]>`
      SELECT template_version_id FROM project_workflows WHERE id = ${laterWorkflow}
    `;
    expect(pinned?.template_version_id).toBe(DEFAULT_TEMPLATE);
    expect(later?.template_version_id).toBe(nextVersion);
  });

  test('rejects a template node package from another version', async () => {
    assertIntegrationSql(sql);
    const versionA = 'aa600001-0001-4001-8001-000000000001';
    const versionB = 'aa600002-0001-4001-8001-000000000002';
    const packageId = 'aa600003-0001-4001-8001-000000000003';
    await sql`
      INSERT INTO wf_template_versions (id, slug, name, version, is_draft, is_default, published_at)
      VALUES
        (${versionA}, 'pkg_scope_a', 'A', 1, TRUE, FALSE, NULL),
        (${versionB}, 'pkg_scope_b', 'B', 1, TRUE, FALSE, NULL)
    `;
    await sql`
      INSERT INTO wf_template_packages (id, template_version_id, name)
      VALUES (${packageId}, ${versionA}, 'A 包')
    `;
    await expectDbError(
      () => sql!`
        INSERT INTO wf_template_nodes (id, template_version_id, package_id, slug, name)
        VALUES (${'aa600004-0001-4001-8001-000000000004'}, ${versionB}, ${packageId}, 'cross', 'Cross')
      `,
      /foreign key|violates foreign key constraint/i,
    );
  });
});
