import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  CommercialDetailOpenItem,
  CommercialProjectDetail,
  CommercialPublishRequest,
} from '@studio/contracts';
import { predecessorCompletionPlan, type PredecessorCompletionStep } from '@studio/workflow';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  CommercialApiError,
  STALE_WRITE_MESSAGE,
  advanceCommercialNode,
  blockCommercialNode,
  cancelCommercialOpenItem,
  closeCommercialOpenItem,
  completeCommercialNode,
  fetchCommercialWorkflow,
  publishCommercialNode,
  rollbackCommercialNode,
  skipCommercialNode,
  unblockCommercialNode,
} from '@/features/commercial/commercial-api';
import {
  formatMoney,
  graphFromWorkflow,
  overallStageLabel,
} from '@/features/commercial/commercial-view';
import type { PublishDraft } from '@/features/commercial/components/node-action-panel';
import { WorkflowGraphLive } from '@/features/commercial/components/workflow-graph-live';
import type { NodeCommand } from '@/features/commercial/node-actions';
import {
  useCommercialProjectDetailQuery,
  useCommercialWorkflowQuery,
  useCommercialWrites,
} from '@/features/commercial/use-commercial-queries';

function publishRequest(expectedUpdatedAt: string, draft: PublishDraft): CommercialPublishRequest {
  const video = draft.video.trim();
  const request: CommercialPublishRequest = {
    expectedUpdatedAt,
    idempotencyKey: draft.idempotencyKey,
    platform: draft.platform,
  };
  if (video.includes('://') || video.includes('/')) request.videoUrl = video;
  else request.bvid = video;
  return request;
}

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const detailQuery = useCommercialProjectDetailQuery(projectId);
  const workflowQuery = useCommercialWorkflowQuery(projectId);
  const writes = useCommercialWrites(projectId ?? '');
  const queryClient = useQueryClient();
  const [advancePrompt, setAdvancePrompt] = useState<{
    nodeId: string;
    nodeName: string;
    steps: PredecessorCompletionStep[];
  } | null>(null);
  const [batchNotice, setBatchNotice] = useState<string | null>(null);
  const [batching, setBatching] = useState(false);
  const batchLock = useRef(false);

  const graph = useMemo(() => {
    if (!workflowQuery.data) return null;
    return graphFromWorkflow(workflowQuery.data, {
      blockingReason: detailQuery.data?.blockingReason ?? null,
    });
  }, [detailQuery.data?.blockingReason, workflowQuery.data]);

  const waiting = detailQuery.isLoading || workflowQuery.isLoading;

  if (!projectId) {
    return <ErrorState title="找不到这个项目" message="链接里没有项目编号。" />;
  }

  if (waiting) return <LoadingListSkeleton rows={4} />;

  if (detailQuery.isError || workflowQuery.isError) {
    const error = detailQuery.error ?? workflowQuery.error;
    return (
      <ErrorState
        message={error instanceof Error ? error.message : '加载失败'}
        onRetry={() => {
          void detailQuery.refetch();
          void workflowQuery.refetch();
        }}
      />
    );
  }

  if (!detailQuery.data || !workflowQuery.data || !graph) {
    return <ErrorState title="找不到这个项目" message="服务器没有返回这个项目。" />;
  }

  const detail = detailQuery.data;
  const workflow = workflowQuery.data;

  function tokenFor(nodeId: string): string | null {
    return workflow.nodes.find((node) => node.id === nodeId)?.updatedAt ?? null;
  }

  async function runNode(nodeId: string, command: Exclude<NodeCommand, 'block' | 'publish'>) {
    const expectedUpdatedAt = tokenFor(nodeId);
    if (!expectedUpdatedAt) return;
    const send = () => {
      if (command === 'advance')
        return advanceCommercialNode(projectId!, nodeId, expectedUpdatedAt);
      if (command === 'complete')
        return completeCommercialNode(projectId!, nodeId, expectedUpdatedAt);
      if (command === 'skip') return skipCommercialNode(projectId!, nodeId, expectedUpdatedAt);
      if (command === 'rollback')
        return rollbackCommercialNode(projectId!, nodeId, expectedUpdatedAt);
      return unblockCommercialNode(projectId!, nodeId, expectedUpdatedAt);
    };
    await writes.run(send);
  }

  async function runBlock(nodeId: string, reason: string | null) {
    const expectedUpdatedAt = tokenFor(nodeId);
    if (!expectedUpdatedAt) return;
    await writes.run(() => blockCommercialNode(projectId!, nodeId, expectedUpdatedAt, reason));
  }

  async function runPublish(nodeId: string, draft: PublishDraft) {
    const expectedUpdatedAt = tokenFor(nodeId);
    if (!expectedUpdatedAt) return;
    await writes.run(() =>
      publishCommercialNode(projectId!, nodeId, publishRequest(expectedUpdatedAt, draft)),
    );
  }

  async function runClose(item: CommercialDetailOpenItem, conclusion: string) {
    const trimmed = conclusion.trim();
    await writes.run(() =>
      closeCommercialOpenItem(projectId!, item.id, {
        expectedUpdatedAt: item.updatedAt,
        ...(trimmed.length > 0 ? { closeConclusion: trimmed } : {}),
      }),
    );
  }

  async function runCancel(item: CommercialDetailOpenItem, reason: string) {
    const trimmed = reason.trim();
    if (!trimmed) return;
    await writes.run(() =>
      cancelCommercialOpenItem(projectId!, item.id, {
        expectedUpdatedAt: item.updatedAt,
        cancelReason: trimmed,
      }),
    );
  }

  function considerAdvance(nodeId: string) {
    const current = workflow.nodes.find((node) => node.id === nodeId);
    if (!current) return;
    const steps = predecessorCompletionPlan(
      nodeId,
      workflow.nodes.map((node) => ({
        id: node.id,
        name: node.name,
        status: node.status,
        kind: node.kind,
      })),
      workflow.edges.map((edge) => ({ fromNodeId: edge.fromNodeId, toNodeId: edge.toNodeId })),
    );
    setBatchNotice(null);
    if (steps.length === 0) {
      setAdvancePrompt(null);
      void runNode(nodeId, 'advance');
      return;
    }
    setAdvancePrompt({ nodeId, nodeName: current.name, steps });
  }

  async function readToken(nodeId: string): Promise<string> {
    const fresh = await fetchCommercialWorkflow(projectId!);
    queryClient.setQueryData(['commercial', 'workflow', projectId], fresh);
    const node = fresh.nodes.find((item) => item.id === nodeId);
    if (!node) throw new Error('找不到节点');
    return node.updatedAt;
  }

  async function confirmPredecessors() {
    if (!advancePrompt || batchLock.current) return;
    batchLock.current = true;
    setBatching(true);
    const { nodeId, nodeName, steps } = advancePrompt;
    const completed: string[] = [];
    try {
      for (const step of steps) {
        try {
          const token = await readToken(step.id);
          const advanced =
            step.status === 'in_progress'
              ? null
              : await advanceCommercialNode(projectId!, step.id, token);
          const completeToken = advanced?.node.updatedAt ?? token;
          await completeCommercialNode(projectId!, step.id, completeToken);
          completed.push(step.name);
        } catch (error) {
          await queryClient.invalidateQueries({ queryKey: ['commercial'] });
          const detailMessage =
            error instanceof CommercialApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : '操作失败';
          setBatchNotice(
            error instanceof CommercialApiError && error.code === 'stale_write'
              ? STALE_WRITE_MESSAGE
              : `停在「${step.name}」：${detailMessage}`,
          );
          setAdvancePrompt(null);
          return;
        }
      }
      try {
        const token = await readToken(nodeId);
        await advanceCommercialNode(projectId!, nodeId, token);
      } catch (error) {
        await queryClient.invalidateQueries({ queryKey: ['commercial'] });
        const detailMessage =
          error instanceof CommercialApiError
            ? error.message
            : error instanceof Error
              ? error.message
              : '操作失败';
        setBatchNotice(
          error instanceof CommercialApiError && error.code === 'stale_write'
            ? STALE_WRITE_MESSAGE
            : `停在「${nodeName}」：${detailMessage}`,
        );
        setAdvancePrompt(null);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['commercial'] });
      setBatchNotice(`已完成：${completed.join('、')}。已推进：${nodeName}。`);
      setAdvancePrompt(null);
    } finally {
      batchLock.current = false;
      setBatching(false);
    }
  }

  return (
    <>
      <PageHeader
        title={detail.name}
        description={overallStageLabel(detail.overallStage)}
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '项目', to: '/projects' },
          { label: detail.name },
        ]}
        actions={
          detail.overallStage === 'archived' ? <Badge variant="secondary">已归档</Badge> : null
        }
      />

      <div className="space-y-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">概要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>
                <span className="text-muted-foreground">整体阶段：</span>
                {overallStageLabel(detail.overallStage)}
              </p>
              <p data-testid="summary-in-progress">
                <span className="text-muted-foreground">进行中或阻塞的节点：</span>
                {detail.currentStageNames.length > 0 ? detail.currentStageNames.join('、') : '无'}
              </p>
              {detail.blockingReason ? (
                <p data-testid="summary-blocking-item">
                  <span className="text-muted-foreground">主要阻塞原因：</span>
                  {detail.blockingReason}
                </p>
              ) : null}
              <p>
                <span className="text-muted-foreground">到手金额：</span>
                {formatMoney(detail.netAmount)}
              </p>
              <p>
                <span className="text-muted-foreground">返点金额：</span>
                {formatMoney(detail.rebateAmount)}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">发布记录</CardTitle>
            </CardHeader>
            <CardContent>
              <PublishStatus monitor={detail.monitor} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">开放事项</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <OpenItems
                items={detail.openItems}
                pending={writes.pending}
                onClose={(item, conclusion) => void runClose(item, conclusion)}
                onCancel={(item, reason) => void runCancel(item, reason)}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">完整工作流图</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {advancePrompt ? (
              <div
                className="rounded-md border border-amber-600/40 bg-amber-50 px-3 py-3 text-sm"
                data-testid="predecessor-prompt"
              >
                <p>
                  这些前置节点还没完成：{advancePrompt.steps.map((step) => step.name).join('、')}
                  。要先把它们标成完成，再推进「{advancePrompt.nodeName}」吗？
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={writes.pending || batching}
                    data-testid="predecessor-confirm"
                    onClick={() => void confirmPredecessors()}
                  >
                    确认一并完成
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={writes.pending || batching}
                    data-testid="predecessor-cancel"
                    onClick={() => setAdvancePrompt(null)}
                  >
                    取消
                  </Button>
                </div>
              </div>
            ) : null}
            {batchNotice ? (
              <p className="text-sm" data-testid="predecessor-moved">
                {batchNotice}
              </p>
            ) : null}
            <WorkflowGraphLive
              graph={graph}
              pending={writes.pending}
              feedback={writes.feedback}
              onCommand={(nodeId, command) => {
                if (command === 'advance') {
                  considerAdvance(nodeId);
                  return;
                }
                setAdvancePrompt(null);
                void runNode(nodeId, command);
              }}
              onBlock={(nodeId, reason) => void runBlock(nodeId, reason)}
              onPublish={(nodeId, draft) => void runPublish(nodeId, draft)}
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

