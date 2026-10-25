import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { postLiveNodeUnblock } from '../commercial-live-api';
import {
  availableNodeStepActions,
  deriveNodeStepActions,
  PUBLISH_COMPLETE_HINT,
  type TimelineSourceNode,
} from '../progress-timeline';
import { ProgressTimeline } from './progress-timeline-view';
import type { StepCall, StepResult } from './stage-step-controls';

const originalFetch = globalThis.fetch;
const PROJECT_ID = 'f0010001-0001-4001-8001-000000000004';
const NODE_IDS: Record<string, string> = {
  outline: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
  copy: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
  pre_shoot: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
  a_roll: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006',
  publish: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000a',
};

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function node(
  slug: string,
  name: string,
  status: string,
  blockingReason: string | null = null,
): TimelineSourceNode {
  return {
    id: NODE_IDS[slug] ?? 'aaaaaaaa-aaaa-4aaa-8aaa-0000000000ff',
    name,
    status,
    kind: 'stage',
    templateSlug: slug,
    blockingReason,
    updatedAt: '2026-05-20T12:00:00.000Z',
  };
}

function stageButton(id: string): HTMLElement {
  const stage = screen
    .getAllByTestId('progress-stage')
    .find((item) => item.getAttribute('data-stage-id') === id);
  if (!stage) throw new Error(`missing ${id}`);
  return stage;
}

async function openTooltip(stageId: string): Promise<HTMLElement> {
  fireEvent.pointerMove(stageButton(stageId));
  return screen.findByTestId('progress-stage-tooltip');
}

function action(buttonId: string): HTMLElement {
  return within(screen.getByTestId('progress-stage-tooltip')).getByTestId(buttonId);
}

describe('node step action policy', () => {
  test('maps each node status to exactly the enabled actions from the table', () => {
    expect(availableNodeStepActions('not_reached')).toEqual(['start']);
    expect(availableNodeStepActions('in_progress')).toEqual(['complete', 'rollback']);
    expect(availableNodeStepActions('completed')).toEqual(['rollback']);
    expect(availableNodeStepActions('not_applicable')).toEqual(['rollback']);
    expect(availableNodeStepActions('blocked')).toEqual(['rollback', 'unblock']);
  });

  test('keeps publish completion disabled with the publish hint', () => {
    const publish = deriveNodeStepActions('in_progress', { nodeId: 'publish' });
    expect(publish.map((item) => [item.id, item.enabled])).toEqual([
      ['start', false],
      ['complete', false],
      ['rollback', true],
    ]);
    expect(publish.find((item) => item.id === 'complete')?.hint).toBe(PUBLISH_COMPLETE_HINT);
    expect(availableNodeStepActions('in_progress', { nodeId: 'publish' })).toEqual(['rollback']);
  });
});

