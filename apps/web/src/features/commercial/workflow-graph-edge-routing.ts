import {
  isDisplayJunctionId,
  JUNCTION_PREP_PROD_ID,
  JUNCTION_PUB_WIND_ID,
} from './workflow-graph-junctions';
import type { PlacedWorkflowNode, WorkflowGraphLayout } from './workflow-graph-flow-layout';

export const WORKFLOW_EDGE_LANE_GAP = 7;

export type WorkflowRoutedEdgeData = {
  path?: string;
  busLane?: number;
  busRole?: 'in' | 'out' | 'serial';
  busGroup?: string;
};

type Box = {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
};

function nodeBox(n: PlacedWorkflowNode): Box {
  return {
    id: n.id,
    left: n.x,
    right: n.x + n.width,
    top: n.y,
    bottom: n.y + n.height,
    cx: n.x + n.width / 2,
    cy: n.y + n.height / 2,
  };
}

export function junctionBands(
  layout: WorkflowGraphLayout,
  junctionId: string,
): { inY: number; outY: number } {
  const j = layout.junctions.find((x) => x.id === junctionId);
  if (!j) return { inY: 0, outY: 0 };
  if (junctionId === JUNCTION_PREP_PROD_ID) {
    const prep = layout.nodes.filter((n) => n.id === 'script' || n.id === 'pre-shoot');
    const prod = layout.nodes.filter((n) => ['ar', 'br', 'ai', 'prop'].includes(n.id));
    const prepBottom = Math.max(...prep.map((n) => n.y + n.height));
    const prodTop = Math.min(...prod.map((n) => n.y));
    const gap = prodTop - prepBottom;
    const inY = prepBottom + Math.min(14, gap * 0.28);
    const outY = prodTop - Math.min(14, gap * 0.28);
    return { inY, outY: Math.max(outY, inY + WORKFLOW_EDGE_LANE_GAP * 2) };
  }
  const pub = layout.nodes.find((n) => n.id === 'pub');
  const wind = layout.nodes.filter((n) =>
    ['settle', 'distribute', 'data-care', 'other'].includes(n.id),
  );
  if (!pub || wind.length === 0) return { inY: j.y, outY: j.y };
  const pubBottom = pub.y + pub.height;
  const windTop = Math.min(...wind.map((n) => n.y));
  const gap = windTop - pubBottom;
  const inY = pubBottom + Math.min(12, gap * 0.3);
  const outY = windTop - Math.min(12, gap * 0.3);
  return { inY, outY: Math.max(outY, inY + WORKFLOW_EDGE_LANE_GAP * 2) };
}

function pathFromPoints(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  return `M ${first!.x} ${first!.y}${rest.map((p) => ` L ${p.x} ${p.y}`).join('')}`;
}

function routeSerial(from: Box, to: Box, lane: number): string {
  const start = { x: from.cx, y: from.bottom };
  const end = { x: to.cx, y: to.top };
  if (Math.abs(from.cx - to.cx) < 2) {
    return pathFromPoints([start, end]);
  }
  const midY = (start.y + end.y) / 2 + lane * WORKFLOW_EDGE_LANE_GAP;
  return pathFromPoints([start, { x: start.x, y: midY }, { x: end.x, y: midY }, end]);
}

function routeBusIn(from: Box, axisX: number, inY: number, lane: number): string {
  const y = inY + lane * WORKFLOW_EDGE_LANE_GAP;
  const start = { x: from.cx, y: from.bottom };
  return pathFromPoints([start, { x: from.cx, y }, { x: axisX, y }]);
}

function routeBusOut(axisX: number, outY: number, lane: number, to: Box): string {
  const y = outY + lane * WORKFLOW_EDGE_LANE_GAP;
  const end = { x: to.cx, y: to.top };
  return pathFromPoints([{ x: axisX, y }, { x: to.cx, y }, end]);
}

function routeBusTrunk(
  axisX: number,
  inY: number,
  outY: number,
  inCount: number,
  outCount: number,
): string {
  const top = inY + (inCount - 1) * WORKFLOW_EDGE_LANE_GAP;
  const bottom = outY + (outCount - 1) * WORKFLOW_EDGE_LANE_GAP;
  return pathFromPoints([
    { x: axisX, y: top },
    { x: axisX, y: bottom },
  ]);
}

