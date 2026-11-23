import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { CommercialRebate, CommercialRebateListResponse } from '@studio/contracts';
import { RevenuePage } from './revenue-page';

const originalFetch = globalThis.fetch;

function rebate(overrides: Partial<CommercialRebate> = {}): CommercialRebate {
  return {
    id: 'c0b00009-0000-4000-8000-000000000009',
    projectId: null,
    projectName: '大疆 Pocket4',
    counterparty: null,
    expectedAmount: '5320.00',
    isReturned: false,
    returnedAt: null,
    contractState: 'signed',
    invoiceState: 'none',
    note: '待开票；11/20 已催',
    evidence: [],
    stageSince: '2026-11-23T00:00:00.000000Z',
    createdAt: '2026-11-23T00:00:00.000000Z',
    updatedAt: '2026-11-23T00:00:00.000000Z',
    platformPaid: false,
    daysInStage: 3,
    ...overrides,
  };
}

function installData() {
  let returned = false;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname === '/api/v1/commercial/projects') {
      return new Response(JSON.stringify({ items: [], total: 0, limit: null, offset: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/api/v1/commercial/rebates' && (!init || init.method === 'GET')) {
      const items = returned
        ? [
            rebate({
              isReturned: true,
              returnedAt: '2026-11-23',
              updatedAt: '2026-11-23T01:00:00.000000Z',
            }),
            rebate({
              id: 'c0b0000c-0000-4000-8000-00000000000c',
              projectName: 'plaud ai录音笔',
              counterparty: '网飞（广州）娱乐经纪',
              expectedAmount: '4950.00',
              contractState: 'sent',
              note: '待回寄',
            }),
            rebate({
              id: 'c0b00007-0000-4000-8000-000000000007',
              projectName: '韶音耳机8月',
              expectedAmount: '9900.00',
              isReturned: true,
              returnedAt: '2026-08-29',
              contractState: 'signed',
              invoiceState: 'received',
            }),
          ]
        : [
            rebate(),
            rebate({
              id: 'c0b0000c-0000-4000-8000-00000000000c',
              projectName: 'plaud ai录音笔',
              counterparty: '网飞（广州）娱乐经纪',
              expectedAmount: '4950.00',
              contractState: 'sent',
              note: '待回寄',
            }),
            rebate({
              id: 'c0b00007-0000-4000-8000-000000000007',
              projectName: '韶音耳机8月',
              expectedAmount: '9900.00',
              isReturned: true,
              returnedAt: '2026-08-29',
              contractState: 'signed',
              invoiceState: 'received',
            }),
          ];
      const open = items.filter((item) => !item.isReturned);
      const total = open.reduce((sum, item) => sum + Number(item.expectedAmount), 0);
      const body: CommercialRebateListResponse = {
        items,
        summary: {
          outstandingTotal: total.toFixed(2),
          outstandingPlatformPaid: '0.00',
          outstandingPlatformUnpaid: total.toFixed(2),
          settledThisYear: '9900.00',
          openCount: open.length,
        },
      };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (
      url.pathname === '/api/v1/commercial/rebates/c0b00009-0000-4000-8000-000000000009' &&
      init?.method === 'PATCH'
    ) {
      returned = true;
      return new Response(JSON.stringify(rebate({ isReturned: true, returnedAt: '2026-11-23' })), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  }) as typeof fetch;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/revenue']}>
        <Routes>
          <Route path="/revenue" element={<RevenuePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

describe('revenue page', () => {
  test('renders outstanding rows, split totals and the settled fold', async () => {
    installData();
    renderPage();

    expect(await screen.findByText('大疆 Pocket4')).toBeTruthy();
    expect(screen.getByTestId('revenue-outstanding-total').textContent).toContain('10,270.00');
    expect(screen.getByTestId('revenue-outstanding-split').textContent).toContain(
      '平台款已到 ¥0.00',
    );
    expect(screen.getByTestId('revenue-outstanding-split').textContent).toContain(
      '平台款未到 ¥10,270.00',
    );
    expect(screen.getAllByTestId('revenue-outstanding-row')).toHaveLength(2);
    expect(screen.getByTestId('revenue-settled')).toBeTruthy();
    expect(screen.getByTestId('revenue-settled-fold').textContent).toContain('已结清 · 1');
  });

  test('checking 已返 patches the row and moves it to settled', async () => {
    installData();
    renderPage();

    const checkbox = await screen.findByLabelText('标记 大疆 Pocket4 已返');
    fireEvent.click(checkbox);

    await waitFor(() => {
      expect(screen.getAllByTestId('revenue-outstanding-row')).toHaveLength(1);
    });
    expect(screen.getByTestId('revenue-settled-fold').textContent).toContain('已结清 · 2');
  });
});
