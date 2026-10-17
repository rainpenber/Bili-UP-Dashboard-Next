import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
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

async function renameNode(container: HTMLElement, nodeId: string, name: string) {
  const card = container.querySelector(`[data-workflow-node="${nodeId}"]`);
  if (!card) throw new Error(`missing node ${nodeId}`);
  fireEvent.click(card);
  const shell = container.querySelector('[data-testid="workflow-live-canvas"]');
  if (!(shell instanceof HTMLElement)) throw new Error('missing canvas');
  fireEvent.keyDown(shell, { key: 'Enter' });
  const input = await within(container).findByTestId('workflow-node-name');
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

describe('WorkflowGraphEditor', () => {
  test('renders demo cards, status colors, junctions, and shortcuts', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);

    const outline = container.querySelector('[data-workflow-node="outline"]');
    expect(outline?.textContent).toContain('大纲');
    expect(outline?.getAttribute('data-workflow-status')).toBe('in_progress');
    expect(outline?.getAttribute('data-status')).toBe('active');
    expect(container.querySelector('[data-workflow-node="inq"]')?.getAttribute('data-status')).toBe(
      'done',
    );
    expect(container.querySelectorAll('[data-junction-core]')).toHaveLength(2);
    expect(container.querySelector('.react-flow__minimap')).toBeTruthy();
    expect(container.querySelector('[data-testid="workflow-live-direction"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="workflow-live-keys"]')?.textContent).toContain(
      '改名',
    );
    expect(container.querySelector('[data-testid="workflow-structure-panel"]')).toBeNull();
    expect(container.querySelector('[data-testid="workflow-complete"]')).toBeNull();
  });

  test('status cells are visible and do not write', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    const outline = container.querySelector('[data-workflow-node="outline"]')!;
    fireEvent.click(outline.querySelector('[data-testid="workflow-node-expand"]')!);
    await waitFor(() => {
      expect(outline.querySelector('[data-testid="workflow-node-status"]')).toBeTruthy();
    });
    expect(outline.querySelectorAll('[data-status-choice]')).toHaveLength(4);
    fireEvent.click(outline.querySelector('[data-status-choice="done"]')!);
    expect(outline.getAttribute('data-workflow-status')).toBe('in_progress');
    expect(outline.getAttribute('data-status')).toBe('active');
  });

  test('blocked nodes show the stored reason and keep the blocked color', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-nev-spring" />
      </div>,
    );
    await waitForGraphReady(container);
    const outline = container.querySelector('[data-workflow-node="outline"]')!;
    expect(outline.getAttribute('data-workflow-status')).toBe('blocked');
    expect(outline.getAttribute('data-status')).toBe('blocked');
    fireEvent.click(outline.querySelector('[data-testid="workflow-node-expand"]')!);
    const reason = await within(container).findByLabelText('阻塞原因');
    expect((reason as HTMLInputElement).value).toContain('甲方反馈写作方向');
    expect((reason as HTMLInputElement).readOnly).toBe(true);
  });

  test('inline rename updates the card and undo restores it', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    await renameNode(container, 'outline', '大纲定稿');
    await waitFor(() => {
      expect(container.querySelector('[data-workflow-node="outline"]')?.textContent).toContain(
        '大纲定稿',
      );
    });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => {
      const text = container.querySelector('[data-workflow-node="outline"]')?.textContent ?? '';
      expect(text).toContain('大纲');
      expect(text).not.toContain('大纲定稿');
    });
    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });
    await waitFor(() => {
      expect(container.querySelector('[data-workflow-node="outline"]')?.textContent).toContain(
        '大纲定稿',
      );
    });
  });

  test('empty and duplicate names are refused', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    await renameNode(container, 'outline', '   ');
    await waitFor(() => {
      expect(within(container).getByTestId('workflow-action-error').textContent).toContain(
        '不能为空',
      );
    });
    expect(within(container).getByTestId('workflow-node-name')).toBeTruthy();
    fireEvent.keyDown(within(container).getByTestId('workflow-node-name'), { key: 'Escape' });
    await renameNode(container, 'outline', '询单');
    await waitFor(() => {
      expect(within(container).getByTestId('workflow-action-error').textContent).toContain('唯一');
    });
    fireEvent.keyDown(within(container).getByTestId('workflow-node-name'), { key: 'Escape' });
    await waitFor(() => {
      expect(within(container).queryByTestId('workflow-node-name')).toBeNull();
    });
    const outline = container.querySelector('[data-workflow-node="outline"]')?.textContent ?? '';
    expect(outline).toContain('大纲');
    expect(outline).not.toContain('询单');
  });

  test('direction switch marks the canvas vertical', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    fireEvent.click(container.querySelector('[data-direction="tb"]')!);
    await waitFor(() => {
      expect(container.querySelector('.workflow-mock-flow')?.className).toContain('is-vertical');
    });
    expect(container.querySelectorAll('[data-junction-core]')).toHaveLength(2);
    const shell = container.querySelector('[data-testid="workflow-live-canvas"]');
    if (!(shell instanceof HTMLElement)) throw new Error('missing canvas');
    fireEvent.keyDown(shell, { key: 'l' });
    fireEvent.keyDown(shell, { key: 'f' });
    expect(container.querySelectorAll('.react-flow__edge-path').length).toBeGreaterThan(0);
  });
});
