import {
  isOpenItemActor,
  isOverallStage,
  isPublishContentKind,
  isPublishPlatform,
  isWfNodeKind,
  isWfNodeStatus,
  parseCommercialCancelItemRequest,
  parseCommercialBlockRequest,
  parseCommercialCloseItemRequest,
  parseCommercialNodeStepRequest,
  parseCommercialNodeTokenRequest,
  parseCommercialNodeWriteResponse,
  parseCommercialOpenItemCreateRequest,
  parseCommercialOpenItemUpdateRequest,
  parseCommercialOpenItemWriteResponse,
  parseCommercialPlanRequest,
  parseCommercialPublishRequest,
  parseCommercialPublishResponse,
  parseCommercialStageStepRequest,
  parseCommercialStepResponse,
  parseCommercialWorkflowLayoutRequest,
  parseCommercialWorkflowLayoutResponse,
  parseCommercialWriteError,
  type OverallStage,
  type CommercialNodeSnapshot,
  type CommercialNodeWriteResponse,
  type CommercialOpenItemSnapshot,
  type CommercialOpenItemWriteResponse,
  type CommercialPinnedBlockItem,
  type CommercialPublishResponse,
  type CommercialStepBlock,
  type CommercialStepEffect,
  type CommercialStepPublish,
  type CommercialStepResponse,
  type CommercialStepSuccessor,
  type CommercialWorkflowLayoutRequest,
  type CommercialWorkflowLayoutResponse,
  type CommercialWorkflowNode,
  type CommercialWriteErrorBody,
  type CommercialWriteErrorCode,
  type CommercialOpenItemCreateRequest,
  type CommercialOpenItemUpdateRequest,
  type MonitorJobType,
  type OpenItemActor,
  type OpenItemImpact,
  type OpenItemLifecycle,
  type PublishContentKind,
  type PublishSource,
  type WfNodeKind,
  type WfNodeStatus,
} from '@studio/contracts';
import type { Sql } from '@studio/db';
import {
  blockingPredecessorNames,
  blockingSuccessorNames,
  normalizeBlockReason,
  notApplicableBlockRefusal,
  predecessorRefusalMessage,
  resolvePublishBvid,
  planNodeStep,
  planStageStep,
  rollbackTargetStatus,
  successorRefusalMessage,
  PROGRESS_STAGE_SLUGS,
  isProgressStageId,
  type EngineEdge,
  type EngineNode,
  type PlanNode,
  type StepPlan,
} from '@studio/workflow';
import type { Context } from 'hono';
import type { Hono } from 'hono';
import postgres from 'postgres';
import { COMMERCIAL_UPDATED_AT_FORMAT } from './commercial-timestamp';

const CONSTRAINT_CODES = new Set(['23514', '23505', '23503', '23502', 'P0001']);

type RefusalExtra = {
  blocks?: CommercialStepBlock[];
  effects?: CommercialStepEffect[];
  successors?: CommercialStepSuccessor[];
};

class CommercialWriteRefusal extends Error {
  readonly status: 400 | 404 | 409;
  readonly body: CommercialWriteErrorBody;

  constructor(
    status: 400 | 404 | 409,
    code: CommercialWriteErrorCode,
    error: string,
    names?: readonly string[],
    extra?: RefusalExtra,
  ) {
    super(error);
    this.status = status;
    const body: CommercialWriteErrorBody = { error, code };
    if (names && names.length > 0) body.names = [...names];
    if (extra?.blocks && extra.blocks.length > 0) body.blocks = extra.blocks;
    if (extra?.effects && extra.effects.length > 0) body.effects = extra.effects;
    if (extra?.successors && extra.successors.length > 0) body.successors = extra.successors;
    this.body = body;
  }
}

function refuse(
  status: 400 | 404 | 409,
  code: CommercialWriteErrorCode,
  error: string,
  names?: readonly string[],
  extra?: RefusalExtra,
): never {
  throw new CommercialWriteRefusal(status, code, error, names, extra);
}

type Tx = postgres.TransactionSql;

type DbNode = {
  id: string;
  name: string;
  status: string;
  kind: string;
  is_optional: boolean;
  updated_at: string;
  status_before_block: string | null;
  primary_block_pinned_item_id: string | null;
  planned_at: string | null;
  completed_at: string | null;
  pos_x: number;
  pos_y: number;
  template_slug: string | null;
  workflow_id: string;
};

type DbEdge = {
  from_node_id: string;
  to_node_id: string;
};

type ItemRow = {
  id: string;
  title: string;
  description: string | null;
  lifecycle: string;
  impact: string;
  next_actor: string;
  planned_at: string | null;
  cancel_reason: string | null;
  updated_at: string;
};

type Graph = {
  nodes: DbNode[];
  edges: DbEdge[];
  byId: Map<string, DbNode>;
};

function asStatus(value: string): WfNodeStatus {
  if (!isWfNodeStatus(value)) throw new Error(`unexpected node status ${value}`);
  return value;
}

function asKind(value: string): WfNodeKind {
  if (!isWfNodeKind(value)) throw new Error(`unexpected node kind ${value}`);
  return value;
}

function asLifecycle(value: string): OpenItemLifecycle {
  if (value === 'open' || value === 'closed' || value === 'cancelled') return value;
  throw new Error(`unexpected lifecycle ${value}`);
}

function asImpact(value: string): OpenItemImpact {
  if (value === 'normal' || value === 'blocking') return value;
  throw new Error(`unexpected impact ${value}`);
}

function asActor(value: string): OpenItemActor {
  if (!isOpenItemActor(value)) throw new Error(`unexpected next_actor ${value}`);
  return value;
}

function asJobType(value: string): MonitorJobType {
  if (value === 'metadata' || value === 'metrics') return value;
  throw new Error(`unexpected job type ${value}`);
}

function asPublishSource(value: string): PublishSource {
  if (value === 'web' || value === 'hermes' || value === 'manual') return value;
  throw new Error(`unexpected publish source ${value}`);
}

function asPublishContentKind(value: string): PublishContentKind {
  if (!isPublishContentKind(value)) throw new Error(`unexpected publish content kind ${value}`);
  return value;
}

function assertToken(actual: string, expected: string): void {
  if (actual !== expected) {
    refuse(409, 'stale_write', '并发令牌已过期，请按最近一次读取的 updatedAt 重试');
  }
}

function isPublishNode(node: DbNode): boolean {
  return node.template_slug === 'publish' || node.name === '发布';
}

function restoreStatus(node: Pick<DbNode, 'status_before_block'>): WfNodeStatus {
  const previous = node.status_before_block;
  if (previous && isWfNodeStatus(previous) && previous !== 'blocked') return previous;
  return 'in_progress';
}

async function audit(
  tx: Tx,
  projectId: string,
  entityType: string,
  entityId: string | null,
  action: string,
  detail: postgres.JSONValue,
): Promise<void> {
  await tx`
    INSERT INTO domain_audit_events (project_id, entity_type, entity_id, action, detail, source)
    VALUES (${projectId}, ${entityType}, ${entityId}, ${action}, ${tx.json(detail)}, 'web')
  `;
}

