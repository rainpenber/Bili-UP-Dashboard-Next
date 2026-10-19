import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useRef, useState } from 'react';
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
import type { StepCall, StepEditor, StepResult } from './stage-step-controls';
import { useStepController } from './stage-step-controls';
import { GraphNodeProgress } from './graph-node-progress';
import { ProjectVideoMetrics } from './project-video-metrics';
import { ProgressSummary, ProgressTimeline, type PlanEditor } from './progress-timeline-view';
import { timelineFactsFromDetail, timelineNodesFromWorkflow } from '../progress-timeline';
import { WorkflowLiveCanvas } from './workflow-live-canvas';

function stepFailure(message: string, code = 'invalid_body'): StepResult {
  return { ok: false, message, code, blocks: [], effects: [], successors: [] };
}

async function runLiveStep(
  projectId: string,
  call: StepCall,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<StepResult> {
  const publish = call.publish ?? null;
  let result;
  try {
    result =
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
  } catch (err) {
    return stepFailure(
      err instanceof Error && err.message.trim().length > 0 ? err.message : '网络异常，请重试',
    );
  }
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
  const locateRef = useRef<(stageId: string) => void>(() => undefined);
  const bindLocate = useCallback((locate: ((stageId: string) => void) | null) => {
    locateRef.current = locate ?? (() => undefined);
  }, []);
  const onRefresh = useCallback(() => {
    void workflowQuery.refetch();
    void detailQuery.refetch();
  }, [workflowQuery.refetch, detailQuery.refetch]);
  const onStep = useCallback(
    (call: StepCall) => runLiveStep(projectId, call, queryClient),
    [projectId, queryClient],
  );
  const recordedPublish = useMemo(() => {
    const publish = detailQuery.data?.publish;
    if (!publish?.published || !publish.idempotencyKey) return null;
    return {
      bvid: publish.bvid ?? '',
      publishedAt: publish.publishedAt ?? '',
      idempotencyKey: publish.idempotencyKey,
    };
  }, [detailQuery.data?.publish]);
  const archived = detailQuery.data?.overallStage === 'archived';
  const stepEditor = useMemo<StepEditor>(
    () => ({
      disabled: Boolean(archived),
      onRefresh,
      onStep,
      recordedPublish,
    }),
    [archived, onRefresh, onStep, recordedPublish],
  );
  const step = useStepController(stepEditor, (stageId) => locateRef.current(stageId));

  const live = useMemo(() => {
    if (!workflowQuery.data) return null;
    const base = commercialWorkflowToLive(workflowQuery.data);
    return { nodes: withNames(base.nodes, names), edges: base.edges };
  }, [workflowQuery.data, names]);

  const planEditor = useMemo<PlanEditor>(
    () => ({
      disabled: Boolean(archived),
      savingId: savingPlanId,
      error: planError,
      onSave: (nodeId, updatedAt, plannedAt) => {
        setSavingPlanId(nodeId);
        setPlanError(null);
        void saveLiveNodePlan(projectId, nodeId, { expectedUpdatedAt: updatedAt, plannedAt })
          .then(() =>
            Promise.all([
              queryClient.invalidateQueries({
                queryKey: ['commercial', 'live-workflow', projectId],
              }),
              queryClient.invalidateQueries({
                queryKey: ['commercial', 'live-project', projectId],
              }),
            ]),
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
    }),
    [archived, planError, projectId, queryClient, savingPlanId],
  );

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
          stepEditor={stepEditor}
          stepController={step}
          bindLocate={bindLocate}
          planEditor={planEditor}
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
              renderDetail={(node) => (
                <GraphNodeProgress
                  node={node}
                  interactive={!archived}
                  step={step}
                  planEditor={planEditor}
                />
              )}
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
