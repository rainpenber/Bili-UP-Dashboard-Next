import type { Sql } from './client';

export const FIXTURE_PROJECT_IDS = {
  outlineDebate: 'f0010001-0001-4001-8001-000000000001',
  productionParallel: 'f0010001-0001-4001-8001-000000000002',
  publishedOpen: 'f0010001-0001-4001-8001-000000000003',
} as const;

const DEFAULT_TEMPLATE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export async function seedCommercialFixtures(sql: Sql): Promise<void> {
  await sql`
    INSERT INTO commercial_projects (id, name, net_amount, rebate_amount, overall_stage, user_deadline_at)
    VALUES
      (${FIXTURE_PROJECT_IDS.outlineDebate}, '大纲方向拉扯样例', 12000, 800, 'pre_publish', ${'2026-07-01T00:00:00.000Z'}),
      (${FIXTURE_PROJECT_IDS.productionParallel}, '制作并行样例', 28000, 1200, 'pre_publish', ${'2026-07-15T00:00:00.000Z'}),
      (${FIXTURE_PROJECT_IDS.publishedOpen}, '已上线未收尾样例', 45000, 3500, 'published_winding_down', ${'2026-06-01T00:00:00.000Z'})
    ON CONFLICT (id) DO NOTHING
  `;

  for (const projectId of Object.values(FIXTURE_PROJECT_IDS)) {
    const wfId = crypto.randomUUID();
    await sql`
      INSERT INTO project_workflows (id, project_id, template_version_id)
      VALUES (${wfId}, ${projectId}, ${DEFAULT_TEMPLATE})
      ON CONFLICT (project_id) DO NOTHING
    `;
    const wfRow = await sql<{ id: string }[]>`
      SELECT id FROM project_workflows WHERE project_id = ${projectId}
    `;
    const workflowId = wfRow[0]?.id;
    if (!workflowId) continue;
    const existingNodes = await sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM wf_nodes WHERE workflow_id = ${workflowId}
    `;
    if (Number(existingNodes[0]?.c ?? '0') > 0) continue;

    const tplPackages = await sql<{ id: string; name: string; sort_order: number }[]>`
      SELECT id, name, sort_order FROM wf_template_packages WHERE template_version_id = ${DEFAULT_TEMPLATE}
    `;
    const pkgMap = new Map<string, string>();
    for (const pkg of tplPackages) {
      const pkgId = crypto.randomUUID();
      pkgMap.set(pkg.id, pkgId);
      await sql`
        INSERT INTO wf_packages (id, workflow_id, name, sort_order)
        VALUES (${pkgId}, ${workflowId}, ${pkg.name}, ${pkg.sort_order})
        ON CONFLICT DO NOTHING
      `;
    }

    const tplNodes = await sql<
      {
        id: string;
        slug: string;
        name: string;
        is_optional: boolean;
        pos_x: number;
        pos_y: number;
        package_id: string | null;
        phase: string;
      }[]
    >`
      SELECT id, slug, name, is_optional, pos_x, pos_y, package_id, phase FROM wf_template_nodes
      WHERE template_version_id = ${DEFAULT_TEMPLATE}
    `;
    const idMap = new Map<string, string>();
    for (const tn of tplNodes) {
      const nodeId = crypto.randomUUID();
      idMap.set(tn.id, nodeId);
      let status = 'not_reached';
      if (tn.slug === 'inquiry') status = 'completed';
      if (projectId === FIXTURE_PROJECT_IDS.outlineDebate && tn.slug === 'outline')
        status = 'in_progress';
      if (
        projectId === FIXTURE_PROJECT_IDS.productionParallel &&
        ['a_roll', 'b_roll', 'ai_post'].includes(tn.slug)
      ) {
        status = 'in_progress';
      }
      if (
        projectId === FIXTURE_PROJECT_IDS.publishedOpen &&
        [
          'inquiry',
          'outline',
          'copy',
          'pre_shoot',
          'a_roll',
          'b_roll',
          'ai_post',
          'review',
          'publish',
        ].includes(tn.slug)
      ) {
        status = 'completed';
      }
      if (projectId === FIXTURE_PROJECT_IDS.publishedOpen && tn.slug === 'settlement')
        status = 'in_progress';
      const instancePkg = tn.package_id ? (pkgMap.get(tn.package_id) ?? null) : null;
      await sql`
        INSERT INTO wf_nodes (id, workflow_id, project_id, template_node_id, package_id, name, status, is_optional, pos_x, pos_y, phase, source)
        VALUES (${nodeId}, ${workflowId}, ${projectId}, ${tn.id}, ${instancePkg}, ${tn.name}, ${status}, ${tn.is_optional}, ${tn.pos_x}, ${tn.pos_y}, ${tn.phase}, 'template')
        ON CONFLICT DO NOTHING
      `;
    }
    const tplEdges = await sql<{ from_node_id: string; to_node_id: string }[]>`
      SELECT from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${DEFAULT_TEMPLATE}
    `;
    for (const e of tplEdges) {
      const fromId = idMap.get(e.from_node_id);
      const toId = idMap.get(e.to_node_id);
      if (!fromId || !toId) continue;
      await sql`
        INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
        VALUES (${crypto.randomUUID()}, ${workflowId}, ${fromId}, ${toId})
        ON CONFLICT DO NOTHING
      `;
    }
  }

  const outlineItemId = 'f0a10001-0001-4001-8001-0000000000a1';
  await sql`
    INSERT INTO open_items (id, project_id, title, description, close_criteria, next_action, next_actor, lifecycle, impact, source_evidence, confidence)
    VALUES (
      ${outlineItemId}, ${FIXTURE_PROJECT_IDS.outlineDebate},
      '大纲方向确认', '十余句沟通聚合为同一议题', '甲方确认方向', '整理备选结构发给甲方', 'us', 'open', 'normal',
      ${JSON.stringify({ thread: 'fixture-outline-thread', messages: 12 })}::jsonb, 0.85
    )
    ON CONFLICT (id) DO NOTHING
  `;

  await sql`
    INSERT INTO project_publish_records (project_id, bvid, published_at, publish_source, forced_complete_audit, idempotency_key)
    VALUES (
      ${FIXTURE_PROJECT_IDS.publishedOpen}, 'BVWP004R01', ${'2026-05-20T12:00:00.000Z'}, 'web',
      ${JSON.stringify([{ node: 'publish', reason: 'publish_force_complete' }])}::jsonb,
      'fixture-publish-once'
    )
    ON CONFLICT (project_id) DO NOTHING
  `;

  await sql`
    INSERT INTO project_monitor_contracts (id, project_id, bvid, monitor_video_key, linked_bvid, metadata_task_status, metrics_fetch_due_at)
    VALUES (
      ${'f0a00001-0001-4001-8001-000000000003'}, ${FIXTURE_PROJECT_IDS.publishedOpen}, 'BVWP004R01', 'BVTEST001', 'BVTEST001', 'mock_ready',
      ${'2026-05-20T12:01:00.000Z'}
    )
    ON CONFLICT (project_id) DO NOTHING
  `;
}
