import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Pencil } from 'lucide-react';
import type { CommercialStepPublish } from '@studio/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { stageIdForNode, type TimelineChild } from '../progress-timeline';

const STATUS_WORD: Record<string, string> = {
  not_reached: '未开始',
  in_progress: '进行中',
  completed: '完成',
  blocked: '阻塞',
  not_applicable: '不适用',
};

export type StepCall = {
  kind: 'node' | 'stage';
  nodeId: string | null;
  stageId: string | null;
  direction: 'forward' | 'rollback';
  expectedUpdatedAt: string | null;
  tokens: { nodeId: string; expectedUpdatedAt: string }[];
  force: boolean;
  publish: CommercialStepPublish | null;
};

export type StepEffectView = {
  nodeId: string;
  nodeName: string;
  from: string;
  to: string;
};

export type StepBlockView = {
  nodeId: string;
  nodeName: string;
  reason: string | null;
};

export type StepSuccessorView = {
  nodeId: string;
  nodeName: string;
  templateSlug: string | null;
};

export type StepResult =
  | { ok: true }
  | {
      ok: false;
      message: string;
      code: string;
      blocks: StepBlockView[];
      effects: StepEffectView[];
      successors: StepSuccessorView[];
    };

export type RecordedPublish = {
  bvid: string;
  publishedAt: string;
  idempotencyKey: string;
};

export type StepEditor = {
  disabled: boolean;
  onStep: (call: StepCall) => Promise<StepResult>;
  onRefresh: () => void;
  /** Set when this project already has a publish record, including after the publish node was rolled back. */
  recordedPublish?: RecordedPublish | null;
};

type PendingCall = StepCall;

export function useStepController(
  editor: StepEditor | undefined,
  onLocate: (stageId: string) => void,
) {
  const lock = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successors, setSuccessors] = useState<StepSuccessorView[]>([]);
  const [confirm, setConfirm] = useState<{
    call: PendingCall;
    result: Exclude<StepResult, { ok: true }>;
  } | null>(null);
  const [publish, setPublish] = useState<{
    call: PendingCall;
    key: string;
    bvid: string;
    publishedAt: string;
  } | null>(null);

  const run = async (call: PendingCall) => {
    if (!editor || editor.disabled || lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    setSuccessors([]);
    try {
      const result = await editor.onStep(call);
      if (result.ok) {
        setConfirm(null);
        setPublish(null);
        return;
      }
      if (result.code === 'confirmation_required') {
        setPublish(null);
        setConfirm({ call, result });
        return;
      }
      if (result.code === 'publish_required') {
        setConfirm(null);
        const recorded = editor.recordedPublish ?? null;
        setPublish({
          call,
          key: recorded?.idempotencyKey ?? crypto.randomUUID(),
          bvid: recorded?.bvid ?? '',
          publishedAt: recorded?.publishedAt ?? '',
        });
        return;
      }
      setConfirm(null);
      setPublish(null);
      setError(result.message);
      setSuccessors(result.successors);
    } catch (err) {
      setConfirm(null);
      setPublish(null);
      setSuccessors([]);
      setError(
        err instanceof Error && err.message.trim().length > 0 ? err.message : '网络异常，请重试',
      );
    } finally {
      lock.current = false;
      setPending(false);
    }
  };

  return {
    pending,
    error,
    successors,
    confirm,
    publish,
    run,
    cancelConfirm: () => setConfirm(null),
    cancelPublish: () => setPublish(null),
    locate: (slug: string | null) => {
      if (!slug) return;
      const stageId = stageIdForNode(slug);
      if (stageId) onLocate(stageId);
    },
    refresh: () => editor?.onRefresh(),
  };
}

export type StepController = ReturnType<typeof useStepController>;

export type StepActionSpec = {
  direction: 'forward' | 'rollback';
  label: string;
  variant: 'default' | 'secondary' | 'ghost' | 'destructive';
};

/** One policy for node cards, the stage bar, and the stage tooltip. */
export function stepActionSpecs(status: string, scope: 'node' | 'stage'): StepActionSpec[] {
  if (status === 'not_reached') {
    return [{ direction: 'forward', label: '推进', variant: 'default' }];
  }
  if (status === 'in_progress') {
    return [
      { direction: 'forward', label: '完成', variant: 'default' },
      { direction: 'rollback', label: '回退', variant: 'secondary' },
    ];
  }
  if (status === 'completed') {
    return [{ direction: 'rollback', label: '回退', variant: 'destructive' }];
  }
  if (status === 'blocked') {
    return [
      {
        direction: 'forward',
        label: scope === 'stage' ? '处理阻塞并完成' : '解除阻塞',
        variant: 'default',
      },
    ];
  }
  if (status === 'not_applicable') {
    return [{ direction: 'rollback', label: '回退', variant: 'ghost' }];
  }
  return [];
}

