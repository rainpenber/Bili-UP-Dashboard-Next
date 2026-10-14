import type { OpenItemDto, PublishResultDto, WorkflowGraph } from '@studio/contracts';
import type { Db } from './graph-io';
import { loadWorkflowGraph } from './graph-io';

export function mapNode(n: {
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
  template_node_id?: string | null;
  source?: string;
  status_before_block?: string | null;
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
    templateNodeId: n.template_node_id ?? null,
    source: (n.source ?? 'template') as NonNullable<WorkflowGraph['nodes'][number]['source']>,
    statusBeforeBlock: n.status_before_block ?? null,
  };
}

export async function clearOpenItemRefsBeforeNodeDelete(tx: Db, projectId: string, nodeId: string) {
  await tx`
    UPDATE wf_nodes SET primary_block_pinned_item_id = NULL
    WHERE project_id = ${projectId} AND primary_block_pinned_item_id IN (
      SELECT id FROM open_items WHERE project_id = ${projectId}
        AND (workflow_node_id = ${nodeId} OR blocks_node_id = ${nodeId})
    )
  `;
  await tx`
    UPDATE open_items SET workflow_node_id = NULL, blocks_node_id = NULL, updated_at = now()
    WHERE project_id = ${projectId} AND (workflow_node_id = ${nodeId} OR blocks_node_id = ${nodeId})
  `;
}

export async function clearAllOpenItemRefsForWorkflow(
  tx: Db,
  projectId: string,
  workflowId: string,
) {
  await tx`
    UPDATE wf_nodes SET primary_block_pinned_item_id = NULL WHERE workflow_id = ${workflowId}
  `;
  await tx`
    UPDATE open_items SET workflow_node_id = NULL, blocks_node_id = NULL, updated_at = now()
    WHERE project_id = ${projectId} AND (workflow_node_id IS NOT NULL OR blocks_node_id IS NOT NULL)
  `;
}

export async function assertNodesInProject(
  tx: Db,
  projectId: string,
  nodeIds: (string | null | undefined)[],
) {
  for (const nodeId of nodeIds) {
    if (!nodeId) continue;
    const rows = await tx<{ id: string }[]>`
      SELECT id FROM wf_nodes WHERE id = ${nodeId} AND project_id = ${projectId}
    `;
    if (!rows.length) {
      throw Object.assign(new Error('workflow node not in project'), { status: 409 });
    }
  }
}

export async function getWorkflowTx(tx: Db, projectId: string): Promise<WorkflowGraph | null> {
  const graph = await loadWorkflowGraph(tx, projectId, false);
  if (!graph) return null;
  const packages = await tx<{ id: string; name: string }[]>`
    SELECT id, name FROM wf_packages WHERE workflow_id = ${graph.workflowId} ORDER BY sort_order
  `;
  const { getWorkflowUndoRedoState } = await import('./undo-stack');
  const undoState = await getWorkflowUndoRedoState(tx, projectId);
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

export async function applyUpdates(
  tx: Db,
  workflowId: string,
  updates: Map<string, { status: string; completedAt?: string | null }>,
  opts?: { projectId?: string; source?: string; detail?: Record<string, unknown> },
) {
  let projectId = opts?.projectId;
  if (!projectId) {
    const pw = await tx<{ project_id: string }[]>`
      SELECT project_id FROM project_workflows WHERE id = ${workflowId}
    `;
    projectId = pw[0]?.project_id;
  }
  const source = opts?.source ?? 'web';
  const { recordNodeStatusHistory } = await import('./node-status-history');
  for (const [id, u] of updates) {
    const before = await tx<{ status: string }[]>`
      SELECT status FROM wf_nodes WHERE id = ${id} AND workflow_id = ${workflowId}
    `;
    const fromStatus = before[0]?.status ?? null;
    const rows = await tx`
      UPDATE wf_nodes SET status = ${u.status},
        completed_at = ${u.completedAt ?? null},
        updated_at = now()
      WHERE id = ${id} AND workflow_id = ${workflowId}
      RETURNING id
    `;
    if (!rows.length)
      throw Object.assign(new Error('node update out of workflow scope'), { status: 409 });
    if (projectId) {
      await recordNodeStatusHistory(tx, {
        projectId,
        nodeId: id,
        fromStatus,
        toStatus: u.status,
        source,
        detail: opts?.detail ?? null,
      });
    }
  }
}

export async function audit(
  tx: Db,
  projectId: string,
  action: string,
  entityId: string,
  detail: unknown,
  source = 'web',
) {
  await tx`
    INSERT INTO workflow_audit_log (project_id, entity_type, entity_id, action, detail, source)
    VALUES (${projectId}, 'node', ${entityId}, ${action}, ${JSON.stringify(detail)}::jsonb, ${source})
  `;
}

export async function auditItem(
  tx: Db,
  projectId: string,
  action: string,
  itemId: string,
  detail: unknown,
  source = 'web',
) {
  await tx`
    INSERT INTO workflow_audit_log (project_id, entity_type, entity_id, action, detail, source)
    VALUES (${projectId}, 'open_item', ${itemId}, ${action}, ${JSON.stringify(detail)}::jsonb, ${source})
  `;
}

export function assertNodeInGraph(
  graph: NonNullable<Awaited<ReturnType<typeof loadWorkflowGraph>>>,
  nodeId: string,
) {
  const node = graph.nodes.find((n) => n.id === nodeId);
  if (!node) throw Object.assign(new Error('node not found in project workflow'), { status: 404 });
  return node;
}

export function mapOpenItem(r: {
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
  cancel_reason?: string | null;
  created_at: Date;
  updated_at: Date;
  closed_at: Date | null;
  sort_rank: number;
  blocks_required_for_close: boolean;
}): OpenItemDto {
  let sourceEvidence: Record<string, unknown> | null = null;
  const rawEvidence = r.source_evidence as unknown;
  if (rawEvidence != null) {
    if (typeof rawEvidence === 'string') {
      try {
        sourceEvidence = JSON.parse(rawEvidence) as Record<string, unknown>;
      } catch {
        sourceEvidence = { raw: rawEvidence };
      }
    } else if (typeof rawEvidence === 'object' && !Array.isArray(rawEvidence)) {
      sourceEvidence = rawEvidence as Record<string, unknown>;
    }
  }
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
    sourceEvidence,
    confidence: r.confidence,
    closeConclusion: r.close_conclusion,
    cancelReason: r.cancel_reason ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    closedAt: r.closed_at?.toISOString() ?? null,
    sortRank: r.sort_rank,
    blocksRequiredForClose: r.blocks_required_for_close,
  };
}

