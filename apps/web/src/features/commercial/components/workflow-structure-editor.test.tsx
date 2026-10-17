import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { commercialProjectsMock } from '../mock-data';
import { indexWorkflowNodes } from '../workflow-edit-logic';
import { collapseRoutingEdges } from '../workflow-graph-flow-layout';
import { workflowGraphToLive } from '../workflow-live-graph';
import { listWorkflowConnections } from '../workflow-structure-logic';
import { useProjectWorkflowEditor, WorkflowGraphEditor } from './workflow-graph-editor';

setDefaultTimeout(30_000);

afterEach(() => cleanup());

function EditorHarness({ projectId }: { projectId: string }) {
  const project = commercialProjectsMock.find((p) => p.id === projectId)!;
  const editor = useProjectWorkflowEditor(project.workflow);
  return <WorkflowGraphEditor editor={editor} />;
}

async function waitForGraphReady(container: HTMLElement) {
  await waitFor(
    () => {
      expect(container.querySelectorAll('.react-flow__edge-path').length).toBeGreaterThan(0);
    },
    { timeout: 15000 },
  );
}

function parseRenderedEdges(container: HTMLElement): Array<{ from: string; to: string }> {
  return [...container.querySelectorAll('.react-flow__edge[aria-label]')].map((el) => {
    const label = el.getAttribute('aria-label') ?? '';
    const match = /^Edge from (.+) to (.+)$/.exec(label);
    if (!match) throw new Error(`Unexpected edge aria-label: ${label}`);
    return { from: match[1]!, to: match[2]! };
  });
}

describe('WorkflowGraphEditor live display', () => {
  test('rendered stages and collapsed edges match the project graph', async () => {
    const project = commercialProjectsMock.find((p) => p.id === 'proj-snack-crisp')!;
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);

    const renderedIds = new Set(
      [...container.querySelectorAll('[data-workflow-node]')].map((el) =>
        el.getAttribute('data-workflow-node')!,
      ),
    );
    expect(renderedIds).toEqual(new Set(indexWorkflowNodes(project.workflow).keys()));
    expect(container.querySelectorAll('.react-flow__edge-path').length).toBe(
      workflowGraphToLive(project.workflow).edges.length,
    );

    const collapsed = collapseRoutingEdges(parseRenderedEdges(container));
    const declared = listWorkflowConnections(project.workflow);
    expect(new Set(collapsed.map((edge) => `${edge.from}->${edge.to}`))).toEqual(
      new Set(declared.map((edge) => `${edge.from}->${edge.to}`)),
    );
    expect(container.querySelector('[data-testid="workflow-add-node"]')).toBeNull();
    expect(container.querySelector('[data-testid="workflow-connect-from"]')).toBeNull();
  });

  test('add and delete shortcuts do not change the graph', async () => {
    const project = commercialProjectsMock.find((p) => p.id === 'proj-snack-crisp')!;
    const before = indexWorkflowNodes(project.workflow).size;
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    const shell = container.querySelector('[data-testid="workflow-live-canvas"]');
    if (!(shell instanceof HTMLElement)) throw new Error('missing canvas');
    fireEvent.keyDown(shell, { key: 'a' });
    fireEvent.keyDown(shell, { key: 'j' });
    fireEvent.keyDown(shell, { key: 'Delete' });
    expect(container.querySelector('[data-testid="workflow-live-notice"]')?.textContent).toContain(
      '留到后续',
    );
    expect(container.querySelectorAll('[data-workflow-node]')).toHaveLength(before);
  });
});