function StepActionButtons({
  specs,
  status,
  pending,
  ready,
  surface,
  nodeId,
  stageId,
  className,
  onActivate,
}: {
  specs: StepActionSpec[];
  status: string;
  pending: boolean;
  ready: boolean;
  surface: 'detail' | 'tooltip';
  nodeId?: string;
  stageId?: string;
  className?: string;
  onActivate: (direction: 'forward' | 'rollback') => void;
}) {
  if (specs.length === 0) return null;
  return (
    <div
      className={['flex min-w-0 flex-wrap items-center gap-2', className].filter(Boolean).join(' ')}
      data-testid={nodeId ? 'node-step-actions' : 'stage-step-actions'}
      data-surface={surface}
      data-status={status}
    >
      {specs.map((spec) => (
        <Button
          key={spec.direction}
          type="button"
          size="sm"
          variant={spec.variant}
          className="h-7 px-2 text-xs"
          disabled={pending || !ready}
          data-testid={
            nodeId
              ? spec.direction === 'forward'
                ? 'node-step'
                : 'node-rollback'
              : spec.direction === 'forward'
                ? 'stage-step'
                : 'stage-rollback'
          }
          data-variant={spec.variant}
          data-status={status}
          data-pending={pending ? 'true' : 'false'}
          {...(nodeId ? { 'data-node-id': nodeId } : {})}
          {...(stageId ? { 'data-stage-id': stageId } : {})}
          onClick={(event) => {
            event.stopPropagation();
            onActivate(spec.direction);
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {spec.label}
        </Button>
      ))}
    </div>
  );
}

export function StageStepBar({
  stageId,
  status,
  members,
  controller,
  surface = 'detail',
}: {
  stageId: string;
  status: string;
  members: TimelineChild[];
  controller: StepController;
  surface?: 'detail' | 'tooltip';
}) {
  const tokens = members.flatMap((child) =>
    child.updatedAt ? [{ nodeId: child.id, expectedUpdatedAt: child.updatedAt }] : [],
  );
  const ready = tokens.length === members.length && members.length > 0;
  const call = (direction: 'forward' | 'rollback'): StepCall => ({
    kind: 'stage',
    nodeId: null,
    stageId,
    direction,
    expectedUpdatedAt: null,
    tokens,
    force: false,
    publish: null,
  });
  return (
    <StepActionButtons
      specs={stepActionSpecs(status, 'stage')}
      status={status}
      pending={controller.pending}
      ready={ready}
      surface={surface}
      stageId={stageId}
      onActivate={(direction) => void controller.run(call(direction))}
    />
  );
}

export function NodeStepActions({
  child,
  controller,
}: {
  child: TimelineChild;
  controller: StepController;
}) {
  const ready = Boolean(child.updatedAt);
  const call = (direction: 'forward' | 'rollback'): StepCall => ({
    kind: 'node',
    nodeId: child.id,
    stageId: null,
    direction,
    expectedUpdatedAt: child.updatedAt,
    tokens: child.updatedAt ? [{ nodeId: child.id, expectedUpdatedAt: child.updatedAt }] : [],
    force: false,
    publish: null,
  });
  return (
    <StepActionButtons
      specs={stepActionSpecs(child.status, 'node')}
      status={child.status}
      pending={controller.pending}
      ready={ready}
      surface="detail"
      nodeId={child.nodeId}
      className="mt-2"
      onActivate={(direction) => void controller.run(call(direction))}
    />
  );
}

export function PlanEditButton({
  name,
  nodeId,
  onOpen,
}: {
  name: string;
  nodeId: string;
  onOpen: () => void;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="size-7 shrink-0 p-0 text-muted-foreground"
      aria-label={`${name}编辑计划日期`}
      data-testid={`plan-date-edit-${nodeId}`}
      onClick={onOpen}
    >
      <Pencil className="size-3.5" />
    </Button>
  );
}

export function StepNotices({ controller }: { controller: StepController }) {
  const confirmCompletes =
    controller.confirm?.result.effects.some((item) => item.to === 'completed') ?? false;
  const confirmLabel = confirmCompletes ? '强制推进并标记前置完成' : '关闭阻塞并恢复';
  return (
    <>
      {controller.error ? (
        <div className="mb-2 space-y-1" role="alert" data-testid="step-error">
          <p className="text-xs text-destructive">{controller.error}</p>
          {controller.successors.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {controller.successors.map((item) => (
                <Button
                  key={item.nodeId}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  data-testid={`step-locate-${item.nodeId}`}
                  onClick={() => controller.locate(item.templateSlug)}
                >
                  查看{item.nodeName}
                </Button>
              ))}
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            data-testid="step-refresh"
            onClick={() => controller.refresh()}
          >
            刷新后重试
          </Button>
        </div>
      ) : null}
      {controller.confirm
        ? createPortal(
            <div
              data-step-layer="confirm"
              className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
            >
              <div
                role="dialog"
                aria-modal="true"
                data-testid="step-confirm"
                className="max-h-[80vh] w-full max-w-md overflow-auto rounded-lg border bg-background p-4 text-sm shadow-lg"
              >
                <p className="font-medium">这次会改这些节点</p>
                <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                  {controller.confirm.result.effects.map((item) => (
                    <li key={item.nodeId}>
                      {item.nodeName}：{STATUS_WORD[item.from] ?? item.from} →{' '}
                      {STATUS_WORD[item.to] ?? item.to}
                    </li>
                  ))}
                </ul>
                {controller.confirm.result.blocks.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs">
                    {controller.confirm.result.blocks.map((item) => (
                      <li key={item.nodeId} data-testid="step-block-reason">
                        {item.nodeName}阻塞：{item.reason ?? '尚未记录原因'}
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="mt-2 text-xs text-muted-foreground">
                  {confirmCompletes
                    ? '确认后关闭这些阻塞事项，并按上面的结果写入。取消则不会改任何数据。'
                    : '确认后关闭阻塞事项并恢复为进行中，本次不标记完成。之后可以再点一次完成。取消则不会改任何数据。'}
                </p>
                <div className="mt-3 flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    data-testid="step-confirm-cancel"
                    onClick={controller.cancelConfirm}
                  >
                    取消
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    data-testid="step-confirm-force"
                    disabled={controller.pending}
                    onClick={() =>
                      void controller.run({ ...controller.confirm!.call, force: true })
                    }
                  >
                    {confirmLabel}
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {controller.publish
        ? createPortal(
            <PublishDialog
              pending={controller.pending}
              onCancel={controller.cancelPublish}
              onSubmit={(publish) =>
                void controller.run({ ...controller.publish!.call, force: true, publish })
              }
              idempotencyKey={controller.publish.key}
              initialBvid={controller.publish.bvid}
              initialPublishedAt={controller.publish.publishedAt}
              reusesRecord={controller.publish.bvid.length > 0}
            />,
            document.body,
          )
        : null}
    </>
  );
}

function localDateTimeValue(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function PublishDialog({
  pending,
  idempotencyKey,
  initialBvid,
  initialPublishedAt,
  reusesRecord,
  onCancel,
  onSubmit,
}: {
  pending: boolean;
  idempotencyKey: string;
  initialBvid: string;
  initialPublishedAt: string;
  reusesRecord: boolean;
  onCancel: () => void;
  onSubmit: (publish: CommercialStepPublish) => void;
}) {
  const [bvid, setBvid] = useState(initialBvid);
  const [publishedAt, setPublishedAt] = useState(
    initialPublishedAt ? localDateTimeValue(initialPublishedAt) : '',
  );
  const [localError, setLocalError] = useState<string | null>(null);
  return (
    <div
      data-step-layer="publish"
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
    >
      <form
        role="dialog"
        aria-modal="true"
        data-testid="step-publish"
        className="w-full max-w-md rounded-lg border bg-background p-4 text-sm shadow-lg"
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = bvid.trim();
          if (!/^BV[0-9A-Za-z]+$/.test(trimmed)) {
            setLocalError('请填写 BV 号');
            return;
          }
          const stamp = publishedAt ? new Date(publishedAt).toISOString() : null;
          if (publishedAt && Number.isNaN(Date.parse(stamp ?? ''))) {
            setLocalError('发布时间无法读取');
            return;
          }
          setLocalError(null);
          onSubmit({
            idempotencyKey,
            platform: 'bilibili',
            bvid: trimmed,
            ...(stamp ? { publishedAt: stamp } : {}),
            publishSource: 'web',
          });
        }}
      >
        <p className="font-medium">补上发布信息</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {reusesRecord
            ? '将沿用已记录的发布信息和原来的幂等键，不会新建监控任务。取消则这次不会改任何节点。'
            : '发布节点要在同一次提交里记下 BV 号。取消则这次不会改任何节点，也不会请求外网。'}
        </p>
        <label className="mt-3 block space-y-1 text-xs text-muted-foreground">
          BV 号
          <Input
            value={bvid}
            data-testid="step-publish-bvid"
            aria-label="BV 号"
            onChange={(event) => setBvid(event.target.value)}
          />
        </label>
        <label className="mt-2 block space-y-1 text-xs text-muted-foreground">
          发布时间
          <Input
            type="datetime-local"
            value={publishedAt}
            data-testid="step-publish-at"
            aria-label="发布时间"
            onChange={(event) => setPublishedAt(event.target.value)}
          />
        </label>
        {localError ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {localError}
          </p>
        ) : null}
        <div className="mt-3 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="step-publish-cancel"
            onClick={onCancel}
          >
            取消
          </Button>
          <Button type="submit" size="sm" disabled={pending} data-testid="step-publish-submit">
            记录发布并继续
          </Button>
        </div>
      </form>
    </div>
  );
}
