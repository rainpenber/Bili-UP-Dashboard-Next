import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { PublishPanel } from '@/features/commercial/components/publish-panel';
import type { CommercialProject } from '@/features/commercial/types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  sessionStorage.clear();
});

const project: CommercialProject = {
  id: 'proj-1',
  name: '演示商单',
  stageLabel: '发布',
  listBucket: 'in_progress',
  hasConcreteBlockReason: false,
  overallStage: '待发布',
  inProgressNodeNames: ['发布'],
  netAmountYuan: 0,
  rebateAmountYuan: 0,
  upcomingNodeSchedule: [],
  finishedNodeSchedule: [],
  statusHeadline: '待发布',
  published: false,
  archived: false,
  openItems: [],
  workflow: { steps: [] },
  keywordHaystack: '演示',
  sortDate: '2026-10-21',
};

function renderPanel(override: { bvid: string; goLiveAtLabel: string } | null = null) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PublishPanel project={project} override={override} onPublished={() => undefined} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function targetPayload(startAt: string) {
  return {
    target: {
      id: '11111111-1111-4111-8111-111111111111',
      type: 'video',
      externalId: 'BV1xx411c7mD',
      label: 'BV1xx411c7mD',
      tags: [],
      enabled: true,
      intervalMinutes: 15,
      intervalMode: 'auto',
      startAt,
      nextRunAt: startAt,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      source: 'manual',
      createdAt: '2026-10-21T00:00:00.000Z',
      updatedAt: '2026-10-21T00:00:00.000Z',
      deletedAt: null,
    },
  };
}

describe('PublishPanel scheduled monitor', () => {
  test('creates a scheduled video monitor and shows the planned instant', async () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
    const posts: unknown[] = [];
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...targetPayload('2026-11-01T01:30:00.000Z'),
              created: true,
              code: 'created',
              message: '已添加监控项',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }) as typeof fetch;

    try {
      renderPanel();
      fireEvent.change(screen.getByTestId('publish-monitor-bvid'), {
        target: { value: 'BV1xx411c7mD' },
      });
      fireEvent.change(screen.getByTestId('publish-monitor-start-at'), {
        target: { value: '2026-11-01T09:30' },
      });
      fireEvent.click(screen.getByRole('button', { name: '按此时间创建定时监控' }));
      await waitFor(() => expect(posts).toHaveLength(1));
      expect(posts[0]).toMatchObject({
        type: 'video',
        externalId: 'BV1xx411c7mD',
        startAt: '2026-11-01T01:30:00.000Z',
      });
      const status = await screen.findByTestId('publish-monitor-status');
      expect(status.textContent).toContain('已加入定时监控');
      expect(status.textContent).toContain('开始采集');
      expect(status.textContent).not.toContain('投稿');
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });

  test('repeat submit returns existing target without implying a second create', async () => {
    const posts: unknown[] = [];
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        const created = posts.length === 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...targetPayload('2026-11-01T01:30:00.000Z'),
              created,
              code: created ? 'created' : 'target_exists',
              message: created ? '已添加监控项' : '该监控项已存在，已返回原记录',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }) as typeof fetch;

    renderPanel();
    fireEvent.change(screen.getByTestId('publish-monitor-bvid'), {
      target: { value: 'BV1xx411c7mD' },
    });
    fireEvent.change(screen.getByTestId('publish-monitor-start-at'), {
      target: { value: '2026-11-01T09:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: '按此时间创建定时监控' }));
    await screen.findByTestId('publish-monitor-status');
    fireEvent.click(screen.getByRole('button', { name: '按此时间创建定时监控' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect((await screen.findByTestId('publish-monitor-status')).textContent).toContain('已存在');
  });

  test('demo publish copy stays non-shipping and does not block monitor create UI', () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: '进入发布状态' }));
    expect(screen.getByText(/不会真的投稿/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '确认发布（演示）' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '按此时间创建定时监控' })).toBeTruthy();
  });
});
