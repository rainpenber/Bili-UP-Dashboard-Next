/**
 * One-step plans for a business node or a derived stage.
 * Stages are not stored. Membership is the existing slug map.
 * Merge nodes stay transparent: they are not targets, and a completed
 * merge is rewound only when that keeps the graph legal.
 */

import type { EngineEdge, EngineNodeStatus } from './engine';
import { rollbackTargetStatus } from './engine';

export const PROGRESS_STAGE_IDS = [
  'write_outline',
  'copy_prep',
  'production',
  'client_review',
  'distribution_settlement',
] as const;

export type ProgressStageId = (typeof PROGRESS_STAGE_IDS)[number];

/** Slugs match the project-detail stage map. `manual` has no template row yet. */
export const PROGRESS_STAGE_SLUGS: Record<ProgressStageId, readonly string[]> = {
  write_outline: ['outline'],
  copy_prep: ['copy', 'pre_shoot', 'manual'],
  production: ['a_roll', 'b_roll', 'ai_post'],
  client_review: ['review', 'publish'],
  distribution_settlement: ['distribution', 'settlement', 'data_maint', 'other'],
};

export function isProgressStageId(value: string): value is ProgressStageId {
  return (PROGRESS_STAGE_IDS as readonly string[]).includes(value);
}

export type PlanNode = {
  id: string;
  name: string;
  status: EngineNodeStatus;
  kind: 'stage' | 'merge';
  templateSlug: string | null;
  statusBeforeBlock: EngineNodeStatus | null;
  blockItemId: string | null;
  blockingReason: string | null;
};

export type StepEffect = {
  nodeId: string;
  nodeName: string;
  from: EngineNodeStatus;
  to: EngineNodeStatus;
};

export type StepBlock = {
  nodeId: string;
  nodeName: string;
  reason: string | null;
  itemId: string | null;
};

export type StepSuccessor = {
  nodeId: string;
  nodeName: string;
  templateSlug: string | null;
};

export type StepAction = 'advance' | 'complete' | 'unblock' | 'rollback';

export type StepPlan =
  | {
      ok: true;
      action: StepAction;
      effects: StepEffect[];
      blocks: StepBlock[];
      /** Set when an effect completes the publish node. The caller must record publish info. */
      publishNodeId: string | null;
    }
  | {
      ok: false;
      code: 'invalid_transition' | 'successors_advanced' | 'not_found';
      error: string;
      names: string[];
      successors: StepSuccessor[];
    };

function refusal(
  code: 'invalid_transition' | 'successors_advanced' | 'not_found',
  error: string,
  names: string[] = [],
  successors: StepSuccessor[] = [],
): StepPlan {
  return { ok: false, code, error, names, successors };
}

function isPublish(node: PlanNode): boolean {
  return node.templateSlug === 'publish' || node.name === '发布';
}

function restoredStatus(node: PlanNode): EngineNodeStatus {
  const previous = node.statusBeforeBlock;
  if (previous && previous !== 'blocked') return previous;
  return 'in_progress';
}

function effect(node: PlanNode, to: EngineNodeStatus): StepEffect {
  return { nodeId: node.id, nodeName: node.name, from: node.status, to };
}

function blockOf(node: PlanNode): StepBlock {
  const reason = node.blockingReason?.trim() ?? '';
  return {
    nodeId: node.id,
    nodeName: node.name,
    reason: reason.length > 0 ? reason : null,
    itemId: node.blockItemId,
  };
}

function successorOf(node: PlanNode): StepSuccessor {
  return { nodeId: node.id, nodeName: node.name, templateSlug: node.templateSlug };
}

function needsBlockConfirmation(node: PlanNode): boolean {
  return node.status === 'blocked' || node.blockItemId !== null;
}

export function planNodeStep(
  nodes: readonly PlanNode[],
  edges: readonly EngineEdge[],
  nodeId: string,
  direction: 'forward' | 'rollback',
): StepPlan {
  const graph = indexGraph(nodes, edges);
  const node = graph.byId.get(nodeId);
  if (!node) return refusal('not_found', '节点不存在');
  if (node.kind === 'merge') return refusal('invalid_transition', '汇合节点没有逐步操作');
  if (direction === 'rollback') return planRollback(graph, new Set([node.id]), node);
  return planNodeForward(graph, node);
}

