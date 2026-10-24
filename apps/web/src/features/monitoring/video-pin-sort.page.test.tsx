import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MonitoringPage } from '@/features/monitoring/monitoring-page';
import { MonitorObjectCard } from '@/features/monitoring/monitor-object-card';

afterEach(() => {
  cleanup();
});

const BVID = 'BV1xx411c7mD';
const OTHER = 'BV1yy411c7mD';
const TARGET = '11111111-1111-4111-8111-111111111111';

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
    title: externalId === OTHER ? '较早视频' : '较新视频',
    category: '游戏',
    imageAssetId: null,
    imageUrl: null,
    imageProxyUrl: null,
    mid: null,
    displayName: externalId === OTHER ? '较早视频' : '较新视频',
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
    projects: [],
    latest: {
      sampledAt: '2026-10-21T00:00:00.000Z',
      viewCount: '10',
      onlineViewers: '1',
      onlineViewersRaw: '1',
      likeCount: '1',
      followerCount: null,
    },
    ...patch,
  };
}

function list(items: unknown[]) {
  return { page: 1, pageSize: 8, totalItems: items.length, totalPages: 1, items };
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

describe('WP-R2-MON-01 video pin + sort UI', () => {
  test('video tab exposes sort control that updates URL and refetch query', async () => {
    const cardUrls: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/v1/monitor/cards?')) {
        cardUrls.push(url);
        const params = new URL(url, 'http://localhost').searchParams;
        const sort = params.get('sort') ?? 'published_desc';
        const items =
          sort === 'published_asc' ? [card(OTHER), card(BVID)] : [card(BVID), card(OTHER)];
        return Promise.resolve(jsonResponse(list(items)));
      }
      if (url.includes('/api/v1/monitor/dynamics')) return Promise.resolve(jsonResponse(list([])));
      if (url.includes('/metrics')) {
        return Promise.resolve(jsonResponse({ bvid: BVID, limit: 500, items: [] }));
      }
      return Promise.resolve(jsonResponse(list([])));
    }) as typeof fetch;

    const router = wrap(<MonitoringPage />, '/monitoring?tab=videos');
    expect(await screen.findByLabelText('排序')).toBeTruthy();
    expect(screen.queryByLabelText('排序')?.getAttribute('data-disabled')).not.toBe('true');

    const first = await screen.findAllByTestId('monitor-object-card');
    expect(first[0]?.getAttribute('data-external-id')).toBe(BVID);

    fireEvent.click(screen.getByLabelText('排序'));
    fireEvent.click(await screen.findByRole('option', { name: '最早发布' }));

    await waitFor(() => {
      expect(router.state.location.search).toContain('sort=published_asc');
    });
    await waitFor(() => {
      expect(cardUrls.some((url) => url.includes('sort=published_asc'))).toBe(true);
    });
    const ordered = await screen.findAllByTestId('monitor-object-card');
    expect(ordered[0]?.getAttribute('data-external-id')).toBe(OTHER);
  });

  test('creators and dynamics tabs expose sort and pin controls', async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/v1/monitor/cards?')) {
        return Promise.resolve(
          jsonResponse(
            list([
              card('81990099', {
                type: 'creator',
                externalId: '81990099',
                title: null,
                displayName: '离线 UP',
                pinned: false,
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
      if (url.includes('/api/v1/monitor/dynamics')) {
        return Promise.resolve(
          jsonResponse(
            list([
              {
                dynamicId: '966692349750018048',
                mid: '1',
                category: null,
                monitoringEnabled: true,
                archivedAt: null,
                deletedAt: null,
                pinned: false,
                target: null,
                authorName: null,
                publishedAt: null,
                textSummary: null,
                targetLabel: null,
                displayTitle: '966692349750018048',
                latestMetrics: {
                  sampledAt: null,
                  likeCount: null,
                  repostCount: null,
                  commentCount: null,
                },
              },
            ]),
          ),
        );
      }
      if (url.includes('/metrics')) {
        return Promise.resolve(jsonResponse({ mid: '81990099', limit: 500, items: [] }));
      }
      return Promise.resolve(jsonResponse(list([])));
    }) as typeof fetch;

    wrap(<MonitoringPage />, '/monitoring?tab=creators');
    await screen.findByTestId('monitor-object-card');
    expect(screen.getByLabelText('排序')).toBeTruthy();
    expect(screen.getByTestId('monitor-pin-button')).toBeTruthy();

    cleanup();
    wrap(<MonitoringPage />, '/monitoring?tab=dynamics');
    await screen.findByTestId('dynamic-card-list');
    expect(screen.getByLabelText('排序')).toBeTruthy();
    expect(screen.getByTestId('monitor-pin-button')).toBeTruthy();
  });

  test('pin button is outside the two action keys and rolls back on error', async () => {
    let pinCalls = 0;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/pin') && init?.method === 'PATCH') {
        pinCalls += 1;
        return Promise.resolve(jsonResponse({ error: '置顶写入失败', code: 'internal' }, 500));
      }
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <MonitorObjectCard
              card={card(BVID) as never}
              selected={false}
              listQuery="tab=videos"
              presentation="list"
              onSelect={() => undefined}
            />
          ),
        },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    );

    const row = screen.getByTestId('monitor-object-card');
    const actions = within(row).getByTestId('monitor-card-actions');
    expect(within(actions).queryByTestId('video-pin-button')).toBeNull();
    expect(within(actions).queryByRole('button', { name: /^详情$/ })).toBeNull();
    expect(within(actions).getByRole('button', { name: '暂停' })).toBeTruthy();

    const pin = within(row).getByTestId('video-pin-button');
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(pin);
    await waitFor(() => expect(pinCalls).toBe(1));
    expect((await within(row).findByRole('alert')).textContent).toContain('置顶写入失败');
    expect(pin.getAttribute('aria-pressed')).toBe('false');
    expect(pin.getAttribute('data-pinned')).toBe('false');
  });

  test('successful pin refetches and shows filled pin without changing action buttons', async () => {
    let pinned = false;
    let listCalls = 0;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/pin') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body)) as { pinned: boolean };
        pinned = body.pinned;
        return Promise.resolve(
          jsonResponse({
            bvid: BVID,
            pinned,
            pinnedAt: pinned ? '2026-10-22T00:00:00.000Z' : null,
          }),
        );
      }
      if (url.includes('/api/v1/monitor/cards?')) {
        listCalls += 1;
        return Promise.resolve(jsonResponse(list([card(BVID, { pinned }), card(OTHER)])));
      }
      if (url.includes('/metrics')) {
        return Promise.resolve(jsonResponse({ bvid: BVID, limit: 500, items: [] }));
      }
      if (url.includes('/api/v1/monitor/dynamics')) return Promise.resolve(jsonResponse(list([])));
      return Promise.resolve(jsonResponse(list([])));
    }) as typeof fetch;

    wrap(<MonitoringPage />, '/monitoring?tab=videos&view=grid');
    const rows = await screen.findAllByTestId('monitor-object-card');
    const row = rows.find((item) => item.getAttribute('data-external-id') === BVID);
    expect(row).toBeTruthy();
    const beforeLists = listCalls;
    fireEvent.click(within(row!).getByTestId('video-pin-button'));
    await waitFor(() => expect(listCalls).toBeGreaterThan(beforeLists));
    await waitFor(() => {
      const refreshed = screen
        .getAllByTestId('monitor-object-card')
        .find((item) => item.getAttribute('data-external-id') === BVID);
      expect(refreshed).toBeTruthy();
      expect(within(refreshed!).getByTestId('video-pin-button').getAttribute('aria-pressed')).toBe(
        'true',
      );
      expect(within(refreshed!).getByTestId('video-pin-icon-filled')).toBeTruthy();
      const actions = within(refreshed!).getByTestId('monitor-card-actions');
      // Primary monitor action + Bilibili external link (WP-R2-26B).
      expect(
        within(actions).getAllByRole('button').length +
          within(actions).queryAllByRole('link').length,
      ).toBe(2);
      expect(within(actions).getByRole('link', { name: '在 B 站打开' })).toBeTruthy();
      expect(within(actions).getByRole('button', { name: '暂停' })).toBeTruthy();
    });
  });
});
