import dagre from '@dagrejs/dagre';
import { Position, type Edge, type Node } from '@xyflow/react';
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphStep } from './types';
import {
  applyDisplayJunctions,
  JUNCTION_DOT_SIZE,
  type DisplayJunction,
  type WorkflowJunctionNodeData,
} from './workflow-graph-junctions';
import { buildRoutedEdgeData, junctionMeetingPoints } from './workflow-graph-edge-routing';

export const LAYOUT_NODE_WIDTH = 176;
export const LAYOUT_NODE_HEIGHT = 44;
export const LAYOUT_NODE_GAP_X = 28;
/** Vertical rank spacing (with {@link LAYOUT_NODE_HEIGHT} ≈ 76px pitch between ranks). */
export const LAYOUT_NODE_GAP_Y = 28;

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface PlacedWorkflowNode {
  id: string;
  node: WorkflowGraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
  layer: number;
}

export interface WorkflowGraphLayout {
  nodes: PlacedWorkflowNode[];
  edges: LayoutEdge[];
  junctions: DisplayJunction[];
  width: number;
  height: number;
  axisCenterX: number;
}

const SOURCE = '__wf_source__';
const SINK = '__wf_sink__';

export function isRoutingNodeId(id: string): boolean {
  return id === SOURCE || id === SINK || id.startsWith('__');
}

function dedupeLayoutEdges(edges: LayoutEdge[]): LayoutEdge[] {
  const seen = new Set<string>();
  const out: LayoutEdge[] = [];
  for (const e of edges) {
    if (e.from === e.to) continue;
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Replace synthetic join/source/sink hops with direct edges between real workflow nodes. */
export function collapseRoutingEdges(edges: LayoutEdge[]): LayoutEdge[] {
  let current = [...edges];
  let progress = true;
  while (progress) {
    progress = false;
    const byFrom = new Map<string, LayoutEdge[]>();
    const byTo = new Map<string, LayoutEdge[]>();
    for (const e of current) {
      if (!byFrom.has(e.from)) byFrom.set(e.from, []);
      byFrom.get(e.from)!.push(e);
      if (!byTo.has(e.to)) byTo.set(e.to, []);
      byTo.get(e.to)!.push(e);
    }
    const routingIds = new Set<string>();
    for (const e of current) {
      if (isRoutingNodeId(e.from)) routingIds.add(e.from);
      if (isRoutingNodeId(e.to)) routingIds.add(e.to);
    }
    const consumed = new Set<LayoutEdge>();
    const bridged: LayoutEdge[] = [];
    for (const r of routingIds) {
      const ins = byTo.get(r) ?? [];
      const outs = byFrom.get(r) ?? [];
      if (ins.length === 0 || outs.length === 0) continue;
      for (const inE of ins) consumed.add(inE);
      for (const outE of outs) consumed.add(outE);
      for (const inE of ins) {
        for (const outE of outs) {
          bridged.push({ from: inE.from, to: outE.to });
        }
      }
      progress = true;
    }
    const kept = current.filter((e) => !consumed.has(e));
    current = dedupeLayoutEdges([...kept, ...bridged]);
  }
  return current.filter((e) => !isRoutingNodeId(e.from) && !isRoutingNodeId(e.to));
}

function isProductionParallel(step: WorkflowGraphStep): boolean {
  return (
    step.kind === 'parallel' && step.nodes.some((n) => n.id === 'ar' || n.name.includes('A-roll'))
  );
}

export function buildWorkflowDag(steps: WorkflowGraphStep[]): {
  nodes: Map<string, WorkflowGraphNode>;
  edges: LayoutEdge[];
} {
  const nodes = new Map<string, WorkflowGraphNode>();
  const edges: LayoutEdge[] = [];
  let fronts: string[] = [SOURCE];

  const addNode = (n: WorkflowGraphNode) => {
    nodes.set(n.id, n);
  };

  const link = (from: string, to: string) => {
    if (from === to) return;
    edges.push({ from, to });
  };

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]!;
    const next = steps[i + 1];

    if (step.kind === 'serial') {
      const branchOnlyProp =
        step.node.id === 'prop' &&
        next != null &&
        next.kind === 'parallel' &&
        isProductionParallel(next);
      if (branchOnlyProp) {
        addNode(step.node);
        const arId = next.nodes.find((n) => n.id === 'ar' || n.name.includes('A-roll'))?.id ?? 'ar';
        const joinId = `__join_prep_prod_${i}__`;
        nodes.set(joinId, { id: joinId, name: '', status: 'not_reached' });
        for (const f of fronts) {
          link(f, joinId);
        }
        for (const prod of next.nodes) {
          addNode(prod);
          if (prod.id === arId) {
            link(joinId, step.node.id);
            link(step.node.id, prod.id);
          } else {
            link(joinId, prod.id);
          }
        }
        fronts = next.nodes.map((n) => n.id);
        i += 1;
        continue;
      }

      addNode(step.node);
      for (const f of fronts) {
        link(f, step.node.id);
      }
      fronts = [step.node.id];
      continue;
    }

    for (const n of step.nodes) {
      addNode(n);
      for (const f of fronts) {
        link(f, n.id);
      }
    }
    fronts = step.nodes.map((n) => n.id);
  }

  for (const f of fronts) {
    link(f, SINK);
  }

  return { nodes, edges };
}

