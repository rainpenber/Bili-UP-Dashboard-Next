import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { NodeActionPanel } from './node-action-panel';
import type { WorkflowApiStatus } from '../types';

afterEach(() => cleanup());

function renderPanel(
  status: WorkflowApiStatus,
  extra?: { isOptional?: boolean; isPublishNode?: boolean },
) {
  render(
    <NodeActionPanel
      status={status}
      isOptional={extra?.isOptional ?? false}
      isPublishNode={extra?.isPublishNode ?? false}
      pending={false}
      onCommand={() => {}}
      onBlock={() => {}}
      onPublish={() => {}}
    />,
  );
}

describe('node action panel', () => {
  test('not_reached shows 推进 and hides skip until the node is optional', () => {
    renderPanel('not_reached');
    expect(screen.getByTestId('workflow-action-advance').textContent).toContain('推进');
    expect(screen.queryByTestId('workflow-action-skip')).toBeNull();
    cleanup();
    renderPanel('not_reached', { isOptional: true });
    expect(screen.getByTestId('workflow-action-skip').textContent).toContain('不适用');
  });

  test('in_progress shows complete, rollback, and block, including an empty reason field', () => {
    renderPanel('in_progress');
    expect(screen.getByTestId('workflow-action-complete').textContent).toContain('完成');
    expect(screen.getByTestId('workflow-action-rollback').textContent).toContain('回退');
    expect(screen.getByTestId('workflow-block-reason-input')).toBeTruthy();
    expect(screen.getByTestId('workflow-block-submit').textContent).toContain('阻塞');
    expect(screen.queryByTestId('workflow-action-advance')).toBeNull();
  });

  test('a publish node asks for the video instead of calling complete', () => {
    renderPanel('in_progress', { isPublishNode: true });
    expect(screen.getByTestId('publish-form')).toBeTruthy();
    expect(screen.queryByTestId('workflow-action-complete')).toBeNull();
  });

  test('completed and not_applicable only offer rollback', () => {
    renderPanel('completed');
    expect(screen.getByTestId('workflow-action-rollback')).toBeTruthy();
    expect(screen.queryByTestId('workflow-action-complete')).toBeNull();
    cleanup();
    renderPanel('not_applicable', { isOptional: true });
    expect(screen.getByTestId('workflow-action-rollback')).toBeTruthy();
    expect(screen.queryByTestId('workflow-action-skip')).toBeNull();
  });

  test('blocked only offers unblock', () => {
    renderPanel('blocked');
    expect(screen.getByTestId('workflow-action-unblock').textContent).toContain('解除阻塞');
    expect(screen.queryByTestId('workflow-action-rollback')).toBeNull();
    expect(screen.queryByTestId('workflow-block-submit')).toBeNull();
  });
});
