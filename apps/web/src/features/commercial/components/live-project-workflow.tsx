import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CommercialProjectWorkflow } from '@studio/contracts';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  applyBusinessStateToLiveNodes,
  applyBusinessStateToTimelineNodes,
  isBusinessStateReadOnly,
} from '../business-display-state';
import {
  applySessionRename,
  commercialWorkflowToLive,
  type LiveGraphNode,
} from '../workflow-live-graph';
import {
  archiveLiveProject,
  CommercialReadError,
  postLiveNodeStep,
  postLiveNodeUnblock,
  postLiveStageStep,
  saveLiveNodePlan,
  saveLiveWorkflowLayout,
  unarchiveLiveProject,
} from '../commercial-live-api';
import { isArchivedLiveProject } from '../commercial-live-selectors';
import {
  liveCommercialProjectsKey,
  useLiveProjectDetailQuery,
  useLiveProjectWorkflowQuery,
} from '../use-live-workflow';
import { OpenItemsReadout } from './open-items-readout';
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

async function refreshLiveStep(
  projectId: string,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: ['commercial', 'live-workflow', projectId] });
  await queryClient.invalidateQueries({ queryKey: ['commercial', 'live-project', projectId] });
  await queryClient.invalidateQueries({ queryKey: liveCommercialProjectsKey });
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
    await refreshLiveStep(projectId, queryClient);
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

async function runLiveUnblock(
  projectId: string,
  nodeId: string,
  expectedUpdatedAt: string,
  queryClient: ReturnType<typeof useQueryClient>,
): Promise<StepResult> {
  let result;
  try {
    result = await postLiveNodeUnblock(projectId, nodeId, expectedUpdatedAt);
  } catch (err) {
    return stepFailure(
      err instanceof Error && err.message.trim().length > 0 ? err.message : '网络异常，请重试',
    );
  }
  if (result.ok) {
    await refreshLiveStep(projectId, queryClient);
    return { ok: true };
  }
  return {
    ok: false,
    message: result.body.error,
    code: result.body.code,
    blocks: [],
    effects: [],
    successors: [],
  };
}

function withNames(nodes: LiveGraphNode[], names: Record<string, string>): LiveGraphNode[] {
  return nodes.map((node) => {
    const name = names[node.id];
    return name ? { ...node, name } : node;
  });
}

function withPositions(
  nodes: LiveGraphNode[],
  positions: Record<string, { x: number; y: number }> | null,
): LiveGraphNode[] {
  if (!positions) return nodes;
  return nodes.map((node) => {
    const pos = positions[node.id];
    return pos ? { ...node, posX: pos.x, posY: pos.y } : node;
  });
}

function buildLayoutRequest(
  workflow: CommercialProjectWorkflow,
  names: Record<string, string>,
  positions: Record<string, { x: number; y: number }> | null,
) {
  return {
    nodes: workflow.nodes.map((node) => {
      const patch: {
        nodeId: string;
        expectedUpdatedAt: string;
        name?: string;
        posX?: number;
        posY?: number;
      } = {
        nodeId: node.id,
        expectedUpdatedAt: node.updatedAt,
      };
      const name = names[node.id];
      if (name !== undefined && name !== node.name) patch.name = name;
      const pos = positions?.[node.id];
      if (pos && (pos.x !== node.posX || pos.y !== node.posY)) {
        patch.posX = pos.x;
        patch.posY = pos.y;
      }
      return patch;
    }),
  };
}

