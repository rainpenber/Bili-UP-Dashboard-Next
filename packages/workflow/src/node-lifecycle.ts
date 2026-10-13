import type { GraphEdge, GraphNode } from './graph-dag';
import { predecessorIds, successorIds } from './graph-dag';

export type WfNode = GraphNode & {
  phase?: 'pre_publish' | 'post_publish_required' | 'post_publish_optional';
  isOptional?: boolean;
};

export function advanceToNode(
  targetId: string,
  nodes: WfNode[],
  edges: GraphEdge[],
): Map<string, { status: string; completedAt?: string | null }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const updates = new Map<string, { status: string; completedAt?: string | null }>();
  const preds = predecessorIds(targetId, edges);
  const completePreds = new Set<string>();
  const predStack = [...preds];
  while (predStack.length) {
    const pid = predStack.pop()!;
    if (completePreds.has(pid)) continue;
    completePreds.add(pid);
    for (const pp of predecessorIds(pid, edges)) predStack.push(pp);
  }
  for (const pid of completePreds) {
    const p = byId.get(pid);
    if (!p) continue;
    if (p.status !== 'completed' && p.status !== 'not_applicable') {
      updates.set(pid, { status: 'completed', completedAt: new Date().toISOString() });
    }
  }

  for (const n of nodes) {
    if (n.id === targetId) continue;
    if (n.status === 'in_progress' && !updates.has(n.id)) {
      const onPath =
        preds.includes(n.id) ||
        successorIds(n.id, edges).some((s) => s === targetId || preds.includes(s));
      if (!onPath) {
        updates.set(n.id, { status: 'not_reached', completedAt: null });
      }
    }
  }

  updates.set(targetId, { status: 'in_progress', completedAt: null });
  return updates;
}

export function completeNode(
  nodeId: string,
  nodes: WfNode[],
  edges: GraphEdge[],
): Map<string, { status: string; completedAt?: string | null }> {
  const updates = new Map<string, { status: string; completedAt?: string | null }>();
  updates.set(nodeId, { status: 'completed', completedAt: new Date().toISOString() });
  void edges;
  void nodes;
  return updates;
}

export function rollbackToNode(
  targetId: string,
  nodes: WfNode[],
  edges: GraphEdge[],
): Map<string, { status: string; completedAt?: string | null }> {
  const downstream = new Set<string>();
  const stack = successorIds(targetId, edges);
  while (stack.length) {
    const id = stack.pop()!;
    if (downstream.has(id)) continue;
    downstream.add(id);
    for (const s of successorIds(id, edges)) stack.push(s);
  }
  const updates = new Map<string, { status: string; completedAt?: string | null }>();
  for (const id of downstream) {
    updates.set(id, { status: 'not_reached', completedAt: null });
  }
  updates.set(targetId, { status: 'in_progress', completedAt: null });
  void nodes;
  return updates;
}

export type NodePhase = 'pre_publish' | 'post_publish_required' | 'post_publish_optional';

export function deriveProjectCloseState(input: {
  published: boolean;
  nodes: Array<{ status: string; phase: NodePhase; isOptional?: boolean }>;
  openItemsBlockingClose: boolean;
}): { overallStage: 'pre_publish' | 'published_winding_down' | 'closed'; businessClosed: boolean } {
  if (!input.published) {
    return { overallStage: 'pre_publish', businessClosed: false };
  }
  const requiredPost = input.nodes.filter(
    (n) => n.phase === 'post_publish_required' && n.status !== 'not_applicable',
  );
  const optionalOther = input.nodes.filter((n) => n.phase === 'post_publish_optional');
  const requiredDone = requiredPost.every((n) => n.status === 'completed');
  const optionalOk = optionalOther.every(
    (n) => n.status === 'completed' || n.status === 'not_applicable',
  );
  const preLeaves = input.nodes.filter(
    (n) =>
      n.phase === 'pre_publish' &&
      n.status !== 'completed' &&
      n.status !== 'not_applicable' &&
      n.status !== 'not_reached',
  );
  if (preLeaves.length > 0) {
    return { overallStage: 'published_winding_down', businessClosed: false };
  }
  if (requiredDone && optionalOk && !input.openItemsBlockingClose) {
    return { overallStage: 'closed', businessClosed: true };
  }
  return { overallStage: 'published_winding_down', businessClosed: false };
}
