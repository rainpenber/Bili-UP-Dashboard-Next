import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { appRouteConfig } from '@/routes/route-config';
import { asLiveDetail } from '@/features/commercial/live-read-fixture';

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const PROJECT_A = 'f0010001-0001-4001-8001-000000000004';
const PROJECT_B = 'f0010001-0001-4001-8001-000000000099';
const MISSING = 'f0010001-0001-4001-8001-000000000088';
const NODE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const ITEM_A = 'f0a10001-0001-4001-8001-0000000000a4';
const ITEM_B = 'f0a10001-0001-4001-8001-0000000000b9';
const CLOSED_ITEM = 'f0a10001-0001-4001-8001-0000000000c1';

const READ = {
  updatedAt: '2026-05-01T00:00:00.000000Z',
  userDeadlineAt: null,
  blockedSinceAt: null,
  archivedAt: null,
  stageEnteredAt: '2026-05-01T00:00:00.000000Z',
  businessClosedAt: null,
  originKind: 'fixture',
  source: null,
  businessState: null,
  originStatusLabel: null,
};

function openItem(id: string, title: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title,
    description: null,
    closeCriteria: null,
    nextAction: '跟进',
    nextActor: 'us',
    lifecycle: 'open',
    impact: 'normal',
    plannedAt: null,
    sortRank: 0,
    blocksRequiredForClose: false,
    workflowNodeId: null,
    blocksNodeId: null,
    createdAt: '2026-05-02T00:00:00.000000Z',
    updatedAt: '2026-05-02T00:00:00.000000Z',
    ...extra,
  };
}