/** Assign stable left-to-right order within parallel ranks (reduces fan crossings). */
export function sortParallelRankMembers(layout: WorkflowGraphLayout): WorkflowGraphLayout {
  const orderById: Record<string, number> = {
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
  const nodes = [...layout.nodes].sort((a, b) => {
    if (Math.abs(a.y - b.y) >= 6) return a.y - b.y;
    const oa = orderById[a.id] ?? a.x;
    const ob = orderById[b.id] ?? b.x;
    if (oa !== ob) return oa - ob;
    return a.x - b.x;
  });
  return { ...layout, nodes };
}

export function buildRoutedEdgeData(
  layout: WorkflowGraphLayout,
): Map<string, WorkflowRoutedEdgeData> {
  const boxes = new Map(layout.nodes.map((n) => [n.id, nodeBox(n)]));
  const axisX = layout.axisCenterX;
  const out = new Map<string, WorkflowRoutedEdgeData>();

  const edgeKey = (from: string, to: string) => `e-${from}-${to}`;

  const prepProdBands = junctionBands(layout, JUNCTION_PREP_PROD_ID);
  const pubWindBands = junctionBands(layout, JUNCTION_PUB_WIND_ID);

  const prepIn = layout.edges
    .filter((e) => e.to === JUNCTION_PREP_PROD_ID)
    .sort((a, b) => (boxes.get(a.from)?.cx ?? 0) - (boxes.get(b.from)?.cx ?? 0));
  const prepOut = layout.edges
    .filter((e) => e.from === JUNCTION_PREP_PROD_ID)
    .sort((a, b) => (boxes.get(a.to)?.cx ?? 0) - (boxes.get(b.to)?.cx ?? 0));

  for (let i = 0; i < prepIn.length; i += 1) {
    const e = prepIn[i]!;
    const from = boxes.get(e.from);
    if (!from) continue;
    out.set(edgeKey(e.from, e.to), {
      path: routeBusIn(from, axisX, prepProdBands.inY, i),
      busLane: i,
      busRole: 'in',
      busGroup: JUNCTION_PREP_PROD_ID,
    });
  }
  for (let i = 0; i < prepOut.length; i += 1) {
    const e = prepOut[i]!;
    const to = boxes.get(e.to);
    if (!to) continue;
    out.set(edgeKey(e.from, e.to), {
      path: routeBusOut(axisX, prepProdBands.outY, i, to),
      busLane: i,
      busRole: 'out',
      busGroup: JUNCTION_PREP_PROD_ID,
    });
  }
  if (prepIn.length > 0 && prepOut.length > 0) {
    out.set(`trunk-${JUNCTION_PREP_PROD_ID}`, {
      path: routeBusTrunk(
        axisX,
        prepProdBands.inY,
        prepProdBands.outY,
        prepIn.length,
        prepOut.length,
      ),
      busRole: 'serial',
      busGroup: JUNCTION_PREP_PROD_ID,
    });
  }

  const pubIn = layout.edges.filter((e) => e.to === JUNCTION_PUB_WIND_ID);
  const windOut = layout.edges
    .filter((e) => e.from === JUNCTION_PUB_WIND_ID)
    .sort((a, b) => (boxes.get(a.to)?.cx ?? 0) - (boxes.get(b.to)?.cx ?? 0));

  if (pubIn.length === 1) {
    const e = pubIn[0]!;
    const from = boxes.get(e.from);
    if (from) {
      out.set(edgeKey(e.from, e.to), {
        path: routeBusIn(from, axisX, pubWindBands.inY, 0),
        busLane: 0,
        busRole: 'in',
        busGroup: JUNCTION_PUB_WIND_ID,
      });
    }
  }
  for (let i = 0; i < windOut.length; i += 1) {
    const e = windOut[i]!;
    const to = boxes.get(e.to);
    if (!to) continue;
    out.set(edgeKey(e.from, e.to), {
      path: routeBusOut(axisX, pubWindBands.outY, i, to),
      busLane: i,
      busRole: 'out',
      busGroup: JUNCTION_PUB_WIND_ID,
    });
  }
  if (pubIn.length > 0 && windOut.length > 0) {
    out.set(`trunk-${JUNCTION_PUB_WIND_ID}`, {
      path: routeBusTrunk(axisX, pubWindBands.inY, pubWindBands.outY, 1, windOut.length),
      busRole: 'serial',
      busGroup: JUNCTION_PUB_WIND_ID,
    });
  }

  const serialGroups = new Map<string, { from: string; to: string }[]>();
  for (const e of layout.edges) {
    if (isDisplayJunctionId(e.from) || isDisplayJunctionId(e.to)) continue;
    const key = e.from;
    if (!serialGroups.has(key)) serialGroups.set(key, []);
    serialGroups.get(key)!.push(e);
  }
  for (const [, group] of serialGroups) {
    const sorted = [...group].sort(
      (a, b) => (boxes.get(a.to)?.cx ?? 0) - (boxes.get(b.to)?.cx ?? 0),
    );
    sorted.forEach((e, lane) => {
      const from = boxes.get(e.from);
      const to = boxes.get(e.to);
      if (!from || !to) return;
      out.set(edgeKey(e.from, e.to), {
        path: routeSerial(from, to, lane),
        busLane: lane,
        busRole: 'serial',
      });
    });
  }

  return out;
}

export function junctionNodeFrame(
  layout: WorkflowGraphLayout,
  junctionId: string,
): { x: number; y: number; width: number; height: number } {
  const bands = junctionBands(layout, junctionId);
  const inCount = layout.edges.filter((e) => e.to === junctionId).length;
  const outCount = layout.edges.filter((e) => e.from === junctionId).length;
  const laneSpan = Math.max(inCount, outCount, 1) * WORKFLOW_EDGE_LANE_GAP;
  const height = Math.max(bands.outY - bands.inY + laneSpan, 12);
  return {
    x: layout.axisCenterX - 3,
    y: bands.inY,
    width: 6,
    height,
  };
}

export function trunkEdgesForLayout(layout: WorkflowGraphLayout): {
  id: string;
  path: string;
  group: string;
}[] {
  const data = buildRoutedEdgeData(layout);
  const trunks: { id: string; path: string; group: string }[] = [];
  for (const [id, meta] of data) {
    if (id.startsWith('trunk-') && meta.path) {
      trunks.push({ id, path: meta.path, group: meta.busGroup ?? id });
    }
  }
  return trunks;
}
