import { useQuery } from '@tanstack/react-query';
import { fetchMonitorSearchSuggestions } from '@/api/monitor-search-suggestions-client';
import type { MonitorSearchSuggestionType } from '@studio/contracts';

export function useMonitorSearchSuggestionsQuery(input: {
  q: string;
  type: MonitorSearchSuggestionType;
  enabled: boolean;
}) {
  const q = input.q.trim();
  return useQuery({
    queryKey: ['monitor', 'search-suggestions', input.type, q] as const,
    queryFn: ({ signal }) =>
      fetchMonitorSearchSuggestions({ q, type: input.type, limit: 5 }, { signal }),
    enabled: input.enabled && q.length > 0,
    placeholderData: (previous) => previous,
  });
}
