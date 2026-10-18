import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import type { VideoMetricPoint } from '@studio/contracts';

mock.module('echarts-for-react', () => ({
  default: React.forwardRef(function MockECharts(
    props: { option?: { series?: { name?: string; data?: unknown }[] } },
    ref: React.Ref<HTMLDivElement>,
  ) {
    const series = (props.option?.series ?? []).map((item) => ({
      name: item.name ?? '',
      data: item.data ?? [],
    }));
    return <div ref={ref} data-testid="mock-echart" data-series={JSON.stringify(series)} />;
  }),
}));

const { LiveProjectWorkflow } = await import('./live-project-workflow');
const { MetricCharts } = await import('@/features/monitoring/MetricCharts');

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const PROJECT_ID = 'f0010001-0001-4001-8001-000000000003';
const BVID = 'BVWP004R01';
const OTHER_BVID = 'BVOTHER999';

const NODE_IDS: Record<string, string> = {
  inquiry: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  outline: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
  copy: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
  pre_shoot: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
  merge: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000005',
  a_roll: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000006',
  b_roll: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000007',
  ai_post: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000008',
  review: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009',
  publish: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000a',
  settlement: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000b',
  distribution: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000c',
  data_maint: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000d',
  other: 'aaaaaaaa-aaaa-4aaa-8aaa-00000000000e',
};

function workflowNodes() {
  const rows: [string, string, string, string | null][] = [
    ['inquiry', '询单', 'completed', null],
    ['outline', '大纲', 'completed', null],
    ['copy', '文案', 'completed', null],
    ['pre_shoot', '预拍摄', 'completed', null],
    ['merge', '汇合节点', 'completed', null],
    ['a_roll', 'A-roll 拍摄', 'completed', null],
    ['b_roll', 'B-roll 素材', 'completed', null],
    ['ai_post', 'AI 后期', 'completed', null],
    ['review', '审核', 'completed', null],
    ['publish', '发布', 'completed', null],
    ['settlement', '结算', 'in_progress', null],
    ['distribution', '全平台分发', 'not_reached', null],
    ['data_maint', '数据维护', 'not_reached', null],
    ['other', '其他', 'not_applicable', null],
  ];
  return rows.map(([slug, name, status, blockingReason]) => ({
    id: NODE_IDS[slug] ?? 'aaaaaaaa-aaaa-4aaa-8aaa-0000000000ff',
    name,
    status,
    kind: slug === 'merge' ? 'merge' : 'stage',
    templateSlug: slug,
    blockingReason,
    updatedAt: '2026-05-20T12:00:00.000Z',
  }));
}

function detail(published: boolean) {
  return {
    id: PROJECT_ID,
    name: `已上线样例 ${OTHER_BVID}`,
    netAmount: '45000.00',
    rebateAmount: '3500.00',
    overallStage: published ? 'published_winding_down' : 'pre_publish',
    currentStageNames: published ? ['结算'] : ['文案'],
    anyNodeBlocked: false,
    blockingReason: null,
    publish: published
      ? {
          published: true,
          bvid: BVID,
          publishedAt: '2026-05-20T12:00:00.000Z',
          publishSource: 'web',
        }
      : { published: false, bvid: null, publishedAt: null, publishSource: null },
  };
}

function point(overrides: Partial<VideoMetricPoint> & { sampledAt: string }): VideoMetricPoint {
  return {
    rawTime: overrides.sampledAt,
    sourceTimezone: 'Asia/Shanghai',
    timestampPrecision: 'minute',
    viewCount: null,
    onlineViewers: null,
    onlineViewersRaw: null,
    likeCount: null,
    coinCount: null,
    favoriteCount: null,
    shareCount: null,
    danmakuCount: null,
    commentCount: null,
    ...overrides,
  };
}

