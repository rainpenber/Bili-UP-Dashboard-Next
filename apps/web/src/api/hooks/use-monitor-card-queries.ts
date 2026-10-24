import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchMonitorCard,
  fetchMonitorCards,
  pinMonitorCreator,
  pinMonitorDynamic,
  pinMonitorVideo,
} from '@/api/monitor-cards-client';
import type { MonitorPresenceFilter } from '@/features/monitoring/monitor-url-state';
import type { MonitorCardSort } from '@studio/contracts';

export function useMonitorCardsQuery(input: {
  type: 'video' | 'creator';
  page: number;
  monitor: MonitorPresenceFilter;
  q: string;
  category: string;
  sort?: MonitorCardSort;
  onlyMine?: boolean;
  enabled: boolean;
}) {
  const defaultSort = input.type === 'video' ? 'published_desc' : 'sampled_desc';
  return useQuery({
    queryKey: [
      'monitor',
      'cards',
      input.type,
      input.page,
      input.monitor,
      input.q,
      input.category,
      input.sort ?? defaultSort,
      input.type === 'video' ? Boolean(input.onlyMine) : false,
    ] as const,
    queryFn: ({ signal }) =>
      fetchMonitorCards(
        {
          type: input.type,
          page: input.page,
          monitor: input.monitor,
          ...(input.q ? { q: input.q } : {}),
          ...(input.type === 'video' && input.category ? { category: input.category } : {}),
          ...(input.sort ? { sort: input.sort } : {}),
          ...(input.type === 'video' && input.onlyMine ? { onlyMine: true } : {}),
        },
        { signal },
      ),
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
    mutationFn: (input: { id: string; pinned: boolean } | { bvid: string; pinned: boolean }) => {
      const bvid = 'bvid' in input ? input.bvid : input.id;
      return pinMonitorVideo(bvid, input.pinned);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['monitor'] });
    },
  });
}

export function usePinCreatorMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; pinned: boolean }) =>
      pinMonitorCreator(input.id, input.pinned),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['monitor'] });
    },
  });
}

export function usePinDynamicMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; pinned: boolean }) =>
      pinMonitorDynamic(input.id, input.pinned),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['monitor'] });
    },
  });
}
