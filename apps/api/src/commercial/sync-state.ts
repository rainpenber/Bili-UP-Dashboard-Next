import { deriveProjectCloseState, type NodePhase } from '@studio/workflow';
import type { Db } from './graph-io';
import { loadWorkflowGraph } from './graph-io';

export async function syncBlockedAndStage(tx: Db, projectId: string) {
  const graph = await loadWorkflowGraph(tx, projectId, true);
  if (!graph) return;

  const blocking = await tx<
    { blocks_node_id: string; id: string; title: string; sort_rank: number }[]
  >`
    SELECT id, blocks_node_id, title, sort_rank FROM open_items
    WHERE project_id = ${projectId} AND lifecycle = 'open' AND impact = 'blocking' AND blocks_node_id IS NOT NULL
  `;
  const byNode = new Map<
    string,
    { blocks_node_id: string; id: string; title: string; sort_rank: number }[]
  >();
  for (const row of blocking) {
    const list = byNode.get(row.blocks_node_id) ?? [];
    list.push(row);
    byNode.set(row.blocks_node_id, list);
  }

  for (const node of graph.nodes) {
    const items = byNode.get(node.id) ?? [];
    const pinned = node.primary_block_pinned_item_id;
    const hasBlock = items.length > 0;
    let nextStatus = node.status;
    if (hasBlock && node.status !== 'completed' && node.status !== 'not_applicable') {
      nextStatus = 'blocked';
    } else if (!hasBlock && node.status === 'blocked') {
      nextStatus = 'in_progress';
    }
    if (nextStatus !== node.status) {
      await tx`
        UPDATE wf_nodes SET status = ${nextStatus}, updated_at = now() WHERE id = ${node.id}
      `;
      node.status = nextStatus;
    }
    void pinned;
  }

  const published = await tx<{ ok: boolean }[]>`
    SELECT EXISTS (SELECT 1 FROM project_publish_records WHERE project_id = ${projectId}) AS ok
  `;
  const blockingClose = await tx<{ ok: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM open_items
      WHERE project_id = ${projectId} AND lifecycle = 'open' AND blocks_required_for_close = TRUE
    ) AS ok
  `;
  const close = deriveProjectCloseState({
    published: Boolean(published[0]?.ok),
    nodes: graph.nodes.map((n) => ({
      status: n.status,
      phase: n.phase as NodePhase,
      isOptional: n.is_optional,
    })),
    openItemsBlockingClose: Boolean(blockingClose[0]?.ok),
  });
  await tx`
    UPDATE commercial_projects
    SET overall_stage = ${close.overallStage},
        business_closed_at = ${close.businessClosed ? new Date().toISOString() : null},
        updated_at = now()
    WHERE id = ${projectId}
  `;
}

export async function pickPrimaryBlockReason(
  sql: Db,
  projectId: string,
  nodeId?: string,
): Promise<string | null> {
  const rows = await sql<
    { title: string; next_action: string | null; sort_rank: number; id: string }[]
  >`
    SELECT o.title, o.next_action, o.sort_rank, o.id
    FROM open_items o
    LEFT JOIN wf_nodes n ON n.id = o.blocks_node_id
    WHERE o.project_id = ${projectId} AND o.lifecycle = 'open' AND o.impact = 'blocking'
    ${nodeId ? sql`AND o.blocks_node_id = ${nodeId}` : sql``}
    ORDER BY
      CASE WHEN n.primary_block_pinned_item_id = o.id THEN 0 ELSE 1 END,
      o.sort_rank DESC,
      o.updated_at DESC
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return r.next_action ?? r.title;
}