const SAMPLES = [
  point({
    sampledAt: '2026-05-20T12:00:00.000Z',
    viewCount: '5000',
    onlineViewers: '42',
    onlineViewersRaw: '1000+',
    likeCount: '9',
    coinCount: null,
    favoriteCount: '3',
    shareCount: '7',
    danmakuCount: '11',
    commentCount: null,
  }),
  point({
    sampledAt: '2026-05-21T12:00:00.000Z',
    viewCount: '8000',
    onlineViewers: '15',
    onlineViewersRaw: null,
    likeCount: '12',
    coinCount: '4',
    favoriteCount: '6',
    shareCount: '8',
    danmakuCount: '13',
    commentCount: '2',
  }),
];

function videoDetailBody() {
  return {
    bvid: BVID,
    title: '监控库视频',
    category: null,
    mid: null,
    monitoringEnabled: true,
    archivedAt: null,
    deletedAt: null,
    coverAssetId: null,
    metadata: {},
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

type MonitorBehavior = 'samples' | 'empty' | 'missing' | 'detail-500' | 'metrics-500' | 'hold';

function installFetch(published: boolean, monitor: MonitorBehavior) {
  const urls: string[] = [];
  let releaseMonitor: (() => void) | undefined;
  const held =
    monitor === 'hold'
      ? new Promise<void>((resolve) => {
          releaseMonitor = resolve;
        })
      : null;
  let metricsAttempts = 0;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    if (url.endsWith('/workflow')) {
      return jsonResponse({
        projectId: PROJECT_ID,
        workflowId: 'a2000001-0001-4001-8001-000000000001',
        templateVersionId: 'ffff1111-1111-4111-8111-111111111111',
        nodes: workflowNodes(),
        edges: [],
      });
    }
    if (url.includes('/api/v1/monitor/videos/')) {
      if (held) await held;
      if (url.includes('/metrics')) {
        metricsAttempts += 1;
        if (monitor === 'metrics-500' && metricsAttempts === 1) {
          return jsonResponse({ error: 'database unavailable' }, 500);
        }
        return jsonResponse({
          bvid: BVID,
          limit: 500,
          items:
            monitor === 'samples' || (monitor === 'metrics-500' && metricsAttempts > 1)
              ? SAMPLES
              : [],
        });
      }
      if (monitor === 'missing') return jsonResponse({ error: 'not found' }, 404);
      if (monitor === 'detail-500') return jsonResponse({ error: 'database unavailable' }, 500);
      return jsonResponse(videoDetailBody());
    }
    return jsonResponse(detail(published));
  }) as typeof fetch;

  return {
    urls,
    releaseMonitor: () => releaseMonitor?.(),
  };
}

function renderProject() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LiveProjectWorkflow projectId={PROJECT_ID} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function follows(earlier: Node, later: Node) {
  return Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
}

function readSeries(chart: HTMLElement) {
  return JSON.parse(chart.getAttribute('data-series') ?? '[]') as {
    name: string;
    data: (number | string | null)[];
  }[];
}

