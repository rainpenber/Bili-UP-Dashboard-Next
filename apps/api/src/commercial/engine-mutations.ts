import type { HermesWriteEnvelope } from '@studio/contracts';
import { advanceToNode, completeNode, rollbackToNode } from '@studio/workflow';
import { assertEdgeAllowed, loadWorkflowGraph, type Db } from './graph-io';
import {
  applyUpdates,
  assertNodeInGraph,
  assertNodesInProject,
  clearOpenItemRefsBeforeNodeDelete,
  audit,
  auditItem,
  executePublishEffects,
  getWorkflowTx,
  mapOpenItem,
} from './engine-shared';
import { syncBlockedAndStage } from './sync-state';
import { pushUndoSnapshot } from './undo-stack';

export async function mutateProjectGraph(
  tx: Db,
  projectId: string,
  fn: (tx: Db, graph: NonNullable<Awaited<ReturnType<typeof loadWorkflowGraph>>>) => Promise<void>,
  opts?: { recordUndo?: boolean },
) {
  if (opts?.recordUndo) await pushUndoSnapshot(tx, projectId);
  const graph = await loadWorkflowGraph(tx, projectId, true);
  if (!graph) throw Object.assign(new Error('workflow not found'), { status: 404 });
  await fn(tx, graph);
  await syncBlockedAndStage(tx, projectId);
}

export async function copyTemplateIntoWorkflow(
  tx: Db,
  workflowId: string,
  projectId: string,
  templateVersionId: string,
) {
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
  const tplPackages = await tx<{ id: string; name: string; sort_order: number }[]>`
    SELECT id, name, sort_order FROM wf_template_packages WHERE template_version_id = ${templateVersionId}
  `;
  const pkgMap = new Map<string, string>();
  for (const pkg of tplPackages) {
    const pkgId = crypto.randomUUID();
    pkgMap.set(pkg.id, pkgId);
    await tx`
      INSERT INTO wf_packages (id, workflow_id, name, sort_order)
      VALUES (${pkgId}, ${workflowId}, ${pkg.name}, ${pkg.sort_order})
    `;
  }
  const idMap = new Map<string, string>();
  for (const tn of tplNodes) {
    const nodeId = crypto.randomUUID();
    idMap.set(tn.id, nodeId);
    const status = tn.slug === 'inquiry' ? 'completed' : 'not_reached';
    const instancePkg = tn.package_id ? (pkgMap.get(tn.package_id) ?? null) : null;
    await tx`
      INSERT INTO wf_nodes (id, workflow_id, project_id, template_node_id, package_id, name, status, is_optional, pos_x, pos_y, phase)
      VALUES (${nodeId}, ${workflowId}, ${projectId}, ${tn.id}, ${instancePkg}, ${tn.name}, ${status}, ${tn.is_optional}, ${tn.pos_x}, ${tn.pos_y}, ${tn.phase})
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
      VALUES (${crypto.randomUUID()}, ${workflowId}, ${fromId}, ${toId})
    `;
  }
}

export async function createProjectTx(
  tx: Db,
  body: { name: string; netAmount?: number; rebateAmount?: number },
  resolveDefaultTemplateVersionId: (tx: Db) => Promise<string>,
) {
  const id = crypto.randomUUID();
  const templateVersionId = await resolveDefaultTemplateVersionId(tx);
  await tx`
    INSERT INTO commercial_projects (id, name, net_amount, rebate_amount)
    VALUES (${id}, ${body.name}, ${body.netAmount ?? null}, ${body.rebateAmount ?? null})
  `;
  const wfId = crypto.randomUUID();
  await tx`
    INSERT INTO project_workflows (id, project_id, template_version_id)
    VALUES (${wfId}, ${id}, ${templateVersionId})
  `;
  await copyTemplateIntoWorkflow(tx, wfId, id, templateVersionId);
  await syncBlockedAndStage(tx, id);
  return id;
}

