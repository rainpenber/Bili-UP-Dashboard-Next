import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, mock, test } from 'bun:test';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CreatorMetricPoint, CreatorVideoItem, VideoDetail } from '@studio/contracts';
import { formatCompactNumber } from '@/lib/format-compact-number';
import { formatFullLocalTime } from '@/lib/format-time';

mock.module('echarts-for-react', () => ({
  default: React.forwardRef(function MockECharts(
    _props: { option?: unknown },
    ref: React.Ref<HTMLDivElement>,
  ) {
    return <div ref={ref} data-testid="mock-echart" />;
  }),
}));

const { MonitoringCreatorDetailPage } = await import('@/pages/monitoring-creator-detail-page');
const { MonitoringVideoDetailPage } = await import('@/pages/monitoring-video-detail-page');

const originalFetch = globalThis.fetch;
const MID = '3493141386627335';
const BVID = 'BVCLTEST01';
const SAMPLED_AT = '2026-10-19T18:59:59.000Z';
const PUBLISHED_AT = '2026-08-01T00:00:00.000Z';

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

function followerPoint(): CreatorMetricPoint {
  return {
    sampledAt: SAMPLED_AT,
    rawTime: '2026-10-19 18:59',
    sourceTimezone: 'Asia/Shanghai',
    timestampPrecision: 'second',
    followerCount: '51733',
  };
}

function videoDetail(creator: VideoDetail['creator']): VideoDetail {
  return {
    bvid: BVID,
    title: '反查视频',
    category: null,
    mid: creator?.mid ?? null,
    pubdate: '2026-08-28T05:29:00.000Z',
    monitoringEnabled: true,
    archivedAt: null,
    deletedAt: null,
    coverAssetId: null,
    tid: null,
    tidV2: null,
    partitionName: null,
    metadata: {},
    creator,
  };
}

function creatorDetail() {
  return {
    mid: MID,
    uname: '狐正正',
    category: null,
    monitoringEnabled: true,
    archivedAt: null,
    deletedAt: null,
    faceAssetId: 'a_face_xlink',
    metadata: {},
  };
}

function videoItem(index: number): CreatorVideoItem {
  return {
    bvid: `BVCLP${String(index).padStart(4, '0')}`,
    title: index === 0 ? `视频 ${index} VeryLongUnbrokenTitleForOverflowChecking` : `视频 ${index}`,
    coverAssetId: index === 0 ? 'a_cover_x' : null,
    pubdate: index === 3 ? null : PUBLISHED_AT,
    partitionName: null,
    archivedAt: index === 1 ? '2026-06-01T00:00:00.000Z' : null,
    latest:
      index === 0
        ? {
            sampledAt: SAMPLED_AT,
            viewCount: '623',
            likeCount: '34',
            commentCount: '8',
            onlineViewers: '1',
          }
        : null,
  };
}

