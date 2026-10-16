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
    const anchors = view.container.querySelectorAll<HTMLElement>(
      '[data-workflow-junction="anchor"]',
    );
    expect(anchors.length).toBe(2);
    for (const anchor of anchors) {
      expect(anchor.textContent?.replace(/\s/g, '')).toBe('inout');
      expect(anchor.style.opacity).not.toBe('0');
      expect(anchor.style.pointerEvents).not.toBe('none');
      expect(parseFloat(anchor.style.width)).toBeGreaterThanOrEqual(10);
      const host = anchor.closest('.react-flow__node') as HTMLElement;
      expect(host.style.pointerEvents).not.toBe('none');
      expect(host.style.opacity).not.toBe('0');
      expect(host.textContent?.replace(/\s/g, '')).toBe('inout');
    }
    expect(screen.queryByText('已完成')).toBeNull();
    expect(screen.queryByText('被卡住')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '返回' }));
    expect(screen.queryByText('样片')).toBeNull();
    expect(view.container.querySelector('.react-flow')).toBeNull();
  });

  test('junction ports are beside the dot and the context menu can add one', async () => {
    const view = render(<WorkflowMockPage />);
    openVersion('v1');
    await waitFor(() => {
      expect(view.container.querySelectorAll('.react-flow__edge').length).toBe(17);
    });
    const anchor = view.container.querySelector('[data-workflow-junction="anchor"]');
    expect(anchor?.querySelector('[data-port="in"]')).toBeTruthy();
    expect(anchor?.querySelector('[data-port="out"]')).toBeTruthy();
    expect(anchor?.textContent).toContain('in');
    expect(anchor?.textContent).toContain('out');
    expect(anchor?.querySelector('[data-junction-core="true"]')?.className).not.toContain(
      'react-flow__handle',
    );

    const pane = view.container.querySelector('.react-flow__pane');
    expect(pane).toBeTruthy();
    fireEvent.contextMenu(pane!);
    const add = await screen.findByText('增加汇合点');
    fireEvent.click(add);
    await waitFor(() => {
      expect(view.container.querySelectorAll('[data-workflow-junction="anchor"]').length).toBe(3);
    });
    fireEvent.click(screen.getByTestId('workflow-mock-undo'));
    expect(view.container.querySelectorAll('[data-workflow-junction="anchor"]').length).toBe(2);
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
