import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import type { MonitorCard } from '@studio/contracts';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MonitorCardControls } from '@/features/monitoring/monitor-object-card';
import { MonitoringPage } from '@/features/monitoring/monitoring-page';

afterEach(() => {
  cleanup();
});

const MINE = '3493141386627335';
const TARGET = '11111111-1111-4111-8111-111111111111';
const BVID = 'BV1xx411c7mD';

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

function wrap(ui: ReactNode, entry: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: '/monitoring', element: ui }], {
    initialEntries: [entry],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

function installOwnerFetch() {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/settings/owner-account')) {
      return Promise.resolve(
        jsonResponse({
          mid: MINE,
          displayName: '狐正正',
          updatedAt: '2026-10-22T00:00:00.000Z',
        }),
      );
    }
    if (url.includes('/search-suggestions')) {
      return Promise.resolve(
        jsonResponse({ q: '', type: 'video', limit: 5, videos: [], creators: [], categories: [] }),
      );
    }
    if (url.includes('/api/v1/monitor/cards?')) {
      return Promise.resolve(jsonResponse(list([])));
    }
    return Promise.resolve(jsonResponse(list([])));
  }) as typeof fetch;
}

function videoCard(): MonitorCard {
  return {
    type: 'video',
    externalId: BVID,
    title: '离线视频',
    category: '游戏',
    imageAssetId: null,
    mid: MINE,
    displayName: '离线视频',
    hasEntity: true,
    hasSamples: true,
    pinned: false,
    monitorState: 'active',
    execution: 'waiting',
    target: {
      id: TARGET,
      label: '视频',
      tags: [],
      enabled: true,
      intervalMinutes: 15,
      intervalMode: 'auto',
      startAt: null,
      nextRunAt: '2026-10-21T01:00:00.000Z',
      lastRunAt: '2026-10-21T00:00:00.000Z',
      lastSuccessAt: '2026-10-21T00:00:00.000Z',
      lastError: null,
    },
    projects: [{ id: '22222222-2222-4222-8222-222222222222', name: '商单 A' }],
    latest: {
      sampledAt: '2026-10-21T00:00:00.000Z',
      viewCount: '10',
      onlineViewers: '1',
      onlineViewersRaw: '1',
      likeCount: '1',
      followerCount: null,
    },
  } as MonitorCard;
}

describe('WP-R2-16H / WP-R2-23A monitor filter bar and detail actions', () => {
  test('filter bar stays a single nowrap row with unified search', async () => {
    installOwnerFetch();
    wrap(<MonitoringPage />, '/monitoring?tab=videos');
    await screen.findByTestId('monitoring-page');

    const bar = screen.getByTestId('monitor-filter-bar');
    expect(bar.className).toContain('flex');
    expect(bar.className).toContain('flex-nowrap');
    expect(bar.className).toContain('items-end');
    expect(bar.className).toContain('overflow-x-auto');
    expect(bar.className).not.toContain('grid-cols-1');
    expect(bar.className).not.toContain('flex-wrap');

    expect(screen.queryByLabelText('分类（视频标签）')).toBeNull();
    expect(screen.queryByText('关键词')).toBeNull();

    const searchLabel = screen.getByText('搜索');
    expect(searchLabel.className).toContain('whitespace-nowrap');
    const searchInput = screen.getByTestId('monitor-unified-search') as HTMLInputElement;
    expect(searchInput.placeholder).toBe('标题、分类、UP 主或 BV 号');
    expect(searchInput.className).toContain('min-w-[12rem]');
    expect(searchInput.className).toContain('flex-1');

    expect(within(bar).getByText('监控状态').className).toContain('whitespace-nowrap');
    expect(bar.querySelector('label[for="monitor-video-sort"]')?.className).toContain(
      'whitespace-nowrap',
    );
    expect(within(bar).getByText('只看我的').className).toContain('whitespace-nowrap');
  });

  test('onlyMine switch does not render nickname or mid in the filter area', async () => {
    installOwnerFetch();
    wrap(<MonitoringPage />, '/monitoring?tab=videos');
    const control = await screen.findByRole('switch', { name: '只看我的' });
    await waitFor(() => {
      expect(control.getAttribute('title')).toBe('只显示 狐正正 的视频');
    });

    const bar = screen.getByTestId('monitor-filter-bar');
    expect(bar.textContent).not.toContain(MINE);
    expect(bar.textContent).not.toContain('狐正正 ·');
    expect(within(bar).queryByText(/狐正正/)).toBeNull();
  });

  test('detail layout exposes a single role=group action container', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <MonitorCardControls
              card={videoCard()}
              listQuery=""
              layout="detail"
              includeDetailLink={false}
            />
          ),
        },
        { path: '/ops', element: <div /> },
        { path: '/projects/:id', element: <div /> },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const groups = screen.getAllByRole('group', { name: '详情页监控操作' });
    expect(groups).toHaveLength(1);
    const actions = groups[0]!;
    expect(actions.getAttribute('data-testid')).toBe('monitor-detail-bar');
    expect(actions.className).toContain('flex-wrap');
    expect(within(actions).getByRole('button', { name: /监控状态/ })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: '暂停' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: '监控详情' })).toBeTruthy();
    expect(within(actions).getByRole('link', { name: '查看日志' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: '监控设置' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: '立即采集' })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: '移除' })).toBeTruthy();
    expect(screen.queryByTestId('monitor-detail-secondary-actions')).toBeNull();
  });
});