/** Database project workflow with persisted rename and layout. */
export function LiveProjectWorkflow({ projectId }: { projectId: string }) {
  const detailQuery = useLiveProjectDetailQuery(projectId);
  const workflowQuery = useLiveProjectWorkflowQuery(projectId);
  const queryClient = useQueryClient();
  const [names, setNames] = useState<Record<string, string>>({});
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [layoutError, setLayoutError] = useState<string | null>(null);
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutNotice, setLayoutNotice] = useState<string | null>(null);
  const [savingPlanId, setSavingPlanId] = useState<string | null>(null);
  const [planError, setPlanError] = useState<{ nodeId: string; message: string } | null>(null);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
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
  const onUnblock = useCallback(
    (nodeId: string, expectedUpdatedAt: string) =>
      runLiveUnblock(projectId, nodeId, expectedUpdatedAt, queryClient),
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
  const archived = detailQuery.data ? isArchivedLiveProject(detailQuery.data) : false;
  const softArchived = detailQuery.data != null && detailQuery.data.archivedAt !== null;
  const businessState = detailQuery.data?.businessState ?? null;
  const displayReadOnly = archived || isBusinessStateReadOnly(businessState);
  const layoutDirty =
    Object.keys(names).length > 0 || (positions != null && Object.keys(positions).length > 0);

  const onToggleArchive = () => {
    if (!detailQuery.data) return;
    setArchiveBusy(true);
    setArchiveError(null);
    const action = softArchived ? unarchiveLiveProject(projectId) : archiveLiveProject(projectId);
    void action
      .then(() =>
        Promise.all([
          queryClient.invalidateQueries({
            queryKey: ['commercial', 'live-project', projectId],
          }),
          queryClient.invalidateQueries({ queryKey: liveCommercialProjectsKey }),
        ]),
      )
      .catch((err: unknown) => {
        setArchiveError(err instanceof Error ? err.message : '操作失败');
      })
      .finally(() => setArchiveBusy(false));
  };
  const stepEditor = useMemo<StepEditor>(
    () => ({
      disabled: Boolean(displayReadOnly),
      onRefresh,
      onStep,
      onUnblock,
      recordedPublish,
    }),
    [displayReadOnly, onRefresh, onStep, onUnblock, recordedPublish],
  );
  const step = useStepController(stepEditor, (stageId) => locateRef.current(stageId));

  const live = useMemo(() => {
    if (!workflowQuery.data) return null;
    const base = commercialWorkflowToLive(workflowQuery.data);
    const nodes = applyBusinessStateToLiveNodes(
      withPositions(withNames(base.nodes, names), positions),
      businessState,
    );
    return { nodes, edges: base.edges };
  }, [workflowQuery.data, names, positions, businessState]);

  const saveLayout = useCallback(() => {
    const workflow = workflowQuery.data;
    if (!workflow || displayReadOnly || layoutSaving || !layoutDirty) return;
    const body = buildLayoutRequest(workflow, names, positions);
    const hasChange = body.nodes.some(
      (node) => node.name !== undefined || node.posX !== undefined || node.posY !== undefined,
    );
    if (!hasChange) {
      setNames({});
      setPositions(null);
      setLayoutError(null);
      setLayoutNotice('已保存');
      return;
    }
    setLayoutSaving(true);
    setLayoutError(null);
    setLayoutNotice(null);
    void saveLiveWorkflowLayout(projectId, body)
      .then((result) => {
        queryClient.setQueryData(
          ['commercial', 'live-workflow', projectId],
          (current: CommercialProjectWorkflow | undefined) =>
            current
              ? {
                  ...current,
                  nodes: result.nodes,
                }
              : current,
        );
        setNames({});
        setPositions(null);
        setLayoutNotice('已保存');
        return Promise.all([
          queryClient.invalidateQueries({
            queryKey: ['commercial', 'live-project', projectId],
          }),
          queryClient.invalidateQueries({ queryKey: liveCommercialProjectsKey }),
        ]);
      })
      .catch((err: unknown) => {
        setLayoutError(err instanceof Error ? err.message : '布局保存失败');
      })
      .finally(() => setLayoutSaving(false));
  }, [
    displayReadOnly,
    layoutDirty,
    layoutSaving,
    names,
    positions,
    projectId,
    queryClient,
    workflowQuery.data,
  ]);

  useEffect(() => {
    if (displayReadOnly || !layoutDirty) return;
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.closest('[data-testid="plan-date-editor"]'))
      ) {
        return;
      }
      event.preventDefault();
      saveLayout();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [displayReadOnly, layoutDirty, saveLayout]);

  const planEditor = useMemo<PlanEditor>(
    () => ({
      disabled: Boolean(displayReadOnly),
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
              queryClient.invalidateQueries({ queryKey: liveCommercialProjectsKey }),
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
    [displayReadOnly, planError, projectId, queryClient, savingPlanId],
  );

  if (workflowQuery.isLoading || detailQuery.isLoading) {
    return <LoadingListSkeleton rows={4} />;
  }

  const workflow = workflowQuery.data;
  const readError = detailQuery.error ?? workflowQuery.error;
  if (detailQuery.isError || workflowQuery.isError || !live || !workflow) {
    const status = readError instanceof CommercialReadError ? readError.status : 0;
    return (
      <ErrorState
        title={status === 404 ? '找不到这个项目' : '加载失败'}
        message={readError instanceof Error ? readError.message : '流程加载失败'}
        onRetry={() => {
          void workflowQuery.refetch();
          void detailQuery.refetch();
        }}
      />
    );
  }

  const title = detailQuery.data?.name ?? '项目流程';
  const facts = timelineFactsFromDetail(detailQuery.data);
  const timelineNodes = applyBusinessStateToTimelineNodes(
    timelineNodesFromWorkflow(workflow.nodes, names),
    businessState,
  );
  const publishedBvid = detailQuery.data?.publish.published ? detailQuery.data.publish.bvid : null;
  const originStatusLabel = detailQuery.data?.originStatusLabel ?? null;
  const headerDescription = softArchived
    ? '该项目已软删除（归档），流程只读；可恢复后继续编辑。'
    : archived
      ? '该项目已结案归档，流程只读。'
      : businessState === 'finished'
        ? '来源已结束：时间轴与节点图按全部完成展示，不改真实流程记录。'
        : businessState === 'not_started'
          ? '来源未开始：时间轴与节点图按全部未到展示，不改真实流程记录。'
          : '数据库中的项目流程';

  return (
    <>
      <PageHeader
        title={title}
        description={headerDescription}
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '项目', to: '/projects' },
          { label: title },
        ]}
        actions={
          <>
            {archived ? <Badge variant="secondary">已归档</Badge> : null}
            {businessState === 'finished' ? (
              <Badge variant="secondary" data-testid="project-business-state-chip">
                已结束{originStatusLabel ? ` · ${originStatusLabel}` : ''}
              </Badge>
            ) : null}
            {businessState === 'not_started' ? (
              <Badge variant="outline" data-testid="project-business-state-chip">
                未开始{originStatusLabel ? ` · ${originStatusLabel}` : ''}
              </Badge>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={archiveBusy}
              onClick={onToggleArchive}
              data-testid={softArchived ? 'project-unarchive' : 'project-archive'}
            >
              {archiveBusy ? '处理中…' : softArchived ? '恢复' : '归档'}
            </Button>
          </>
        }
      />
      {archiveError ? (
        <p
          className="mb-3 text-sm text-destructive"
          role="alert"
          data-testid="project-archive-error"
        >
          {archiveError}
        </p>
      ) : null}
      <div
        className="space-y-4"
        data-testid="project-workflow-shell"
        data-business-state={businessState ?? ''}
        data-display-readonly={displayReadOnly ? 'true' : 'false'}
      >
        <ProgressSummary
          facts={facts}
          nodes={timelineNodes}
          sourceWindow={detailQuery.data?.sourceWindow ?? null}
          sourceNamespace={detailQuery.data?.source?.namespace ?? null}
        />
        {detailQuery.data?.source || detailQuery.data?.originKind ? (
          <p className="text-sm text-muted-foreground" data-testid="project-source-meta">
            来源{' '}
            {detailQuery.data.originKind === 'fixture'
              ? '样例'
              : detailQuery.data.originKind === 'real'
                ? '真实接入'
                : detailQuery.data.originKind === 'manual'
                  ? '手工'
                  : '未分类'}
            {detailQuery.data.source
              ? ` · ${detailQuery.data.source.namespace}/${detailQuery.data.source.sourceId}`
              : null}
            {originStatusLabel ? ` · 源状态「${originStatusLabel}」` : null}
            {businessState === 'finished' || businessState === 'not_started'
              ? '（展示态只读，不改节点记录）'
              : detailQuery.data.source?.sourceStatus
                ? '（仅事实，不推断流程）'
                : null}
          </p>
        ) : null}
        {displayReadOnly && !archived ? (
          <p className="text-sm text-muted-foreground" data-testid="project-display-readonly-note">
            当前为来源展示态：已隐藏推进 / 完成等写操作入口。
          </p>
        ) : null}
        <OpenItemsReadout items={detailQuery.data?.openItems ?? []} />
        <ProgressTimeline
          nodes={timelineNodes}
          stepEditor={stepEditor}
          stepController={step}
          bindLocate={bindLocate}
          planEditor={planEditor}
          displayBusinessState={businessState}
        />
        {publishedBvid ? <ProjectVideoMetrics bvid={publishedBvid} /> : null}
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle className="text-base">流程</CardTitle>
              <p
                className="text-sm font-normal text-muted-foreground"
                data-testid="workflow-live-counts"
              >
                {live.nodes.length} 个节点 · {live.edges.length} 条连线
                {displayReadOnly
                  ? '。当前只读，不能改名或调整布局。'
                  : layoutDirty
                    ? '。有未保存的改名或位置变更。'
                    : '。名称与位置已与数据库一致。'}
              </p>
            </div>
            {!displayReadOnly ? (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="text-xs text-muted-foreground"
                  data-testid="workflow-layout-status"
                  data-dirty={layoutDirty ? 'true' : 'false'}
                >
                  {layoutSaving ? '保存中…' : layoutDirty ? '未保存' : (layoutNotice ?? '已保存')}
                </span>
                <Button
                  type="button"
                  size="sm"
                  disabled={!layoutDirty || layoutSaving}
                  onClick={saveLayout}
                  data-testid="workflow-layout-save"
                >
                  {layoutSaving ? '保存中…' : '保存布局'}
                </Button>
              </div>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {layoutError ? (
              <p
                className="text-sm text-destructive"
                role="alert"
                data-testid="workflow-action-error"
              >
                {layoutError}
              </p>
            ) : null}
            <WorkflowLiveCanvas
              nodes={live.nodes}
              edges={live.edges}
              label="流程"
              readOnly={displayReadOnly}
              renderDetail={(node) => (
                <GraphNodeProgress
                  node={node}
                  interactive={!displayReadOnly}
                  step={step}
                  planEditor={planEditor}
                />
              )}
              onRename={(id, name) => {
                const result = applySessionRename(live.nodes, id, name);
                if (!result.ok) {
                  setLayoutError(result.message);
                  return result.message;
                }
                setNames((current) => ({ ...current, [id]: result.name }));
                setLayoutError(null);
                setLayoutNotice(null);
                return null;
              }}
              onPositionsChange={(next) => {
                setPositions(next);
                setLayoutError(null);
                setLayoutNotice(null);
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
