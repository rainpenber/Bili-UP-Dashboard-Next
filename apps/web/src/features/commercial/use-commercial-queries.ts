import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  fetchCommercialProject,
  fetchCommercialProjects,
  fetchDefaultWorkflowTemplate,
} from './commercial-mock-api';

export function commercialMockErrorFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('commercialMockError') === '1';
}

function useCommercialMockErrorFlag(): boolean {
  const [searchParams] = useSearchParams();
  return commercialMockErrorFromSearch(searchParams.toString());
}

export function useCommercialProjectsQuery() {
  const mockError = useCommercialMockErrorFlag();
  return useQuery({
    queryKey: ['commercial', 'projects', mockError ? 'error' : 'ok'],
    queryFn: fetchCommercialProjects,
  });
}

export function useCommercialProjectQuery(projectId: string | undefined) {
  const mockError = useCommercialMockErrorFlag();
  return useQuery({
    queryKey: ['commercial', 'project', projectId, mockError ? 'error' : 'ok'],
    queryFn: () => fetchCommercialProject(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useDefaultWorkflowQuery() {
  const mockError = useCommercialMockErrorFlag();
  return useQuery({
    queryKey: ['commercial', 'default-workflow', mockError ? 'error' : 'ok'],
    queryFn: fetchDefaultWorkflowTemplate,
  });
}
