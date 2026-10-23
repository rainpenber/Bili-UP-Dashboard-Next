import { useQuery } from '@tanstack/react-query';
import {
  fetchCreator,
  fetchCreatorMetrics,
  fetchCreatorPublishEvents,
  fetchCreators,
  fetchDynamic,
  fetchDynamicMetrics,
  fetchDynamics,
  fetchVideo,
  fetchVideoMetrics,
  fetchVideos,
} from '@/api/monitor-client';
import type { MonitorTab } from '@/features/monitoring/monitor-url-state';

export const monitorQueryKeys = {
  videos: (page: number, category: string, q: string) =>
    ['monitor', 'videos', page, category, q] as const,
  creators: (page: number, q: string) => ['monitor', 'creators', page, q] as const,
  dynamics: (page: number, sort: string) => ['monitor', 'dynamics', page, sort] as const,
  metrics: (tab: MonitorTab, id: string | null) => ['monitor', 'metrics', tab, id] as const,
};

export function useVideosQuery(page: number, category: string, q: string, enabled: boolean) {
  return useQuery({
    queryKey: monitorQueryKeys.videos(page, category, q),
    queryFn: () => fetchVideos({ page, ...(category ? { category } : {}), ...(q ? { q } : {}) }),
    enabled,
  });
}

export function useCreatorsQuery(page: number, q: string, enabled: boolean) {
  return useQuery({
    queryKey: monitorQueryKeys.creators(page, q),
    queryFn: () => fetchCreators({ page, ...(q ? { q } : {}) }),
    enabled,
  });
}

export function useDynamicsQuery(
  page: number,
  enabled: boolean,
  sort: string = 'sampled_desc',
) {
  return useQuery({
    queryKey: monitorQueryKeys.dynamics(page, sort),
    queryFn: () => fetchDynamics({ page, sort }),
    enabled,
  });
}

export function useVideoDetailQuery(bvid: string) {
  return useQuery({
    queryKey: ['monitor', 'video', bvid] as const,
    queryFn: () => fetchVideo(bvid),
    enabled: Boolean(bvid),
    retry: (count, err) => {
      if (err instanceof Error && err.message === 'not found') return false;
      return count < 1;
    },
  });
}

export function useCreatorDetailQuery(mid: string) {
  return useQuery({
    queryKey: ['monitor', 'creator', mid] as const,
    queryFn: () => fetchCreator(mid),
    enabled: Boolean(mid),
    retry: (count, err) => {
      if (err instanceof Error && err.message === 'not found') return false;
      return count < 1;
    },
  });
}

export function useDynamicDetailQuery(dynamicId: string) {
  return useQuery({
    queryKey: ['monitor', 'dynamic', dynamicId] as const,
    queryFn: () => fetchDynamic(dynamicId),
    enabled: Boolean(dynamicId),
    retry: (count, err) => {
      if (err instanceof Error && err.message === 'not found') return false;
      return count < 1;
    },
  });
}

export function useVideoMetricsDetailQuery(bvid: string, enabled = true) {
  return useQuery({
    queryKey: ['monitor', 'video-metrics', bvid] as const,
    queryFn: () => fetchVideoMetrics(bvid),
    enabled: Boolean(bvid) && enabled,
  });
}

export function useCreatorMetricsDetailQuery(mid: string) {
  return useQuery({
    queryKey: ['monitor', 'creator-metrics', mid] as const,
    queryFn: () => fetchCreatorMetrics(mid),
    enabled: Boolean(mid),
  });
}

export function useCreatorPublishEventsQuery(mid: string) {
  return useQuery({
    queryKey: ['monitor', 'creator-publish-events', mid] as const,
    queryFn: () => fetchCreatorPublishEvents(mid),
    enabled: Boolean(mid),
  });
}

export function useDynamicMetricsDetailQuery(dynamicId: string) {
  return useQuery({
    queryKey: ['monitor', 'dynamic-metrics', dynamicId] as const,
    queryFn: () => fetchDynamicMetrics(dynamicId),
    enabled: Boolean(dynamicId),
  });
}

export function useEntityMetricsQuery(tab: MonitorTab, selected: string | null, enabled = true) {
  return useQuery({
    queryKey: monitorQueryKeys.metrics(tab, selected),
    enabled: enabled && Boolean(selected),
    queryFn: async () => {
      if (!selected) return null;
      if (tab === 'videos') {
        const data = await fetchVideoMetrics(selected);
        return { kind: 'video' as const, points: data.items };
      }
      if (tab === 'creators') {
        const data = await fetchCreatorMetrics(selected);
        return { kind: 'creator' as const, points: data.items };
      }
      const data = await fetchDynamicMetrics(selected);
      return { kind: 'dynamic' as const, points: data.items };
    },
  });
}
