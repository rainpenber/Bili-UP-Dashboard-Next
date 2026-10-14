type LayoutNode = { id: string; posX: number; posY: number };
type LayoutEdge = { fromNodeId: string; toNodeId: string };

/** Layer nodes top-to-bottom from DAG edges (best-effort for parallel branches). */
export function autoLayoutPositions(
  nodes: LayoutNode[],
  edges: LayoutEdge[],
  opts?: { xGap?: number; yGap?: number },
): Map<string, { posX: number; posY: number }> {
  const xGap = opts?.xGap ?? 180;
  const yGap = opts?.yGap ?? 120;
  const ids = new Set(nodes.map((n) => n.id));
  const inDeg = new Map<string, number>();
  const out = new Map<string, string[]>();
  for (const id of ids) {
    inDeg.set(id, 0);
    out.set(id, []);
  }
  for (const e of edges) {
    if (!ids.has(e.fromNodeId) || !ids.has(e.toNodeId)) continue;
    inDeg.set(e.toNodeId, (inDeg.get(e.toNodeId) ?? 0) + 1);
    out.get(e.fromNodeId)!.push(e.toNodeId);
  }
  const layer = new Map<string, number>();
  const queue = [...ids].filter((id) => (inDeg.get(id) ?? 0) === 0);
  for (const id of queue) layer.set(id, 0);
  while (queue.length) {
    const id = queue.shift()!;
    const base = layer.get(id) ?? 0;
    for (const to of out.get(id) ?? []) {
      layer.set(to, Math.max(layer.get(to) ?? 0, base + 1));
      inDeg.set(to, (inDeg.get(to) ?? 1) - 1);
      if ((inDeg.get(to) ?? 0) === 0) queue.push(to);
    }
  }
  for (const id of ids) if (!layer.has(id)) layer.set(id, 0);
  const byLayer = new Map<number, string[]>();
  for (const [id, l] of layer) {
    const list = byLayer.get(l) ?? [];
    list.push(id);
    byLayer.set(l, list);
  }
  const result = new Map<string, { posX: number; posY: number }>();
  for (const [l, list] of byLayer) {
    const sorted = [...list].sort();
    const offset = ((sorted.length - 1) * xGap) / 2;
    sorted.forEach((id, i) => {
      result.set(id, { posX: i * xGap - offset, posY: l * yGap });
    });
  }
  return result;
}
