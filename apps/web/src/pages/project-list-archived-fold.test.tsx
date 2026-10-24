import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { asLiveDetail } from '@/features/commercial/live-read-fixture';
import { ProjectListPage } from './project-list-page';

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;
const ACTIVE = 'f0010001-0001-4001-8001-000000000001';
const ARCHIVED = 'f0010001-0001-4001-8001-000000000006';

function listItem(id: string, name: string, archivedAt: string | null) {
  return asLiveDetail({
    id,
    name,
    netAmount: null,
    rebateAmount: null,
    overallStage: archivedAt ? ('archived' as const) : ('pre_publish' as const),
    archivedAt,
    currentStageNames: archivedAt ? [] : ['询单'],
    anyNodeBlocked: false,
    blockingReason: null,
    blockedNodeNames: [],
    openItems: [],
    publish: {
      published: false,
      bvid: null,
      publishedAt: null,
      publishSource: null,
      idempotencyKey: null,
    },
  });
}

function installLists() {
  const active = listItem(ACTIVE, '进行中样例', null);
  const archived = listItem(ARCHIVED, '已归档样例', '2026-01-15T00:00:00.000Z');
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    seen.push(url.searchParams.toString());
    if (url.pathname !== '/api/v1/commercial/projects') {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }
    const includeArchived = url.searchParams.get('includeArchived') === '1';
    const items = includeArchived ? [active, archived] : [active];
    return new Response(JSON.stringify({ items, total: items.length, limit: null, offset: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return seen;
}

function renderList(initial = '/projects') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('project list archived fold (WP-R2-19E)', () => {
  test('keeps archived out of the main list and expands via includeArchived URL', async () => {
    const seen = installLists();
    renderList('/projects');
    expect(await screen.findByText('进行中样例')).toBeTruthy();
    expect(screen.queryByText('已归档样例')).toBeNull();
    const toggle = await screen.findByTestId('project-archived-fold-toggle');
    expect(toggle.textContent).toContain('已归档（1）');
    expect(toggle.textContent).toContain('▷');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByTestId('project-archived-fold-toggle').getAttribute('aria-expanded')).toBe(
        'true',
      );
    });
    expect(screen.getByText('已归档样例')).toBeTruthy();
    expect(screen.getByTestId('project-archived-fold-list')).toBeTruthy();
    expect(screen.getByTestId('project-archived-fold-toggle').textContent).toContain('▾');
    expect(seen.some((q) => q.includes('includeArchived=1'))).toBe(true);
  });

  test('restores expanded fold from includeArchived=1 on refresh', async () => {
    installLists();
    renderList('/projects?includeArchived=1');
    expect(await screen.findByText('已归档样例')).toBeTruthy();
    expect(screen.getByTestId('project-archived-fold-toggle').getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  test('shows empty archived copy when none exist', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname !== '/api/v1/commercial/projects') {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }
      const active = listItem(ACTIVE, '进行中样例', null);
      return new Response(JSON.stringify({ items: [active], total: 1, limit: null, offset: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    renderList('/projects?includeArchived=1');
    expect(await screen.findByText('暂无已归档')).toBeTruthy();
    expect(screen.getByTestId('project-archived-fold-toggle').textContent).toContain('已归档（0）');
  });
});
