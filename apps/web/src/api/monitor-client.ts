import type {
  CreatorListItem,
  DynamicListItem,
  Paginated,
  VideoListItem,
  VideoMetricPoint,
  CreatorMetricPoint,
  DynamicMetricPoint,
} from '@studio/contracts';

const API_BASE = import.meta.env.VITE_MONITOR_API_BASE ?? '/api/v1/monitor';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchVideos(params: {
  page: number;
  category?: string;
  q?: string;
}): Promise<Paginated<VideoListItem>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: '8' });
  if (params.category) qs.set('category', params.category);
  if (params.q) qs.set('q', params.q);
  return getJson(`/videos?${qs}`);
}

export function fetchVideoMetrics(bvid: string): Promise<{ items: VideoMetricPoint[] }> {
  return getJson(`/videos/${encodeURIComponent(bvid)}/metrics?limit=500`);
}

export function fetchCreators(params: {
  page: number;
  q?: string;
}): Promise<Paginated<CreatorListItem>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: '8' });
  if (params.q) qs.set('q', params.q);
  return getJson(`/creators?${qs}`);
}

export function fetchCreatorMetrics(mid: string): Promise<{ items: CreatorMetricPoint[] }> {
  return getJson(`/creators/${encodeURIComponent(mid)}/metrics?limit=500`);
}

export function fetchDynamics(params: { page: number }): Promise<Paginated<DynamicListItem>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: '8' });
  return getJson(`/dynamics?${qs}`);
}

export function fetchDynamicMetrics(id: string): Promise<{ items: DynamicMetricPoint[] }> {
  return getJson(`/dynamics/${encodeURIComponent(id)}/metrics?limit=500`);
}

export function formatCount(value: string | null | undefined, rawLower?: string | null): string {
  if (rawLower) return `${rawLower} (下界)`;
  if (value === null || value === undefined) return '—';
  return value;
}

export function coverAssetUrl(coverAssetId: string | null): string {
  if (coverAssetId) return `/api/v1/assets/${encodeURIComponent(coverAssetId)}`;
  return '/api/v1/assets/__placeholder__';
}
