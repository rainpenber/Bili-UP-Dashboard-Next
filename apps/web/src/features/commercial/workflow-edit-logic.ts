import { buildWorkflowDag, collapseRoutingEdges } from './workflow-graph-flow-layout';
import type { WorkflowGraph, WorkflowGraphNode } from './types';

export const FLOW_START_NODE_ID = 'inq';

export function cloneWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    steps: graph.steps.map((step) =>
      step.kind === 'serial'
        ? { kind: 'serial', node: { ...step.node } }
        : { kind: 'parallel', nodes: step.nodes.map((n) => ({ ...n })) },
    ),
  };
}

export function indexWorkflowNodes(graph: WorkflowGraph): Map<string, WorkflowGraphNode> {
  const map = new Map<string, WorkflowGraphNode>();
  for (const step of graph.steps) {
    if (step.kind === 'serial') map.set(step.node.id, step.node);
    else for (const n of step.nodes) map.set(n.id, n);
  }
  return map;
}

export function workflowPredecessorIds(graph: WorkflowGraph): Map<string, string[]> {
  const { edges } = buildWorkflowDag(graph.steps);
  const collapsed = collapseRoutingEdges(edges);
  const preds = new Map<string, string[]>();
  for (const e of collapsed) {
    if (!preds.has(e.to)) preds.set(e.to, []);
    preds.get(e.to)!.push(e.from);
  }
  return preds;
}

export function predecessorsNotDone(nodeId: string, graph: WorkflowGraph): WorkflowGraphNode[] {
  if (nodeId === FLOW_START_NODE_ID) return [];
  const nodes = indexWorkflowNodes(graph);
  const predMap = workflowPredecessorIds(graph);
  const predIds = predMap.get(nodeId) ?? [];
  return predIds
    .map((id) => nodes.get(id))
    .filter((n): n is WorkflowGraphNode => n != null && n.status !== 'done');
}

function patchNode(
  graph: WorkflowGraph,
  nodeId: string,
  patch: Partial<WorkflowGraphNode>,
  clearKeys?: (keyof WorkflowGraphNode)[],
) {
  for (const step of graph.steps) {
    const target =
      step.kind === 'serial' && step.node.id === nodeId
        ? step.node
        : step.kind === 'parallel'
          ? step.nodes.find((x) => x.id === nodeId)
          : undefined;
    if (!target) continue;
    Object.assign(target, patch);
    for (const key of clearKeys ?? []) {
      delete target[key];
    }
    return;
  }
}

export type WorkflowEditResult =
  { ok: true; graph: WorkflowGraph } | { ok: false; message: string };

export function advanceWorkflowNode(graph: WorkflowGraph, nodeId: string): WorkflowEditResult {
  const next = cloneWorkflowGraph(graph);
  const nodes = indexWorkflowNodes(next);
  const node = nodes.get(nodeId);
  if (!node) return { ok: false, message: '找不到该节点。' };
  if (node.status === 'blocked') {
    return { ok: false, message: '该节点处于阻塞状态，请先解除阻塞再推进。' };
  }
  if (node.status === 'done') {
    return { ok: false, message: '该节点已完成，无法继续推进。' };
  }
  const blockers = predecessorsNotDone(nodeId, next);
  if (blockers.length > 0) {
    const names = blockers.map((b) => b.name).join('、');
    return {
      ok: false,
      message: `须先完成前置节点：${names}（当前未完成）。`,
    };
  }
  if (node.status === 'not_reached') {
    patchNode(next, nodeId, { status: 'in_progress' });
    return { ok: true, graph: next };
  }
  patchNode(next, nodeId, { status: 'done' });
  return { ok: true, graph: next };
}

export function rollbackWorkflowNode(graph: WorkflowGraph, nodeId: string): WorkflowEditResult {
  const next = cloneWorkflowGraph(graph);
  const nodes = indexWorkflowNodes(next);
  const node = nodes.get(nodeId);
  if (!node) return { ok: false, message: '找不到该节点。' };
  if (node.status === 'not_reached') {
    return { ok: false, message: '该节点尚未开始，无法回退。' };
  }
  if (node.status === 'blocked') {
    patchNode(next, nodeId, { status: 'in_progress' }, ['blockingReason']);
    return { ok: true, graph: next };
  }
  if (node.status === 'done') {
    patchNode(next, nodeId, { status: 'in_progress' });
    return { ok: true, graph: next };
  }
  patchNode(next, nodeId, { status: 'not_reached' });
  return { ok: true, graph: next };
}

export function blockWorkflowNode(
  graph: WorkflowGraph,
  nodeId: string,
  reason: string,
): WorkflowEditResult {
  const trimmed = reason.trim();
  if (!trimmed) {
    return { ok: false, message: '阻塞原因不能为空。' };
  }
  const next = cloneWorkflowGraph(graph);
  const nodes = indexWorkflowNodes(next);
  const node = nodes.get(nodeId);
  if (!node) return { ok: false, message: '找不到该节点。' };
  if (node.status !== 'in_progress') {
    return { ok: false, message: '只能标记进行中的节点为阻塞。' };
  }
  patchNode(next, nodeId, { status: 'blocked', blockingReason: trimmed });
  return { ok: true, graph: next };
}

export function clearWorkflowBlock(graph: WorkflowGraph, nodeId: string): WorkflowEditResult {
  const next = cloneWorkflowGraph(graph);
  const nodes = indexWorkflowNodes(next);
  const node = nodes.get(nodeId);
  if (!node) return { ok: false, message: '找不到该节点。' };
  if (node.status !== 'blocked') {
    return { ok: false, message: '该节点当前不是阻塞状态。' };
  }
  patchNode(next, nodeId, { status: 'in_progress' }, ['blockingReason']);
  return { ok: true, graph: next };
}

export interface DerivedWorkflowSummary {
  inProgressNodeNames: string[];
  statusHeadline: string;
  blockingReason?: string;
  mainBlockingItem?: string;
}

export function deriveWorkflowSummary(graph: WorkflowGraph): DerivedWorkflowSummary {
  const nodes = [...indexWorkflowNodes(graph).values()];
  const blocked = nodes.filter((n) => n.status === 'blocked');
  const inProgress = nodes.filter((n) => n.status === 'in_progress');
  if (blocked.length > 0) {
    const first = blocked[0]!;
    const reason = first.blockingReason ?? '';
    return {
      inProgressNodeNames: [...inProgress, ...blocked].map((n) => n.name),
      statusHeadline: first.name,
      ...(reason ? { blockingReason: reason, mainBlockingItem: reason } : {}),
    };
  }
  if (inProgress.length > 0) {
    return {
      inProgressNodeNames: inProgress.map((n) => n.name),
      statusHeadline: inProgress[0]!.name,
    };
  }
  const done = nodes.filter((n) => n.status === 'done');
  if (done.length === nodes.length && nodes.length > 0) {
    return { inProgressNodeNames: [], statusHeadline: '全部完成' };
  }
  return { inProgressNodeNames: [], statusHeadline: '待启动' };
}
