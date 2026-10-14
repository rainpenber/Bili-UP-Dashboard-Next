import { useQuery } from '@tanstack/react-query';
import {
  fetchCommercialProject,
  fetchCommercialProjects,
  fetchDefaultWorkflowTemplate,
} from './commercial-mock-api';

export function useCommercialProjectsQuery() {
  return useQuery({
    queryKey: ['commercial', 'projects'],
    queryFn: fetchCommercialProjects,
  });
}

export function useCommercialProjectQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: ['commercial', 'project', projectId],
    queryFn: () => fetchCommercialProject(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useDefaultWorkflowQuery() {
  return useQuery({
    queryKey: ['commercial', 'default-workflow'],
    queryFn: fetchDefaultWorkflowTemplate,
  });
}
