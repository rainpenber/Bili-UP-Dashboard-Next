import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import type { DynamicListItem, MonitorCard } from '@studio/contracts';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { CreatorGridCard } from '@/features/monitoring/creator-grid-card';
import { DynamicObjectCard } from '@/features/monitoring/dynamic-object-card';
import { MonitorObjectCard } from '@/features/monitoring/monitor-object-card';

afterEach(() => {
  cleanup();
});

function creatorCard(patch: Partial<MonitorCard> = {}): MonitorCard {
  return {
    type: 'creator',
    externalId: '12345',
    title: null,
    category: null,
    imageAssetId: null,
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
    target: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      enabled: true,
      intervalMinutes: 60,
      intervalMode: 'fixed',
      lastSuccessAt: '2026-10-21T08:00:00.000Z',
      lastError: null,
    },
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

describe('WP-R2-16F two-button cards', () => {
  test('creator grid uses large avatar frame, truncated name, fans, and two buttons', () => {
    let selected = 0;
    wrap(
      <MonitorObjectCard
        card={creatorCard()}
        selected={false}
        listQuery="tab=creators&view=grid"
        presentation="grid"
        onSelect={() => {
          selected += 1;
        }}
      />,
      [{ path: '/monitoring/creators/:mid', element: <div data-testid="creator-detail" /> }],
    );
    const card = screen.getByTestId('monitor-object-card');
    expect(card.getAttribute('data-presentation')).toBe('grid');
    expect(within(card).getByTestId('creator-grid-avatar-frame').className).toContain(
      'aspect-[16/9]',
    );
    expect(within(card).getByTestId('creator-grid-avatar').className).toContain('rounded-full');
    const title = within(card).getByTitle('很长的UP主名称用于截断验证');
    expect(title.className).toContain('truncate');
    expect(within(card).getByTestId('creator-grid-metrics').textContent).toMatch(/粉丝/);
    expect(within(card).getByRole('link', { name: /详情/ })).toBeTruthy();
    expect(within(card).getByRole('button', { name: '暂停' })).toBeTruthy();
    expect(within(card).queryByRole('button', { name: '更多' })).toBeNull();
    expect(within(card).queryByRole('button', { name: '监控详情' })).toBeNull();
    fireEvent.click(within(card).getByTestId('creator-grid-avatar'));
    expect(selected).toBe(1);
    fireEvent.click(within(card).getByRole('button', { name: '暂停' }));
    expect(selected).toBe(1);
  });

  test('creator grid failure shows red dot without failure text', () => {
    wrap(
      <CreatorGridCard
        card={creatorCard({
          execution: 'failed',
          target: { ...creatorCard().target!, lastError: '上游超时' },
        })}
        selected={false}
        listQuery=""
        pending={false}
        notice={null}
        error={null}
        primary={null}
      />,
    );
    expect(screen.getByTestId('creator-grid-failure-dot')).toBeTruthy();
    expect(screen.getByTestId('monitor-card-controls').textContent).not.toContain('最近失败');
  });

  test('dynamic list and grid cards expose only two action buttons and no cover', () => {
    let selected = 0;
    wrap(
      <ul data-testid="dynamic-card-list">
        <DynamicObjectCard
          item={dynamicItem()}
          selected={false}
          listQuery="tab=dynamics"
          presentation="list"
          onSelect={() => {
            selected += 1;
          }}
        />
      </ul>,
      [{ path: '/monitoring/dynamics/:id', element: <div data-testid="dynamic-detail" /> }],
    );
    const listCard = screen.getByTestId('dynamic-list-item');
    expect(within(listCard).queryByRole('img')).toBeNull();
    expect(within(listCard).getByTitle('966692349750018048').className).toContain('truncate');
    expect(within(listCard).getByTestId('dynamic-card-metrics').textContent).toMatch(/赞/);
    const actions = within(listCard).getByTestId('dynamic-monitor-controls');
    expect(within(actions).getByRole('link', { name: /详情/ })).toBeTruthy();
    expect(within(actions).getByRole('button', { name: '暂停' })).toBeTruthy();
    expect(within(actions).queryByRole('button', { name: '监控详情' })).toBeNull();
    expect(within(actions).queryByRole('button', { name: '更多' })).toBeNull();
    fireEvent.click(within(listCard).getByTitle('966692349750018048'));
    expect(selected).toBe(1);
    fireEvent.click(within(actions).getByRole('button', { name: '暂停' }));
    expect(selected).toBe(1);

    cleanup();
    wrap(
      <DynamicObjectCard
        item={dynamicItem({
          target: null,
          latestMetrics: {
            sampledAt: null,
            likeCount: null,
            repostCount: null,
            commentCount: null,
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
    expect(gridCard.getAttribute('data-presentation')).toBe('grid');
    expect(within(gridCard).getByTestId('dynamic-card-metrics').textContent).toBe('尚无采集数据');
    expect(within(gridCard).getByRole('button', { name: '开始监控' })).toBeTruthy();
    expect(within(gridCard).queryByRole('img')).toBeNull();
  });
});
