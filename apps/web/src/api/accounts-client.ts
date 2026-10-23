import {
  parseBiliAccountListItem,
  parseBiliAccountListResponse,
  parseRevokeBiliAccountResponse,
  parseVerifyBiliAccountResponse,
  type BiliAccountListItem,
  type BiliAccountListResponse,
  type CreateBiliAccountRequest,
  type PatchBiliAccountRequest,
  type RevokeBiliAccountResponse,
  type VerifyBiliAccountResponse,
} from '@studio/contracts';
import { MonitorRequestError } from '@/api/monitor-targets-client';

const API_BASE = import.meta.env.VITE_ACCOUNTS_API_BASE ?? '/api/v1/accounts';

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

export function fetchBiliAccounts(): Promise<BiliAccountListResponse> {
  return requestJson('').then(parseBiliAccountListResponse);
}

export function createBiliAccount(input: CreateBiliAccountRequest): Promise<BiliAccountListItem> {
  return requestJson('', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseBiliAccountListItem);
}

export function patchBiliAccount(
  id: string,
  input: PatchBiliAccountRequest,
): Promise<BiliAccountListItem> {
  return requestJson(`/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  }).then(parseBiliAccountListItem);
}

export function revokeBiliAccount(id: string): Promise<RevokeBiliAccountResponse> {
  return requestJson(`/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
    parseRevokeBiliAccountResponse,
  );
}

export function verifyBiliAccount(id: string): Promise<VerifyBiliAccountResponse> {
  return requestJson(`/${encodeURIComponent(id)}/verify`, { method: 'POST' }).then(
    parseVerifyBiliAccountResponse,
  );
}
