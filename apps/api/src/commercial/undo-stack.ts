import type { WorkflowGraph } from '@studio/contracts';
import type { Db } from './graph-io';
import { getWorkflowTx } from './engine-shared';

const MAX_UNDO = 40;

export type WorkflowUndoSnapshot = {
  graph: WorkflowGraph;
  packages: Array<{ id: string; name: string; sortOrder: number }>;
  openItemRefs: Array<{
    itemId: string;
    workflowNodeId: string | null;
    blocksNodeId: string | null;
  }>;
  primaryBlockPins: Array<{ nodeId: string; itemId: string | null }>;
};

function normalizeSnapshot(raw: unknown): WorkflowUndoSnapshot {
  if (raw && typeof raw === 'object' && raw !== null && 'graph' in raw) {
    return raw as WorkflowUndoSnapshot;
  }
  return {
    graph: raw as WorkflowGraph,
    packages: [],
    openItemRefs: [],
    primaryBlockPins: [],
  };
}

function parseUndoJson(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  return raw;
}

function asSnapshotArray(raw: unknown): WorkflowUndoSnapshot[] {
  const parsed = parseUndoJson(raw);
  if (parsed == null) return [];
  if (Array.isArray(parsed)) return parsed.map(normalizeSnapshot);
  return [normalizeSnapshot(parsed)];
}

async function captureSnapshot(tx: Db, projectId: string): Promise<WorkflowUndoSnapshot | null> {
  const graph = await getWorkflowTx(tx, projectId);
  if (!graph) return null;
  const wf = await tx<{ id: string }[]>`
    SELECT id FROM project_workflows WHERE project_id = ${projectId}
  `;
  const workflowId = wf[0]?.id;
  if (!workflowId) return null;
  const packages = await tx<{ id: string; name: string; sort_order: number }[]>`
    SELECT id, name, sort_order FROM wf_packages WHERE workflow_id = ${workflowId}
  `;
  const openItemRefs = await tx<
    { id: string; workflow_node_id: string | null; blocks_node_id: string | null }[]
  >`
    SELECT id, workflow_node_id, blocks_node_id FROM open_items WHERE project_id = ${projectId}
  `;
  const primaryBlockPins = await tx<{ id: string; primary_block_pinned_item_id: string | null }[]>`
    SELECT id, primary_block_pinned_item_id FROM wf_nodes WHERE workflow_id = ${workflowId}
  `;
  return {
    graph,
    packages: packages.map((p) => ({ id: p.id, name: p.name, sortOrder: p.sort_order })),
    openItemRefs: openItemRefs.map((o) => ({
      itemId: o.id,
      workflowNodeId: o.workflow_node_id,
      blocksNodeId: o.blocks_node_id,
    })),
    primaryBlockPins: primaryBlockPins.map((n) => ({
      nodeId: n.id,
      itemId: n.primary_block_pinned_item_id,
    })),
  };
}

export async function pushUndoSnapshot(tx: Db, projectId: string) {
  const snap = await captureSnapshot(tx, projectId);
  if (!snap) return;
  const rows = await tx<{ undo_json: unknown }[]>`
    SELECT undo_json FROM workflow_undo_stacks WHERE project_id = ${projectId} FOR UPDATE
  `;
  const prevSnaps = asSnapshotArray(rows[0]?.undo_json);
  const next = [...prevSnaps, snap].slice(-MAX_UNDO);
  await tx`
    INSERT INTO workflow_undo_stacks (project_id, undo_json, redo_json)
    VALUES (${projectId}, ${next as never}, '[]'::jsonb)
    ON CONFLICT (project_id) DO UPDATE SET undo_json = ${next as never}, redo_json = '[]'::jsonb, updated_at = now()
  `;
}

