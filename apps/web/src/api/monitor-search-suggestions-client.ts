import {
  parseMonitorSearchSuggestionsResponse,
  type MonitorSearchSuggestionType,
  type MonitorSearchSuggestionsResponse,
} from '@studio/contracts';
import { MonitorRequestError } from '@/api/monitor-targets-client';

const API_BASE = import.meta.env.VITE_MONITOR_API_BASE ?? '/api/v1/monitor';

export function fetchMonitorSearchSuggestions(
  params: { q: string; type: MonitorSearchSuggestionType; limit?: number },
  init?: { signal?: AbortSignal },
): Promise<MonitorSearchSuggestionsResponse> {
  const qs = new URLSearchParams({
    type: params.type,
    q: params.q,
  });
  if (params.limit != null) qs.set('limit', String(params.limit));
  return fetch(
    `${API_BASE}/search-suggestions?${qs.toString()}`,
    init?.signal ? { signal: init.signal } : undefined,
  ).then(async (res) => {
    const body = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
    if (!res.ok) {
      throw new MonitorRequestError(
        body.error ?? `HTTP ${res.status}`,
        res.status,
        body.code ?? null,
      );
    }
    return parseMonitorSearchSuggestionsResponse(body);
  });
}
