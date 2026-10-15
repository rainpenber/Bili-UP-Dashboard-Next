import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { commercialProjectsMock } from '../mock-data';
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

function renderedNodeIds(container: HTMLElement): Set<string> {
  return new Set(
    [...container.querySelectorAll('[data-workflow-node]')].map((el) =>
      el.getAttribute('data-workflow-node')!,
    ),
  );
}

function connectionListPairs(): Array<{ from: string; to: string }> {
  return [
    ...screen.getByTestId('workflow-connection-list').querySelectorAll('[data-connection]'),
  ].map((el) => {
    const raw = el.getAttribute('data-connection')!;
    const [from, to] = raw.split('->');
    return { from: from!, to: to! };
  });
}

async function selectNode(container: HTMLElement, nodeId: string) {
  const card = container.querySelector(`[data-workflow-node="${nodeId}"]`);
  if (!card) throw new Error(`missing node ${nodeId}`);
  await act(async () => {
    fireEvent.click(card);
  });
  await waitFor(() => {
    expect(screen.getByTestId('workflow-detail-name')).toBeTruthy();
  });
}

describe('WorkflowGraphEditor structural editing', () => {
  test('add node appears in DOM and connection list; undo restores structure', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    const beforeNodes = renderedNodeIds(container);
    const beforeEdges = parseRenderedEdges(container);

    fireEvent.change(screen.getByTestId('workflow-add-node-name'), {
      target: { value: '样片预审' },
    });
    fireEvent.click(screen.getByTestId('workflow-add-node'));

    await waitFor(() => {
      const nodes = renderedNodeIds(container);
      expect([...nodes].some((id) => !beforeNodes.has(id))).toBe(true);
      expect(
        [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
          el.textContent?.includes('样片预审'),
        ),
      ).toBe(true);
    });

    const afterAddEdges = parseRenderedEdges(container);
    expect(afterAddEdges.length).toBeGreaterThan(beforeEdges.length);

    fireEvent.click(screen.getByTestId('workflow-undo'));
    await waitFor(() => {
      expect(renderedNodeIds(container)).toEqual(beforeNodes);
      const restored = parseRenderedEdges(container);
      expect(new Set(restored.map((e) => `${e.from}->${e.to}`))).toEqual(
        new Set(beforeEdges.map((e) => `${e.from}->${e.to}`)),
      );
    });

    fireEvent.click(screen.getByTestId('workflow-redo'));
    await waitFor(() => {
      expect(
        [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
          el.textContent?.includes('样片预审'),
        ),
      ).toBe(true);
    });
  });

  test('duplicate name and cycle connection are refused with readable messages', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    const beforeEdges = new Set(parseRenderedEdges(container).map((e) => `${e.from}->${e.to}`));

    fireEvent.change(screen.getByTestId('workflow-add-node-name'), {
      target: { value: '大纲' },
    });
    fireEvent.click(screen.getByTestId('workflow-add-node'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-action-error').textContent).toContain('唯一');
    });

    fireEvent.change(screen.getByTestId('workflow-connect-from'), {
      target: { value: 'script' },
    });
    fireEvent.change(screen.getByTestId('workflow-connect-to'), {
      target: { value: 'inq' },
    });
    fireEvent.click(screen.getByTestId('workflow-connect'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-action-error').textContent).toContain('环路');
    });
    const afterRefuse = new Set(parseRenderedEdges(container).map((e) => `${e.from}->${e.to}`));
    expect(afterRefuse).toEqual(beforeEdges);
  });

  test('deleting a connected node lists connections and only proceeds after confirm', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    await selectNode(container, 'outline');
    fireEvent.click(screen.getByTestId('workflow-delete-node'));

    const dialog = await screen.findByTestId('workflow-delete-confirm');
    expect(dialog.textContent).toContain('询单');
    expect(dialog.textContent).toContain('大纲');
    expect(container.querySelector('[data-workflow-node="outline"]')).toBeTruthy();

    fireEvent.click(screen.getByTestId('workflow-delete-confirm-cancel'));
    await waitFor(() => {
      expect(screen.queryByTestId('workflow-delete-confirm')).toBeNull();
    });
    expect(container.querySelector('[data-workflow-node="outline"]')).toBeTruthy();

    fireEvent.click(screen.getByTestId('workflow-delete-node'));
    await screen.findByTestId('workflow-delete-confirm');
    fireEvent.click(screen.getByTestId('workflow-delete-confirm-yes'));
    await waitFor(() => {
      expect(container.querySelector('[data-workflow-node="outline"]')).toBeNull();
    });
    const edges = parseRenderedEdges(container);
    expect(edges.some((e) => e.from === 'outline' || e.to === 'outline')).toBe(false);
  });

  test('connect and disconnect update rendered endpoints between real nodes', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);

    fireEvent.change(screen.getByTestId('workflow-add-node-name'), {
      target: { value: '独立节点' },
    });
    fireEvent.click(screen.getByTestId('workflow-add-node'));
    await waitFor(() => {
      expect(
        [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
          el.textContent?.includes('独立节点'),
        ),
      ).toBe(true);
    });

    const customCard = [...container.querySelectorAll('[data-workflow-node]')].find((el) =>
      el.textContent?.includes('独立节点'),
    )!;
    const customId = customCard.getAttribute('data-workflow-node')!;

    // Disconnect sink→new edges so we can assert a fresh connect.
    for (const pair of connectionListPairs().filter((c) => c.to === customId)) {
      fireEvent.change(screen.getByTestId('workflow-connect-from'), {
        target: { value: pair.from },
      });
      fireEvent.change(screen.getByTestId('workflow-connect-to'), {
        target: { value: customId },
      });
      fireEvent.click(screen.getByTestId('workflow-disconnect'));
    }

    await waitFor(() => {
      expect(parseRenderedEdges(container).some((e) => e.to === customId)).toBe(false);
    });

    fireEvent.change(screen.getByTestId('workflow-connect-from'), {
      target: { value: 'inq' },
    });
    fireEvent.change(screen.getByTestId('workflow-connect-to'), {
      target: { value: customId },
    });
    fireEvent.click(screen.getByTestId('workflow-connect'));

    await waitFor(() => {
      const edges = parseRenderedEdges(container);
      expect(edges.some((e) => e.from === 'inq' && e.to === customId)).toBe(true);
      expect(
        within(screen.getByTestId('workflow-connection-list')).getByText(/询单 → 独立节点/),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByTestId('workflow-disconnect'));
    await waitFor(() => {
      expect(parseRenderedEdges(container).some((e) => e.from === 'inq' && e.to === customId)).toBe(
        false,
      );
    });
  });
});
