import {
  parseMonitorCard,
  parseMonitorCardList,
  parsePinEntityResponse,
  parsePinVideoResponse,
  type MonitorCard,
  type MonitorCardSort,
  type Paginated,
  type PinEntityResponse,
  type PinVideoResponse,
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

export function fetchMonitorCards(
  params: {
    type: 'video' | 'creator';
    page: number;
    monitor: 'all' | 'active' | 'paused' | 'unmonitored';
    q?: string;
    category?: string;
    sort?: MonitorCardSort;
    onlyMine?: boolean;
  },
  init?: { signal?: AbortSignal },
): Promise<Paginated<MonitorCard>> {
  const qs = new URLSearchParams({
    type: params.type,
    page: String(params.page),
    pageSize: '8',
    monitor: params.monitor,
  });
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  if (params.sort) qs.set('sort', params.sort);
  if (params.type === 'video' && params.onlyMine) qs.set('onlyMine', '1');
  return requestJson(
    `/cards?${qs.toString()}`,
    init?.signal ? { signal: init.signal } : undefined,
  ).then(parseMonitorCardList);
}

export function fetchMonitorCard(
  type: 'video' | 'creator',
  externalId: string,
): Promise<MonitorCard> {
  return requestJson(`/cards/${encodeURIComponent(type)}/${encodeURIComponent(externalId)}`).then(
    parseMonitorCard,
  );
}

export function pinMonitorVideo(bvid: string, pinned: boolean): Promise<PinVideoResponse> {
  return requestJson(`/videos/${encodeURIComponent(bvid)}/pin`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pinned }),
  }).then(parsePinVideoResponse);
}

export function pinMonitorCreator(mid: string, pinned: boolean): Promise<PinEntityResponse> {
  return requestJson(`/creators/${encodeURIComponent(mid)}/pin`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pinned }),
  }).then(parsePinEntityResponse);
}

export function pinMonitorDynamic(
  dynamicId: string,
  pinned: boolean,
): Promise<PinEntityResponse> {
  return requestJson(`/dynamics/${encodeURIComponent(dynamicId)}/pin`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ pinned }),
  }).then(parsePinEntityResponse);
}