export function nodeCenter(p: PlacedWorkflowNode): { cx: number; cy: number } {
  return { cx: p.x + p.width / 2, cy: p.y + p.height / 2 };
}

export function layerRowCenter(nodes: PlacedWorkflowNode[]): number {
  if (nodes.length === 0) return 0;
  return nodes.reduce((s, n) => s + n.x + n.width / 2, 0) / nodes.length;
}

const MAIN_AXIS_IDS = new Set(['inq', 'outline', 'rev', 'pub']);

const PARALLEL_RANK_ORDER: Record<string, number> = {
  script: 0,
  'pre-shoot': 1,
  prop: 0,
  ar: 1,
  br: 2,
  ai: 3,
  settle: 0,
  distribute: 1,
  'data-care': 2,
  other: 3,
};

function reorderParallelGroups(nodes: PlacedWorkflowNode[], axisX: number): void {
  for (const group of groupByY(nodes)) {
    if (group.length < 2) continue;
    group.sort((a, b) => {
      const oa = PARALLEL_RANK_ORDER[a.id] ?? a.x;
      const ob = PARALLEL_RANK_ORDER[b.id] ?? b.x;
      if (oa !== ob) return oa - ob;
      return a.x - b.x;
    });
    const totalWidth = group.length * LAYOUT_NODE_WIDTH + (group.length - 1) * LAYOUT_NODE_GAP_X;
    let x = axisX - totalWidth / 2;
    for (const n of group) {
      n.x = x;
      x += LAYOUT_NODE_WIDTH + LAYOUT_NODE_GAP_X;
    }
  }
}

function groupByY(nodes: PlacedWorkflowNode[]): PlacedWorkflowNode[][] {
  const groups: PlacedWorkflowNode[][] = [];
  for (const n of nodes) {
    const existing = groups.find((g) => Math.abs(g[0]!.y - n.y) < 6);
    if (existing) existing.push(n);
    else groups.push([n]);
  }
  return groups;
}

function shiftNode(node: PlacedWorkflowNode, dx: number): void {
  node.x += dx;
}

