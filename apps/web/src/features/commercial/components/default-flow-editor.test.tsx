import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { DefaultFlowEditor } from './default-flow-editor';

const TEMPLATE = {
  id: 'ffff1111-1111-4111-8111-111111111111',
  slug: 'default_sponsorship',
  name: '商单默认流程',
  version: 1,
  publishedAt: '2026-04-01T00:00:00.000Z',
  nodes: [
    {
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddd001',
      slug: 'inquiry',
      name: '询单',
      kind: 'stage',
      isOptional: false,
    },
    {
      id: 'dddddddd-dddd-4ddd-8ddd-ddddddddd002',
      slug: 'outline',
      name: '大纲',
      kind: 'stage',
      isOptional: false,
    },
  ],
  edges: [
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeee01',
      fromNodeId: 'dddddddd-dddd-4ddd-8ddd-ddddddddd001',
      toNodeId: 'dddddddd-dddd-4ddd-8ddd-ddddddddd002',
    },
  ],
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(globalThis, 'fetch');
});

describe('default flow page', () => {
  test('renders the published template and says editing is not wired', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(TEMPLATE), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={client}>
        <div style={{ width: 1280, height: 900 }}>
          <DefaultFlowEditor />
        </div>
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('default-flow-readonly-notice').textContent).toContain('只读');
    });
    expect(screen.getByTestId('default-flow-readonly-notice').textContent).toContain(
      '还没有接到后端',
    );
    expect(screen.getByTestId('default-flow-version').textContent).toContain('default_sponsorship');
    await waitFor(() => {
      expect(container.querySelector('[data-workflow-node]')).toBeTruthy();
    });
    expect(screen.queryByTestId('workflow-add-node')).toBeNull();
    expect(screen.queryByTestId('default-flow-publish')).toBeNull();
    expect(screen.queryByTestId('default-flow-save-draft')).toBeNull();
  });
});