describe('stage tooltip node actions', () => {
  test('an in-progress node shows 完成 and 回退 actions while 进行中 stays disabled', async () => {
    render(
      <ProgressTimeline
        nodes={[node('copy', '文案', 'not_reached'), node('pre_shoot', '预拍摄', 'in_progress')]}
        stepEditor={{ disabled: false, onStep: async () => ({ ok: true }), onRefresh: () => {} }}
      />,
    );
    const tip = await openTooltip('copy_prep');
    const start = within(tip).getByTestId('tooltip-node-start-pre_shoot');
    const complete = within(tip).getByTestId('tooltip-node-complete-pre_shoot');
    const rollback = within(tip).getByTestId('tooltip-node-rollback-pre_shoot');
    expect(start.textContent).toBe('进行中');
    expect(complete.textContent).toBe('完成');
    expect(rollback.textContent).toBe('回退');
    expect(start.hasAttribute('disabled')).toBe(true);
    expect(complete.hasAttribute('disabled')).toBe(false);
    expect(rollback.hasAttribute('disabled')).toBe(false);
    expect(tip.getAttribute('data-interactive')).toBe('true');
  });

  test('完成 sends forward and 回退 sends rollback for the selected node', async () => {
    const calls: StepCall[] = [];
    function Harness() {
      const [nodes, setNodes] = useState([node('pre_shoot', '预拍摄', 'in_progress')]);
      return (
        <ProgressTimeline
          nodes={nodes}
          stepEditor={{
            disabled: false,
            onRefresh: () => {},
            onStep: async (call) => {
              calls.push(call);
              setNodes((current) =>
                current.map((item) => ({
                  ...item,
                  status:
                    call.direction === 'forward'
                      ? item.status === 'in_progress'
                        ? 'completed'
                        : 'in_progress'
                      : item.status === 'completed'
                        ? 'in_progress'
                        : 'not_reached',
                  updatedAt: '2026-05-21T12:00:00.000Z',
                })),
              );
              return { ok: true };
            },
          }}
        />
      );
    }
    render(<Harness />);
    await openTooltip('copy_prep');

    fireEvent.click(action('tooltip-node-complete-pre_shoot'));
    await waitFor(() =>
      expect(action('tooltip-node-complete-pre_shoot').hasAttribute('disabled')).toBe(true),
    );
    expect(calls[0]).toMatchObject({
      kind: 'node',
      nodeId: NODE_IDS.pre_shoot,
      direction: 'forward',
      expectedUpdatedAt: '2026-05-20T12:00:00.000Z',
    });

    fireEvent.click(action('tooltip-node-rollback-pre_shoot'));
    await waitFor(() =>
      expect(action('tooltip-node-complete-pre_shoot').hasAttribute('disabled')).toBe(false),
    );
    expect(action('tooltip-node-start-pre_shoot').hasAttribute('disabled')).toBe(true);
    expect(calls.at(-1)).toMatchObject({ kind: 'node', direction: 'rollback' });
    expect(screen.getByTestId('progress-stage-tooltip')).toBeTruthy();
  });

  test('解除阻塞 on a blocked node POSTs the unblock endpoint and refreshes the row', async () => {
    const requests: Array<{ url: string; body: unknown }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), body: JSON.parse(String(init?.body)) });
      return new Response(
        JSON.stringify({
          projectId: PROJECT_ID,
          node: {
            id: NODE_IDS.a_roll,
            name: 'A-roll 拍摄',
            status: 'in_progress',
            kind: 'stage',
            updatedAt: '2026-05-21T12:00:00.000Z',
            statusBeforeBlock: null,
            primaryBlockItemId: null,
            plannedAt: null,
            completedAt: null,
          },
          blockingReason: null,
          pinnedItem: null,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;

    function Harness() {
      const [nodes, setNodes] = useState([node('a_roll', 'A-roll 拍摄', 'blocked', '素材缺失')]);
      return (
        <ProgressTimeline
          nodes={nodes}
          stepEditor={{
            disabled: false,
            onRefresh: () => {},
            onStep: async (): Promise<StepResult> => ({ ok: true }),
            onUnblock: async (nodeId, expectedUpdatedAt) => {
              const result = await postLiveNodeUnblock(PROJECT_ID, nodeId, expectedUpdatedAt);
              if (result.ok) {
                setNodes((current) =>
                  current.map((item) => ({
                    ...item,
                    status: 'in_progress',
                    blockingReason: null,
                    updatedAt: '2026-05-21T12:00:00.000Z',
                  })),
                );
                return { ok: true };
              }
              return {
                ok: false,
                message: result.body.error,
                code: result.body.code,
                blocks: [],
                effects: [],
                successors: [],
              };
            },
          }}
        />
      );
    }

    render(<Harness />);
    await openTooltip('production');
    expect(action('tooltip-node-start-a_roll').hasAttribute('disabled')).toBe(true);
    expect(action('tooltip-node-complete-a_roll').hasAttribute('disabled')).toBe(true);
    expect(action('tooltip-node-rollback-a_roll').hasAttribute('disabled')).toBe(false);
    fireEvent.click(action('tooltip-node-unblock-a_roll'));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]?.url).toContain(`/projects/${PROJECT_ID}/nodes/${NODE_IDS.a_roll}/unblock`);
    expect(requests[0]?.body).toEqual({ expectedUpdatedAt: '2026-05-20T12:00:00.000Z' });
    await waitFor(() =>
      expect(action('tooltip-node-complete-a_roll').hasAttribute('disabled')).toBe(false),
    );
    expect(action('tooltip-node-start-a_roll').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('progress-stage-tooltip')).toBeTruthy();
  });

  test('a refused write shows the server message inside the tooltip', async () => {
    render(
      <ProgressTimeline
        nodes={[node('pre_shoot', '预拍摄', 'in_progress')]}
        stepEditor={{
          disabled: false,
          onRefresh: () => {},
          onStep: async (): Promise<StepResult> => ({
            ok: false,
            message: '并发令牌已过期，请按最近一次读取的 updatedAt 重试',
            code: 'stale_write',
            blocks: [],
            effects: [],
            successors: [],
          }),
        }}
      />,
    );
    await openTooltip('copy_prep');
    fireEvent.click(action('tooltip-node-complete-pre_shoot'));
    const error = await screen.findByTestId('tooltip-node-error-pre_shoot');
    expect(error.textContent).toContain('并发令牌已过期');
    expect(screen.getByTestId('progress-stage-tooltip')).toBeTruthy();
  });

  test('publish 完成 stays disabled with the hint and keyboard activation works', async () => {
    const calls: StepCall[] = [];
    render(
      <ProgressTimeline
        nodes={[node('publish', '发布', 'in_progress')]}
        stepEditor={{
          disabled: false,
          onRefresh: () => {},
          onStep: async (call) => {
            calls.push(call);
            return { ok: true };
          },
        }}
      />,
    );
    const tip = await openTooltip('client_review');
    const complete = within(tip).getByTestId('tooltip-node-complete-publish');
    const rollback = within(tip).getByTestId('tooltip-node-rollback-publish');
    expect(complete.hasAttribute('disabled')).toBe(true);
    expect(complete.getAttribute('title')).toBe(PUBLISH_COMPLETE_HINT);
    rollback.focus();
    expect(document.activeElement).toBe(rollback);
    rollback.click();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toMatchObject({ nodeId: NODE_IDS.publish, direction: 'rollback' });
  });
});
