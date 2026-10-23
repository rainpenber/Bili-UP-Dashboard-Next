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
const ACTIVE = 'f0010001-0001-4001-8001-000000000004';
const ARCHIVED = 'f0010001-0001-4001-8001-000000000006';
const ITEM_OPEN = 'f0a10001-0001-4001-8001-0000000000a1';
const ITEM_ARCHIVED = 'f0a10001-0001-4001-8001-0000000000a9';

describe('commercial home excludes soft-archived (WP-R2-19E)', () => {
  test('archived projects never appear in action or blocked modules', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      seen.push(url.search);
      if (url.pathname !== '/api/v1/commercial/projects') {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }
      // Even if a buggy caller asked for archived rows, the page must still exclude them.
      const items = [
        asLiveDetail({
          id: ACTIVE,
          name: '活跃阻塞样例',
          netAmount: '18000.00',
          rebateAmount: null,
          overallStage: 'pre_publish',
          currentStageNames: ['文案'],
          anyNodeBlocked: true,
          blockingReason: null,
          blockedNodeNames: ['文案'],
          openItems: [
            {
              id: ITEM_OPEN,
              title: '待我方跟进',
              description: null,
              closeCriteria: null,
              nextAction: '催一下',
              nextActor: 'us',
              lifecycle: 'open',
              impact: 'normal',
              plannedAt: null,
              sortRank: 0,
              blocksRequiredForClose: false,
              workflowNodeId: null,
              blocksNodeId: null,
              createdAt: '2026-05-02T00:00:00.000000Z',
              updatedAt: '2026-05-02T00:00:00.000000Z',
            },
          ],
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
          name: '已归档仍阻塞样例',
          netAmount: '1000.00',
          rebateAmount: null,
          overallStage: 'archived',
          archivedAt: '2026-01-15T00:00:00.000Z',
          currentStageNames: ['结算'],
          anyNodeBlocked: true,
          blockingReason: '不该出现',
          blockedNodeNames: ['结算'],
          openItems: [
            {
              id: ITEM_ARCHIVED,
              title: '归档后不应进待办',
              description: null,
              closeCriteria: null,
              nextAction: '忽略',
              nextActor: 'us',
              lifecycle: 'open',
              impact: 'blocking',
              plannedAt: null,
              sortRank: 0,
              blocksRequiredForClose: false,
              workflowNodeId: null,
              blocksNodeId: null,
              createdAt: '2026-05-02T00:00:00.000000Z',
              updatedAt: '2026-05-02T00:00:00.000000Z',
            },
          ],
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

    expect(await screen.findByTestId('home-block')).toBeTruthy();
    expect(screen.getAllByText('活跃阻塞样例').length).toBeGreaterThan(0);
    expect(screen.getByText('待我方跟进')).toBeTruthy();
    expect(screen.queryByText('已归档仍阻塞样例')).toBeNull();
    expect(screen.queryByText('归档后不应进待办')).toBeNull();
    expect(screen.queryByText('已归档')).toBeNull();
    expect(seen.every((q) => !q.includes('includeArchived=1'))).toBe(true);
  });
});
