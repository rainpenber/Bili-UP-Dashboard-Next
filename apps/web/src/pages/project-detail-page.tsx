import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  CommercialDetailOpenItem,
  CommercialProjectDetail,
  CommercialPublishRequest,
} from '@studio/contracts';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  advanceCommercialNode,
  blockCommercialNode,
  cancelCommercialOpenItem,
  closeCommercialOpenItem,
  completeCommercialNode,
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
          <CardContent>
            <WorkflowGraphLive
              graph={graph}
              pending={writes.pending}
              feedback={writes.feedback}
              onCommand={(nodeId, command) => void runNode(nodeId, command)}
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
