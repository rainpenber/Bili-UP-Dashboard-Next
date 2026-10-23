import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { asLiveDetail } from '@/features/commercial/live-read-fixture';
import { CommercialHomePage } from './commercial-home-page';

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;
const ACTIVE_A = 'f0010001-0001-4001-8001-0000000000b1';
const ACTIVE_B = 'f0010001-0001-4001-8001-0000000000b2';
const NOT_STARTED = 'f0010001-0001-4001-8001-0000000000b3';
const FINISHED = 'f0010001-0001-4001-8001-0000000000b4';
const ARCHIVED = 'f0010001-0001-4001-8001-0000000000b5';

describe('commercial home active projects (WP-R2-20A)', () => {
  test('shows active projects with empty openItems and excludes other business states', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname !== '/api/v1/commercial/projects') {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }
      const items = [
        asLiveDetail({
          id: ACTIVE_A,
          name: '真实进行中甲',
          overallStage: 'pre_publish',
          currentStageNames: ['文案'],
          businessState: 'active',
          originStatusLabel: '2.进行中',
          openItems: [],
          publish: {
            published: false,
            bvid: null,
            publishedAt: null,
            publishSource: null,
            idempotencyKey: null,
          },
        }),
        asLiveDetail({
          id: ACTIVE_B,
          name: '真实进行中乙',
          overallStage: 'published_winding_down',
          currentStageNames: [],
          businessState: 'active',
          originStatusLabel: '3.收尾-审核中',
          openItems: [],
          publish: {
            published: true,
            bvid: 'BV1active0001',
            publishedAt: '2026-05-01T00:00:00.000Z',
            publishSource: 'web',
            idempotencyKey: 'key-b',
          },
        }),
        asLiveDetail({
          id: NOT_STARTED,
          name: '未开始项目',
          businessState: 'not_started',
          originStatusLabel: '1.未开始',
          openItems: [],
          publish: {
            published: false,
            bvid: null,
            publishedAt: null,
            publishSource: null,
            idempotencyKey: null,
          },
        }),
        asLiveDetail({
          id: FINISHED,
          name: '已提现项目',
          businessState: 'finished',
          originStatusLabel: '3.收尾-已提现',
          openItems: [],
          publish: {
            published: false,
            bvid: null,
            publishedAt: null,
            publishSource: null,
            idempotencyKey: null,
          },
        }),
        asLiveDetail({
          id: ARCHIVED,
          name: '归档样例',
          overallStage: 'archived',
          archivedAt: '2026-01-15T00:00:00.000Z',
          businessState: 'active',
          originStatusLabel: '2.进行中',
          openItems: [],
          publish: {
            published: false,
            bvid: null,
            publishedAt: null,
            publishSource: null,
            idempotencyKey: null,
          },
        }),
      ];
      return new Response(JSON.stringify({ items, total: items.length, limit: null, offset: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <CommercialHomePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const counts = await screen.findByTestId('home-board-counts');
    expect(counts.getAttribute('data-open-actions')).toBe('0');
    expect(counts.getAttribute('data-active-projects')).toBe('2');
    expect(counts.textContent).toContain('开放事项 0');
    expect(counts.textContent).toContain('进行中项目 2');

    const activeRows = screen.getAllByTestId('home-active-project');
    expect(activeRows).toHaveLength(2);
    expect(screen.getByText('真实进行中甲')).toBeTruthy();
    expect(screen.getByText('真实进行中乙')).toBeTruthy();
    expect(screen.getByText(/当前节点 \/ 阶段：文案/)).toBeTruthy();
    expect(screen.getByText(/当前节点 \/ 阶段：已上线，收尾中/)).toBeTruthy();
    expect(screen.getByText(/来源状态：2\.进行中/)).toBeTruthy();
    expect(screen.queryByText('未开始项目')).toBeNull();
    expect(screen.queryByText('已提现项目')).toBeNull();
    expect(screen.queryByText('归档样例')).toBeNull();
  });
});
