import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import type { MonitorCard } from '@studio/contracts';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { MonitorObjectCard } from '@/features/monitoring/monitor-object-card';
import { MonitorCardControls } from '@/features/monitoring/monitor-object-card';
import { formatVideoGridPlayText } from '@/features/monitoring/video-card-metrics';

afterEach(() => {
  cleanup();
});

function videoCard(patch: Partial<MonitorCard> = {}): MonitorCard {
  return {
    type: 'video',
    externalId: 'BV1xx411c7mD',
    title: '很长很长的视频标题用来验证单行截断',
    category: '游戏',
    imageAssetId: null,
    mid: null,
    displayName: '很长很长的视频标题用来验证单行截断',
    hasEntity: true,
    hasSamples: true,
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
    projects: [{ id: '22222222-2222-4222-8222-222222222222', name: '商单甲' }],
    latest: {
      sampledAt: '2026-10-21T00:00:00.000Z',
      viewCount: '13631',
      onlineViewers: '3',
      onlineViewersRaw: '3',
      likeCount: '9',
      followerCount: null,
    },
    ...patch,
  } as MonitorCard;
}

function renderGrid(card: MonitorCard, onSelect = () => undefined) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: (
          <ul
            className="grid grid-cols-1 items-stretch gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            data-testid="monitor-card-list"
          >
            <MonitorObjectCard
              card={card}
              selected={false}
              listQuery="tab=videos&view=grid"
              presentation="grid"
              onSelect={onSelect}
            />
          </ul>
        ),
      },
      { path: '/monitoring/videos/:bvid', element: <div data-testid="detail-dest" /> },
    ],
    { initialEntries: ['/'] },
  );
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('video grid card', () => {
  test('uses 16:9 cover, single-line title, play exact format, category and update, two buttons only', () => {
    renderGrid(videoCard());
    const card = screen.getByTestId('monitor-object-card');
    expect(card.getAttribute('data-presentation')).toBe('grid');

    const cover = within(card).getByTestId('video-grid-cover');
    expect(cover.className).toContain('aspect-[16/9]');
    expect(cover.className).toContain('object-cover');

    const title = within(card).getByTitle('很长很长的视频标题用来验证单行截断');
    expect(title.className).toContain('truncate');
    expect(title.className).not.toContain('line-clamp-2');

    expect(within(card).getByTestId('video-grid-metrics').textContent).toContain(
      formatVideoGridPlayText('13631'),
    );
    expect(within(card).getByTestId('video-grid-metrics').textContent).toContain('在线');
    expect(within(card).getByTestId('video-grid-meta').textContent).toMatch(/分类：游戏/);
    expect(within(card).getByTestId('video-grid-meta').textContent).toMatch(
      /更新：\d{4}-\d{2}-\d{2} \d{2}:\d{2}/,
    );

    expect(within(card).getByRole('link', { name: /详情/ })).toBeTruthy();
    expect(within(card).getByRole('button', { name: '暂停' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: '更多' })).toBeNull();
    expect(within(card).queryByRole('button', { name: '监控详情' })).toBeNull();
    expect(within(card).queryByRole('button', { name: '监控设置' })).toBeNull();
    expect(within(card).queryByRole('link', { name: '查看日志' })).toBeNull();
    expect(within(card).queryByText('最近失败')).toBeNull();
    expect(within(card).queryByText('频率：')).toBeNull();
    expect(card.textContent).not.toContain('计划开始');
    expect(card.textContent).not.toContain('上一次成功采集');

    const list = screen.getByTestId('monitor-card-list');
    expect(list.className).toContain('xl:grid-cols-4');
    expect(list.className).toContain('sm:grid-cols-2');
    expect(list.className).toContain('lg:grid-cols-3');
  });

  test('failed execution shows red dot on state badge without failure text row', () => {
    renderGrid(
      videoCard({
        execution: 'failed',
        target: {
          ...videoCard().target!,
          lastError: '上游超时',
        },
      }),
    );
    const card = screen.getByTestId('monitor-object-card');
    expect(within(card).getByTestId('video-grid-failure-dot')).toBeTruthy();
    expect(card.textContent).not.toContain('最近失败：上游超时');
  });

  test('card select fires from body but not from action buttons', () => {
    let selected = 0;
    renderGrid(videoCard(), () => {
      selected += 1;
    });
    const card = screen.getByTestId('monitor-object-card');
    fireEvent.click(within(card).getByTestId('video-grid-cover'));
    expect(selected).toBe(1);
    fireEvent.click(within(card).getByRole('button', { name: '暂停' }));
    expect(selected).toBe(1);
    fireEvent.click(within(card).getByRole('link', { name: /详情/ }));
    expect(selected).toBe(1);
  });

  test('list presentation keeps disclosure and more actions', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <MonitorObjectCard
              card={videoCard()}
              selected={false}
              listQuery=""
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
    const card = screen.getByTestId('monitor-object-card');
    expect(within(card).getByRole('button', { name: '更多' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: '监控详情' })).toBeTruthy();
    expect(within(card).getByRole('link', { name: '查看详情' })).toBeTruthy();
    expect(within(card).queryByTestId('video-grid-cover')).toBeNull();
  });

  test('detail layout surfaces settings, collect, logs, remove, and project', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: (
            <MonitorCardControls card={videoCard()} listQuery="" layout="detail" includeDetailLink={false} />
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
    const secondary = screen.getByTestId('monitor-detail-secondary-actions');
    expect(within(secondary).getByRole('button', { name: '监控设置' })).toBeTruthy();
    expect(within(secondary).getByRole('button', { name: '立即采集' })).toBeTruthy();
    expect(within(secondary).getByRole('button', { name: '移除' })).toBeTruthy();
    expect(within(secondary).getByRole('link', { name: '进入商单' })).toBeTruthy();
    expect(screen.getByRole('link', { name: '查看日志' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '更多' })).toBeNull();
  });
});
