import { useQuery } from '@tanstack/react-query';
import {
  fetchLiveDefaultTemplate,
  fetchLiveProjectDetail,
  fetchLiveProjectWorkflow,
} from './commercial-live-api';

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
