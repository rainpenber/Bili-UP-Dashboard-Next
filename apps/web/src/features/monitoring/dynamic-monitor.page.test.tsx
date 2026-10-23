import { mock } from 'bun:test';

mock.module('echarts-for-react', () => ({
  default: () => <div data-testid="mock-echart" />,
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MonitoringPage } from '@/features/monitoring/monitoring-page';
import { MonitoringDynamicDetailPage } from '@/pages/monitoring-dynamic-detail-page';

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function list(items: unknown[]) {
  return {
    page: 1,
    pageSize: 8,
    totalItems: items.length,
    totalPages: 1,
    items,
  };
}

const DYNAMIC_ID = '966692349750018048';
const TARGET_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function dynamicItem(overrides: Record<string, unknown> = {}) {
  return {
    dynamicId: DYNAMIC_ID,
    mid: '1',
    category: null,
    monitoringEnabled: false,
    archivedAt: null,
    deletedAt: null,
    pinned: false,
    target: null,
    latestMetrics: {
      sampledAt: '2026-10-21T08:00:00.000Z',
      likeCount: '12',
      repostCount: '3',
      commentCount: '4',
    },
    ...overrides,
  };
}

function activeTarget(enabled = true) {
  return {
    id: TARGET_ID,
    enabled,
    intervalMinutes: 60,
    intervalMode: 'fixed' as const,
    lastSuccessAt: '2026-10-21T08:00:00.000Z',
    lastError: null,
  };
}

const opsRange = {
  since: '2026-10-15',
  until: '2026-10-21',
  timezone: 'Asia/Shanghai',
  defaulted: true,
};

const opsRetention = {
  days: 14,
  cutoff: '2026-10-07T00:00:00.000Z',
  oldestStoredAt: null,
  timezone: 'Asia/Shanghai',
};

function emptyJobs() {
  return {
    mode: 'time',
    items: [],
    total: 0,
    page: 1,
    pageSize: 5,
    range: opsRange,
    logRetention: opsRetention,
  };
}

function install(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

function renderDynamics(path = '/monitoring?tab=dynamics') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/monitoring" element={<MonitoringPage />} />
          <Route path="/monitoring/dynamics/:id" element={<MonitoringDynamicDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('dynamic monitor page', () => {
  test('empty state and add entry are available without the old browse-only copy', async () => {
    install((url) => {
      if (url.includes('/dynamics')) return jsonResponse(list([]));
      if (url.includes('/collector-jobs')) return jsonResponse(emptyJobs());
      return jsonResponse(list([]));
    });
    renderDynamics();
    expect(await screen.findByText('没有匹配的条目')).toBeTruthy();
    expect(screen.getByRole('button', { name: '新增监控' })).toBeTruthy();
    expect(screen.queryByText(/不在这个页面提供/)).toBeNull();
  });

  test('rejects illegal dynamic ids locally and accepts id or t.bilibili.com link', async () => {
    const posts: unknown[] = [];
    install((url, init) => {
      if (url.includes('/targets') && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return jsonResponse({
          target: {
            id: TARGET_ID,
            type: 'dynamic',
            externalId: DYNAMIC_ID,
            label: DYNAMIC_ID,
            tags: [],
            enabled: true,
            intervalMinutes: 60,
            intervalMode: 'fixed',
            startAt: null,
            nextRunAt: null,
            lastRunAt: null,
            lastSuccessAt: null,
            lastError: null,
            source: 'manual',
            createdAt: '2026-10-21T00:00:00.000Z',
            updatedAt: '2026-10-21T00:00:00.000Z',
            deletedAt: null,
          },
          created: true,
          code: 'created',
          message: '已添加监控项',
        });
      }
      if (url.includes('/dynamics')) return jsonResponse(list([dynamicItem()]));
      if (url.includes('/collector-jobs')) return jsonResponse(emptyJobs());
      if (url.includes('/metrics')) return jsonResponse({ items: [] });
      return jsonResponse(list([]));
    });
    renderDynamics();
    await screen.findByText(DYNAMIC_ID);
    fireEvent.click(screen.getByRole('button', { name: '新增监控' }));
    const dialog = await screen.findByTestId('monitor-add-dialog');
    fireEvent.change(within(dialog).getByLabelText('动态 id 或链接'), {
      target: { value: '0' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }));
    expect(await within(dialog).findByRole('alert')).toBeTruthy();
    expect(posts).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('动态 id 或链接'), {
      target: { value: `https://t.bilibili.com/${DYNAMIC_ID}` },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({
      type: 'dynamic',
      externalId: DYNAMIC_ID,
      intervalMode: 'fixed',
      intervalMinutes: 60,
    });
  });

  test('pause and resume refresh the dynamic card state and surface patch errors', async () => {
    let enabled = true;
    let failNext = true;
    install((url, init) => {
      if (url.includes(`/targets/${TARGET_ID}`) && init?.method === 'PATCH') {
        if (failNext) {
          failNext = false;
          return jsonResponse({ error: '目标库暂时不可写', code: 'internal' }, 500);
        }
        const body = JSON.parse(String(init.body)) as { enabled?: boolean };
        enabled = body.enabled !== false;
        return jsonResponse({
          target: {
            id: TARGET_ID,
            type: 'dynamic',
            externalId: DYNAMIC_ID,
            label: DYNAMIC_ID,
            tags: [],
            enabled,
            intervalMinutes: 60,
            intervalMode: 'fixed',
            startAt: null,
            nextRunAt: null,
            lastRunAt: null,
            lastSuccessAt: '2026-10-21T08:00:00.000Z',
            lastError: null,
            source: 'manual',
            createdAt: '2026-10-21T00:00:00.000Z',
            updatedAt: '2026-10-21T00:00:00.000Z',
            deletedAt: null,
          },
        });
      }
      if (url.includes('/dynamics') && !url.includes('/metrics')) {
        return jsonResponse(list([dynamicItem({ target: activeTarget(enabled) })]));
      }
      if (url.includes('/metrics')) {
        return jsonResponse({
          items: [
            {
              sampledAt: '2026-10-21T08:00:00.000Z',
              rawTime: '2026-10-21 16:00:00',
              sourceTimezone: 'Asia/Shanghai',
              timestampPrecision: 'minute',
              likeCount: '12',
              repostCount: '3',
              commentCount: '4',
            },
          ],
        });
      }
      if (url.includes('/collector-jobs')) return jsonResponse(emptyJobs());
      return jsonResponse(list([]));
    });
    renderDynamics(`/monitoring?tab=dynamics&selected=${DYNAMIC_ID}`);
    const controls = await screen.findByTestId('dynamic-monitor-controls');
    expect(controls.getAttribute('data-monitor-state')).toBe('active');
    expect(screen.getByText(/点赞/)).toBeTruthy();
    expect(screen.getByText(/评论/)).toBeTruthy();
    expect(screen.getByText(/转发/)).toBeTruthy();

    fireEvent.click(within(controls).getByRole('button', { name: '暂停' }));
    expect(await within(controls).findByRole('alert')).toBeTruthy();
    expect(controls.getAttribute('data-monitor-state')).toBe('active');

    fireEvent.click(within(controls).getByRole('button', { name: '暂停' }));
    await waitFor(() => expect(controls.getAttribute('data-monitor-state')).toBe('paused'));
    fireEvent.click(within(controls).getByRole('button', { name: '恢复' }));
    await waitFor(() => expect(controls.getAttribute('data-monitor-state')).toBe('active'));
  });

  test('detail page shows recent collect logs from the ops read API', async () => {
    install((url) => {
      if (url.includes(`/dynamics/${DYNAMIC_ID}`) && url.includes('/metrics')) {
        return jsonResponse({ items: [] });
      }
      if (url.includes(`/dynamics/${DYNAMIC_ID}`)) {
        return jsonResponse({
          dynamicId: DYNAMIC_ID,
          mid: '1',
          category: null,
          monitoringEnabled: true,
          archivedAt: null,
          deletedAt: null,
          metadata: {},
          target: { ...activeTarget(true), lastError: '动态详情不可用' },
        });
      }
      if (url.includes('/dynamics') && !url.includes('/metrics')) {
        return jsonResponse(
          list([
            dynamicItem({
              target: { ...activeTarget(true), lastError: '动态详情不可用' },
            }),
          ]),
        );
      }
      if (url.includes('/targets/of/')) {
        return jsonResponse({
          id: TARGET_ID,
          type: 'dynamic',
          externalId: DYNAMIC_ID,
          label: DYNAMIC_ID,
          tags: [],
          enabled: true,
          intervalMinutes: 60,
          intervalMode: 'fixed',
          startAt: null,
          nextRunAt: null,
          lastRunAt: null,
          lastSuccessAt: '2026-10-21T08:00:00.000Z',
          lastError: '动态详情不可用',
          source: 'manual',
          createdAt: '2026-10-21T00:00:00.000Z',
          updatedAt: '2026-10-21T00:00:00.000Z',
          deletedAt: null,
        });
      }
      if (url.includes('/collector-jobs')) {
        return jsonResponse({
          mode: 'time',
          items: [
            {
              id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              targetId: TARGET_ID,
              targetType: 'dynamic',
              externalId: DYNAMIC_ID,
              label: DYNAMIC_ID,
              displayName: DYNAMIC_ID,
              coverUrl: null,
              targetDeleted: false,
              status: 'failed',
              attempts: 1,
              scheduledFor: '2026-10-21T07:00:00.000Z',
              startedAt: '2026-10-21T07:00:01.000Z',
              finishedAt: '2026-10-21T07:00:02.000Z',
              durationMs: 1000,
              samplesWritten: 0,
              error: '动态详情不可用',
              latestAttempt: null,
              projects: [],
            },
          ],
          total: 1,
          page: 1,
          pageSize: 5,
          range: opsRange,
          logRetention: opsRetention,
        });
      }
      if (url.includes('/metrics')) return jsonResponse({ items: [] });
      return jsonResponse(list([]));
    });
    renderDynamics('/monitoring?tab=dynamics&view=grid');
    const card = await screen.findByTestId('dynamic-list-item');
    expect(within(card).getByTestId('dynamic-card-failure-dot')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: '监控详情' })).toBeNull();
    expect(card.textContent).not.toContain('最近失败：');
    fireEvent.click(within(card).getByRole('button', { name: /打开动态/ }));
    expect(await screen.findByTestId('dynamic-detail-page')).toBeTruthy();
    const controls = await screen.findByTestId('dynamic-monitor-controls');
    expect(within(controls).getByTestId('dynamic-last-failure').textContent).toContain(
      '动态详情不可用',
    );
    const logs = await screen.findByTestId('dynamic-collect-logs');
    expect(logs.textContent).toContain('失败');
    expect(logs.textContent).toContain('动态详情不可用');
  });
});
