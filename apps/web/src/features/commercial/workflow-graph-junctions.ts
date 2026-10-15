export const JUNCTION_PREP_PROD_ID = '__display_junction_prep_prod__';
export const JUNCTION_PUB_WIND_ID = '__display_junction_pub_wind__';

const PREP_IDS = new Set(['script', 'pre-shoot']);
const PROD_IDS = new Set(['ar', 'br', 'ai', 'prop']);
const WIND_IDS = new Set(['settle', 'distribute', 'data-care', 'other']);

export const DISPLAY_JUNCTION_IDS = [JUNCTION_PREP_PROD_ID, JUNCTION_PUB_WIND_ID] as const;

export type WorkflowJunctionNodeData = Record<string, never>;

export function isDisplayJunctionId(id: string): boolean {
  return id.startsWith('__display_junction_');
}

export interface DisplayJunction {
  id: string;
  x: number;
  y: number;
}

type LayoutNodeRef = { id: string; y: number; height: number };
type EdgeRef = { from: string; to: string };

function nodeById(nodes: LayoutNodeRef[], id: string): LayoutNodeRef | undefined {
  return nodes.find((n) => n.id === id);
}

function junctionPointBetween(
  above: LayoutNodeRef[],
  below: LayoutNodeRef[],
  axisCenterX: number,
): { x: number; y: number } {
  const maxAbove = Math.max(...above.map((n) => n.y + n.height));
  const minBelow = Math.min(...below.map((n) => n.y));
  const cy = (maxAbove + minBelow) / 2;
  return { x: axisCenterX, y: cy };
}

function rewireGroupToJunction(
  edges: EdgeRef[],
  sources: Set<string>,
  targets: Set<string>,
  junctionId: string,
): EdgeRef[] {
  const cross = edges.filter((e) => sources.has(e.from) && targets.has(e.to));
  if (cross.length === 0) return edges;

  const targetSet = new Set(cross.map((e) => e.to));
  const sourceSet = new Set(cross.map((e) => e.from));
  const kept = edges.filter((e) => !(sources.has(e.from) && targets.has(e.to)));
  const next = [...kept];
  for (const s of sourceSet) {
    next.push({ from: s, to: junctionId });
  }
  for (const t of targetSet) {
    next.push({ from: junctionId, to: t });
  }
  return next;
}

function dedupeEdges(edges: EdgeRef[]): EdgeRef[] {
  const seen = new Set<string>();
  const out: EdgeRef[] = [];
  for (const e of edges) {
    const key = `${e.from}->${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

export function applyDisplayJunctions<
  L extends {
    nodes: LayoutNodeRef[];
    edges: EdgeRef[];
    junctions: DisplayJunction[];
    axisCenterX: number;
  },
>(layout: L): L {
  let edges = dedupeEdges([...layout.edges]);
  const junctions: DisplayJunction[] = [];

  const prepNodes = layout.nodes.filter((n) => PREP_IDS.has(n.id));
  const prodNodes = layout.nodes.filter((n) => PROD_IDS.has(n.id));
  if (prepNodes.length > 0 && prodNodes.length > 0) {
    const crossCount = edges.filter((e) => PREP_IDS.has(e.from) && PROD_IDS.has(e.to)).length;
    if (crossCount > 0) {
      edges = rewireGroupToJunction(edges, PREP_IDS, PROD_IDS, JUNCTION_PREP_PROD_ID);
      const pt = junctionPointBetween(prepNodes, prodNodes, layout.axisCenterX);
      junctions.push({ id: JUNCTION_PREP_PROD_ID, x: pt.x, y: pt.y });
    }
  }

  const pub = nodeById(layout.nodes, 'pub');
  const windNodes = layout.nodes.filter((n) => WIND_IDS.has(n.id));
  if (pub && windNodes.length > 0) {
    const crossCount = edges.filter((e) => e.from === 'pub' && WIND_IDS.has(e.to)).length;
    if (crossCount > 0) {
      edges = rewireGroupToJunction(edges, new Set(['pub']), WIND_IDS, JUNCTION_PUB_WIND_ID);
      const pt = junctionPointBetween([pub], windNodes, layout.axisCenterX);
      junctions.push({ id: JUNCTION_PUB_WIND_ID, x: pt.x, y: pt.y });
    }
  }

  return { ...layout, edges, junctions };
}
