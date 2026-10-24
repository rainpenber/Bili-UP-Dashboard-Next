import { mock } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();

mock.module('echarts-for-react', () => ({
  default: React.forwardRef<HTMLDivElement, { option?: unknown }>(function MockECharts(
    { option },
    ref,
  ) {
    return <div ref={ref} data-testid="mock-echart" data-option={JSON.stringify(option ?? null)} />;
  }),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import type { MonitorCard } from '@studio/contracts';

const { MonitoringPage } = await import('@/features/monitoring/monitoring-page');

const originalFetch = globalThis.fetch;
const MID = '81990099';
const TARGET = '11111111-1111-4111-8111-111111111111';
const SAMPLED_AT = '2026-10-19T18:59:59.000Z';

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
  return { page: 1, pageSize: 8, totalItems: items.length, totalPages: 1, items };
}

function creatorCard(): MonitorCard {
  return {
    type: 'creator',
    externalId: MID,
    title: null,
    category: null,
    imageAssetId: null,
    imageUrl: null,
    imageProxyUrl: null,
    mid: MID,
    displayName: '狐正正',
    hasEntity: true,
    hasSamples: true,
    pinned: false,
    monitorState: 'active',
    execution: 'waiting',
    target: {
      id: TARGET,
      label: '狐正正',
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
      sampledAt: SAMPLED_AT,
      viewCount: null,
      onlineViewers: null,
      onlineViewersRaw: null,
      likeCount: null,
      followerCount: '51733',
    },
  };
}

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: '/monitoring', element: <MonitoringPage /> }], {
    initialEntries: [path],
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, view };
}

function installFetch(urls: string[]) {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    if (url.includes('/settings/owner-account')) {
      return Promise.resolve(
        jsonResponse({
          mid: '3493141386627335',
          displayName: '狐正正',
          updatedAt: '2026-10-22T00:00:00.000Z',
        }),
      );
    }
    if (url.includes(`/creators/${MID}/publish-events`)) {
      return Promise.resolve(
        jsonResponse({
          page: 1,
          pageSize: 200,
          totalItems: 1,
          totalPages: 1,
          items: [
            {
              id: 'e-near',
              mid: MID,
              eventKind: 'video',
              externalId: 'BV1xx411c7mD',
              publishedAt: SAMPLED_AT,
              titleSnapshot: '同日发布的视频',
              firstDiscoveredAt: SAMPLED_AT,
              source: 'bilibili',
              monitored: true,
              monitoredTargetId: TARGET,
              navigable: true,
            },
          ],
        }),
      );
    }
    if (url.includes(`/creators/${MID}/metrics`)) {
      return Promise.resolve(
        jsonResponse({
          mid: MID,
          limit: 500,
          items: [
            {
              sampledAt: SAMPLED_AT,
              rawTime: '2026-10-19 18:59',
              sourceTimezone: 'Asia/Shanghai',
              timestampPrecision: 'second',
              followerCount: '51733',
            },
          ],
        }),
      );
    }
    if (url.includes(`/creators/${MID}/videos`)) {
      return Promise.resolve(jsonResponse({ mid: MID, total: 0, items: [] }));
    }
    if (url.includes('/api/v1/monitor/cards?')) {
      const params = new URL(url, 'http://localhost').searchParams;
      return Promise.resolve(
        jsonResponse(params.get('type') === 'creator' ? list([creatorCard()]) : list([])),
      );
    }
    return Promise.resolve(jsonResponse(list([])));
  }) as typeof fetch;
}

function publishEventCalls(urls: string[]): number {
  return urls.filter((url) => url.includes(`/creators/${MID}/publish-events`)).length;
}

function readPublishSeries(chart: HTMLElement): unknown[] | undefined {
  const option = JSON.parse(
    within(chart).getByTestId('mock-echart').getAttribute('data-option') ?? 'null',
  ) as { series?: { name?: string; data?: unknown[] }[] };
  return option.series?.find((series) => series.name === '事件')?.data;
}

describe('WP-OC-005 monitor trend card publish events', () => {
  test('selecting a creator loads publish events and plots event points', async () => {
    const urls: string[] = [];
    installFetch(urls);
    const { router, view } = renderAt('/monitoring?tab=creators');

    fireEvent.click(await view.findByRole('button', { name: /选择UP 主 狐正正/ }));
    expect(router.state.location.search).toContain(`selected=${MID}`);

    const chart = await view.findByTestId('follower-chart');
    await waitFor(() => {
      expect(publishEventCalls(urls)).toBe(1);
      expect(readPublishSeries(chart)).toHaveLength(1);
    });

    const videoTab = view.getByRole('tab', { name: '视频' });
    fireEvent.mouseDown(videoTab);
    fireEvent.click(videoTab);
    await waitFor(() => {
      expect(router.state.location.search).toContain('tab=videos');
      expect(urls.some((url) => url.includes('type=video'))).toBe(true);
    });
    expect(publishEventCalls(urls)).toBe(1);
  });
});
