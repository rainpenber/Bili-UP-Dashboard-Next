import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { resetDefaultFlowWorkspaceForTests } from '../default-flow-store';
import { DefaultFlowEditor } from './default-flow-editor';

setDefaultTimeout(30_000);

beforeEach(() => {
  resetDefaultFlowWorkspaceForTests();
});

afterEach(() => cleanup());

async function waitForGraphReady(container: HTMLElement) {
  await waitFor(
    () => {
      expect(container.querySelectorAll('.react-flow__edge-path').length).toBeGreaterThan(0);
    },
    { timeout: 15000 },
  );
}

describe('DefaultFlowEditor', () => {
  test('publishing a version keeps the previous version viewable', async () => {
    const { container } = render(
      <div style={{ width: 1280, height: 900 }}>
        <DefaultFlowEditor />
      </div>,
    );
    await waitForGraphReady(container);

    expect(screen.getByTestId('default-flow-demo-notice').textContent).toContain('演示数据');
    expect(screen.getByTestId('default-flow-demo-notice').textContent).toContain('不会静默改写');
    expect(screen.getByTestId('default-flow-version-1')).toBeTruthy();

    const inquiry = container.querySelector('[data-workflow-node="inq"]');
    const shell = container.querySelector('[data-testid="workflow-live-canvas"]');
    if (!inquiry || !(shell instanceof HTMLElement)) throw new Error('missing inquiry canvas');
    fireEvent.click(inquiry);
    fireEvent.keyDown(shell, { key: 'Enter' });
    const input = await within(container).findByTestId('workflow-node-name');
    fireEvent.change(input, { target: { value: '询单回访' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(
        [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
          el.textContent?.includes('询单回访'),
        ),
      ).toBe(true);
    });

    fireEvent.click(screen.getByTestId('default-flow-publish'));
    await waitFor(() => {
      expect(screen.getByTestId('default-flow-version-2')).toBeTruthy();
      expect(screen.getByTestId('default-flow-publish-notice').textContent).toContain('已有项目');
    });

    fireEvent.click(screen.getByTestId('default-flow-view-version-1'));
    await waitFor(() => {
      expect(screen.getByTestId('default-flow-version-view')).toBeTruthy();
    });
    await waitForGraphReady(container);
    expect(
      [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
        el.textContent?.includes('询单回访'),
      ),
    ).toBe(false);

    fireEvent.click(screen.getByTestId('default-flow-view-version-2'));
    await waitFor(() => {
      expect(screen.getByTestId('default-flow-version-view').textContent).toContain('v2');
    });
    await waitForGraphReady(container);
    expect(
      [...container.querySelectorAll('[data-workflow-node]')].some((el) =>
        el.textContent?.includes('询单回访'),
      ),
    ).toBe(true);
  });
});
