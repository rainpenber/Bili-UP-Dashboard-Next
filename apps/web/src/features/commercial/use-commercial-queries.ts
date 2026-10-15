import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import {
  executeCommercialWrite,
  fetchCommercialProjectDetail,
  fetchCommercialProjectList,
  fetchCommercialWorkflow,
  fetchDefaultCommercialTemplate,
  type WriteFeedback,
} from './commercial-api';

export function useCommercialProjectsQuery() {
  return useQuery({
    queryKey: ['commercial', 'projects'],
    queryFn: fetchCommercialProjectList,
  });
}

export function useCommercialProjectDetailQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: ['commercial', 'project', projectId],
    queryFn: () => fetchCommercialProjectDetail(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useCommercialWorkflowQuery(projectId: string | undefined) {
  return useQuery({
    queryKey: ['commercial', 'workflow', projectId],
    queryFn: () => fetchCommercialWorkflow(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useDefaultCommercialTemplateQuery() {
  return useQuery({
    queryKey: ['commercial', 'template', 'default'],
    queryFn: fetchDefaultCommercialTemplate,
  });
}

export function useCommercialWrites(projectId: string) {
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<WriteFeedback | null>(null);
  const [pending, setPending] = useState(false);
  const lock = useRef(false);

  const refetchProject = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['commercial', 'projects'] });
    await queryClient.invalidateQueries({ queryKey: ['commercial', 'project', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['commercial', 'workflow', projectId] });
  }, [projectId, queryClient]);

  const run = useCallback(
    async <T>(send: () => Promise<T>) => {
      if (lock.current) {
        return { feedback: { kind: 'ok' } as const, result: null };
      }
      lock.current = true;
      setPending(true);
      try {
        const outcome = await executeCommercialWrite({ send, refetch: refetchProject });
        setFeedback(outcome.feedback.kind === 'ok' ? null : outcome.feedback);
        return outcome;
      } finally {
        lock.current = false;
        setPending(false);
      }
    },
    [refetchProject],
  );

  const clearFeedback = useCallback(() => setFeedback(null), []);

  return { run, feedback, pending, clearFeedback };
}
