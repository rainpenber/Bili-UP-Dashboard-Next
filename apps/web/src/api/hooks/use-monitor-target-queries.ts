import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createMonitorTarget,
  deleteMonitorTarget,
  fetchMonitorTargets,
  patchMonitorTarget,
  runMonitorTarget,
} from '@/api/monitor-targets-client';
import type { MonitorTargetPatchRequest } from '@studio/contracts';

export const monitorTargetKeys = {
  targets: (page: number) => ['monitor', 'targets', page] as const,
};

export function useMonitorTargetsQuery(page: number, enabled: boolean) {
  return useQuery({
    queryKey: monitorTargetKeys.targets(page),
    queryFn: () => fetchMonitorTargets(page),
    enabled,
    refetchInterval: enabled ? 4000 : false,
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
