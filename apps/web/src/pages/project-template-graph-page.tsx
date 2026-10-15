import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { CommercialProjectDetail, CommercialProjectWorkflow } from '@studio/contracts';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { WorkflowGraphReadonly } from '@/features/commercial/components/workflow-graph-readonly';
import { fetchProjectDetail, fetchProjectWorkflow } from '@/features/commercial/default-flow-api';
import { projectWorkflowToGraph } from '@/features/commercial/template-graph';

const STATUS_LABEL: Record<CommercialProjectWorkflow['nodes'][number]['status'], string> = {
  not_reached: '未到',
  in_progress: '进行中',
  completed: '已完成',
  blocked: '被卡住',
  not_applicable: '不适用',
};

export function ProjectTemplateGraphPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [detail, setDetail] = useState<CommercialProjectDetail | null>(null);
  const [workflow, setWorkflow] = useState<CommercialProjectWorkflow | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setError(null);
    setDetail(null);
    setWorkflow(null);
    void Promise.all([fetchProjectDetail(projectId), fetchProjectWorkflow(projectId)]).then(
      ([nextDetail, nextWorkflow]) => {
        if (cancelled) return;
        setDetail(nextDetail);
        setWorkflow(nextWorkflow);
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : '加载失败');
      },
    );
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  if (!projectId) {
    return <ErrorState title="找不到这个项目" message="链接里没有项目 id。" />;
  }
  if (error) {
    return <ErrorState message={error} onRetry={() => window.location.reload()} />;
  }
  if (!detail || !workflow) {
    return <LoadingListSkeleton rows={4} />;
  }

  const graph = projectWorkflowToGraph(workflow);

  return (
    <>
      <PageHeader
        title={detail.name}
        description="由已发布模板创建。节点、连接和制作包来自该版本，状态都在初始值。"
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '集成与设置', to: '/integrations' },
          { label: detail.name },
        ]}
      />
      <p className="mb-3 text-sm text-muted-foreground">
        <Link to="/integrations" className="underline">
          返回默认流程
        </Link>
      </p>
      <p className="mb-3 text-sm text-foreground" data-testid="created-project-summary">
        {workflow.nodes.length} 个节点，{workflow.edges.length} 条连接
      </p>
      <ul className="mb-4 space-y-1 text-sm" data-testid="created-project-node-list">
        {workflow.nodes.map((node) => (
          <li key={node.id} data-node-id={node.id} data-node-status={node.status}>
            {node.name} · {STATUS_LABEL[node.status]}
          </li>
        ))}
      </ul>
      <WorkflowGraphReadonly graph={graph} />
    </>
  );
}