function PublishStatus({ monitor }: { monitor: CommercialProjectDetail['monitor'] }) {
  if (!monitor.publish && monitor.jobs.length === 0) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="publish-status">
        尚未发布。在「发布」节点进行中时，完成操作会要求填写平台和视频。
      </p>
    );
  }
  return (
    <div className="space-y-2 text-sm" data-testid="publish-status">
      {monitor.publish ? (
        <div data-testid="publish-record">
          <p>
            已发布 · {monitor.publish.bvid}
            {monitor.publish.platform ? ` · ${monitor.publish.platform}` : ''}
          </p>
          <p className="text-muted-foreground">
            {monitor.publish.publishedAt} · {monitor.publish.publishSource}
          </p>
        </div>
      ) : (
        <p className="text-muted-foreground">没有发布记录。</p>
      )}
      {monitor.jobs.length > 0 ? (
        <ul className="space-y-1">
          {monitor.jobs.map((job) => (
            <li key={job.id} data-testid={`monitor-job-${job.jobType}`}>
              {job.jobType === 'metadata' ? '元数据任务' : '指标任务'} · {job.status}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground">没有监控任务。</p>
      )}
    </div>
  );
}

function OpenItems({
  items,
  pending,
  onClose,
  onCancel,
}: {
  items: CommercialDetailOpenItem[];
  pending: boolean;
  onClose: (item: CommercialDetailOpenItem, conclusion: string) => void;
  onCancel: (item: CommercialDetailOpenItem, reason: string) => void;
}) {
  if (items.length === 0) {
    return <p className="text-muted-foreground">当前没有开放事项。</p>;
  }
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <OpenItemRow
          key={item.id}
          item={item}
          pending={pending}
          onClose={onClose}
          onCancel={onCancel}
        />
      ))}
    </ul>
  );
}