export function planStageStep(
  nodes: readonly PlanNode[],
  edges: readonly EngineEdge[],
  stageId: string,
  direction: 'forward' | 'rollback',
): StepPlan {
  if (!isProgressStageId(stageId)) return refusal('not_found', '阶段不存在');
  const graph = indexGraph(nodes, edges);
  const members = stageMembers(graph, stageId);
  const applicable = members.filter((node) => node.status !== 'not_applicable');
  const level = rollup(members);
  if (direction === 'rollback') return planStageRollback(graph, applicable, level);
  return planStageForward(graph, applicable, level);
}

function planNodeForward(graph: Graph, node: PlanNode): StepPlan {
  if (node.status === 'completed') return refusal('invalid_transition', '节点已完成');
  if (node.status === 'not_applicable') {
    return refusal('invalid_transition', '不适用的节点要先回退到未开始');
  }
  if (node.status === 'blocked') {
    const to = restoredStatus(node);
    const effects = [effect(node, to)];
    return accept(graph, 'unblock', effects, [blockOf(node)]);
  }
  const ancestors = collectUnfinished(graph, [node.id], new Set());
  if (node.status === 'not_reached') {
    const effects = [
      ...ancestors.map((item) => effect(item, 'completed')),
      effect(node, 'in_progress'),
    ];
    return accept(graph, 'advance', effects, blocksOf([...ancestors, node]));
  }
  if (node.status === 'in_progress') {
    const effects = [
      ...ancestors.map((item) => effect(item, 'completed')),
      effect(node, 'completed'),
    ];
    return accept(graph, 'complete', effects, blocksOf([...ancestors, node]));
  }
  return refusal('invalid_transition', '该节点没有可推进的状态');
}

function planStageForward(graph: Graph, applicable: PlanNode[], level: Rollup): StepPlan {
  if (level === 'completed') return refusal('invalid_transition', '阶段已完成');
  const memberIds = new Set(applicable.map((node) => node.id));
  if (level === 'not_reached') {
    const entries = applicable.filter((node) =>
      inStageLinks(graph, node.id, memberIds, 'up').every((predId) => {
        const pred = graph.byId.get(predId);
        return pred?.status === 'completed' || pred?.status === 'not_applicable';
      }),
    );
    const ancestors = collectUnfinished(
      graph,
      entries.map((node) => node.id),
      memberIds,
    );
    const effects = [
      ...ancestors.map((node) => effect(node, 'completed')),
      ...entries.map((node) => effect(node, 'in_progress')),
    ];
    if (entries.length === 0) return refusal('invalid_transition', '这个阶段没有可开始的子节点');
    return accept(graph, 'advance', effects, blocksOf([...ancestors, ...entries]));
  }
  const ancestors = collectUnfinished(
    graph,
    applicable.map((node) => node.id),
    memberIds,
  );
  const finishing = topoMembers(graph, applicable).filter((node) => node.status !== 'completed');
  const effects = [
    ...ancestors.map((node) => effect(node, 'completed')),
    ...finishing.map((node) => effect(node, 'completed')),
  ];
  if (effects.length === 0) return refusal('invalid_transition', '阶段已完成');
  return accept(graph, 'complete', effects, blocksOf([...ancestors, ...applicable]));
}

function planStageRollback(graph: Graph, applicable: PlanNode[], level: Rollup): StepPlan {
  if (level === 'not_reached') return refusal('invalid_transition', '阶段尚未开始');
  if (level === 'blocked') {
    return refusal('invalid_transition', '阶段处于阻塞，请先处理阻塞后再回退');
  }
  const memberIds = new Set(applicable.map((node) => node.id));
  if (level === 'completed') {
    const exits = applicable.filter(
      (node) =>
        node.status === 'completed' && inStageLinks(graph, node.id, memberIds, 'down').length === 0,
    );
    return planRollback(
      graph,
      new Set(exits.map((node) => node.id)),
      null,
      exits.map((node) => effect(node, 'in_progress')),
    );
  }
  const moving = applicable.filter((node) => node.status !== 'not_reached');
  const ordered = topoMembers(graph, applicable)
    .filter((node) => node.status !== 'not_reached')
    .reverse();
  return planRollback(
    graph,
    new Set(moving.map((node) => node.id)),
    null,
    ordered.map((node) => effect(node, 'not_reached')),
  );
}