export function alignWorkflowLayout(layout: WorkflowGraphLayout): WorkflowGraphLayout {
  const nodes = layout.nodes.map((n) => ({ ...n }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const mainNodes = ['inq', 'outline', 'rev', 'pub']
    .map((id) => byId.get(id))
    .filter((n): n is PlacedWorkflowNode => n != null);
  const axisX = mainNodes.length > 0 ? layerRowCenter(mainNodes) : layout.axisCenterX;

  for (const id of MAIN_AXIS_IDS) {
    const n = byId.get(id);
    if (!n) continue;
    shiftNode(n, axisX - (n.x + n.width / 2));
  }

  for (const group of groupByY(nodes)) {
    if (group.length >= 2) {
      const cx = layerRowCenter(group);
      const dx = axisX - cx;
      for (const n of group) shiftNode(n, dx);
    }
  }

  reorderParallelGroups(nodes, axisX);

  const prop = byId.get('prop');
  const ar = byId.get('ar');
  if (prop && ar) {
    shiftNode(prop, ar.x + ar.width / 2 - (prop.x + prop.width / 2));
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height);
  }
  const pad = 24;
  const dx = pad - minX;
  if (dx !== 0) {
    for (const n of nodes) n.x += dx;
    maxX += dx;
  }

  return {
    nodes,
    edges: layout.edges,
    junctions: layout.junctions,
    width: Math.max(maxX + pad, LAYOUT_NODE_WIDTH + pad * 2),
    height: maxY + pad,
    axisCenterX: axisX + dx,
  };
}

function collectRealNodes(graph: WorkflowGraph): Map<string, WorkflowGraphNode> {
  const nodes = new Map<string, WorkflowGraphNode>();
  for (const step of graph.steps) {
    if (step.kind === 'serial') nodes.set(step.node.id, step.node);
    else for (const n of step.nodes) nodes.set(n.id, n);
  }
  return nodes;
}

function layoutFromNodeMapAndEdges(
  nodeMap: Map<string, WorkflowGraphNode>,
  edges: LayoutEdge[],
  displayEdges: LayoutEdge[],
): WorkflowGraphLayout {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB',
    nodesep: LAYOUT_NODE_GAP_X,
    ranksep: LAYOUT_NODE_GAP_Y,
    marginx: 24,
    marginy: 12,
  });

  g.setNode(SOURCE, { width: 0, height: 0 });
  g.setNode(SINK, { width: 0, height: 0 });
  for (const [id, node] of nodeMap) {
    if (id.startsWith('__')) {
      g.setNode(id, { width: 0, height: 0, label: '' });
    } else {
      g.setNode(id, { width: LAYOUT_NODE_WIDTH, height: LAYOUT_NODE_HEIGHT, label: node.name });
    }
  }

  for (const e of edges) {
    g.setEdge(e.from, e.to);
  }

  dagre.layout(g);

  const placed: PlacedWorkflowNode[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let maxY = 0;

  for (const [id, node] of nodeMap) {
    if (id.startsWith('__')) continue;
    const d = g.node(id);
    if (!d) continue;
    const x = d.x - LAYOUT_NODE_WIDTH / 2;
    const y = d.y - LAYOUT_NODE_HEIGHT / 2;
    placed.push({
      id,
      node,
      x,
      y,
      width: LAYOUT_NODE_WIDTH,
      height: LAYOUT_NODE_HEIGHT,
      layer: Math.round(d.y),
    });
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x + LAYOUT_NODE_WIDTH);
    maxY = Math.max(maxY, y + LAYOUT_NODE_HEIGHT);
  }

  const axisNodes = placed.filter(
    (p) => p.id === 'inq' || p.id === 'outline' || p.id === 'rev' || p.id === 'pub',
  );
  const axisCenterX =
    axisNodes.length > 0
      ? axisNodes.reduce((s, p) => s + p.x + p.width / 2, 0) / axisNodes.length
      : (minX + maxX) / 2;

  const raw: WorkflowGraphLayout = {
    nodes: placed,
    edges: displayEdges,
    junctions: [],
    width: Math.max(maxX - minX, LAYOUT_NODE_WIDTH) + 48,
    height: maxY + 48,
    axisCenterX,
  };
  return applyDisplayJunctions(alignWorkflowLayout(raw));
}

export function layoutWorkflowGraph(graph: WorkflowGraph): WorkflowGraphLayout {
  if (graph.connections) {
    const nodeMap = collectRealNodes(graph);
    const displayEdges = dedupeLayoutEdges(
      graph.connections
        .filter((c) => nodeMap.has(c.from) && nodeMap.has(c.to))
        .map((c) => ({ from: c.from, to: c.to })),
    );
    const layoutEdges: LayoutEdge[] = [];
    const hasIncoming = new Set(displayEdges.map((e) => e.to));
    const hasOutgoing = new Set(displayEdges.map((e) => e.from));
    for (const id of nodeMap.keys()) {
      if (!hasIncoming.has(id)) layoutEdges.push({ from: SOURCE, to: id });
      if (!hasOutgoing.has(id)) layoutEdges.push({ from: id, to: SINK });
    }
    layoutEdges.push(...displayEdges);
    return layoutFromNodeMapAndEdges(nodeMap, layoutEdges, displayEdges);
  }

  const { nodes: nodeMap, edges } = buildWorkflowDag(graph.steps);
  return layoutFromNodeMapAndEdges(nodeMap, edges, collapseRoutingEdges(edges));
}

