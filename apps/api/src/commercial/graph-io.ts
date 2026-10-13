import { detectCycle, type GraphEdge } from '@studio/workflow';
import type postgres from 'postgres';
import type { Sql } from '@studio/db';

export type Db = Sql | postgres.TransactionSql;

export type GraphNodeRow = {
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
  primary_block_pinned_item_id: string | null;
};

export async function loadWorkflowGraph(tx: Db, projectId: string, lock = false) {
  const wf = lock
    ? await tx<{ id: string }[]>`
        SELECT id FROM project_workflows WHERE project_id = ${projectId} FOR UPDATE
      `
    : await tx<{ id: string }[]>`
        SELECT id FROM project_workflows WHERE project_id = ${projectId}
      `;
  const workflowId = wf[0]?.id;
  if (!workflowId) return null;
  const nodes = lock
    ? await tx<GraphNodeRow[]>`
        SELECT n.id, n.name, n.status, n.phase, n.is_optional, n.planned_at, n.completed_at, n.pos_x, n.pos_y,
          n.package_id, n.primary_block_pinned_item_id, t.slug
        FROM wf_nodes n
        LEFT JOIN wf_template_nodes t ON t.id = n.template_node_id
        WHERE n.workflow_id = ${workflowId}
        FOR UPDATE OF n
      `
    : await tx<GraphNodeRow[]>`
        SELECT n.id, n.name, n.status, n.phase, n.is_optional, n.planned_at, n.completed_at, n.pos_x, n.pos_y,
          n.package_id, n.primary_block_pinned_item_id, t.slug
        FROM wf_nodes n
        LEFT JOIN wf_template_nodes t ON t.id = n.template_node_id
        WHERE n.workflow_id = ${workflowId}
      `;
  const edges = lock
    ? await tx<{ id: string; from_node_id: string; to_node_id: string }[]>`
        SELECT id, from_node_id, to_node_id FROM wf_edges WHERE workflow_id = ${workflowId} FOR UPDATE
      `
    : await tx<{ id: string; from_node_id: string; to_node_id: string }[]>`
        SELECT id, from_node_id, to_node_id FROM wf_edges WHERE workflow_id = ${workflowId}
      `;
  const graphEdges: GraphEdge[] = edges.map((e) => ({
    fromId: e.from_node_id,
    toId: e.to_node_id,
  }));
  const cycle = detectCycle(
    nodes.map((n) => ({ id: n.id, status: n.status })),
    graphEdges,
  );
  if (cycle) throw Object.assign(new Error(cycle), { status: 409 });
  return { workflowId, nodes, edges, graphEdges };
}

export async function assertEdgeAllowed(
  tx: Db,
  workflowId: string,
  fromNodeId: string,
  toNodeId: string,
  excludeEdgeId?: string,
) {
  if (fromNodeId === toNodeId) {
    throw Object.assign(new Error('self loop'), { status: 409 });
  }
  const nodes = await tx<{ id: string }[]>`
    SELECT id FROM wf_nodes WHERE workflow_id = ${workflowId} AND id IN (${fromNodeId}, ${toNodeId})
  `;
  if (nodes.length !== 2) {
    throw Object.assign(new Error('edge nodes must belong to workflow'), { status: 409 });
  }
  const edges = await tx<{ id: string; from_node_id: string; to_node_id: string }[]>`
    SELECT id, from_node_id, to_node_id FROM wf_edges WHERE workflow_id = ${workflowId}
  `;
  const next = edges
    .filter((e) => e.id !== excludeEdgeId)
    .map((e) => ({ fromId: e.from_node_id, toId: e.to_node_id }));
  next.push({ fromId: fromNodeId, toId: toNodeId });
  const cycle = detectCycle(
    nodes.map((n) => ({ id: n.id, status: 'not_reached' })),
    next,
  );
  if (cycle) throw Object.assign(new Error(cycle), { status: 409 });
}