function planRollback(
  graph: Graph,
  moving: Set<string>,
  single: PlanNode | null,
  preset: StepEffect[] = [],
): StepPlan {
  if (single) {
    const target = rollbackTargetStatus(single.status);
    if (!target) {
      const error =
        single.status === 'blocked' ? '阻塞中的节点要先解除阻塞' : '该节点没有可回退的状态';
      return refusal('invalid_transition', error);
    }
    preset = [effect(single, target)];
  }
  const successors = businessSuccessors(graph, moving);
  if (successors.length > 0) {
    return refusal(
      'successors_advanced',
      `无法回退，后续节点已推进：${successors.map((item) => item.nodeName).join('、')}`,
      successors.map((item) => item.nodeName),
      successors,
    );
  }
  const merges = mergesToRewind(graph, moving).map((node) => effect(node, 'not_reached'));
  const effects = [...merges, ...preset];
  if (effects.length === 0) return refusal('invalid_transition', '没有可回退的节点');
  return accept(graph, 'rollback', effects, []);
}

function accept(
  graph: Graph,
  action: StepAction,
  effects: StepEffect[],
  blocks: StepBlock[],
): StepPlan {
  const seen = new Set<string>();
  const unique = orderEffects(
    graph,
    effects.filter((item) => {
      if (seen.has(item.nodeId)) return false;
      seen.add(item.nodeId);
      return item.from !== item.to;
    }),
  );
  const publish = unique.find(
    (item) => item.to === 'completed' && graph.publishIds.has(item.nodeId),
  );
  return {
    ok: true,
    action,
    effects: unique,
    blocks,
    publishNodeId: publish ? publish.nodeId : null,
  };
}

type Rollup = 'completed' | 'blocked' | 'in_progress' | 'not_reached';

type Graph = {
  byId: Map<string, PlanNode>;
  predecessors: Map<string, string[]>;
  successors: Map<string, string[]>;
  publishIds: Set<string>;
};

function indexGraph(nodes: readonly PlanNode[], edges: readonly EngineEdge[]): Graph {
  const predecessors = new Map<string, string[]>();
  const successors = new Map<string, string[]>();
  for (const edge of edges) {
    push(predecessors, edge.toNodeId, edge.fromNodeId);
    push(successors, edge.fromNodeId, edge.toNodeId);
  }
  return {
    byId: new Map(nodes.map((node) => [node.id, node])),
    predecessors,
    successors,
    publishIds: new Set(nodes.filter((node) => isPublish(node)).map((node) => node.id)),
  };
}

function push(map: Map<string, string[]>, key: string, value: string): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function stageMembers(graph: Graph, stageId: ProgressStageId): PlanNode[] {
  const slugs = new Set(PROGRESS_STAGE_SLUGS[stageId]);
  const members: PlanNode[] = [];
  for (const node of graph.byId.values()) {
    if (node.kind === 'merge') continue;
    if (!node.templateSlug || !slugs.has(node.templateSlug)) continue;
    members.push(node);
  }
  return members;
}

function rollup(members: readonly PlanNode[]): Rollup {
  if (members.some((node) => node.status === 'blocked')) return 'blocked';
  if (members.length === 0) return 'not_reached';
  const applicable = members.filter((node) => node.status !== 'not_applicable');
  if (applicable.length === 0) return 'completed';
  if (applicable.every((node) => node.status === 'completed')) return 'completed';
  if (applicable.every((node) => node.status === 'not_reached')) return 'not_reached';
  return 'in_progress';
}

