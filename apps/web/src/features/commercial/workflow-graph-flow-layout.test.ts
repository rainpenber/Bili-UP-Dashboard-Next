import { describe, expect, test } from 'bun:test';
import { commercialProjectsMock } from './mock-data';
import { createProjectWorkflow } from './workflow-graph-canonical';
import {
  buildWorkflowDag,
  collapseRoutingEdges,
  layerRowCenter,
  layoutWorkflowGraph,
  nodeCenter,
} from './workflow-graph-flow-layout';
import { includesPostPublishWindDown } from './workflow-node-visual';

const TOLERANCE = 12;

function cx(id: string, layout: ReturnType<typeof layoutWorkflowGraph>): number {
  const n = layout.nodes.find((p) => p.id === id);
  if (!n) throw new Error(`missing ${id}`);
  return nodeCenter(n).cx;
}

function sameRow(a: string, b: string, layout: ReturnType<typeof layoutWorkflowGraph>): boolean {
  const na = layout.nodes.find((p) => p.id === a)!;
  const nb = layout.nodes.find((p) => p.id === b)!;
  return Math.abs(na.y - nb.y) < 6;
}

function rankGroups(layout: ReturnType<typeof layoutWorkflowGraph>) {
  const groups: (typeof layout.nodes)[] = [];
  for (const n of layout.nodes) {
    const g = groups.find((grp) => Math.abs(grp[0]!.y - n.y) < 6);
    if (g) g.push(n);
    else groups.push([n]);
  }
  return groups.map((g) => ({
    y: g[0]!.y,
    nodes: [...g].sort((a, b) => a.x - b.x),
  }));
}

describe('workflow flow layout geometry', () => {
  test('board prop: 道具制作 shares A-roll column on its own rank', () => {
    const project = commercialProjectsMock.find((p) => p.id === 'proj-board-prop')!;
    const layout = layoutWorkflowGraph(project.workflow);
    expect(Math.abs(cx('prop', layout) - cx('ar', layout))).toBeLessThan(4);
    expect(layout.nodes.find((n) => n.id === 'prop')!.y).toBeLessThan(
      layout.nodes.find((n) => n.id === 'ar')!.y,
    );
    const br = layout.nodes.find((n) => n.id === 'br')!;
    expect(Math.abs(layout.nodes.find((n) => n.id === 'prop')!.y - br.y)).toBeGreaterThan(40);
    const edges = layout.edges;
    expect(edges.some((e) => e.from === 'prop' && e.to === 'ar')).toBe(true);
    expect(edges.some((e) => e.from === 'prop' && e.to === 'rev')).toBe(false);
  });

  test('parallel prep row shares y and is centred on main axis', () => {
    const project = commercialProjectsMock.find((p) => p.id === 'proj-nev-spring')!;
    const layout = layoutWorkflowGraph(project.workflow);
    const axis = cx('outline', layout);
    expect(sameRow('script', 'pre-shoot', layout)).toBe(true);
    const prep = layout.nodes.filter((n) => n.id === 'script' || n.id === 'pre-shoot');
    expect(Math.abs(layerRowCenter(prep) - axis)).toBeLessThan(TOLERANCE);
    const ranks = rankGroups(layout);
    const prepRank = ranks.find((r) => r.nodes.some((n) => n.id === 'script'))!;
    expect(prepRank.nodes).toHaveLength(2);
    expect(prepRank.nodes[0]!.x).toBeLessThan(prepRank.nodes[1]!.x);
  });

  test('production and post-publish ranks align to axis', () => {
    const project = commercialProjectsMock.find((p) => p.id === 'proj-drink-live')!;
    const layout = layoutWorkflowGraph(project.workflow);
    const axis = cx('pub', layout);
    const prod = layout.nodes.filter((n) => ['ar', 'br', 'ai'].includes(n.id));
    const wind = layout.nodes.filter((n) =>
      ['settle', 'distribute', 'data-care', 'other'].includes(n.id),
    );
    expect(Math.abs(layerRowCenter(prod) - axis)).toBeLessThan(TOLERANCE);
    expect(Math.abs(layerRowCenter(wind) - axis)).toBeLessThan(TOLERANCE);
  });

  test('main-axis serial nodes share centre x', () => {
    const layout = layoutWorkflowGraph(
      createProjectWorkflow({ outline: { status: 'in_progress' } }),
    );
    const axis = cx('inq', layout);
    for (const id of ['outline', 'rev', 'pub']) {
      expect(Math.abs(cx(id, layout) - axis)).toBeLessThan(4);
    }
  });

  test('edges only connect declared parent-child pairs', () => {
    const { edges } = buildWorkflowDag(createProjectWorkflow().steps);
    const keys = new Set(edges.map((e) => `${e.from}->${e.to}`));
    expect(keys.has('inq->outline')).toBe(true);
    expect(keys.has('outline->script')).toBe(true);
    expect(keys.has('prop->rev')).toBe(false);
  });

  test('prop branch collapses synthetic join into prep-to-production edges', () => {
    const project = commercialProjectsMock.find((p) => p.id === 'proj-board-prop')!;
    const { edges } = buildWorkflowDag(project.workflow.steps);
    const collapsed = collapseRoutingEdges(edges);
    const keys = new Set(collapsed.map((e) => `${e.from}->${e.to}`));
    expect(keys.has('script->prop')).toBe(true);
    expect(keys.has('pre-shoot->prop')).toBe(true);
    expect(keys.has('script->br')).toBe(true);
    expect(keys.has('pre-shoot->ai')).toBe(true);
    expect(collapsed.some((e) => e.from.includes('__') || e.to.includes('__'))).toBe(false);
    const layout = layoutWorkflowGraph(project.workflow);
    expect(layout.edges.some((e) => e.from === '__display_junction_prep_prod__')).toBe(true);
    const logical = collapseRoutingEdges(layout.edges);
    expect(new Set(logical.map((e) => `${e.from}->${e.to}`))).toEqual(
      new Set(collapsed.map((e) => `${e.from}->${e.to}`)),
    );
  });

  test('early-stage project still contains grey wind-down nodes', () => {
    const graph = createProjectWorkflow({ outline: { status: 'in_progress' } });
    expect(includesPostPublishWindDown(graph)).toBe(true);
    const layout = layoutWorkflowGraph(graph);
    const settle = layout.nodes.find((n) => n.id === 'settle');
    expect(settle?.node.status).toBe('not_reached');
  });
});
