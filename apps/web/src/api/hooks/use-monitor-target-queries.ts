import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMonitorTarget,
  deleteMonitorTarget,
  fetchMonitorTargetByIdentity,
  fetchMonitorTargets,
  patchMonitorTarget,
  runMonitorTarget,
} from '@/api/monitor-targets-client';
import type { MonitorTargetPatchRequest, MonitorTargetType } from '@studio/contracts';

export const monitorTargetKeys = {
  targets: (page: number) => ['monitor', 'targets', page] as const,
  byIdentity: (type: MonitorTargetType, externalId: string) =>
    ['monitor', 'target', type, externalId] as const,
};

export function useMonitorTargetsQuery(page: number, enabled: boolean) {
  return useQuery({
    queryKey: monitorTargetKeys.targets(page),
    queryFn: () => fetchMonitorTargets(page),
    enabled,
    refetchInterval: enabled ? 4000 : false,
  });
}

export function useMonitorTargetByIdentityQuery(
  type: MonitorTargetType,
  externalId: string,
  enabled = true,
) {
  return useQuery({
    queryKey: monitorTargetKeys.byIdentity(type, externalId),
    queryFn: () => fetchMonitorTargetByIdentity(type, externalId),
    enabled: enabled && Boolean(externalId),
    retry: (count, err) => {
      if (err instanceof Error && (err.message.includes('未找到') || err.message === 'not found')) {
        return false;
      }
      return count < 1;
    },
  });
}

export function useMonitorTargetMutations() {
  const client = useQueryClient();
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['monitor'] });
  };
  return {
    create: useMutation({ mutationFn: createMonitorTarget, onSuccess: refresh }),
    patch: useMutation({
      mutationFn: (input: { id: string; patch: MonitorTargetPatchRequest }) =>
        patchMonitorTarget(input.id, input.patch),
      onSuccess: refresh,
    }),
    remove: useMutation({ mutationFn: deleteMonitorTarget, onSuccess: refresh }),
    run: useMutation({ mutationFn: runMonitorTarget, onSuccess: refresh }),
  };
}
