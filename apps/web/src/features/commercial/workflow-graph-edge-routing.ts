import {
  isDisplayJunctionId,
  JUNCTION_PREP_PROD_ID,
  JUNCTION_PUB_WIND_ID,
} from './workflow-graph-junctions';
import type { PlacedWorkflowNode, WorkflowGraphLayout } from './workflow-graph-flow-layout';

export type WorkflowRoutedEdgeData = {
  path?: string;
};

type Box = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
};

function nodeBox(n: PlacedWorkflowNode): Box {
  return {
    id: n.id,
    left: n.x,
    right: n.x + n.width,
    top: n.y,
    bottom: n.y + n.height,
    cx: n.x + n.width / 2,
  };
}

function pathFromPoints(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first!.x} ${first!.y}${rest.map((p) => ` L ${p.x} ${p.y}`).join('')}`;
}

/** Orthogonal path via a single horizontal bus between ranks (right angles only). */
export function routeViaBus(from: Box, to: Box, busY: number): string {
  const start = { x: from.cx, y: from.bottom };
  const end = { x: to.cx, y: to.top };
  const points: { x: number; y: number }[] = [start];
  if (Math.abs(start.y - busY) > 0.01) points.push({ x: from.cx, y: busY });
  if (Math.abs(from.cx - to.cx) > 0.01) points.push({ x: to.cx, y: busY });
  if (Math.abs(end.y - busY) > 0.01) points.push(end);
  else if (points[points.length - 1]!.x !== end.x || points[points.length - 1]!.y !== end.y) {
    points.push(end);
  }
  return pathFromPoints(points);
}

export function routeSourceToBus(from: Box, busY: number): string {
  return pathFromPoints([
    { x: from.cx, y: from.bottom },
    { x: from.cx, y: busY },
  ]);
}

export function routeBusToTarget(to: Box, busY: number): string {
  return pathFromPoints([
    { x: to.cx, y: busY },
    { x: to.cx, y: to.top },
  ]);
}

function busYBetween(aboveBottom: number, belowTop: number): number {
  return aboveBottom + (belowTop - aboveBottom) / 2;
}

export interface JunctionBusSpan {
  busY: number;
  busLeft: number;
  busRight: number;
}

export function junctionBusSpan(
  layout: WorkflowGraphLayout,
  junctionId: string,
): JunctionBusSpan | null {
  const boxes = new Map(layout.nodes.map((n) => [n.id, nodeBox(n)]));
  if (junctionId === JUNCTION_PREP_PROD_ID) {
    const prep = layout.nodes.filter((n) => n.id === 'script' || n.id === 'pre-shoot');
    const prod = layout.nodes.filter((n) => ['ar', 'br', 'ai', 'prop'].includes(n.id));
    if (prep.length === 0 || prod.length === 0) return null;
    const prepBottom = Math.max(...prep.map((n) => n.y + n.height));
    const prodTop = Math.min(...prod.map((n) => n.y));
    const prodBoxes = prod.map((n) => boxes.get(n.id)!);
    return {
      busY: busYBetween(prepBottom, prodTop),
      busLeft: Math.min(...prodBoxes.map((b) => b.left)),
      busRight: Math.max(...prodBoxes.map((b) => b.right)),
    };
  }
  if (junctionId === JUNCTION_PUB_WIND_ID) {
    const pub = layout.nodes.find((n) => n.id === 'pub');
    const wind = layout.nodes.filter((n) =>
      ['settle', 'distribute', 'data-care', 'other'].includes(n.id),
    );
    if (!pub || wind.length === 0) return null;
    const pubBottom = pub.y + pub.height;
    const windTop = Math.min(...wind.map((n) => n.y));
    const windBoxes = wind.map((n) => boxes.get(n.id)!);
    return {
      busY: busYBetween(pubBottom, windTop),
      busLeft: Math.min(...windBoxes.map((b) => b.left)),
      busRight: Math.max(...windBoxes.map((b) => b.right)),
    };
  }
  return null;
}

export function buildRoutedEdgeData(
  layout: WorkflowGraphLayout,
): Map<string, WorkflowRoutedEdgeData> {
  const boxes = new Map(layout.nodes.map((n) => [n.id, nodeBox(n)]));
  const out = new Map<string, WorkflowRoutedEdgeData>();
  const edgeKey = (from: string, to: string) => `e-${from}-${to}`;

  const prepBus = junctionBusSpan(layout, JUNCTION_PREP_PROD_ID);
  const pubBus = junctionBusSpan(layout, JUNCTION_PUB_WIND_ID);

  for (const e of layout.edges) {
    const from = boxes.get(e.from);
    const to = boxes.get(e.to);
    if (!from && !isDisplayJunctionId(e.from)) continue;
    if (!to && !isDisplayJunctionId(e.to)) continue;

    if (e.to === JUNCTION_PREP_PROD_ID && from && prepBus) {
      out.set(edgeKey(e.from, e.to), { path: routeSourceToBus(from, prepBus.busY) });
      continue;
    }
    if (e.from === JUNCTION_PREP_PROD_ID && to && prepBus) {
      out.set(edgeKey(e.from, e.to), { path: routeBusToTarget(to, prepBus.busY) });
      continue;
    }
    if (e.to === JUNCTION_PUB_WIND_ID && from && pubBus) {
      out.set(edgeKey(e.from, e.to), { path: routeSourceToBus(from, pubBus.busY) });
      continue;
    }
    if (e.from === JUNCTION_PUB_WIND_ID && to && pubBus) {
      out.set(edgeKey(e.from, e.to), { path: routeBusToTarget(to, pubBus.busY) });
      continue;
    }

    if (from && to) {
      const busY = busYBetween(from.bottom, to.top);
      out.set(edgeKey(e.from, e.to), { path: routeViaBus(from, to, busY) });
    }
  }

  return out;
}

export function junctionNodeFrame(
  layout: WorkflowGraphLayout,
  junctionId: string,
): { x: number; y: number; width: number; height: number } {
  const span = junctionBusSpan(layout, junctionId);
  if (!span) {
    const j = layout.junctions.find((x) => x.id === junctionId);
    return { x: (j?.x ?? 0) - 6, y: (j?.y ?? 0) - 2, width: 12, height: 4 };
  }
  return {
    x: span.busLeft,
    y: span.busY - 2,
    width: Math.max(span.busRight - span.busLeft, 8),
    height: 4,
  };
}
