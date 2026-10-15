import { buildWorkflowDag, collapseRoutingEdges } from './workflow-graph-flow-layout';
import type { WorkflowConnection, WorkflowGraph, WorkflowGraphNode } from './types';
import {
  cloneWorkflowGraph,
  indexWorkflowNodes,
  type WorkflowEditResult,
} from './workflow-edit-logic';

export type StructureDeletePreview = {
  nodeId: string;
  nodeName: string;
  connections: Array<{ from: string; to: string; fromName: string; toName: string }>;
};

export type StructureDeleteAttempt =
  | { status: 'applied'; graph: WorkflowGraph }
  | { status: 'needs_confirmation'; preview: StructureDeletePreview }
  | { status: 'rejected'; message: string };

export function listWorkflowConnections(graph: WorkflowGraph): WorkflowConnection[] {
  if (graph.connections) {
    return graph.connections.map((c) => ({ from: c.from, to: c.to }));
  }
  const { edges } = buildWorkflowDag(graph.steps);
  return collapseRoutingEdges(edges);
}

export function materializeWorkflowConnections(graph: WorkflowGraph): WorkflowGraph {
  const next = cloneWorkflowGraph(graph);
  next.connections = listWorkflowConnections(graph);
  return next;
}

function withMaterializedConnections(graph: WorkflowGraph): WorkflowGraph {
  if (graph.connections) return cloneWorkflowGraph(graph);
  return materializeWorkflowConnections(graph);
}

function wouldCreateCycle(connections: WorkflowConnection[], from: string, to: string): boolean {
  if (from === to) return true;
  const outgoing = new Map<string, string[]>();
  for (const c of connections) {
    if (!outgoing.has(c.from)) outgoing.set(c.from, []);
    outgoing.get(c.from)!.push(c.to);
  }
  // Walk from `to`; if we can reach `from`, adding from→to creates a cycle.
  const stack = [to];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur === from) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of outgoing.get(cur) ?? []) {
      stack.push(next);
    }
  }
  return false;
}

function findNodeNameConflict(graph: WorkflowGraph, name: string, exceptId?: string): boolean {
  const trimmed = name.trim();
  for (const node of indexWorkflowNodes(graph).values()) {
    if (exceptId && node.id === exceptId) continue;
    if (node.name.trim() === trimmed) return true;
  }
  return false;
}

function appendSerialNode(graph: WorkflowGraph, node: WorkflowGraphNode): void {
  graph.steps.push({ kind: 'serial', node });
}

function removeNodeFromSteps(graph: WorkflowGraph, nodeId: string): boolean {
  let removed = false;
  const nextSteps = [];
  for (const step of graph.steps) {
    if (step.kind === 'serial') {
      if (step.node.id === nodeId) {
        removed = true;
        continue;
      }
      nextSteps.push(step);
    } else {
      const nodes = step.nodes.filter((n) => n.id !== nodeId);
      if (nodes.length !== step.nodes.length) removed = true;
      if (nodes.length === 0) continue;
      if (nodes.length === 1) {
        nextSteps.push({ kind: 'serial' as const, node: nodes[0]! });
      } else {
        nextSteps.push({ kind: 'parallel' as const, nodes });
      }
    }
  }
  graph.steps = nextSteps;
  return removed;
}

function nextCustomNodeId(graph: WorkflowGraph): string {
  const ids = indexWorkflowNodes(graph);
  let i = 1;
  while (ids.has(`custom-${i}`)) i += 1;
  return `custom-${i}`;
}

export function addWorkflowNode(graph: WorkflowGraph, name: string): WorkflowEditResult {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, message: '节点名称不能为空。' };
  }
  if (findNodeNameConflict(graph, trimmed)) {
    return { ok: false, message: `节点名称「${trimmed}」已存在，同一流程内名称必须唯一。` };
  }

  // Adding a node is a single structural change: no silent auto-connections to leaves.
  const next = withMaterializedConnections(graph);
  const id = nextCustomNodeId(next);
  const node: WorkflowGraphNode = { id, name: trimmed, status: 'not_reached' };
  appendSerialNode(next, node);
  return { ok: true, graph: next };
}

