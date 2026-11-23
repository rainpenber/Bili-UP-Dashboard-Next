import { useQuery } from '@tanstack/react-query';
import {
  fetchCommercialRebates,
  fetchLiveProjectDetail,
  fetchLiveProjectList,
} from './commercial-live-api';
import { revenueMonthMetrics } from './revenue-metrics';

export const commercialRebatesKey = ['commercial', 'rebates'] as const;

export function useCommercialRebatesQuery() {
  return useQuery({
    queryKey: commercialRebatesKey,
    queryFn: fetchCommercialRebates,
    retry: false,
  });
}

export function useRevenueMonthQuery(now: Date) {
  return useQuery({
    queryKey: ['commercial', 'revenue-month', now.toISOString().slice(0, 7)],
    queryFn: async () => {
      const list = await fetchLiveProjectList({ includeArchived: true });
      const results = await Promise.allSettled(
        list.items.map((item) => fetchLiveProjectDetail(item.id)),
      );
      const details = results.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      );
      return revenueMonthMetrics(details, now);
    },
    retry: false,
  });
}