function OpenItemRow({
  item,
  pending,
  onClose,
  onCancel,
}: {
  item: CommercialDetailOpenItem;
  pending: boolean;
  onClose: (item: CommercialDetailOpenItem, conclusion: string) => void;
  onCancel: (item: CommercialDetailOpenItem, reason: string) => void;
}) {
  const [conclusion, setConclusion] = useState('');
  const [reason, setReason] = useState('');
  return (
    <li className="space-y-2 rounded-md border px-3 py-2" data-testid={`open-item-${item.id}`}>
      <p className="font-medium">{item.title}</p>
      <p className="text-muted-foreground">
        {item.isPinnedPrimary ? <span data-testid="open-item-pinned">主阻塞事项 · </span> : null}
        {lifecycleLabel(item.lifecycle)}
        {item.impact === 'blocking' ? ' · 阻塞' : ''}
      </p>
      {item.lifecycle === 'open' ? (
        <>
          <Label className="space-y-1 text-xs text-muted-foreground">
            <span>关闭结论（可选）</span>
            <Input
              value={conclusion}
              onChange={(event) => setConclusion(event.target.value)}
              data-testid={`open-item-conclusion-${item.id}`}
              disabled={pending}
            />
          </Label>
          <Button
            type="button"
            size="sm"
            disabled={pending}
            data-testid={`open-item-close-${item.id}`}
            onClick={() => onClose(item, conclusion)}
          >
            关闭
          </Button>
          <Label className="space-y-1 text-xs text-muted-foreground">
            <span>取消原因</span>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              data-testid={`open-item-cancel-reason-${item.id}`}
              disabled={pending}
            />
          </Label>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || reason.trim().length === 0}
            data-testid={`open-item-cancel-${item.id}`}
            onClick={() => onCancel(item, reason)}
          >
            取消事项
          </Button>
        </>
      ) : null}
    </li>
  );
}

function lifecycleLabel(lifecycle: CommercialDetailOpenItem['lifecycle']): string {
  if (lifecycle === 'closed') return '已关闭';
  if (lifecycle === 'cancelled') return '已取消';
  return '开放';
}