describe('published project video metrics', () => {
  test('unpublished projects do not request or render monitoring', async () => {
    const { urls } = installFetch(false, 'samples');
    renderProject();
    await screen.findByRole('heading', { name: `已上线样例 ${OTHER_BVID}` });
    await screen.findByTestId('workflow-live-canvas');
    expect(screen.queryByTestId('project-video-metrics')).toBeNull();
    expect(urls.some((url) => url.includes('/api/v1/monitor/'))).toBe(false);
    expect(urls.some((url) => url.includes(OTHER_BVID))).toBe(false);
  });

  test('places playback and engagement after the timeline and queries only the recorded BV', async () => {
    const { urls } = installFetch(true, 'samples');
    renderProject();

    const title = await screen.findByRole('heading', { name: `已上线样例 ${OTHER_BVID}` });
    const summary = await screen.findByTestId('progress-summary');
    const timeline = await screen.findByTestId('progress-timeline');
    const detailCard = screen.getByTestId('progress-stage-detail');
    const video = await screen.findByTestId('project-video-metrics');
    const canvas = await screen.findByTestId('workflow-live-canvas');

    expect(follows(title, summary)).toBe(true);
    expect(follows(summary, timeline)).toBe(true);
    expect(follows(timeline, detailCard)).toBe(true);
    expect(follows(detailCard, video)).toBe(true);
    expect(follows(video, canvas)).toBe(true);
    expect(video.getAttribute('data-bvid')).toBe(BVID);
    expect(video.textContent).toContain('查看完整监控详情');
    expect(video.querySelector('a')?.getAttribute('href')).toBe(`/monitoring/videos/${BVID}`);

    const columns = screen.getByTestId('metric-charts-columns');
    expect(columns.className).toContain('grid-cols-1');
    expect(columns.className).toContain('lg:grid-cols-2');
    const playback = screen.getByTestId('metric-chart-playback');
    const engagement = screen.getByTestId('metric-chart-engagement');
    expect(follows(playback, engagement)).toBe(true);
    expect(playback.textContent).toContain('播放');
    expect(engagement.textContent).toContain('互动');

    const view = playback.querySelector('[data-metric="viewCount"]');
    const online = playback.querySelector('[data-metric="onlineViewers"]');
    expect(view?.textContent).toBe('8千');
    expect(online?.textContent).toBe('15');
    expect(view?.textContent).not.toBe(online?.textContent);
    expect(engagement.querySelector('[data-metric="likeCount"]')?.textContent).toBe('12');
    expect(engagement.querySelector('[data-metric="coinCount"]')?.textContent).toBe('4');
    expect(engagement.querySelector('[data-metric="favoriteCount"]')?.textContent).toBe('6');
    expect(engagement.querySelector('[data-metric="danmakuCount"]')?.textContent).toBe('13');
    expect(engagement.querySelector('[data-metric="shareCount"]')?.textContent).toBe('8');
    expect(engagement.querySelector('[data-metric="commentCount"]')?.textContent).toBe('2');
    expect(video.textContent).toContain('最近更新');

    await waitFor(() => {
      const monitorUrls = urls.filter((url) => url.includes('/api/v1/monitor/'));
      expect(monitorUrls).toEqual([
        `/api/v1/monitor/videos/${BVID}`,
        `/api/v1/monitor/videos/${BVID}/metrics?limit=500`,
      ]);
    });
    expect(urls.some((url) => url.includes(OTHER_BVID))).toBe(false);

    const playbackSeries = readSeries(within(playback).getByTestId('mock-echart'));
    const engagementSeries = readSeries(within(engagement).getByTestId('mock-echart'));
    expect(playbackSeries.map((item) => item.name)).toEqual(['在线观看', '播放量']);
    expect(playbackSeries[0]?.data).toEqual(['1000+', 15]);
    expect(playbackSeries[1]?.data).toEqual([5, 8]);
    expect(playbackSeries[1]?.data).not.toEqual(playbackSeries[0]?.data);
    expect(engagementSeries.map((item) => item.name)).toEqual([
      '点赞',
      '投币',
      '收藏',
      '分享',
      '弹幕',
      '评论',
    ]);
    expect(engagementSeries.find((item) => item.name === '投币')?.data).toEqual([null, 4]);
    expect(engagementSeries.find((item) => item.name === '点赞')?.data).toEqual([9, 12]);
    expect(engagementSeries.find((item) => item.name === '分享')?.data).toEqual([7, 8]);

    const stage = screen
      .getAllByTestId('progress-stage')
      .find((item) => item.getAttribute('data-stage-id') === 'distribution_settlement');
    if (!stage) throw new Error('missing settlement stage');
    fireEvent.click(stage);
    expect(screen.getByTestId('progress-stage-nodes').textContent).toContain('结算');
    expect(screen.getByTestId('project-video-metrics')).toBeTruthy();
  });

  test('keeps nulls out of the curves and skips a chart when that side has no history', () => {
    render(
      <MetricCharts
        kind="video"
        layout="columns"
        points={[
          point({
            sampledAt: '2026-05-20T12:00:00.000Z',
            viewCount: null,
            onlineViewers: null,
            likeCount: null,
            coinCount: null,
            favoriteCount: null,
            shareCount: null,
            danmakuCount: null,
            commentCount: null,
          }),
        ]}
      />,
    );
    expect(screen.getByTestId('metric-chart-playback-empty').textContent).toContain('未绘制曲线');
    expect(screen.getByTestId('metric-chart-engagement-empty').textContent).toContain('未绘制曲线');
    expect(screen.queryByTestId('mock-echart')).toBeNull();
    expect(screen.getByText('评论数：历史数据暂无，未绘制评论曲线。')).toBeTruthy();
  });

  test('shows loading, 404, empty samples, and a retryable read failure without hiding the project', async () => {
    installFetch(true, 'hold');
    renderProject();
    const video = await screen.findByTestId('project-video-metrics');
    expect(video.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(await screen.findByTestId('progress-timeline')).toBeTruthy();
    cleanup();

    installFetch(true, 'missing');
    renderProject();
    expect(await screen.findByTestId('project-video-metrics-unlinked')).toBeTruthy();
    expect(screen.queryByTestId('mock-echart')).toBeNull();
    expect(screen.queryByTestId('project-video-metrics-empty')).toBeNull();
    await screen.findByTestId('workflow-live-canvas');
    cleanup();

    const missingUrls = installFetch(true, 'missing').urls;
    renderProject();
    await screen.findByTestId('project-video-metrics-unlinked');
    await waitFor(() => {
      expect(missingUrls.some((url) => url.includes('/metrics'))).toBe(false);
      expect(missingUrls.some((url) => url === `/api/v1/monitor/videos/${BVID}`)).toBe(true);
    });
    cleanup();

    installFetch(true, 'empty');
    renderProject();
    expect((await screen.findByTestId('project-video-metrics-empty')).textContent).toContain(
      '还没有采样',
    );
    expect(screen.queryByTestId('mock-echart')).toBeNull();
    expect(screen.getByTestId('workflow-live-canvas')).toBeTruthy();
    cleanup();

    installFetch(true, 'detail-500');
    renderProject();
    expect(await screen.findByText('视频数据读取失败', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
    expect(screen.getByTestId('progress-timeline')).toBeTruthy();
    expect(screen.getByTestId('workflow-live-canvas')).toBeTruthy();
    cleanup();

    installFetch(true, 'metrics-500');
    renderProject();
    expect(await screen.findByText('database unavailable')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByTestId('metric-charts-columns')).toBeTruthy();
    expect(screen.getByTestId('metric-chart-playback').textContent).toContain('8千');
  });
});

describe('monitoring chart layout stays stacked by default', () => {
  test('video charts keep the original vertical stack and creator charts are unchanged', () => {
    const { container } = render(<MetricCharts kind="video" points={SAMPLES} />);
    expect(screen.queryByTestId('metric-charts-columns')).toBeNull();
    expect(container.querySelector('.space-y-4')).toBeTruthy();
    const charts = screen.getAllByTestId('mock-echart');
    expect(charts).toHaveLength(2);
    expect(charts[0]?.parentElement?.className).toContain('space-y-4');
    expect(readSeries(charts[0]!).map((item) => item.name)).toEqual(['在线观看', '播放量']);
    expect(readSeries(charts[1]!).find((item) => item.name === '评论')?.data).toEqual([null, 2]);
    cleanup();

    render(
      <MetricCharts
        kind="creator"
        points={[
          {
            sampledAt: '2026-05-20T12:00:00.000Z',
            rawTime: '2026-05-20T12:00:00.000Z',
            sourceTimezone: 'Asia/Shanghai',
            timestampPrecision: 'minute',
            followerCount: '1000',
          },
        ]}
      />,
    );
    expect(screen.queryByTestId('metric-charts-columns')).toBeNull();
    expect(readSeries(screen.getByTestId('mock-echart'))[0]?.name).toBe('粉丝数');
    expect(readSeries(screen.getByTestId('mock-echart'))[0]?.data).toEqual([1000]);
  });
});
