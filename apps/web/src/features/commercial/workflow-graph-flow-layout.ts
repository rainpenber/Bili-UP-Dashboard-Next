import dagre from '@dagrejs/dagre';
import { Position, type Edge, type Node } from '@xyflow/react';
import type { WorkflowGraph, WorkflowGraphNode, WorkflowGraphStep } from './types';

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
  width: number;
  height: number;
  axisCenterX: number;
}

const SOURCE = '__wf_source__';
const SINK = '__wf_sink__';

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
    width: Math.max(maxX + pad, LAYOUT_NODE_WIDTH + pad * 2),
    height: maxY + pad,
    axisCenterX: axisX + dx,
  };
}

export function layoutWorkflowGraph(graph: WorkflowGraph): WorkflowGraphLayout {
  const { nodes: nodeMap, edges } = buildWorkflowDag(graph.steps);
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
    edges: edges.filter(
      (e) =>
        e.from !== SOURCE && e.to !== SINK && !e.from.startsWith('__') && !e.to.startsWith('__'),
    ),
    width: Math.max(maxX - minX, LAYOUT_NODE_WIDTH) + 48,
    height: maxY + 48,
    axisCenterX,
  };
  return alignWorkflowLayout(raw);
}

export type WorkflowFlowNodeData = {
  wfNode: WorkflowGraphNode;
  expanded: boolean;
};

export function toReactFlowElements(layout: WorkflowGraphLayout): {
  nodes: Node<WorkflowFlowNodeData>[];
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

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges: Edge[] = layout.edges
    .filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))
    .map((e) => ({
      id: `e-${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      sourceHandle: 'source',
      targetHandle: 'target',
      type: 'smoothstep',
      animated: false,
      selectable: false,
      focusable: false,
      style: { strokeWidth: 1, stroke: 'var(--border)' },
    }));

  return { nodes, edges };
}
