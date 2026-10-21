import {
  parseMonitorCard,
  parseMonitorCardList,
  type MonitorCard,
  type Paginated,
} from '@studio/contracts';
import { MonitorRequestError } from '@/api/monitor-targets-client';

const API_BASE = import.meta.env.VITE_MONITOR_API_BASE ?? '/api/v1/monitor';

async function requestJson(path: string): Promise<unknown> {
  const res = await fetch(`${API_BASE}${path}`);
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

export function fetchMonitorCards(params: {
  type: 'video' | 'creator';
  page: number;
  monitor: 'all' | 'active' | 'paused' | 'unmonitored';
  q?: string;
  category?: string;
}): Promise<Paginated<MonitorCard>> {
  const qs = new URLSearchParams({
    type: params.type,
    page: String(params.page),
    pageSize: '8',
    monitor: params.monitor,
  });
  if (params.q) qs.set('q', params.q);
  if (params.category) qs.set('category', params.category);
  return requestJson(`/cards?${qs.toString()}`).then(parseMonitorCardList);
}

export function fetchMonitorCard(
  type: 'video' | 'creator',
  externalId: string,
): Promise<MonitorCard> {
  return requestJson(`/cards/${encodeURIComponent(type)}/${encodeURIComponent(externalId)}`).then(
    parseMonitorCard,
  );
}
