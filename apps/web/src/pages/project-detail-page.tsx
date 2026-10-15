import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type {
  CommercialOpenItemSnapshot,
  CommercialPinnedBlockItem,
  CommercialProjectDetail,
  CommercialPublishRequest,
  CommercialPublishResponse,
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
  optionalNamesForWorkflow,
  overallStageLabel,
} from '@/features/commercial/commercial-view';
import type { PublishDraft } from '@/features/commercial/components/node-action-panel';
import { WorkflowGraphLive } from '@/features/commercial/components/workflow-graph-live';
import type { NodeCommand } from '@/features/commercial/node-actions';
import {
  useCommercialProjectDetailQuery,
  useCommercialWorkflowQuery,
  useCommercialWrites,
  useDefaultCommercialTemplateQuery,
} from '@/features/commercial/use-commercial-queries';

type SessionItem = {
  id: string;
  title: string;
  updatedAt: string;
  lifecycle: CommercialOpenItemSnapshot['lifecycle'];
  pinned: boolean;
  cancelReason: string | null;
};

function sessionFromPinned(item: CommercialPinnedBlockItem): SessionItem {
  return {
    id: item.id,
    title: item.title,
    updatedAt: item.updatedAt,
    lifecycle: item.lifecycle,
    pinned: true,
    cancelReason: null,
  };
}

function sessionFromSnapshot(item: CommercialOpenItemSnapshot, pinned: boolean): SessionItem {
  return {
    id: item.id,
    title: item.title,
    updatedAt: item.updatedAt,
    lifecycle: item.lifecycle,
    pinned,
    cancelReason: item.cancelReason,
  };
}

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
  const templateQuery = useDefaultCommercialTemplateQuery();
  const writes = useCommercialWrites(projectId ?? '');
  const [sessionItem, setSessionItem] = useState<SessionItem | null>(null);
  const [publishResult, setPublishResult] = useState<CommercialPublishResponse | null>(null);
  const [closeConclusion, setCloseConclusion] = useState('');
  const [cancelReason, setCancelReason] = useState('');

  const optionalNames = useMemo(
    () => optionalNamesForWorkflow(workflowQuery.data?.templateVersionId ?? '', templateQuery.data),
    [templateQuery.data, workflowQuery.data?.templateVersionId],
  );

  const graph = useMemo(() => {
    if (!workflowQuery.data) return null;
    return graphFromWorkflow(workflowQuery.data, {
      optionalNames,
      blockingReason: detailQuery.data?.blockingReason ?? null,
    });
  }, [detailQuery.data?.blockingReason, optionalNames, workflowQuery.data]);

  const waiting =
    detailQuery.isLoading ||
    workflowQuery.isLoading ||
    (templateQuery.isLoading && templateQuery.data == null);

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
    const outcome = await writes.run(send);
    if (outcome.feedback.kind === 'stale') {
      setSessionItem(null);
      return;
    }
    if (outcome.result?.pinnedItem) setSessionItem(sessionFromPinned(outcome.result.pinnedItem));
  }

  async function runBlock(nodeId: string, reason: string | null) {
    const expectedUpdatedAt = tokenFor(nodeId);
    if (!expectedUpdatedAt) return;
    const outcome = await writes.run(() =>
      blockCommercialNode(projectId!, nodeId, expectedUpdatedAt, reason),
    );
    if (outcome.feedback.kind === 'stale') {
      setSessionItem(null);
      return;
    }
    if (outcome.result?.pinnedItem) setSessionItem(sessionFromPinned(outcome.result.pinnedItem));
    else if (outcome.feedback.kind === 'ok') setSessionItem(null);
  }

  async function runPublish(nodeId: string, draft: PublishDraft) {
    const expectedUpdatedAt = tokenFor(nodeId);
    if (!expectedUpdatedAt) return;
    const outcome = await writes.run(() =>
      publishCommercialNode(projectId!, nodeId, publishRequest(expectedUpdatedAt, draft)),
    );
    if (outcome.feedback.kind === 'stale') return;
    if (outcome.result) setPublishResult(outcome.result);
  }

  async function runClose() {
    if (!sessionItem || sessionItem.lifecycle !== 'open') return;
    const conclusion = closeConclusion.trim();
    const outcome = await writes.run(() =>
      closeCommercialOpenItem(projectId!, sessionItem.id, {
        expectedUpdatedAt: sessionItem.updatedAt,
        ...(conclusion.length > 0 ? { closeConclusion: conclusion } : {}),
      }),
    );
    if (outcome.feedback.kind === 'stale') {
      setSessionItem(null);
      return;
    }
    if (outcome.result) {
      setSessionItem(sessionFromSnapshot(outcome.result.item, sessionItem.pinned));
      setCloseConclusion('');
    }
  }

  async function runCancel() {
    if (!sessionItem || sessionItem.lifecycle !== 'open') return;
    const reason = cancelReason.trim();
    if (!reason) return;
    const outcome = await writes.run(() =>
      cancelCommercialOpenItem(projectId!, sessionItem.id, {
        expectedUpdatedAt: sessionItem.updatedAt,
        cancelReason: reason,
      }),
    );
    if (outcome.feedback.kind === 'stale') {
      setSessionItem(null);
      return;
    }
    if (outcome.result) {
      setSessionItem(sessionFromSnapshot(outcome.result.item, sessionItem.pinned));
      setCancelReason('');
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
              <PublishStatus publish={detail.publish} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">开放事项</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <OpenItems
                detail={detail}
                sessionItem={sessionItem}
                pending={writes.pending}
                closeConclusion={closeConclusion}
                cancelReason={cancelReason}
                onCloseConclusion={setCloseConclusion}
                onCancelReason={setCancelReason}
                onClose={() => void runClose()}
                onCancel={() => void runCancel()}
              />
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">完整工作流图</CardTitle>
          </CardHeader>
          <CardContent>
            {templateQuery.isError ? (
              <p className="mb-3 text-xs text-muted-foreground">
                默认模板没有加载成功，暂时不提供「不适用」。节点状态仍然来自这个项目的流程接口。
              </p>
            ) : null}
            {!templateQuery.isError &&
            templateQuery.data &&
            templateQuery.data.id !== workflow.templateVersionId ? (
              <p className="mb-3 text-xs text-muted-foreground">
                这个项目用的模板版本不是当前已发布的默认流程，页面不知道哪些节点可选，所以不提供「不适用」。
              </p>
            ) : null}
            <WorkflowGraphLive
              graph={graph}
              pending={writes.pending}
              feedback={writes.feedback}
              publishResult={publishResult}
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

function PublishStatus({ publish }: { publish: CommercialProjectDetail['publish'] }) {
  if (!publish.published) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="publish-status">
        尚未发布。在「发布」节点进行中时，完成操作会要求填写平台和视频。
      </p>
    );
  }
  return (
    <div className="space-y-1 text-sm" data-testid="publish-status">
      <p>已发布 · {publish.bvid}</p>
      <p className="text-muted-foreground">
        {publish.publishedAt} · {publish.publishSource}
      </p>
    </div>
  );
}

