import type { HomeDashboard, OpenItemDto, ProjectSummary, WorkflowGraph } from '@studio/contracts';
import {
  canCompleteNode,
  detectCycle,
  downstreamIds,
  postPublishLeavesIncomplete,
} from '@studio/workflow';
import type { Sql } from '@studio/db';
import type postgres from 'postgres';

type Db = Sql | postgres.TransactionSql;

const DEFAULT_TEMPLATE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

type NodeRow = {
  id: string;
  name: string;
  status: string;
  is_optional: boolean;
  planned_at: Date | null;
  completed_at: Date | null;
  pos_x: number;
  pos_y: number;
  package_id: string | null;
  blocking_open_item_id: string | null;
  slug: string | null;
};

export class CommercialService {
  constructor(private readonly sql: Sql) {}

  async listProjects(query: {
    page: number;
    pageSize: number;
    q?: string;
  }): Promise<{ items: ProjectSummary[]; totalItems: number }> {
    const q = query.q?.trim();
    const pattern = q ? `%${q}%` : null;
    const rows = pattern
      ? await this.sql<
          {
            id: string;
            name: string;
            net_amount: string | null;
            rebate_amount: string | null;
            overall_stage: string;
            user_deadline_at: Date | null;
            archived_at: Date | null;
            business_closed_at: Date | null;
            created_at: Date;
            updated_at: Date;
          }[]
        >`
          SELECT * FROM commercial_projects
          WHERE archived_at IS NULL AND name ILIKE ${pattern}
          ORDER BY updated_at DESC
          LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
        `
      : await this.sql<
          {
            id: string;
            name: string;
            net_amount: string | null;
            rebate_amount: string | null;
            overall_stage: string;
            user_deadline_at: Date | null;
            archived_at: Date | null;
            business_closed_at: Date | null;
            created_at: Date;
            updated_at: Date;
          }[]
        >`
          SELECT * FROM commercial_projects
          WHERE archived_at IS NULL
          ORDER BY updated_at DESC
          LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}
        `;
    const count = pattern
      ? await this.sql<{ c: string }[]>`
          SELECT count(*)::text AS c FROM commercial_projects
          WHERE archived_at IS NULL AND name ILIKE ${pattern}
        `
      : await this.sql<{ c: string }[]>`
          SELECT count(*)::text AS c FROM commercial_projects WHERE archived_at IS NULL
        `;
    const items = await Promise.all(rows.map((r) => this.mapProject(r.id)));
    return { items, totalItems: Number(count[0]?.c ?? '0') };
  }

