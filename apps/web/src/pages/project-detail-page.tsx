import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { advanceNode, fetchOpenItems, fetchProject, fetchWorkflow } from '@/api/commercial-client';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { WorkflowGraphView } from '@/features/commercial/workflow-graph-view';

const statusColor: Record<string, string> = {
  completed: 'fill-green-500/20 stroke-green-600',
  in_progress: 'fill-orange-500/20 stroke-orange-600',
  blocked: 'fill-red-500/20 stroke-red-600',
  not_reached: 'fill-muted stroke-muted-foreground',
  not_applicable: 'fill-muted/50 stroke-muted-foreground',
};

export function ProjectDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const project = useQuery({
    queryKey: ['commercial', 'project', id],
    queryFn: () => fetchProject(id!),
    enabled: Boolean(id),
  });
  const workflow = useQuery({
    queryKey: ['commercial', 'workflow', id],
    queryFn: () => fetchWorkflow(id!),
    enabled: Boolean(id),
  });
  const openItems = useQuery({
    queryKey: ['commercial', 'open-items', id],
    queryFn: () => fetchOpenItems(id!),
    enabled: Boolean(id),
  });

  const advance = useMutation({
    mutationFn: (nodeId: string) => advanceNode(id!, nodeId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['commercial'] });
    },
  });

  if (!id) return <ErrorState message="缺少项目 ID" />;
  if (project.isLoading || workflow.isLoading) return <LoadingListSkeleton rows={8} />;
  if (project.isError || workflow.isError) {
    return (
      <ErrorState
        message={
          (project.error ?? workflow.error) instanceof Error
            ? (project.error ?? workflow.error)!.message
            : '加载失败'
        }
      />
    );
  }

  const p = project.data!;
  const wf = workflow.data!;
  const inProgress = wf.nodes.filter((n) => n.status === 'in_progress' || n.status === 'blocked');

  return (
    <div className="space-y-6 max-w-full overflow-x-hidden">
      <PageHeader title={p.name} description={`阶段 ${p.overallStage}`} />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">概要</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm md:grid-cols-2">
          <p>总体阶段：{p.overallStage}</p>
          <p>主要阻塞：{p.primaryBlockLabel ?? '—'}</p>
          <p>到手金额：{p.netAmount ?? '—'}</p>
          <p>返点金额：{p.rebateAmount ?? '—'}</p>
          <p className="md:col-span-2">
            进行中节点：{inProgress.map((n) => n.name).join('、') || '—'}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">当前与发布状态</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {p.overallStage === 'pre_publish' ? (
            <p>尚未发布。可在后续迭代中在此填写 BV 号与上线时间。</p>
          ) : (
            <p>
              已上线，进入发布后收尾。可在{' '}
              <a href="/monitoring" className="text-primary underline">
                监控
              </a>{' '}
              查看数据趋势。
            </p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">完整工作流图</CardTitle>
        </CardHeader>
        <CardContent>
          <WorkflowGraphView
            nodes={wf.nodes}
            edges={wf.edges}
            statusColor={statusColor}
            onAdvance={(nodeId) => advance.mutate(nodeId)}
            advancing={advance.isPending}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">待闭环事项</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {(openItems.data?.items ?? []).map((item) => (
            <div key={item.id} id={`item-${item.id}`} tabIndex={-1} className="rounded border p-2">
              <p className="font-medium">{item.title}</p>
              <p className="text-muted-foreground">
                {item.nextAction ?? '—'} · {item.nextActor} · {item.impact}
              </p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
