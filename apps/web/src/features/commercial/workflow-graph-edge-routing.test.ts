import { describe, expect, test } from 'bun:test';
import { commercialProjectsMock } from './mock-data';
import { countEdgeEdgeCrossings, countNonOrthogonalSegments } from './workflow-graph-edge-geometry';
import { buildRoutedEdgeData } from './workflow-graph-edge-routing';
import { layoutWorkflowGraph } from './workflow-graph-flow-layout';

function pathsForProject(projectId: string): string[] {
  const project = commercialProjectsMock.find((p) => p.id === projectId)!;
  const layout = layoutWorkflowGraph(project.workflow);
  const routed = buildRoutedEdgeData(layout);
  return [...routed.values()].map((m) => m.path!).filter(Boolean);
}

describe('workflow graph bus routing', () => {
  for (const id of ['proj-nev-spring', 'proj-drink-live', 'proj-board-prop'] as const) {
    test(`${id}: orthogonal paths with zero edge crossings`, () => {
      const paths = pathsForProject(id);
      expect(countNonOrthogonalSegments(paths)).toBe(0);
      expect(countEdgeEdgeCrossings(paths)).toBe(0);
    });
  }
});