export async function restoreWorkflowSnapshot(
  tx: Db,
  projectId: string,
  snap: WorkflowUndoSnapshot,
) {
  const wf = await tx<{ id: string }[]>`
    SELECT id FROM project_workflows WHERE project_id = ${projectId} FOR UPDATE
  `;
  const workflowId = wf[0]?.id;
  if (!workflowId) throw Object.assign(new Error('workflow not found'), { status: 404 });
  const { clearAllOpenItemRefsForWorkflow } = await import('./engine-shared');
  await clearAllOpenItemRefsForWorkflow(tx, projectId, workflowId);
  await tx`DELETE FROM wf_edges WHERE workflow_id = ${workflowId}`;
  await tx`DELETE FROM wf_nodes WHERE workflow_id = ${workflowId}`;
  await tx`DELETE FROM wf_packages WHERE workflow_id = ${workflowId}`;
  for (const p of snap.packages) {
    await tx`
      INSERT INTO wf_packages (id, workflow_id, name, sort_order)
      VALUES (${p.id}, ${workflowId}, ${p.name}, ${p.sortOrder})
    `;
  }
  for (const n of snap.graph.nodes) {
    const source = n.source ?? 'template';
    const templateNodeId = n.templateNodeId ?? null;
    await tx`
      INSERT INTO wf_nodes (
        id, workflow_id, project_id, template_node_id, name, status, is_optional, pos_x, pos_y, phase,
        planned_at, completed_at, package_id, source, status_before_block
      )
      VALUES (
        ${n.id}, ${workflowId}, ${projectId}, ${templateNodeId}, ${n.name}, ${n.status}, ${n.isOptional},
        ${n.posX}, ${n.posY}, ${n.phase}, ${n.plannedAt}, ${n.completedAt}, ${n.packageId}, ${source},
        ${(n as { statusBeforeBlock?: string | null }).statusBeforeBlock ?? null}
      )
    `;
  }
  for (const e of snap.graph.edges) {
    await tx`
      INSERT INTO wf_edges (id, workflow_id, from_node_id, to_node_id)
      VALUES (${e.id}, ${workflowId}, ${e.fromNodeId}, ${e.toNodeId})
    `;
  }
  for (const ref of snap.openItemRefs) {
    await tx`
      UPDATE open_items SET workflow_node_id = ${ref.workflowNodeId}, blocks_node_id = ${ref.blocksNodeId}, updated_at = now()
      WHERE id = ${ref.itemId} AND project_id = ${projectId}
    `;
  }
  for (const pin of snap.primaryBlockPins) {
    if (!pin.itemId) continue;
    await tx`
      UPDATE wf_nodes SET primary_block_pinned_item_id = ${pin.itemId}
      WHERE id = ${pin.nodeId} AND project_id = ${projectId}
    `;
  }
}

export async function undoProjectGraph(tx: Db, projectId: string) {
  const rows = await tx<{ undo_json: unknown; redo_json: unknown }[]>`
    SELECT undo_json, redo_json FROM workflow_undo_stacks WHERE project_id = ${projectId} FOR UPDATE
  `;
  const undo = asSnapshotArray(rows[0]?.undo_json);
  if (!undo.length) throw Object.assign(new Error('nothing to undo'), { status: 409 });
  const snap = undo[undo.length - 1]!;
  const current = await captureSnapshot(tx, projectId);
  await restoreWorkflowSnapshot(tx, projectId, snap);
  const redo = asSnapshotArray(rows[0]?.redo_json);
  const nextRedo = current ? [...redo, current] : redo;
  await tx`
    INSERT INTO workflow_undo_stacks (project_id, undo_json, redo_json)
    VALUES (${projectId}, ${undo.slice(0, -1) as never}, ${nextRedo as never})
    ON CONFLICT (project_id) DO UPDATE SET
      undo_json = ${undo.slice(0, -1) as never},
      redo_json = ${nextRedo as never},
      updated_at = now()
  `;
  const { syncBlockedAndStage } = await import('./sync-state');
  await syncBlockedAndStage(tx, projectId);
  return getWorkflowTx(tx, projectId);
}

export async function redoProjectGraph(tx: Db, projectId: string) {
  const rows = await tx<{ undo_json: unknown; redo_json: unknown }[]>`
    SELECT undo_json, redo_json FROM workflow_undo_stacks WHERE project_id = ${projectId} FOR UPDATE
  `;
  const redo = asSnapshotArray(rows[0]?.redo_json);
  if (!redo.length) throw Object.assign(new Error('nothing to redo'), { status: 409 });
  const snap = redo[redo.length - 1]!;
  const current = await captureSnapshot(tx, projectId);
  await restoreWorkflowSnapshot(tx, projectId, snap);
  const undo = asSnapshotArray(rows[0]?.undo_json);
  const nextUndo = current ? [...undo, current] : undo;
  await tx`
    UPDATE workflow_undo_stacks SET
      undo_json = ${nextUndo as never},
      redo_json = ${redo.slice(0, -1) as never},
      updated_at = now()
    WHERE project_id = ${projectId}
  `;
  const { syncBlockedAndStage } = await import('./sync-state');
  await syncBlockedAndStage(tx, projectId);
  return getWorkflowTx(tx, projectId);
}