  async createProject(body: {
    name: string;
    netAmount?: number;
    rebateAmount?: number;
  }): Promise<ProjectSummary> {
    const id = crypto.randomUUID();
    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO commercial_projects (id, name, net_amount, rebate_amount)
        VALUES (${id}, ${body.name}, ${body.netAmount ?? null}, ${body.rebateAmount ?? null})
      `;
      const wfId = crypto.randomUUID();
      await tx`
        INSERT INTO project_workflows (id, project_id, template_version_id)
        VALUES (${wfId}, ${id}, ${DEFAULT_TEMPLATE})
      `;
      const tplNodes = await tx<
        {
          id: string;
          name: string;
          is_optional: boolean;
          pos_x: number;
          pos_y: number;
          package_id: string | null;
          slug: string;
        }[]
      >`SELECT id, name, is_optional, pos_x, pos_y, package_id, slug FROM wf_template_nodes WHERE template_version_id = ${DEFAULT_TEMPLATE}`;
      const idMap = new Map<string, string>();
      for (const tn of tplNodes) {
        const nodeId = crypto.randomUUID();
        idMap.set(tn.id, nodeId);
        const status = tn.slug === 'inquiry' ? 'completed' : 'not_reached';
        await tx`
          INSERT INTO wf_nodes (id, workflow_id, template_node_id, package_id, name, status, is_optional, pos_x, pos_y)
          VALUES (${nodeId}, ${wfId}, ${tn.id}, ${tn.package_id}, ${tn.name}, ${status}, ${tn.is_optional}, ${tn.pos_x}, ${tn.pos_y})
        `;
      }
      const tplEdges = await tx<{ from_node_id: string; to_node_id: string }[]>`
        SELECT from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${DEFAULT_TEMPLATE}
      `;
      for (const e of tplEdges) {
        const fromId = idMap.get(e.from_node_id);
        const toId = idMap.get(e.to_node_id);
        if (!fromId || !toId) continue;
        await tx`
          INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
          VALUES (${crypto.randomUUID()}, ${wfId}, ${fromId}, ${toId})
        `;
      }
    });
    return this.mapProject(id);
  }

  async getProject(id: string): Promise<ProjectSummary | null> {
    const rows = await this.sql<
      { id: string }[]
    >`SELECT id FROM commercial_projects WHERE id = ${id}`;
    if (!rows[0]) return null;
    return this.mapProject(id);
  }

  async getWorkflow(projectId: string): Promise<WorkflowGraph | null> {
    const wf = await this.sql<{ id: string }[]>`
      SELECT id FROM project_workflows WHERE project_id = ${projectId}
    `;
    const wfId = wf[0]?.id;
    if (!wfId) return null;
    const nodes = await this.loadNodes(wfId);
    const edges = await this.sql<{ id: string; from_node_id: string; to_node_id: string }[]>`
      SELECT id, from_node_id, to_node_id FROM wf_edges WHERE workflow_id = ${wfId}
    `;
    const cycle = detectCycle(
      nodes.map((n) => ({ id: n.id, status: n.status })),
      edges.map((e) => ({ fromId: e.from_node_id, toId: e.to_node_id })),
    );
    if (cycle) throw new Error(cycle);
    return {
      projectId,
      workflowId: wfId,
      nodes: nodes.map(mapNodeDto),
      edges: edges.map((e) => ({
        id: e.id,
        fromNodeId: e.from_node_id,
        toNodeId: e.to_node_id,
      })),
    };
  }

  async advanceNode(projectId: string, nodeId: string): Promise<WorkflowGraph> {
    await this.sql.begin(async (tx) => {
      const graph = await this.loadGraphTx(tx, projectId);
      if (!graph) throw Object.assign(new Error('workflow not found'), { status: 404 });
      const node = graph.nodes.find((n) => n.id === nodeId);
      if (!node) throw Object.assign(new Error('node not found'), { status: 404 });
      const check = canCompleteNode(nodeId, graph.nodes, graph.edges);
      if (!check.ok) throw Object.assign(new Error(check.reason), { status: 409 });
      await tx`
        UPDATE wf_nodes SET status = 'completed', completed_at = now(), updated_at = now()
        WHERE id = ${nodeId}
      `;
      await tx`
        INSERT INTO workflow_audit_log (project_id, entity_type, entity_id, action, detail)
        VALUES (${projectId}, 'node', ${nodeId}, 'advance', ${JSON.stringify({ to: 'completed' })}::jsonb)
      `;
      await this.syncDerivedTx(tx, projectId);
    });
    return (await this.getWorkflow(projectId))!;
  }

  async rollbackNode(projectId: string, nodeId: string): Promise<WorkflowGraph> {
    await this.sql.begin(async (tx) => {
      const graph = await this.loadGraphTx(tx, projectId);
      if (!graph) throw Object.assign(new Error('workflow not found'), { status: 404 });
      const downstream = downstreamIds(
        nodeId,
        graph.edges.map((e) => ({ fromId: e.fromId, toId: e.toId })),
      );
      await tx`
        UPDATE wf_nodes SET status = 'in_progress', completed_at = NULL, updated_at = now()
        WHERE id = ${nodeId}
      `;
      if (downstream.length) {
        await tx`
          UPDATE wf_nodes SET status = 'not_reached', completed_at = NULL, updated_at = now()
          WHERE id = ANY(${downstream}::uuid[])
        `;
      }
      await tx`
        INSERT INTO workflow_audit_log (project_id, entity_type, entity_id, action, detail)
        VALUES (${projectId}, 'node', ${nodeId}, 'rollback', ${JSON.stringify({ cleared: downstream })}::jsonb)
      `;
      await this.syncDerivedTx(tx, projectId);
    });
    return (await this.getWorkflow(projectId))!;
  }

  async listOpenItems(projectId: string): Promise<OpenItemDto[]> {
    const rows = await this.sql<
      {
        id: string;
        project_id: string;
        workflow_node_id: string | null;
        blocks_node_id: string | null;
        title: string;
        description: string | null;
        close_criteria: string | null;
        next_action: string | null;
        next_actor: string;
        lifecycle: string;
        impact: string;
        planned_at: Date | null;
        source_evidence: Record<string, unknown> | null;
        confidence: number | null;
        close_conclusion: string | null;
        created_at: Date;
        updated_at: Date;
        closed_at: Date | null;
      }[]
    >`SELECT * FROM open_items WHERE project_id = ${projectId} ORDER BY created_at DESC`;
    return rows.map(mapOpenItem);
  }

  async createOpenItem(
    projectId: string,
    body: {
      title: string;
      nextActor: 'us' | 'client';
      description?: string;
      closeCriteria?: string;
      nextAction?: string;
      impact?: 'normal' | 'blocking';
      blocksNodeId?: string;
    },
  ): Promise<OpenItemDto> {
    const id = crypto.randomUUID();
    await this.sql.begin(async (tx) => {
      await tx`
        INSERT INTO open_items (id, project_id, title, description, close_criteria, next_action, next_actor, impact, blocks_node_id)
        VALUES (
          ${id}, ${projectId}, ${body.title}, ${body.description ?? null}, ${body.closeCriteria ?? null},
          ${body.nextAction ?? null}, ${body.nextActor}, ${body.impact ?? 'normal'}, ${body.blocksNodeId ?? null}
        )
      `;
      if (body.impact === 'blocking' && body.blocksNodeId) {
        await tx`
          UPDATE wf_nodes SET status = 'blocked', blocking_open_item_id = ${id}, updated_at = now()
          WHERE id = ${body.blocksNodeId}
        `;
      }
      await this.syncDerivedTx(tx, projectId);
    });
    return (await this.listOpenItems(projectId)).find((i) => i.id === id)!;
  }

  async publishProject(
    projectId: string,
    body: { bvid: string; publishedAt: string; idempotencyKey: string },
  ): Promise<{ publish: unknown; monitor: unknown }> {
    return this.sql.begin(async (tx) => {
      const existing = await tx<{ project_id: string }[]>`
        SELECT project_id FROM project_publish_records WHERE project_id = ${projectId}
           OR idempotency_key = ${body.idempotencyKey}
      `;
      if (existing[0]) {
        const pub =
          await tx`SELECT * FROM project_publish_records WHERE project_id = ${existing[0].project_id}`;
        const mon =
          await tx`SELECT * FROM project_monitor_contracts WHERE project_id = ${existing[0].project_id}`;
        return { publish: pub[0], monitor: mon[0] };
      }
      const graph = await this.loadGraphTx(tx, projectId);
      if (!graph) throw Object.assign(new Error('workflow not found'), { status: 404 });
      const prePublish = graph.nodes.filter(
        (n) => n.slug !== 'settlement' && !/结算|分发|数据维护|其他/.test(n.name),
      );
      const forced: { nodeId: string; name: string }[] = [];
      for (const n of prePublish) {
        if (n.status !== 'completed' && n.status !== 'not_applicable') {
          await tx`
            UPDATE wf_nodes SET status = 'completed', completed_at = ${body.publishedAt}, updated_at = now()
            WHERE id = ${n.id}
          `;
          forced.push({ nodeId: n.id, name: n.name });
        }
      }
      await tx`
        INSERT INTO project_publish_records (project_id, bvid, published_at, publish_source, forced_complete_audit, idempotency_key)
        VALUES (${projectId}, ${body.bvid}, ${body.publishedAt}, 'web', ${JSON.stringify(forced)}::jsonb, ${body.idempotencyKey})
      `;
      const metricsDue = new Date(new Date(body.publishedAt).getTime() + 60_000);
      await tx`
        INSERT INTO project_monitor_contracts (id, project_id, bvid, monitor_video_key, metadata_task_status, metrics_fetch_due_at)
        VALUES (${crypto.randomUUID()}, ${projectId}, ${body.bvid}, ${body.bvid}, 'pending', ${metricsDue.toISOString()})
      `;
      await tx`
        INSERT INTO workflow_audit_log (project_id, entity_type, entity_id, action, detail)
        VALUES (${projectId}, 'publish', NULL, 'publish_force_complete', ${JSON.stringify({ forced, bvid: body.bvid })}::jsonb)
      `;
      await this.syncDerivedTx(tx, projectId);
      const pub = await tx`SELECT * FROM project_publish_records WHERE project_id = ${projectId}`;
      const mon = await tx`SELECT * FROM project_monitor_contracts WHERE project_id = ${projectId}`;
      return { publish: pub[0], monitor: mon[0] };
    });
  }

  async getHomeDashboard(): Promise<HomeDashboard> {
    const now = new Date();
    const our = await this.sql<
      {
        project_id: string;
        project_name: string;
        id: string;
        title: string;
        next_action: string | null;
        planned_at: Date | null;
      }[]
    >`
      SELECT p.id AS project_id, p.name AS project_name, o.id, o.title, o.next_action, o.planned_at
      FROM open_items o JOIN commercial_projects p ON p.id = o.project_id
      WHERE o.lifecycle = 'open' AND o.next_actor = 'us' AND p.archived_at IS NULL
      ORDER BY o.planned_at NULLS LAST
    `;
    const client = await this.sql<
      {
        project_id: string;
        project_name: string;
        id: string;
        title: string;
        next_action: string | null;
        planned_at: Date | null;
      }[]
    >`
      SELECT p.id AS project_id, p.name AS project_name, o.id, o.title, o.next_action, o.planned_at
      FROM open_items o JOIN commercial_projects p ON p.id = o.project_id
      WHERE o.lifecycle = 'open' AND o.next_actor = 'client' AND p.archived_at IS NULL
    `;
    const blocked = await this.sql<
      {
        project_id: string;
        project_name: string;
        node_id: string;
        node_name: string;
        user_deadline_at: Date | null;
        updated_at: Date;
      }[]
    >`
      SELECT p.id AS project_id, p.name AS project_name, n.id AS node_id, n.name AS node_name,
        p.user_deadline_at, n.updated_at
      FROM wf_nodes n
      JOIN project_workflows w ON w.id = n.workflow_id
      JOIN commercial_projects p ON p.id = w.project_id
      WHERE n.status = 'blocked' AND p.archived_at IS NULL AND p.overall_stage <> 'closed'
    `;
    return {
      generatedAt: now.toISOString(),
      ourOpenItems: our.map((r) => ({
        projectId: r.project_id,
        projectName: r.project_name,
        itemId: r.id,
        title: r.title,
        nextAction: r.next_action,
        plannedAt: r.planned_at?.toISOString() ?? null,
      })),
      clientOpenItems: client.map((r) => ({
        projectId: r.project_id,
        projectName: r.project_name,
        itemId: r.id,
        title: r.title,
        nextAction: r.next_action,
        plannedAt: r.planned_at?.toISOString() ?? null,
      })),
      blockedProjects: blocked.map((r) => ({
        projectId: r.project_id,
        projectName: r.project_name,
        blockedNodeId: r.node_id,
        blockedNodeName: r.node_name,
        primaryBlock: r.node_name,
        userDeadlineAt: r.user_deadline_at?.toISOString() ?? null,
        blockedSinceHours: (now.getTime() - r.updated_at.getTime()) / 3_600_000,
      })),
    };
  }

  private async mapProject(id: string): Promise<ProjectSummary> {
    const rows = await this.sql<
      {
        id: string;
        name: string;
        net_amount: string | null;
        rebate_amount: string | null;
        overall_stage: string;
        user_deadline_at: Date | null;
        archived_at: Date | null;
        business_closed_at: Date | null;
        created_at: Date;
        updated_at: Date;
      }[]
    >`SELECT * FROM commercial_projects WHERE id = ${id}`;
    const r = rows[0]!;
    const openCount = await this.sql<{ c: string }[]>`
      SELECT count(*)::text AS c FROM open_items WHERE project_id = ${id} AND lifecycle = 'open'
    `;
    const block = await this.sql<{ name: string }[]>`
      SELECT n.name FROM wf_nodes n
      JOIN project_workflows w ON w.id = n.workflow_id
      WHERE w.project_id = ${id} AND n.status = 'blocked' LIMIT 1
    `;
    return {
      id: r.id,
      name: r.name,
      netAmount: r.net_amount != null ? Number(r.net_amount) : null,
      rebateAmount: r.rebate_amount != null ? Number(r.rebate_amount) : null,
      overallStage: r.overall_stage as ProjectSummary['overallStage'],
      userDeadlineAt: r.user_deadline_at?.toISOString() ?? null,
      archivedAt: r.archived_at?.toISOString() ?? null,
      businessClosedAt: r.business_closed_at?.toISOString() ?? null,
      primaryBlockLabel: block[0]?.name ?? null,
      openItemCount: Number(openCount[0]?.c ?? '0'),
      createdAt: r.created_at.toISOString(),
      updatedAt: r.updated_at.toISOString(),
    };
  }

  private async loadNodes(workflowId: string): Promise<NodeRow[]> {
    return this.sql<NodeRow[]>`
      SELECT n.id, n.name, n.status, n.is_optional, n.planned_at, n.completed_at, n.pos_x, n.pos_y,
        n.package_id, n.blocking_open_item_id, t.slug
      FROM wf_nodes n
      LEFT JOIN wf_template_nodes t ON t.id = n.template_node_id
      WHERE n.workflow_id = ${workflowId}
    `;
  }

  private async loadGraphTx(tx: Db, projectId: string) {
    const wf = await tx<
      { id: string }[]
    >`SELECT id FROM project_workflows WHERE project_id = ${projectId}`;
    const wfId = wf[0]?.id;
    if (!wfId) return null;
    const nodes = await tx<NodeRow[]>`
      SELECT n.id, n.name, n.status, n.is_optional, n.planned_at, n.completed_at, n.pos_x, n.pos_y,
        n.package_id, n.blocking_open_item_id, t.slug
      FROM wf_nodes n LEFT JOIN wf_template_nodes t ON t.id = n.template_node_id
      WHERE n.workflow_id = ${wfId}
    `;
    const edges = await tx<{ id: string; from_node_id: string; to_node_id: string }[]>`
      SELECT id, from_node_id, to_node_id FROM wf_edges WHERE workflow_id = ${wfId}
    `;
    return {
      wfId,
      nodes: nodes.map((n) => ({
        id: n.id,
        name: n.name,
        status: n.status,
        slug: n.slug,
        isOptional: n.is_optional,
      })),
      edges: edges.map((e) => ({ id: e.id, fromId: e.from_node_id, toId: e.to_node_id })),
    };
  }

  private async syncDerivedTx(tx: Db, projectId: string) {
    const graph = await this.loadGraphTx(tx, projectId);
    if (!graph) return;
    const published = await tx<{ ok: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM project_publish_records WHERE project_id = ${projectId}) AS ok
    `;
    let stage = published[0]?.ok ? 'published_winding_down' : 'pre_publish';
    if (
      published[0]?.ok &&
      !postPublishLeavesIncomplete(
        graph.nodes.map((n) => ({
          id: n.id,
          status: n.status,
          ...(n.slug ? { slug: n.slug } : {}),
          ...(n.name ? { name: n.name } : {}),
        })),
      )
    ) {
      stage = 'closed';
    }
    await tx`UPDATE commercial_projects SET overall_stage = ${stage}, updated_at = now() WHERE id = ${projectId}`;
  }
}

