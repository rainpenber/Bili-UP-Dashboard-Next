/**
 * Commercial workflow rules (WP-004R2-3A). Pure functions: no I/O.
 * Stage nodes share one predecessor and rollback path. A merge node is not
 * operated: it is satisfied exactly when its predecessors are, and that derived
 * status is what successors see.
 */

export const ENGINE_NODE_STATUSES = [
  'not_reached',
  'in_progress',
  'completed',
  'blocked',
  'not_applicable',
] as const;

export type EngineNodeStatus = (typeof ENGINE_NODE_STATUSES)[number];

export type EngineNodeKind = 'stage' | 'merge';

export type EngineNode = {
  id: string;
  name: string;
  status: EngineNodeStatus;
  /** Absent means stage. Only `merge` changes predecessor and successor rules. */
  kind?: EngineNodeKind;
};

export type PredecessorCompletionStep = {
  id: string;
  name: string;
  /** Status to act on: not_reached is advanced then completed; in_progress is completed. */
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

function indexSuccessors(edges: readonly EngineEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const edge of edges) {
    const list = map.get(edge.fromNodeId);
    if (list) list.push(edge.toNodeId);
    else map.set(edge.fromNodeId, [edge.toNodeId]);
  }
  return map;
}

function isMerge(node: EngineNode): boolean {
  return node.kind === 'merge';
}

/**
 * A merge node is satisfied when every direct predecessor is satisfied.
 * not_applicable is transparent, and a merge predecessor is satisfied by the
 * same rule rather than by its stored status.
 */
function mergeSatisfied(
  nodeId: string,
  byId: ReadonlyMap<string, EngineNode>,
  predecessors: ReadonlyMap<string, readonly string[]>,
  stack: Set<string>,
): boolean {
  if (stack.has(nodeId)) return false;
  stack.add(nodeId);
  const incoming = predecessors.get(nodeId) ?? [];
  const ok = incoming.every((predId) => predecessorSatisfied(predId, byId, predecessors, stack));
  stack.delete(nodeId);
  return ok;
}

function predecessorSatisfied(
  nodeId: string,
  byId: ReadonlyMap<string, EngineNode>,
  predecessors: ReadonlyMap<string, readonly string[]>,
  stack: Set<string>,
): boolean {
  const node = byId.get(nodeId);
  if (!node) return false;
  if (isMerge(node)) return mergeSatisfied(nodeId, byId, predecessors, stack);
  if (node.status === 'completed') return true;
  if (node.status === 'not_applicable') {
    const incoming = predecessors.get(nodeId) ?? [];
    if (incoming.length === 0) return true;
    return incoming.every((predId) => predecessorSatisfied(predId, byId, predecessors, stack));
  }
  return false;
}

/** Stored status a merge node should have. Waiting stays not_reached; satisfied is completed. */
export function derivedMergeStatus(
  nodeId: string,
  nodes: readonly EngineNode[],
  edges: readonly EngineEdge[],
): 'completed' | 'not_reached' {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const predecessors = indexPredecessors(edges);
  return mergeSatisfied(nodeId, byId, predecessors, new Set()) ? 'completed' : 'not_reached';
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
      if (!isMerge(pred) && pred.status === 'completed') continue;
      if (pred.status === 'not_applicable' || isMerge(pred)) {
        if (isMerge(pred) && mergeSatisfied(pred.id, byId, predecessors, new Set())) continue;
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

/**
 * Successors that are no longer not_reached.
 * A merge successor is not itself "advanced": the nodes after it are checked instead,
 * so rolling a predecessor back can return the merge to waiting while a moved
 * downstream stage still blocks the rollback.
 */
export function blockingSuccessorNames(
  nodeId: string,
  nodes: readonly EngineNode[],
  edges: readonly EngineEdge[],
): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const successors = indexSuccessors(edges);
  const seen = new Set<string>();
  const names: string[] = [];

  const visit = (id: string) => {
    for (const succId of successors.get(id) ?? []) {
      const successor = byId.get(succId);
      if (!successor || seen.has(successor.id)) continue;
      seen.add(successor.id);
      if (isMerge(successor)) {
        visit(successor.id);
        continue;
      }
      if (successor.status === 'not_reached') continue;
      names.push(successor.name);
    }
  };

  visit(nodeId);
  return names;
}

/**
 * Unfinished stage nodes that must be advanced and completed before `targetId`
 * can advance. Upstream nodes come first so each advance sees its own
 * predecessors already satisfied. Merge nodes are omitted; their status is derived.
 */
export function predecessorCompletionPlan(
  targetId: string,
  nodes: readonly EngineNode[],
  edges: readonly EngineEdge[],
): PredecessorCompletionStep[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const predecessors = indexPredecessors(edges);
  const seen = new Set<string>();
  const steps: PredecessorCompletionStep[] = [];

  const walk = (id: string) => {
    if (seen.has(id)) return;
    const node = byId.get(id);
    if (!node) return;
    seen.add(id);
    if (isMerge(node) || node.status === 'not_applicable') {
      for (const predId of predecessors.get(id) ?? []) walk(predId);
      return;
    }
    if (node.status === 'completed') return;
    for (const predId of predecessors.get(id) ?? []) walk(predId);
    steps.push({ id: node.id, name: node.name, status: node.status });
  };

  for (const predId of predecessors.get(targetId) ?? []) walk(predId);
  return steps;
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
