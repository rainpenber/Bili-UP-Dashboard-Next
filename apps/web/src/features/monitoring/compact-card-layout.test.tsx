import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import type { DynamicListItem, MonitorCard } from '@studio/contracts';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { DynamicObjectCard } from '@/features/monitoring/dynamic-object-card';
import { MonitorObjectCard } from '@/features/monitoring/monitor-object-card';

afterEach(() => {
  cleanup();
});

function videoCard(patch: Partial<MonitorCard> = {}): MonitorCard {
  return {
    type: 'video',
    externalId: 'BV1xx411c7mD',
    title: '超级超级超级超级超级超级长的视频标题用来验证单行省略与悬停全名',
    category: '游戏',
    imageAssetId: null,
    imageUrl: null,
    imageProxyUrl: null,
    mid: null,
    displayName: '超级超级超级超级超级超级长的视频标题用来验证单行省略与悬停全名',
    hasEntity: true,
    hasSamples: true,
    pinned: false,
    monitorState: 'unmonitored',
    execution: 'none',
    target: null,
    projects: [],
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

function creatorCard(patch: Partial<MonitorCard> = {}): MonitorCard {
  return {
    type: 'creator',
    externalId: '12345',
    title: null,
    category: null,
    imageAssetId: null,
    imageUrl: null,
    imageProxyUrl: null,
    mid: '12345',
    displayName: '很长的UP主名称用于截断验证',
    hasEntity: true,
    hasSamples: true,
    pinned: false,
    monitorState: 'active',
    execution: 'none',
    target: {
      id: '11111111-1111-4111-8111-111111111111',
      label: 'UP',
      tags: [],
      enabled: true,
      intervalMinutes: 240,
      intervalMode: 'auto',
      startAt: null,
      nextRunAt: null,
      lastRunAt: null,
      lastSuccessAt: '2026-10-21T00:00:00.000Z',
      lastError: null,
    },
    projects: [],
    latest: {
      sampledAt: '2026-10-21T00:00:00.000Z',
      viewCount: null,
      onlineViewers: null,
      onlineViewersRaw: null,
      likeCount: null,
      followerCount: '98000',
    },
    ...patch,
  } as MonitorCard;
}

function dynamicItem(patch: Partial<DynamicListItem> = {}): DynamicListItem {
  return {
    dynamicId: '966692349750018048',
    mid: '1',
    category: null,
    monitoringEnabled: true,
    archivedAt: null,
    deletedAt: null,
    pinned: false,
    target: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      enabled: true,
      intervalMinutes: 60,
      intervalMode: 'fixed',
      lastSuccessAt: '2026-10-21T08:00:00.000Z',
      lastError: null,
    },
    authorName: '测试作者',
    publishedAt: '2026-08-28T05:29:00.000Z',
    textSummary: '抽PS5和GTA6啦!',
    targetLabel: null,
    displayTitle: '测试作者 · 抽PS5和GTA6啦!',
    latestMetrics: {
      sampledAt: '2026-10-21T08:00:00.000Z',
      likeCount: '12',
      repostCount: '3',
      commentCount: '4',
    },
    ...patch,
  };
}

function wrap(ui: ReactNode, routes: { path: string; element: ReactNode }[] = []) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const router = createMemoryRouter([{ path: '/', element: ui }, ...routes], {
    initialEntries: ['/'],
  });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

describe('WP-R2-16G compact card layout', () => {
  test('list video: 16:9 thumb, two actions beside info, truncate+title, start-monitor wide label', () => {
    let selected = 0;
    wrap(
      <MonitorObjectCard
        card={videoCard()}
        selected={false}
        listQuery="tab=videos"
        presentation="list"
        onSelect={() => {
          selected += 1;
        }}
      />,
    );
    const card = screen.getByTestId('monitor-object-card');
    const cover = within(card).getByTestId('monitor-list-cover');
    expect(cover.className).toContain('aspect-video');
    expect(cover.className).toContain('w-24');
    expect(cover.className).not.toContain('size-16');
    expect(cover.getAttribute('width')).toBe('96');
    expect(cover.getAttribute('height')).toBe('54');

    const title = within(card).getByTitle(
      '超级超级超级超级超级超级长的视频标题用来验证单行省略与悬停全名',
    );
    expect(title.className).toContain('truncate');

    const actions = within(card).getByTestId('monitor-card-actions');
    expect(within(actions).queryByRole('button', { name: /^详情$/ })).toBeNull();
    expect(within(actions).getByRole('button', { name: '开始监控' })).toBeTruthy();
    expect(within(card).getByTestId('video-pin-button')).toBeTruthy();
    expect(within(actions).queryByTestId('video-pin-button')).toBeNull();
    expect(actions.className).toContain('items-center');
    expect(actions.className).not.toContain('mt-auto');

    fireEvent.click(within(card).getByTestId('monitor-card-controls'));
    expect(selected).toBe(1);
    fireEvent.click(within(actions).getByRole('button', { name: '开始监控' }));
    expect(selected).toBe(1);
  });

  test('list video: failure red dot and pin click does not select', () => {
    let selected = 0;
    wrap(
      <MonitorObjectCard
        card={videoCard({
          monitorState: 'active',
          execution: 'failed',
          target: {
            id: '11111111-1111-4111-8111-111111111111',
            label: '视频',
            tags: [],
            enabled: true,
            intervalMinutes: 15,
            intervalMode: 'auto',
            startAt: null,
            nextRunAt: null,
            lastRunAt: null,
            lastSuccessAt: null,
            lastError: '上游超时',
          },
        })}
        selected={false}
        listQuery=""
        presentation="list"
        onSelect={() => {
          selected += 1;
        }}
      />,
    );
    const card = screen.getByTestId('monitor-object-card');
    expect(within(card).getByTestId('monitor-list-failure-dot')).toBeTruthy();
    expect(card.textContent).not.toContain('最近失败');
    const pin = within(card).getByTestId('video-pin-button');
    fireEvent.click(pin);
    expect(selected).toBe(0);
    expect(within(card).getByTestId('monitor-card-actions').contains(pin)).toBe(false);
  });

  test('list creator keeps circular avatar and two actions', () => {
    wrap(
      <MonitorObjectCard
        card={creatorCard()}
        selected={false}
        listQuery="tab=creators"
        presentation="list"
        onSelect={() => undefined}
      />,
    );
    const card = screen.getByTestId('monitor-object-card');
    const avatar = within(card).getByTestId('monitor-list-avatar');
    expect(avatar.className).toContain('rounded-full');
    expect(avatar.className).toContain('size-14');
    expect(within(card).getByTestId('monitor-list-metrics').textContent).toMatch(/粉丝/);
    const actions = within(card).getByTestId('monitor-card-actions');
    expect(within(actions).queryByRole('button', { name: /^详情$/ })).toBeNull();
    expect(within(actions).getByRole('button', { name: '暂停' })).toBeTruthy();
    expect(within(card).getByTestId('monitor-pin-button')).toBeTruthy();
  });

  test('grid video: title and metrics are full-width rows; actions sit with meta, pin on cover', () => {
    let selected = 0;
    const longName = '超级超级超级超级超级超级长的视频标题用来验证单行省略与悬停全名';
    wrap(
      <MonitorObjectCard
        card={videoCard({
          displayName: longName,
          title: longName,
          monitorState: 'unmonitored',
          target: null,
          latest: {
            sampledAt: '2026-10-21T00:00:00.000Z',
            viewCount: '13631',
            onlineViewers: '3',
            onlineViewersRaw: '3',
            likeCount: '9',
            followerCount: null,
          },
        })}
        selected={false}
        listQuery="tab=videos&view=grid"
        presentation="grid"
        onSelect={() => {
          selected += 1;
        }}
      />,
      [{ path: '/monitoring/videos/:bvid', element: <div /> }],
    );
    const card = screen.getByTestId('monitor-object-card');
    expect(within(card).getByTestId('video-grid-cover').className).toContain('aspect-[16/9]');
    const title = within(card).getByTestId('video-grid-title');
    expect(title.getAttribute('title')).toBe(longName);
    expect(title.className).toContain('truncate');
    const metrics = within(card).getByTestId('video-grid-metrics');
    expect(metrics.textContent).toMatch(/播放/);
    expect(metrics.textContent).toMatch(/在线/);
    // 标题/指标不与两键同处一侧挤压：动作组不含标题节点
    const actions = within(card).getByTestId('monitor-card-actions');
    expect(actions.contains(title)).toBe(false);
    expect(actions.contains(metrics)).toBe(false);
    expect(actions.className).not.toContain('mt-auto');
    expect(within(actions).queryByRole('link', { name: /详情/ })).toBeNull();
    expect(within(actions).getByRole('button', { name: '开始监控' })).toBeTruthy();
    expect(within(actions).queryByTestId('video-pin-button')).toBeNull();
    const pin = within(card).getByTestId('video-pin-button');
    fireEvent.click(pin);
    expect(selected).toBe(0);
    fireEvent.click(within(card).getByTestId('video-grid-cover'));
    // grid click navigates; onSelect is unused for grid bodies
    expect(selected).toBe(0);
  });

  test('grid creator and dynamic keep full-width title/metrics away from action strip', () => {
    wrap(
      <MonitorObjectCard
        card={creatorCard({ displayName: '很长的UP主名称用于截断验证' })}
        selected={false}
        listQuery="tab=creators&view=grid"
        presentation="grid"
        onSelect={() => undefined}
      />,
      [{ path: '/monitoring/creators/:mid', element: <div /> }],
    );
    const creator = screen.getByTestId('monitor-object-card');
    const creatorTitle = within(creator).getByTestId('creator-grid-title');
    const creatorMetrics = within(creator).getByTestId('creator-grid-metrics');
    expect(creatorTitle.className).toContain('truncate');
    expect(creatorMetrics.textContent).toMatch(/粉丝/);
    expect(within(creator).getByTestId('monitor-card-actions').contains(creatorTitle)).toBe(false);
    expect(within(creator).getByTestId('monitor-card-actions').contains(creatorMetrics)).toBe(
      false,
    );

    cleanup();
    wrap(
      <DynamicObjectCard
        item={dynamicItem()}
        selected={false}
        listQuery="tab=dynamics&view=grid"
        presentation="grid"
        onSelect={() => undefined}
      />,
      [{ path: '/monitoring/dynamics/:id', element: <div /> }],
    );
    const dyn = screen.getByTestId('dynamic-list-item');
    expect(dyn.getAttribute('data-presentation')).toBe('grid');
    const dynTitle = within(dyn).getByTestId('dynamic-card-title');
    const dynMetrics = within(dyn).getByTestId('dynamic-card-metrics');
    expect(dynTitle.getAttribute('title')).toBe('测试作者 · 抽PS5和GTA6啦!');
    expect(dynMetrics.textContent).toMatch(/赞/);
    expect(dynMetrics.textContent).not.toMatch(/\d{2}:\d{2}/);
    expect(dynMetrics.getAttribute('title') ?? '').toMatch(/赞/);
    const dynActions = within(dyn).getByTestId('dynamic-monitor-controls');
    expect(dynActions.contains(dynTitle)).toBe(false);
    expect(dynActions.contains(dynMetrics)).toBe(false);
  });

  test('dynamic list/grid: no cover, two actions beside info, truncate title', () => {
    wrap(
      <DynamicObjectCard
        item={dynamicItem()}
        selected={false}
        listQuery="tab=dynamics"
        presentation="list"
        onSelect={() => undefined}
      />,
      [{ path: '/monitoring/dynamics/:id', element: <div /> }],
    );
    const listCard = screen.getByTestId('dynamic-list-item');
    expect(within(listCard).queryByRole('img')).toBeNull();
    expect(within(listCard).getByTitle('测试作者 · 抽PS5和GTA6啦!').className).toContain(
      'truncate',
    );
    const controls = within(listCard).getByTestId('dynamic-monitor-controls');
    expect(controls.className).not.toContain('mt-auto');
    expect(controls.className).toContain('items-center');
    expect(within(controls).queryByRole('link', { name: /详情/ })).toBeNull();
    expect(within(controls).getByRole('button', { name: '暂停' })).toBeTruthy();
    expect(within(listCard).getByTestId('monitor-pin-button')).toBeTruthy();

    cleanup();
    wrap(
      <DynamicObjectCard
        item={dynamicItem({
          target: {
            ...dynamicItem().target!,
            lastError: '采集失败',
          },
        })}
        selected={false}
        listQuery="tab=dynamics&view=grid"
        presentation="grid"
        onSelect={() => undefined}
      />,
      [{ path: '/monitoring/dynamics/:id', element: <div /> }],
    );
    const gridCard = screen.getByTestId('dynamic-list-item');
    expect(within(gridCard).getByTestId('dynamic-card-failure-dot')).toBeTruthy();
    expect(within(gridCard).queryByRole('img')).toBeNull();
  });
});
