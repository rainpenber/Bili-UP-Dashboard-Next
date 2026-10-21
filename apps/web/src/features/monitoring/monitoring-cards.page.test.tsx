import { mock } from 'bun:test';

mock.module('echarts-for-react', () => ({
  default: () => <div data-testid="mock-echart" />,
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { ThemeProvider } from '@/components/theme/theme-provider';
import { appRouteConfig } from '@/routes/route-config';

const originalFetch = globalThis.fetch;
const TARGET = '11111111-1111-4111-8111-111111111111';
const PROJECT_A = '22222222-2222-4222-8222-222222222222';
const PROJECT_B = '33333333-3333-4333-8333-333333333333';
const BVID = 'BV1xx411c7mD';

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

function card(patch: Record<string, unknown> = {}) {
  return {
    type: 'video',
    externalId: BVID,
    title: '离线视频',
    category: '游戏',
    imageAssetId: null,
    mid: null,
    displayName: '离线视频',
    hasEntity: true,
    hasSamples: true,
    monitorState: 'active',
    execution: 'waiting',
    target: {
      id: TARGET,
      label: '离线视频',
      tags: ['demo'],
      enabled: true,
      intervalMinutes: 15,
      intervalMode: 'auto',
      nextRunAt: '2026-10-21T01:00:00.000Z',
      lastRunAt: '2026-10-21T00:00:00.000Z',
      lastSuccessAt: '2026-10-21T00:00:00.000Z',
      lastError: null,
    },
    projects: [{ id: PROJECT_A, name: '商单甲' }],
    latest: {
      sampledAt: '2026-10-21T00:00:00.000Z',
      viewCount: '1200',
      onlineViewers: '3',
      onlineViewersRaw: '3',
      likeCount: '9',
      followerCount: null,
    },
    ...patch,
  };
}

function list(items: unknown[]) {
  return { page: 1, pageSize: 8, totalItems: items.length, totalPages: 1, items };
}

const emptyJobs = { page: 1, pageSize: 8, totalItems: 0, totalPages: 1, items: [] };

const emptySummary = {
  heartbeats: [],
  queue: { due: 0, running: 0, failed24h: 0 },
  circuits: [],
  targets: [],
  samplesToday: { videos: 0, creators: 0 },
  recentErrorCount: 0,
};

const emptyHealth = {
  lastHeartbeatAt: null,
  stale: true,
  queueBacklog: 0,
  lastSuccessAt: null,
};

const videoDetail = {
  bvid: BVID,
  title: '离线视频',
  category: '游戏',
  mid: null,
  monitoringEnabled: true,
  archivedAt: null,
  deletedAt: null,
  coverAssetId: null,
  tid: null,
  tidV2: null,
  partitionName: null,
  metadata: {},
  creator: null,
};

function targetRecord(enabled: boolean) {
  return {
    id: TARGET,
    type: 'video',
    externalId: BVID,
    label: '离线视频',
    tags: ['demo'],
    enabled,
    intervalMinutes: 15,
    intervalMode: 'auto',
    nextRunAt: '2026-10-21T01:00:00.000Z',
    lastRunAt: '2026-10-21T00:00:00.000Z',
    lastSuccessAt: '2026-10-21T00:00:00.000Z',
    lastError: null,
    source: 'offline',
    createdAt: '2026-10-21T00:00:00.000Z',
    updatedAt: '2026-10-21T00:00:00.000Z',
    deletedAt: null,
  };
}

function renderAt(path: string) {
  const router = createMemoryRouter(appRouteConfig, { initialEntries: [path] });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { router, ...view };
}

function install(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    return Promise.resolve(handler(url, init));
  }) as typeof fetch;
}

describe('monitoring cards', () => {
  test('routes targets to videos, adds from the dialog, and keeps filters through detail, project, and logs', async () => {
    const posts: unknown[] = [];
    install((url, init) => {
      if (url.includes('/api/v1/monitor/cards/')) return jsonResponse(card());
      if (url.includes('/api/v1/monitor/cards')) return jsonResponse(list([card()]));
      if (url.includes('/api/v1/monitor/jobs')) return jsonResponse(emptyJobs);
      if (url.includes('/api/v1/monitor/targets') && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return jsonResponse({
          target: targetRecord(true),
          created: true,
          code: 'created',
          message: '已添加监控项',
        });
      }
      if (url.includes('/metrics')) return jsonResponse({ bvid: BVID, limit: 500, items: [] });
      if (url.includes('/api/v1/monitor/videos/')) return jsonResponse(videoDetail);
      if (url.includes('/api/v1/ops/summary')) return jsonResponse(emptySummary);
      if (url.includes('/api/v1/ops/health')) return jsonResponse(emptyHealth);
      if (url.includes('/api/v1/ops/'))
        return jsonResponse({ items: [], nextCursor: null, limit: 50 });
      if (url.includes('/api/v1/commercial/'))
        return jsonResponse({ error: '找不到这个项目' }, 404);
      if (url.includes('/api/v1/monitor/dynamics')) return jsonResponse(list([]));
      return jsonResponse(list([card()]));
    });

    const { router } = renderAt('/monitoring?tab=targets&page=2&monitor=paused');
    expect(await screen.findByRole('tab', { name: '视频' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: '监控项' })).toBeNull();
    expect(
      (screen.getByRole('tab', { name: '视频' }) as HTMLElement).getAttribute('data-state'),
    ).toBe('active');
    const row = await screen.findByTestId('monitor-object-card');
    expect(row.getAttribute('data-monitor-state')).toBe('active');
    expect(row.textContent).toContain('监控中');
    expect(row.textContent).toContain('等待');
    expect(row.textContent).not.toContain('正在采集');
    expect(screen.getByRole('heading', { name: '最近采集任务' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '新增监控' }));
    const dialog = await screen.findByTestId('monitor-add-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('请输入');
    expect(posts).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText('BV 号或视频长链接'), {
      target: { value: 'https://b23.tv/abc' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: '添加' }));
    expect((await within(dialog).findByRole('alert')).textContent).toContain('短链');
    expect(posts).toHaveLength(0);

    fireEvent.click(within(dialog).getByRole('button', { name: '取消' }));

    fireEvent.click(screen.getByRole('link', { name: '查看详情' }));
    expect(router.state.location.pathname).toBe(`/monitoring/videos/${BVID}`);
    expect(router.state.location.search).toContain('from=');
    expect(await screen.findByTestId('video-detail-page')).toBeTruthy();
    expect(screen.getByTestId('monitor-card-controls').textContent).toContain('监控中');
    fireEvent.click(screen.getByRole('link', { name: '返回列表' }));
    expect(router.state.location.pathname).toBe('/monitoring');
    expect(router.state.location.search).toContain('page=2');
    expect(router.state.location.search).toContain('monitor=paused');

    fireEvent.click(await screen.findByRole('link', { name: '查看日志' }));
    expect(router.state.location.pathname).toBe('/ops');
    expect(router.state.location.search).toContain(`targetId=${TARGET}`);
    expect(((await screen.findByLabelText('目标编号')) as HTMLInputElement).value).toBe(TARGET);
    await router.navigate(-1);
    fireEvent.click(await screen.findByRole('link', { name: '进入商单' }));
    expect(router.state.location.pathname).toBe(`/projects/${PROJECT_A}`);
    expect((await screen.findAllByText('找不到这个项目')).length).toBeGreaterThan(0);
    expect(posts).toHaveLength(0);
  });

  test('pause failure stays on the old state and retry updates the card', async () => {
    let paused = false;
    let failures = 0;
    install((url, init) => {
      if (url.includes('/jobs')) return jsonResponse(emptyJobs);
      if (url.includes('/targets/') && init?.method === 'PATCH') {
        failures += 1;
        if (failures === 1) return jsonResponse({ error: '保存失败', code: 'internal' }, 500);
        paused = true;
        return jsonResponse({ target: targetRecord(false) });
      }
      if (url.includes('/cards')) {
        return jsonResponse(
          list([
            card(
              paused
                ? {
                    monitorState: 'paused',
                    execution: 'none',
                    target: { ...targetRecord(false), intervalMode: 'auto' },
                  }
                : {},
            ),
          ]),
        );
      }
      return jsonResponse(emptyJobs);
    });
    renderAt('/monitoring?tab=videos');
    const row = await screen.findByTestId('monitor-object-card');
    expect(row.textContent).toContain('监控中');
    fireEvent.click(within(row).getByRole('button', { name: '暂停' }));
    expect((await within(row).findByRole('alert')).textContent).toContain('保存失败');
    expect(row.textContent).toContain('监控中');
    fireEvent.click(within(row).getByRole('button', { name: '暂停' }));
    expect(await within(row).findByText('已暂停')).toBeTruthy();
    expect(row.getAttribute('data-monitor-state')).toBe('paused');
  });

  test('pending disables the write and an unmonitored card can start without forcing 60', async () => {
    let release: (() => void) | null = null as (() => void) | null;
    const posts: unknown[] = [];
    const calls: string[] = [];
    const unmonitored = card({
      monitorState: 'unmonitored',
      execution: 'none',
      target: null,
      projects: [],
      hasSamples: false,
      latest: {
        sampledAt: null,
        viewCount: null,
        onlineViewers: null,
        onlineViewersRaw: null,
        likeCount: null,
        followerCount: null,
      },
    });
    install((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/targets') && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return new Promise((resolve) => {
          release = () =>
            resolve(
              jsonResponse({
                target: targetRecord(true),
                created: false,
                code: 'target_exists',
                message: '该监控项已存在，已返回原记录',
              }),
            );
        });
      }
      if (url.includes('/cards')) return jsonResponse(list([unmonitored]));
      if (url.includes('/jobs')) return jsonResponse(emptyJobs);
      return jsonResponse(emptyJobs);
    });
    renderAt('/monitoring');
    const row = await screen.findByTestId('monitor-object-card');
    expect(row.textContent).toContain('未监控');
    expect(row.textContent).toContain('尚无采集数据');
    fireEvent.click(within(row).getByRole('button', { name: '开始监控' }));
    await waitFor(() => {
      expect(calls.some((call) => call.startsWith('POST'))).toBe(true);
    });
    expect(within(row).getByTestId('monitor-card-controls').getAttribute('data-pending')).toBe(
      'true',
    );
    expect(posts).toHaveLength(1);
    expect(within(row).getByTestId('monitor-card-controls').getAttribute('data-pending')).toBe(
      'true',
    );
    expect(
      (within(row).getByRole('button', { name: '开始监控' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(posts[0]).toMatchObject({ intervalMode: 'auto' });
    expect(posts[0]).not.toHaveProperty('intervalMinutes');
    release?.();
    expect(await within(row).findByRole('status')).toBeTruthy();
    expect(row.textContent).toContain('该监控项已存在');
  });

  test('dynamics keep history browsing and a narrow long card does not add a horizontal page scroll', async () => {
    const longName = '很长的标题'.repeat(30);
    install((url) => {
      if (url.includes('/dynamics')) {
        return jsonResponse(
          list([
            {
              dynamicId: 'dyn-1',
              mid: '1',
              category: null,
              monitoringEnabled: false,
              archivedAt: null,
              deletedAt: null,
              latestMetrics: {
                sampledAt: null,
                likeCount: '1',
                repostCount: null,
                commentCount: null,
              },
            },
          ]),
        );
      }
      if (url.includes('/cards')) {
        return jsonResponse(
          list([
            card({
              displayName: longName,
              title: longName,
              projects: [
                { id: PROJECT_A, name: '商单甲'.repeat(12) },
                { id: PROJECT_B, name: '商单乙'.repeat(12) },
              ],
            }),
          ]),
        );
      }
      if (url.includes('/jobs')) return jsonResponse(emptyJobs);
      return jsonResponse(list([]));
    });
    const view = renderAt('/monitoring?tab=videos');
    const row = await screen.findByTestId('monitor-object-card');
    expect(row.textContent).toContain(longName.slice(0, 8));
    expect(within(row).getByLabelText('关联商单')).toBeTruthy();
    fireEvent.change(within(row).getByLabelText('关联商单'), { target: { value: PROJECT_B } });
    expect(within(row).getByRole('link', { name: '进入商单' }).getAttribute('href')).toBe(
      `/projects/${PROJECT_B}`,
    );
    const page = screen.getByTestId('monitoring-page');
    expect(page.className).toContain('overflow-x-hidden');
    for (const width of [390, 1440]) {
      view.container.style.width = `${width}px`;
      view.container.style.maxWidth = `${width}px`;
      if (view.container.clientWidth > 0) {
        expect(view.container.scrollWidth).toBeLessThanOrEqual(view.container.clientWidth + 1);
      }
    }
    const dynamicsTab = screen.getByRole('tab', { name: '动态' });
    fireEvent.mouseDown(dynamicsTab);
    fireEvent.click(dynamicsTab);
    expect(await screen.findByText('dyn-1')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '新增监控' })).toBeNull();
    expect(screen.queryByRole('button', { name: '开始监控' })).toBeNull();
    expect(screen.getByRole('heading', { name: '最近采集任务' })).toBeTruthy();
  });

  test('shows loading, empty, and error states', async () => {
    let mode: 'loading' | 'empty' | 'error' = 'loading';
    install((url) => {
      if (mode === 'loading') return new Promise(() => undefined);
      if (url.includes('/jobs')) return jsonResponse(emptyJobs);
      if (mode === 'error') return jsonResponse({ error: '数据库不可用', code: 'internal' }, 500);
      return jsonResponse(list([]));
    });
    renderAt('/monitoring');
    expect(await screen.findAllByLabelText('加载中')).toBeTruthy();
    mode = 'empty';
    cleanup();
    renderAt('/monitoring');
    expect(await screen.findByText('没有匹配的条目')).toBeTruthy();
    mode = 'error';
    cleanup();
    renderAt('/monitoring');
    expect(await screen.findByText('数据库不可用')).toBeTruthy();
  });
});
