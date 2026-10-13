import { useQuery } from '@tanstack/react-query';
import {
  fetchCreatorMetrics,
  fetchCreators,
  fetchDynamicMetrics,
  fetchDynamics,
  fetchVideoMetrics,
  fetchVideos,
} from '@/api/monitor-client';
import type { MonitorTab } from '@/features/monitoring/monitor-url-state';

export const monitorQueryKeys = {
  videos: (page: number, category: string, q: string) =>
    ['monitor', 'videos', page, category, q] as const,
  creators: (page: number, q: string) => ['monitor', 'creators', page, q] as const,
  dynamics: (page: number) => ['monitor', 'dynamics', page] as const,
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

export function useDynamicsQuery(page: number, enabled: boolean) {
  return useQuery({
    queryKey: monitorQueryKeys.dynamics(page),
    queryFn: () => fetchDynamics({ page }),
    enabled,
  });
}

export function useEntityMetricsQuery(tab: MonitorTab, selected: string | null) {
  return useQuery({
    queryKey: monitorQueryKeys.metrics(tab, selected),
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
    enabled: Boolean(selected),
  });
}