export type WorkflowNodeEditorActions = {
  onStart?: () => void;
  onComplete?: () => void;
  onRollback?: () => void;
  onBlock?: (reason: string) => void;
  onClearBlock?: () => void;
  blockReasonDraft?: string;
  setBlockReasonDraft?: (value: string) => void;
};

export type WorkflowFlowNodeData = {
  wfNode: WorkflowGraphNode;
  expanded: boolean;
  selected?: boolean;
  onNodeActivate?: (nodeId: string) => void;
  editor?: WorkflowNodeEditorActions;
};

export function toReactFlowElements(layout: WorkflowGraphLayout): {
  nodes: Array<Node<WorkflowFlowNodeData> | Node<WorkflowJunctionNodeData>>;
  edges: Edge[];
} {
  const nodes: Node<WorkflowFlowNodeData>[] = layout.nodes.map((p) => ({
    id: p.id,
    type: 'workflowNode',
    position: { x: p.x, y: p.y },
    data: { wfNode: p.node, expanded: false },
    draggable: false,
    selectable: false,
    connectable: true,
    width: p.width,
    height: p.height,
    measured: { width: p.width, height: p.height },
    handles: [
      {
        id: 'target',
        type: 'target',
        position: Position.Top,
        x: p.width / 2,
        y: 0,
        width: 1,
        height: 1,
      },
      {
        id: 'source',
        type: 'source',
        position: Position.Bottom,
        x: p.width / 2,
        y: p.height,
        width: 1,
        height: 1,
      },
    ],
  }));

  const routed = buildRoutedEdgeData(layout);

  const junctionNodes: Node<WorkflowJunctionNodeData>[] = [];
  for (const j of layout.junctions) {
    junctionNodes.push({
      id: j.id,
      type: 'workflowJunction',
      position: { x: j.x, y: j.y },
      data: { marker: 'anchor' },
      draggable: false,
      selectable: false,
      connectable: true,
      focusable: false,
      width: 1,
      height: 1,
      measured: { width: 1, height: 1 },
      style: { opacity: 0, pointerEvents: 'none', width: 1, height: 1 },
      handles: [
        {
          id: 'target',
          type: 'target',
          position: Position.Top,
          x: 0.5,
          y: 0,
          width: 1,
          height: 1,
        },
        {
          id: 'source',
          type: 'source',
          position: Position.Bottom,
          x: 0.5,
          y: 1,
          width: 1,
          height: 1,
        },
      ],
    });
    for (const pt of junctionMeetingPoints(layout, j.id)) {
      const x = pt.x - JUNCTION_DOT_SIZE / 2;
      const y = pt.y - JUNCTION_DOT_SIZE / 2;
      junctionNodes.push({
        id: `display-dot-${j.id}-${pt.x}`,
        type: 'workflowJunction',
        position: { x, y },
        data: { marker: 'dot' },
        draggable: false,
        selectable: false,
        connectable: false,
        focusable: false,
        width: JUNCTION_DOT_SIZE,
        height: JUNCTION_DOT_SIZE,
        measured: { width: JUNCTION_DOT_SIZE, height: JUNCTION_DOT_SIZE },
        zIndex: 5,
        style: {
          pointerEvents: 'none',
          width: JUNCTION_DOT_SIZE,
          height: JUNCTION_DOT_SIZE,
        },
      });
    }
  }

  const nodeIds = new Set([...nodes.map((n) => n.id), ...junctionNodes.map((n) => n.id)]);
  const edges: Edge[] = layout.edges
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => {
      const id = `e-${e.from}-${e.to}`;
      const meta = routed.get(id);
      return {
        id,
        source: e.from,
        target: e.to,
        sourceHandle: 'source',
        targetHandle: 'target',
        type: 'workflowRouted',
        data: { path: meta?.path ?? 'M 0 0 L 0 0' },
        animated: false,
        selectable: false,
        focusable: false,
        style: { strokeWidth: 1, stroke: 'var(--border)' },
      };
    });

  return { nodes: [...nodes, ...junctionNodes], edges };
}
