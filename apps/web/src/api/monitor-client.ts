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

export type VideoDetail = {
  bvid: string;
  title: string | null;
  category: string | null;
  mid: string | null;
  monitoringEnabled: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  coverAssetId: string | null;
  metadata: Record<string, unknown>;
};

export type CreatorDetail = {
  mid: string;
  uname: string | null;
  category: string | null;
  monitoringEnabled: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  faceAssetId: string | null;
  metadata: Record<string, unknown>;
};

export type DynamicDetail = {
  dynamicId: string;
  mid: string | null;
  category: string | null;
  monitoringEnabled: boolean;
  archivedAt: string | null;
  deletedAt: string | null;
  metadata: Record<string, unknown>;
};

export function fetchVideo(bvid: string): Promise<VideoDetail> {
  return getJson(`/videos/${encodeURIComponent(bvid)}`);
}

export function fetchCreator(mid: string): Promise<CreatorDetail> {
  return getJson(`/creators/${encodeURIComponent(mid)}`);
}

export function fetchDynamic(dynamicId: string): Promise<DynamicDetail> {
  return getJson(`/dynamics/${encodeURIComponent(dynamicId)}`);
}

export { formatMetricCount as formatCount } from '@/lib/format-compact-number';

export function coverAssetUrl(coverAssetId: string | null): string {
  if (coverAssetId) return `/api/v1/assets/${encodeURIComponent(coverAssetId)}`;
  return '/api/v1/assets/__placeholder__';
}
