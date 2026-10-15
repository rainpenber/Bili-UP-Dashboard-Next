import { describe, expect, test } from 'bun:test';
import { commercialProjectsMock } from './mock-data';
import {
  countCurveCommands,
  countEdgeEdgeCrossings,
  countNonOrthogonalSegments,
} from './workflow-graph-edge-geometry';
import { buildRoutedEdgeData, junctionMeetingPoints } from './workflow-graph-edge-routing';
import { layoutWorkflowGraph, type WorkflowGraphLayout } from './workflow-graph-flow-layout';
import { JUNCTION_PREP_PROD_ID, JUNCTION_PUB_WIND_ID } from './workflow-graph-junctions';

function pathsForProject(projectId: string): string[] {
  const project = commercialProjectsMock.find((p) => p.id === projectId)!;
  const layout = layoutWorkflowGraph(project.workflow);
  const routed = buildRoutedEdgeData(layout);
  return [...routed.values()].map((m) => m.path!).filter(Boolean);
}

function pathSegments(d: string): { x1: number; y1: number; x2: number; y2: number }[] {
  const tokens = d.match(/[ML]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return [];
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  let i = 0;
  let cx = 0;
  let cy = 0;
  let started = false;
  while (i < tokens.length) {
    const tok = tokens[i]!;
    if (/^[ML]$/i.test(tok)) {
      const cmd = tok.toUpperCase();
      i += 1;
      const x = parseFloat(tokens[i++]!);
      const y = parseFloat(tokens[i++]!);
      if (cmd === 'L' && started) segs.push({ x1: cx, y1: cy, x2: x, y2: y });
      cx = x;
      cy = y;
      started = true;
    } else {
      i += 1;
    }
  }
  return segs;
}

/** Meeting points derived from incident node centers, independent of the helper. */
function expectedMeetingPoints(layout: WorkflowGraphLayout): { x: number; y: number }[] {
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const dots: { x: number; y: number }[] = [];
  for (const junctionId of [JUNCTION_PREP_PROD_ID, JUNCTION_PUB_WIND_ID]) {
    const sources: string[] = [];
    const targets: string[] = [];
    for (const e of layout.edges) {
      if (e.to === junctionId) sources.push(e.from);
      if (e.from === junctionId) targets.push(e.to);
    }
    if (sources.length === 0 || targets.length === 0) continue;
    const aboveBottom = Math.max(
      ...sources.map((id) => {
        const n = byId.get(id)!;
        return n.y + n.height;
      }),
    );
    const belowTop = Math.min(...targets.map((id) => byId.get(id)!.y));
    const y = aboveBottom + (belowTop - aboveBottom) / 2;
    const xs = new Set(
      [...sources, ...targets].map((id) => {
        const n = byId.get(id)!;
        return n.x + n.width / 2;
      }),
    );
    for (const x of [...xs].sort((a, b) => a - b)) dots.push({ x, y });
  }
  return dots;
}

function busIsCovered(paths: string[], points: { x: number; y: number }[]): boolean {
  if (points.length < 2) return true;
  const y = points[0]!.y;
  const minX = points[0]!.x;
  const maxX = points[points.length - 1]!.x;
  return paths.some((d) =>
    pathSegments(d).some(
      (s) =>
        Math.abs(s.y1 - y) <= 0.01 &&
        Math.abs(s.y2 - y) <= 0.01 &&
        Math.min(s.x1, s.x2) <= minX + 0.01 &&
        Math.max(s.x1, s.x2) >= maxX - 0.01,
    ),
  );
}

describe('workflow graph bus routing', () => {
  for (const id of ['proj-nev-spring', 'proj-drink-live', 'proj-board-prop'] as const) {
    test(`${id}: orthogonal paths with zero edge crossings`, () => {
      const paths = pathsForProject(id);
      expect(countCurveCommands(paths)).toBe(0);
      expect(countNonOrthogonalSegments(paths)).toBe(0);
      expect(countEdgeEdgeCrossings(paths)).toBe(0);
    });

    test(`${id}: connector stroke covers each bus and dots sit on meeting points`, () => {
      const project = commercialProjectsMock.find((p) => p.id === id)!;
      const layout = layoutWorkflowGraph(project.workflow);
      const expected = expectedMeetingPoints(layout);
      const actual = [
        ...junctionMeetingPoints(layout, JUNCTION_PREP_PROD_ID),
        ...junctionMeetingPoints(layout, JUNCTION_PUB_WIND_ID),
      ];
      expect(actual).toEqual(expected);
      expect(expected.length).toBeGreaterThan(0);
      const routed = buildRoutedEdgeData(layout);
      const paths = [...routed.values()].map((m) => m.path!).filter(Boolean);
      const prep = expected.filter((p) => p.y === expected[0]!.y);
      const pub = expected.filter((p) => p.y !== expected[0]!.y);
      expect(busIsCovered(paths, prep)).toBe(true);
      expect(busIsCovered(paths, pub)).toBe(true);
    });
  }

  test('vertical stubs stay put; only the bus run is added to the connector', () => {
    const project = commercialProjectsMock.find((p) => p.id === 'proj-nev-spring')!;
    const layout = layoutWorkflowGraph(project.workflow);
    const routed = buildRoutedEdgeData(layout);
    expect(routed.get('e-inq-outline')?.path).toBe('M 418 84 L 418 98 L 418 112');
    expect(routed.get('e-script-__display_junction_prep_prod__')?.path).toBe('M 316 228 L 316 242');
    expect(routed.get('e-__display_junction_prep_prod__-ar')?.path).toBe(
      'M 622 242 L 214 242 L 214 256',
    );
    expect(routed.get('e-pub-__display_junction_pub_wind__')?.path).toBe('M 418 444 L 418 458');
    expect(routed.get('e-__display_junction_pub_wind__-settle')?.path).toBe(
      'M 724 458 L 112 458 L 112 472',
    );
  });
});
