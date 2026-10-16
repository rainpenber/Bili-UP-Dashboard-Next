import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(view.container.querySelectorAll('[data-workflow-junction="anchor"]').length).toBe(2);
    expect(screen.getByTestId('workflow-mock-tidy')).toBeTruthy();
    expect(screen.getByTestId('workflow-mock-fit')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '添加' })).toBeNull();
    expect(view.container.querySelector('.react-flow__minimap')).toBeTruthy();
  });

  test('opening V1 renders one edge element per model connection', async () => {
    const view = render(<WorkflowMockPage />);
    openVersion('v1');
    await waitFor(() => {
      expect(view.container.querySelectorAll('.react-flow__edge').length).toBe(17);
    });
  });

  test('enter edits the selected stage, then confirms the name', async () => {
    render(<WorkflowMockPage />);
    openVersion('v1');
    await waitFor(() => expect(screen.getByText('询单')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'Enter' });
    expect(screen.queryByLabelText('名称')).toBeNull();

    fireEvent.click(screen.getByText('询单'));
    fireEvent.keyDown(window, { key: 'Enter' });
    const name = screen.getByLabelText('名称');
    expect(name.getAttribute('rows')).toBe('1');
    expect(name.closest('[data-stage-align="true"]')).toBeTruthy();
    fireEvent.change(name, { target: { value: '来单' } });
    fireEvent.keyDown(name, { key: 'Enter' });
    expect(screen.getByText('来单')).toBeTruthy();
    expect(screen.queryByLabelText('名称')).toBeNull();

    const card = screen.getByText('来单').closest('[data-workflow-node="stage"]') as HTMLElement;
    fireEvent.click(card.querySelector('[data-testid="workflow-node-expand"]')!);
    const reason = screen.getByLabelText('阻塞原因');
    reason.focus();
    fireEvent.keyDown(reason, { key: 'Enter' });
    expect(screen.queryByLabelText('名称')).toBeNull();
  });

  test('adds, deletes, and undoes a node from the canvas', async () => {
    render(<WorkflowMockPage />);
    openVersion('v1');
    await waitFor(() => expect(screen.getByText('询单')).toBeTruthy());

    fireEvent.keyDown(window, { key: 'a' });
    const nameInput = screen.getByLabelText('名称');
    expect(nameInput.closest('[data-workflow-node="stage"]')).toBeTruthy();
    fireEvent.change(nameInput, { target: { value: '定妆' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(screen.getByText('定妆')).toBeTruthy();

    fireEvent.click(screen.getByText('定妆'));
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(screen.queryByText('定妆')).toBeNull();

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
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

    fireEvent.keyDown(window, { key: 'j' });
    expect(view.container.querySelectorAll('[data-workflow-junction="anchor"]').length).toBe(3);
    const edgesBeforeTidy = view.container.querySelectorAll('.react-flow__edge').length;
    fireEvent.keyDown(window, { key: 'l' });
    expect(view.container.querySelectorAll('.react-flow__edge').length).toBe(edgesBeforeTidy);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    expect(view.container.querySelectorAll('[data-workflow-junction="anchor"]').length).toBe(2);

    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.blur(screen.getByLabelText('名称'));
    expect(screen.getByText('流程节点')).toBeTruthy();
    const card = screen
      .getByText('流程节点')
      .closest('[data-workflow-node="stage"]') as HTMLElement;
    expect(card.className).toContain('max-w-[200px]');
    expect(card.className).toContain('break-all');
    expect(card.className).toContain('workflow-pop');
    fireEvent.click(card.querySelector('[data-testid="workflow-node-expand"]')!);
    expect(screen.getByText('状态')).toBeTruthy();
    expect(screen.getByText('阻塞原因')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '前进' }));
    expect(screen.getByTestId('workflow-node-status').textContent).toBe('进行');
    fireEvent.click(screen.getByRole('button', { name: '阻塞' }));
    expect(screen.getByTestId('workflow-node-status').textContent).toBe('卡住');
    fireEvent.click(screen.getByRole('button', { name: '完成' }));
    expect(screen.getByTestId('workflow-node-status').textContent).toBe('完成');

    const before = view.container.querySelectorAll('[data-workflow-node="stage"]').length;
    fireEvent.keyDown(window, { key: 'a' });
    const draft = screen.getByLabelText('名称');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(document.activeElement).toBe(draft);
    fireEvent.keyDown(draft, { key: 'Escape' });
    expect(screen.queryByLabelText('名称')).toBeNull();
    expect(view.container.querySelectorAll('[data-workflow-node="stage"]').length).toBe(before);

    fireEvent.contextMenu(screen.getByText('询单'));
    fireEvent.click(await screen.findByText('修改节点名称'));
    const rename = screen.getByLabelText('名称');
    fireEvent.change(rename, { target: { value: '来询' } });
    fireEvent.blur(rename);
    expect(screen.getByText('来询')).toBeTruthy();

    fireEvent.contextMenu(view.container.querySelector('.react-flow__pane')!);
    const menu = await screen.findByText('增加节点');
    expect(menu.closest('[data-slot="context-menu-content"]')?.className).toContain(
      'bg-background',
    );
    expect(menu.closest('[data-slot="context-menu-content"]')?.className).toContain(
      'text-foreground',
    );
  });
});
