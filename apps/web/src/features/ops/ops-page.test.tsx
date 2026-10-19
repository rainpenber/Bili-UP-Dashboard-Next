import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { OpsPage } from './ops-page';

const originalFetch = globalThis.fetch;

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

const emptyPage = { items: [], nextCursor: null, limit: 50 };

const run = {
  id: '11111111-1111-4111-8111-111111111111',
  targetId: '22222222-2222-4222-8222-222222222222',
  targetLabel: '离线视频',
  status: 'failed',
  samplesWritten: 0,
  durationMs: 42,
  error: 'SESSDATA=plain-sess-value-9f3a; bili_jct=plain-jct-value-9f3a',
  startedAt: '2026-10-19T01:02:03.000Z',
  finishedAt: '2026-10-19T01:02:04.000Z',
};

const detail = {
  run,
  requests: [
    {
      id: '9',
      endpoint: 'view',
      statusCode: 200,
      bizCode: -352,
      durationMs: 18,
      error: null,
      requestedAt: '2026-10-19T01:02:03.000Z',
      runId: run.id,
    },
  ],
  logs: [
    {
      id: '3',
      ts: '2026-10-19T01:02:04.000Z',
      level: 'error',
      service: 'collector',
      event: 'job.failed',
      message: '任务失败',
      requestId: null,
      runId: run.id,
      context: { password: 'pw-secret-value', note: 'ciphertext stays hidden' },
    },
  ],
};

function install(handler: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url));
  }) as unknown as typeof fetch;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <OpsPage />
    </MemoryRouter>,
  );
}

describe('ops page', () => {
  test('shows the loading state', () => {
    globalThis.fetch = (() => new Promise(() => undefined)) as unknown as typeof fetch;
    renderPage();
    expect(screen.getByLabelText('加载中')).toBeTruthy();
    expect(document.querySelector('[data-testid="ops-loading"]')).toBeTruthy();
  });

  test('shows the error state', async () => {
    install(() => jsonResponse({ error: '数据库不可用' }, 500));
    renderPage();
    expect(await screen.findByText('数据库不可用')).toBeTruthy();
    expect(document.querySelector('[data-testid="ops-error"]')).toBeTruthy();
  });

  test('shows the empty state', async () => {
    install((url) => {
      if (url.includes('/summary')) return jsonResponse(emptySummary);
      if (url.includes('/health')) return jsonResponse(emptyHealth);
      return jsonResponse(emptyPage);
    });
    renderPage();
    expect(await screen.findByText('还没有采集运行')).toBeTruthy();
    expect(screen.getByText('失联')).toBeTruthy();
    expect(screen.getByText('队列积压')).toBeTruthy();
  });

  test('shows a run, scrubs secrets, copies the bundle, and refreshes logs every 10 seconds', async () => {
    const calls: string[] = [];
    const intervals: number[] = [];
    const original = globalThis.setInterval;
    globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      if (typeof timeout === 'number') intervals.push(timeout);
      return original(handler, timeout, ...args);
    }) as typeof setInterval;
    install((url) => {
      calls.push(url);
      if (url.includes('/debug/bundle')) {
        return jsonResponse({
          schemaVersion: '007_metadata_assets_logs',
          generatedAt: '2026-10-19T01:02:05.000Z',
          run,
          target: null,
          requests: detail.requests,
          logs: [],
          video: null,
          creator: null,
          heartbeats: [],
          circuits: [],
        });
      }
      if (url.includes('/summary')) {
        return jsonResponse({
          ...emptySummary,
          heartbeats: [
            {
              instance: 'collector-1',
              status: 'idle',
              lastSeenAt: new Date().toISOString(),
              currentJobId: null,
            },
          ],
          queue: { due: 1, running: 0, failed24h: 2 },
          circuits: [
            {
              accountId: '33333333-3333-4333-8333-333333333333',
              openedAt: '2026-10-19T01:00:00.000Z',
              resumeAt: '2026-10-19T01:30:00.000Z',
              consecutiveFailures: 1,
              reason: 'risk',
            },
          ],
        });
      }
      if (url.includes('/health')) {
        return jsonResponse({
          lastHeartbeatAt: new Date().toISOString(),
          stale: false,
          queueBacklog: 4,
          lastSuccessAt: '2026-10-19T01:00:00.000Z',
        });
      }
      if (url.includes('/runs/')) return jsonResponse(detail);
      if (url.includes('/runs')) return jsonResponse({ items: [run], nextCursor: null, limit: 50 });
      return jsonResponse({
        items: [
          {
            id: '8',
            ts: '2026-10-19T01:02:04.000Z',
            level: 'error',
            service: 'collector',
            event: 'job.failed',
            message: 'SESSDATA=plain-sess-value-9f3a',
            requestId: null,
            runId: run.id,
            context: {},
          },
        ],
        nextCursor: null,
        limit: 200,
      });
    });
    const view = renderPage();
    expect(await screen.findByText('离线视频')).toBeTruthy();
    expect(screen.getByText('正常')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(document.body.textContent).not.toContain('plain-sess-value-9f3a');
    expect(document.body.textContent).not.toContain('plain-jct-value-9f3a');
    expect(document.body.textContent).not.toMatch(/SESSDATA|bili_jct|password|ciphertext/);

    fireEvent.click(screen.getByRole('checkbox', { name: '自动刷新' }));
    expect(intervals).toContain(10_000);

    fireEvent.click(screen.getByRole('button', { name: /2026/ }));
    expect(await screen.findByText('view')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制排障包' }));
    expect(await screen.findByText('已复制排障包')).toBeTruthy();
    expect(calls.some((url) => url.includes('/api/v1/ops/debug/bundle?runId='))).toBe(true);

    for (const width of [390, 1440]) {
      const host = view.container;
      host.style.width = `${width}px`;
      host.style.maxWidth = `${width}px`;
      const page = host.querySelector('[data-testid="ops-page"]');
      if (!(page instanceof HTMLElement)) throw new Error('missing ops page');
      expect(page.className).toContain('overflow-x-hidden');
      expect(page.className).toContain('max-w-full');
      const scrollers = page.querySelectorAll('[data-testid="ops-hscroll"]');
      expect(scrollers.length).toBeGreaterThan(0);
      for (const node of scrollers) {
        expect((node as HTMLElement).className).toContain('overflow-x-auto');
        expect((node as HTMLElement).className).toContain('max-w-full');
      }
      if (host.clientWidth > 0) {
        expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
      }
    }
    globalThis.setInterval = original;
  });
});
