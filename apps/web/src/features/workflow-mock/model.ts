export type NodeKind = 'stage' | 'merge';

export type FlowNode = {
  id: string;
  name: string;
  kind: NodeKind;
  x: number;
  y: number;
};

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
};

export type FlowGraph = {
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type VersionId = 'v1' | 'v2' | 'v3';

export type FlowVersion = {
  id: VersionId;
  label: 'V1' | 'V2' | 'V3';
  graph: FlowGraph;
};

export type GraphResult = { ok: true; graph: FlowGraph } | { ok: false; message: string };

export const STAGE_W = 168;
export const STAGE_H = 40;
export const JUNCTION_SIZE = 10;

export const copy = {
  needName: '需要名称',
  exists: (name: string) => `「${name}」已存在`,
  self: '不能连自己',
  duplicateEdge: '已经连上',
  cycle: '会成环',
  missing: '没有这个节点',
} as const;

const MAX_HISTORY = 50;

export type HistoryState = {
  past: FlowGraph[];
  present: FlowGraph;
  future: FlowGraph[];
};

export function cloneGraph(graph: FlowGraph): FlowGraph {
  return {
    nodes: graph.nodes.map((node) => ({ ...node })),
    edges: graph.edges.map((edge) => ({ ...edge })),
  };
}

function stage(id: string, name: string): FlowNode {
  return { id, name, kind: 'stage', x: 0, y: 0 };
}

function merge(id: string): FlowNode {
  return { id, name: '', kind: 'merge', x: 0, y: 0 };
}

function edge(source: string, target: string): FlowEdge {
  return { id: `e-${source}-${target}`, source, target };
}

function baseGraph(): FlowGraph {
  return {
    nodes: [
      stage('inq', '询单'),
      stage('outline', '大纲'),
      stage('script', '文案'),
      stage('pre', '预拍摄'),
      merge('merge-prep'),
      stage('ar', 'A-roll 拍摄'),
      stage('br', 'B-roll 素材'),
      stage('ai', 'AI 后期'),
      stage('rev', '审核'),
      stage('pub', '发布'),
      merge('merge-pub'),
      stage('settle', '结算'),
      stage('dist', '全平台分发'),
      stage('care', '数据维护'),
      stage('other', '其他'),
    ],
    edges: [
      edge('inq', 'outline'),
      edge('outline', 'script'),
      edge('outline', 'pre'),
      edge('script', 'merge-prep'),
      edge('pre', 'merge-prep'),
      edge('merge-prep', 'ar'),
      edge('merge-prep', 'br'),
      edge('merge-prep', 'ai'),
      edge('ar', 'rev'),
      edge('br', 'rev'),
      edge('ai', 'rev'),
      edge('rev', 'pub'),
      edge('pub', 'merge-pub'),
      edge('merge-pub', 'settle'),
      edge('merge-pub', 'dist'),
      edge('merge-pub', 'care'),
      edge('merge-pub', 'other'),
    ],
  };
}

function withoutNode(graph: FlowGraph, id: string): FlowGraph {
  return {
    nodes: graph.nodes.filter((node) => node.id !== id),
    edges: graph.edges.filter((item) => item.source !== id && item.target !== id),
  };
}

function versionTwo(base: FlowGraph): FlowGraph {
  return {
    nodes: [
      ...base.nodes.flatMap((node) =>
        node.id === 'pub' ? [stage('sample', '样片'), node] : [node],
      ),
    ],
    edges: base.edges.flatMap((item) =>
      item.source === 'rev' && item.target === 'pub'
        ? [edge('rev', 'sample'), edge('sample', 'pub')]
        : [item],
    ),
  };
}

function versionThree(base: FlowGraph): FlowGraph {
  const trimmed = withoutNode(withoutNode(base, 'ai'), 'other');
  return {
    nodes: [
      ...trimmed.nodes.flatMap((node) =>
        node.id === 'ar' ? [node, stage('out', '外拍')] : [node],
      ),
    ],
    edges: [...trimmed.edges, edge('merge-prep', 'out'), edge('out', 'rev')],
  };
}

export function buildMockVersions(layout: (graph: FlowGraph) => FlowGraph): FlowVersion[] {
  const v1 = cloneGraph(baseGraph());
  return [
    { id: 'v1', label: 'V1', graph: layout(v1) },
    { id: 'v2', label: 'V2', graph: layout(versionTwo(v1)) },
    { id: 'v3', label: 'V3', graph: layout(versionThree(v1)) },
  ];
}

function nodeById(graph: FlowGraph, id: string): FlowNode | undefined {
  return graph.nodes.find((node) => node.id === id);
}

function reaches(graph: FlowGraph, start: string, goal: string): boolean {
  const next = new Map<string, string[]>();
  for (const item of graph.edges) {
    const list = next.get(item.source) ?? [];
    list.push(item.target);
    next.set(item.source, list);
  }
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length > 0) {
    const id = stack.pop();
    if (!id || seen.has(id)) continue;
    if (id === goal) return true;
    seen.add(id);
    for (const target of next.get(id) ?? []) stack.push(target);
  }
  return false;
}