function renderAt(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function expectNoHorizontalOverflow(pageTestId: string) {
  const page = document.querySelector(`[data-testid="${pageTestId}"]`);
  if (!(page instanceof HTMLElement)) throw new Error(`missing ${pageTestId}`);
  expect(page.className).toContain('overflow-x-hidden');
  expect(page.className).toContain('max-w-full');
  expect(page.className).toContain('min-w-0');
  const host = page.parentElement;
  if (!(host instanceof HTMLElement)) throw new Error('missing host');
  for (const width of [390, 1440]) {
    host.style.width = `${width}px`;
    host.style.maxWidth = `${width}px`;
    if (host.clientWidth > 0) {
      expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
    }
  }
}

describe('video detail author card', () => {
  test('renders the author, followers, sample time, and follower sparkline', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/creators/') && url.includes('/metrics')) {
        return jsonResponse({ mid: MID, limit: 500, items: [followerPoint()] });
      }
      if (url.includes('/metrics')) return jsonResponse({ bvid: BVID, limit: 500, items: [] });
      return jsonResponse(
        videoDetail({
          mid: MID,
          uname: '狐正正',
          faceAssetId: 'a_face_xlink',
          followerLatest: '51733',
          followerSampledAt: SAMPLED_AT,
          monitoringEnabled: true,
        }),
      );
    }) as typeof fetch;

    renderAt(
      <MemoryRouter initialEntries={[`/monitoring/videos/${BVID}`]}>
        <Routes>
          <Route path="/monitoring/videos/:bvid" element={<MonitoringVideoDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect((await screen.findByTestId('video-author-name')).textContent).toBe('狐正正');
    expect(screen.getByTestId('video-author-followers').textContent).toBe(
      formatCompactNumber('51733'),
    );
    expect(screen.getByTestId('video-author-sampled-at').getAttribute('title')).toBe(
      formatFullLocalTime(SAMPLED_AT),
    );
    const card = screen.getByTestId('video-author-card');
    expect(card.getAttribute('href')).toBe(`/monitoring/creators/${MID}`);
    expect(card.querySelector('img')?.getAttribute('src')).toBe('/api/v1/assets/a_face_xlink');
    const aside = document.querySelector('[data-testid="monitor-detail-aside"]');
    expect(aside?.contains(card)).toBe(true);
    const panel = screen.getByTestId('video-author-panel');
    expect(panel.className).toContain('grid-cols-1');
    expect(panel.className).toContain('min-[1440px]:grid-cols-2');
    expect(
      await within(screen.getByTestId('video-author-sparkline')).findByTestId('mock-echart'),
    ).toBeTruthy();
    expect(urls.some((url) => url.includes(`/creators/${MID}/metrics`))).toBe(true);
    expectNoHorizontalOverflow('video-detail-page');
  });

  test('shows the empty author state and does not request follower metrics when mid is null', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/metrics')) return jsonResponse({ bvid: BVID, limit: 500, items: [] });
      return jsonResponse(videoDetail(null));
    }) as typeof fetch;

    renderAt(
      <MemoryRouter initialEntries={[`/monitoring/videos/${BVID}`]}>
        <Routes>
          <Route path="/monitoring/videos/:bvid" element={<MonitoringVideoDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('作者信息待补齐')).toBeTruthy();
    expect(screen.queryByTestId('video-author-card')).toBeNull();
    expect(screen.queryByTestId('mock-echart')).toBeNull();
    expect(urls.some((url) => url.includes('/creators/'))).toBe(false);
    expectNoHorizontalOverflow('video-detail-page');
  });

  test('shows 暂无样本 when the author has no follower points', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/creators/') && url.includes('/metrics')) {
        return jsonResponse({ mid: MID, limit: 500, items: [] });
      }
      if (url.includes('/metrics')) return jsonResponse({ bvid: BVID, limit: 500, items: [] });
      return jsonResponse(
        videoDetail({
          mid: MID,
          uname: '无粉丝',
          faceAssetId: null,
          followerLatest: null,
          followerSampledAt: null,
          monitoringEnabled: false,
        }),
      );
    }) as typeof fetch;

    renderAt(
      <MemoryRouter initialEntries={[`/monitoring/videos/${BVID}`]}>
        <Routes>
          <Route path="/monitoring/videos/:bvid" element={<MonitoringVideoDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect((await screen.findByTestId('follower-sparkline-empty')).textContent).toBe('暂无样本');
    expect(screen.getByTestId('video-author-followers').textContent).toBe('—');
    expect(screen.getByTestId('video-author-sampled-at').textContent).toBe('暂无采样');
    expect(screen.getByTestId('video-author-card').querySelector('img')?.getAttribute('src')).toBe(
      '/api/v1/assets/__placeholder__',
    );
  });

  test('shows a sparkline error and retries', async () => {
    let metricsCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/creators/') && url.includes('/metrics')) {
        metricsCalls += 1;
        if (metricsCalls === 1) return jsonResponse({ error: 'metrics down' }, 500);
        return jsonResponse({ mid: MID, limit: 500, items: [followerPoint()] });
      }
      if (url.includes('/metrics')) return jsonResponse({ bvid: BVID, limit: 500, items: [] });
      return jsonResponse(
        videoDetail({
          mid: MID,
          uname: '狐正正',
          faceAssetId: 'a_face_xlink',
          followerLatest: '51733',
          followerSampledAt: SAMPLED_AT,
          monitoringEnabled: true,
        }),
      );
    }) as typeof fetch;

    renderAt(
      <MemoryRouter initialEntries={[`/monitoring/videos/${BVID}`]}>
        <Routes>
          <Route path="/monitoring/videos/:bvid" element={<MonitoringVideoDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const sparkline = await screen.findByTestId('video-author-sparkline');
    expect(await within(sparkline).findByText('metrics down')).toBeTruthy();
    fireEvent.click(within(sparkline).getByRole('button', { name: '重试' }));
    expect(await within(sparkline).findByTestId('mock-echart')).toBeTruthy();
    expect(metricsCalls).toBe(2);
  });

  test('shows a sparkline skeleton while follower metrics load', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/creators/') && url.includes('/metrics')) {
        await gate;
        return jsonResponse({ mid: MID, limit: 500, items: [followerPoint()] });
      }
      if (url.includes('/metrics')) return jsonResponse({ bvid: BVID, limit: 500, items: [] });
      return jsonResponse(
        videoDetail({
          mid: MID,
          uname: '狐正正',
          faceAssetId: 'a_face_xlink',
          followerLatest: '51733',
          followerSampledAt: SAMPLED_AT,
          monitoringEnabled: true,
        }),
      );
    }) as typeof fetch;

    renderAt(
      <MemoryRouter initialEntries={[`/monitoring/videos/${BVID}`]}>
        <Routes>
          <Route path="/monitoring/videos/:bvid" element={<MonitoringVideoDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const sparkline = await screen.findByTestId('video-author-sparkline');
    expect(await within(sparkline).findByLabelText('加载中')).toBeTruthy();
    release();
    expect(await within(sparkline).findByTestId('mock-echart')).toBeTruthy();
  });
});

