import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const healthySummary = {
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
};

const healthy = {
  lastHeartbeatAt: new Date().toISOString(),
  stale: false,
  queueBacklog: 4,
  lastSuccessAt: '2026-10-19T01:00:00.000Z',
};

const emptyHealth = {
  lastHeartbeatAt: null,
  stale: true,
  queueBacklog: 0,
  lastSuccessAt: null,
};

const range = {
  since: '2026-10-15',
  until: '2026-10-21',
  timezone: 'Asia/Shanghai',
  defaulted: true,
};

const retention = {
  days: 14,
  cutoff: '2026-10-07T00:00:00.000Z',
  oldestStoredAt: null,
  timezone: 'Asia/Shanghai',
};

const pendingJob = {
  id: '33333333-3333-4333-8333-333333333333',
  targetId: '22222222-2222-4222-8222-222222222222',
  targetType: 'video',
  externalId: 'BV1xx411c7mD',
  label: '排队视频',
  displayName: '排队视频标题超长'.repeat(8),
  coverUrl: null,
  targetDeleted: false,
  status: 'pending',
  attempts: 0,
  scheduledFor: '2026-10-21T02:00:00.000Z',
  startedAt: null,
  finishedAt: null,
  durationMs: null,
  samplesWritten: null,
  error: null,
  latestAttempt: null,
  projects: [],
};

const jobList = {
  mode: 'time',
  items: [pendingJob],
  total: 21,
  page: 1,
  pageSize: 20,
  range,
  logRetention: retention,
};

const detail = {
  job: pendingJob,
  attempts: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      status: 'failed',
      samplesWritten: 0,
      durationMs: 42,
      error: 'SESSDATA=plain-sess-value-9f3a',
      startedAt: '2026-10-21T01:00:00.000Z',
      finishedAt: '2026-10-21T01:00:01.000Z',
      requests: [
        {
          id: '9',
          endpoint: 'view',
          statusCode: 200,
          bizCode: -352,
          durationMs: 18,
          error: null,
          requestedAt: '2026-10-21T01:00:00.000Z',
          runId: '11111111-1111-4111-8111-111111111111',
        },
      ],
      requestsTruncated: false,
      logs: [
        {
          id: '3',
          ts: '2026-10-21T01:00:01.000Z',
          level: 'error',
          service: 'collector',
          event: 'job.failed',
          message: '任务失败',
          requestId: null,
          runId: '11111111-1111-4111-8111-111111111111',
          context: { password: 'pw-secret-value', note: 'keep-visible' },
        },
      ],
      logsTruncated: false,
      logNote: null,
    },
  ],
  attemptTotal: 1,
  attemptPage: 1,
  attemptPageSize: 10,
  jobLogs: [],
  jobLogsTruncated: false,
  logRetention: retention,
};

const groupList = {
  mode: 'target',
  items: [
    {
      targetId: pendingJob.targetId,
      targetType: 'video',
      externalId: pendingJob.externalId,
      label: pendingJob.label,
      displayName: pendingJob.displayName,
      coverUrl: null,
      targetDeleted: false,
      matchCount: 6,
      truncated: true,
      jobs: [pendingJob],
    },
  ],
  total: 2,
  page: 1,
  pageSize: 20,
  jobsPerGroup: 5,
  range,
  logRetention: retention,
};

function install(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return Promise.resolve(handler(url, init));
  }) as unknown as typeof fetch;
}

function renderPage(path = '/ops') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <OpsPage />
    </MemoryRouter>,
  );
}

