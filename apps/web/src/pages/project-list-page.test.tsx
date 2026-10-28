import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { asLiveDetail } from '@/features/commercial/live-read-fixture';
import { ProjectListPage } from './project-list-page';

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;

const PENDING = 'f0010001-0001-4001-8001-0000000000c1';
const ACTIVE = 'f0010001-0001-4001-8001-0000000000c2';
const WRAPPING = 'f0010001-0001-4001-8001-0000000000c3';

function listProject(overrides: Record<string, unknown>) {
  return asLiveDetail({
    netAmount: null,
    rebateAmount: null,
    overallStage: 'pre_publish',
    currentStageNames: [],
    anyNodeBlocked: false,
    blockingReason: null,
    blockedNodeNames: [],
    openItems: [],
    ...overrides,
  });
}

function installProjects() {
  const items = [
    listProject({
      id: PENDING,
      name: '待开始样例',
      currentStageNames: ['大纲'],
      phase: 'pending',
    }),
    listProject({
      id: ACTIVE,
      name: '进行中样例',
      currentStageNames: ['文案'],
      phase: 'active',
    }),
    listProject({
      id: WRAPPING,
      name: '收尾完结样例',
      currentStageNames: ['结算'],
      phase: 'wrapping',
    }),
  ];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname !== '/api/v1/commercial/projects') {
      return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
    }
    return new Response(JSON.stringify({ items, total: items.length, limit: null, offset: 0 }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
}

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/projects']}>
        <Routes>
          <Route path="/projects" element={<ProjectListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('project list phase columns (WP-OC-007)', () => {
  test('renders three columns with the phase counts', async () => {
    installProjects();
    renderList();

    expect(await screen.findByText('待开始样例')).toBeTruthy();
    const columns = screen.getAllByTestId('project-phase-column');
    expect(columns.map((column) => column.getAttribute('data-phase'))).toEqual([
      'pending',
      'active',
      'wrapping',
    ]);

    const pending = columns[0]!;
    const active = columns[1]!;
    const wrapping = columns[2]!;
    expect(within(pending).getByTestId('project-phase-heading').textContent).toBe('待开始 · 1');
    expect(within(active).getByTestId('project-phase-heading').textContent).toBe('进行中 · 1');
    expect(within(wrapping).getByTestId('project-phase-heading').textContent).toBe('收尾完结 · 1');
    expect(within(pending).getByText('待开始样例')).toBeTruthy();
    expect(within(active).getByText('进行中样例')).toBeTruthy();
    expect(within(wrapping).getByText('收尾完结样例')).toBeTruthy();
  });

  test('stacks the three blocks on narrow screens without horizontal scrolling', async () => {
    installProjects();
    renderList();

    const columns = await screen.findByTestId('project-phase-columns');
    const classes = columns.className.split(/\s+/);
    expect(classes).toContain('grid-cols-1');
    expect(classes).toContain('lg:grid-cols-3');
    expect(classes).not.toContain('overflow-x-auto');
    expect(screen.getAllByTestId('project-phase-column')).toHaveLength(3);
  });

  test('shows 暂无项目 in an empty phase column', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname !== '/api/v1/commercial/projects') {
        return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
      }
      const items = [
        listProject({
          id: ACTIVE,
          name: '只有进行中',
          currentStageNames: ['文案'],
          phase: 'active',
        }),
      ];
      return new Response(JSON.stringify({ items, total: 1, limit: null, offset: 0 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    renderList();

    expect(await screen.findByText('只有进行中')).toBeTruthy();
    const columns = screen.getAllByTestId('project-phase-column');
    expect(within(columns[0]!).getByText('暂无项目')).toBeTruthy();
    expect(within(columns[2]!).getByText('暂无项目')).toBeTruthy();
    expect(within(columns[1]!).queryByText('暂无项目')).toBeNull();
  });
});
