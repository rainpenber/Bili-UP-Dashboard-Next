import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { WorkflowMockPage } from '@/pages/workflow-mock-page';

afterEach(() => cleanup());

function openVersion(version: 'v1' | 'v2' | 'v3') {
  fireEvent.change(screen.getByLabelText('版本'), { target: { value: version } });
  fireEvent.click(screen.getByRole('button', { name: '打开' }));
}

describe('workflow mock prototype', () => {
  test('entry is a version box and hides the graph', () => {
    const view = render(<WorkflowMockPage />);
    expect(screen.getByText('流程')).toBeTruthy();
    expect(screen.getByRole('button', { name: '打开' })).toBeTruthy();
    expect(screen.getByLabelText('版本')).toBeTruthy();
    expect(view.container.querySelector('.react-flow')).toBeNull();
    expect(screen.queryByText('询单')).toBeNull();
    expect(screen.queryByText('结构编辑')).toBeNull();
    expect(screen.queryByText('选择节点')).toBeNull();
    expect(view.container.textContent).not.toContain('演示数据');
  });

  test('opening a version shows a port canvas and inert junction anchors', async () => {
    const view = render(<WorkflowMockPage />);
    openVersion('v2');
    await waitFor(() => {
      expect(screen.getByText('样片')).toBeTruthy();
    });
    expect(screen.getByTestId('workflow-mock-open-version').textContent).toBe('V2');
    expect(
      view.container.querySelectorAll('.react-flow__node-stage .react-flow__handle').length,
    ).toBeGreaterThan(0);
    const anchors = view.container.querySelectorAll('[data-workflow-junction="anchor"]');
    expect(anchors.length).toBe(2);
    for (const anchor of anchors) {
      expect(anchor.textContent?.trim()).toBe('');
      const host = anchor.closest('.react-flow__node') as HTMLElement;
      expect(host.style.pointerEvents).toBe('none');
      expect(host.textContent?.trim()).toBe('');
    }
    expect(screen.queryByText('已完成')).toBeNull();
    expect(screen.queryByText('被卡住')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.queryByText('样片')).toBeNull();
    expect(view.container.querySelector('.react-flow')).toBeNull();
  });

  test('opening V1 renders one edge element per model connection', async () => {
    const view = render(<WorkflowMockPage />);
    openVersion('v1');
    await waitFor(() => {
      expect(view.container.querySelectorAll('.react-flow__edge').length).toBe(17);
    });
  });

  test('adds, deletes, and undoes a node from the canvas', async () => {
    render(<WorkflowMockPage />);
    openVersion('v1');
    await waitFor(() => expect(screen.getByText('询单')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '定妆' } });
    fireEvent.submit(screen.getByLabelText('名称').closest('form')!);
    expect(screen.getByText('定妆')).toBeTruthy();

    fireEvent.click(screen.getByText('定妆'));
    fireEvent.click(screen.getByRole('button', { name: '删除' }));
    expect(screen.queryByText('定妆')).toBeNull();

    fireEvent.click(screen.getByTestId('workflow-mock-undo'));
    expect(screen.getByText('定妆')).toBeTruthy();
  });

  test('delete key removes the selected stage and leaves anchors', async () => {
    const view = render(<WorkflowMockPage />);
    openVersion('v1');
    await waitFor(() => expect(screen.getByText('其他')).toBeTruthy());
    fireEvent.click(screen.getByText('其他'));
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.queryByText('其他')).toBeNull();
    expect(view.container.querySelectorAll('[data-workflow-junction="anchor"]').length).toBe(2);

    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '   ' } });
    fireEvent.submit(screen.getByLabelText('名称').closest('form')!);
    expect(screen.getByTestId('workflow-mock-notice').textContent).toBe('需要名称');
  });
});