describe('creator detail video list', () => {
  test('renders covers, titles, publish time, latest counts, total, and the next page', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes('/videos')) {
        const parsed = new URL(url, 'http://localhost');
        const offset = Number(parsed.searchParams.get('offset') ?? '0');
        const limit = Number(parsed.searchParams.get('limit') ?? '20');
        const items = Array.from({ length: 25 }, (_, index) => videoItem(index)).slice(
          offset,
          offset + limit,
        );
        return jsonResponse({ mid: MID, total: 25, items });
      }
      if (url.includes('/metrics')) return jsonResponse({ mid: MID, limit: 500, items: [] });
      return jsonResponse(creatorDetail());
    }) as typeof fetch;

    renderAt(
      <MemoryRouter initialEntries={[`/monitoring/creators/${MID}`]}>
        <Routes>
          <Route path="/monitoring/creators/:mid" element={<MonitoringCreatorDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('视频 0 VeryLongUnbrokenTitleForOverflowChecking')).toBeTruthy();
    expect(screen.getByTestId('creator-videos-total').textContent).toBe('共 25 条');
    const list = screen.getByTestId('creator-video-list');
    expect(list.className).toContain('grid-cols-1');
    expect(list.className).toContain('min-[1440px]:grid-cols-2');
    const first = within(list).getAllByTestId('creator-video-card')[0];
    if (!first) throw new Error('missing video card');
    expect(first.getAttribute('href')).toBe('/monitoring/videos/BVCLP0000');
    expect(first.querySelector('img')?.getAttribute('src')).toBe('/api/v1/assets/a_cover_x');
    expect(first.textContent).toContain('播放 623');
    expect(first.textContent).toContain('评论 8');
    expect(first.querySelector('[title]')?.getAttribute('title')).toBe(
      formatFullLocalTime(PUBLISHED_AT),
    );
    expect(screen.getByText('已归档')).toBeTruthy();
    expect(screen.getAllByText('暂无样本').length).toBeGreaterThan(0);
    expect(screen.getByText('发布时间未记录')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '显示全部' }));
    expect(await screen.findByText('视频 24')).toBeTruthy();
    expect(screen.getAllByTestId('creator-video-card')).toHaveLength(25);
    expect(screen.queryByRole('button', { name: '显示全部' })).toBeNull();
    expect(urls.some((url) => url.includes('offset=20') && url.includes('limit=100'))).toBe(true);
    expectNoHorizontalOverflow('creator-detail-page');
  });

  test('shows an empty state without a zero-count header', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/videos')) return jsonResponse({ mid: MID, total: 0, items: [] });
      if (url.includes('/metrics')) return jsonResponse({ mid: MID, limit: 500, items: [] });
      return jsonResponse(creatorDetail());
    }) as typeof fetch;

    renderAt(
      <MemoryRouter initialEntries={[`/monitoring/creators/${MID}`]}>
        <Routes>
          <Route path="/monitoring/creators/:mid" element={<MonitoringCreatorDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('暂无视频')).toBeTruthy();
    expect(screen.getByRole('heading', { name: '该 UP 的视频' })).toBeTruthy();
    expect(screen.queryByTestId('creator-videos-total')).toBeNull();
    expect(screen.queryByTestId('creator-video-list')).toBeNull();
    expect(screen.queryByText('共 0 条')).toBeNull();
    expect(document.querySelector('table')).toBeNull();
    expectNoHorizontalOverflow('creator-detail-page');
  });

  test('shows a loading skeleton and then an error for the video list', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let videosCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/videos')) {
        videosCalls += 1;
        if (videosCalls === 1) {
          await gate;
          return jsonResponse({ error: 'videos down' }, 500);
        }
        return jsonResponse({ mid: MID, total: 0, items: [] });
      }
      if (url.includes('/metrics')) return jsonResponse({ mid: MID, limit: 500, items: [] });
      return jsonResponse(creatorDetail());
    }) as typeof fetch;

    renderAt(
      <MemoryRouter initialEntries={[`/monitoring/creators/${MID}`]}>
        <Routes>
          <Route path="/monitoring/creators/:mid" element={<MonitoringCreatorDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '狐正正' })).toBeTruthy();
    const section = screen.getByTestId('creator-videos');
    expect(await within(section).findByLabelText('加载中')).toBeTruthy();
    release();
    expect(await within(section).findByText('videos down')).toBeTruthy();
    fireEvent.click(within(section).getByRole('button', { name: '重试' }));
    expect(await within(section).findByText('暂无视频')).toBeTruthy();
    await waitFor(() => expect(videosCalls).toBe(2));
  });
});
