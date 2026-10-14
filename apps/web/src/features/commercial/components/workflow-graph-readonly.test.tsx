import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { render, waitFor } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { commercialProjectsMock } from '../mock-data';
import { layoutWorkflowGraph } from '../workflow-graph-flow-layout';
import { WorkflowGraphReadonly } from './workflow-graph-readonly';

beforeAll(() => {
  GlobalRegistrator.register();
});

afterAll(() => {
  GlobalRegistrator.unregister();
});

describe('WorkflowGraphReadonly render', () => {
  test('renders one SVG edge path per layout edge for board prop', async () => {
    const project = commercialProjectsMock.find((p) => p.id === 'proj-board-prop')!;
    const layout = layoutWorkflowGraph(project.workflow);
    expect(layout.edges.length).toBeGreaterThan(0);

    const { container } = render(
      <div style={{ width: 1280, height: 720 }}>
        <WorkflowGraphReadonly graph={project.workflow} />
      </div>,
    );

    await waitFor(
      () => {
        const paths = container.querySelectorAll('.react-flow__edge-path');
        const edgeGroups = container.querySelectorAll('[data-testid^="rf__edge-"]');
        expect(paths.length + edgeGroups.length).toBeGreaterThan(0);
        expect(Math.max(paths.length, edgeGroups.length)).toBe(layout.edges.length);
      },
      { timeout: 8000 },
    );

    const paths = container.querySelectorAll('.react-flow__edge-path');
    const d = paths[0]?.getAttribute('d') ?? '';
    expect(d.length).toBeGreaterThan(10);
    expect(d).not.toBe('M 0 0 L 0 0');
  });

  test('nev spring and drink live render expected edge counts', async () => {
    for (const id of ['proj-nev-spring', 'proj-drink-live'] as const) {
      const project = commercialProjectsMock.find((p) => p.id === id)!;
      const layout = layoutWorkflowGraph(project.workflow);
      const { container } = render(
        <div style={{ width: 1280, height: 720 }}>
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
    }
  });
});
