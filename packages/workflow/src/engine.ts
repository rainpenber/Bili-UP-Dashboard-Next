/**
 * Commercial workflow rules (WP-004R2-3A). Pure functions: no I/O.
 * Every node uses the same predecessor and rollback rules. Node kind is not
 * an input, so no node type can take a different path.
 */

export const ENGINE_NODE_STATUSES = [
  'not_reached',
  'in_progress',
  'completed',
  'blocked',
  'not_applicable',
] as const;

export type EngineNodeStatus = (typeof ENGINE_NODE_STATUSES)[number];

export type EngineNode = {
  id: string;
  name: string;
  status: EngineNodeStatus;
};

export type EngineEdge = {
  fromNodeId: string;
  toNodeId: string;
};

const PREDECESSOR_REFUSAL_PREFIX = '须先完成前置节点：';
const SUCCESSOR_REFUSAL_PREFIX = '无法回退，后续节点已推进：';

function indexPredecessors(edges: readonly EngineEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.toNodeId);
    if (list) list.push(edge.fromNodeId);
    else map.set(edge.toNodeId, [edge.fromNodeId]);
  }
  return map;
}

/**
 * Names of predecessors that still block entering in_progress.
 * A not_applicable predecessor is replaced by its own predecessors, recursively,
 * so a skipped node neither blocks nor short-circuits the nodes downstream of it.
 * Edge order is preserved; the first occurrence of a node wins.
 */
export function blockingPredecessorNames(
  nodeId: string,
  nodes: readonly EngineNode[],
  edges: readonly EngineEdge[],
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const predecessors = indexPredecessors(edges);
  const emitted = new Set<string>();
  const names: string[] = [];

  const visit = (id: string, stack: Set<string>) => {
    if (stack.has(id)) return;
    stack.add(id);
    for (const predId of predecessors.get(id) ?? []) {
      const pred = byId.get(predId);
      if (!pred || emitted.has(pred.id)) continue;
      if (pred.status === 'completed') continue;
      if (pred.status === 'not_applicable') {
        visit(pred.id, stack);
        continue;
      }
      emitted.add(pred.id);
      names.push(pred.name);
    }
    stack.delete(id);
  };

  visit(nodeId, new Set());
  return names;
}

/** Direct successors that are no longer not_reached. No skip passthrough. */
export function blockingSuccessorNames(
  nodeId: string,
  nodes: readonly EngineNode[],
  edges: readonly EngineEdge[],
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const names: string[] = [];
  for (const edge of edges) {
    if (edge.fromNodeId !== nodeId) continue;
    const successor = byId.get(edge.toNodeId);
    if (!successor || seen.has(successor.id)) continue;
    seen.add(successor.id);
    if (successor.status === 'not_reached') continue;
    names.push(successor.name);
  }
  return names;
}

export function predecessorRefusalMessage(names: readonly string[]): string {
  return `${PREDECESSOR_REFUSAL_PREFIX}${names.join('、')}`;
}

export function successorRefusalMessage(names: readonly string[]): string {
  return `${SUCCESSOR_REFUSAL_PREFIX}${names.join('、')}`;
}

/** One step backward. Clearing not_applicable lands on not_reached. */
export function rollbackTargetStatus(status: EngineNodeStatus): EngineNodeStatus | null {
  if (status === 'completed') return 'in_progress';
  if (status === 'in_progress') return 'not_reached';
  if (status === 'not_applicable') return 'not_reached';
  return null;
}

/** Blank reasons are absent. They must not become an empty open-item title. */
export function normalizeBlockReason(reason: string | null | undefined): string | null {
  if (reason == null) return null;
  const trimmed = reason.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * not_applicable may not carry a primary block item.
 * Returns the refusal message, or null when the marker may be applied.
 * Whether the node is optional is a database check, not this function.
 */
export function notApplicableBlockRefusal(hasPrimaryBlockItem: boolean): string | null {
  if (!hasPrimaryBlockItem) return null;
  return '不适用节点不能挂主阻塞事项';
}

const BV_ID = /BV[0-9A-Za-z]+/;

export type PublishBvidResolution =
  { ok: true; bvid: string } | { ok: false; reason: 'missing' | 'mismatch' };

/** Monitoring stores bvid. A video URL is accepted only as a carrier of that id. */
export function resolvePublishBvid(input: {
  bvid?: string | null;
  videoUrl?: string | null;
}): PublishBvidResolution {
  const explicit = input.bvid?.trim() ?? '';
  const url = input.videoUrl?.trim() ?? '';
  const fromUrl = url.length > 0 ? (url.match(BV_ID)?.[0] ?? '') : '';
  if (explicit.length > 0 && fromUrl.length > 0 && explicit !== fromUrl) {
    return { ok: false, reason: 'mismatch' };
  }
  const bvid = explicit || fromUrl;
  if (bvid.length === 0) return { ok: false, reason: 'missing' };
  return { ok: true, bvid };
}