export function connectNodes(graph: FlowGraph, source: string, target: string): GraphResult {
  const from = nodeById(graph, source);
  const to = nodeById(graph, target);
  if (!from || !to || from.kind === 'merge' || to.kind === 'merge') {
    return { ok: false, message: copy.missing };
  }
  if (source === target) return { ok: false, message: copy.self };
  if (graph.edges.some((item) => item.source === source && item.target === target)) {
    return { ok: false, message: copy.duplicateEdge };
  }
  if (reaches(graph, target, source)) return { ok: false, message: copy.cycle };
  return {
    ok: true,
    graph: { ...graph, edges: [...graph.edges, edge(source, target)] },
  };
}

function nextCustomId(graph: FlowGraph): string {
  const ids = new Set(graph.nodes.map((node) => node.id));
  let i = 1;
  while (ids.has(`custom-${i}`)) i += 1;
  return `custom-${i}`;
}

export function addStageNode(
  graph: FlowGraph,
  name: string,
  at?: { x: number; y: number },
): GraphResult {
  const trimmed = name.trim();
  if (!trimmed) return { ok: false, message: copy.needName };
  if (graph.nodes.some((node) => node.kind === 'stage' && node.name === trimmed)) {
    return { ok: false, message: copy.exists(trimmed) };
  }
  const stages = graph.nodes.filter((node) => node.kind === 'stage');
  const fallbackX = stages.reduce((max, node) => Math.max(max, node.x), 0) + STAGE_W + 72;
  const fallbackY =
    stages.length > 0 ? stages.reduce((sum, node) => sum + node.y, 0) / stages.length : 0;
  let x = at ? at.x - STAGE_W / 2 : fallbackX;
  let y = at ? at.y - STAGE_H / 2 : fallbackY;
  for (let step = 0; step < 12; step += 1) {
    const blocked = graph.nodes.some(
      (node) =>
        node.kind === 'stage' &&
        Math.abs(node.x - x) < STAGE_W - 8 &&
        Math.abs(node.y - y) < STAGE_H + 12,
    );
    if (!blocked) break;
    x += 40;
    y += 52;
  }
  return {
    ok: true,
    graph: {
      ...graph,
      nodes: [...graph.nodes, { id: nextCustomId(graph), name: trimmed, kind: 'stage', x, y }],
    },
  };
}

export function removeElements(graph: FlowGraph, nodeIds: string[], edgeIds: string[]): FlowGraph {
  const dropNodes = new Set(nodeIds.filter((id) => nodeById(graph, id)?.kind === 'stage'));
  const dropEdges = new Set(edgeIds);
  return {
    nodes: graph.nodes.filter((node) => !dropNodes.has(node.id)),
    edges: graph.edges.filter(
      (item) =>
        !dropEdges.has(item.id) && !dropNodes.has(item.source) && !dropNodes.has(item.target),
    ),
  };
}

export function applyPositions(
  graph: FlowGraph,
  positions: Map<string, { x: number; y: number }>,
): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const next = positions.get(node.id);
      if (!next) return node;
      return { ...node, x: next.x, y: next.y };
    }),
  };
}

function sameGraph(a: FlowGraph, b: FlowGraph): boolean {
  if (a.nodes.length !== b.nodes.length || a.edges.length !== b.edges.length) return false;
  const nodes = new Map(b.nodes.map((node) => [node.id, node]));
  for (const node of a.nodes) {
    const other = nodes.get(node.id);
    if (!other || other.name !== node.name || other.x !== node.x || other.y !== node.y)
      return false;
  }
  const edges = new Set(b.edges.map((item) => item.id));
  return a.edges.every((item) => edges.has(item.id));
}

export function commitHistory(state: HistoryState, next: FlowGraph): HistoryState {
  return {
    past: [...state.past, cloneGraph(state.present)].slice(-MAX_HISTORY),
    present: cloneGraph(next),
    future: [],
  };
}

export function undoHistory(state: HistoryState): HistoryState {
  if (state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1]!;
  return {
    past: state.past.slice(0, -1),
    present: cloneGraph(previous),
    future: [cloneGraph(state.present), ...state.future],
  };
}

export function redoHistory(state: HistoryState): HistoryState {
  if (state.future.length === 0) return state;
  const next = state.future[0]!;
  return {
    past: [...state.past, cloneGraph(state.present)],
    present: cloneGraph(next),
    future: state.future.slice(1),
  };
}

export function commitDrag(state: HistoryState, origin: FlowGraph, next: FlowGraph): HistoryState {
  if (sameGraph(origin, next)) return state;
  return {
    past: [...state.past, cloneGraph(origin)].slice(-MAX_HISTORY),
    present: cloneGraph(next),
    future: [],
  };
}
