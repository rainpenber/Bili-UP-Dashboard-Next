import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchMonitorCard, fetchMonitorCards, pinMonitorVideo } from '@/api/monitor-cards-client';
import type {
  MonitorPresenceFilter,
  MonitorVideoSort,
} from '@/features/monitoring/monitor-url-state';

export function useMonitorCardsQuery(input: {
  type: 'video' | 'creator';
  page: number;
  monitor: MonitorPresenceFilter;
  q: string;
  category: string;
  sort?: MonitorVideoSort;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: [
      'monitor',
      'cards',
      input.type,
      input.page,
      input.monitor,
      input.q,
      input.category,
      input.type === 'video' ? (input.sort ?? 'published_desc') : null,
    ] as const,
    queryFn: () =>
      fetchMonitorCards({
        type: input.type,
        page: input.page,
        monitor: input.monitor,
        ...(input.q ? { q: input.q } : {}),
        ...(input.type === 'video' && input.category ? { category: input.category } : {}),
        ...(input.type === 'video' && input.sort ? { sort: input.sort } : {}),
      }),
    enabled: input.enabled,
  });
}

export function useMonitorCardQuery(type: 'video' | 'creator', externalId: string) {
  return useQuery({
    queryKey: ['monitor', 'card', type, externalId] as const,
    queryFn: () => fetchMonitorCard(type, externalId),
    enabled: Boolean(externalId),
    retry: (count, err) => {
      if (err instanceof Error && (err.message.includes('未找到') || err.message === 'not found')) {
        return false;
      }
      return count < 1;
    },
  });
}

export function usePinVideoMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { bvid: string; pinned: boolean }) =>
      pinMonitorVideo(input.bvid, input.pinned),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['monitor'] });
    },
  });
}
