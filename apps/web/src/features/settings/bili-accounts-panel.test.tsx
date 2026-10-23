import { afterEach, describe, expect, test } from 'bun:test';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { BiliAccountsPanel } from '@/features/settings/bili-accounts-panel';

const ACCOUNT = {
  id: '11111111-1111-4111-8111-111111111111',
  mid: '900001',
  uname: '测试号',
  status: 'active' as const,
  isDefault: true,
  cookieExpiresAt: '2026-12-01T00:00:00.000Z',
  lastVerifiedAt: null,
  lastUsedAt: null,
  note: 'n1',
  secretPresent: true,
  derivedExpiryState: 'ok' as const,
  revokedAt: null,
};

function wrap(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{node}</QueryClientProvider>;
}

describe('bili accounts panel', () => {
  afterEach(() => {
    cleanup();
    // @ts-expect-error test stub
    globalThis.fetch = undefined;
  });

  test('lists status, disables verify in mock, and confirms revoke', async () => {
    const calls: { url: string; method?: string }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const entry: { url: string; method?: string } = { url };
      if (init?.method) entry.method = init.method;
      calls.push(entry);
      if (url.includes('/api/v1/accounts') && (!init || init.method === 'GET' || !init.method)) {
        return new Response(JSON.stringify({ items: [ACCOUNT], realAccessEnabled: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/api/v1/accounts/') && init?.method === 'DELETE') {
        return new Response(
          JSON.stringify({
            account: {
              ...ACCOUNT,
              status: 'revoked',
              secretPresent: false,
              derivedExpiryState: 'revoked',
              isDefault: false,
              revokedAt: '2026-10-23T00:00:00.000Z',
            },
            noDefaultRemaining: true,
            message: '账号已撤销并删除凭据；当前没有默认采集账号',
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ error: 'unexpected' }), { status: 500 });
    }) as typeof fetch;

    render(wrap(<BiliAccountsPanel />));
    expect(await screen.findByTestId('bili-account-uname')).toBeTruthy();
    expect(screen.getByTestId('bili-account-status').textContent).toContain('正常');
    expect(screen.getByTestId('bili-account-default')).toBeTruthy();
    expect(screen.getByTestId('bili-accounts-verify-disabled-hint').textContent).toContain('mock');
    const verify = screen.getByTestId('bili-account-verify') as HTMLButtonElement;
    expect(verify.disabled).toBe(true);

    fireEvent.click(screen.getByTestId('bili-account-revoke'));
    expect(await screen.findByTestId('bili-account-revoke-dialog')).toBeTruthy();
    fireEvent.click(screen.getByTestId('bili-account-revoke-confirm'));
    await waitFor(() => {
      expect(calls.some((call) => call.method === 'DELETE')).toBe(true);
    });
    expect(await screen.findByTestId('bili-accounts-message')).toBeTruthy();
  });

  test('empty state and create submit', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v1/accounts') && (!init || !init.method || init.method === 'GET')) {
        return new Response(JSON.stringify({ items: [], realAccessEnabled: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body ?? '{}')) as { cookie?: string };
        expect(JSON.stringify(body)).toContain('cookie');
        return new Response(JSON.stringify({ ...ACCOUNT, isDefault: true }), {
          status: 201,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response('{}', { status: 500 });
    }) as typeof fetch;

    render(wrap(<BiliAccountsPanel />));
    expect(await screen.findByTestId('bili-accounts-empty')).toBeTruthy();
    fireEvent.change(screen.getByTestId('bili-account-cookie-input'), {
      target: { value: 'SESSDATA=x; DedeUserID=900001' },
    });
    fireEvent.click(screen.getByTestId('bili-account-create-submit'));
    expect(await screen.findByTestId('bili-accounts-message')).toBeTruthy();
  });
});
