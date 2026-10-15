import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { commercialProjectsMock } from '../mock-data';
import { deriveWorkflowSummary } from '../workflow-edit-logic';
import { useProjectWorkflowEditor, WorkflowGraphEditor } from './workflow-graph-editor';

setDefaultTimeout(30_000);

afterEach(() => cleanup());

function EditorHarness({ projectId }: { projectId: string }) {
  const project = commercialProjectsMock.find((p) => p.id === projectId)!;
  const editor = useProjectWorkflowEditor(project.workflow);
  const summary = deriveWorkflowSummary(editor.graph);
  const statusText = summary.blockingReason
    ? `当前状态：${summary.statusHeadline}，阻塞原因：${summary.blockingReason}`
    : `当前状态：${summary.statusHeadline}`;

  return (
    <div>
      <p data-testid="summary-status-text">{statusText}</p>
      {summary.mainBlockingItem ? (
        <p data-testid="summary-blocking-item">{summary.mainBlockingItem}</p>
      ) : null}
      <WorkflowGraphEditor editor={editor} />
    </div>
  );
}

async function waitForGraphReady(container: HTMLElement) {
  await waitFor(
    () => {
      expect(container.querySelectorAll('.react-flow__edge-path').length).toBeGreaterThan(0);
    },
    { timeout: 15000 },
  );
}

async function selectNode(container: HTMLElement, nodeId: string) {
  const card = container.querySelector(`[data-workflow-node="${nodeId}"]`);
  if (!card) throw new Error(`missing node ${nodeId}`);
  await act(async () => {
    fireEvent.click(card);
  });
  await waitFor(() => {
    expect(container.querySelector('[data-testid="workflow-node-actions"]')).toBeTruthy();
  });
}

describe('WorkflowGraphEditor', () => {
  test('complete updates DOM, detail panel and summary', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    await selectNode(container, 'outline');
    fireEvent.click(screen.getByTestId('workflow-complete'));
    await waitFor(() => {
      expect(
        container
          .querySelector('[data-workflow-node="outline"]')
          ?.getAttribute('data-workflow-status'),
      ).toBe('done');
    });
  });

  test('start shows predecessor confirmation instead of dead-end error', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    await selectNode(container, 'script');
    fireEvent.click(screen.getByTestId('workflow-start'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-predecessor-confirm')).toBeTruthy();
    });
    expect(screen.queryByTestId('workflow-action-error')).toBeNull();
    fireEvent.click(screen.getByTestId('workflow-predecessor-confirm-yes'));
    await waitFor(() => {
      expect(
        container
          .querySelector('[data-workflow-node="script"]')
          ?.getAttribute('data-workflow-status'),
      ).toBe('in_progress');
    });
  });

  test('blocking requires reason and clearing removes it from DOM', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    await selectNode(container, 'outline');
    fireEvent.click(screen.getByTestId('workflow-block-submit'));
    expect(screen.getByTestId('workflow-action-error').textContent).toContain('不能为空');

    fireEvent.change(screen.getByTestId('workflow-block-reason-input'), {
      target: { value: '等甲方确认口播' },
    });
    fireEvent.click(screen.getByTestId('workflow-block-submit'));
    await waitFor(() => {
      expect(
        container
          .querySelector('[data-workflow-node="outline"]')
          ?.getAttribute('data-workflow-status'),
      ).toBe('blocked');
      expect(screen.getByTestId('summary-blocking-item').textContent).toContain('等甲方确认口播');
    });
    fireEvent.click(screen.getByTestId('workflow-clear-block'));
    await waitFor(() => {
      expect(
        container
          .querySelector('[data-workflow-node="outline"]')
          ?.getAttribute('data-workflow-status'),
      ).toBe('in_progress');
    });
  });

  test('undo and redo restore rendered node status', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    const before = container
      .querySelector('[data-workflow-node="outline"]')
      ?.getAttribute('data-workflow-status');
    await selectNode(container, 'outline');
    fireEvent.click(screen.getByTestId('workflow-complete'));
    await waitFor(() => {
      expect(
        container
          .querySelector('[data-workflow-node="outline"]')
          ?.getAttribute('data-workflow-status'),
      ).toBe('done');
    });
    fireEvent.click(screen.getByTestId('workflow-undo'));
    await waitFor(() => {
      expect(
        container
          .querySelector('[data-workflow-node="outline"]')
          ?.getAttribute('data-workflow-status'),
      ).toBe(before);
    });
    fireEvent.click(screen.getByTestId('workflow-redo'));
    await waitFor(() => {
      expect(
        container
          .querySelector('[data-workflow-node="outline"]')
          ?.getAttribute('data-workflow-status'),
      ).toBe('done');
    });
  });

  test('shows start and complete buttons only when meaningful', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitForGraphReady(container);
    await selectNode(container, 'outline');
    expect(screen.queryByTestId('workflow-start')).toBeNull();
    expect(screen.getByTestId('workflow-complete')).toBeTruthy();
    await selectNode(container, 'script');
    expect(screen.getByTestId('workflow-start')).toBeTruthy();
    expect(screen.queryByTestId('workflow-complete')).toBeNull();
  });
});
