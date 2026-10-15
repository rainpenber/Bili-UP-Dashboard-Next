import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { graphFromTemplate } from '../commercial-view';
import { useDefaultCommercialTemplateQuery } from '../use-commercial-queries';
import { WorkflowGraphReadonly } from './workflow-graph-readonly';

export function DefaultFlowEditor() {
  const query = useDefaultCommercialTemplateQuery();

  if (query.isLoading) return <LoadingListSkeleton rows={3} />;
  if (query.isError) {
    return (
      <ErrorState
        message={query.error instanceof Error ? query.error.message : '默认流程加载失败'}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (!query.data) {
    return <ErrorState title="没有默认流程" message="服务器没有返回已发布的默认模板。" />;
  }

  const template = query.data;
  return (
    <div className="space-y-4" data-testid="default-flow-editor">
      <p
        className="rounded-md border border-dashed bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        data-testid="default-flow-readonly-notice"
      >
        此页只读，显示已发布的默认流程 v{template.version}（{template.publishedAt}
        ）。编辑草稿和发布新版本还没有接到后端。模板节点没有运行状态，图上统一显示为未到达，只表示结构。
      </p>
      <p className="text-sm text-muted-foreground" data-testid="default-flow-version">
        {template.name} · {template.slug}
      </p>
      <WorkflowGraphReadonly graph={graphFromTemplate(template)} />
    </div>
  );
}
