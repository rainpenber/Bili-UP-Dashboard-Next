import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import type { MonitorCard } from '@studio/contracts';
import {
  MonitorSettingsDialog,
  canRescheduleMonitorStartAt,
  rescheduleStartAtBlockedReason,
} from '@/features/monitoring/monitor-settings-dialog';
import { MonitorCardControls } from '@/features/monitoring/monitor-object-card';
import { MemoryRouter } from 'react-router-dom';

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});

function baseCard(
  patch: Partial<MonitorCard> = {},
  targetPatch: Record<string, unknown> = {},
): MonitorCard {
  return {
    type: 'video',
    externalId: 'BV1xx411c7mD',
    title: '计划视频',
    category: '游戏',
    imageAssetId: null,
    imageUrl: null,
    imageProxyUrl: null,
    mid: null,
    displayName: '计划视频',
    hasEntity: true,
    hasSamples: false,
    pinned: false,
    monitorState: 'active',
    execution: 'waiting',
    target: {
      id: '11111111-1111-4111-8111-111111111111',
      label: '计划视频',
      tags: [],
      enabled: true,
      intervalMinutes: 15,
      intervalMode: 'auto',
      startAt: null,
      nextRunAt: '2026-11-01T01:30:00.000Z',
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: null,
      ...targetPatch,
    },
    projects: [],
    latest: {
      sampledAt: null,
      viewCount: null,
      onlineViewers: null,
      onlineViewersRaw: null,
      likeCount: null,
      followerCount: null,
    },
    ...patch,
  } as MonitorCard;
}

describe('monitor startAt display and reschedule', () => {
  test('details show unset and set states; card face stays free of startAt', () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const wrap = (card: MonitorCard) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <MonitorCardControls card={card} listQuery="" layout="detail" includeDetailLink={false} />
        </MemoryRouter>
      </QueryClientProvider>
    );

    render(wrap(baseCard()));
    expect(screen.getByTestId('monitor-card-controls').textContent).not.toContain('计划开始');
    fireEvent.click(screen.getByRole('button', { name: '监控详情' }));
    expect(screen.getByTestId('monitor-start-at-details').textContent).toBe(
      '计划开始：未设置（立即开始）',
    );

    cleanup();
    render(wrap(baseCard({}, { startAt: '2026-11-01T01:30:00.000Z' })));
    expect(screen.getByTestId('monitor-card-controls').textContent).not.toContain('计划开始');
    fireEvent.click(screen.getByRole('button', { name: '监控详情' }));
    expect(screen.getByTestId('monitor-start-at-details').textContent).toContain('计划开始：');
    expect(screen.getByTestId('monitor-start-at-details').textContent).not.toContain('未设置');
  });

  test('settings allow reschedule before first success and block after', async () => {
    const patches: unknown[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') {
        patches.push(JSON.parse(String(init.body)));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              target: {
                id: '11111111-1111-4111-8111-111111111111',
                type: 'video',
                externalId: 'BV1xx411c7mD',
                label: '计划视频',
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
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ),
        );
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }) as typeof fetch;

    const pending = baseCard();
    expect(canRescheduleMonitorStartAt(pending)).toBe(true);
    expect(rescheduleStartAtBlockedReason(pending)).toBeNull();

    const expectedUtc = new Date(2026, 10, 1, 9, 30, 0).toISOString();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MonitorSettingsDialog card={pending} open onOpenChange={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.getByTestId('monitor-settings-start-at-display').textContent).toBe(
      '未设置（立即开始）',
    );
    fireEvent.change(screen.getByTestId('monitor-settings-start-at-input'), {
      target: { value: '2026-11-01T09:30' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toMatchObject({ startAt: expectedUtc });

    cleanup();
    const started = baseCard(
      { execution: 'waiting' },
      { lastSuccessAt: '2026-10-20T00:00:00.000Z' },
    );
    expect(canRescheduleMonitorStartAt(started)).toBe(false);
    expect(rescheduleStartAtBlockedReason(started)).toContain('已开始采集');
    render(
      <QueryClientProvider client={client}>
        <MonitorSettingsDialog card={started} open onOpenChange={() => undefined} />
      </QueryClientProvider>,
    );
    expect(screen.queryByTestId('monitor-settings-start-at-input')).toBeNull();
    expect(screen.getByTestId('monitor-settings-start-at-blocked').textContent).toContain(
      '已开始采集',
    );

    const running = baseCard({ execution: 'running' }, { lastSuccessAt: null });
    expect(canRescheduleMonitorStartAt(running)).toBe(false);
    expect(rescheduleStartAtBlockedReason(running)).toContain('正在采集');
  });
});
