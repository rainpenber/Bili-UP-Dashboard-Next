import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { commercialProjectsMock } from '../mock-data';
import { JUNCTION_PREP_PROD_ID, JUNCTION_PUB_WIND_ID } from '../workflow-graph-junctions';
import { layoutWorkflowGraph } from '../workflow-graph-flow-layout';
import { WorkflowGraphReadonly } from './workflow-graph-readonly';
import { useProjectWorkflowEditor, WorkflowGraphEditor } from './workflow-graph-editor';

setDefaultTimeout(30_000);

afterEach(() => cleanup());

function viewportTransformRaw(container: HTMLElement): string {
  const vp = container.querySelector('.react-flow__viewport');
  const raw = vp?.getAttribute('style') ?? '';
  return raw.match(/transform:\s*([^;]+)/)?.[1]?.trim() ?? '';
}

async function waitForGraphReady(container: HTMLElement) {
  await waitFor(
    () => {
      expect(container.querySelectorAll('.react-flow__edge-path').length).toBeGreaterThan(0);
    },
    { timeout: 15000 },
  );
}

describe('Workflow graph render quality', () => {
  test('layout still places the two studio junctions', () => {
    for (const id of ['proj-nev-spring', 'proj-board-prop'] as const) {
      const project = commercialProjectsMock.find((p) => p.id === id)!;
      const layout = layoutWorkflowGraph(project.workflow);
      expect(layout.junctions.map((junction) => junction.id).sort()).toEqual(
        [JUNCTION_PREP_PROD_ID, JUNCTION_PUB_WIND_ID].sort(),
      );
    }
  });

  test('gold junction dots stay visible and edges are drawn', async () => {
    for (const id of ['proj-nev-spring', 'proj-drink-live', 'proj-board-prop'] as const) {
      const { container } = render(
        <div style={{ width: 1440, height: 1250 }}>
          <WorkflowGraphReadonly
            graph={commercialProjectsMock.find((p) => p.id === id)!.workflow}
          />
        </div>,
      );
      await waitForGraphReady(container);
      const cores = [...container.querySelectorAll('[data-junction-core]')];
      expect(cores).toHaveLength(2);
      for (const core of cores) {
        const color = getComputedStyle(core).backgroundColor.replace(/\s+/g, '').toLowerCase();
        expect(color === '#e8b15a' || color === 'rgb(232,177,90)').toBe(true);
        const host = core.closest('.react-flow__node') as HTMLElement | null;
        expect(host?.style.width).toBe('10px');
        expect(host?.style.height).toBe('10px');
      }
      const path = container.querySelector('.react-flow__edge-path')?.getAttribute('d') ?? '';
      expect(path.length).toBeGreaterThan(10);
      cleanup();
    }
  });

  test('selecting a node keeps the viewport and drops the old action chrome', async () => {
    function Harness() {
      const project = commercialProjectsMock.find((p) => p.id === 'proj-nev-spring')!;
      const editor = useProjectWorkflowEditor(project.workflow);
      return <WorkflowGraphEditor editor={editor} />;
    }
    const { container } = render(
      <div style={{ width: 861, height: 718 }}>
        <Harness />
      </div>,
    );
    await waitForGraphReady(container);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });
    const before = viewportTransformRaw(container);
    const outline = container.querySelector('[data-workflow-node="outline"]')!;
    fireEvent.click(outline);
    const after = viewportTransformRaw(container);
    expect(after).toBe(before);
    expect(container.querySelector('[data-testid="workflow-node-actions"]')).toBeNull();
    expect(container.querySelector('[data-testid="workflow-structure-panel"]')).toBeNull();
  });
});
