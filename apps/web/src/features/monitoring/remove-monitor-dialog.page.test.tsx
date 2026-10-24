import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import type { MonitorCard } from '@studio/contracts';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ToastHost } from '@/components/ui/toast';
import { MonitorCardControls } from '@/features/monitoring/monitor-object-card';

afterEach(() => {
  cleanup();
});

function videoCard(patch: Partial<MonitorCard> = {}): MonitorCard {
  return {
    type: 'video',
    externalId: 'BV1xx411c7mD',
    title: '测试视频',
    category: '游戏',
    imageAssetId: null,
    mid: null,
    displayName: '测试视频',
    hasEntity: true,
    hasSamples: true,
    pinned: false,
    monitorState: 'active',
    execution: 'none',
    target: {
      id: '11111111-1111-4111-8111-111111111111',
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
      viewCount: '100',
      onlineViewers: '3',
      onlineViewersRaw: null,
      likeCount: '9',
      followerCount: null,
    },
    ...patch,
  } as MonitorCard;
}

function wrap(ui: ReactNode, path = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: '/', element: ui },
      { path: '/monitoring', element: <div data-testid="list-page">列表</div> },
      { path: '/ops', element: <div /> },
      { path: '/projects/:id', element: <div /> },
    ],
    { initialEntries: [path] },
  );
  render(
    <QueryClientProvider client={client}>
      <ToastHost />
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('remove monitor confirmation', () => {
  test('clicking 移除 does not call delete until confirmed; cancel never calls', async () => {
    const deletes: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/targets/') && (init?.method === 'DELETE' || init?.method === 'delete')) {
        deletes.push(url);
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    }) as typeof fetch;

    try {
      wrap(
        <MonitorCardControls
          card={videoCard()}
          listQuery="tab=videos"
          layout="detail"
          includeDetailLink={false}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: '移除' }));
      expect(deletes).toHaveLength(0);
      const dialog = await screen.findByTestId('remove-monitor-dialog');
      expect(within(dialog).getByText('移除监控？')).toBeTruthy();
      fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));
      await waitFor(() => {
        expect(screen.queryByTestId('remove-monitor-dialog')).toBeNull();
      });
      expect(deletes).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('confirm calls delete once and returns to list with toast', async () => {
    const deletes: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/targets/') && (init?.method === 'DELETE' || init?.method === 'delete')) {
        deletes.push(url);
        return new Response(null, { status: 204 });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    }) as typeof fetch;

    try {
      const router = wrap(
        <MonitorCardControls
          card={videoCard()}
          listQuery="tab=videos&page=1"
          layout="detail"
          includeDetailLink={false}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: '移除' }));
      expect(deletes).toHaveLength(0);
      const dialog = await screen.findByTestId('remove-monitor-dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: '确认移除' }));
      await waitFor(() => {
        expect(deletes).toHaveLength(1);
      });
      expect(deletes[0]).toContain('11111111-1111-4111-8111-111111111111');
      await waitFor(() => {
        expect(router.state.location.pathname).toBe('/monitoring');
      });
      expect(await screen.findByTestId('app-toast')).toBeTruthy();
      expect(screen.getByTestId('app-toast').textContent).toContain('已移除监控');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('failed delete keeps dialog open and shows error', async () => {
    const deletes: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/targets/') && (init?.method === 'DELETE' || init?.method === 'delete')) {
        deletes.push(url);
        return new Response(JSON.stringify({ error: '删除失败', code: 'internal' }), {
          status: 500,
        });
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    }) as typeof fetch;

    try {
      wrap(
        <MonitorCardControls
          card={videoCard()}
          listQuery="tab=videos"
          layout="detail"
          includeDetailLink={false}
        />,
      );

      fireEvent.click(screen.getByRole('button', { name: '移除' }));
      const dialog = await screen.findByTestId('remove-monitor-dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: '确认移除' }));
      await waitFor(() => {
        expect(deletes).toHaveLength(1);
      });
      expect(await within(dialog).findByRole('alert')).toBeTruthy();
      expect(screen.getByTestId('remove-monitor-dialog')).toBeTruthy();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
