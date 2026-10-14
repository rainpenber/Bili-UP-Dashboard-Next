import type {
  HomeDashboard,
  OpenItemDto,
  ProjectDetailDto,
  ProjectListGroupedDto,
  PublishResultDto,
  WorkflowGraph,
} from '@studio/contracts';
import {
  advanceToNode,
  completeNode,
  NodeCompletionBlockedError,
  rollbackToNode,
} from '@studio/workflow';
import type { Sql } from '@studio/db';
import { assertEdgeAllowed, loadWorkflowGraph, type Db } from './graph-io';
import { pickPrimaryBlockReason, syncBlockedAndStage } from './sync-state';
import { executeHermesOperation } from './hermes';
import { createProjectTx, mutateProjectGraph } from './engine-mutations';
import {
  applyUpdates,
  assertNodeInGraph,
  audit,
  auditItem,
  executePublishEffects,
  mapNode,
  mapOpenItem,
  assertNodesInProject,
  clearOpenItemRefsBeforeNodeDelete,
} from './engine-shared';
import { hermesPayloadHash } from './canonical-json';

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
        blocked_since_at: Date | null;
        stage_entered_at: Date;
      }[]
    >`
      SELECT id, name, overall_stage, user_deadline_at, updated_at, blocked_since_at, stage_entered_at FROM commercial_projects
      WHERE archived_at IS NULL AND overall_stage <> 'closed'
      ${pattern ? this.db`AND name ILIKE ${pattern}` : this.db``}
      ${query.dateFrom ? this.db`AND user_deadline_at >= ${query.dateFrom}` : this.db``}
      ${query.dateTo ? this.db`AND user_deadline_at <= ${query.dateTo}` : this.db``}
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
          sortKey: hasBlockedNode[0]?.ok
            ? 0
            : r.overall_stage === 'pre_publish'
              ? 1
              : r.overall_stage === 'published_winding_down'
                ? 2
                : 99,
          blockedSinceAt: r.blocked_since_at?.toISOString() ?? null,
          stageEnteredAt: r.stage_entered_at.toISOString(),
        };
      }),
    );
    enriched.sort((a, b) => {
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      if (a.sortKey === 0) {
        const ba = a.blockedSinceAt ? Date.parse(a.blockedSinceAt) : Number.MAX_SAFE_INTEGER;
        const bb = b.blockedSinceAt ? Date.parse(b.blockedSinceAt) : Number.MAX_SAFE_INTEGER;
        if (ba !== bb) return ba - bb;
      } else {
        const sa = Date.parse(a.stageEnteredAt);
        const sb = Date.parse(b.stageEnteredAt);
        if (sa !== sb) return sa - sb;
      }
      const da = a.userDeadlineAt ? Date.parse(a.userDeadlineAt) : Number.MAX_SAFE_INTEGER;
      const db = b.userDeadlineAt ? Date.parse(b.userDeadlineAt) : Number.MAX_SAFE_INTEGER;
      if (da !== db) return da - db;
      return Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    });
    return {
      blocked: enriched.filter((p) => p.sortKey === 0).map(stripListRow),
      prePublish: enriched.filter((p) => p.sortKey === 1).map(stripListRow),
      postPublishOpen: enriched.filter((p) => p.sortKey === 2).map(stripListRow),
    };
  }

  async createProject(body: { name: string; netAmount?: number; rebateAmount?: number }) {
    const id = await this.db.begin(async (tx) =>
      createProjectTx(tx, body, (inner) => this.resolveDefaultTemplateVersionId(inner)),
    );
    return this.getProjectDetail(id)!;
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
    const packages = await this.db<{ id: string; name: string }[]>`
      SELECT id, name FROM wf_packages WHERE workflow_id = ${graph.workflowId} ORDER BY sort_order
    `;
    const { getWorkflowUndoRedoState } = await import('./undo-stack');
    const undoState = await getWorkflowUndoRedoState(this.db, projectId);
    return {
      projectId,
      workflowId: graph.workflowId,
      nodes: graph.nodes.map(mapNode),
      edges: graph.edges.map((e) => ({
        id: e.id,
        fromNodeId: e.from_node_id,
        toNodeId: e.to_node_id,
      })),
      packages,
      canUndo: undoState.canUndo,
      canRedo: undoState.canRedo,
    };
  }

  async advanceToNode(projectId: string, nodeId: string) {
    await this.mutateGraph(projectId, async (tx, graph) => {
      assertNodeInGraph(graph, nodeId);
      const updates = advanceToNode(
        nodeId,
        graph.nodes.map((n) => ({ id: n.id, status: n.status })),
        graph.graphEdges,
      );
      await applyUpdates(tx, graph.workflowId, updates, {
        projectId,
        source: 'advance_to',
      });
      await audit(tx, projectId, 'advance_to', nodeId, Object.fromEntries(updates));
    });
    return (await this.getWorkflow(projectId))!;
  }

  async completeNode(projectId: string, nodeId: string) {
    await this.mutateGraph(projectId, async (tx, graph) => {
      assertNodeInGraph(graph, nodeId);
      let updates: ReturnType<typeof completeNode>;
      try {
        updates = completeNode(
          nodeId,
          graph.nodes.map((n) => ({
            id: n.id,
            status: n.status,
            name: n.name,
            isOptional: n.is_optional,
          })),
          graph.graphEdges,
        );
      } catch (e) {
        if (e instanceof NodeCompletionBlockedError) {
          throw Object.assign(e, { status: 409 });
        }
        throw e;
      }
      await applyUpdates(tx, graph.workflowId, updates, { projectId, source: 'complete' });
      await audit(tx, projectId, 'complete', nodeId, Object.fromEntries(updates));
    });
    return (await this.getWorkflow(projectId))!;
  }

  async rollbackNode(projectId: string, nodeId: string) {
    await this.mutateGraph(projectId, async (tx, graph) => {
      assertNodeInGraph(graph, nodeId);
      const updates = rollbackToNode(
        nodeId,
        graph.nodes.map((n) => ({ id: n.id, status: n.status })),
        graph.graphEdges,
      );
      await applyUpdates(tx, graph.workflowId, updates, { projectId, source: 'rollback' });
      await audit(tx, projectId, 'rollback', nodeId, Object.fromEntries(updates));
    });
    return (await this.getWorkflow(projectId))!;
  }

  async markNodeNotApplicable(projectId: string, nodeId: string) {
    await this.mutateGraph(projectId, async (tx, graph) => {
      const node = assertNodeInGraph(graph, nodeId);
      if (node.phase === 'post_publish_required') {
        throw Object.assign(new Error('required post-publish node cannot be not_applicable'), {
          status: 409,
        });
      }
      if (!node.is_optional && node.phase !== 'post_publish_optional') {
        throw Object.assign(new Error('only optional nodes may be marked not_applicable'), {
          status: 409,
        });
      }
      const { recordNodeStatusHistory } = await import('./node-status-history');
      await recordNodeStatusHistory(tx, {
        projectId,
        nodeId,
        fromStatus: node.status,
        toStatus: 'not_applicable',
        source: 'not_applicable',
      });
      await tx`
        UPDATE wf_nodes SET status = 'not_applicable', completed_at = now(), updated_at = now()
        WHERE id = ${nodeId} AND project_id = ${projectId} AND workflow_id = ${graph.workflowId}
      `;
    });
    return (await this.getWorkflow(projectId))!;
  }

  async createGraphNode(
    projectId: string,
    body: {
      name: string;
      posX: number;
      posY: number;
      phase?: string;
      isOptional?: boolean;
      packageId?: string | null;
      anchorNodeId?: string;
      connectMode?: 'serial' | 'parallel';
    },
  ) {
    const id = crypto.randomUUID();
    await this.mutateGraph(
      projectId,
      async (tx, graph) => {
        if (body.anchorNodeId) assertNodeInGraph(graph, body.anchorNodeId);
        await tx`
          INSERT INTO wf_nodes (id, workflow_id, project_id, name, status, is_optional, pos_x, pos_y, phase, package_id, source)
          VALUES (${id}, ${graph.workflowId}, ${projectId}, ${body.name}, 'not_reached', ${body.isOptional ?? false}, ${body.posX}, ${body.posY}, ${body.phase ?? 'pre_publish'}, ${body.packageId ?? null}, 'web')
        `;
        if (body.anchorNodeId && body.connectMode === 'serial') {
          const outgoing = await tx<{ id: string; to_node_id: string }[]>`
            SELECT id, to_node_id FROM wf_edges
            WHERE workflow_id = ${graph.workflowId} AND from_node_id = ${body.anchorNodeId}
          `;
          await assertEdgeAllowed(tx, graph.workflowId, body.anchorNodeId, id);
          await tx`INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id) VALUES (${crypto.randomUUID()}, ${graph.workflowId}, ${body.anchorNodeId}, ${id})`;
          for (const edge of outgoing) {
            await tx`DELETE FROM wf_edges WHERE id = ${edge.id} AND workflow_id = ${graph.workflowId}`;
            await assertEdgeAllowed(tx, graph.workflowId, id, edge.to_node_id);
            await tx`INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id) VALUES (${crypto.randomUUID()}, ${graph.workflowId}, ${id}, ${edge.to_node_id})`;
          }
        }
        if (body.anchorNodeId && body.connectMode === 'parallel') {
          const incoming = await tx<{ from_node_id: string }[]>`
            SELECT from_node_id FROM wf_edges WHERE workflow_id = ${graph.workflowId} AND to_node_id = ${body.anchorNodeId}
          `;
          for (const row of incoming) {
            await assertEdgeAllowed(tx, graph.workflowId, row.from_node_id, id);
            await tx`INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id) VALUES (${crypto.randomUUID()}, ${graph.workflowId}, ${row.from_node_id}, ${id})`;
          }
          const outgoing = await tx<{ to_node_id: string }[]>`
            SELECT to_node_id FROM wf_edges WHERE workflow_id = ${graph.workflowId} AND from_node_id = ${body.anchorNodeId}
          `;
          for (const row of outgoing) {
            await assertEdgeAllowed(tx, graph.workflowId, id, row.to_node_id);
            await tx`INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id) VALUES (${crypto.randomUUID()}, ${graph.workflowId}, ${id}, ${row.to_node_id})`;
          }
        }
      },
      { recordUndo: true },
    );
    return (await this.getWorkflow(projectId))!;
  }

  async updateGraphNode(
    projectId: string,
    nodeId: string,
    body: {
      name?: string;
      posX?: number;
      posY?: number;
      plannedAt?: string | null;
      phase?: string;
      isOptional?: boolean;
      packageId?: string | null;
    },
  ) {
    await this.mutateGraph(
      projectId,
      async (tx) => {
        const touch = async (rows: { id: string }[]) => {
          if (!rows.length) {
            throw Object.assign(new Error('节点不存在或不属于该项目'), { status: 404 });
          }
        };
        if (body.name !== undefined) {
          await touch(
            await tx`UPDATE wf_nodes SET name = ${body.name}, updated_at = now() WHERE id = ${nodeId} AND project_id = ${projectId} RETURNING id`,
          );
        }
        if (body.posX !== undefined || body.posY !== undefined) {
          await touch(
            await tx`
          UPDATE wf_nodes SET
            pos_x = COALESCE(${body.posX ?? null}, pos_x),
            pos_y = COALESCE(${body.posY ?? null}, pos_y),
            updated_at = now()
          WHERE id = ${nodeId} AND project_id = ${projectId}
          RETURNING id
        `,
          );
        }
        if (body.plannedAt !== undefined) {
          await touch(
            await tx`
          UPDATE wf_nodes SET planned_at = ${body.plannedAt}, updated_at = now()
          WHERE id = ${nodeId} AND project_id = ${projectId}
          RETURNING id
        `,
          );
        }
        if (body.phase !== undefined) {
          await touch(
            await tx`UPDATE wf_nodes SET phase = ${body.phase}, updated_at = now() WHERE id = ${nodeId} AND project_id = ${projectId} RETURNING id`,
          );
        }
        if (body.isOptional !== undefined) {
          await touch(
            await tx`UPDATE wf_nodes SET is_optional = ${body.isOptional}, updated_at = now() WHERE id = ${nodeId} AND project_id = ${projectId} RETURNING id`,
          );
        }
        if (body.packageId !== undefined) {
          await touch(
            await tx`UPDATE wf_nodes SET package_id = ${body.packageId}, updated_at = now() WHERE id = ${nodeId} AND project_id = ${projectId} RETURNING id`,
          );
        }
      },
      { recordUndo: true },
    );
    return (await this.getWorkflow(projectId))!;
  }

  async deleteGraphNode(projectId: string, nodeId: string) {
    await this.mutateGraph(
      projectId,
      async (tx) => {
        await clearOpenItemRefsBeforeNodeDelete(tx, projectId, nodeId);
        await tx`DELETE FROM wf_edges WHERE workflow_id IN (SELECT id FROM project_workflows WHERE project_id = ${projectId}) AND (from_node_id = ${nodeId} OR to_node_id = ${nodeId})`;
        const deleted = await tx<{ id: string }[]>`
          DELETE FROM wf_nodes WHERE id = ${nodeId} AND project_id = ${projectId} RETURNING id
        `;
        if (!deleted.length) {
          throw Object.assign(new Error('节点不存在或不属于该项目'), { status: 404 });
        }
      },
      { recordUndo: true },
    );
    return (await this.getWorkflow(projectId))!;
  }

  async createGraphEdge(projectId: string, fromNodeId: string, toNodeId: string) {
    await this.mutateGraph(
      projectId,
      async (tx, graph) => {
        await assertEdgeAllowed(tx, graph.workflowId, fromNodeId, toNodeId);
        await tx`
        INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
        VALUES (${crypto.randomUUID()}, ${graph.workflowId}, ${fromNodeId}, ${toNodeId})
      `;
      },
      { recordUndo: true },
    );
    return (await this.getWorkflow(projectId))!;
  }

  async deleteGraphEdge(projectId: string, edgeId: string) {
    await this.mutateGraph(
      projectId,
      async (tx) => {
        await tx`
        DELETE FROM wf_edges e USING project_workflows w
        WHERE e.id = ${edgeId} AND e.workflow_id = w.id AND w.project_id = ${projectId}
      `;
      },
      { recordUndo: true },
    );
    return (await this.getWorkflow(projectId))!;
  }

  async applyBatchGraphLayout(
    projectId: string,
    updates: Array<{ nodeId: string; posX: number; posY: number }>,
  ) {
    await this.mutateGraph(
      projectId,
      async (tx, graph) => {
        for (const u of updates) {
          const rows = await tx<{ id: string }[]>`
            UPDATE wf_nodes SET pos_x = ${u.posX}, pos_y = ${u.posY}, updated_at = now()
            WHERE id = ${u.nodeId} AND project_id = ${projectId} AND workflow_id = ${graph.workflowId}
            RETURNING id
          `;
          if (!rows.length) {
            throw Object.assign(new Error('节点不存在或不属于该项目'), { status: 404 });
          }
        }
      },
      { recordUndo: true },
    );
    return (await this.getWorkflow(projectId))!;
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
      const current = await tx<
        { impact: string; blocks_node_id: string | null }[]
      >`SELECT impact, blocks_node_id FROM open_items WHERE id = ${itemId} AND project_id = ${projectId} FOR UPDATE`;
      if (!current[0]) throw Object.assign(new Error('open item not found'), { status: 404 });
      const nextImpact = (patch.impact as string | undefined) ?? current[0].impact;
      const nextBlocks =
        patch.blocksNodeId !== undefined
          ? (patch.blocksNodeId as string | null)
          : current[0].blocks_node_id;
      if (nextImpact === 'blocking' && !nextBlocks) {
        throw Object.assign(new Error('blocking item requires blocksNodeId'), { status: 409 });
      }
      if (nextImpact === 'normal') {
        patch.blocksNodeId = null;
      }
      await assertNodesInProject(tx, projectId, [
        patch.blocksNodeId as string | null | undefined,
        patch.workflowNodeId as string | null | undefined,
      ]);
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
      await auditItem(tx, projectId, 'update', itemId, patch, 'web');
      await syncBlockedAndStage(tx, projectId);
    });
    return (await this.listOpenItems(projectId)).find((i) => i.id === itemId)!;
  }

  async createOpenItem(projectId: string, body: Record<string, unknown>) {
    const id = crypto.randomUUID();
    await this.db.begin(async (tx) => {
      await assertNodesInProject(tx, projectId, [
        body.blocksNodeId as string | null | undefined,
        body.workflowNodeId as string | null | undefined,
      ]);
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
      await auditItem(tx, projectId, 'create', id, { title: String(body.title) }, 'web');
      await syncBlockedAndStage(tx, projectId);
    });
    return (await this.listOpenItems(projectId)).find((i) => i.id === id)!;
  }

  async closeOpenItem(projectId: string, itemId: string, conclusion: string) {
    if (!conclusion.trim()) {
      throw Object.assign(new Error('闭环结论必填'), { status: 400 });
    }
    await this.db.begin(async (tx) => {
      const updated = await tx<{ id: string }[]>`
        UPDATE open_items SET lifecycle = 'closed', close_conclusion = ${conclusion.trim()}, closed_at = now(), updated_at = now()
        WHERE id = ${itemId} AND project_id = ${projectId} AND lifecycle = 'open'
        RETURNING id
      `;
      if (!updated.length) {
        throw Object.assign(new Error('事项不存在或不可闭环'), { status: 404 });
      }
      await auditItem(tx, projectId, 'close', itemId, { conclusion }, 'web');
      await syncBlockedAndStage(tx, projectId);
    });
    const item = (await this.listOpenItems(projectId)).find((i) => i.id === itemId);
    if (!item) throw Object.assign(new Error('事项不存在'), { status: 404 });
    return item;
  }

  async cancelOpenItem(projectId: string, itemId: string, reason: string) {
    if (!reason.trim()) {
      throw Object.assign(new Error('取消原因必填'), { status: 400 });
    }
    await this.db.begin(async (tx) => {
      const updated = await tx<{ id: string }[]>`
        UPDATE open_items SET lifecycle = 'cancelled', cancel_reason = ${reason.trim()}, updated_at = now()
        WHERE id = ${itemId} AND project_id = ${projectId} AND lifecycle = 'open'
        RETURNING id
      `;
      if (!updated.length) {
        throw Object.assign(new Error('事项不存在或不可取消'), { status: 404 });
      }
      await auditItem(tx, projectId, 'cancel', itemId, { reason }, 'web');
      await syncBlockedAndStage(tx, projectId);
    });
    const item = (await this.listOpenItems(projectId)).find((i) => i.id === itemId);
    if (!item) throw Object.assign(new Error('事项不存在'), { status: 404 });
    return item;
  }

  async listOpenItemHistory(projectId: string, itemId: string) {
    const { normalizeAuditDetail } = await import('./audit-json');
    const rows = await this.db<
      { action: string; detail: unknown; source: string; created_at: Date }[]
    >`
      SELECT action, detail, source, created_at FROM workflow_audit_log
      WHERE project_id = ${projectId} AND entity_type = 'open_item' AND entity_id = ${itemId}
      ORDER BY created_at ASC
    `;
    return rows.map((r) => ({
      action: r.action,
      detail: normalizeAuditDetail(r.detail),
      source: r.source,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async splitOpenItem(projectId: string, itemId: string, newTitles: string[]) {
    await this.db.begin(async (tx) => {
      const src =
        await tx`SELECT * FROM open_items WHERE id = ${itemId} AND project_id = ${projectId} FOR UPDATE`;
      if (!src[0] || src[0].lifecycle !== 'open') {
        throw Object.assign(new Error('open item not found'), { status: 404 });
      }
      await tx`UPDATE open_items SET lifecycle = 'closed', close_conclusion = '拆分为多条', closed_at = now(), updated_at = now() WHERE id = ${itemId}`;
      const created: string[] = [];
      for (const title of newTitles) {
        const id = crypto.randomUUID();
        await tx`
          INSERT INTO open_items (id, project_id, title, next_actor, lifecycle, impact)
          VALUES (${id}, ${projectId}, ${title}, ${src[0].next_actor}, 'open', 'normal')
        `;
        created.push(id);
      }
      await auditItem(tx, projectId, 'split', itemId, { created }, 'web');
      await syncBlockedAndStage(tx, projectId);
    });
    return this.listOpenItems(projectId);
  }

  async mergeOpenItems(projectId: string, itemIds: string[], mergedTitle: string) {
    await this.db.begin(async (tx) => {
      for (const id of itemIds) {
        const row =
          await tx`SELECT id FROM open_items WHERE id = ${id} AND project_id = ${projectId} AND lifecycle = 'open' FOR UPDATE`;
        if (!row[0]) throw Object.assign(new Error('找不到可合并的开放事项'), { status: 404 });
      }
      for (const id of itemIds) {
        await tx`UPDATE open_items SET lifecycle = 'closed', close_conclusion = '合并', closed_at = now(), updated_at = now() WHERE id = ${id}`;
      }
      const mergedId = crypto.randomUUID();
      await tx`
        INSERT INTO open_items (id, project_id, title, next_actor, lifecycle, impact)
        VALUES (${mergedId}, ${projectId}, ${mergedTitle}, 'us', 'open', 'normal')
      `;
      await auditItem(tx, projectId, 'merge', mergedId, { from: itemIds }, 'web');
      await syncBlockedAndStage(tx, projectId);
    });
    return this.listOpenItems(projectId);
  }

  async promoteOpenItemToNode(
    projectId: string,
    itemId: string,
    nodeName: string,
    pos?: { x: number; y: number },
  ) {
    let nodeId = '';
    await this.db.begin(async (tx) => {
      const item =
        await tx`SELECT * FROM open_items WHERE id = ${itemId} AND project_id = ${projectId} FOR UPDATE`;
      if (!item[0]) throw Object.assign(new Error('open item not found'), { status: 404 });
      nodeId = crypto.randomUUID();
      await mutateProjectGraph(
        tx,
        projectId,
        async (tx, graph) => {
          await tx`
            INSERT INTO wf_nodes (id, workflow_id, project_id, name, status, pos_x, pos_y, phase, source)
            VALUES (${nodeId}, ${graph.workflowId}, ${projectId}, ${nodeName}, 'not_reached', ${pos?.x ?? 0}, ${pos?.y ?? 0}, 'pre_publish', 'web')
          `;
          await tx`UPDATE open_items SET workflow_node_id = ${nodeId}, updated_at = now() WHERE id = ${itemId}`;
        },
        { recordUndo: true },
      );
      await auditItem(tx, projectId, 'promote_to_node', itemId, { nodeId, nodeName }, 'web');
    });
    return { nodeId, workflow: await this.getWorkflow(projectId) };
  }

  async publishProject(
    projectId: string,
    body: { bvid: string; publishedAt: string; idempotencyKey: string },
  ): Promise<PublishResultDto> {
    return this.db.begin(async (tx) => {
      await tx`SELECT pg_advisory_xact_lock(hashtext(${body.idempotencyKey}))`;
      const payloadHash = hermesPayloadHash('publish_video', projectId, {
        projectId,
        bvid: body.bvid,
        publishedAt: body.publishedAt,
      });
      const prior = await tx<
        {
          operation: string;
          project_id: string | null;
          payload_hash: string;
          result_json: unknown;
        }[]
      >`
        SELECT operation, project_id, payload_hash, result_json FROM hermes_idempotency
        WHERE idempotency_key = ${body.idempotencyKey} FOR UPDATE
      `;
      if (prior[0]) {
        if (
          prior[0].operation !== 'publish_video' ||
          prior[0].project_id !== projectId ||
          prior[0].payload_hash !== payloadHash
        ) {
          throw Object.assign(new Error('idempotency key conflict'), { status: 409 });
        }
        return prior[0].result_json as PublishResultDto;
      }
      const existingPub = await tx<{ idempotency_key: string | null }[]>`
        SELECT idempotency_key FROM project_publish_records WHERE project_id = ${projectId}
      `;
      if (
        existingPub[0]?.idempotency_key &&
        existingPub[0].idempotency_key !== body.idempotencyKey
      ) {
        throw Object.assign(new Error('project already published'), { status: 409 });
      }
      const result = await executePublishEffects(tx, projectId, body, 'web');
      await tx`
        INSERT INTO hermes_idempotency (idempotency_key, operation, project_id, payload_hash, result_json)
        VALUES (${body.idempotencyKey}, 'publish_video', ${projectId}, ${payloadHash}, ${JSON.stringify(result)}::jsonb)
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
    opts?: { recordUndo?: boolean },
  ) {
    await this.db.begin(async (tx) => mutateProjectGraph(tx, projectId, fn, opts));
  }

  async undoGraph(projectId: string) {
    const { undoProjectGraph } = await import('./undo-stack');
    await this.db.begin(async (tx) => undoProjectGraph(tx, projectId));
    return (await this.getWorkflow(projectId))!;
  }

  async redoGraph(projectId: string) {
    const { redoProjectGraph } = await import('./undo-stack');
    await this.db.begin(async (tx) => redoProjectGraph(tx, projectId));
    return (await this.getWorkflow(projectId))!;
  }
}

function stripListRow<
  T extends { sortKey: number; blockedSinceAt?: string | null; stageEnteredAt?: string },
>(row: T) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit internal sort fields
  const { sortKey, blockedSinceAt, stageEnteredAt, ...rest } = row;
  return rest;
}
