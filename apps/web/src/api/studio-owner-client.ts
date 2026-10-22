import {
  parseStudioOwnerAccount,
  type StudioOwnerAccount,
  type UpdateStudioOwnerAccountRequest,
} from '@studio/contracts';
import { MonitorRequestError } from '@/api/monitor-targets-client';

const API_BASE = import.meta.env.VITE_MONITOR_API_BASE ?? '/api/v1/monitor';

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`, init);
  const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
  if (!res.ok) {
    throw new MonitorRequestError(
      body.error ?? `HTTP ${res.status}`,
      res.status,
      body.code ?? null,
    );
  }
  return body;
}

export function fetchStudioOwnerAccount(): Promise<StudioOwnerAccount> {
  return requestJson('/settings/owner-account').then(parseStudioOwnerAccount);
}

export function updateStudioOwnerAccount(
  input: UpdateStudioOwnerAccountRequest,
): Promise<StudioOwnerAccount> {
  return requestJson('/settings/owner-account', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseStudioOwnerAccount);
}
