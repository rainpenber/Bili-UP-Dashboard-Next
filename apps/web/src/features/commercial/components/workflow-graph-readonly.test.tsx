import { render, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';
import { commercialProjectsMock } from '../mock-data';
import { collapseRoutingEdges } from '../workflow-graph-flow-layout';
import { workflowGraphToLive } from '../workflow-live-graph';
import { listWorkflowConnections } from '../workflow-structure-logic';
import { WorkflowGraphReadonly } from './workflow-graph-readonly';

const FLOW_START_ID = 'inq';
const TERMINAL_ROW_IDS = new Set(['settle', 'distribute', 'data-care', 'other']);

type EdgePair = { from: string; to: string };

function parseRenderedEdges(container: HTMLElement): EdgePair[] {
  return [...container.querySelectorAll('.react-flow__edge[aria-label]')].map((el) => {
    const label = el.getAttribute('aria-label') ?? '';
    const match = /^Edge from (.+) to (.+)$/.exec(label);
    if (!match) throw new Error(`Unexpected edge aria-label: ${label}`);
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
  for (const edge of edges) {
    outgoing.set(edge.from, (outgoing.get(edge.from) ?? 0) + 1);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
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

describe('WorkflowGraphReadonly render', () => {
  test('serial branch project: rendered graph matches declared connectivity', async () => {
    const project = commercialProjectsMock.find((p) => p.id === 'proj-board-prop')!;
    const declared = listWorkflowConnections(project.workflow);
    expect(declared.some((edge) => edge.from === 'script' && edge.to === 'prop')).toBe(true);
    const live = workflowGraphToLive(project.workflow);

    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <WorkflowGraphReadonly graph={project.workflow} />
      </div>,
    );

    await waitFor(
      () => {
        expect(container.querySelectorAll('.react-flow__edge-path').length).toBe(live.edges.length);
      },
      { timeout: 8000 },
    );

    const rendered = assertRenderedConnectivity(
      container,
      live.nodes.filter((node) => node.kind === 'stage').map((node) => node.id),
    );
    const renderedKeys = new Set(
      collapseRoutingEdges(rendered).map((edge) => `${edge.from}->${edge.to}`),
    );
    for (const edge of declared) {
      expect(renderedKeys.has(`${edge.from}->${edge.to}`)).toBe(true);
    }

    const path = container.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? '';
    expect(path.length).toBeGreaterThan(10);
    expect(path).not.toBe('M 0 0 L 0 0');
  });

  test('ordinary projects: rendered connectivity has no dead ends except start and terminal row', async () => {
    for (const id of ['proj-nev-spring', 'proj-drink-live'] as const) {
      const project = commercialProjectsMock.find((p) => p.id === id)!;
      const declared = listWorkflowConnections(project.workflow);
      const live = workflowGraphToLive(project.workflow);

      const { container } = render(
        <div style={{ width: 1280, height: 900 }}>
          <WorkflowGraphReadonly graph={project.workflow} />
        </div>,
      );
      await waitFor(
        () => {
          expect(container.querySelectorAll('.react-flow__edge-path').length).toBe(
            live.edges.length,
          );
        },
        { timeout: 8000 },
      );

      const rendered = assertRenderedConnectivity(
        container,
        live.nodes.filter((node) => node.kind === 'stage').map((node) => node.id),
      );
      const renderedKeys = new Set(
        collapseRoutingEdges(rendered).map((edge) => `${edge.from}->${edge.to}`),
      );
      for (const edge of declared) {
        expect(renderedKeys.has(`${edge.from}->${edge.to}`)).toBe(true);
      }
    }
  });
});
