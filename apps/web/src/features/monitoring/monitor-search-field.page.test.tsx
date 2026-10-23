import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import {
  MONITOR_SEARCH_DEBOUNCE_MS,
  MonitorSearchField,
} from '@/features/monitoring/monitor-search-field';
import { MonitoringPage } from '@/features/monitoring/monitoring-page';

afterEach(() => {
  cleanup();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function list(items: unknown[] = []) {
  return {
    page: 1,
    pageSize: 8,
    totalItems: items.length,
    totalPages: 1,
    items,
  };
}

function wrapPage(entry: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: '/monitoring', element: <MonitoringPage /> }], {
    initialEntries: [entry],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('WP-R2-23A unified monitor search', () => {
  test('debounces list requests and ignores stale suggestion responses', async () => {
    const cardQs: string[] = [];
    let suggestionCalls = 0;
    const staleHolders: Array<(body: unknown) => void> = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/settings/owner-account')) {
        return Promise.resolve(
          jsonResponse({
            mid: '3493141386627335',
            displayName: '狐正正',
            updatedAt: '2026-10-22T00:00:00.000Z',
          }),
        );
      }
      if (url.includes('/search-suggestions')) {
        suggestionCalls += 1;
        const params = new URL(url, 'http://localhost').searchParams;
        const q = params.get('q') ?? '';
        if (q === '旧') {
          return new Promise((resolve) => {
            staleHolders.push((body) => resolve(jsonResponse(body)));
          });
        }
        return Promise.resolve(
          jsonResponse({
            q,
            type: 'video',
            limit: 5,
            videos: [
              {
                kind: 'video',
                label: '新视频标题',
                secondary: '狐正正 · BV1xx411c7mD',
                value: 'BV1xx411c7mD',
              },
            ],
            creators: [],
            categories: [],
          }),
        );
      }
      if (url.includes('/api/v1/monitor/cards?')) {
        cardQs.push(url);
        return Promise.resolve(jsonResponse(list([])));
      }
      return Promise.resolve(jsonResponse(list([])));
    }) as typeof fetch;

    const router = wrapPage('/monitoring?tab=videos');
    const input = await screen.findByTestId('monitor-unified-search');
    fireEvent.change(input, { target: { value: '旧' } });
    fireEvent.change(input, { target: { value: '新' } });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, MONITOR_SEARCH_DEBOUNCE_MS + 50));
    });

    await waitFor(() => {
      expect(router.state.location.search).toContain('q=%E6%96%B0');
    });
    expect(router.state.location.search).not.toContain('q=%E6%97%A7');
    const qValues = cardQs.map((url) => new URL(url, 'http://localhost').searchParams.get('q'));
    expect(qValues.filter((value) => value === '旧')).toHaveLength(0);
    expect(qValues.some((value) => value === '新')).toBe(true);

    await waitFor(() => {
      expect(screen.getByText('新视频标题')).toBeTruthy();
    });
    expect(suggestionCalls).toBeGreaterThanOrEqual(1);

    // Late stale response must not replace the newer suggestion label.
    for (const resolveStale of staleHolders) {
      resolveStale({
        q: '旧',
        type: 'video',
        limit: 5,
        videos: [
          {
            kind: 'video',
            label: '过期标题不应出现',
            secondary: 'BV1yy411c7mD',
            value: 'BV1yy411c7mD',
          },
        ],
        creators: [],
        categories: [],
      });
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.queryByText('过期标题不应出现')).toBeNull();
    expect(screen.getByText('新视频标题')).toBeTruthy();
  });

  test('suggestion click and keyboard apply readable filters', async () => {
    const applies: unknown[] = [];
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/search-suggestions')) {
        return Promise.resolve(
          jsonResponse({
            q: '狐',
            type: 'video',
            limit: 5,
            videos: [
              {
                kind: 'video',
                label: '狐正正的日常',
                secondary: '狐正正 · BV1xx411c7mD',
                value: 'BV1xx411c7mD',
              },
            ],
            creators: [
              {
                kind: 'creator',
                label: '狐正正',
                secondary: '3493141386627335',
                value: '3493141386627335',
              },
            ],
            categories: [{ kind: 'category', label: '游戏', secondary: null, value: '游戏' }],
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    function Harness() {
      return (
        <MonitorSearchField
          type="video"
          q=""
          category=""
          onApply={(next) => {
            applies.push(next);
          }}
        />
      );
    }
    render(
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>,
    );

    const input = screen.getByTestId('monitor-unified-search');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '狐' } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, MONITOR_SEARCH_DEBOUNCE_MS + 50));
    });

    expect(await screen.findByText('狐正正的日常')).toBeTruthy();
    expect(screen.getByText('狐正正')).toBeTruthy();
    expect(screen.getByText('游戏')).toBeTruthy();
    // Primary labels are readable — BV/UID only as secondary.
    expect(screen.getByText(/BV1xx411c7mD/)).toBeTruthy();
    expect(screen.getByText('3493141386627335')).toBeTruthy();

    fireEvent.click(screen.getByRole('option', { name: /游戏/ }));
    expect(applies.at(-1)).toEqual({
      q: '',
      category: '游戏',
      page: 1,
      selected: null,
    });

    fireEvent.change(input, { target: { value: '狐' } });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, MONITOR_SEARCH_DEBOUNCE_MS + 50));
    });
    await screen.findByText('狐正正的日常');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(applies.at(-1)).toEqual({
      q: '狐正正的日常',
      category: '',
      page: 1,
      selected: 'BV1xx411c7mD',
    });
  });
});
