import { useQuery } from '@tanstack/react-query';
import {
  fetchLiveDefaultTemplate,
  fetchLiveProjectDetail,
  fetchLiveProjectList,
  fetchLiveProjectWorkflow,
  retryCommercialRead,
  type LiveProjectListParams,
} from './commercial-live-api';

export const liveCommercialProjectsKey = ['commercial', 'projects'] as const;

export function useLiveCommercialProjectsQuery(params: LiveProjectListParams = {}) {
  return useQuery({
    queryKey: [...liveCommercialProjectsKey, params.originKind ?? ''] as const,
    queryFn: () => fetchLiveProjectList(params),
    retry: retryCommercialRead,
    retryDelay: 0,
  });
}

export function useLiveProjectDetailQuery(projectId: string) {
  return useQuery({
    queryKey: ['commercial', 'live-project', projectId],
    queryFn: () => fetchLiveProjectDetail(projectId),
    retry: false,
  });
}

export function useLiveProjectWorkflowQuery(projectId: string) {
  return useQuery({
    queryKey: ['commercial', 'live-workflow', projectId],
    queryFn: () => fetchLiveProjectWorkflow(projectId),
    retry: false,
  });
}

export function useLiveDefaultTemplateQuery() {
  return useQuery({
    queryKey: ['commercial', 'live-template'],
    queryFn: fetchLiveDefaultTemplate,
    retry: false,
  });
}
