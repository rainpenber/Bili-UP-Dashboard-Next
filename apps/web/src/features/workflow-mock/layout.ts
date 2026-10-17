import dagre from '@dagrejs/dagre';
import { JUNCTION_SIZE, STAGE_H, STAGE_W, type FlowGraph } from './model';

export type FlowDirection = 'lr' | 'tb';

export function layoutWithDagre(graph: FlowGraph, direction: FlowDirection = 'lr'): FlowGraph {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction === 'tb' ? 'TB' : 'LR',
    nodesep: 36,
    ranksep: 84,
    marginx: 32,
    marginy: 32,
  });

  for (const node of graph.nodes) {
    const anchor = node.kind === 'merge';
    g.setNode(node.id, {
      width: anchor ? JUNCTION_SIZE : STAGE_W,
      height: anchor ? JUNCTION_SIZE : STAGE_H,
    });
  }
  for (const item of graph.edges) {
    g.setEdge(item.source, item.target);
  }
  dagre.layout(g);

  return {
    ...graph,
    nodes: graph.nodes.map((node) => {
      const pos = g.node(node.id) as { x: number; y: number } | undefined;
      if (!pos) return node;
      const width = node.kind === 'merge' ? JUNCTION_SIZE : STAGE_W;
      const height = node.kind === 'merge' ? JUNCTION_SIZE : STAGE_H;
      return { ...node, x: pos.x - width / 2, y: pos.y - height / 2 };
    }),
  };
}
