import { useQuery } from '@tanstack/react-query';
import { fetchMonitorCard, fetchMonitorCards } from '@/api/monitor-cards-client';
import type { MonitorPresenceFilter } from '@/features/monitoring/monitor-url-state';

export function useMonitorCardsQuery(input: {
  type: 'video' | 'creator';
  page: number;
  monitor: MonitorPresenceFilter;
  q: string;
  category: string;
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
    ] as const,
    queryFn: () =>
      fetchMonitorCards({
        type: input.type,
        page: input.page,
        monitor: input.monitor,
        ...(input.q ? { q: input.q } : {}),
        ...(input.type === 'video' && input.category ? { category: input.category } : {}),
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
