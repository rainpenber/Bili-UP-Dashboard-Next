import type {
  HomeDashboard,
  OpenItemDto,
  ProjectDetailDto,
  ProjectListGroupedDto,
  PublishResultDto,
  WorkflowGraph,
} from '@studio/contracts';
import { advanceToNode, completeNode, rollbackToNode } from '@studio/workflow';
import type { Sql } from '@studio/db';
import { assertEdgeAllowed, loadWorkflowGraph, type Db } from './graph-io';
import { pickPrimaryBlockReason, syncBlockedAndStage } from './sync-state';
import { executeHermesOperation } from './hermes';

export class CommercialEngine {
  constructor(public readonly db: Sql) {}

  async resolveDefaultTemplateVersionId(tx: Db = this.db): Promise<string> {
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM wf_template_versions WHERE is_default = TRUE ORDER BY version DESC LIMIT 1
    `;
    const id = rows[0]?.id;
    if (!id) throw Object.assign(new Error('no default template version'), { status: 500 });
    return id;
  }

  async listProjectsGrouped(query: {
    q?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<ProjectListGroupedDto> {
    const pattern = query.q?.trim() ? `%${query.q.trim()}%` : null;
    const rows = await this.db<
      {
        id: string;
        name: string;
        overall_stage: string;
        user_deadline_at: Date | null;
        updated_at: Date;
      }[]
    >`
      SELECT id, name, overall_stage, user_deadline_at, updated_at FROM commercial_projects
      WHERE archived_at IS NULL
      ${pattern ? this.db`AND name ILIKE ${pattern}` : this.db``}
      ${query.dateFrom ? this.db`AND updated_at >= ${query.dateFrom}` : this.db``}
      ${query.dateTo ? this.db`AND updated_at <= ${query.dateTo}` : this.db``}
    `;
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const primaryBlock = await pickPrimaryBlockReason(this.db, r.id);
        const hasBlockedNode = await this.db<{ ok: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM wf_nodes n JOIN project_workflows w ON w.id = n.workflow_id
            WHERE w.project_id = ${r.id} AND n.status = 'blocked'
          ) AS ok
        `;
        const openItems = await this.db<
          { id: string; title: string; impact: string; next_action: string | null }[]
        >`
          SELECT id, title, impact, next_action FROM open_items
          WHERE project_id = ${r.id} AND lifecycle = 'open' ORDER BY updated_at DESC LIMIT 5
        `;
        return {
          id: r.id,
          name: r.name,
          overallStage: r.overall_stage as ProjectListGroupedDto['blocked'][number]['overallStage'],
          userDeadlineAt: r.user_deadline_at?.toISOString() ?? null,
          updatedAt: r.updated_at.toISOString(),
          primaryBlockReason: primaryBlock,
          openItemsPreview: openItems.map((o) => ({
            id: o.id,
            title: o.title,
            impact: o.impact as 'normal' | 'blocking',
            nextAction: o.next_action,
          })),
          sortKey: hasBlockedNode[0]?.ok ? 0 : r.overall_stage === 'pre_publish' ? 1 : 2,
        };
      }),
    );
    enriched.sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      const da = a.userDeadlineAt ? Date.parse(a.userDeadlineAt) : Number.MAX_SAFE_INTEGER;
      const db = b.userDeadlineAt ? Date.parse(b.userDeadlineAt) : Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
    return {
      blocked: enriched.filter((p) => p.sortKey === 0).map(stripSort),
      prePublish: enriched.filter((p) => p.sortKey === 1).map(stripSort),
      postPublishOpen: enriched.filter((p) => p.sortKey === 2).map(stripSort),
    };
  }

  async createProject(body: { name: string; netAmount?: number; rebateAmount?: number }) {
    const id = crypto.randomUUID();
    await this.db.begin(async (tx) => {
      const templateVersionId = await this.resolveDefaultTemplateVersionId(tx);
      await tx`
        INSERT INTO commercial_projects (id, name, net_amount, rebate_amount)
        VALUES (${id}, ${body.name}, ${body.netAmount ?? null}, ${body.rebateAmount ?? null})
      `;
      const wfId = crypto.randomUUID();
      await tx`
        INSERT INTO project_workflows (id, project_id, template_version_id)
        VALUES (${wfId}, ${id}, ${templateVersionId})
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
          phase: string;
        }[]
      >`SELECT id, name, is_optional, pos_x, pos_y, package_id, slug, phase FROM wf_template_nodes WHERE template_version_id = ${templateVersionId}`;
      const idMap = new Map<string, string>();
      for (const tn of tplNodes) {
        const nodeId = crypto.randomUUID();
        idMap.set(tn.id, nodeId);
        const status = tn.slug === 'inquiry' ? 'completed' : 'not_reached';
        await tx`
          INSERT INTO wf_nodes (id, workflow_id, project_id, template_node_id, package_id, name, status, is_optional, pos_x, pos_y, phase)
          VALUES (${nodeId}, ${wfId}, ${id}, ${tn.id}, ${tn.package_id}, ${tn.name}, ${status}, ${tn.is_optional}, ${tn.pos_x}, ${tn.pos_y}, ${tn.phase})
        `;
      }
      const tplEdges = await tx<{ from_node_id: string; to_node_id: string }[]>`
        SELECT from_node_id, to_node_id FROM wf_template_edges WHERE template_version_id = ${templateVersionId}
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
      await syncBlockedAndStage(tx, id);
    });
    return this.getProjectDetail(id);
  }

  async getProjectDetail(projectId: string): Promise<ProjectDetailDto | null> {
    const rows = await this.db<
      {
        id: string;
        name: string;
        net_amount: string | null;
        rebate_amount: string | null;
        overall_stage: string;
        user_deadline_at: Date | null;
        business_closed_at: Date | null;
      }[]
    >`SELECT * FROM commercial_projects WHERE id = ${projectId}`;
    const r = rows[0];
    if (!r) return null;
    const wf = await this.getWorkflow(projectId);
    const items = await this.listOpenItems(projectId);
    const publish = await this.db<
      { bvid: string; published_at: Date; forced_complete_audit: unknown }[]
    >`SELECT bvid, published_at, forced_complete_audit FROM project_publish_records WHERE project_id = ${projectId}`;
    const monitor = await this.db<
      {
        metadata_task_status: string;
        metadata_title: string | null;
        linked_bvid: string | null;
        metrics_fetch_due_at: Date | null;
      }[]
    >`SELECT metadata_task_status, metadata_title, linked_bvid, metrics_fetch_due_at FROM project_monitor_contracts WHERE project_id = ${projectId}`;
    const primaryBlock = await pickPrimaryBlockReason(this.db, projectId);
    const inProgress =
      wf?.nodes.filter((n) => n.status === 'in_progress' || n.status === 'blocked') ?? [];
    const pendingPlan = wf?.nodes.filter((n) => n.plannedAt && n.status !== 'completed') ?? [];
    const completed = wf?.nodes.filter((n) => n.status === 'completed') ?? [];
    return {
      id: r.id,
      name: r.name,
      netAmount: r.net_amount != null ? Number(r.net_amount) : null,
      rebateAmount: r.rebate_amount != null ? Number(r.rebate_amount) : null,
      overallStage: r.overall_stage as ProjectDetailDto['overallStage'],
      userDeadlineAt: r.user_deadline_at?.toISOString() ?? null,
      businessClosedAt: r.business_closed_at?.toISOString() ?? null,
      primaryBlockReason: primaryBlock,
      inProgressNodes: inProgress.map((n) => ({ id: n.id, name: n.name, status: n.status })),
      pendingPlannedNodes: pendingPlan.map((n) => ({
        id: n.id,
        name: n.name,
        plannedAt: n.plannedAt,
      })),
      completedNodes: completed.map((n) => ({
        id: n.id,
        name: n.name,
        completedAt: n.completedAt,
      })),
      openItems: items,
      workflow: wf,
      publish: publish[0]
        ? {
            bvid: publish[0].bvid,
            publishedAt: publish[0].published_at.toISOString(),
            forcedCompleteAudit: publish[0].forced_complete_audit,
          }
        : null,
      monitorContract: monitor[0]
        ? {
            metadataTaskStatus: monitor[0].metadata_task_status,
            metadataTitle: monitor[0].metadata_title,
            linkedBvid: monitor[0].linked_bvid,
            metricsFetchDueAt: monitor[0].metrics_fetch_due_at?.toISOString() ?? null,
          }
        : null,
    };
  }

  async getWorkflow(projectId: string): Promise<WorkflowGraph | null> {
    const graph = await loadWorkflowGraph(this.db, projectId, false);
    if (!graph) return null;
    return {
      projectId,
      workflowId: graph.workflowId,
      nodes: graph.nodes.map(mapNode),
      edges: graph.edges.map((e) => ({
        id: e.id,
        fromNodeId: e.from_node_id,
        toNodeId: e.to_node_id,
      })),
    };
  }

  async advanceToNode(projectId: string, nodeId: string) {
    await this.mutateGraph(projectId, async (tx, graph) => {
      const updates = advanceToNode(
        nodeId,
        graph.nodes.map((n) => ({ id: n.id, status: n.status })),
        graph.graphEdges,
      );
      await applyUpdates(tx, updates);
      await audit(tx, projectId, 'advance_to', nodeId, Object.fromEntries(updates));
    });
    return this.getWorkflow(projectId)!;
  }

  async completeNode(projectId: string, nodeId: string) {
    await this.mutateGraph(projectId, async (tx, graph) => {
      const updates = completeNode(
        nodeId,
        graph.nodes.map((n) => ({ id: n.id, status: n.status })),
        graph.graphEdges,
      );
      await applyUpdates(tx, updates);
      await audit(tx, projectId, 'complete', nodeId, Object.fromEntries(updates));
    });
    return this.getWorkflow(projectId)!;
  }

  async rollbackNode(projectId: string, nodeId: string) {
    await this.mutateGraph(projectId, async (tx, graph) => {
      const updates = rollbackToNode(
        nodeId,
        graph.nodes.map((n) => ({ id: n.id, status: n.status })),
        graph.graphEdges,
      );
      await applyUpdates(tx, updates);
      await audit(tx, projectId, 'rollback', nodeId, Object.fromEntries(updates));
    });
    return this.getWorkflow(projectId)!;
  }

  async markNodeNotApplicable(projectId: string, nodeId: string) {
    await this.mutateGraph(projectId, async (tx) => {
      await tx`
        UPDATE wf_nodes SET status = 'not_applicable', completed_at = now(), updated_at = now()
        WHERE id = ${nodeId} AND project_id = ${projectId}
      `;
    });
    return this.getWorkflow(projectId)!;
  }

  async createGraphNode(
    projectId: string,
    body: { name: string; posX: number; posY: number; phase?: string },
  ) {
    const id = crypto.randomUUID();
    await this.mutateGraph(projectId, async (tx, graph) => {
      await tx`
        INSERT INTO wf_nodes (id, workflow_id, project_id, name, status, pos_x, pos_y, phase, source)
        VALUES (${id}, ${graph.workflowId}, ${projectId}, ${body.name}, 'not_reached', ${body.posX}, ${body.posY}, ${body.phase ?? 'pre_publish'}, 'web')
      `;
    });
    return this.getWorkflow(projectId)!;
  }

  async updateGraphNode(
    projectId: string,
    nodeId: string,
    body: { name?: string; posX?: number; posY?: number; plannedAt?: string | null },
  ) {
    await this.mutateGraph(projectId, async (tx) => {
      if (body.name !== undefined) {
        await tx`UPDATE wf_nodes SET name = ${body.name}, updated_at = now() WHERE id = ${nodeId} AND project_id = ${projectId}`;
      }
      if (body.posX !== undefined || body.posY !== undefined) {
        await tx`
          UPDATE wf_nodes SET
            pos_x = COALESCE(${body.posX ?? null}, pos_x),
            pos_y = COALESCE(${body.posY ?? null}, pos_y),
            updated_at = now()
          WHERE id = ${nodeId} AND project_id = ${projectId}
        `;
      }
      if (body.plannedAt !== undefined) {
        await tx`
          UPDATE wf_nodes SET planned_at = ${body.plannedAt}, updated_at = now()
          WHERE id = ${nodeId} AND project_id = ${projectId}
        `;
      }
    });
    return this.getWorkflow(projectId)!;
  }

  async deleteGraphNode(projectId: string, nodeId: string) {
    await this.mutateGraph(projectId, async (tx) => {
      await tx`DELETE FROM wf_edges WHERE workflow_id IN (SELECT id FROM project_workflows WHERE project_id = ${projectId}) AND (from_node_id = ${nodeId} OR to_node_id = ${nodeId})`;
      await tx`DELETE FROM wf_nodes WHERE id = ${nodeId} AND project_id = ${projectId}`;
    });
    return this.getWorkflow(projectId)!;
  }

  async createGraphEdge(projectId: string, fromNodeId: string, toNodeId: string) {
    await this.mutateGraph(projectId, async (tx, graph) => {
      await assertEdgeAllowed(tx, graph.workflowId, fromNodeId, toNodeId);
      await tx`
        INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
        VALUES (${crypto.randomUUID()}, ${graph.workflowId}, ${fromNodeId}, ${toNodeId})
      `;
    });
    return this.getWorkflow(projectId)!;
  }

  async deleteGraphEdge(projectId: string, edgeId: string) {
    await this.mutateGraph(projectId, async (tx) => {
      await tx`
        DELETE FROM wf_edges e USING project_workflows w
        WHERE e.id = ${edgeId} AND e.workflow_id = w.id AND w.project_id = ${projectId}
      `;
    });
    return this.getWorkflow(projectId)!;
  }

  async listOpenItems(projectId: string): Promise<OpenItemDto[]> {
    const rows = await this.db<
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
        sort_rank: number;
        blocks_required_for_close: boolean;
      }[]
    >`SELECT * FROM open_items WHERE project_id = ${projectId} ORDER BY sort_rank DESC, updated_at DESC`;
    return rows.map(mapOpenItem);
  }

  async patchOpenItem(projectId: string, itemId: string, patch: Record<string, unknown>) {
    await this.db.begin(async (tx) => {
      await tx`SELECT id FROM open_items WHERE id = ${itemId} AND project_id = ${projectId} FOR UPDATE`;
      const fields: string[] = [];
      if (patch.title !== undefined)
        await tx`UPDATE open_items SET title = ${String(patch.title)}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.description !== undefined)
        await tx`UPDATE open_items SET description = ${patch.description as string | null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.closeCriteria !== undefined)
        await tx`UPDATE open_items SET close_criteria = ${patch.closeCriteria as string | null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.nextAction !== undefined)
        await tx`UPDATE open_items SET next_action = ${patch.nextAction as string | null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.nextActor !== undefined)
        await tx`UPDATE open_items SET next_actor = ${patch.nextActor as string}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.plannedAt !== undefined)
        await tx`UPDATE open_items SET planned_at = ${patch.plannedAt as string | null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.impact !== undefined)
        await tx`UPDATE open_items SET impact = ${patch.impact as string}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.blocksNodeId !== undefined)
        await tx`UPDATE open_items SET blocks_node_id = ${patch.blocksNodeId as string | null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.workflowNodeId !== undefined)
        await tx`UPDATE open_items SET workflow_node_id = ${patch.workflowNodeId as string | null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.sortRank !== undefined)
        await tx`UPDATE open_items SET sort_rank = ${Number(patch.sortRank)}, updated_at = now() WHERE id = ${itemId}`;
      void fields;
      await syncBlockedAndStage(tx, projectId);
    });
    return (await this.listOpenItems(projectId)).find((i) => i.id === itemId)!;
  }

  async createOpenItem(projectId: string, body: Record<string, unknown>) {
    const id = crypto.randomUUID();
    await this.db.begin(async (tx) => {
      await tx`
        INSERT INTO open_items (id, project_id, title, description, close_criteria, next_action, next_actor, impact, blocks_node_id, workflow_node_id, planned_at, source_evidence, confidence, sort_rank)
        VALUES (
          ${id}, ${projectId}, ${String(body.title)}, ${(body.description as string) ?? null},
          ${(body.closeCriteria as string) ?? null}, ${(body.nextAction as string) ?? null},
          ${(body.nextActor as string) ?? 'us'}, ${(body.impact as string) ?? 'normal'},
          ${(body.blocksNodeId as string) ?? null}, ${(body.workflowNodeId as string) ?? null},
          ${(body.plannedAt as string) ?? null}, ${body.sourceEvidence ? JSON.stringify(body.sourceEvidence) : null}::jsonb,
          ${(body.confidence as number) ?? null}, ${Number(body.sortRank ?? 0)}
        )
      `;
      await syncBlockedAndStage(tx, projectId);
    });
    return (await this.listOpenItems(projectId)).find((i) => i.id === id)!;
  }

  async closeOpenItem(projectId: string, itemId: string, conclusion: string) {
    await this.db.begin(async (tx) => {
      await tx`
        UPDATE open_items SET lifecycle = 'closed', close_conclusion = ${conclusion}, closed_at = now(), updated_at = now()
        WHERE id = ${itemId} AND project_id = ${projectId}
      `;
      await syncBlockedAndStage(tx, projectId);
    });
    return (await this.listOpenItems(projectId)).find((i) => i.id === itemId)!;
  }

  async cancelOpenItem(projectId: string, itemId: string) {
    await this.db.begin(async (tx) => {
      await tx`
        UPDATE open_items SET lifecycle = 'cancelled', updated_at = now()
        WHERE id = ${itemId} AND project_id = ${projectId}
      `;
      await syncBlockedAndStage(tx, projectId);
    });
    return (await this.listOpenItems(projectId)).find((i) => i.id === itemId)!;
  }

  async publishProject(
    projectId: string,
    body: { bvid: string; publishedAt: string; idempotencyKey: string },
  ): Promise<PublishResultDto> {
    return this.db.begin(async (tx) => {
      const prior = await tx<
        {
          idempotency_key: string;
          project_id: string;
          payload_hash: string;
          result_json: unknown;
        }[]
      >`
        SELECT idempotency_key, project_id, payload_hash, result_json FROM hermes_idempotency
        WHERE idempotency_key = ${body.idempotencyKey}
      `;
      const payloadHash = hashPayload(body);
      if (prior[0]) {
        if (prior[0].project_id !== projectId || prior[0].payload_hash !== payloadHash) {
          throw Object.assign(new Error('idempotency key conflict'), { status: 409 });
        }
        return prior[0].result_json as PublishResultDto;
      }
      const existingPub = await tx<{ project_id: string; idempotency_key: string | null }[]>`
        SELECT project_id, idempotency_key FROM project_publish_records WHERE project_id = ${projectId}
      `;
      if (existingPub[0] && existingPub[0].idempotency_key !== body.idempotencyKey) {
        throw Object.assign(new Error('project already published'), { status: 409 });
      }
      if (existingPub[0] && existingPub[0].idempotency_key === body.idempotencyKey) {
        const cached = await tx<{ result_json: unknown }[]>`
          SELECT result_json FROM hermes_idempotency WHERE idempotency_key = ${body.idempotencyKey}
        `;
        if (cached[0]) return cached[0].result_json as PublishResultDto;
      }
      const graph = await loadWorkflowGraph(tx, projectId, true);
      if (!graph) throw Object.assign(new Error('workflow not found'), { status: 404 });
      const forced: { nodeId: string; name: string }[] = [];
      for (const n of graph.nodes) {
        if (n.phase !== 'pre_publish') continue;
        if (n.status === 'completed' || n.status === 'not_applicable') continue;
        await tx`
          UPDATE wf_nodes SET status = 'completed', completed_at = ${body.publishedAt}, updated_at = now()
          WHERE id = ${n.id}
        `;
        forced.push({ nodeId: n.id, name: n.name });
      }
      await tx`
        INSERT INTO project_publish_records (project_id, bvid, published_at, publish_source, forced_complete_audit, idempotency_key)
        VALUES (${projectId}, ${body.bvid}, ${body.publishedAt}, 'web', ${JSON.stringify(forced)}::jsonb, ${body.idempotencyKey})
      `;
      const metricsDue = new Date(new Date(body.publishedAt).getTime() + 60_000);
      const linked = await tx<{ bvid: string }[]>`
        SELECT bvid FROM videos WHERE bvid = ${body.bvid} LIMIT 1
      `;
      await tx`
        INSERT INTO project_monitor_contracts (id, project_id, bvid, monitor_video_key, linked_bvid, metadata_task_status, metrics_fetch_due_at)
        VALUES (${crypto.randomUUID()}, ${projectId}, ${body.bvid}, ${body.bvid}, ${linked[0]?.bvid ?? null}, 'pending', ${metricsDue.toISOString()})
      `;
      await runMockMetadataTask(tx, projectId, body.bvid);
      await syncBlockedAndStage(tx, projectId);
      const result: PublishResultDto = {
        projectId,
        bvid: body.bvid,
        publishedAt: body.publishedAt,
        forcedCompleteAudit: forced,
        monitor: await getMonitorDto(tx, projectId),
      };
      await tx`
        INSERT INTO hermes_idempotency (idempotency_key, operation, project_id, payload_hash, result_json)
        VALUES (${body.idempotencyKey}, 'publish', ${projectId}, ${payloadHash}, ${JSON.stringify(result)}::jsonb)
      `;
      return result;
    });
  }

  async getHomeDashboard(): Promise<HomeDashboard> {
    const now = new Date();
    const our = await this.db<
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
    const client = await this.db<
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
    const blockedNodes = await this.db<
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
    const blockedProjects = await Promise.all(
      blockedNodes.map(async (r) => ({
        projectId: r.project_id,
        projectName: r.project_name,
        blockedNodeId: r.node_id,
        blockedNodeName: r.node_name,
        primaryBlock:
          (await pickPrimaryBlockReason(this.db, r.project_id, r.node_id)) ?? r.node_name,
        userDeadlineAt: r.user_deadline_at?.toISOString() ?? null,
        blockedSinceHours: (now.getTime() - r.updated_at.getTime()) / 3_600_000,
      })),
    );
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
      blockedProjects,
    };
  }

  async runHermes(body: Record<string, unknown>) {
    return executeHermesOperation(this, body);
  }

  private async mutateGraph(
    projectId: string,
    fn: (
      tx: Db,
      graph: NonNullable<Awaited<ReturnType<typeof loadWorkflowGraph>>>,
    ) => Promise<void>,
  ) {
    await this.db.begin(async (tx) => {
      const graph = await loadWorkflowGraph(tx, projectId, true);
      if (!graph) throw Object.assign(new Error('workflow not found'), { status: 404 });
      await fn(tx, graph);
      await syncBlockedAndStage(tx, projectId);
    });
  }
}

function stripSort<T extends { sortKey: number }>(row: T): Omit<T, 'sortKey'> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit sortKey for API response
  const { sortKey, ...rest } = row;
  return rest;
}

async function applyUpdates(
  tx: Db,
  updates: Map<string, { status: string; completedAt?: string | null }>,
) {
  for (const [id, u] of updates) {
    await tx`
      UPDATE wf_nodes SET status = ${u.status},
        completed_at = ${u.completedAt ?? null},
        updated_at = now()
      WHERE id = ${id}
    `;
  }
}

async function audit(tx: Db, projectId: string, action: string, entityId: string, detail: unknown) {
  await tx`
    INSERT INTO workflow_audit_log (project_id, entity_type, entity_id, action, detail)
    VALUES (${projectId}, 'node', ${entityId}, ${action}, ${JSON.stringify(detail)}::jsonb)
  `;
}

function mapNode(n: {
  id: string;
  name: string;
  status: string;
  phase: string;
  is_optional: boolean;
  planned_at: Date | null;
  completed_at: Date | null;
  pos_x: number;
  pos_y: number;
  package_id: string | null;
  slug: string | null;
}) {
  return {
    id: n.id,
    name: n.name,
    status: n.status as WorkflowGraph['nodes'][number]['status'],
    phase: n.phase as WorkflowGraph['nodes'][number]['phase'],
    isOptional: n.is_optional,
    plannedAt: n.planned_at?.toISOString() ?? null,
    completedAt: n.completed_at?.toISOString() ?? null,
    posX: n.pos_x,
    posY: n.pos_y,
    packageId: n.package_id,
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
  sort_rank: number;
  blocks_required_for_close: boolean;
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
    sortRank: r.sort_rank,
    blocksRequiredForClose: r.blocks_required_for_close,
  };
}

function hashPayload(body: { bvid: string; publishedAt: string; idempotencyKey: string }) {
  return `${body.bvid}|${body.publishedAt}|${body.idempotencyKey}`;
}

async function runMockMetadataTask(tx: Db, projectId: string, bvid: string) {
  const meta = await tx<{ title: string | null }[]>`
    SELECT title FROM videos WHERE bvid = ${bvid} LIMIT 1
  `;
  await tx`
    UPDATE project_monitor_contracts
    SET metadata_task_status = 'mock_ready',
        metadata_title = ${meta[0]?.title ?? `Mock ${bvid}`},
        metadata_fetched_at = now()
    WHERE project_id = ${projectId}
  `;
}

async function getMonitorDto(tx: Db, projectId: string) {
  const mon = await tx<
    {
      metadata_task_status: string;
      metadata_title: string | null;
      linked_bvid: string | null;
      metrics_fetch_due_at: Date | null;
    }[]
  >`SELECT metadata_task_status, metadata_title, linked_bvid, metrics_fetch_due_at FROM project_monitor_contracts WHERE project_id = ${projectId}`;
  const m = mon[0];
  return {
    metadataTaskStatus: m?.metadata_task_status ?? 'pending',
    metadataTitle: m?.metadata_title ?? null,
    linkedBvid: m?.linked_bvid ?? null,
    metricsFetchDueAt: m?.metrics_fetch_due_at?.toISOString() ?? null,
  };
}
