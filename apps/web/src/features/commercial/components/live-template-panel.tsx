import { useMemo, useState } from 'react';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { applySessionRename, templateToLive, type LiveGraphNode } from '../workflow-live-graph';
import { useLiveDefaultTemplateQuery } from '../use-live-workflow';
import { WorkflowLiveCanvas } from './workflow-live-canvas';

function withNames(nodes: LiveGraphNode[], names: Record<string, string>): LiveGraphNode[] {
  return nodes.map((node) => {
    const name = names[node.id];
    return name ? { ...node, name } : node;
  });
}

/** Published default template from the database. Rename is session-local. */
export function LiveTemplatePanel() {
  const query = useLiveDefaultTemplateQuery();
  const [names, setNames] = useState<Record<string, string>>({});
  const [renameError, setRenameError] = useState<string | null>(null);

  const live = useMemo(() => {
    if (!query.data) return null;
    const base = templateToLive(query.data);
    return { nodes: withNames(base.nodes, names), edges: base.edges };
  }, [query.data, names]);

  if (query.isLoading) return <LoadingListSkeleton rows={2} />;
  if (query.isError || !live || !query.data) {
    return (
      <ErrorState
        title="数据库模板未加载"
        message={query.error instanceof Error ? query.error.message : '默认模板加载失败'}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const template = query.data;
  return (
    <div className="space-y-3" data-testid="live-template-panel">
      <p className="text-sm text-muted-foreground" data-testid="live-template-counts">
        v{template.version} · {live.nodes.length} 个节点 · {live.edges.length}{' '}
        条连线。改名只留在本页。
      </p>
      {renameError ? (
        <p className="text-sm text-destructive" role="alert" data-testid="workflow-action-error">
          {renameError}
        </p>
      ) : null}
      <WorkflowLiveCanvas
        nodes={live.nodes}
        edges={live.edges}
        label={template.name}
        onRename={(id, name) => {
          // TODO(I-2): persist template rename. This view only proves the published rows.
          const result = applySessionRename(live.nodes, id, name);
          if (!result.ok) {
            setRenameError(result.message);
            return result.message;
          }
          setNames((current) => ({ ...current, [id]: result.name }));
          setRenameError(null);
          return null;
        }}
      />
    </div>
  );
}