export async function applyHermesEnvelopeTx(
  tx: Db,
  envelope: HermesWriteEnvelope,
  resolveDefaultTemplateVersionId: (tx: Db) => Promise<string>,
): Promise<unknown> {
  const { operation, payload } = envelope;
  switch (operation) {
    case 'upsert_project': {
      if (payload.projectId) {
        await tx`UPDATE commercial_projects SET name = ${payload.name}, updated_at = now() WHERE id = ${payload.projectId}`;
        return { projectId: payload.projectId };
      }
      const id = await createProjectTx(
        tx,
        {
          name: payload.name,
          ...(payload.netAmount !== undefined ? { netAmount: payload.netAmount } : {}),
          ...(payload.rebateAmount !== undefined ? { rebateAmount: payload.rebateAmount } : {}),
        },
        resolveDefaultTemplateVersionId,
      );
      await audit(tx, id, 'create_project', id, payload, 'hermes');
      return { projectId: id };
    }
    case 'advance_node':
      await mutateProjectGraph(tx, payload.projectId, async (tx, graph) => {
        assertNodeInGraph(graph, payload.nodeId);
        const updates = advanceToNode(
          payload.nodeId,
          graph.nodes.map((n) => ({ id: n.id, status: n.status })),
          graph.graphEdges,
        );
        await applyUpdates(tx, graph.workflowId, updates);
        await audit(
          tx,
          payload.projectId,
          'advance_to',
          payload.nodeId,
          Object.fromEntries(updates),
          'hermes',
        );
      });
      return getWorkflowTx(tx, payload.projectId);
    case 'complete_node':
      await mutateProjectGraph(tx, payload.projectId, async (tx, graph) => {
        assertNodeInGraph(graph, payload.nodeId);
        const updates = completeNode(
          payload.nodeId,
          graph.nodes.map((n) => ({ id: n.id, status: n.status })),
          graph.graphEdges,
        );
        await applyUpdates(tx, graph.workflowId, updates);
        await audit(
          tx,
          payload.projectId,
          'complete',
          payload.nodeId,
          Object.fromEntries(updates),
          'hermes',
        );
      });
      return getWorkflowTx(tx, payload.projectId);
    case 'rollback_node':
      await mutateProjectGraph(tx, payload.projectId, async (tx, graph) => {
        assertNodeInGraph(graph, payload.nodeId);
        const updates = rollbackToNode(
          payload.nodeId,
          graph.nodes.map((n) => ({ id: n.id, status: n.status })),
          graph.graphEdges,
        );
        await applyUpdates(tx, graph.workflowId, updates);
        await audit(
          tx,
          payload.projectId,
          'rollback',
          payload.nodeId,
          Object.fromEntries(updates),
          'hermes',
        );
      });
      return getWorkflowTx(tx, payload.projectId);
    case 'mark_node_not_applicable':
      await mutateProjectGraph(tx, payload.projectId, async (tx, graph) => {
        const node = assertNodeInGraph(graph, payload.nodeId);
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
        await tx`
          UPDATE wf_nodes SET status = 'not_applicable', completed_at = now(), updated_at = now()
          WHERE id = ${payload.nodeId} AND project_id = ${payload.projectId} AND workflow_id = ${graph.workflowId}
        `;
      });
      return getWorkflowTx(tx, payload.projectId);
    case 'add_graph_node': {
      const id = crypto.randomUUID();
      await mutateProjectGraph(
        tx,
        payload.projectId,
        async (tx, graph) => {
          await tx`
          INSERT INTO wf_nodes (id, workflow_id, project_id, name, status, pos_x, pos_y, phase, package_id, source)
          VALUES (${id}, ${graph.workflowId}, ${payload.projectId}, ${payload.name}, 'not_reached', ${payload.posX}, ${payload.posY}, ${payload.phase ?? 'pre_publish'}, ${payload.packageId ?? null}, 'hermes')
        `;
          if (payload.connectFromNodeId) {
            await assertEdgeAllowed(tx, graph.workflowId, payload.connectFromNodeId, id);
            await tx`INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id) VALUES (${crypto.randomUUID()}, ${graph.workflowId}, ${payload.connectFromNodeId}, ${id})`;
          }
          if (payload.connectToNodeId) {
            await assertEdgeAllowed(tx, graph.workflowId, id, payload.connectToNodeId);
            await tx`INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id) VALUES (${crypto.randomUUID()}, ${graph.workflowId}, ${id}, ${payload.connectToNodeId})`;
          }
        },
        { recordUndo: true },
      );
      return getWorkflowTx(tx, payload.projectId);
    }
    case 'update_graph_node':
      await mutateProjectGraph(
        tx,
        payload.projectId,
        async (tx, graph) => {
          assertNodeInGraph(graph, payload.nodeId);
          if (payload.name !== undefined)
            await tx`UPDATE wf_nodes SET name = ${payload.name}, updated_at = now() WHERE id = ${payload.nodeId} AND project_id = ${payload.projectId}`;
          if (payload.posX !== undefined || payload.posY !== undefined)
            await tx`UPDATE wf_nodes SET pos_x = COALESCE(${payload.posX ?? null}, pos_x), pos_y = COALESCE(${payload.posY ?? null}, pos_y), updated_at = now() WHERE id = ${payload.nodeId}`;
          if (payload.plannedAt !== undefined)
            await tx`UPDATE wf_nodes SET planned_at = ${payload.plannedAt}, updated_at = now() WHERE id = ${payload.nodeId}`;
          if (payload.phase !== undefined)
            await tx`UPDATE wf_nodes SET phase = ${payload.phase}, updated_at = now() WHERE id = ${payload.nodeId}`;
          if (payload.packageId !== undefined)
            await tx`UPDATE wf_nodes SET package_id = ${payload.packageId}, updated_at = now() WHERE id = ${payload.nodeId}`;
        },
        { recordUndo: true },
      );
      return getWorkflowTx(tx, payload.projectId);
    case 'delete_graph_node':
      await mutateProjectGraph(
        tx,
        payload.projectId,
        async (tx, graph) => {
          assertNodeInGraph(graph, payload.nodeId);
          await clearOpenItemRefsBeforeNodeDelete(tx, payload.projectId, payload.nodeId);
          await tx`DELETE FROM wf_edges WHERE workflow_id = ${graph.workflowId} AND (from_node_id = ${payload.nodeId} OR to_node_id = ${payload.nodeId})`;
          await tx`DELETE FROM wf_nodes WHERE id = ${payload.nodeId} AND project_id = ${payload.projectId}`;
        },
        { recordUndo: true },
      );
      return getWorkflowTx(tx, payload.projectId);
    case 'add_graph_edge':
      await mutateProjectGraph(
        tx,
        payload.projectId,
        async (tx, graph) => {
          await assertEdgeAllowed(tx, graph.workflowId, payload.fromNodeId, payload.toNodeId);
          await tx`INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id) VALUES (${crypto.randomUUID()}, ${graph.workflowId}, ${payload.fromNodeId}, ${payload.toNodeId})`;
        },
        { recordUndo: true },
      );
      return getWorkflowTx(tx, payload.projectId);
    case 'delete_graph_edge':
      await mutateProjectGraph(
        tx,
        payload.projectId,
        async (tx) => {
          await tx`
          DELETE FROM wf_edges e USING project_workflows w
          WHERE e.id = ${payload.edgeId} AND e.workflow_id = w.id AND w.project_id = ${payload.projectId}
        `;
        },
        { recordUndo: true },
      );
      return getWorkflowTx(tx, payload.projectId);
    case 'create_open_item': {
      const itemId = crypto.randomUUID();
      const { projectId, ...body } = payload;
      await assertNodesInProject(tx, projectId, [body.blocksNodeId, body.workflowNodeId]);
      await tx`
        INSERT INTO open_items (id, project_id, title, description, close_criteria, next_action, next_actor, impact, blocks_node_id, workflow_node_id, planned_at, sort_rank)
        VALUES (${itemId}, ${projectId}, ${body.title}, ${body.description ?? null}, ${body.closeCriteria ?? null}, ${body.nextAction ?? null},
          ${body.nextActor}, ${body.impact ?? 'normal'}, ${body.blocksNodeId ?? null}, ${body.workflowNodeId ?? null}, ${body.plannedAt ?? null}, ${body.sortRank ?? 0})
      `;
      await auditItem(tx, projectId, 'create', itemId, body, 'hermes');
      await syncBlockedAndStage(tx, projectId);
      const row = await tx`SELECT * FROM open_items WHERE id = ${itemId}`;
      return mapOpenItem(row[0] as never);
    }
    case 'update_open_item': {
      const { projectId, itemId, ...patch } = payload;
      const current = await tx<{ impact: string; blocks_node_id: string | null }[]>`
        SELECT impact, blocks_node_id FROM open_items WHERE id = ${itemId} AND project_id = ${projectId} FOR UPDATE
      `;
      if (!current[0]) throw Object.assign(new Error('open item not found'), { status: 404 });
      const nextImpact = patch.impact ?? current[0].impact;
      const nextBlocks =
        patch.blocksNodeId !== undefined ? patch.blocksNodeId : current[0].blocks_node_id;
      if (nextImpact === 'blocking' && !nextBlocks)
        throw Object.assign(new Error('blocking item requires blocksNodeId'), { status: 409 });
      await assertNodesInProject(tx, projectId, [patch.blocksNodeId, patch.workflowNodeId]);
      if (patch.title !== undefined)
        await tx`UPDATE open_items SET title = ${patch.title}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.description !== undefined)
        await tx`UPDATE open_items SET description = ${patch.description ?? null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.closeCriteria !== undefined)
        await tx`UPDATE open_items SET close_criteria = ${patch.closeCriteria ?? null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.nextAction !== undefined)
        await tx`UPDATE open_items SET next_action = ${patch.nextAction ?? null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.nextActor !== undefined)
        await tx`UPDATE open_items SET next_actor = ${patch.nextActor}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.plannedAt !== undefined)
        await tx`UPDATE open_items SET planned_at = ${patch.plannedAt ?? null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.impact !== undefined)
        await tx`UPDATE open_items SET impact = ${patch.impact}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.blocksNodeId !== undefined)
        await tx`UPDATE open_items SET blocks_node_id = ${patch.blocksNodeId ?? null}, updated_at = now() WHERE id = ${itemId}`;
      if (patch.workflowNodeId !== undefined)
        await tx`UPDATE open_items SET workflow_node_id = ${patch.workflowNodeId ?? null}, updated_at = now() WHERE id = ${itemId}`;
      await auditItem(tx, projectId, 'update', itemId, patch, 'hermes');
      await syncBlockedAndStage(tx, projectId);
      const row = await tx`SELECT * FROM open_items WHERE id = ${itemId}`;
      return mapOpenItem(row[0] as never);
    }
    case 'close_open_item':
      await tx`
        UPDATE open_items SET lifecycle = 'closed', close_conclusion = ${payload.conclusion}, closed_at = now(), updated_at = now()
        WHERE id = ${payload.itemId} AND project_id = ${payload.projectId}
      `;
      await auditItem(
        tx,
        payload.projectId,
        'close',
        payload.itemId,
        { conclusion: payload.conclusion },
        'hermes',
      );
      await syncBlockedAndStage(tx, payload.projectId);
      return mapOpenItem(
        (await tx`SELECT * FROM open_items WHERE id = ${payload.itemId}`)[0] as never,
      );
    case 'cancel_open_item':
      await tx`
        UPDATE open_items SET lifecycle = 'cancelled', description = COALESCE(description, '') || ${'\n取消原因：' + payload.reason}, updated_at = now()
        WHERE id = ${payload.itemId} AND project_id = ${payload.projectId} AND lifecycle = 'open'
      `;
      await auditItem(
        tx,
        payload.projectId,
        'cancel',
        payload.itemId,
        { reason: payload.reason },
        'hermes',
      );
      await syncBlockedAndStage(tx, payload.projectId);
      return mapOpenItem(
        (await tx`SELECT * FROM open_items WHERE id = ${payload.itemId}`)[0] as never,
      );
    case 'split_open_item': {
      const src =
        await tx`SELECT * FROM open_items WHERE id = ${payload.itemId} AND project_id = ${payload.projectId} FOR UPDATE`;
      if (!src[0] || src[0].lifecycle !== 'open')
        throw Object.assign(new Error('open item not found'), { status: 404 });
      await tx`UPDATE open_items SET lifecycle = 'closed', close_conclusion = '拆分为多条', closed_at = now() WHERE id = ${payload.itemId}`;
      const created = [];
      for (const title of payload.newTitles) {
        const id = crypto.randomUUID();
        await tx`
          INSERT INTO open_items (id, project_id, title, next_actor, lifecycle, impact)
          VALUES (${id}, ${payload.projectId}, ${title}, ${src[0].next_actor}, 'open', 'normal')
        `;
        created.push(id);
      }
      await auditItem(tx, payload.projectId, 'split', payload.itemId, { created }, 'hermes');
      await syncBlockedAndStage(tx, payload.projectId);
      return { createdItemIds: created };
    }
    case 'merge_open_items': {
      for (const id of payload.itemIds) {
        await tx`UPDATE open_items SET lifecycle = 'closed', close_conclusion = '合并', closed_at = now() WHERE id = ${id} AND project_id = ${payload.projectId}`;
      }
      const mergedId = crypto.randomUUID();
      await tx`
        INSERT INTO open_items (id, project_id, title, next_actor, lifecycle, impact)
        VALUES (${mergedId}, ${payload.projectId}, ${payload.mergedTitle}, 'us', 'open', 'normal')
      `;
      await auditItem(
        tx,
        payload.projectId,
        'merge',
        mergedId,
        { from: payload.itemIds },
        'hermes',
      );
      await syncBlockedAndStage(tx, payload.projectId);
      return { mergedItemId: mergedId };
    }
    case 'promote_open_item_to_node': {
      const item =
        await tx`SELECT * FROM open_items WHERE id = ${payload.itemId} AND project_id = ${payload.projectId} FOR UPDATE`;
      if (!item[0]) throw Object.assign(new Error('open item not found'), { status: 404 });
      const nodeId = crypto.randomUUID();
      await mutateProjectGraph(
        tx,
        payload.projectId,
        async (tx, graph) => {
          await tx`
          INSERT INTO wf_nodes (id, workflow_id, project_id, name, status, pos_x, pos_y, phase, source)
          VALUES (${nodeId}, ${graph.workflowId}, ${payload.projectId}, ${payload.nodeName}, 'not_reached', ${payload.posX ?? 0}, ${payload.posY ?? 0}, 'pre_publish', 'hermes')
        `;
          await tx`UPDATE open_items SET workflow_node_id = ${nodeId}, updated_at = now() WHERE id = ${payload.itemId}`;
        },
        { recordUndo: true },
      );
      return { nodeId, workflow: await getWorkflowTx(tx, payload.projectId) };
    }
    case 'publish_video': {
      const existingPub = await tx<
        { idempotency_key: string | null; bvid: string; published_at: Date }[]
      >`
        SELECT idempotency_key, bvid, published_at FROM project_publish_records WHERE project_id = ${payload.projectId}
      `;
      if (existingPub[0]) {
        if (existingPub[0].idempotency_key !== envelope.idempotencyKey) {
          throw Object.assign(new Error('project already published'), { status: 409 });
        }
        const { getMonitorDto } = await import('./engine-shared');
        return {
          projectId: payload.projectId,
          bvid: existingPub[0].bvid,
          publishedAt: existingPub[0].published_at.toISOString(),
          forcedCompleteAudit: [],
          monitor: await getMonitorDto(tx, payload.projectId),
        };
      }
      return executePublishEffects(
        tx,
        payload.projectId,
        {
          bvid: payload.bvid,
          publishedAt: payload.publishedAt,
          idempotencyKey: envelope.idempotencyKey,
        },
        'hermes',
      );
    }
    case 'reset_project_workflow': {
      const custom = await tx<{ c: string }[]>`
        SELECT count(*)::text AS c FROM wf_nodes WHERE project_id = ${payload.projectId} AND source <> 'template'
      `;
      if (Number(custom[0]?.c ?? '0') > 0 && !payload.confirmDestroyCustomGraph) {
        throw Object.assign(new Error('custom graph nodes exist; confirmation required'), {
          status: 409,
        });
      }
      const wf = await tx<{ id: string }[]>`
        SELECT id FROM project_workflows WHERE project_id = ${payload.projectId} FOR UPDATE
      `;
      if (!wf[0]) throw Object.assign(new Error('workflow not found'), { status: 404 });
      await pushUndoSnapshot(tx, payload.projectId);
      await tx`DELETE FROM wf_edges WHERE workflow_id = ${wf[0].id}`;
      await tx`DELETE FROM wf_nodes WHERE workflow_id = ${wf[0].id}`;
      await tx`DELETE FROM wf_packages WHERE workflow_id = ${wf[0].id}`;
      await tx`UPDATE project_workflows SET template_version_id = ${payload.templateVersionId} WHERE id = ${wf[0].id}`;
      await copyTemplateIntoWorkflow(tx, wf[0].id, payload.projectId, payload.templateVersionId);
      await syncBlockedAndStage(tx, payload.projectId);
      return getWorkflowTx(tx, payload.projectId);
    }
    default:
      throw Object.assign(new Error('unsupported operation'), { status: 400 });
  }
}
