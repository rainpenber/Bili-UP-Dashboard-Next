import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MonitoringPage } from '@/features/monitoring/monitoring-page';

afterEach(() => {
  cleanup();
});

const MINE = '3493141386627335';
const BVID = 'BV1xx411c7mD';
const OTHER = 'BV1yy411c7mD';
const TARGET = '11111111-1111-4111-8111-111111111111';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function card(externalId: string, mid: string | null = MINE) {
  return {
    type: 'video',
    externalId,
    title: externalId,
    category: '游戏',
    imageAssetId: null,
    mid,
    displayName: externalId,
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
  };
}

function list(items: unknown[], totalItems = items.length) {
  return {
    page: 1,
    pageSize: 8,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / 8)),
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

describe('WP-R2-MON-04 onlyMine UI', () => {
  test('toggle writes URL, resets page/selection, and refetches with onlyMine', async () => {
    const cardUrls: string[] = [];
    const catalog = [card(BVID, MINE), card(OTHER, '1000000000000001')];
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
      if (url.includes('/api/v1/monitor/cards?')) {
        cardUrls.push(url);
        const params = new URL(url, 'http://localhost').searchParams;
        const onlyMine = params.get('onlyMine') === '1';
        const items = onlyMine ? catalog.filter((item) => item.mid === MINE) : catalog;
        return Promise.resolve(jsonResponse(list(items, items.length)));
      }
      if (url.includes('/api/v1/monitor/dynamics')) return Promise.resolve(jsonResponse(list([])));
      if (url.includes('/metrics')) {
        return Promise.resolve(jsonResponse({ bvid: BVID, limit: 500, items: [] }));
      }
      return Promise.resolve(jsonResponse(list([])));
    }) as typeof fetch;

    const router = wrap(
      <MonitoringPage />,
      '/monitoring?tab=videos&page=2&selected=BV1yy411c7mD&q=test&monitor=active&view=grid&sort=published_asc',
    );
    expect(screen.getByText('本人视频')).toBeTruthy();
    const toggle = await screen.findByRole('button', { name: '只看我的' });
    expect(toggle.getAttribute('data-state')).toBe('off');
    expect(await screen.findByText(/狐正正/)).toBeTruthy();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(router.state.location.search).toContain('onlyMine=1');
    });
    expect(router.state.location.search).toContain('q=test');
    expect(router.state.location.search).toContain('monitor=active');
    expect(router.state.location.search).toContain('view=grid');
    expect(router.state.location.search).toContain('sort=published_asc');
    expect(router.state.location.search).not.toContain('selected=');
    expect(router.state.location.search).toContain('page=1');

    await waitFor(() => {
      expect(cardUrls.some((url) => url.includes('onlyMine=1'))).toBe(true);
    });
  });

  test('creators tab hides onlyMine control but URL may keep it', async () => {
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
      if (url.includes('/api/v1/monitor/cards?')) {
        return Promise.resolve(jsonResponse(list([])));
      }
      return Promise.resolve(jsonResponse(list([])));
    }) as typeof fetch;

    wrap(<MonitoringPage />, '/monitoring?tab=creators&onlyMine=1');
    await screen.findByTestId('monitoring-page');
    expect(screen.queryByTestId('monitor-only-mine')).toBeNull();
  });

  test('shows server error when onlyMine and owner not configured', async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/settings/owner-account')) {
        return Promise.resolve(
          jsonResponse(
            { error: '尚未配置本人 B 站账号', code: 'owner_account_not_configured' },
            404,
          ),
        );
      }
      if (url.includes('/api/v1/monitor/cards?') && url.includes('onlyMine=1')) {
        return Promise.resolve(
          jsonResponse(
            {
              error: '尚未配置本人 B 站账号，请到集成与设置中填写 UID 后再开启「只看我的」',
              code: 'owner_account_not_configured',
            },
            400,
          ),
        );
      }
      if (url.includes('/api/v1/monitor/cards?')) {
        return Promise.resolve(jsonResponse(list([card(BVID)])));
      }
      return Promise.resolve(jsonResponse(list([])));
    }) as typeof fetch;

    wrap(<MonitoringPage />, '/monitoring?tab=videos&onlyMine=1');
    expect(await screen.findByText(/尚未配置本人 B 站账号/)).toBeTruthy();
  });
});
