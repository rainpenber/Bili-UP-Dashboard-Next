import { isDependencySatisfied } from './node-transitions';
import type { NodeStatus, WorkflowDependency, WorkflowNodeSnapshot } from './types';

export type RecomputeResult = {
  statusUpdates: Map<string, NodeStatus>;
  blockedBy: Map<string, string[]>;
};

const ACTIVE: NodeStatus[] = ['in_progress', 'waiting_external', 'blocked'];

function predsFor(nodeId: string, deps: WorkflowDependency[]): string[] {
  return deps.filter((d) => d.nodeId === nodeId).map((d) => d.dependsOnId);
}

function nodeById(nodes: WorkflowNodeSnapshot[]): Map<string, WorkflowNodeSnapshot> {
  return new Map(nodes.map((n) => [n.id, n]));
}

export function computeBlockedBySet(
  nodes: WorkflowNodeSnapshot[],
  deps: WorkflowDependency[],
): Map<string, string[]> {
  const byId = nodeById(nodes);
  const blockedBy = new Map<string, string[]>();
  for (const node of nodes) {
    const preds = predsFor(node.id, deps);
    const blockedPreds = preds.filter((pid) => {
      const p = byId.get(pid);
      return p?.status === 'blocked';
    });
    if (blockedPreds.length > 0) {
      blockedBy.set(node.id, blockedPreds);
    }
  }
  return blockedBy;
}

export function recomputeAutomaticStatuses(
  nodes: WorkflowNodeSnapshot[],
  deps: WorkflowDependency[],
): Map<string, NodeStatus> {
  const byId = nodeById(nodes);
  const sorted = [...nodes].sort((a, b) => a.sortOrder - b.sortOrder);
  const updates = new Map<string, NodeStatus>();

  for (const node of sorted) {
    const predIds = predsFor(node.id, deps);
    const predStatuses = predIds.map((id) => byId.get(id)?.status ?? 'locked');
    const satisfied = isDependencySatisfied(node.dependencyMode, predStatuses);

    let next = node.status;
    if (!satisfied) {
      if (node.status === 'ready' || node.status === 'locked') {
        next = 'locked';
      }
    } else if (node.status === 'locked') {
      next = 'ready';
    }

    if (next !== node.status) {
      updates.set(node.id, next);
      byId.set(node.id, { ...node, status: next });
    }
  }
  return updates;
}

export function recomputeAfterManualChange(
  nodes: WorkflowNodeSnapshot[],
  deps: WorkflowDependency[],
): RecomputeResult {
  const working = nodes.map((n) => ({ ...n }));
  const statusUpdates = new Map<string, NodeStatus>();
  let changed = true;
  while (changed) {
    changed = false;
    const batch = recomputeAutomaticStatuses(working, deps);
    for (const [id, status] of batch) {
      const idx = working.findIndex((n) => n.id === id);
      if (idx >= 0 && working[idx]!.status !== status) {
        if (ACTIVE.includes(working[idx]!.status) && status === 'locked') {
          continue;
        }
        working[idx] = { ...working[idx]!, status };
        statusUpdates.set(id, status);
        changed = true;
      }
    }
  }
  return {
    statusUpdates,
    blockedBy: computeBlockedBySet(working, deps),
  };
}

export function downstreamNodeIds(startId: string, deps: WorkflowDependency[]): string[] {
  const result = new Set<string>();
  const queue = [startId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const d of deps) {
      if (d.dependsOnId === current && !result.has(d.nodeId)) {
        result.add(d.nodeId);
        queue.push(d.nodeId);
      }
    }
  }
  return [...result];
}