function mapNodeDto(n: NodeRow) {
  return {
    id: n.id,
    name: n.name,
    status: n.status as WorkflowGraph['nodes'][number]['status'],
    isOptional: n.is_optional,
    plannedAt: n.planned_at?.toISOString() ?? null,
    completedAt: n.completed_at?.toISOString() ?? null,
    posX: n.pos_x,
    posY: n.pos_y,
    packageId: n.package_id,
    blockingOpenItemId: n.blocking_open_item_id,
    slug: n.slug,
  };
}

function mapOpenItem(r: {
  id: string;
  project_id: string;
  workflow_node_id: string | null;
  blocks_node_id: string | null;
  title: string;
  description: string | null;
  close_criteria: string | null;
  next_action: string | null;
  next_actor: string;
  lifecycle: string;
  impact: string;
  planned_at: Date | null;
  source_evidence: Record<string, unknown> | null;
  confidence: number | null;
  close_conclusion: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
}): OpenItemDto {
  return {
    id: r.id,
    projectId: r.project_id,
    workflowNodeId: r.workflow_node_id,
    blocksNodeId: r.blocks_node_id,
    title: r.title,
    description: r.description,
    closeCriteria: r.close_criteria,
    nextAction: r.next_action,
    nextActor: r.next_actor as OpenItemDto['nextActor'],
    lifecycle: r.lifecycle as OpenItemDto['lifecycle'],
    impact: r.impact as OpenItemDto['impact'],
    plannedAt: r.planned_at?.toISOString() ?? null,
    sourceEvidence: r.source_evidence,
    confidence: r.confidence,
    closeConclusion: r.close_conclusion,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    closedAt: r.closed_at?.toISOString() ?? null,
  };
}