/** Unfinished nodes on paths into `roots`, skipping `skipIds` and completed / not_applicable. */
function collectUnfinished(
  graph: Graph,
  roots: readonly string[],
  skipIds: Set<string>,
): PlanNode[] {
  const ordered: PlanNode[] = [];
  const queued = new Set<string>();
  const visiting = new Set<string>();
  const walk = (id: string) => {
    if (visiting.has(id)) return;
    visiting.add(id);
    for (const predId of graph.predecessors.get(id) ?? []) {
      walk(predId);
      if (skipIds.has(predId) || queued.has(predId)) continue;
      const pred = graph.byId.get(predId);
      if (!pred) continue;
      if (pred.status === 'completed' || pred.status === 'not_applicable') continue;
      queued.add(pred.id);
      ordered.push(pred);
    }
    visiting.delete(id);
  };
  for (const root of roots) walk(root);
  return ordered;
}

/**
 * Other stage members reachable through merge, not_applicable, or business
 * nodes that belong to a different stage. A path A → outside → B is still a
 * dependency between A and B.
 */
function inStageLinks(
  graph: Graph,
  id: string,
  memberIds: Set<string>,
  way: 'up' | 'down',
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const next = way === 'up' ? graph.predecessors : graph.successors;
  const walk = (current: string) => {
    for (const otherId of next.get(current) ?? []) {
      if (seen.has(otherId)) continue;
      seen.add(otherId);
      const other = graph.byId.get(otherId);
      if (!other) continue;
      if (memberIds.has(otherId)) {
        found.push(otherId);
        continue;
      }
      walk(otherId);
    }
  };
  walk(id);
  return found;
}

function orderEffects(graph: Graph, effects: StepEffect[]): StepEffect[] {
  const byId = new Map(effects.map((item) => [item.nodeId, item]));
  const ordered: StepEffect[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id) || !byId.has(id)) return;
    seen.add(id);
    for (const predId of graph.predecessors.get(id) ?? []) walk(predId);
    const item = byId.get(id);
    if (item) ordered.push(item);
  };
  for (const item of effects) walk(item.nodeId);
  return ordered;
}

function topoMembers(graph: Graph, members: readonly PlanNode[]): PlanNode[] {
  const ids = new Set(members.map((node) => node.id));
  const ordered: PlanNode[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const predId of inStageLinks(graph, id, ids, 'up')) walk(predId);
    const node = graph.byId.get(id);
    if (node) ordered.push(node);
  };
  for (const member of members) walk(member.id);
  return ordered;
}

function businessSuccessors(graph: Graph, moving: Set<string>): StepSuccessor[] {
  const found: StepSuccessor[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    for (const succId of graph.successors.get(id) ?? []) {
      if (moving.has(succId) || seen.has(succId)) continue;
      const succ = graph.byId.get(succId);
      if (!succ || succ.status === 'not_reached') continue;
      if (
        succ.status === 'not_applicable' ||
        (succ.kind === 'merge' && succ.status !== 'blocked')
      ) {
        seen.add(succId);
        walk(succId);
        continue;
      }
      seen.add(succId);
      found.push(successorOf(succ));
    }
  };
  for (const id of moving) walk(id);
  return found;
}

function mergesToRewind(graph: Graph, moving: Set<string>): PlanNode[] {
  const found: PlanNode[] = [];
  const seen = new Set<string>();
  const walk = (id: string) => {
    for (const succId of graph.successors.get(id) ?? []) {
      if (moving.has(succId) || seen.has(succId)) continue;
      const succ = graph.byId.get(succId);
      if (!succ || succ.kind !== 'merge') continue;
      if (
        succ.status === 'not_reached' ||
        succ.status === 'blocked' ||
        succ.status === 'not_applicable'
      ) {
        continue;
      }
      seen.add(succId);
      walk(succId);
      found.push(succ);
    }
  };
  for (const id of moving) walk(id);
  return found;
}

function blocksOf(nodes: readonly PlanNode[]): StepBlock[] {
  const seen = new Set<string>();
  const blocks: StepBlock[] = [];
  for (const node of nodes) {
    if (!needsBlockConfirmation(node) || seen.has(node.id)) continue;
    seen.add(node.id);
    blocks.push(blockOf(node));
  }
  return blocks;
}