function OpenItems({
  detail,
  sessionItem,
  pending,
  closeConclusion,
  cancelReason,
  onCloseConclusion,
  onCancelReason,
  onClose,
  onCancel,
}: {
  detail: CommercialProjectDetail;
  sessionItem: SessionItem | null;
  pending: boolean;
  closeConclusion: string;
  cancelReason: string;
  onCloseConclusion: (value: string) => void;
  onCancelReason: (value: string) => void;
  onClose: () => void;
  onCancel: () => void;
}) {
  return (
    <>
      {detail.blockingReason ? (
        <p data-testid="project-blocking-reason">读取到的阻塞原因：{detail.blockingReason}</p>
      ) : (
        <p className="text-muted-foreground">当前读取结果里没有阻塞原因。</p>
      )}
      <p className="text-xs text-muted-foreground">
        项目读取接口只返回阻塞原因的标题，不返回事项编号和更新时间。关闭和取消只能针对刚才写入接口返回的事项；刷新之后，已有事项不能从这里提交。
      </p>
      {sessionItem ? (
        <div className="space-y-3 rounded-md border px-3 py-2" data-testid="session-open-item">
          <p className="font-medium">{sessionItem.title}</p>
          <p className="text-muted-foreground">
            {sessionItem.pinned ? '主阻塞事项' : '开放事项'} ·{' '}
            {lifecycleLabel(sessionItem.lifecycle)}
          </p>
          {sessionItem.cancelReason ? <p>取消原因：{sessionItem.cancelReason}</p> : null}
          {sessionItem.lifecycle === 'open' ? (
            <>
              <Label className="space-y-1 text-xs text-muted-foreground">
                <span>关闭结论（可选）</span>
                <Input
                  value={closeConclusion}
                  onChange={(event) => onCloseConclusion(event.target.value)}
                  data-testid="open-item-conclusion"
                  disabled={pending}
                />
              </Label>
              <Button
                type="button"
                size="sm"
                disabled={pending}
                data-testid="open-item-close"
                onClick={onClose}
              >
                关闭
              </Button>
              <Label className="space-y-1 text-xs text-muted-foreground">
                <span>取消原因</span>
                <Input
                  value={cancelReason}
                  onChange={(event) => onCancelReason(event.target.value)}
                  data-testid="open-item-cancel-reason"
                  disabled={pending}
                />
              </Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || cancelReason.trim().length === 0}
                data-testid="open-item-cancel"
                onClick={onCancel}
              >
                取消事项
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function lifecycleLabel(lifecycle: SessionItem['lifecycle']): string {
  if (lifecycle === 'closed') return '已关闭';
  if (lifecycle === 'cancelled') return '已取消';
  return '开放';
}
