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

function videoCard(title: string) {
  return {
    type: 'video',
    externalId: 'BV1xx411c7mD',
    title,
    category: '游戏',
    imageAssetId: null,
    mid: '1',
    displayName: title,
    hasEntity: true,
    hasSamples: false,
    pinned: false,
    monitorState: 'active',
    execution: 'waiting',
    target: {
      id: '11111111-1111-4111-8111-111111111111',
      label: title,
      tags: [],
      enabled: true,
      intervalMinutes: 15,
      intervalMode: 'auto',
      startAt: null,
      nextRunAt: null,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
    },
    projects: [],
    latest: {
      sampledAt: null,
      viewCount: null,
      onlineViewers: null,
      onlineViewersRaw: null,
      likeCount: null,
      followerCount: null,
    },
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

describe('WP-R2-23A / WP-R2-24A unified monitor search (no suggestions)', () => {
  test('debounces URL q and refreshes cards list without a suggestions dropdown', async () => {
    const cardQs: string[] = [];
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
        throw new Error('search-suggestions must not be called');
      }
      if (url.includes('/api/v1/monitor/cards?')) {
        cardQs.push(url);
        const q = new URL(url, 'http://localhost').searchParams.get('q') ?? '';
        const items = q.toLowerCase() === 'pocket' ? [videoCard('Pocket Lab')] : [];
        return Promise.resolve(jsonResponse(list(items)));
      }
      return Promise.resolve(jsonResponse(list([])));
    }) as typeof fetch;

    const router = wrapPage('/monitoring?tab=videos');
    const input = await screen.findByTestId('monitor-unified-search');
    expect(screen.queryByTestId('monitor-search-suggestions')).toBeNull();

    fireEvent.change(input, { target: { value: 'poc' } });
    fireEvent.change(input, { target: { value: 'pocket' } });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, MONITOR_SEARCH_DEBOUNCE_MS + 50));
    });

    await waitFor(() => {
      expect(new URLSearchParams(router.state.location.search).get('q')).toBe('pocket');
    });
    expect(screen.queryByTestId('monitor-search-suggestions')).toBeNull();
    expect(screen.queryByRole('listbox')).toBeNull();

    const qValues = cardQs.map((url) => new URL(url, 'http://localhost').searchParams.get('q'));
    expect(qValues.filter((value) => value === 'poc')).toHaveLength(0);
    expect(qValues.some((value) => value === 'pocket')).toBe(true);

    await waitFor(() => {
      expect(screen.queryByText('没有匹配的条目')).toBeNull();
      expect(screen.getAllByTestId('monitor-object-card').length).toBeGreaterThan(0);
    });
  });

  test('clear button and Escape restore empty q; Enter applies immediately', async () => {
    const applies: unknown[] = [];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MonitorSearchField
          type="video"
          q=""
          category=""
          onApply={(next) => {
            applies.push(next);
          }}
        />
      </QueryClientProvider>,
    );

    const input = screen.getByTestId('monitor-unified-search') as HTMLInputElement;
    expect(input.className).toContain('h-9');
    expect(input.className).toContain('max-w-[360px]');
    expect(input.className).not.toContain('flex-1');
    expect(screen.queryByTestId('monitor-search-clear')).toBeNull();

    fireEvent.change(input, { target: { value: 'BV1xx411c7mD' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(applies.at(-1)).toEqual({
      q: 'BV1xx411c7mD',
      category: '',
      page: 1,
      selected: null,
    });
    expect(screen.queryByTestId('monitor-search-suggestions')).toBeNull();

    const clear = screen.getByTestId('monitor-search-clear');
    fireEvent.click(clear);
    expect(applies.at(-1)).toEqual({
      q: '',
      category: '',
      page: 1,
      selected: null,
    });
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: '3493141386627335' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(applies.at(-1)).toEqual({
      q: '',
      category: '',
      page: 1,
      selected: null,
    });
    expect(input.value).toBe('');
  });

  test('empty match shows empty-state copy without suggestions panel', async () => {
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
        throw new Error('search-suggestions must not be called');
      }
      if (url.includes('/api/v1/monitor/cards?')) {
        return Promise.resolve(jsonResponse(list([])));
      }
      return Promise.resolve(jsonResponse(list([])));
    }) as typeof fetch;

    wrapPage('/monitoring?tab=videos&q=zzz-no-match');
    expect(await screen.findByText('没有匹配的条目')).toBeTruthy();
    expect(screen.queryByTestId('monitor-search-suggestions')).toBeNull();
  });
});