async function requireProject(tx: Tx, projectId: string): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM commercial_projects WHERE id = ${projectId} FOR UPDATE
  `;
  if (!rows[0]) refuse(404, 'not_found', '项目不存在');
}

async function loadGraph(tx: Tx, projectId: string): Promise<Graph> {
  const nodes = await tx<DbNode[]>`
    SELECT
      n.id,
      n.name,
      n.status,
      n.kind,
      n.is_optional,
      to_char(n.updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at,
      n.status_before_block,
      n.primary_block_pinned_item_id,
      to_char(n.planned_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS planned_at,
      to_char(n.completed_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS completed_at,
      n.pos_x,
      n.pos_y,
      t.slug AS template_slug,
      n.workflow_id
    FROM wf_nodes n
    LEFT JOIN wf_template_nodes t
      ON t.id = n.template_node_id
     AND t.template_version_id = n.template_version_id
    WHERE n.project_id = ${projectId}
    ORDER BY n.pos_y, n.pos_x, n.id
    FOR UPDATE OF n
  `;
  if (nodes.length === 0) {
    const workflows = await tx<{ id: string }[]>`
      SELECT id FROM project_workflows WHERE project_id = ${projectId}
    `;
    if (!workflows[0]) refuse(404, 'not_found', '流程不存在');
  }
  const workflowId = nodes[0]?.workflow_id;
  const edges = workflowId
    ? await tx<DbEdge[]>`
        SELECT e.from_node_id, e.to_node_id
        FROM wf_edges e
        JOIN wf_nodes fn ON fn.id = e.from_node_id AND fn.workflow_id = e.workflow_id
        JOIN wf_nodes tn ON tn.id = e.to_node_id AND tn.workflow_id = e.workflow_id
        WHERE e.workflow_id = ${workflowId}
        ORDER BY fn.pos_y, fn.pos_x, fn.id, tn.pos_y, tn.pos_x, tn.id, e.id
      `
    : [];
  return { nodes, edges, byId: new Map(nodes.map((node) => [node.id, node])) };
}

function requireNode(graph: Graph, nodeId: string): DbNode {
  const node = graph.byId.get(nodeId);
  if (!node) refuse(404, 'not_found', '节点不存在');
  return node;
}

function toEngine(graph: Graph): { nodes: EngineNode[]; edges: EngineEdge[] } {
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      name: node.name,
      status: asStatus(node.status),
    })),
    edges: graph.edges.map((edge) => ({
      fromNodeId: edge.from_node_id,
      toNodeId: edge.to_node_id,
    })),
  };
}

function toSnapshot(node: DbNode): CommercialNodeSnapshot {
  return {
    id: node.id,
    name: node.name,
    status: asStatus(node.status),
    kind: asKind(node.kind),
    updatedAt: node.updated_at,
    statusBeforeBlock:
      node.status_before_block === null ? null : asStatus(node.status_before_block),
    primaryBlockItemId: node.primary_block_pinned_item_id,
    plannedAt: node.planned_at,
    completedAt: node.completed_at,
  };
}

async function updateNode(
  tx: Tx,
  projectId: string,
  current: DbNode,
  patch: {
    status: WfNodeStatus;
    statusBeforeBlock: string | null;
    primaryBlockItemId: string | null;
    clearCompletedAt: boolean;
  },
): Promise<DbNode> {
  const rows = await tx<Omit<DbNode, 'template_slug'>[]>`
    UPDATE wf_nodes SET
      status = ${patch.status},
      updated_at = now(),
      status_before_block = ${patch.statusBeforeBlock},
      primary_block_pinned_item_id = ${patch.primaryBlockItemId},
      completed_at = CASE
        WHEN ${patch.status} = 'completed' THEN COALESCE(completed_at, now())
        WHEN ${patch.clearCompletedAt} THEN NULL
        ELSE completed_at
      END
    WHERE id = ${current.id} AND project_id = ${projectId}
    RETURNING
      id,
      name,
      status,
      kind,
      is_optional,
      to_char(updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at,
      status_before_block,
      primary_block_pinned_item_id,
      to_char(planned_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS planned_at,
      to_char(completed_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS completed_at,
      pos_x,
      pos_y,
      workflow_id
  `;
  const row = rows[0];
  if (!row) refuse(404, 'not_found', '节点不存在');
  return { ...row, template_slug: current.template_slug };
}

async function pinnedView(
  tx: Tx,
  projectId: string,
  node: DbNode,
): Promise<{ blockingReason: string | null; pinnedItem: CommercialPinnedBlockItem | null }> {
  if (!node.primary_block_pinned_item_id) return { blockingReason: null, pinnedItem: null };
  const items = await tx<ItemRow[]>`
    SELECT
      id,
      title,
      description,
      lifecycle,
      impact,
      next_actor,
      to_char(planned_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS planned_at,
      cancel_reason,
      to_char(updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at
    FROM open_items
    WHERE id = ${node.primary_block_pinned_item_id} AND project_id = ${projectId}
  `;
  const item = items[0];
  if (!item || item.impact !== 'blocking') return { blockingReason: null, pinnedItem: null };
  const title = item.title.trim();
  if (title.length === 0) return { blockingReason: null, pinnedItem: null };
  return {
    blockingReason: title,
    pinnedItem: {
      id: item.id,
      title,
      lifecycle: asLifecycle(item.lifecycle),
      impact: 'blocking',
      updatedAt: item.updated_at,
    },
  };
}

async function nodeResponse(
  tx: Tx,
  projectId: string,
  node: DbNode,
): Promise<CommercialNodeWriteResponse> {
  const view = await pinnedView(tx, projectId, node);
  return { projectId, node: toSnapshot(node), ...view };
}

async function lockItem(tx: Tx, projectId: string, itemId: string): Promise<ItemRow | null> {
  const rows = await tx<ItemRow[]>`
    SELECT
      id,
      title,
      description,
      lifecycle,
      impact,
      next_actor,
      to_char(planned_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS planned_at,
      cancel_reason,
      to_char(updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at
    FROM open_items
    WHERE id = ${itemId} AND project_id = ${projectId}
    FOR UPDATE
  `;
  return rows[0] ?? null;
}

function itemSnapshot(item: ItemRow): CommercialOpenItemSnapshot {
  const lifecycle = asLifecycle(item.lifecycle);
  return {
    id: item.id,
    title: item.title.trim(),
    lifecycle,
    impact: asImpact(item.impact),
    nextActor: asActor(item.next_actor),
    dueAt: item.planned_at,
    note: item.description,
    updatedAt: item.updated_at,
    cancelReason: lifecycle === 'cancelled' ? item.cancel_reason : null,
  };
}

async function advanceNode(
  tx: Tx,
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<CommercialNodeWriteResponse> {
  await requireProject(tx, projectId);
  const graph = await loadGraph(tx, projectId);
  const node = requireNode(graph, nodeId);
  assertToken(node.updated_at, expectedUpdatedAt);
  const status = asStatus(node.status);
  if (status === 'blocked') refuse(409, 'invalid_transition', '阻塞中的节点要先解除阻塞');
  if (status !== 'not_reached') refuse(409, 'invalid_transition', '只能把未到达的节点推进为进行中');
  const engine = toEngine(graph);
  const names = blockingPredecessorNames(nodeId, engine.nodes, engine.edges);
  if (names.length > 0) {
    refuse(409, 'predecessors_incomplete', predecessorRefusalMessage(names), names);
  }
  const updated = await updateNode(tx, projectId, node, {
    status: 'in_progress',
    statusBeforeBlock: null,
    primaryBlockItemId: node.primary_block_pinned_item_id,
    clearCompletedAt: false,
  });
  await audit(tx, projectId, 'wf_node', nodeId, 'advance', { from: status, to: 'in_progress' });
  return nodeResponse(tx, projectId, updated);
}

async function completeNode(
  tx: Tx,
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<CommercialNodeWriteResponse> {
  await requireProject(tx, projectId);
  const graph = await loadGraph(tx, projectId);
  const node = requireNode(graph, nodeId);
  assertToken(node.updated_at, expectedUpdatedAt);
  if (isPublishNode(node)) {
    refuse(400, 'publish_required', '完成发布节点必须在同一事务中记录发布信息');
  }
  const status = asStatus(node.status);
  if (status === 'blocked') refuse(409, 'invalid_transition', '阻塞中的节点要先解除阻塞');
  if (status !== 'in_progress') refuse(409, 'invalid_transition', '只能完成进行中的节点');
  const updated = await updateNode(tx, projectId, node, {
    status: 'completed',
    statusBeforeBlock: null,
    primaryBlockItemId: node.primary_block_pinned_item_id,
    clearCompletedAt: false,
  });
  await audit(tx, projectId, 'wf_node', nodeId, 'complete', { from: status, to: 'completed' });
  return nodeResponse(tx, projectId, updated);
}

async function skipNode(
  tx: Tx,
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<CommercialNodeWriteResponse> {
  await requireProject(tx, projectId);
  const graph = await loadGraph(tx, projectId);
  const node = requireNode(graph, nodeId);
  assertToken(node.updated_at, expectedUpdatedAt);
  const pinRefusal = notApplicableBlockRefusal(node.primary_block_pinned_item_id !== null);
  if (pinRefusal) refuse(409, 'not_applicable_block', pinRefusal);
  const status = asStatus(node.status);
  if (status === 'completed') {
    refuse(409, 'invalid_transition', '已完成的节点不能标记为不适用');
  }
  if (status !== 'not_reached' && status !== 'in_progress') {
    refuse(409, 'invalid_transition', '只能跳过未到达或进行中的节点');
  }
  const updated = await updateNode(tx, projectId, node, {
    status: 'not_applicable',
    statusBeforeBlock: null,
    primaryBlockItemId: null,
    clearCompletedAt: true,
  });
  await audit(tx, projectId, 'wf_node', nodeId, 'skip', { from: status, to: 'not_applicable' });
  return nodeResponse(tx, projectId, updated);
}

async function rollbackNode(
  tx: Tx,
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<CommercialNodeWriteResponse> {
  await requireProject(tx, projectId);
  const graph = await loadGraph(tx, projectId);
  const node = requireNode(graph, nodeId);
  assertToken(node.updated_at, expectedUpdatedAt);
  const engine = toEngine(graph);
  const names = blockingSuccessorNames(nodeId, engine.nodes, engine.edges);
  if (names.length > 0) {
    refuse(409, 'successors_advanced', successorRefusalMessage(names), names);
  }
  const status = asStatus(node.status);
  const target = rollbackTargetStatus(status);
  if (!target) refuse(409, 'invalid_transition', '该节点没有可回退的状态');
  const updated = await updateNode(tx, projectId, node, {
    status: target,
    statusBeforeBlock: null,
    primaryBlockItemId: node.primary_block_pinned_item_id,
    clearCompletedAt: true,
  });
  await audit(tx, projectId, 'wf_node', nodeId, 'rollback', { from: status, to: target });
  return nodeResponse(tx, projectId, updated);
}

async function blockNode(
  tx: Tx,
  projectId: string,
  nodeId: string,
  input: { expectedUpdatedAt: string; reason?: string | null; openItemId?: string | null },
): Promise<CommercialNodeWriteResponse> {
  await requireProject(tx, projectId);
  const graph = await loadGraph(tx, projectId);
  const node = requireNode(graph, nodeId);
  assertToken(node.updated_at, input.expectedUpdatedAt);
  const status = asStatus(node.status);
  if (status !== 'in_progress') refuse(409, 'invalid_transition', '只能阻塞进行中的节点');
  const reason = normalizeBlockReason(input.reason);
  const openItemId = input.openItemId ?? null;
  if (reason && openItemId) refuse(400, 'invalid_body', '原因和已有事项只能提交一个');

  let pinId: string | null = null;
  if (openItemId) {
    const item = await lockItem(tx, projectId, openItemId);
    if (!item) refuse(404, 'not_found', '开放事项不存在');
    if (item.impact !== 'blocking') {
      refuse(409, 'invalid_transition', '只能把阻塞影响的开放事项钉为主阻塞项');
    }
    if (item.lifecycle !== 'open') refuse(409, 'invalid_transition', '只能钉住仍开放的事项');
    pinId = item.id;
  } else if (reason) {
    pinId = crypto.randomUUID();
    await tx`
      INSERT INTO open_items (
        id, project_id, workflow_node_id, blocks_node_id, title, impact, lifecycle, next_actor
      ) VALUES (
        ${pinId}, ${projectId}, ${nodeId}, ${nodeId}, ${reason}, 'blocking', 'open', 'us'
      )
    `;
    await audit(tx, projectId, 'open_item', pinId, 'create', {
      title: reason,
      impact: 'blocking',
      nodeId,
    });
  }

  const updated = await updateNode(tx, projectId, node, {
    status: 'blocked',
    statusBeforeBlock: status,
    primaryBlockItemId: pinId,
    clearCompletedAt: false,
  });
  await audit(tx, projectId, 'wf_node', nodeId, 'block', {
    from: status,
    to: 'blocked',
    reason,
    openItemId: pinId,
  });
  return nodeResponse(tx, projectId, updated);
}

async function unblockNode(
  tx: Tx,
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
): Promise<CommercialNodeWriteResponse> {
  await requireProject(tx, projectId);
  const graph = await loadGraph(tx, projectId);
  const node = requireNode(graph, nodeId);
  assertToken(node.updated_at, expectedUpdatedAt);
  const status = asStatus(node.status);
  if (status !== 'blocked') refuse(409, 'invalid_transition', '该节点当前不是阻塞状态');
  const restored = restoreStatus(node);
  const updated = await updateNode(tx, projectId, node, {
    status: restored,
    statusBeforeBlock: null,
    primaryBlockItemId: null,
    clearCompletedAt: restored !== 'completed',
  });
  await audit(tx, projectId, 'wf_node', nodeId, 'unblock', { from: status, to: restored });
  return nodeResponse(tx, projectId, updated);
}

function shanghaiDateInstant(plannedOn: string): Date {
  return new Date(`${plannedOn}T00:00:00+08:00`);
}

/** Writes planned_at only. Status, completed_at, and edges stay as they are. */
async function planNode(
  tx: Tx,
  projectId: string,
  nodeId: string,
  input: { expectedUpdatedAt: string; plannedAt: string | null },
): Promise<CommercialNodeWriteResponse> {
  await requireProject(tx, projectId);
  const graph = await loadGraph(tx, projectId);
  const node = requireNode(graph, nodeId);
  assertToken(node.updated_at, input.expectedUpdatedAt);
  const plannedAt = input.plannedAt === null ? null : shanghaiDateInstant(input.plannedAt);
  const rows = await tx<Omit<DbNode, 'template_slug'>[]>`
    UPDATE wf_nodes SET
      planned_at = ${plannedAt},
      updated_at = now()
    WHERE id = ${node.id} AND project_id = ${projectId}
    RETURNING
      id,
      name,
      status,
      kind,
      is_optional,
      to_char(updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at,
      status_before_block,
      primary_block_pinned_item_id,
      to_char(planned_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS planned_at,
      to_char(completed_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS completed_at,
      pos_x,
      pos_y,
      workflow_id
  `;
  const row = rows[0];
  if (!row) refuse(404, 'not_found', '节点不存在');
  const updated: DbNode = { ...row, template_slug: node.template_slug };
  if (updated.status !== node.status) {
    refuse(409, 'constraint_violation', '计划日期不能改变节点状态');
  }
  await audit(tx, projectId, 'wf_node', nodeId, 'plan', { plannedAt: input.plannedAt });
  return nodeResponse(tx, projectId, updated);
}

type LayoutChangeDetail = {
  nodeId: string;
  nameBefore?: string;
  nameAfter?: string;
  posBefore?: { x: number; y: number };
  posAfter?: { x: number; y: number };
};

async function readWorkflowNodes(
  tx: Tx,
  projectId: string,
  workflowId: string,
): Promise<CommercialWorkflowNode[]> {
  const nodes = await tx<
    {
      id: string;
      name: string;
      status: string;
      kind: string;
      template_slug: string | null;
      blocking_reason: string | null;
      planned_at: string | null;
      completed_at: string | null;
      pos_x: number;
      pos_y: number;
      updated_at: string;
    }[]
  >`
    SELECT
      n.id,
      n.name,
      n.status,
      n.kind,
      t.slug AS template_slug,
      (
        SELECT oi.title
        FROM open_items oi
        WHERE n.status = 'blocked'
          AND oi.project_id = n.project_id
          AND oi.lifecycle = 'open'
          AND oi.impact = 'blocking'
          AND (
            oi.id = n.primary_block_pinned_item_id
            OR oi.blocks_node_id = n.id
          )
        ORDER BY
          (oi.id = n.primary_block_pinned_item_id) DESC,
          oi.sort_rank ASC,
          oi.created_at ASC,
          oi.id ASC
        LIMIT 1
      ) AS blocking_reason,
      to_char(n.planned_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS planned_at,
      to_char(n.completed_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS completed_at,
      n.pos_x,
      n.pos_y,
      to_char(n.updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at
    FROM wf_nodes n
    LEFT JOIN wf_template_nodes t
      ON t.id = n.template_node_id
     AND t.template_version_id = n.template_version_id
    WHERE n.project_id = ${projectId} AND n.workflow_id = ${workflowId}
    ORDER BY n.pos_y, n.pos_x, n.id
  `;
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    status: asStatus(node.status),
    kind: asKind(node.kind),
    templateSlug: node.template_slug,
    blockingReason: node.blocking_reason,
    plannedAt: node.planned_at,
    completedAt: node.completed_at,
    posX: node.pos_x,
    posY: node.pos_y,
    updatedAt: node.updated_at,
  }));
}

/** Renames and/or moves nodes. Never inserts, deletes, or rewires edges. */
async function applyWorkflowLayout(
  tx: Tx,
  projectId: string,
  input: CommercialWorkflowLayoutRequest,
): Promise<CommercialWorkflowLayoutResponse> {
  await assertProjectWritable(tx, projectId);
  const graph = await loadGraph(tx, projectId);
  const workflowId = graph.nodes[0]?.workflow_id;
  if (!workflowId) refuse(404, 'not_found', '流程不存在');

  const submittedIds = new Set(input.nodes.map((node) => node.nodeId));
  if (
    submittedIds.size !== graph.nodes.length ||
    graph.nodes.some((node) => !submittedIds.has(node.id))
  ) {
    refuse(409, 'constraint_violation', '提交的节点集合与流程不一致，布局接口不能增删节点');
  }

  for (const patch of input.nodes) {
    const current = graph.byId.get(patch.nodeId);
    if (!current) refuse(404, 'not_found', '节点不存在');
    assertToken(current.updated_at, patch.expectedUpdatedAt);
  }

  const nextNames = new Map(graph.nodes.map((node) => [node.id, node.name]));
  for (const patch of input.nodes) {
    if (patch.name !== undefined) nextNames.set(patch.nodeId, patch.name);
  }
  const seenNames = new Set<string>();
  for (const [nodeId, name] of nextNames) {
    if (seenNames.has(name)) {
      refuse(409, 'constraint_violation', `节点名称「${name}」已存在，同一流程内名称必须唯一`, [
        name,
      ]);
    }
    seenNames.add(name);
    void nodeId;
  }

  const changes: LayoutChangeDetail[] = [];
  for (const patch of input.nodes) {
    const current = graph.byId.get(patch.nodeId);
    if (!current) refuse(404, 'not_found', '节点不存在');
    const nextName = patch.name ?? current.name;
    const nextPosX = patch.posX ?? current.pos_x;
    const nextPosY = patch.posY ?? current.pos_y;
    const nameChanged = nextName !== current.name;
    const posChanged = nextPosX !== current.pos_x || nextPosY !== current.pos_y;
    if (!nameChanged && !posChanged) continue;

    const detail: LayoutChangeDetail = { nodeId: current.id };
    if (nameChanged) {
      detail.nameBefore = current.name;
      detail.nameAfter = nextName;
    }
    if (posChanged) {
      detail.posBefore = { x: current.pos_x, y: current.pos_y };
      detail.posAfter = { x: nextPosX, y: nextPosY };
    }
    changes.push(detail);

    await tx`
      UPDATE wf_nodes SET
        name = ${nextName},
        pos_x = ${nextPosX},
        pos_y = ${nextPosY},
        updated_at = now()
      WHERE id = ${current.id} AND project_id = ${projectId}
    `;
  }

  if (changes.length === 0) {
    refuse(400, 'invalid_body', '没有可保存的名称或坐标变更');
  }

  const edgeCountBefore = graph.edges.length;
  const edgeCountAfter = await tx<{ count: string }[]>`
    SELECT count(*)::text AS count FROM wf_edges WHERE workflow_id = ${workflowId}
  `;
  if (Number(edgeCountAfter[0]?.count ?? -1) !== edgeCountBefore) {
    refuse(409, 'constraint_violation', '布局保存不得改写连线');
  }

  await audit(tx, projectId, 'project_workflow', workflowId, 'layout', {
    changes,
  });

  const nodes = await readWorkflowNodes(tx, projectId, workflowId);
  const updatedAt = nodes.reduce(
    (latest, node) => (node.updatedAt > latest ? node.updatedAt : latest),
    nodes[0]?.updatedAt ?? '',
  );
  return { projectId, updatedAt, nodes };
}

async function liftPinnedBlocks(
  tx: Tx,
  projectId: string,
  itemId: string,
): Promise<CommercialNodeSnapshot[]> {
  const nodes = await tx<DbNode[]>`
    SELECT
      n.id,
      n.name,
      n.status,
      n.kind,
      n.is_optional,
      to_char(n.updated_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS updated_at,
      n.status_before_block,
      n.primary_block_pinned_item_id,
      to_char(n.planned_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS planned_at,
      to_char(n.completed_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS completed_at,
      t.slug AS template_slug,
      n.workflow_id
    FROM wf_nodes n
    LEFT JOIN wf_template_nodes t
      ON t.id = n.template_node_id
     AND t.template_version_id = n.template_version_id
    WHERE n.project_id = ${projectId} AND n.primary_block_pinned_item_id = ${itemId}
    FOR UPDATE OF n
  `;
  const lifted: CommercialNodeSnapshot[] = [];
  for (const node of nodes) {
    const status = asStatus(node.status);
    if (status !== 'blocked') {
      const cleared = await updateNode(tx, projectId, node, {
        status,
        statusBeforeBlock: node.status_before_block,
        primaryBlockItemId: null,
        clearCompletedAt: false,
      });
      await audit(tx, projectId, 'wf_node', node.id, 'clear_primary_block', {
        openItemId: itemId,
        status: cleared.status,
      });
      continue;
    }
    const restored = restoreStatus(node);
    const updated = await updateNode(tx, projectId, node, {
      status: restored,
      statusBeforeBlock: null,
      primaryBlockItemId: null,
      clearCompletedAt: restored !== 'completed',
    });
    await audit(tx, projectId, 'wf_node', node.id, 'lift_block', {
      from: status,
      to: restored,
      openItemId: itemId,
    });
    lifted.push(toSnapshot(updated));
  }
  return lifted;
}

async function closeItem(
  tx: Tx,
  projectId: string,
  itemId: string,
  input: { expectedUpdatedAt: string; closeConclusion?: string | null },
): Promise<CommercialOpenItemWriteResponse> {
  await requireProject(tx, projectId);
  const item = await lockItem(tx, projectId, itemId);
  if (!item) refuse(404, 'not_found', '开放事项不存在');
  assertToken(item.updated_at, input.expectedUpdatedAt);
  if (item.lifecycle !== 'open') refuse(409, 'invalid_transition', '事项已关闭或取消');
  const conclusion = input.closeConclusion ?? null;
  await tx`
    UPDATE open_items
    SET lifecycle = 'closed',
        closed_at = now(),
        updated_at = now(),
        close_conclusion = ${conclusion}
    WHERE id = ${itemId} AND project_id = ${projectId}
  `;
  const liftedNodes = await liftPinnedBlocks(tx, projectId, itemId);
  await audit(tx, projectId, 'open_item', itemId, 'close', { closeConclusion: conclusion });
  const saved = await lockItem(tx, projectId, itemId);
  if (!saved) refuse(404, 'not_found', '开放事项不存在');
  return { projectId, item: itemSnapshot(saved), liftedNodes };
}

async function cancelItem(
  tx: Tx,
  projectId: string,
  itemId: string,
  input: { expectedUpdatedAt: string; cancelReason: string },
): Promise<CommercialOpenItemWriteResponse> {
  await requireProject(tx, projectId);
  const item = await lockItem(tx, projectId, itemId);
  if (!item) refuse(404, 'not_found', '开放事项不存在');
  assertToken(item.updated_at, input.expectedUpdatedAt);
  if (item.lifecycle !== 'open') refuse(409, 'invalid_transition', '事项已关闭或取消');
  await tx`
    UPDATE open_items
    SET lifecycle = 'cancelled',
        cancel_reason = ${input.cancelReason},
        updated_at = now()
    WHERE id = ${itemId} AND project_id = ${projectId}
  `;
  const liftedNodes = await liftPinnedBlocks(tx, projectId, itemId);
  await audit(tx, projectId, 'open_item', itemId, 'cancel', {});
  const saved = await lockItem(tx, projectId, itemId);
  if (!saved) refuse(404, 'not_found', '开放事项不存在');
  return { projectId, item: itemSnapshot(saved), liftedNodes };
}

async function assertUniqueOpenTitle(
  tx: Tx,
  projectId: string,
  title: string,
  excludeItemId: string | null,
): Promise<void> {
  const rows = await tx<{ id: string }[]>`
    SELECT id FROM open_items
    WHERE project_id = ${projectId}
      AND lifecycle = 'open'
      AND btrim(title) = ${title}
      AND (${excludeItemId}::uuid IS NULL OR id <> ${excludeItemId}::uuid)
    LIMIT 1
  `;
  if (rows[0]) refuse(409, 'duplicate_open_item', '同一项目已有同名开放卡点');
}

async function createItem(
  tx: Tx,
  projectId: string,
  input: CommercialOpenItemCreateRequest,
): Promise<CommercialOpenItemWriteResponse> {
  await requireProject(tx, projectId);
  await assertUniqueOpenTitle(tx, projectId, input.title, null);
  const itemId = crypto.randomUUID();
  await tx`
    INSERT INTO open_items (
      id, project_id, title, description, next_actor, lifecycle, impact, planned_at
    ) VALUES (
      ${itemId}, ${projectId}, ${input.title}, ${input.note ?? null},
      ${input.nextActor}, 'open', ${input.impact}, ${input.dueAt ?? null}
    )
  `;
  await audit(tx, projectId, 'open_item', itemId, 'create', {
    title: input.title,
    nextActor: input.nextActor,
    impact: input.impact,
    dueAt: input.dueAt ?? null,
    note: input.note ?? null,
  });
  const saved = await lockItem(tx, projectId, itemId);
  if (!saved) refuse(404, 'not_found', '开放事项不存在');
  return { projectId, item: itemSnapshot(saved), liftedNodes: [] };
}

async function updateItem(
  tx: Tx,
  projectId: string,
  itemId: string,
  input: CommercialOpenItemUpdateRequest,
): Promise<CommercialOpenItemWriteResponse> {
  await requireProject(tx, projectId);
  const item = await lockItem(tx, projectId, itemId);
  if (!item) refuse(404, 'not_found', '开放事项不存在');
  assertToken(item.updated_at, input.expectedUpdatedAt);
  if (item.lifecycle !== 'open') refuse(409, 'item_closed', '事项已关闭或取消，不能再编辑');
  const title = input.title ?? item.title.trim();
  if (input.title !== undefined) {
    await assertUniqueOpenTitle(tx, projectId, title, itemId);
  }
  const nextActor = input.nextActor ?? asActor(item.next_actor);
  const impact = input.impact ?? asImpact(item.impact);
  const dueAt = input.dueAt === undefined ? item.planned_at : input.dueAt;
  const note = input.note === undefined ? item.description : input.note;
  await tx`
    UPDATE open_items
    SET title = ${title},
        description = ${note},
        next_actor = ${nextActor},
        impact = ${impact},
        planned_at = ${dueAt},
        updated_at = now()
    WHERE id = ${itemId} AND project_id = ${projectId}
  `;
  await audit(tx, projectId, 'open_item', itemId, 'update', {
    title,
    nextActor,
    impact,
    dueAt,
    note,
  });
  const saved = await lockItem(tx, projectId, itemId);
  if (!saved) refuse(404, 'not_found', '开放事项不存在');
  return { projectId, item: itemSnapshot(saved), liftedNodes: [] };
}

type PublishRecord = {
  project_id: string;
  bvid: string | null;
  publish_source: string;
  published_at: string;
  idempotency_key: string | null;
  platform: string;
  content_kind: string;
  content_url: string | null;
  external_id: string | null;
};

async function loadPublishBundle(
  tx: Tx,
  projectId: string,
  node: DbNode,
): Promise<Omit<CommercialPublishResponse, 'idempotentReplay'>> {
  const records = await tx<PublishRecord[]>`
    SELECT
      project_id,
      bvid,
      publish_source,
      to_char(published_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS published_at,
      idempotency_key,
      platform,
      content_kind,
      content_url,
      external_id
    FROM project_publish_records
    WHERE project_id = ${projectId}
  `;
  const record = records[0];
  if (!record || !record.idempotency_key) refuse(404, 'not_found', '发布记录不存在');
  const contentKind = asPublishContentKind(record.content_kind);
  let monitor: CommercialPublishResponse['monitor'] = null;
  if (contentKind === 'video') {
    const contracts = await tx<{ id: string; bvid: string; metadata_task_status: string }[]>`
      SELECT id, bvid, metadata_task_status
      FROM project_monitor_contracts
      WHERE project_id = ${projectId}
    `;
    const contract = contracts[0];
    if (!contract) refuse(404, 'not_found', '监控合同不存在');
    const jobs = await tx<{ id: string; job_type: string; status: string }[]>`
      SELECT id, job_type, status
      FROM monitor_jobs
      WHERE project_id = ${projectId}
      ORDER BY job_type
    `;
    monitor = {
      contractId: contract.id,
      bvid: contract.bvid,
      metadataTaskStatus: contract.metadata_task_status,
      jobs: jobs.map((job) => ({
        id: job.id,
        jobType: asJobType(job.job_type),
        status: job.status,
      })),
    };
  }
  const audits = await tx<{ detail: unknown }[]>`
    SELECT detail
    FROM domain_audit_events
    WHERE project_id = ${projectId}
      AND entity_type = 'project_publish_record'
      AND action = 'record'
    ORDER BY id DESC
    LIMIT 1
  `;
  const detail = asDetail(audits[0]?.detail);
  const videoUrl =
    contentKind === 'video'
      ? typeof detail.videoUrl === 'string'
        ? detail.videoUrl
        : record.content_url
      : null;
  return {
    projectId,
    node: toSnapshot(node),
    publish: {
      bvid: record.bvid,
      publishedAt: record.published_at,
      publishSource: asPublishSource(record.publish_source),
      idempotencyKey: record.idempotency_key,
      platform: record.platform,
      videoUrl,
      contentKind,
      contentUrl: record.content_url,
      externalId: record.external_id,
    },
    monitor,
  };
}

function asDetail(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

async function publishNode(
  tx: Tx,
  projectId: string,
  nodeId: string,
  input: {
    expectedUpdatedAt: string;
    idempotencyKey: string;
    platform: string;
    contentKind: PublishContentKind;
    bvid: string | null;
    videoUrl: string | null;
    contentUrl: string | null;
    externalId: string | null;
    publishedAt: string | null;
    publishSource: PublishSource;
  },
): Promise<CommercialPublishResponse> {
  if (input.contentKind === 'post') {
    if (!isPublishPlatform(input.platform)) {
      refuse(400, 'unsupported_platform', `不支持的发布平台：${input.platform}`);
    }
    if (input.contentUrl === null) refuse(400, 'invalid_body', '图文发布需要内容链接');
    if (input.externalId === null) refuse(400, 'invalid_body', '图文发布需要内容外部 id');
  } else {
    if (input.platform !== 'bilibili') {
      refuse(400, 'unsupported_platform', '视频发布目前只接受平台 bilibili');
    }
    if (input.bvid === null) refuse(400, 'invalid_body', '链接里没有可用的 bvid');
  }
  await tx`SELECT pg_advisory_xact_lock(hashtextextended(${input.idempotencyKey}, 0))`;
  await requireProject(tx, projectId);
  const existing = await tx<PublishRecord[]>`
    SELECT
      project_id,
      bvid,
      publish_source,
      to_char(published_at AT TIME ZONE 'UTC', ${COMMERCIAL_UPDATED_AT_FORMAT}) AS published_at,
      idempotency_key,
      platform,
      content_kind,
      content_url,
      external_id
    FROM project_publish_records
    WHERE idempotency_key = ${input.idempotencyKey} OR project_id = ${projectId}
    FOR UPDATE
  `;
  const byKey = existing.find((row) => row.idempotency_key === input.idempotencyKey);
  const byProject = existing.find((row) => row.project_id === projectId);
  if (byKey && byKey.project_id !== projectId) {
    refuse(409, 'publish_conflict', '幂等键已用于其他项目');
  }
  if (byProject && byProject.idempotency_key !== input.idempotencyKey) {
    refuse(409, 'publish_conflict', '项目已有发布记录');
  }
  if (byProject) {
    if (byProject.content_kind !== input.contentKind) {
      refuse(409, 'publish_conflict', '幂等键已用于不同的交付类型');
    }
    const sameIdentity =
      input.contentKind === 'video'
        ? byProject.bvid === input.bvid
        : byProject.external_id === input.externalId;
    if (!sameIdentity) {
      refuse(409, 'publish_conflict', '幂等键已用于不同的内容标识');
    }
  }
  const graph = await loadGraph(tx, projectId);
  const node = requireNode(graph, nodeId);
  if (!isPublishNode(node)) refuse(409, 'invalid_transition', '只有发布节点可以记录发布');
  if (byProject) {
    if (asStatus(node.status) === 'completed') {
      // Legacy publish endpoint must still heal overall_stage on replay.
      await syncOverallStage(tx, projectId, graph);
      const bundle = await loadPublishBundle(tx, projectId, node);
      return { ...bundle, idempotentReplay: true };
    }
    assertToken(node.updated_at, input.expectedUpdatedAt);
    const status = asStatus(node.status);
    if (status === 'blocked') refuse(409, 'invalid_transition', '阻塞中的节点要先解除阻塞');
    if (status !== 'in_progress') {
      refuse(409, 'invalid_transition', '只能在发布节点进行中时沿用已有发布记录');
    }
    const updated = await updateNode(tx, projectId, node, {
      status: 'completed',
      statusBeforeBlock: null,
      primaryBlockItemId: node.primary_block_pinned_item_id,
      clearCompletedAt: false,
    });
    rememberNode(graph, updated);
    await audit(tx, projectId, 'wf_node', nodeId, 'complete', {
      from: status,
      to: 'completed',
      bvid: input.bvid,
      contentKind: input.contentKind,
      idempotentReplay: true,
    });
    await syncOverallStage(tx, projectId, graph);
    const bundle = await loadPublishBundle(tx, projectId, updated);
    return { ...bundle, idempotentReplay: true };
  }
  assertToken(node.updated_at, input.expectedUpdatedAt);
  const status = asStatus(node.status);
  if (status === 'blocked') refuse(409, 'invalid_transition', '阻塞中的节点要先解除阻塞');
  if (status !== 'in_progress') {
    refuse(409, 'invalid_transition', '只能在发布节点进行中时记录发布');
  }
  const updated = await updateNode(tx, projectId, node, {
    status: 'completed',
    statusBeforeBlock: null,
    primaryBlockItemId: node.primary_block_pinned_item_id,
    clearCompletedAt: false,
  });
  rememberNode(graph, updated);
  const publishedAt = input.publishedAt ?? new Date().toISOString();
  const contentUrl = input.contentKind === 'post' ? input.contentUrl : null;
  await tx`
    INSERT INTO project_publish_records (
      project_id, bvid, published_at, publish_source, idempotency_key,
      platform, content_kind, content_url, external_id
    ) VALUES (
      ${projectId}, ${input.bvid}, ${publishedAt}, ${input.publishSource},
      ${input.idempotencyKey}, ${input.platform}, ${input.contentKind},
      ${contentUrl}, ${input.externalId}
    )
  `;
  let contractId: string | null = null;
  let jobSpecs: { id: string; jobType: MonitorJobType }[] = [];
  if (input.contentKind === 'video') {
    contractId = crypto.randomUUID();
    await tx`
      INSERT INTO project_monitor_contracts (id, project_id, bvid, metadata_task_status)
      VALUES (${contractId}, ${projectId}, ${input.bvid}, 'pending')
    `;
    jobSpecs = [
      { id: crypto.randomUUID(), jobType: 'metadata' },
      { id: crypto.randomUUID(), jobType: 'metrics' },
    ];
    for (const job of jobSpecs) {
      await tx`
        INSERT INTO monitor_jobs (id, project_id, job_type, status)
        VALUES (${job.id}, ${projectId}, ${job.jobType}, 'pending')
      `;
    }
  }
  await audit(tx, projectId, 'wf_node', nodeId, 'complete', {
    from: status,
    to: 'completed',
    bvid: input.bvid,
    contentKind: input.contentKind,
  });
  await audit(tx, projectId, 'project_publish_record', projectId, 'record', {
    platform: input.platform,
    bvid: input.bvid,
    videoUrl: input.videoUrl,
    contentKind: input.contentKind,
    contentUrl,
    externalId: input.externalId,
    idempotencyKey: input.idempotencyKey,
    publishSource: input.publishSource,
  });
  if (contractId !== null) {
    await audit(tx, projectId, 'project_monitor_contract', contractId, 'create', {
      bvid: input.bvid,
      metadataTaskStatus: 'pending',
    });
    for (const job of jobSpecs) {
      await audit(tx, projectId, 'monitor_job', job.id, 'create', {
        jobType: job.jobType,
        status: 'pending',
      });
    }
  }
  // Same transaction as the publish record: keep overall_stage aligned with /step.
  await syncOverallStage(tx, projectId, graph);
  const bundle = await loadPublishBundle(tx, projectId, updated);
  return { ...bundle, idempotentReplay: false };
}

type StepToken = { nodeId: string; expectedUpdatedAt: string };

function assertTokens(graph: Graph, tokens: readonly StepToken[]): void {
  for (const token of tokens) {
    const node = graph.byId.get(token.nodeId);
    if (!node) refuse(404, 'not_found', '节点不存在');
    assertToken(node.updated_at, token.expectedUpdatedAt);
  }
}

async function assertProjectWritable(tx: Tx, projectId: string): Promise<void> {
  const rows = await tx<{ overall_stage: string; archived: boolean; closed: boolean }[]>`
    SELECT
      overall_stage,
      archived_at IS NOT NULL AS archived,
      business_closed_at IS NOT NULL AS closed
    FROM commercial_projects
    WHERE id = ${projectId}
    FOR UPDATE
  `;
  const project = rows[0];
  if (!project) refuse(404, 'not_found', '项目不存在');
  if (project.archived || project.overall_stage === 'archived') {
    refuse(409, 'invalid_transition', '归档项目不能改流程');
  }
  if (project.closed || project.overall_stage === 'closed') {
    refuse(409, 'invalid_transition', '已结案项目不能改流程');
  }
}

async function openBlocksByNode(
  tx: Tx,
  projectId: string,
  graph: Graph,
): Promise<Map<string, { id: string; title: string }>> {
  const rows = await tx<
    { id: string; title: string; blocks_node_id: string | null; workflow_node_id: string | null }[]
  >`
    SELECT id, title, blocks_node_id, workflow_node_id
    FROM open_items
    WHERE project_id = ${projectId} AND lifecycle = 'open' AND impact = 'blocking'
    ORDER BY sort_rank, created_at, id
    FOR UPDATE
  `;
  const byId = new Map(rows.map((row) => [row.id, row]));
  const byNode = new Map<string, { id: string; title: string }>();
  for (const row of rows) {
    const nodeId = row.blocks_node_id ?? row.workflow_node_id;
    if (!nodeId || byNode.has(nodeId)) continue;
    byNode.set(nodeId, { id: row.id, title: row.title });
  }
  for (const node of graph.nodes) {
    const pinned = node.primary_block_pinned_item_id;
    const item = pinned ? byId.get(pinned) : undefined;
    if (item) byNode.set(node.id, { id: item.id, title: item.title });
  }
  return byNode;
}

function toPlanNodes(graph: Graph, blocks: Map<string, { id: string; title: string }>): PlanNode[] {
  return graph.nodes.map((node) => {
    const block = blocks.get(node.id) ?? null;
    const reason = block?.title.trim() ?? '';
    const previous = node.status_before_block;
    return {
      id: node.id,
      name: node.name,
      status: asStatus(node.status),
      kind: asKind(node.kind) === 'merge' ? 'merge' : 'stage',
      templateSlug: node.template_slug,
      statusBeforeBlock: previous && isWfNodeStatus(previous) ? asStatus(previous) : null,
      blockItemId: block?.id ?? null,
      blockingReason: reason.length > 0 ? reason : null,
    };
  });
}

function stageMemberIds(graph: Graph, stageId: string): string[] {
  if (!isProgressStageId(stageId)) return [];
  const slugs = new Set<string>(PROGRESS_STAGE_SLUGS[stageId]);
  return graph.nodes
    .filter((node) => node.kind !== 'merge' && node.template_slug && slugs.has(node.template_slug))
    .map((node) => node.id);
}

function asStepEffects(plan: Extract<StepPlan, { ok: true }>): CommercialStepEffect[] {
  return plan.effects.map((item) => ({
    nodeId: item.nodeId,
    nodeName: item.nodeName,
    from: item.from,
    to: item.to,
  }));
}

function throwIfRefused(plan: StepPlan): asserts plan is Extract<StepPlan, { ok: true }> {
  if (plan.ok) return;
  refuse(plan.code === 'not_found' ? 404 : 409, plan.code, plan.error, plan.names, {
    successors: plan.successors,
  });
}

async function closeConfirmedBlocks(
  tx: Tx,
  projectId: string,
  blocks: readonly CommercialStepBlock[],
): Promise<void> {
  const nodeIds = new Set(blocks.map((block) => block.nodeId));
  const itemIds = new Set(blocks.flatMap((block) => (block.itemId ? [block.itemId] : [])));
  const linked = await tx<
    { id: string; title: string; blocks_node_id: string | null; workflow_node_id: string | null }[]
  >`
    SELECT id, title, blocks_node_id, workflow_node_id
    FROM open_items
    WHERE project_id = ${projectId} AND lifecycle = 'open' AND impact = 'blocking'
    ORDER BY sort_rank, created_at, id
    FOR UPDATE
  `;
  const chosen = new Map<string, { id: string; title: string }>();
  for (const row of linked) {
    const nodeId = row.blocks_node_id ?? row.workflow_node_id;
    if (itemIds.has(row.id) || (nodeId !== null && nodeIds.has(nodeId))) {
      chosen.set(row.id, { id: row.id, title: row.title });
    }
  }
  const conclusion = '强制推进并标记前置完成';
  for (const item of chosen.values()) {
    await tx`
      UPDATE open_items
      SET lifecycle = 'closed',
          closed_at = now(),
          updated_at = now(),
          close_conclusion = ${conclusion}
      WHERE id = ${item.id} AND project_id = ${projectId}
    `;
    await liftPinnedBlocks(tx, projectId, item.id);
    await audit(tx, projectId, 'open_item', item.id, 'close', { closeConclusion: conclusion });
  }
}

function rememberNode(graph: Graph, node: DbNode): void {
  graph.byId.set(node.id, node);
  const index = graph.nodes.findIndex((item) => item.id === node.id);
  if (index >= 0) graph.nodes[index] = node;
}

async function applyEffect(
  tx: Tx,
  projectId: string,
  graph: Graph,
  item: CommercialStepEffect,
): Promise<void> {
  const current = graph.byId.get(item.nodeId);
  if (!current) refuse(404, 'not_found', '节点不存在');
  if (current.status === item.to) return;
  const clearPin = item.from === 'blocked' || item.to === 'completed';
  const updated = await updateNode(tx, projectId, current, {
    status: item.to,
    statusBeforeBlock: null,
    primaryBlockItemId: clearPin ? null : current.primary_block_pinned_item_id,
    clearCompletedAt:
      item.to !== 'completed' && (item.from === 'completed' || item.to === 'not_reached'),
  });
  rememberNode(graph, updated);
  const action =
    item.to === 'completed'
      ? 'complete'
      : item.from === 'blocked'
        ? 'unblock'
        : item.from === 'not_reached' && item.to === 'in_progress'
          ? 'advance'
          : 'rollback';
  await audit(tx, projectId, 'wf_node', item.nodeId, action, {
    from: item.from,
    to: item.to,
    step: true,
  });
}

async function syncOverallStage(tx: Tx, projectId: string, graph: Graph): Promise<OverallStage> {
  const rows = await tx<{ overall_stage: string; archived: boolean; closed: boolean }[]>`
    SELECT
      overall_stage,
      archived_at IS NOT NULL AS archived,
      business_closed_at IS NOT NULL AS closed
    FROM commercial_projects
    WHERE id = ${projectId}
  `;
  const project = rows[0];
  if (!project) refuse(404, 'not_found', '项目不存在');
  if (project.archived || project.overall_stage === 'archived') return 'archived';
  if (project.closed || project.overall_stage === 'closed') return 'closed';
  const records = await tx<{ project_id: string }[]>`
    SELECT project_id FROM project_publish_records WHERE project_id = ${projectId}
  `;
  const publishDone = graph.nodes.some(
    (node) => isPublishNode(node) && node.status === 'completed',
  );
  const next = records[0] || publishDone ? 'published_winding_down' : 'pre_publish';
  if (next !== project.overall_stage) {
    await tx`
      UPDATE commercial_projects
      SET overall_stage = ${next}, stage_entered_at = now(), updated_at = now()
      WHERE id = ${projectId}
    `;
    await audit(tx, projectId, 'commercial_project', projectId, 'overall_stage', {
      from: project.overall_stage,
      to: next,
    });
  }
  if (!isOverallStage(next)) throw new Error(`unexpected overall stage ${next}`);
  return next;
}

async function applyStep(
  tx: Tx,
  projectId: string,
  target: { kind: 'node'; nodeId: string } | { kind: 'stage'; stageId: string },
  direction: 'forward' | 'rollback',
  tokens: readonly StepToken[],
  force: boolean,
  publish: CommercialStepPublish | null,
): Promise<CommercialStepResponse> {
  await requireProject(tx, projectId);
  await assertProjectWritable(tx, projectId);
  let graph = await loadGraph(tx, projectId);
  if (target.kind === 'stage') {
    const members = stageMemberIds(graph, target.stageId);
    const provided = new Set(tokens.map((token) => token.nodeId));
    if (members.some((id) => !provided.has(id))) {
      refuse(400, 'invalid_body', '缺少阶段节点的并发令牌');
    }
  }
  assertTokens(graph, tokens);
  const planNodes = toPlanNodes(graph, await openBlocksByNode(tx, projectId, graph));
  const edges = graph.edges.map((edge) => ({
    fromNodeId: edge.from_node_id,
    toNodeId: edge.to_node_id,
  }));
  const plan =
    target.kind === 'node'
      ? planNodeStep(planNodes, edges, target.nodeId, direction)
      : planStageStep(planNodes, edges, target.stageId, direction);
  throwIfRefused(plan);
  const effects = asStepEffects(plan);
  if (plan.blocks.length > 0 && !force) {
    refuse(
      409,
      'confirmation_required',
      '有开放阻塞，确认后才会强制推进并标记前置完成',
      plan.blocks.map((block) => block.nodeName),
      { blocks: plan.blocks, effects },
    );
  }
  let publishBvid: string | null = null;
  if (plan.publishNodeId) {
    if (!publish) {
      refuse(409, 'publish_required', '完成发布节点必须在同一事务中记录发布信息', undefined, {
        effects,
      });
    }
    if ((publish.contentKind ?? 'video') === 'video') {
      const resolved = resolvePublishBvid({
        bvid: publish.bvid ?? null,
        videoUrl: publish.videoUrl ?? null,
      });
      if (!resolved.ok) {
        refuse(
          400,
          'invalid_body',
          resolved.reason === 'mismatch' ? 'bvid 与链接中的标识不一致' : '链接里没有可用的 bvid',
        );
      }
      publishBvid = resolved.bvid;
    }
  }
  if (plan.blocks.length > 0) {
    await closeConfirmedBlocks(tx, projectId, plan.blocks);
    graph = await loadGraph(tx, projectId);
  }
  for (const item of effects) {
    if (plan.publishNodeId === item.nodeId && item.to === 'completed') continue;
    await applyEffect(tx, projectId, graph, item);
  }
  if (plan.publishNodeId && publish) {
    let publishNodeRow = graph.byId.get(plan.publishNodeId);
    if (!publishNodeRow) refuse(404, 'not_found', '节点不存在');
    if (publishNodeRow.status !== 'in_progress') {
      const from = publishNodeRow.status;
      publishNodeRow = await updateNode(tx, projectId, publishNodeRow, {
        status: 'in_progress',
        statusBeforeBlock: null,
        primaryBlockItemId: null,
        clearCompletedAt: false,
      });
      rememberNode(graph, publishNodeRow);
      await audit(tx, projectId, 'wf_node', publishNodeRow.id, 'advance', {
        from,
        to: 'in_progress',
        step: true,
      });
    }
    await publishNode(tx, projectId, plan.publishNodeId, {
      expectedUpdatedAt: publishNodeRow.updated_at,
      idempotencyKey: publish.idempotencyKey,
      platform: publish.platform,
      contentKind: publish.contentKind ?? 'video',
      bvid: publishBvid,
      videoUrl: publish.videoUrl ?? null,
      contentUrl: publish.contentUrl ?? null,
      externalId: publish.externalId ?? null,
      publishedAt: publish.publishedAt ?? null,
      publishSource: publish.publishSource ?? 'web',
    });
    graph = await loadGraph(tx, projectId);
    const published = graph.byId.get(plan.publishNodeId);
    if (!published || published.status !== 'completed') {
      refuse(409, 'publish_conflict', '发布节点没有完成');
    }
  }
  const overallStage = await syncOverallStage(tx, projectId, graph);
  const changed = new Set(effects.map((item) => item.nodeId));
  return {
    projectId,
    overallStage,
    nodes: graph.nodes.filter((node) => changed.has(node.id)).map((node) => toSnapshot(node)),
  };
}

function invalidBody(c: Context, message: string): Response {
  return c.json(parseCommercialWriteError({ error: message, code: 'invalid_body' }), 400);
}

function mapWriteError(c: Context, err: unknown): Response {
  if (err instanceof CommercialWriteRefusal) {
    return c.json(parseCommercialWriteError(err.body), err.status);
  }
  if (err instanceof postgres.PostgresError && CONSTRAINT_CODES.has(err.code)) {
    const constraint = err.constraint_name ? `（${err.constraint_name}）` : '';
    return c.json(
      parseCommercialWriteError({
        error: `数据库约束拒绝了这次写入${constraint}：${err.message}`,
        code: 'constraint_violation',
      }),
      409,
    );
  }
  console.error(err);
  return c.json({ error: 'internal error' }, 500);
}

async function readBody(c: Context): Promise<unknown | Response> {
  try {
    return await c.req.json();
  } catch {
    return invalidBody(c, '请求体不是 JSON');
  }
}

function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}

export function registerCommercialWriteRoutes(app: Hono, db: Sql): void {
  app.post('/projects/:projectId/nodes/:nodeId/advance', async (c) => {
    const ids = pathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialNodeTokenRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => advanceNode(tx, ids.projectId, ids.nodeId, body.expectedUpdatedAt))
        .then((result) => c.json(parseCommercialNodeWriteResponse(result))),
    );
  });

  app.post('/projects/:projectId/nodes/:nodeId/complete', async (c) => {
    const ids = pathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialNodeTokenRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => completeNode(tx, ids.projectId, ids.nodeId, body.expectedUpdatedAt))
        .then((result) => c.json(parseCommercialNodeWriteResponse(result))),
    );
  });

  app.post('/projects/:projectId/nodes/:nodeId/skip', async (c) => {
    const ids = pathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialNodeTokenRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => skipNode(tx, ids.projectId, ids.nodeId, body.expectedUpdatedAt))
        .then((result) => c.json(parseCommercialNodeWriteResponse(result))),
    );
  });

  app.post('/projects/:projectId/nodes/:nodeId/rollback', async (c) => {
    const ids = pathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialNodeTokenRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => rollbackNode(tx, ids.projectId, ids.nodeId, body.expectedUpdatedAt))
        .then((result) => c.json(parseCommercialNodeWriteResponse(result))),
    );
  });

  app.post('/projects/:projectId/nodes/:nodeId/block', async (c) => {
    const ids = pathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialBlockRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => blockNode(tx, ids.projectId, ids.nodeId, body))
        .then((result) => c.json(parseCommercialNodeWriteResponse(result))),
    );
  });

  app.post('/projects/:projectId/nodes/:nodeId/unblock', async (c) => {
    const ids = pathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialNodeTokenRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => unblockNode(tx, ids.projectId, ids.nodeId, body.expectedUpdatedAt))
        .then((result) => c.json(parseCommercialNodeWriteResponse(result))),
    );
  });

  app.post('/projects/:projectId/nodes/:nodeId/plan', async (c) => {
    const ids = pathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialPlanRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => planNode(tx, ids.projectId, ids.nodeId, body))
        .then((result) => c.json(parseCommercialNodeWriteResponse(result))),
    );
  });

  app.post('/projects/:projectId/nodes/:nodeId/publish', async (c) => {
    const ids = pathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialPublishRequest);
    if (body instanceof Response) return body;
    const contentKind = body.contentKind ?? 'video';
    let bvid: string | null = null;
    if (contentKind === 'video') {
      const resolved = resolvePublishBvid({
        bvid: body.bvid ?? null,
        videoUrl: body.videoUrl ?? null,
      });
      if (!resolved.ok) {
        return invalidBody(
          c,
          resolved.reason === 'mismatch' ? 'bvid 与链接中的标识不一致' : '链接里没有可用的 bvid',
        );
      }
      bvid = resolved.bvid;
    }
    return runWrite(c, () =>
      db
        .begin((tx) =>
          publishNode(tx, ids.projectId, ids.nodeId, {
            expectedUpdatedAt: body.expectedUpdatedAt,
            idempotencyKey: body.idempotencyKey,
            platform: body.platform,
            contentKind,
            bvid,
            videoUrl: body.videoUrl ?? null,
            contentUrl: body.contentUrl ?? null,
            externalId: body.externalId ?? null,
            publishedAt: body.publishedAt ?? null,
            publishSource: body.publishSource ?? 'web',
          }),
        )
        .then((result) => c.json(parseCommercialPublishResponse(result))),
    );
  });

  app.post('/projects/:projectId/nodes/:nodeId/step', async (c) => {
    const ids = pathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialNodeStepRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) =>
          applyStep(
            tx,
            ids.projectId,
            { kind: 'node', nodeId: ids.nodeId },
            body.direction,
            [{ nodeId: ids.nodeId, expectedUpdatedAt: body.expectedUpdatedAt }],
            body.force,
            body.publish,
          ),
        )
        .then((result) => c.json(parseCommercialStepResponse(result))),
    );
  });

  app.post('/projects/:projectId/stages/:stageId/step', async (c) => {
    const projectId = c.req.param('projectId');
    const stageId = c.req.param('stageId');
    if (!isUuid(projectId)) return invalidBody(c, '项目 id 不是 uuid');
    if (!stageId || !isProgressStageId(stageId)) return invalidBody(c, '阶段不存在');
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialStageStepRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) =>
          applyStep(
            tx,
            projectId,
            { kind: 'stage', stageId },
            body.direction,
            body.tokens,
            body.force,
            body.publish,
          ),
        )
        .then((result) => c.json(parseCommercialStepResponse(result))),
    );
  });

  app.post('/projects/:projectId/open-items', async (c) => {
    const projectId = c.req.param('projectId');
    if (!isUuid(projectId)) return invalidBody(c, '项目 id 不是 uuid');
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialOpenItemCreateRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => createItem(tx, projectId, body))
        .then((result) => c.json(parseCommercialOpenItemWriteResponse(result), 201)),
    );
  });

  app.patch('/projects/:projectId/open-items/:itemId', async (c) => {
    const ids = itemPathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialOpenItemUpdateRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => updateItem(tx, ids.projectId, ids.itemId, body))
        .then((result) => c.json(parseCommercialOpenItemWriteResponse(result))),
    );
  });

  app.post('/projects/:projectId/open-items/:itemId/close', async (c) => {
    const ids = itemPathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialCloseItemRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => closeItem(tx, ids.projectId, ids.itemId, body))
        .then((result) => c.json(parseCommercialOpenItemWriteResponse(result))),
    );
  });

  app.post('/projects/:projectId/open-items/:itemId/cancel', async (c) => {
    const ids = itemPathIds(c);
    if (ids instanceof Response) return ids;
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialCancelItemRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => cancelItem(tx, ids.projectId, ids.itemId, body))
        .then((result) => c.json(parseCommercialOpenItemWriteResponse(result))),
    );
  });

  app.patch('/projects/:projectId/workflow/layout', async (c) => {
    const projectId = c.req.param('projectId');
    if (!isUuid(projectId)) return invalidBody(c, '项目 id 不是 uuid');
    const raw = await readBody(c);
    if (isResponse(raw)) return raw;
    const body = parseRequest(c, raw, parseCommercialWorkflowLayoutRequest);
    if (body instanceof Response) return body;
    return runWrite(c, () =>
      db
        .begin((tx) => applyWorkflowLayout(tx, projectId, body))
        .then((result) => c.json(parseCommercialWorkflowLayoutResponse(result))),
    );
  });
}

function parseRequest<T>(c: Context, raw: unknown, parse: (value: unknown) => T): T | Response {
  try {
    return parse(raw);
  } catch (err) {
    return invalidBody(c, messageOf(err));
  }
}

function runWrite(c: Context, fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err: unknown) => mapWriteError(c, err));
}

function pathIds(c: Context): { projectId: string; nodeId: string } | Response {
  const projectId = c.req.param('projectId');
  const nodeId = c.req.param('nodeId');
  if (!isUuid(projectId) || !isUuid(nodeId)) return invalidBody(c, '项目或节点 id 不是 uuid');
  return { projectId, nodeId };
}

function itemPathIds(c: Context): { projectId: string; itemId: string } | Response {
  const projectId = c.req.param('projectId');
  const itemId = c.req.param('itemId');
  if (!isUuid(projectId) || !isUuid(itemId)) return invalidBody(c, '项目或事项 id 不是 uuid');
  return { projectId, itemId };
}

function isUuid(value: string | undefined): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'invalid body';
}
