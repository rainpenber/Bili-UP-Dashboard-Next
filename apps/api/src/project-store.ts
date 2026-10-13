import type {
  CreateOpenItemBody,
  HermesPayload,
  PatchOpenItemBody,
  PatchProjectBody,
  PatchWorkflowNodeBody,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import type postgres from 'postgres';
import {
  assertValidNodeTransition,
  deriveHealthStatus,
  deriveProjectStage,
  recomputeAfterManualChange,
  TransitionError,
  type WorkflowNodeSnapshot,
} from '@studio/workflow';

export type DbExecutor = Sql | postgres.TransactionSql;

const TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

export async function assertWorkflowNodeInProject(
  tx: DbExecutor,
  projectId: string,
  nodeId: string,
): Promise<void> {
  const rows = await tx<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM workflow_nodes wn
      JOIN project_workflows pw ON pw.id = wn.project_workflow_id
      WHERE wn.id = ${nodeId} AND pw.project_id = ${projectId}
    ) AS ok
  `;
  if (!rows[0]?.ok) {
    const err = new Error('workflow_node_id does not belong to project');
    (err as Error & { status: number }).status = 400;
    throw err;
  }
}

export async function loadWorkflowGraphTx(tx: DbExecutor, projectId: string) {
  const wfRows = await tx<{ id: string }[]>`
    SELECT id FROM project_workflows WHERE project_id = ${projectId}
  `;
  const wfId = wfRows[0]?.id;
  if (!wfId) return null;
  const rows = await tx<
    {
      id: string;
      slug: string;
      parent_id: string | null;
      sort_order: number;
      is_required: boolean;
      dependency_mode: 'all_of' | 'any_of';
      status: WorkflowNodeSnapshot['status'];
      stage_key: string | null;
      blocked_reason: string | null;
    }[]
  >`SELECT id, slug, parent_id, sort_order, is_required, dependency_mode, status, stage_key, blocked_reason
     FROM workflow_nodes WHERE project_workflow_id = ${wfId}`;
  const depRows = await tx<{ node_id: string; depends_on_node_id: string }[]>`
    SELECT node_id, depends_on_node_id FROM workflow_node_dependencies d
    JOIN workflow_nodes n ON n.id = d.node_id WHERE n.project_workflow_id = ${wfId}
  `;
  return {
    wfId,
    nodes: rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      parentId: r.parent_id,
      sortOrder: r.sort_order,
      isRequired: r.is_required,
      dependencyMode: r.dependency_mode,
      status: r.status,
      stageKey: r.stage_key,
      blockedReason: r.blocked_reason,
    })),
    deps: depRows.map((d) => ({ nodeId: d.node_id, dependsOnId: d.depends_on_node_id })),
  };
}

export async function syncProjectDerivedStateTx(tx: DbExecutor, projectId: string): Promise<void> {
  const graph = await loadWorkflowGraphTx(tx, projectId);
  if (!graph) return;
  const closingRows = await tx<{ item_type: string }[]>`
    SELECT item_type FROM open_items
    WHERE project_id = ${projectId} AND status = 'open'
  `;
  const stage = deriveProjectStage(
    graph.nodes,
    closingRows.map((r) => r.item_type),
  );
  const openRows = await tx<{ overdue: string }[]>`
    SELECT count(*) FILTER (WHERE status = 'open' AND due_at < now())::text AS overdue
    FROM open_items WHERE project_id = ${projectId}
  `;
  const hasOur = await tx<{ count: string }[]>`
    SELECT count(*)::text AS count FROM open_items
    WHERE project_id = ${projectId} AND status = 'open' AND responsible_party = 'us'
  `;
  const health = deriveHealthStatus(
    graph.nodes,
    graph.deps,
    Number(hasOur[0]?.count ?? '0') > 0,
    Number(openRows[0]?.overdue ?? '0') > 0,
  );
  await tx`
    UPDATE projects SET derived_stage = ${stage}, health_status = ${health}, updated_at = now()
    WHERE id = ${projectId}
  `;
}

export async function applyProjectPatchTx(
  tx: DbExecutor,
  projectId: string,
  body: PatchProjectBody,
): Promise<void> {
  const existing = await tx<
    {
      name: string;
      brand: string | null;
      product: string | null;
      cooperation_type: string | null;
      planned_publish_at: Date | null;
      owner_id: string | null;
      source_status: string;
    }[]
  >`SELECT name, brand, product, cooperation_type, planned_publish_at, owner_id, source_status FROM projects WHERE id = ${projectId} FOR UPDATE`;
  const row = existing[0];
  if (!row) {
    const err = new Error('project not found');
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  await tx`
    UPDATE projects SET
      name = ${body.name ?? row.name},
      brand = ${body.brand !== undefined ? body.brand : row.brand},
      product = ${body.product !== undefined ? body.product : row.product},
      cooperation_type = ${body.cooperationType !== undefined ? body.cooperationType : row.cooperation_type},
      planned_publish_at = ${body.plannedPublishAt !== undefined ? body.plannedPublishAt : (row.planned_publish_at?.toISOString() ?? null)},
      owner_id = ${body.ownerId !== undefined ? body.ownerId : row.owner_id},
      source_status = ${body.sourceStatus ?? row.source_status},
      updated_at = now()
    WHERE id = ${projectId}
  `;
}

export async function patchWorkflowNodeTx(
  tx: DbExecutor,
  projectId: string,
  nodeId: string,
  body: PatchWorkflowNodeBody,
  nodeSnapshot: {
    ownerId: string | null;
    dueAt: string | null;
    blockedReason: string | null;
    statusChangedAt: string;
    completedAt: string | null;
  },
): Promise<void> {
  await assertWorkflowNodeInProject(tx, projectId, nodeId);
  const current = await tx<{ status: WorkflowNodeSnapshot['status'] }[]>`
    SELECT status FROM workflow_nodes WHERE id = ${nodeId} FOR UPDATE
  `;
  const fromStatus = current[0]?.status;
  if (!fromStatus) throw new Error('node missing');
  if (body.status && body.status !== fromStatus) {
    try {
      assertValidNodeTransition(fromStatus, body.status);
    } catch (err) {
      if (err instanceof TransitionError) {
        const e = new Error(err.message);
        (e as Error & { status: number }).status = 409;
        throw e;
      }
      throw err;
    }
  }
  const nextStatus = body.status ?? fromStatus;
  const nextOwnerId = body.ownerId !== undefined ? body.ownerId : nodeSnapshot.ownerId;
  const nextDueAt = body.dueAt !== undefined ? body.dueAt : nodeSnapshot.dueAt;
  const nextBlockedReason =
    body.blockedReason !== undefined ? body.blockedReason : nodeSnapshot.blockedReason;
  const statusChanged = nextStatus !== fromStatus;
  const nextCompletedAt =
    nextStatus === 'completed'
      ? new Date()
      : statusChanged
        ? null
        : nodeSnapshot.completedAt
          ? new Date(nodeSnapshot.completedAt)
          : null;
  await tx`
    UPDATE workflow_nodes SET
      status = ${nextStatus},
      owner_id = ${nextOwnerId},
      due_at = ${nextDueAt},
      blocked_reason = ${nextBlockedReason},
      status_changed_at = ${statusChanged ? new Date() : new Date(nodeSnapshot.statusChangedAt)},
      completed_at = ${nextCompletedAt}
    WHERE id = ${nodeId}
  `;
  if (body.status && body.status !== fromStatus) {
    await tx`
      INSERT INTO workflow_node_status_history (node_id, from_status, to_status)
      VALUES (${nodeId}, ${fromStatus}, ${body.status})
    `;
  }
  const refreshed = await loadWorkflowGraphTx(tx, projectId);
  if (!refreshed) return;
  const recompute = recomputeAfterManualChange(refreshed.nodes, refreshed.deps);
  for (const [id, status] of recompute.statusUpdates) {
    await tx`
      UPDATE workflow_nodes SET status = ${status}, status_changed_at = now()
      WHERE id = ${id}
    `;
  }
  await syncProjectDerivedStateTx(tx, projectId);
}

export async function createOpenItemTx(
  tx: DbExecutor,
  projectId: string,
  body: CreateOpenItemBody,
): Promise<string> {
  if (body.workflowNodeId) {
    await assertWorkflowNodeInProject(tx, projectId, body.workflowNodeId);
  }
  const id = crypto.randomUUID();
  await tx`
    INSERT INTO open_items (
      id, project_id, workflow_node_id, item_type, responsible_party, due_at, title,
      description, close_condition, source_type, external_evidence_ref, confidence
    ) VALUES (
      ${id}, ${projectId}, ${body.workflowNodeId ?? null}, ${body.itemType},
      ${body.responsibleParty}, ${body.dueAt ?? null}, ${body.title},
      ${body.description ?? null}, ${body.closeCondition ?? null},
      ${body.sourceType ?? null}, ${body.externalEvidenceRef ?? null}, ${body.confidence ?? null}
    )
  `;
  await syncProjectDerivedStateTx(tx, projectId);
  return id;
}

export async function patchOpenItemTx(
  tx: DbExecutor,
  projectId: string,
  itemId: string,
  body: PatchOpenItemBody,
): Promise<void> {
  const existingRows = await tx<
    {
      title: string;
      description: string | null;
      status: string;
      responsible_party: string;
      due_at: Date | null;
      close_condition: string | null;
      human_confirmed: boolean;
      confirmed_by: string | null;
      confirmed_at: Date | null;
    }[]
  >`SELECT title, description, status, responsible_party, due_at, close_condition,
      human_confirmed, confirmed_by, confirmed_at
    FROM open_items WHERE id = ${itemId} AND project_id = ${projectId} FOR UPDATE`;
  const existing = existingRows[0];
  if (!existing) {
    const err = new Error('open item not found');
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  const nextTitle = body.title ?? existing.title;
  const nextDescription = body.description !== undefined ? body.description : existing.description;
  const nextStatus = body.status ?? existing.status;
  const nextParty = body.responsibleParty ?? existing.responsible_party;
  const nextDue = body.dueAt !== undefined ? body.dueAt : (existing.due_at?.toISOString() ?? null);
  const nextClose =
    body.closeCondition !== undefined ? body.closeCondition : existing.close_condition;

  let nextConfirmed = existing.human_confirmed;
  let nextConfirmedBy = existing.confirmed_by;
  let nextConfirmedAt = existing.confirmed_at;
  if (body.humanConfirmed === true) {
    nextConfirmed = true;
    nextConfirmedBy = body.confirmedById ?? existing.confirmed_by;
    nextConfirmedAt = new Date();
  } else if (body.humanConfirmed === false) {
    nextConfirmed = false;
    nextConfirmedBy = null;
    nextConfirmedAt = null;
  } else if (body.confirmedById !== undefined) {
    nextConfirmedBy = body.confirmedById;
  }

  await tx`
    UPDATE open_items SET
      title = ${nextTitle},
      description = ${nextDescription},
      status = ${nextStatus},
      responsible_party = ${nextParty},
      due_at = ${nextDue},
      close_condition = ${nextClose},
      human_confirmed = ${nextConfirmed},
      confirmed_by = ${nextConfirmedBy},
      confirmed_at = ${nextConfirmedAt},
      updated_at = now()
    WHERE id = ${itemId} AND project_id = ${projectId}
  `;
  await syncProjectDerivedStateTx(tx, projectId);
}

export async function applyHermesPayloadTx(
  tx: DbExecutor,
  projectId: string,
  payload: HermesPayload,
  nodeSnapshotById: Map<
    string,
    {
      ownerId: string | null;
      dueAt: string | null;
      blockedReason: string | null;
      statusChangedAt: string;
      completedAt: string | null;
    }
  >,
): Promise<void> {
  if (payload.action === 'patch_project') {
    const { action: _action, ...patch } = payload;
    void _action;
    await applyProjectPatchTx(tx, projectId, patch);
    return;
  }
  if (payload.action === 'patch_node') {
    const { action: _action, nodeId, ...patch } = payload;
    void _action;
    const snap = nodeSnapshotById.get(nodeId);
    if (!snap) {
      const err = new Error('node not found');
      (err as Error & { status: number }).status = 404;
      throw err;
    }
    await patchWorkflowNodeTx(tx, projectId, nodeId, patch, snap);
    return;
  }
  const { action: _action, ...createBody } = payload;
  void _action;
  await createOpenItemTx(tx, projectId, createBody);
}

export async function instantiateStandardWorkflowTx(
  tx: DbExecutor,
  projectId: string,
): Promise<void> {
  const workflowId = crypto.randomUUID();
  await tx`
    INSERT INTO project_workflows (id, project_id, template_id)
    VALUES (${workflowId}, ${projectId}, ${TEMPLATE_ID})
  `;
  const templateNodes = await tx<
    {
      id: string;
      slug: string;
      label: string;
      parent_id: string | null;
      sort_order: number;
      is_required: boolean;
      dependency_mode: string;
      completion_criteria: string | null;
      stage_key: string | null;
    }[]
  >`
    SELECT id, slug, label, parent_id, sort_order, is_required, dependency_mode, completion_criteria, stage_key
    FROM workflow_template_nodes WHERE template_id = ${TEMPLATE_ID} ORDER BY sort_order
  `;
  const idMap = new Map<string, string>();
  for (const tn of templateNodes) {
    const nodeId = crypto.randomUUID();
    idMap.set(tn.id, nodeId);
    const status = tn.sort_order === 10 ? 'ready' : 'locked';
    await tx`
      INSERT INTO workflow_nodes (
        id, project_workflow_id, template_node_id, slug, label, parent_id, sort_order, is_required,
        dependency_mode, completion_criteria, stage_key, status
      ) VALUES (
        ${nodeId}, ${workflowId}, ${tn.id}, ${tn.slug}, ${tn.label}, NULL, ${tn.sort_order},
        ${tn.is_required}, ${tn.dependency_mode}, ${tn.completion_criteria}, ${tn.stage_key}, ${status}
      )
    `;
  }
  for (const tn of templateNodes) {
    if (!tn.parent_id) continue;
    const nodeId = idMap.get(tn.id);
    const parentId = idMap.get(tn.parent_id);
    if (!nodeId || !parentId) continue;
    await tx`
      UPDATE workflow_nodes SET parent_id = ${parentId} WHERE id = ${nodeId}
    `;
  }
  const templateDeps = await tx<{ node_id: string; depends_on_node_id: string }[]>`
    SELECT node_id, depends_on_node_id FROM workflow_template_node_dependencies
    WHERE node_id IN (SELECT id FROM workflow_template_nodes WHERE template_id = ${TEMPLATE_ID})
  `;
  for (const d of templateDeps) {
    const nodeId = idMap.get(d.node_id);
    const predId = idMap.get(d.depends_on_node_id);
    if (!nodeId || !predId) continue;
    await tx`
      INSERT INTO workflow_node_dependencies (node_id, depends_on_node_id)
      VALUES (${nodeId}, ${predId})
    `;
  }
  await syncProjectDerivedStateTx(tx, projectId);
}
