import type {
  CreatorDiscoveryConfig,
  CreatorDiscoveryConfigPutRequest,
  CreatorListItem,
  CreatorPublishEvent,
  CreatorUploadsSyncResponse,
  CreatorUploadsSyncStatus,
  CreatorVideoList,
  DynamicListItem,
  DynamicTargetRef,
  ManualPublishEventCreateRequest,
  ManualPublishEventCreateResponse,
  Paginated,
  VideoDetail,
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

async function putJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function deleteOk(path: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, { method: 'DELETE' });
  if (res.status === 204) return;
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `HTTP ${res.status}`);
  }
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

export function fetchCreatorDiscovery(mid: string): Promise<CreatorDiscoveryConfig> {
  return getJson(`/creators/${encodeURIComponent(mid)}/discovery`);
}

export function putCreatorDiscovery(
  mid: string,
  body: CreatorDiscoveryConfigPutRequest,
): Promise<CreatorDiscoveryConfig> {
  return putJson(`/creators/${encodeURIComponent(mid)}/discovery`, body);
}

export function fetchCreatorPublishEvents(
  mid: string,
  params: { pageSize?: number } = {},
): Promise<Paginated<CreatorPublishEvent>> {
  const qs = new URLSearchParams({
    page: '1',
    pageSize: String(params.pageSize ?? 200),
  });
  return getJson(`/creators/${encodeURIComponent(mid)}/publish-events?${qs}`);
}

export function createManualPublishEvent(
  mid: string,
  body: ManualPublishEventCreateRequest,
): Promise<ManualPublishEventCreateResponse> {
  return postJson(`/creators/${encodeURIComponent(mid)}/publish-events`, body);
}

export function deleteManualPublishEvent(mid: string, eventId: string): Promise<void> {
  return deleteOk(
    `/creators/${encodeURIComponent(mid)}/publish-events/${encodeURIComponent(eventId)}`,
  );
}

export function fetchCreatorUploadsSyncStatus(mid: string): Promise<CreatorUploadsSyncStatus> {
  return getJson(`/creators/${encodeURIComponent(mid)}/uploads/sync`);
}

export function syncCreatorUploads(
  mid: string,
  options: { force?: boolean } = {},
): Promise<CreatorUploadsSyncResponse> {
  return postJson(`/creators/${encodeURIComponent(mid)}/uploads/sync`, {
    force: options.force === true,
  });
}

export function fetchCreatorVideos(
  mid: string,
  params: { limit?: number; offset?: number } = {},
): Promise<CreatorVideoList> {
  const qs = new URLSearchParams();
  if (params.limit != null) qs.set('limit', String(params.limit));
  if (params.offset != null) qs.set('offset', String(params.offset));
  const query = qs.toString();
  return getJson(`/creators/${encodeURIComponent(mid)}/videos${query ? `?${query}` : ''}`);
}

export function fetchDynamics(params: {
  page: number;
  sort?: string;
}): Promise<Paginated<DynamicListItem>> {
  const qs = new URLSearchParams({ page: String(params.page), pageSize: '8' });
  if (params.sort) qs.set('sort', params.sort);
  return getJson(`/dynamics?${qs}`);
}

export function fetchDynamicMetrics(id: string): Promise<{ items: DynamicMetricPoint[] }> {
  return getJson(`/dynamics/${encodeURIComponent(id)}/metrics?limit=500`);
}

export type { VideoDetail };

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
  target: DynamicTargetRef | null;
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
