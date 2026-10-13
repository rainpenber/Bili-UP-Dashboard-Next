export type GraphNode = { id: string; status: string; isOptional?: boolean };
export type GraphEdge = { fromId: string; toId: string };

export function detectCycle(nodes: GraphNode[], edges: GraphEdge[]): string | null {
  const ids = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!ids.has(e.fromId) || !ids.has(e.toId)) return 'edge references unknown node';
    if (e.fromId === e.toId) return 'self loop';
  }
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) adj.get(e.fromId)!.push(e.toId);

  const visiting = new Set<string>();
  const done = new Set<string>();
  const dfs = (id: string): boolean => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const next of adj.get(id) ?? []) {
      if (dfs(next)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  };
  for (const n of nodes) {
    if (dfs(n.id)) return 'cycle detected';
  }
  return null;
}

export function predecessorIds(nodeId: string, edges: GraphEdge[]): string[] {
  return edges.filter((e) => e.toId === nodeId).map((e) => e.fromId);
}

export function successorIds(nodeId: string, edges: GraphEdge[]): string[] {
  return edges.filter((e) => e.fromId === nodeId).map((e) => e.toId);
}

export function canCompleteNode(
  nodeId: string,
  nodes: GraphNode[],
  edges: GraphEdge[],
): { ok: true } | { ok: false; reason: string } {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const preds = predecessorIds(nodeId, edges);
  for (const pid of preds) {
    const p = byId.get(pid);
    if (!p) return { ok: false, reason: 'missing predecessor' };
    if (p.status !== 'completed' && p.status !== 'not_applicable') {
      return { ok: false, reason: 'predecessor not complete' };
    }
  }
  return { ok: true };
}

export function downstreamIds(nodeId: string, edges: GraphEdge[]): string[] {
  const out = new Set<string>();
  const stack = [nodeId];
  while (stack.length) {
    const id = stack.pop()!;
    for (const next of successorIds(id, edges)) {
      if (out.has(next)) continue;
      out.add(next);
      stack.push(next);
    }
  }
  return [...out];
}
