import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { rollbackCommercialNode } from './commercial-api';
import { WriteFeedbackBanner } from './components/write-feedback-banner';
import { useCommercialWrites } from './use-commercial-queries';

const PROJECT = 'f0010001-0001-4001-8001-000000000009';
const NODE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN = '2026-05-20T12:00:00.123456Z';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(globalThis, 'fetch');
});

function Harness() {
  const writes = useCommercialWrites(PROJECT);
  return (
    <div>
      <button
        type="button"
        onClick={() => void writes.run(() => rollbackCommercialNode(PROJECT, NODE, TOKEN))}
      >
        回退
      </button>
      <WriteFeedbackBanner feedback={writes.feedback} />
    </div>
  );
}

function renderHarness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

describe('commercial write feedback', () => {
  test('a refusal shows the server message and the offending names', async () => {
    const bodies: unknown[] = [];
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({
          error: '无法回退，后续节点已推进：审核',
          code: 'successors_advanced',
          names: ['审核'],
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: '回退' }));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-action-error').textContent).toContain(
        '无法回退，后续节点已推进：审核',
      );
    });
    expect(screen.getByTestId('workflow-action-error-names').textContent).toContain('审核');
    expect(bodies).toEqual([{ expectedUpdatedAt: TOKEN }]);
  });

  test('a stale token refetches once and does not send the write again', async () => {
    let posts = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') posts += 1;
      return new Response(
        JSON.stringify({
          error: '并发令牌已过期，请按最近一次读取的 updatedAt 重试',
          code: 'stale_write',
        }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    renderHarness();
    fireEvent.click(screen.getByRole('button', { name: '回退' }));
    await waitFor(() => {
      expect(screen.getByTestId('workflow-stale-notice').textContent).toContain('页面已重新加载');
    });
    expect(screen.getByTestId('workflow-stale-notice').textContent).toContain(
      '不会用新的令牌自动重试',
    );
    expect(posts).toBe(1);
  });
});
