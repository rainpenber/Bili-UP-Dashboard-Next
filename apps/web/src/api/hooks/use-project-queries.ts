import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  archiveProject,
  createOpenItem,
  createProject,
  fetchDashboardToday,
  fetchOpenItems,
  fetchProject,
  fetchProjectWorkflow,
  fetchProjects,
  fetchTeamMembers,
  patchOpenItem,
  patchProject,
  patchWorkflowNode,
  restoreProject,
} from '@/api/projects-client';

export function useDashboardToday() {
  return useQuery({
    queryKey: ['dashboard', 'today'],
    queryFn: () => fetchDashboardToday(),
  });
}

export function useProjectsList(params: Record<string, string | undefined>) {
  return useQuery({
    queryKey: ['projects', params],
    queryFn: () => fetchProjects(params),
  });
}

export function useTeamMembers() {
  return useQuery({
    queryKey: ['team-members'],
    queryFn: () => fetchTeamMembers(),
  });
}

export function useProjectDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => fetchProject(id!),
    enabled: Boolean(id),
  });
}

export function useProjectWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: ['project-workflow', id],
    queryFn: () => fetchProjectWorkflow(id!),
    enabled: Boolean(id),
  });
}

export function useOpenItems(projectId: string | undefined) {
  return useQuery({
    queryKey: ['open-items', projectId],
    queryFn: () => fetchOpenItems(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useProjectMutations(projectId?: string) {
  const qc = useQueryClient();
  const invalidate = async () => {
    await qc.invalidateQueries({ queryKey: ['projects'] });
    await qc.invalidateQueries({ queryKey: ['dashboard', 'today'] });
    if (projectId) {
      await qc.invalidateQueries({ queryKey: ['project', projectId] });
      await qc.invalidateQueries({ queryKey: ['project-workflow', projectId] });
      await qc.invalidateQueries({ queryKey: ['open-items', projectId] });
    }
  };

  return {
    createProject: useMutation({
      mutationFn: createProject,
      onSuccess: invalidate,
    }),
    patchProject: useMutation({
      mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
        patchProject(id, body),
      onSuccess: invalidate,
    }),
    archiveProject: useMutation({
      mutationFn: archiveProject,
      onSuccess: invalidate,
    }),
    restoreProject: useMutation({
      mutationFn: restoreProject,
      onSuccess: invalidate,
    }),
    patchNode: useMutation({
      mutationFn: ({
        projectId: pid,
        nodeId,
        body,
      }: {
        projectId: string;
        nodeId: string;
        body: Record<string, unknown>;
      }) => patchWorkflowNode(pid, nodeId, body),
      onSuccess: invalidate,
    }),
    createOpenItem: useMutation({
      mutationFn: ({
        projectId: pid,
        body,
      }: {
        projectId: string;
        body: Record<string, unknown>;
      }) => createOpenItem(pid, body),
      onSuccess: invalidate,
    }),
    patchOpenItem: useMutation({
      mutationFn: ({
        projectId: pid,
        itemId,
        body,
      }: {
        projectId: string;
        itemId: string;
        body: Record<string, unknown>;
      }) => patchOpenItem(pid, itemId, body),
      onSuccess: invalidate,
    }),
  };
}
