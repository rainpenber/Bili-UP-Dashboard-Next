import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import type { CommercialProjectDetail, CommercialWorkflowNode } from '@studio/contracts';
import { asLiveDetail } from '../live-read-fixture';
import { ProjectListCard } from './project-list-card';
import { LiveProjectWorkflow } from './live-project-workflow';

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;
const PROJECT_ID = 'f0010001-0001-4001-8001-0000000000aa';
const NODE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const NODE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const WF_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const TPL_ID = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd4';

function source(status: string) {
  return {
    namespace: 'hermes.test',
    sourceId: 'display-1',
    sourceUpdatedAt: '2026-10-01T00:00:00.000Z',
    importedAt: '2026-10-01T00:00:00.000Z',
    contentHash: 'hash-display-1',
    sourceStatus: status,
    sourceNotes: null,
  };
}

function detail(overrides: Partial<CommercialProjectDetail> = {}): CommercialProjectDetail {
  return asLiveDetail({
    id: PROJECT_ID,
    name: '展示态样例',
    netAmount: '1000.00',
    rebateAmount: null,
    overallStage: 'pre_publish',
    currentStageNames: ['大纲'],
    anyNodeBlocked: false,
    blockingReason: null,
    originKind: 'real',
    source: source('2.进行中'),
    businessState: 'active',
    originStatusLabel: '2.进行中',
    publish: {
      published: false,
      bvid: null,
      publishedAt: null,
      publishSource: null,
      idempotencyKey: null,
    },
    ...overrides,
  });
}

function node(
  id: string,
  name: string,
  status: CommercialWorkflowNode['status'],
  slug: string,
): CommercialWorkflowNode {
  return {
    id,
    name,
    status,
    kind: 'stage',
    templateSlug: slug,
    blockingReason: null,
    plannedAt: null,
    completedAt: null,
    posX: 0,
    posY: 0,
    updatedAt: '2026-05-20T12:00:00.000000Z',
  };
}

function installDetailApi(project: CommercialProjectDetail) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname;
    if (path === `/api/v1/commercial/projects/${PROJECT_ID}`) {
      return new Response(JSON.stringify(project), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path === `/api/v1/commercial/projects/${PROJECT_ID}/workflow`) {
      return new Response(
        JSON.stringify({
          projectId: PROJECT_ID,
          workflowId: WF_ID,
          templateVersionId: TPL_ID,
          nodes: [
            node(NODE_A, '大纲', 'in_progress', 'outline'),
            node(NODE_B, '文案', 'not_reached', 'copy'),
          ],
          edges: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }) as typeof fetch;
}

function renderWorkflow(project: CommercialProjectDetail) {
  installDetailApi(project);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LiveProjectWorkflow projectId={PROJECT_ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('project business display state (WP-R2-19C)', () => {
  test('list card shows finished / not_started badges with real labels and weakens stage', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const finished = detail({
      name: '已提现项目',
      businessState: 'finished',
      originStatusLabel: '3.收尾-已提现',
      source: source('3.收尾-已提现'),
    });
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProjectListCard project={finished} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const finishedBadge = screen.getByTestId('project-business-state-badge');
    expect(finishedBadge.getAttribute('data-tone')).toBe('finished');
    expect(finishedBadge.textContent).toBe('已结束 · 3.收尾-已提现');
    expect(screen.getByTestId('project-list-stage-line').getAttribute('data-weakened')).toBe(
      'true',
    );

    const notStarted = detail({
      name: '主动拒绝项目',
      businessState: 'not_started',
      originStatusLabel: '1.放弃-主动拒绝',
      source: source('1.放弃-主动拒绝'),
    });
    rerender(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProjectListCard project={notStarted} />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const notStartedBadge = screen.getByTestId('project-business-state-badge');
    expect(notStartedBadge.getAttribute('data-tone')).toBe('not_started');
    expect(notStartedBadge.textContent).toBe('未开始 · 1.放弃-主动拒绝');
  });

  test('list card without source binding does not show a display-state badge', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProjectListCard
            project={detail({
              originKind: 'fixture',
              source: null,
              businessState: null,
              originStatusLabel: null,
            })}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('project-business-state-badge')).toBeNull();
    expect(screen.getByTestId('project-list-card').getAttribute('data-business-state')).toBe('');
  });

  test('finished detail paints timeline/graph completed and hides write actions', async () => {
    renderWorkflow(
      detail({
        businessState: 'finished',
        originStatusLabel: '3.收尾-已提现',
        source: source('3.收尾-已提现'),
      }),
    );
    const shell = await screen.findByTestId('project-workflow-shell');
    expect(shell.getAttribute('data-business-state')).toBe('finished');
    expect(shell.getAttribute('data-display-readonly')).toBe('true');
    expect(screen.getByTestId('project-business-state-chip').textContent).toContain(
      '已结束 · 3.收尾-已提现',
    );
    expect(screen.getByTestId('project-display-readonly-note')).toBeTruthy();
    expect(screen.getByText(/整体阶段 已结束/)).toBeTruthy();

    const timeline = await screen.findByTestId('progress-timeline');
    const statuses = [...timeline.querySelectorAll('[data-status]')].map((el) =>
      el.getAttribute('data-status'),
    );
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((status) => status === 'done')).toBe(true);

    const graph = screen.getByTestId('workflow-live-canvas');
    const graphStatuses = [...graph.querySelectorAll('[data-workflow-status]')].map((el) =>
      el.getAttribute('data-workflow-status'),
    );
    expect(graphStatuses.length).toBeGreaterThan(0);
    expect(graphStatuses.every((status) => status === 'completed')).toBe(true);
    expect(within(shell).queryByTestId('node-step')).toBeNull();
  });

  test('not_started detail paints timeline/graph idle grey and hides write actions', async () => {
    renderWorkflow(
      detail({
        businessState: 'not_started',
        originStatusLabel: '0.未确定',
        source: source('0.未确定'),
      }),
    );
    const shell = await screen.findByTestId('project-workflow-shell');
    expect(shell.getAttribute('data-business-state')).toBe('not_started');
    expect(shell.getAttribute('data-display-readonly')).toBe('true');
    expect(screen.getByTestId('project-business-state-chip').textContent).toContain(
      '未开始 · 0.未确定',
    );
    expect(screen.getByText(/整体阶段 未开始/)).toBeTruthy();

    const timeline = await screen.findByTestId('progress-timeline');
    const statuses = [...timeline.querySelectorAll('[data-status]')].map((el) =>
      el.getAttribute('data-status'),
    );
    expect(statuses.length).toBeGreaterThan(0);
    expect(statuses.every((status) => status === 'idle')).toBe(true);

    const graph = screen.getByTestId('workflow-live-canvas');
    const graphStatuses = [...graph.querySelectorAll('[data-workflow-status]')].map((el) =>
      el.getAttribute('data-workflow-status'),
    );
    expect(graphStatuses.every((status) => status === 'not_reached')).toBe(true);
    expect(within(shell).queryByTestId('node-step')).toBeNull();
  });
});
