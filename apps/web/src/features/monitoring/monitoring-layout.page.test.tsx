import { mock } from 'bun:test';

mock.module('echarts-for-react', () => ({
  default: () => <div data-testid="mock-echart" />,
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { appRouteConfig } from '@/routes/route-config';

const originalFetch = globalThis.fetch;
const TARGET = '11111111-1111-4111-8111-111111111111';
const BVID = 'BV1xx411c7mD';
const OTHER = 'BV1yy411c7mE';

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

function card(externalId: string, patch: Record<string, unknown> = {}) {
  return {
    type: 'video',
    externalId,
    title: externalId === OTHER ? '另一条视频' : '离线视频',
    category: '游戏',
    imageAssetId: null,
    mid: null,
    displayName: externalId === OTHER ? '另一条视频' : '离线视频',
    hasEntity: true,
    hasSamples: true,
    pinned: false,
    monitorState: 'active',
    execution: 'waiting',
    target: {
      id: TARGET,
      label: '离线视频',
      tags: ['demo'],
      enabled: true,
      intervalMinutes: 15,
      intervalMode: 'auto',
      startAt: null,
      nextRunAt: '2026-10-21T01:00:00.000Z',
      lastRunAt: '2026-10-21T00:00:00.000Z',
      lastSuccessAt: '2026-10-21T00:00:00.000Z',
      lastError: null,
    },
    projects: [],
    latest: {
      sampledAt: '2026-10-21T00:00:00.000Z',
      viewCount: '1200',
      onlineViewers: '3',
      onlineViewersRaw: '3',
      likeCount: '9',
      followerCount: null,
    },
    ...patch,
  };
}

function list(items: unknown[]) {
  return { page: 1, pageSize: 8, totalItems: items.length, totalPages: 2, items };
}

const videoDetail = {
  bvid: BVID,
  title: '离线视频',
  category: '游戏',
  mid: null,
  monitoringEnabled: true,
  archivedAt: null,
  deletedAt: null,
  coverAssetId: null,
  tid: null,
  tidV2: null,
  partitionName: null,
  metadata: {},
  creator: null,
};

function renderAt(path: string) {
  const router = createMemoryRouter(appRouteConfig, { initialEntries: [path] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return router;
}

function install(cardUrls: string[], metricUrls: string[]) {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.includes('/api/v1/monitor/cards?')) {
      cardUrls.push(url);
      const params = new URL(url, 'http://localhost').searchParams;
      const type = params.get('type') === 'creator' ? 'creator' : 'video';
      if (type === 'creator') {
        return Promise.resolve(
          jsonResponse(
            list([
              card('81990099', {
                type: 'creator',
                externalId: '81990099',
                title: null,
                category: null,
                displayName: '离线 UP',
                latest: {
                  sampledAt: '2026-10-21T00:00:00.000Z',
                  viewCount: null,
                  onlineViewers: null,
                  onlineViewersRaw: null,
                  likeCount: null,
                  followerCount: '20',
                },
              }),
            ]),
          ),
        );
      }
      return Promise.resolve(jsonResponse(list([card(BVID), card(OTHER)])));
    }
    if (url.includes('/metrics')) {
      metricUrls.push(url);
      return Promise.resolve(jsonResponse({ bvid: BVID, limit: 500, items: [] }));
    }
    if (url.includes('/api/v1/monitor/cards/')) return Promise.resolve(jsonResponse(card(BVID)));
    if (url.includes('/api/v1/monitor/videos/')) return Promise.resolve(jsonResponse(videoDetail));
    if (url.includes('/api/v1/monitor/dynamics')) return Promise.resolve(jsonResponse(list([])));
    return Promise.resolve(jsonResponse(list([])));
  }) as typeof fetch;
}

function pressed(name: string): boolean {
  const item = screen.getByRole('radio', { name });
  return item.getAttribute('aria-checked') === 'true' && item.getAttribute('data-state') === 'on';
}

describe('monitoring layout toggle', () => {
  test('switches split and grid without dropping filters, selection, or page', async () => {
    const cardUrls: string[] = [];
    const metricUrls: string[] = [];
    install(cardUrls, metricUrls);
    const router = renderAt(
      '/monitoring?tab=videos&page=2&q=离线&category=游戏&monitor=paused&selected=BV1xx411c7mD&view=nope',
    );

    const layout = await screen.findByTestId('monitor-layout');
    expect(layout.getAttribute('data-view')).toBe('split');
    expect(pressed('分栏')).toBe(true);
    expect(pressed('网格')).toBe(false);
    expect(screen.queryByRole('tab', { name: '分栏' })).toBeNull();
    expect(screen.queryByRole('tab', { name: '网格' })).toBeNull();
    expect(layout.className).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]');
    const selected = screen
      .getAllByTestId('monitor-object-card')
      .find((node) => node.getAttribute('data-external-id') === BVID);
    expect(selected?.getAttribute('data-presentation')).toBe('list');
    expect(within(selected!).getByTestId('monitor-card-actions').className).toContain('flex-wrap');
    expect(within(selected!).getByRole('button', { name: /详情/ })).toBeTruthy();
    expect(within(selected!).queryByRole('button', { name: '更多' })).toBeNull();

    fireEvent.click(screen.getByRole('radio', { name: '分栏' }));
    expect(layout.getAttribute('data-view')).toBe('split');
    expect(pressed('分栏')).toBe(true);
    expect(router.state.location.search).toContain('page=2');
    expect(router.state.location.search).toContain('selected=BV1xx411c7mD');
    expect(router.state.location.search).toContain('q=');
    expect(router.state.location.search).toContain('category=');
    expect(router.state.location.search).toContain('monitor=paused');

    fireEvent.click(screen.getByRole('radio', { name: '网格' }));
    expect(layout.getAttribute('data-view')).toBe('grid');
    expect(pressed('网格')).toBe(true);
    expect(pressed('分栏')).toBe(false);
    expect(layout.className).not.toContain('lg:grid-cols-');
    expect(screen.getByTestId('monitor-card-list').className).toContain('xl:grid-cols-4');
    expect(screen.getByTestId('monitor-card-list').className).toContain('sm:grid-cols-2');
    const gridCard = screen
      .getAllByTestId('monitor-object-card')
      .find((node) => node.getAttribute('data-external-id') === BVID);
    expect(gridCard?.getAttribute('data-presentation')).toBe('grid');
    expect(within(gridCard!).getByTestId('video-grid-cover').className).toContain('aspect-[16/9]');
    expect(within(gridCard!).getByTestId('monitor-card-actions').className).toContain(
      'justify-end',
    );
    expect(within(gridCard!).getByRole('link', { name: /详情/ })).toBeTruthy();
    expect(within(gridCard!).queryByRole('button', { name: '更多' })).toBeNull();
    const search = router.state.location.search;
    expect(search).toContain('view=grid');
    expect(search).toContain('tab=videos');
    expect(search).toContain('page=2');
    expect(search).toContain('monitor=paused');
    expect(search).toContain('category=');
    expect(search).toContain('selected=BV1xx411c7mD');
    expect(decodeURIComponent(search)).toContain('q=离线');
    expect(screen.getByTestId('monitor-trend-card').textContent).toContain(BVID);
    const listBefore = screen.getByTestId('monitor-card-list');
    const chart = screen.getByTestId('monitor-trend-card');
    expect(
      listBefore.compareDocumentPosition(chart) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      screen.getByRole('navigation', { name: '分页' }).compareDocumentPosition(chart) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('radio', { name: '网格' }));
    expect(layout.getAttribute('data-view')).toBe('grid');
    expect(pressed('网格')).toBe(true);
    expect(router.state.location.search).toContain('view=grid');
    expect(router.state.location.search).toContain('selected=BV1xx411c7mD');

    fireEvent.click(within(screen.getByTestId('monitor-card-list')).getByText('另一条视频'));
    expect(router.state.location.search).toContain(`selected=${OTHER}`);
    expect(router.state.location.search).toContain('view=grid');
    expect(screen.getByTestId('monitor-trend-card').textContent).toContain(OTHER);
    expect(metricUrls.some((url) => url.includes(OTHER))).toBe(true);
    expect(metricUrls.some((url) => url.includes(BVID))).toBe(true);
    expect(cardUrls.every((url) => url.includes('pageSize=8'))).toBe(true);
    expect(cardUrls.some((url) => url.includes('view='))).toBe(false);

    fireEvent.click(screen.getByRole('radio', { name: '分栏' }));
    expect(layout.getAttribute('data-view')).toBe('split');
    expect(pressed('分栏')).toBe(true);
    expect(pressed('网格')).toBe(false);
    expect(router.state.location.search).not.toContain('view=');
    expect(router.state.location.search).toContain(`selected=${OTHER}`);
    expect(router.state.location.search).toContain('page=2');
    expect(router.state.location.search).toContain('monitor=paused');
  });

  test('detail return and history keep grid on video and creator pages', async () => {
    install([], []);
    const router = renderAt('/monitoring?tab=videos&page=2&monitor=active&selected=BV1xx411c7mD');
    expect((await screen.findByTestId('monitor-layout')).getAttribute('data-view')).toBe('split');
    fireEvent.click(screen.getByRole('radio', { name: '网格' }));
    const gridCard = screen
      .getAllByTestId('monitor-object-card')
      .find((node) => node.getAttribute('data-external-id') === BVID);
    fireEvent.click(within(gridCard!).getByRole('link', { name: /详情/ }));
    expect(router.state.location.pathname).toBe(`/monitoring/videos/${BVID}`);
    expect(decodeURIComponent(router.state.location.search)).toContain('view=grid');
    expect(decodeURIComponent(router.state.location.search)).toContain('page=2');
    fireEvent.click(await screen.findByRole('link', { name: '返回列表' }));
    expect(router.state.location.pathname).toBe('/monitoring');
    expect((await screen.findByTestId('monitor-layout')).getAttribute('data-view')).toBe('grid');
    expect(router.state.location.search).toContain('view=grid');
    expect(router.state.location.search).toContain('page=2');
    expect(router.state.location.search).toContain('selected=BV1xx411c7mD');

    const returned = screen
      .getAllByTestId('monitor-object-card')
      .find((node) => node.getAttribute('data-external-id') === BVID);
    fireEvent.click(within(returned!).getByRole('link', { name: /详情/ }));
    await screen.findByRole('link', { name: '返回列表' });
    await router.navigate(-1);
    expect(router.state.location.pathname).toBe('/monitoring');
    expect((await screen.findByTestId('monitor-layout')).getAttribute('data-view')).toBe('grid');

    cleanup();
    const fresh = renderAt('/monitoring?tab=videos&view=grid&page=2&selected=BV1xx411c7mD');
    expect((await screen.findByTestId('monitor-layout')).getAttribute('data-view')).toBe('grid');
    expect(fresh.state.location.search).toContain('view=grid');

    const creatorTab = screen.getByRole('tab', { name: 'UP 主' });
    fireEvent.mouseDown(creatorTab);
    fireEvent.click(creatorTab);
    expect((await screen.findByText('离线 UP')).textContent).toContain('离线 UP');
    expect(screen.getByTestId('monitor-layout').getAttribute('data-view')).toBe('grid');
    expect(screen.getByRole('radio', { name: '分栏' })).toBeTruthy();
    expect(pressed('网格')).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: '分栏' }));
    expect(screen.getByTestId('monitor-layout').getAttribute('data-view')).toBe('split');
    expect(screen.getByTestId('monitor-layout').className).toContain('lg:grid-cols-');
    fireEvent.click(screen.getByRole('radio', { name: '网格' }));
    expect(screen.getByTestId('monitor-layout').getAttribute('data-view')).toBe('grid');
  });

  test('dynamics honor the grid layout toggle from the url and filter bar', async () => {
    install([], []);
    renderAt('/monitoring?tab=dynamics&view=grid&page=1');
    expect(
      await screen.findByText('动态可新增监控、暂停与恢复。无监控目标时仍可浏览已有互动指标。'),
    ).toBeTruthy();
    const layout = screen.getByTestId('monitor-layout');
    expect(layout.getAttribute('data-view')).toBe('grid');
    expect(layout.className).not.toContain('lg:grid-cols-');
    expect(screen.getByRole('radio', { name: '分栏' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: '网格' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '新增监控' })).toBeTruthy();
    expect(screen.queryByText(/不在这个页面提供/)).toBeNull();
    expect(screen.getByText('从上方卡片选择一条记录以查看趋势图。')).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看采集记录' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '分栏' }));
    expect(screen.getByTestId('monitor-layout').getAttribute('data-view')).toBe('split');
    expect(screen.getByTestId('monitor-layout').className).toContain('lg:grid-cols-');
  });
});
