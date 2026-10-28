import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import type { CommercialOpenItemRead } from '@studio/contracts';
import { asLiveDetail } from '../live-read-fixture';
import { ProjectListCard } from './project-list-card';
import { OpenItemsReadout } from './open-items-readout';

const originalFetch = globalThis.fetch;
const PROJECT_ID = 'f0010001-0001-4001-8001-0000000000aa';
const ITEM_ID = 'f0a10001-0001-4001-8001-0000000000a4';

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function openItem(overrides: Partial<CommercialOpenItemRead> = {}): CommercialOpenItemRead {
  return {
    id: ITEM_ID,
    title: '甲方未寄样品',
    description: null,
    closeCriteria: null,
    nextAction: null,
    nextActor: 'client',
    lifecycle: 'open',
    impact: 'normal',
    plannedAt: null,
    sortRank: 0,
    blocksRequiredForClose: false,
    workflowNodeId: null,
    blocksNodeId: null,
    createdAt: '2026-05-02T00:00:00.000000Z',
    updatedAt: '2026-05-02T00:00:00.000000Z',
    ...overrides,
  };
}

function listProject(openItems: CommercialOpenItemRead[]) {
  return asLiveDetail({
    id: PROJECT_ID,
    name: '哈曼卡顿耳机',
    netAmount: null,
    rebateAmount: null,
    overallStage: 'pre_publish',
    currentStageNames: ['大纲'],
    anyNodeBlocked: false,
    blockingReason: null,
    openItems,
  });
}

function renderListCard(openItems: CommercialOpenItemRead[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ProjectListCard project={listProject(openItems)} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('project list card open item line', () => {
  test('omits the line when the project has no open item', () => {
    renderListCard([]);
    expect(screen.queryByTestId('project-list-open-item-line')).toBeNull();
  });

  test('shows actor and title for a third-party reminder', () => {
    renderListCard([openItem({ nextActor: 'third_party', impact: 'normal' })]);
    const line = screen.getByTestId('project-list-open-item-line');
    expect(line.textContent).toBe('卡在第三方 · 甲方未寄样品');
    expect(line.getAttribute('data-impact')).toBe('normal');
    expect(line.className).toContain('text-amber-700');
  });

  test('uses the destructive tone for a blocking item', () => {
    renderListCard([openItem({ nextActor: 'client', impact: 'blocking' })]);
    const line = screen.getByTestId('project-list-open-item-line');
    expect(line.textContent).toBe('卡在甲方 · 甲方未寄样品');
    expect(line.className).toContain('text-destructive');
  });
});

describe('open item form', () => {
  test('submits a new third-party blocker to the create route', async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: new URL(String(input), 'http://localhost').pathname,
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return Promise.resolve(
        new Response(
          JSON.stringify({
            projectId: PROJECT_ID,
            item: {
              id: ITEM_ID,
              title: '甲方未寄样品',
              lifecycle: 'open',
              impact: 'blocking',
              nextActor: 'third_party',
              dueAt: '2026-10-31T16:00:00.000Z',
              note: '等样机',
              updatedAt: '2026-05-02T00:00:00.000000Z',
              cancelReason: null,
            },
            liftedNodes: [],
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ),
      );
    }) as typeof fetch;
    let changed = 0;
    render(
      <OpenItemsReadout
        items={[]}
        projectId={PROJECT_ID}
        onChanged={() => {
          changed += 1;
        }}
      />,
    );

    fireEvent.click(screen.getByTestId('open-item-add'));
    fireEvent.change(screen.getByTestId('open-item-title-input'), {
      target: { value: '甲方未寄样品' },
    });
    fireEvent.click(screen.getByRole('radio', { name: '第三方' }));
    fireEvent.click(screen.getByRole('radio', { name: '阻塞' }));
    fireEvent.change(screen.getByTestId('open-item-due-input'), {
      target: { value: '2026-11-01' },
    });
    fireEvent.change(screen.getByTestId('open-item-note-input'), {
      target: { value: '等样机' },
    });
    fireEvent.click(screen.getByTestId('open-item-submit'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({
      url: `/api/v1/commercial/projects/${PROJECT_ID}/open-items`,
      method: 'POST',
      body: {
        title: '甲方未寄样品',
        nextActor: 'third_party',
        impact: 'blocking',
        dueAt: '2026-10-31T16:00:00.000Z',
        note: '等样机',
      },
    });
    await waitFor(() => expect(changed).toBe(1));
    expect(screen.queryByTestId('open-item-form')).toBeNull();
  });
});