describe('ops page', () => {
  test('defaults to collection records and separates an empty list from a failed request', async () => {
    const calls: string[] = [];
    install((url) => {
      calls.push(url);
      if (url.includes('/summary')) return jsonResponse(emptySummary);
      if (url.includes('/health')) return jsonResponse(emptyHealth);
      if (url.includes('/collector-jobs')) {
        return jsonResponse({ ...jobList, items: [], total: 0 });
      }
      return jsonResponse({ error: '不应请求' }, 500);
    });
    renderPage();
    expect(screen.getByRole('tab', { name: '采集记录' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(await screen.findByText('这个范围内没有采集记录')).toBeTruthy();
    expect(screen.getByText('失联')).toBeTruthy();
    expect(screen.getByTestId('ops-range').textContent).toContain('默认计划日期');
    expect(screen.getByLabelText('计划日期起')).toBeTruthy();
    expect(screen.getByLabelText('计划日期止')).toBeTruthy();
    expect(screen.getByTestId('ops-range').textContent).toContain('Asia/Shanghai');
    expect(calls.some((url) => url.includes('/api/v1/ops/operations'))).toBe(false);
    expect(calls.some((url) => url.includes('/api/v1/ops/logs'))).toBe(false);
    expect(calls.some((url) => url.includes('/collector-jobs?') && !url.includes('since='))).toBe(
      true,
    );
  });

  test('keeps the health summary when collection records fail, then loads logs on their own', async () => {
    install((url) => {
      if (url.includes('/summary')) return jsonResponse(healthySummary);
      if (url.includes('/health')) return jsonResponse(healthy);
      if (url.includes('/collector-jobs')) return jsonResponse({ error: '任务库不可用' }, 500);
      if (url.includes('/logs')) return jsonResponse({ error: '日志库不可用' }, 500);
      if (url.includes('/operations')) return jsonResponse({ error: '操作库不可用' }, 500);
      return jsonResponse({ error: '未知' }, 500);
    });
    renderPage();
    expect(await screen.findByText('任务库不可用')).toBeTruthy();
    expect(screen.getByText('正常')).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '系统日志' }));
    expect(await screen.findByText('日志库不可用')).toBeTruthy();
    expect(screen.getByText('正常')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '操作记录' }));
    expect(await screen.findByText('操作库不可用')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: '采集记录' }));
    expect(await screen.findByText('任务库不可用')).toBeTruthy();
  });

  test('filters into the drawer, scrubs secrets, and keeps the open job across refresh', async () => {
    const calls: string[] = [];
    install((url, init) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/debug/bundle')) {
        return jsonResponse({
          schemaVersion: '007_metadata_assets_logs',
          generatedAt: '2026-10-21T01:02:05.000Z',
          run: null,
          target: null,
          requests: detail.attempts[0]?.requests,
          logs: [],
          video: null,
          creator: null,
          heartbeats: [],
          circuits: [],
        });
      }
      if (url.includes('/summary')) return jsonResponse(healthySummary);
      if (url.includes('/health')) return jsonResponse(healthy);
      if (url.includes(`/collector-jobs/${pendingJob.id}`)) return jsonResponse(detail);
      if (url.includes('group=target')) return jsonResponse(groupList);
      if (url.includes('page=2')) return jsonResponse({ ...jobList, page: 2, items: [] });
      if (url.includes('/collector-jobs')) return jsonResponse(jobList);
      if (url.includes('/collector-targets')) {
        return jsonResponse({
          items: [
            {
              id: pendingJob.targetId,
              type: 'video',
              externalId: pendingJob.externalId,
              label: pendingJob.label,
              displayName: '搜索命中',
              deleted: false,
            },
          ],
          limit: 20,
        });
      }
      return jsonResponse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        range,
        logRetention: retention,
      });
    });
    const view = renderPage();
    expect(await screen.findByText(/尚未写入/)).toBeTruthy();
    expect(document.body.textContent).toContain('未开始');
    expect(document.body.textContent).not.toContain('写入 0');
    const title = screen.getByTitle(pendingJob.displayName);
    expect(title.className).toContain('truncate');
    expect(title.textContent?.startsWith('排队视频标题超长')).toBe(true);

    fireEvent.change(screen.getByLabelText('执行状态'), { target: { value: 'pending' } });
    await waitFor(() => {
      expect(calls.some((url) => url.includes('status=pending'))).toBe(true);
    });

    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(calls.some((url) => url.includes('page=2'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: '按监控对象分组' }));
    expect(await screen.findByText(/本组只列出最近 1 条，匹配共 6 条/)).toBeTruthy();
    expect(calls.some((url) => url.includes('group=target'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '查看该对象全部匹配记录' }));
    await waitFor(() => {
      expect(
        calls.some(
          (url) => url.includes(`targetId=${pendingJob.targetId}`) && !url.includes('group=target'),
        ),
      ).toBe(true);
    });

    fireEvent.click(await screen.findByTestId('ops-job-row'));
    expect(await screen.findByText('view')).toBeTruthy();
    expect(document.body.textContent).not.toContain('plain-sess-value-9f3a');
    expect(document.body.textContent).not.toContain('pw-secret-value');
    fireEvent.click(screen.getByText('技术字段'));
    expect(document.body.textContent).toContain('keep-visible');
    expect(document.body.textContent).not.toContain('pw-secret-value');
    fireEvent.click(screen.getByRole('button', { name: '复制排障包' }));
    expect(await screen.findByText('已复制排障包')).toBeTruthy();
    expect(calls.some((url) => url.includes('/api/v1/ops/debug/bundle?runId='))).toBe(true);
    expect(calls.every((url) => url.startsWith('GET '))).toBe(true);

    const detailCallsBefore = calls.filter((url) =>
      url.includes(`/collector-jobs/${pendingJob.id}`),
    ).length;
    fireEvent.click(screen.getByRole('button', { name: '刷新', hidden: true }));
    expect(await screen.findByText('view')).toBeTruthy();
    expect(
      calls.filter((url) => url.includes(`/collector-jobs/${pendingJob.id}`)).length,
    ).toBeGreaterThan(detailCallsBefore);

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
      }
      if (host.clientWidth > 0) {
        expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth + 1);
      }
    }
  });

  test('opens a card link on the same collection query as a direct target filter', async () => {
    const calls: string[] = [];
    install((url) => {
      calls.push(url);
      if (url.includes('/summary')) return jsonResponse(healthySummary);
      if (url.includes('/health')) return jsonResponse(healthy);
      if (url.includes('/collector-jobs')) return jsonResponse({ ...jobList, total: 1 });
      return jsonResponse({ items: [], nextCursor: null, limit: 50, total: 0 });
    });
    renderPage(
      '/ops?targetId=22222222-2222-4222-8222-222222222222&targetType=video&externalId=BV1xx411c7mD',
    );
    expect((await screen.findByTestId('ops-target-filter')).textContent).toContain('BV1xx411c7mD');
    expect((await screen.findByTestId('ops-target-filter')).textContent).toContain(
      '22222222-2222-4222-8222-222222222222',
    );
    const jobCall = calls.find((url) => url.includes('/api/v1/ops/collector-jobs?'));
    expect(jobCall).toContain('targetId=22222222-2222-4222-8222-222222222222');
    expect(jobCall).toContain('externalId=BV1xx411c7mD');
    expect(jobCall).not.toContain('group=target');
  });

  test('shows info logs until the user turns on attention', async () => {
    const calls: string[] = [];
    const infoLog = {
      id: '41',
      ts: '2026-10-21T02:00:00.000Z',
      level: 'info',
      service: 'api',
      event: 'service.started',
      message: '服务已启动',
      requestId: null,
      runId: null,
      context: { note: 'folded-field' },
    };
    const warnLog = {
      ...infoLog,
      id: '42',
      level: 'warn',
      event: 'job.failed',
      message: '告警一条',
    };
    install((url) => {
      calls.push(url);
      if (url.includes('/summary')) return jsonResponse(healthySummary);
      if (url.includes('/health')) return jsonResponse(healthy);
      if (url.includes('/logs')) {
        const attention = new URL(url, 'http://localhost').searchParams.get('attention') === '1';
        return jsonResponse({
          items: attention ? [warnLog] : [infoLog, warnLog],
          nextCursor: null,
          limit: 50,
          total: attention ? 1 : 2,
        });
      }
      if (url.includes('/collector-jobs')) return jsonResponse({ ...jobList, items: [], total: 0 });
      return jsonResponse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        range,
        logRetention: retention,
      });
    });
    renderPage('/ops?tab=logs');
    expect(await screen.findByText('服务已启动')).toBeTruthy();
    const box = screen.getByRole('checkbox', { name: '只看告警和失败' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    const firstLogCall = calls.find((url) => url.includes('/api/v1/ops/logs?'));
    expect(firstLogCall).toBeTruthy();
    expect(firstLogCall).not.toContain('attention=1');
    fireEvent.click(box);
    await waitFor(() => {
      expect(
        calls.some((url) => url.includes('/api/v1/ops/logs?') && url.includes('attention=1')),
      ).toBe(true);
      expect(screen.queryByText('服务已启动')).toBeNull();
    });
    expect(screen.getByText('告警一条')).toBeTruthy();
  });

  test('reproduces the attention filter from the URL', async () => {
    const calls: string[] = [];
    install((url) => {
      calls.push(url);
      if (url.includes('/summary')) return jsonResponse(healthySummary);
      if (url.includes('/health')) return jsonResponse(healthy);
      if (url.includes('/logs')) {
        return jsonResponse({
          items: [
            {
              id: '42',
              ts: '2026-10-21T02:00:00.000Z',
              level: 'warn',
              service: 'api',
              event: 'job.failed',
              message: '只剩告警',
              requestId: null,
              runId: null,
              context: {},
            },
          ],
          nextCursor: null,
          limit: 50,
          total: 1,
        });
      }
      return jsonResponse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        range,
        logRetention: retention,
      });
    });
    renderPage('/ops?tab=logs&attention=1');
    expect(await screen.findByText('只剩告警')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: '只看告警和失败' }) as HTMLInputElement).checked,
    ).toBe(true);
    expect(
      calls.some((url) => url.includes('/api/v1/ops/logs?') && url.includes('attention=1')),
    ).toBe(true);
  });

  test('explains a running job with no finished run', async () => {
    const running = {
      ...pendingJob,
      status: 'running',
      attempts: 1,
      startedAt: '2026-10-21T16:10:00.000Z',
      durationMs: 1200,
      samplesWritten: null,
      projects: [
        { id: '12121212-1212-4121-8121-121212121211', name: '商单甲' },
        { id: '12121212-1212-4121-8121-121212121212', name: '商单乙' },
        { id: '12121212-1212-4121-8121-121212121213', name: '商单丙' },
      ],
    };
    install((url) => {
      if (url.includes('/summary')) return jsonResponse(healthySummary);
      if (url.includes('/health')) return jsonResponse(healthy);
      if (url.includes(`/collector-jobs/${running.id}`)) {
        return jsonResponse({
          ...detail,
          job: running,
          attempts: [],
          attemptTotal: 0,
          jobLogs: [
            {
              id: '77',
              ts: '2026-10-21T16:10:00.000Z',
              level: 'info',
              service: 'collector',
              event: 'job.claimed',
              message: '已领取',
              requestId: null,
              runId: null,
              context: { password: 'secret-job-log', note: 'claim-note' },
            },
          ],
          jobLogsTruncated: true,
        });
      }
      if (url.includes('/collector-jobs'))
        return jsonResponse({ ...jobList, items: [running], total: 1 });
      return jsonResponse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        range,
        logRetention: retention,
      });
    });
    renderPage(`/ops?job=${running.id}`);
    expect(await screen.findByText('已完成执行记录 0')).toBeTruthy();
    expect(screen.getByText('还没有已完成的执行记录。')).toBeTruthy();
    expect(document.body.textContent).toContain('尝试（已开始） 1');
    expect(document.body.textContent).toContain('当前第 1 次');
    expect(document.body.textContent).not.toContain('尝试 0');
    expect(document.body.textContent).not.toContain('尝试 1');
    const jobLogs = screen.getByTestId('ops-job-logs');
    expect(jobLogs.textContent).toContain('已领取');
    expect(jobLogs.textContent).toContain('任务日志只显示最近 20 条');
    expect(jobLogs.textContent).not.toContain('secret-job-log');
    expect(screen.getAllByTestId('ops-job-projects')[0]?.textContent).toContain(
      '商单甲、商单乙 +1',
    );
  });

  test('counts grouped pages as monitor objects and offers a way back from an empty page', async () => {
    const calls: string[] = [];
    install((url) => {
      calls.push(url);
      if (url.includes('/summary')) return jsonResponse(healthySummary);
      if (url.includes('/health')) return jsonResponse(healthy);
      if (url.includes('group=target')) return jsonResponse(groupList);
      if (url.includes('page=9')) return jsonResponse({ ...jobList, page: 9, items: [] });
      if (url.includes('/collector-jobs')) return jsonResponse(jobList);
      return jsonResponse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        range,
        logRetention: retention,
      });
    });
    renderPage('/ops?group=target');
    expect(await screen.findByText('第 1 页，共 2 个监控对象')).toBeTruthy();
    expect(screen.queryByText('共 2 条')).toBeNull();
    cleanup();
    renderPage('/ops?page=9');
    expect(await screen.findByText('当前页没有记录')).toBeTruthy();
    const before = calls.length;
    fireEvent.click(screen.getByRole('button', { name: '返回第 1 页' }));
    await waitFor(() => {
      expect(
        calls
          .slice(before)
          .some((url) => url.includes('/collector-jobs?') && !url.includes('page=9')),
      ).toBe(true);
    });
    expect(await screen.findByText(/尚未写入/)).toBeTruthy();
  });

  test('shows the commercial project name from the id lookup', async () => {
    install((url) => {
      if (url.includes('/summary')) return jsonResponse(healthySummary);
      if (url.includes('/health')) return jsonResponse(healthy);
      if (url.includes('/projects?')) {
        return jsonResponse({
          items: [{ id: '12121212-1212-4121-8121-121212121211', name: '商单甲' }],
          limit: 20,
        });
      }
      if (url.includes('/collector-jobs')) return jsonResponse({ ...jobList, items: [], total: 0 });
      return jsonResponse({
        items: [],
        total: 0,
        page: 1,
        pageSize: 20,
        range,
        logRetention: retention,
      });
    });
    renderPage('/ops?projectId=12121212-1212-4121-8121-121212121211');
    const filter = await screen.findByTestId('ops-project-filter');
    expect(filter.textContent).toContain('商单甲');
    expect(filter.textContent).not.toContain('12121212-1212-4121-8121-121212121211');
  });
});
