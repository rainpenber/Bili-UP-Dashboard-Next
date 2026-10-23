import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryRouter } from 'react-router-dom';
import { asLiveDetail } from '../live-read-fixture';
import { ProjectListCard } from './project-list-card';

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

const originalFetch = globalThis.fetch;
const PROJECT_ID = 'f0010001-0001-4001-8001-000000000009';

describe('project list restore button', () => {
  test('posts unarchive and invalidates the projects query', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return new Response(JSON.stringify({ id: PROJECT_ID, archivedAt: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = client.invalidateQueries.bind(client);
    let invalidated = false;
    client.invalidateQueries = ((...args: Parameters<typeof invalidate>) => {
      invalidated = true;
      return invalidate(...args);
    }) as typeof client.invalidateQueries;

    const project = asLiveDetail({
      id: PROJECT_ID,
      name: '新询单仅询单完成样例',
      netAmount: '8000.00',
      rebateAmount: '0.00',
      overallStage: 'pre_publish',
      archivedAt: '2026-10-23T05:36:25.084049Z',
      currentStageNames: [],
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

    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ProjectListCard project={project} />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId('project-list-unarchive'));
    await waitFor(() => {
      expect(seen.some((row) => row.includes('POST') && row.includes('/unarchive'))).toBe(true);
    });
    expect(invalidated).toBe(true);
  });
});
