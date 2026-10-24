import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchStudioOwnerAccount, updateStudioOwnerAccount } from '@/api/studio-owner-client';
import type { UpdateStudioOwnerAccountRequest } from '@studio/contracts';

export const studioOwnerQueryKey = ['monitor', 'settings', 'owner-account'] as const;

export function useStudioOwnerAccountQuery(enabled = true) {
  return useQuery({
    queryKey: studioOwnerQueryKey,
    queryFn: fetchStudioOwnerAccount,
    enabled,
    retry: (count, err) => {
      if (err instanceof Error && err.message.includes('尚未配置')) return false;
      return count < 1;
    },
  });
}

export function useUpdateStudioOwnerAccountMutation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateStudioOwnerAccountRequest) => updateStudioOwnerAccount(input),
    onSuccess: async (data) => {
      client.setQueryData(studioOwnerQueryKey, data);
      // Owner mid change must refresh「只看我的」list totals/pages.
      await client.invalidateQueries({ queryKey: ['monitor', 'cards'] });
    },
  });
}
