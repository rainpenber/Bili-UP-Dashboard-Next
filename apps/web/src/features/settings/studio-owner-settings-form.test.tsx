import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, test } from 'bun:test';
import { StudioOwnerSettingsForm } from '@/features/settings/studio-owner-settings-form';

afterEach(() => {
  cleanup();
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  return client;
}

describe('studio owner settings form', () => {
  test('loads default, validates empty, saves and invalidates cards', async () => {
    let putBody: unknown = null;
    const cardInvalidations: string[] = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/settings/owner-account') && (!init || init.method === 'GET')) {
        return Promise.resolve(
          jsonResponse({
            mid: '3493141386627335',
            displayName: '狐正正',
            updatedAt: '2026-10-22T00:00:00.000Z',
          }),
        );
      }
      if (url.includes('/settings/owner-account') && init?.method === 'PUT') {
        putBody = JSON.parse(String(init.body));
        return Promise.resolve(
          jsonResponse({
            mid: '3000000000000003',
            displayName: '测试号',
            updatedAt: '2026-10-22T01:00:00.000Z',
          }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;

    const client = wrap(<StudioOwnerSettingsForm />);
    const originalInvalidate = client.invalidateQueries.bind(client);
    client.invalidateQueries = ((filters, options) => {
      cardInvalidations.push(JSON.stringify(filters));
      return originalInvalidate(filters, options);
    }) as typeof client.invalidateQueries;

    expect(await screen.findByTestId('studio-owner-mid')).toBeTruthy();
    await waitFor(() => {
      expect((screen.getByTestId('studio-owner-mid') as HTMLInputElement).value).toBe(
        '3493141386627335',
      );
    });
    expect((screen.getByTestId('studio-owner-display-name') as HTMLInputElement).value).toBe(
      '狐正正',
    );

    fireEvent.change(screen.getByTestId('studio-owner-mid'), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('studio-owner-save'));
    expect(await screen.findByTestId('studio-owner-error')).toBeTruthy();

    fireEvent.change(screen.getByTestId('studio-owner-mid'), {
      target: { value: '3000000000000003' },
    });
    fireEvent.change(screen.getByTestId('studio-owner-display-name'), {
      target: { value: '测试号' },
    });
    fireEvent.click(screen.getByTestId('studio-owner-save'));

    await waitFor(() => {
      expect(putBody).toEqual({ mid: '3000000000000003', displayName: '测试号' });
    });
    expect(await screen.findByTestId('studio-owner-saved')).toBeTruthy();
    expect(cardInvalidations.some((item) => item.includes('cards'))).toBe(true);
  });

  test('surfaces server validation error', async () => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/settings/owner-account') && (!init || init.method === 'GET')) {
        return Promise.resolve(
          jsonResponse({
            mid: '3493141386627335',
            displayName: '狐正正',
            updatedAt: '2026-10-22T00:00:00.000Z',
          }),
        );
      }
      if (init?.method === 'PUT') {
        return Promise.resolve(
          jsonResponse({ error: 'UID 格式不正确', code: 'invalid_owner_mid' }, 400),
        );
      }
      return Promise.resolve(jsonResponse({}));
    }) as typeof fetch;

    wrap(<StudioOwnerSettingsForm />);
    await screen.findByTestId('studio-owner-mid');
    fireEvent.change(screen.getByTestId('studio-owner-mid'), { target: { value: '01' } });
    fireEvent.click(screen.getByTestId('studio-owner-save'));
    expect(await screen.findByText('UID 格式不正确')).toBeTruthy();
  });
});
