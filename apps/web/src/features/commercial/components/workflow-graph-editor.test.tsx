import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test } from 'bun:test';
import { commercialProjectsMock } from '../mock-data';
import { deriveWorkflowSummary } from '../workflow-edit-logic';
import { useProjectWorkflowEditor, WorkflowGraphEditor } from './workflow-graph-editor';

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
      {summary.inProgressNodeNames.length > 0 ? (
        <p data-testid="summary-in-progress">{summary.inProgressNodeNames.join('、')}</p>
      ) : null}
      {summary.mainBlockingItem ? (
        <p data-testid="summary-blocking-item">{summary.mainBlockingItem}</p>
      ) : null}
      <WorkflowGraphEditor editor={editor} />
    </div>
  );
}

async function selectNode(container: HTMLElement, nodeId: string) {
  const card = container.querySelector(`[data-workflow-node="${nodeId}"]`);
  if (!card) throw new Error(`missing node ${nodeId}`);
  const rfNode = card.closest('.react-flow__node') ?? card;
  fireEvent.click(rfNode);
  await waitFor(() => {
    expect(screen.getByTestId('workflow-detail-name').textContent).toBe(
      card.querySelector('p')?.textContent ?? nodeId,
    );
  });
}

describe('WorkflowGraphEditor', () => {
  test('advancing a node updates DOM, detail panel and summary', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-workflow-node="outline"]')).toBeTruthy();
    });
    await selectNode(container, 'outline');
    fireEvent.click(screen.getByTestId('workflow-advance'));
    await waitFor(() => {
      const card = container.querySelector('[data-workflow-node="outline"]');
      expect(card?.getAttribute('data-workflow-status')).toBe('done');
      expect(screen.getByTestId('workflow-detail-status').textContent).toBe('已完成');
    });
    expect(screen.getByTestId('summary-status-text').textContent).not.toContain('大纲');
  });

  test('advance shows visible reason when predecessor not done', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-workflow-node="script"]')).toBeTruthy();
    });
    await selectNode(container, 'script');
    fireEvent.click(screen.getByTestId('workflow-advance'));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-action-error').textContent).toContain('大纲');
    });
  });

  test('blocking requires reason and clearing removes it from DOM', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-workflow-node="outline"]')).toBeTruthy();
    });
    await selectNode(container, 'outline');
    fireEvent.click(screen.getByTestId('workflow-block-submit'));
    expect(screen.getByTestId('workflow-action-error').textContent).toContain('不能为空');

    fireEvent.change(screen.getByTestId('workflow-block-reason-input'), {
      target: { value: '等甲方确认口播' },
    });
    fireEvent.click(screen.getByTestId('workflow-block-submit'));
    await waitFor(() => {
      const card = container.querySelector('[data-workflow-node="outline"]');
      expect(card?.getAttribute('data-workflow-status')).toBe('blocked');
      expect(card?.getAttribute('data-blocking-reason')).toBe('等甲方确认口播');
      expect(screen.getByTestId('workflow-detail-blocking-reason').textContent).toBe(
        '等甲方确认口播',
      );
      expect(screen.getByTestId('summary-blocking-item').textContent).toContain('等甲方确认口播');
    });

    fireEvent.click(screen.getByTestId('workflow-clear-block'));
    await waitFor(() => {
      const card = container.querySelector('[data-workflow-node="outline"]');
      expect(card?.getAttribute('data-workflow-status')).toBe('in_progress');
      expect(card?.hasAttribute('data-blocking-reason')).toBe(false);
    });
  });

  test('undo and redo restore rendered node status', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <EditorHarness projectId="proj-snack-crisp" />
      </div>,
    );
    await waitFor(() => {
      expect(container.querySelector('[data-workflow-node="outline"]')).toBeTruthy();
    });
    const before = container
      .querySelector('[data-workflow-node="outline"]')
      ?.getAttribute('data-workflow-status');
    await selectNode(container, 'outline');
    fireEvent.click(screen.getByTestId('workflow-advance'));
    await waitFor(() => {
      expect(
        container
          .querySelector('[data-workflow-node="outline"]')
          ?.getAttribute('data-workflow-status'),
      ).toBe('done');
    });
    await waitFor(() => {
      expect((screen.getByTestId('workflow-undo') as HTMLButtonElement).disabled).toBe(false);
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
});