function installApi(mode: 'ok' | 'missing' | 'http500' | 'empty' | 'detail404' = 'ok') {
  let stage = '文案';
  let nodeStatus = 'not_reached';
  const counts = { list: 0, detail: 0, commercial: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url, 'http://localhost').pathname;
    if (path.startsWith('/api/v1/commercial')) counts.commercial += 1;
    if (init?.method === 'POST' && path.endsWith('/step')) {
      stage = '预拍摄';
      nodeStatus = 'in_progress';
      return new Response(
        JSON.stringify({
          projectId: PROJECT_A,
          overallStage: 'pre_publish',
          nodes: [
            {
              id: NODE_ID,
              name: '大纲',
              status: 'in_progress',
              kind: 'stage',
              updatedAt: '2026-05-21T12:00:00.000000Z',
              statusBeforeBlock: null,
              primaryBlockItemId: null,
              plannedAt: null,
              completedAt: null,
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (path === '/api/v1/commercial/projects') {
      counts.list += 1;
      if (mode === 'http500') {
        return new Response(JSON.stringify({ error: 'internal error' }), {
          status: 500,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (mode === 'empty') {
        return new Response(JSON.stringify({ items: [], total: 0, limit: null, offset: 0 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      const itemA = {
        id: PROJECT_A,
        name: '甲方卡文案确认样例',
        netAmount: '18000.00',
        rebateAmount: '600.00',
        overallStage: 'pre_publish',
        currentStageNames: [stage],
        anyNodeBlocked: true,
        blockingReason: null,
        createdAt: '2026-05-01T00:00:00.000000Z',
        blockedNodeNames: ['文案'],
        openItems: [
          openItem(ITEM_A, '甲方文案批注未清', { nextActor: 'client', impact: 'blocking' }),
          openItem(CLOSED_ITEM, '已关闭的核对', { lifecycle: 'closed', nextAction: null }),
        ],
        ...READ,
      };
      const itemB = {
        id: PROJECT_B,
        name: '另一项目不该串过来',
        netAmount: '100.00',
        rebateAmount: null,
        overallStage: 'pre_publish',
        currentStageNames: ['结算'],
        anyNodeBlocked: false,
        blockingReason: null,
        createdAt: '2026-04-01T00:00:00.000000Z',
        blockedNodeNames: [],
        openItems: [openItem(ITEM_B, '只属于另一项目', { nextActor: 'client' })],
        ...READ,
      };
      const missingItem = { ...itemA } as Record<string, unknown>;
      delete missingItem.openItems;
      const items = mode === 'missing' ? [missingItem] : [itemA, itemB];
      const body = { items, total: items.length, limit: null, offset: 0 };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (path.endsWith('/workflow')) {
      if (mode === 'detail404' || path.includes(MISSING)) {
        return new Response(JSON.stringify({ error: 'project not found' }), { status: 404 });
      }
      return new Response(
        JSON.stringify({
          projectId: PROJECT_A,
          workflowId: 'a2000001-0001-4001-8001-000000000001',
          templateVersionId: 'ffff1111-1111-4111-8111-111111111111',
          nodes: [
            {
              id: NODE_ID,
              name: '大纲',
              status: nodeStatus,
              kind: 'stage',
              templateSlug: 'outline',
              blockingReason: null,
              plannedAt: null,
              completedAt: null,
              updatedAt: '2026-05-20T12:00:00.000000Z',
            },
          ],
          edges: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    if (path.startsWith('/api/v1/commercial/projects/')) {
      counts.detail += 1;
      if (
        mode === 'detail404' ||
        path.includes(MISSING) ||
        (path.includes(PROJECT_B) === false && path.includes(MISSING))
      ) {
        if (path.includes(MISSING) || mode === 'detail404') {
          return new Response(JSON.stringify({ error: 'project not found' }), { status: 404 });
        }
      }
      if (path.includes(PROJECT_B)) {
        return new Response(JSON.stringify({ error: 'project not found' }), { status: 404 });
      }
      return new Response(
        JSON.stringify(
          asLiveDetail({
            id: PROJECT_A,
            name: '甲方卡文案确认样例',
            netAmount: '18000.00',
            rebateAmount: '600.00',
            overallStage: 'pre_publish',
            currentStageNames: [stage],
            anyNodeBlocked: true,
            blockingReason: null,
            blockedNodeNames: ['文案'],
            openItems: [
              openItem(ITEM_A, '甲方文案批注未清', { nextActor: 'client', impact: 'blocking' }),
              openItem(CLOSED_ITEM, '已关闭的核对', { lifecycle: 'closed', nextAction: null }),
            ],
            publish: {
              published: false,
              bvid: null,
              publishedAt: null,
              publishSource: null,
              idempotencyKey: null,
            },
            ...READ,
            createdAt: '2026-05-01T00:00:00.000000Z',
          }),
        ),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }) as typeof fetch;
  return counts;
}

function renderAt(path: string) {
  const client = new QueryClient();
  const router = createMemoryRouter(appRouteConfig, { initialEntries: [path] });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('project entry routes', () => {
  test('home and list source do not call the commercial mock', () => {
    for (const file of [
      'src/pages/commercial-home-page.tsx',
      'src/pages/project-list-page.tsx',
      'src/pages/project-detail-page.tsx',
    ]) {
      const source = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      expect(source).not.toContain('commercial-mock-api');
      expect(source).not.toContain('useCommercialProjectsQuery');
      expect(source).not.toContain('useCommercialProjectQuery');
    }
  });

  test('list card opens the database timeline and canvas for the same id', async () => {
    installApi();
    renderAt('/projects');
    const card = (await screen.findAllByTestId('project-list-card')).find(
      (node) => node.getAttribute('data-project-id') === PROJECT_A,
    );
    if (!card) throw new Error('missing project card');
    expect(card.getAttribute('data-project-id')).toBe(PROJECT_A);
    expect(screen.queryByText('某新能源 SUV 春季种草')).toBeNull();
    fireEvent.click(within(card).getByRole('button', { name: /展开阻塞与待办/ }));
    expect(screen.getByText('已关闭的核对')).toBeTruthy();
    expect(screen.getAllByText('计划时间：未定').length).toBeGreaterThan(0);
    expect(screen.getByText('阻塞原因：').parentElement?.textContent).toContain('未记录');

    fireEvent.click(within(card).getByRole('link', { name: '甲方卡文案确认样例' }));
    expect(await screen.findByRole('heading', { name: '甲方卡文案确认样例' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '另一项目不该串过来' })).toBeNull();
    expect(screen.queryByText('只属于另一项目')).toBeNull();
    expect(screen.getByText('甲方文案批注未清')).toBeTruthy();
    expect(screen.getByTestId('progress-timeline')).toBeTruthy();
    expect(await screen.findByTestId('workflow-live-canvas')).toBeTruthy();
    expect(screen.getByTestId('progress-summary').textContent).toContain('18,000');

    const outline = screen
      .getAllByTestId('progress-stage')
      .find((node) => node.getAttribute('data-stage-id') === 'write_outline');
    if (!outline) throw new Error('missing outline stage');
    fireEvent.click(outline);
    fireEvent.click(within(screen.getByTestId('progress-stage-detail')).getByTestId('node-step'));
    await waitFor(() => {
      expect(screen.getByTestId('node-step').textContent).toBe('完成');
    });
    fireEvent.click(screen.getByRole('link', { name: '返回项目列表' }));
    expect(await screen.findByText('当前阶段：预拍摄')).toBeTruthy();
  });

  test('home action and block cards open the same project timeline', async () => {
    installApi();
    renderAt('/');
    const action = (await screen.findAllByTestId('home-action')).find(
      (node) => node.getAttribute('data-project-id') === PROJECT_A,
    );
    if (!action) throw new Error('missing home action');
    expect(action.getAttribute('data-project-id')).toBe(PROJECT_A);
    expect(action.textContent).toContain('未定');
    const block = screen.getByTestId('home-block');
    expect(block.getAttribute('data-project-id')).toBe(PROJECT_A);
    expect(block.textContent).toContain('未记录');
    expect(block.textContent).toContain('已关闭事项 1 条');
    fireEvent.click(action);
    expect(await screen.findByTestId('progress-timeline')).toBeTruthy();
    expect(await screen.findByTestId('workflow-live-canvas')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '甲方卡文案确认样例' })).toBeTruthy();
  });

  test('a missing project does not show another project', async () => {
    installApi('detail404');
    renderAt(`/projects/${MISSING}`);
    expect(await screen.findByText('找不到这个项目')).toBeTruthy();
    expect(screen.queryByText('甲方卡文案确认样例')).toBeNull();
    expect(screen.queryByText('另一项目不该串过来')).toBeNull();
    expect(screen.queryByTestId('progress-timeline')).toBeNull();
  });

  test('list errors and an empty payload do not fall back to mock projects', async () => {
    const failed = installApi('http500');
    renderAt('/projects');
    expect(await screen.findByText('internal error')).toBeTruthy();
    // Active list + includeArchived list each retry once on 500.
    await waitFor(() => expect(failed.list).toBe(4));
    expect(screen.queryByText('某新能源 SUV 春季种草')).toBeNull();
    expect(screen.queryByText('桌游《夜航船》众筹开箱')).toBeNull();
    cleanup();

    installApi('missing');
    renderAt('/projects');
    expect(await screen.findByText(/openItems/)).toBeTruthy();
    expect(screen.queryByText('某新能源 SUV 春季种草')).toBeNull();
    cleanup();

    installApi('empty');
    renderAt('/projects');
    expect(await screen.findByText('还没有数据库项目')).toBeTruthy();
    expect(screen.queryByText('某新能源 SUV 春季种草')).toBeNull();
  });

  test('a legacy demo bookmark explains itself and does not open the live timeline', async () => {
    const counts = installApi();
    renderAt('/projects/proj-board-prop');
    expect(await screen.findByTestId('demo-bookmark')).toBeTruthy();
    expect(screen.queryByText('桌游《夜航船》众筹开箱')).toBeNull();
    expect(screen.queryByTestId('progress-timeline')).toBeNull();
    expect(counts.commercial).toBe(0);
    expect(screen.getByRole('link', { name: '打开这个编号的演示页' }).getAttribute('href')).toBe(
      '/projects/demo/proj-board-prop',
    );
  });
});
