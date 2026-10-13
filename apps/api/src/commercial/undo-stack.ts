import type { WorkflowGraph } from '@studio/contracts';
import type { Db } from './graph-io';
import { getWorkflowTx } from './engine-shared';

const MAX_UNDO = 40;

export async function pushUndoSnapshot(tx: Db, projectId: string) {
  const snap = await getWorkflowTx(tx, projectId);
  if (!snap) return;
  const rows = await tx<{ undo_json: WorkflowGraph[] }[]>`
    SELECT undo_json FROM workflow_undo_stacks WHERE project_id = ${projectId} FOR UPDATE
  `;
  const prev = rows[0]?.undo_json ?? [];
  const next = [...prev, snap].slice(-MAX_UNDO);
  await tx`
    INSERT INTO workflow_undo_stacks (project_id, undo_json, redo_json)
    VALUES (${projectId}, ${JSON.stringify(next)}::jsonb, '[]'::jsonb)
    ON CONFLICT (project_id) DO UPDATE SET undo_json = ${JSON.stringify(next)}::jsonb, redo_json = '[]'::jsonb, updated_at = now()
  `;
}

export async function restoreWorkflowSnapshot(tx: Db, projectId: string, snap: WorkflowGraph) {
  const wf = await tx<{ id: string }[]>`
    SELECT id FROM project_workflows WHERE project_id = ${projectId} FOR UPDATE
  `;
  const workflowId = wf[0]?.id;
  if (!workflowId) throw Object.assign(new Error('workflow not found'), { status: 404 });
  await tx`DELETE FROM wf_edges WHERE workflow_id = ${workflowId}`;
  await tx`DELETE FROM wf_nodes WHERE workflow_id = ${workflowId}`;
  for (const n of snap.nodes) {
    await tx`
      INSERT INTO wf_nodes (id, workflow_id, project_id, name, status, is_optional, pos_x, pos_y, phase, planned_at, completed_at, package_id, source)
      VALUES (${n.id}, ${workflowId}, ${projectId}, ${n.name}, ${n.status}, ${n.isOptional}, ${n.posX}, ${n.posY}, ${n.phase},
        ${n.plannedAt}, ${n.completedAt}, ${n.packageId}, 'web')
    `;
  }
  for (const e of snap.edges) {
    await tx`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      VALUES (${e.id}, ${workflowId}, ${e.fromNodeId}, ${e.toNodeId})
    `;
  }
}

export async function undoProjectGraph(tx: Db, projectId: string) {
  const rows = await tx<{ undo_json: WorkflowGraph[]; redo_json: WorkflowGraph[] }[]>`
    SELECT undo_json, redo_json FROM workflow_undo_stacks WHERE project_id = ${projectId} FOR UPDATE
  `;
  const undo = rows[0]?.undo_json ?? [];
  if (!undo.length) throw Object.assign(new Error('nothing to undo'), { status: 409 });
  const snap = undo[undo.length - 1]!;
  const current = await getWorkflowTx(tx, projectId);
  await restoreWorkflowSnapshot(tx, projectId, snap);
  const redo = rows[0]?.redo_json ?? [];
  await tx`
    INSERT INTO workflow_undo_stacks (project_id, undo_json, redo_json)
    VALUES (${projectId}, ${JSON.stringify(undo.slice(0, -1))}::jsonb, ${JSON.stringify(current ? [...redo, current] : redo)}::jsonb)
    ON CONFLICT (project_id) DO UPDATE SET
      undo_json = ${JSON.stringify(undo.slice(0, -1))}::jsonb,
      redo_json = ${JSON.stringify(current ? [...redo, current] : redo)}::jsonb,
      updated_at = now()
  `;
  const { syncBlockedAndStage } = await import('./sync-state');
  await syncBlockedAndStage(tx, projectId);
  return getWorkflowTx(tx, projectId);
}

export async function redoProjectGraph(tx: Db, projectId: string) {
  const rows = await tx<{ undo_json: WorkflowGraph[]; redo_json: WorkflowGraph[] }[]>`
    SELECT undo_json, redo_json FROM workflow_undo_stacks WHERE project_id = ${projectId} FOR UPDATE
  `;
  const redo = rows[0]?.redo_json ?? [];
  if (!redo.length) throw Object.assign(new Error('nothing to redo'), { status: 409 });
  const snap = redo[redo.length - 1]!;
  const current = await getWorkflowTx(tx, projectId);
  await restoreWorkflowSnapshot(tx, projectId, snap);
  const undo = rows[0]?.undo_json ?? [];
  await tx`
    UPDATE workflow_undo_stacks SET
      undo_json = ${JSON.stringify(current ? [...undo, current] : undo)}::jsonb,
      redo_json = ${JSON.stringify(redo.slice(0, -1))}::jsonb,
      updated_at = now()
    WHERE project_id = ${projectId}
  `;
  const { syncBlockedAndStage } = await import('./sync-state');
  await syncBlockedAndStage(tx, projectId);
  return getWorkflowTx(tx, projectId);
}
