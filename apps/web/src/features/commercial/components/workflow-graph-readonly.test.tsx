import { render, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';
import { commercialProjectsMock } from '../mock-data';
import {
  buildWorkflowDag,
  collapseRoutingEdges,
  layoutWorkflowGraph,
} from '../workflow-graph-flow-layout';
import { WorkflowGraphReadonly } from './workflow-graph-readonly';

const FLOW_START_ID = 'inq';
const TERMINAL_ROW_IDS = new Set(['settle', 'distribute', 'data-care', 'other']);

type EdgePair = { from: string; to: string };

function edgeSet(edges: EdgePair[]): Set<string> {
  return new Set(edges.map((e) => `${e.from}->${e.to}`));
}

function expectSameEdgeSet(actual: EdgePair[], expected: EdgePair[]) {
  expect(edgeSet(actual)).toEqual(edgeSet(expected));
}

function parseRenderedEdges(container: HTMLElement): EdgePair[] {
  return [...container.querySelectorAll('.react-flow__edge[aria-label]')].map((el) => {
    const label = el.getAttribute('aria-label') ?? '';
    const match = /^Edge from (.+) to (.+)$/.exec(label);
    if (!match) {
      throw new Error(`Unexpected edge aria-label: ${label}`);
    }
    return { from: match[1]!, to: match[2]! };
  });
}

function assertRenderedConnectivity(container: HTMLElement, nodeIds: string[]) {
  const edges = parseRenderedEdges(container);
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  for (const id of nodeIds) {
    incoming.set(id, 0);
    outgoing.set(id, 0);
  }
  for (const e of edges) {
    outgoing.set(e.from, (outgoing.get(e.from) ?? 0) + 1);
    incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);
  }
  for (const id of nodeIds) {
    if (id === FLOW_START_ID) {
      expect(incoming.get(id)).toBe(0);
      expect(outgoing.get(id)).toBeGreaterThan(0);
    } else if (TERMINAL_ROW_IDS.has(id)) {
      expect(outgoing.get(id)).toBe(0);
      expect(incoming.get(id)).toBeGreaterThan(0);
    } else {
      expect(incoming.get(id)).toBeGreaterThan(0);
      expect(outgoing.get(id)).toBeGreaterThan(0);
    }
  }
  return edges;
}

function declaredRealEdges(steps: Parameters<typeof buildWorkflowDag>[0]): EdgePair[] {
  const { edges } = buildWorkflowDag(steps);
  return collapseRoutingEdges(edges);
}

describe('WorkflowGraphReadonly render', () => {
  test('serial branch project: rendered graph matches declared connectivity', async () => {
    const project = commercialProjectsMock.find((p) => p.id === 'proj-board-prop')!;
    const layout = layoutWorkflowGraph(project.workflow);
    const declared = declaredRealEdges(project.workflow.steps);
    expect(declared.some((e) => e.from === 'script' && e.to === 'prop')).toBe(true);
    expectSameEdgeSet(collapseRoutingEdges(layout.edges), declared);

    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <WorkflowGraphReadonly graph={project.workflow} />
      </div>,
    );

    await waitFor(
      () => {
        expect(container.querySelectorAll('.react-flow__edge-path').length).toBe(
          layout.edges.length,
        );
      },
      { timeout: 8000 },
    );

    const rendered = assertRenderedConnectivity(
      container,
      layout.nodes.map((n) => n.id),
    );
    const renderedLogical = collapseRoutingEdges(rendered);
    const renderedKeys = new Set(renderedLogical.map((e) => `${e.from}->${e.to}`));
    for (const e of declared) {
      expect(renderedKeys.has(`${e.from}->${e.to}`)).toBe(true);
    }

    const paths = container.querySelectorAll('.react-flow__edge-path');
    const d = paths[0]?.getAttribute('d') ?? '';
    expect(d.length).toBeGreaterThan(10);
    expect(d).not.toBe('M 0 0 L 0 0');
  });

  test('ordinary projects: rendered connectivity has no dead ends except start and terminal row', async () => {
    for (const id of ['proj-nev-spring', 'proj-drink-live'] as const) {
      const project = commercialProjectsMock.find((p) => p.id === id)!;
      const layout = layoutWorkflowGraph(project.workflow);
      const declared = declaredRealEdges(project.workflow.steps);

      const { container } = render(
        <div style={{ width: 1280, height: 900 }}>
          <WorkflowGraphReadonly graph={project.workflow} />
        </div>,
      );
      await waitFor(
        () => {
          expect(container.querySelectorAll('.react-flow__edge-path').length).toBe(
            layout.edges.length,
          );
        },
        { timeout: 5000 },
      );

      const rendered = assertRenderedConnectivity(
        container,
        layout.nodes.map((n) => n.id),
      );
      const renderedLogical = collapseRoutingEdges(rendered);
      const renderedKeys = new Set(renderedLogical.map((e) => `${e.from}->${e.to}`));
      for (const e of declared) {
        expect(renderedKeys.has(`${e.from}->${e.to}`)).toBe(true);
      }
    }
  });
});
