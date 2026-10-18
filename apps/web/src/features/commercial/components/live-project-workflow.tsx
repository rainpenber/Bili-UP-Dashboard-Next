import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  applySessionRename,
  commercialWorkflowToLive,
  type LiveGraphNode,
} from '../workflow-live-graph';
import { useLiveProjectDetailQuery, useLiveProjectWorkflowQuery } from '../use-live-workflow';
import { postLiveNodeStep, postLiveStageStep, saveLiveNodePlan } from '../commercial-live-api';
import type { StepCall, StepResult } from './stage-step-controls';
import { ProjectVideoMetrics } from './project-video-metrics';
import { ProgressSummary, ProgressTimeline } from './progress-timeline-view';
import { timelineFactsFromDetail, timelineNodesFromWorkflow } from '../progress-timeline';
import { WorkflowLiveCanvas } from './workflow-live-canvas';

async function runLiveStep(
  projectId: string,
  call: StepCall,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<StepResult> {
  const publish = call.publish ?? null;
  const result =
    call.kind === 'node' && call.nodeId && call.expectedUpdatedAt
      ? await postLiveNodeStep(projectId, call.nodeId, {
          expectedUpdatedAt: call.expectedUpdatedAt,
          direction: call.direction,
          force: call.force,
          publish,
        })
      : await postLiveStageStep(projectId, call.stageId ?? '', {
          direction: call.direction,
          tokens: call.tokens,
          force: call.force,
          publish,
        });
  if (result.ok) {
    await queryClient.invalidateQueries({ queryKey: ['commercial', 'live-workflow', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['commercial', 'live-project', projectId] });
    return { ok: true };
  }
  return {
    ok: false,
    message: result.body.error,
    code: result.body.code,
    blocks: (result.body.blocks ?? []).map((item) => ({
      nodeId: item.nodeId,
      nodeName: item.nodeName,
      reason: item.reason,
    })),
    effects: (result.body.effects ?? []).map((item) => ({
      nodeId: item.nodeId,
      nodeName: item.nodeName,
      from: item.from,
      to: item.to,
    })),
    successors: (result.body.successors ?? []).map((item) => ({
      nodeId: item.nodeId,
      nodeName: item.nodeName,
      templateSlug: item.templateSlug,
    })),
  };
}

function withNames(nodes: LiveGraphNode[], names: Record<string, string>): LiveGraphNode[] {
  return nodes.map((node) => {
    const name = names[node.id];
    return name ? { ...node, name } : node;
  });
}

/** Database project workflow. Rename stays in this page until a write route exists. */
export function LiveProjectWorkflow({ projectId }: { projectId: string }) {
  const detailQuery = useLiveProjectDetailQuery(projectId);
  const workflowQuery = useLiveProjectWorkflowQuery(projectId);
  const queryClient = useQueryClient();
  const [names, setNames] = useState<Record<string, string>>({});
  const [renameError, setRenameError] = useState<string | null>(null);
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null);
  const [planError, setPlanError] = useState<{ nodeId: string; message: string } | null>(null);

  const live = useMemo(() => {
    if (!workflowQuery.data) return null;
    const base = commercialWorkflowToLive(workflowQuery.data);
    return { nodes: withNames(base.nodes, names), edges: base.edges };
  }, [workflowQuery.data, names]);

  if (workflowQuery.isLoading || detailQuery.isLoading) {
    return <LoadingListSkeleton rows={4} />;
  }

  const workflow = workflowQuery.data;
  if (workflowQuery.isError || !live || !workflow) {
    return (
      <ErrorState
        message={
          workflowQuery.error instanceof Error ? workflowQuery.error.message : '流程加载失败'
        }
        onRetry={() => {
          void workflowQuery.refetch();
          void detailQuery.refetch();
        }}
      />
    );
  }

  const archived = detailQuery.data?.overallStage === 'archived';
  const title = detailQuery.data?.name ?? '项目流程';
  const facts = timelineFactsFromDetail(detailQuery.data);
  const timelineNodes = timelineNodesFromWorkflow(workflow.nodes, names);
  const publishedBvid = detailQuery.data?.publish.published ? detailQuery.data.publish.bvid : null;

  return (
    <>
      <PageHeader
        title={title}
        description={archived ? '该项目已结案归档，流程只读。' : '数据库中的项目流程'}
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '项目', to: '/projects' },
          { label: title },
        ]}
        actions={archived ? <Badge variant="secondary">已归档</Badge> : null}
      />
      <div className="space-y-4">
        <ProgressSummary facts={facts} nodes={timelineNodes} />
        <ProgressTimeline
          nodes={timelineNodes}
          stepEditor={{
            disabled: Boolean(archived),
            onRefresh: () => {
              void workflowQuery.refetch();
              void detailQuery.refetch();
            },
            onStep: (call) => runLiveStep(projectId, call, queryClient),
          }}
          planEditor={{
            disabled: Boolean(archived),
            savingId: savingPlanId,
            error: planError,
            onSave: (nodeId, updatedAt, plannedAt) => {
              setSavingPlanId(nodeId);
              setPlanError(null);
              void saveLiveNodePlan(projectId, nodeId, { expectedUpdatedAt: updatedAt, plannedAt })
                .then(() =>
                  queryClient.invalidateQueries({
                    queryKey: ['commercial', 'live-workflow', projectId],
                  }),
                )
                .then(() => undefined)
                .catch((err: unknown) => {
                  setPlanError({
                    nodeId,
                    message: err instanceof Error ? err.message : '计划日期保存失败',
                  });
                })
                .finally(() => setSavingPlanId(null));
            },
          }}
        />
        {publishedBvid ? <ProjectVideoMetrics bvid={publishedBvid} /> : null}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">流程</CardTitle>
            <p
              className="text-sm font-normal text-muted-foreground"
              data-testid="workflow-live-counts"
            >
              {live.nodes.length} 个节点 · {live.edges.length} 条连线
              {archived ? '。归档后不能改名。' : '。改名只留在本页，尚未写回数据库。'}
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {renameError ? (
              <p
                className="text-sm text-destructive"
                role="alert"
                data-testid="workflow-action-error"
              >
                {renameError}
              </p>
            ) : null}
            <WorkflowLiveCanvas
              nodes={live.nodes}
              edges={live.edges}
              label="流程"
              readOnly={archived}
              onRename={(id, name) => {
                // TODO(I-2): persist rename. The commercial API has no rename route yet.
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
          </CardContent>
        </Card>
        <Button variant="outline" asChild>
          <Link to="/projects">返回项目列表</Link>
        </Button>
      </div>
    </>
  );
}
