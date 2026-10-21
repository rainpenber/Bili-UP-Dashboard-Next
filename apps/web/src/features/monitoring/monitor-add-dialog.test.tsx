import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { MonitorAddDialog } from '@/features/monitoring/monitor-add-dialog';

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function renderDialog(type: 'video' | 'creator' | 'dynamic') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const onCreated = { calls: [] as unknown[] };
  const view = render(
    <QueryClientProvider client={client}>
      <MonitorAddDialog
        open
        type={type}
        onOpenChange={() => undefined}
        onCreated={(result) => onCreated.calls.push(result)}
      />
    </QueryClientProvider>,
  );
  return { ...view, onCreated };
}

describe('MonitorAddDialog startAt', () => {
  test('hides planned start for non-video types', () => {
    renderDialog('creator');
    expect(screen.queryByTestId('monitor-add-start-at')).toBeNull();
    expect(screen.queryByLabelText('计划上线时间（可选）')).toBeNull();
    cleanup();
    renderDialog('dynamic');
    expect(screen.queryByTestId('monitor-add-start-at')).toBeNull();
  });

  test('video empty startAt omits the field from the create body', async () => {
    const posts: unknown[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/targets') && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              target: {
                id: '11111111-1111-4111-8111-111111111111',
                type: 'video',
                externalId: 'BV1xx411c7mD',
                label: 'BV1xx411c7mD',
                tags: [],
                enabled: true,
                intervalMinutes: 15,
                intervalMode: 'auto',
                startAt: null,
                nextRunAt: null,
                lastRunAt: null,
                lastSuccessAt: null,
                lastError: null,
                source: 'manual',
                createdAt: '2026-10-21T00:00:00.000Z',
                updatedAt: '2026-10-21T00:00:00.000Z',
                deletedAt: null,
              },
              created: true,
              code: 'created',
              message: '已添加监控项',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }) as typeof fetch;

    renderDialog('video');
    expect(screen.getByTestId('monitor-add-start-at')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('BV 号或视频长链接'), {
      target: { value: 'BV1xx411c7mD' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toMatchObject({ type: 'video', externalId: 'BV1xx411c7mD' });
    expect(Object.prototype.hasOwnProperty.call(posts[0], 'startAt')).toBe(false);
  });

  test('video with startAt posts offset ISO matching local civil time', async () => {
    const previous = process.env.TZ;
    process.env.TZ = 'Asia/Shanghai';
    const posts: unknown[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/targets') && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              target: {
                id: '11111111-1111-4111-8111-111111111111',
                type: 'video',
                externalId: 'BV1xx411c7mD',
                label: 'BV1xx411c7mD',
                tags: [],
                enabled: true,
                intervalMinutes: 15,
                intervalMode: 'auto',
                startAt: '2026-11-01T01:30:00.000Z',
                nextRunAt: '2026-11-01T01:30:00.000Z',
                lastRunAt: null,
                lastSuccessAt: null,
                lastError: null,
                source: 'manual',
                createdAt: '2026-10-21T00:00:00.000Z',
                updatedAt: '2026-10-21T00:00:00.000Z',
                deletedAt: null,
              },
              created: true,
              code: 'created',
              message: '已添加监控项',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }) as typeof fetch;

    try {
      renderDialog('video');
      fireEvent.change(screen.getByLabelText('BV 号或视频长链接'), {
        target: { value: 'BV1xx411c7mD' },
      });
      fireEvent.change(screen.getByTestId('monitor-add-start-at'), {
        target: { value: '2026-11-01T09:30' },
      });
      fireEvent.click(screen.getByRole('button', { name: '添加' }));
      await waitFor(() => expect(posts).toHaveLength(1));
      const body = posts[0] as { startAt: string };
      // serialize normalizes to UTC Z; instant must equal Shanghai 09:30.
      expect(body.startAt).toBe('2026-11-01T01:30:00.000Z');
      expect(Date.parse(body.startAt)).toBe(Date.parse('2026-11-01T09:30:00+08:00'));
    } finally {
      if (previous === undefined) delete process.env.TZ;
      else process.env.TZ = previous;
    }
  });
});