export function hashPublishPayload(body: {
  bvid: string;
  publishedAt: string;
  idempotencyKey: string;
}) {
  return `${body.bvid}|${body.publishedAt}|${body.idempotencyKey}`;
}

export async function runMockMetadataTask(tx: Db, projectId: string, bvid: string) {
  const meta = await tx<{ title: string | null }[]>`
    SELECT title FROM videos WHERE bvid = ${bvid} LIMIT 1
  `;
  const title = meta[0]?.title ?? `Mock ${bvid}`;
  await tx`
    UPDATE project_monitor_contracts
    SET metadata_task_status = 'mock_ready',
        metadata_title = ${title},
        metadata_cover_url = ${`/api/v1/assets/placeholder/${bvid}`},
        metadata_cid = ${`mock-cid-${bvid}`},
        metadata_fetched_at = now(),
        linked_bvid = ${bvid}
    WHERE project_id = ${projectId}
  `;
  await tx`
    UPDATE monitor_jobs SET status = 'done', result_json = ${JSON.stringify({ title, bvid })}::jsonb, last_error = NULL
    WHERE project_id = ${projectId} AND job_type = 'metadata'
  `;
}

export async function getMonitorDto(tx: Db, projectId: string) {
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

export async function executePublishEffects(
  tx: Db,
  projectId: string,
  body: { bvid: string; publishedAt: string; idempotencyKey: string },
  publishSource: 'web' | 'hermes' | 'manual',
): Promise<PublishResultDto> {
  const graph = await loadWorkflowGraph(tx, projectId, true);
  if (!graph) throw Object.assign(new Error('workflow not found'), { status: 404 });
  const forced: { nodeId: string; name: string }[] = [];
  const { recordNodeStatusHistory } = await import('./node-status-history');
  for (const n of graph.nodes) {
    if (n.phase !== 'pre_publish') continue;
    if (n.status === 'completed' || n.status === 'not_applicable') continue;
    await recordNodeStatusHistory(tx, {
      projectId,
      nodeId: n.id,
      fromStatus: n.status,
      toStatus: 'completed',
      source: 'publish_force_complete',
      detail: { bvid: body.bvid },
    });
    await tx`
      UPDATE wf_nodes SET status = 'completed', completed_at = ${body.publishedAt}, updated_at = now()
      WHERE id = ${n.id}
    `;
    forced.push({ nodeId: n.id, name: n.name });
  }
  await tx`
    INSERT INTO project_publish_records (project_id, bvid, published_at, publish_source, forced_complete_audit, idempotency_key)
    VALUES (${projectId}, ${body.bvid}, ${body.publishedAt}, ${publishSource}, ${JSON.stringify(forced)}::jsonb, ${body.idempotencyKey})
  `;
  await tx`
    INSERT INTO videos (bvid, title, metadata)
    VALUES (${body.bvid}, ${`商单视频 ${body.bvid}`}, ${JSON.stringify({ source: 'commercial_publish', cover: `/api/v1/assets/placeholder/${body.bvid}`, cid: `mock-cid-${body.bvid}` })}::jsonb)
    ON CONFLICT (bvid) DO NOTHING
  `;
  const metricsDue = new Date(new Date(body.publishedAt).getTime() + 60_000);
  await tx`
    INSERT INTO project_monitor_contracts (id, project_id, bvid, monitor_video_key, linked_bvid, metadata_task_status, metrics_fetch_due_at)
    VALUES (${crypto.randomUUID()}, ${projectId}, ${body.bvid}, ${body.bvid}, ${body.bvid}, 'pending', ${metricsDue.toISOString()})
    ON CONFLICT (project_id) DO NOTHING
  `;
  await tx`
    INSERT INTO monitor_jobs (id, project_id, job_type, status, due_at)
    VALUES (${crypto.randomUUID()}, ${projectId}, 'metadata', 'pending', now())
    ON CONFLICT (project_id, job_type) DO NOTHING
  `;
  await tx`
    INSERT INTO monitor_jobs (id, project_id, job_type, status, due_at)
    VALUES (${crypto.randomUUID()}, ${projectId}, 'metrics', 'pending', ${metricsDue.toISOString()})
    ON CONFLICT (project_id, job_type) DO NOTHING
  `;
  await runMockMetadataTask(tx, projectId, body.bvid);
  const { syncBlockedAndStage } = await import('./sync-state');
  await syncBlockedAndStage(tx, projectId);
  return {
    projectId,
    bvid: body.bvid,
    publishedAt: body.publishedAt,
    forcedCompleteAudit: forced,
    monitor: await getMonitorDto(tx, projectId),
  };
}