export function attemptDeleteWorkflowNode(
  graph: WorkflowGraph,
  nodeId: string,
): StructureDeleteAttempt {
  const nodes = indexWorkflowNodes(graph);
  const node = nodes.get(nodeId);
  if (!node) return { status: 'rejected', message: '找不到该节点。' };

  const connections = listWorkflowConnections(graph);
  const involved = connections.filter((c) => c.from === nodeId || c.to === nodeId);
  if (involved.length > 0) {
    return {
      status: 'needs_confirmation',
      preview: {
        nodeId,
        nodeName: node.name,
        connections: involved.map((c) => ({
          from: c.from,
          to: c.to,
          fromName: nodes.get(c.from)?.name ?? c.from,
          toName: nodes.get(c.to)?.name ?? c.to,
        })),
      },
    };
  }

  const next = withMaterializedConnections(graph);
  if (!removeNodeFromSteps(next, nodeId)) {
    return { status: 'rejected', message: '找不到该节点。' };
  }
  next.connections = (next.connections ?? []).filter((c) => c.from !== nodeId && c.to !== nodeId);
  return { status: 'applied', graph: next };
}

export function confirmDeleteWorkflowNode(
  graph: WorkflowGraph,
  nodeId: string,
): WorkflowEditResult {
  const nodes = indexWorkflowNodes(graph);
  if (!nodes.has(nodeId)) return { ok: false, message: '找不到该节点。' };

  const next = withMaterializedConnections(graph);
  if (!removeNodeFromSteps(next, nodeId)) {
    return { ok: false, message: '找不到该节点。' };
  }
  next.connections = (next.connections ?? []).filter((c) => c.from !== nodeId && c.to !== nodeId);
  return { ok: true, graph: next };
}

export function connectWorkflowNodes(
  graph: WorkflowGraph,
  fromId: string,
  toId: string,
): WorkflowEditResult {
  const nodes = indexWorkflowNodes(graph);
  const from = nodes.get(fromId);
  const to = nodes.get(toId);
  if (!from || !to) {
    return { ok: false, message: '找不到要连接的节点。' };
  }
  if (fromId === toId) {
    return { ok: false, message: '不能将节点连接到自身。' };
  }

  const next = withMaterializedConnections(graph);
  const existing = next.connections!;
  if (existing.some((c) => c.from === fromId && c.to === toId)) {
    return { ok: false, message: `连接「${from.name} → ${to.name}」已存在。` };
  }
  if (wouldCreateCycle(existing, fromId, toId)) {
    return {
      ok: false,
      message: `无法连接「${from.name} → ${to.name}」：会在流程中形成环路。`,
    };
  }
  existing.push({ from: fromId, to: toId });
  return { ok: true, graph: next };
}

export function disconnectWorkflowNodes(
  graph: WorkflowGraph,
  fromId: string,
  toId: string,
): WorkflowEditResult {
  const nodes = indexWorkflowNodes(graph);
  const from = nodes.get(fromId);
  const to = nodes.get(toId);
  if (!from || !to) {
    return { ok: false, message: '找不到要断开的节点。' };
  }

  const next = withMaterializedConnections(graph);
  const before = next.connections!.length;
  next.connections = next.connections!.filter((c) => !(c.from === fromId && c.to === toId));
  if (next.connections.length === before) {
    return {
      ok: false,
      message: `不存在连接「${from.name} → ${to.name}」，无法断开。`,
    };
  }
  return { ok: true, graph: next };
}

export function renameWorkflowNode(
  graph: WorkflowGraph,
  nodeId: string,
  name: string,
): WorkflowEditResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: '节点名称不能为空。' };
  if (findNodeNameConflict(graph, trimmed, nodeId)) {
    return { ok: false, message: `节点名称「${trimmed}」已存在，同一流程内名称必须唯一。` };
  }
  const next = cloneWorkflowGraph(graph);
  const nodes = indexWorkflowNodes(next);
  const node = nodes.get(nodeId);
  if (!node) return { ok: false, message: '找不到该节点。' };
  node.name = trimmed;
  return { ok: true, graph: next };
}
