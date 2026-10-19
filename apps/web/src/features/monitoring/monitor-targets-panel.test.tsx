import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { MonitorTargetsPanel } from './monitor-targets-panel';

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

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MonitorTargetsPanel />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const emptyPage = { page: 1, pageSize: 8, totalItems: 0, totalPages: 1, items: [] };

describe('monitor targets panel', () => {
  test('shows the empty state', async () => {
    globalThis.fetch = (async () => jsonResponse(emptyPage)) as unknown as typeof fetch;
    renderPanel();
    expect(await screen.findByText('还没有监控项')).toBeTruthy();
  });

  test('shows a load error', async () => {
    globalThis.fetch = (async () =>
      jsonResponse({ error: '数据库不可用', code: 'internal' }, 500)) as unknown as typeof fetch;
    renderPanel();
    expect(await screen.findAllByText('数据库不可用')).toHaveLength(2);
  });

  test('rejects an illegal BV before sending it', async () => {
    let posts = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') posts += 1;
      return jsonResponse(emptyPage);
    }) as unknown as typeof fetch;
    renderPanel();
    await screen.findByText('还没有监控项');
    fireEvent.change(screen.getByLabelText('BV 号'), { target: { value: 'BVTEST001' } });
    fireEvent.click(screen.getByRole('button', { name: '添加监控项' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('BV');
    expect(posts).toBe(0);
  });

  test('lists last success, last failure, and the next plan', async () => {
    const target = {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'video',
      externalId: 'BV1xx411c7mD',
      label: '离线视频',
      tags: ['demo'],
      enabled: true,
      intervalMinutes: 60,
      nextRunAt: '2026-10-19T13:00:00.000Z',
      lastRunAt: '2026-10-19T12:00:00.000Z',
      lastSuccessAt: '2026-10-19T12:00:00.000Z',
      lastError: '离线夹具缺失',
      source: 'offline',
      createdAt: '2026-10-19T11:00:00.000Z',
      updatedAt: '2026-10-19T12:00:00.000Z',
      deletedAt: null,
    };
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/jobs')) return jsonResponse(emptyPage);
      return jsonResponse({ ...emptyPage, totalItems: 1, items: [target] });
    }) as unknown as typeof fetch;
    renderPanel();
    expect(await screen.findByText('离线视频')).toBeTruthy();
    const summary = screen.getByText(/最近成功/);
    expect(summary.textContent).toContain('最近失败');
    expect(summary.textContent).toContain('离线夹具缺失');
    expect(summary.textContent).toContain('下次计划');
    expect(screen.getByRole('button', { name: '暂停' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '立即采集' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '移除' })).toBeTruthy();
  });
});
