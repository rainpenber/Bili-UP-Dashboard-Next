import { useEffect, useRef, useState } from 'react';
import {
  NodeStepActions,
  PlanEditButton,
  StageStepBar,
  StepNotices,
  useStepController,
  type StepEditor,
} from './stage-step-controls';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatYuan } from '../commercial-selectors';
import {
  calendarDayKey,
  deriveKeySchedule,
  formatScheduleLabel,
  type KeySchedule,
} from '../node-schedule';
import {
  deriveProgressTimeline,
  stageSituationLabel,
  type DerivedPoint,
  type DerivedStage,
  type TimelineChild,
  type TimelineProjectFacts,
  type TimelineSourceNode,
} from '../progress-timeline';
import { DEMO_STATUS_COLOR } from '../workflow-status-map';
import type { MockStatus } from '../../workflow-mock/flow-nodes';
import { AnchoredRecordOverlay, RecordOverlayList, type RecordOverlayItem } from './record-overlay';

/** Bottom of the stage wash. 0x1f / 255 ≈ 0.12, inside the 0.10–0.14 band. */
const HIGHLIGHT_ALPHA = '1f';

function isStageChrome(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    Boolean(
      target.closest('[data-testid="progress-stage-tooltip"]') ||
      target.closest('[data-testid="progress-stage"]'),
    )
  );
}

/** Keyboard focus is actually inside this stage trigger or its tooltip, not a stale id. */
function stageChromeHoldsFocus(stageId: string): boolean {
  const active = document.activeElement;
  if (!(active instanceof Element) || active === document.body) return false;
  const tip = active.closest('[data-testid="progress-stage-tooltip"]');
  if (tip?.getAttribute('data-stage-id') === stageId) return true;
  const stage = active.closest('[data-testid="progress-stage"]');
  return stage?.getAttribute('data-stage-id') === stageId;
}

export type PlanEditor = {
  disabled: boolean;
  savingId: string | null;
  error: { nodeId: string; message: string } | null;
  onSave: (nodeId: string, updatedAt: string, plannedAt: string | null) => void;
};

function moneyLabel(value: string | null): string {
  if (value === null) return '未填写';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return formatYuan(amount);
}

function statusBadgeVariant(status: MockStatus): 'success' | 'info' | 'destructive' | 'secondary' {
  if (status === 'done') return 'success';
  if (status === 'active') return 'info';
  if (status === 'blocked') return 'destructive';
  return 'secondary';
}

function blockCaptionLines(label: string): string {
  return label.replaceAll('、', '\n');
}

function childItems(stage: DerivedStage): RecordOverlayItem[] {
  return stage.children.map((child) => ({
    id: child.id,
    name: child.name,
    status: child.status,
    demoStatus: child.demoStatus,
    statusLabel: child.statusLabel,
    blockingReason: child.blockingReason,
    planLabel: child.plannedAt ? formatScheduleLabel(child.plannedAt) : null,
    actualLabel: child.completedAt ? formatScheduleLabel(child.completedAt) : null,
  }));
}

function PointMark({ point }: { point: DerivedPoint }) {
  const color = DEMO_STATUS_COLOR[point.demoStatus];
  return (
    <span
      className="size-4 rounded-full border-2"
      style={{
        borderColor: color,
        background: point.demoStatus === 'idle' ? 'transparent' : color,
        boxShadow: point.demoStatus === 'done' ? `0 0 0 3px ${color}22` : undefined,
      }}
      aria-hidden
    />
  );
}

function StageHit({
  stage,
  end,
  selected,
  hovered,
  focused,
  onToggle,
  onHover,
  onHoverEnd,
  onFocus,
  onBlur,
  onDismiss,
  onRegister,
}: {
  stage: DerivedStage;
  end: DerivedPoint;
  selected: boolean;
  hovered: boolean;
  focused: boolean;
  onToggle: () => void;
  onHover: (id: string) => void;
  onHoverEnd: (id: string) => void;
  onFocus: (id: string) => void;
  onBlur: (id: string) => void;
  onDismiss: () => void;
  onRegister: (id: string, node: HTMLButtonElement | null) => void;
}) {
  const color = DEMO_STATUS_COLOR[stage.demoStatus];
  const caption = stageSituationLabel(stage);
  const maskOn = selected || hovered || focused;
  const fromPointer = useRef(false);
  return (
    <button
      type="button"
      ref={(node) => onRegister(stage.id, node)}
      className="group relative flex min-w-[12rem] flex-1 flex-col rounded-md text-left"
      data-testid="progress-stage"
      data-stage-id={stage.id}
      data-status={stage.demoStatus}
      data-workflow-status={stage.status}
      data-current={stage.current ? 'true' : 'false'}
      data-selected={selected ? 'true' : 'false'}
      data-state={hovered || focused ? 'open' : 'closed'}
      aria-expanded={selected}
      onClick={onToggle}
      onPointerDown={() => {
        fromPointer.current = true;
      }}
      onPointerEnter={(event) => {
        if (event.pointerType === 'touch') return;
        onHover(stage.id);
      }}
      onPointerMove={(event) => {
        if (event.pointerType === 'touch') return;
        onHover(stage.id);
      }}
      onPointerLeave={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Element && next.closest('[data-testid="progress-stage-tooltip"]'))
          return;
        onHoverEnd(stage.id);
      }}
      onFocus={() => {
        if (fromPointer.current) return;
        onFocus(stage.id);
      }}
      onBlur={(event) => {
        fromPointer.current = false;
        const next = event.relatedTarget;
        if (
          next instanceof Element &&
          (next.closest('[data-testid="progress-stage-tooltip"]') ||
            next.closest('[data-testid="progress-stage"]'))
        ) {
          return;
        }
        onBlur(stage.id);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && (hovered || focused)) {
          event.preventDefault();
          event.stopPropagation();
          onDismiss();
          return;
        }
        if (event.key !== 'Tab' || event.shiftKey || (!hovered && !focused)) return;
        const tip = document.querySelector('[data-testid="progress-stage-tooltip"]');
        if (tip?.getAttribute('data-stage-id') !== stage.id) return;
        const button = tip.querySelector<HTMLElement>('button:not([disabled])');
        if (!button) return;
        event.preventDefault();
        button.focus();
      }}
    >
      <span
        data-testid="progress-stage-mask"
        data-visible={maskOn ? 'true' : 'false'}
        className={cn(
          'pointer-events-none absolute inset-0 rounded-md bg-foreground/[0.06] ring-1 ring-foreground/15 transition-opacity duration-150 motion-reduce:transition-none',
          maskOn ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden
      />
      <span className="relative z-10 flex items-end">
        <span className="flex min-w-[8rem] flex-1 flex-col justify-end">
          {caption ? (
            <span className="relative mb-1">
              <span
                data-testid="progress-stage-gradient"
                data-highlight="block"
                data-alpha="0.12"
                className="pointer-events-none absolute inset-0 rounded-t-md"
                style={{
                  backgroundImage: `linear-gradient(to top, ${color}${HIGHLIGHT_ALPHA}, transparent)`,
                }}
                aria-hidden
              />
              <span
                data-testid="progress-stage-line-label"
                className="relative z-10 block px-1 py-2 text-center text-xs leading-snug font-medium whitespace-pre-line"
                style={{ color }}
              >
                {blockCaptionLines(caption)}
              </span>
            </span>
          ) : null}
          <span className="flex h-6 items-center">
            <span
              data-testid="progress-stage-line"
              className="block w-full rounded-full"
              style={{ height: stage.current ? 5 : 4, background: color }}
              aria-hidden
            />
          </span>
        </span>
        <span
          className="flex w-16 shrink-0 flex-col justify-end"
          data-testid="progress-point"
          data-point-id={end.id}
          data-status={end.demoStatus}
          data-workflow-status={end.status}
        >
          <span className="flex h-6 items-center justify-center">
            <PointMark point={end} />
          </span>
        </span>
      </span>
      <span className="relative z-10 mt-1 flex min-h-8 text-xs leading-snug">
        <span
          className={cn(
            'min-w-0 flex-1 text-center',
            stage.current ? 'font-medium' : 'text-muted-foreground',
          )}
          style={stage.current ? { color } : undefined}
        >
          {stage.label}
          {stage.current ? ' · 当前' : ''}
        </span>
        <span
          className="w-16 shrink-0 text-center font-medium"
          style={{ color: DEMO_STATUS_COLOR[end.demoStatus] }}
        >
          {end.label}
        </span>
      </span>
    </button>
  );
}

function PlanFields({ child, editor }: { child: TimelineChild; editor: PlanEditor }) {
  const initial = child.plannedAt ? (calendarDayKey(child.plannedAt) ?? '') : '';
  const [draft, setDraft] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  useEffect(() => setDraft(initial), [initial]);
  const saving = editor.savingId === child.id;
  const remoteError = editor.error?.nodeId === child.id ? editor.error.message : null;
  return (
    <div className="mt-2 space-y-1.5" data-testid="plan-date-editor" data-node-id={child.nodeId}>
      <label className="block space-y-1 text-xs text-muted-foreground">
        计划日期
        <Input
          type="date"
          value={draft}
          disabled={saving}
          aria-label={`${child.name}计划日期`}
          data-testid={`plan-date-${child.nodeId}`}
          onChange={(event) => {
            setDraft(event.target.value);
            setLocalError(null);
          }}
        />
      </label>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="h-7 text-xs"
          disabled={saving}
          data-testid={`plan-date-save-${child.nodeId}`}
          onClick={() => {
            if (!draft) {
              setLocalError('请选择日期');
              return;
            }
            setLocalError(null);
            editor.onSave(child.id, child.updatedAt ?? '', draft);
          }}
        >
          保存
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={saving || !child.plannedAt}
          data-testid={`plan-date-clear-${child.nodeId}`}
          onClick={() => {
            setLocalError(null);
            editor.onSave(child.id, child.updatedAt ?? '', null);
          }}
        >
          清空
        </Button>
      </div>
      {localError || remoteError ? (
        <p className="text-xs text-destructive" role="alert" data-testid="plan-date-error">
          {localError ?? remoteError}
        </p>
      ) : null}
    </div>
  );
}

function StageDetailBody({
  stage,
  planEditor,
  stepEditor,
  step,
}: {
  stage: DerivedStage;
  planEditor?: PlanEditor;
  stepEditor?: StepEditor;
  step: ReturnType<typeof useStepController> | null;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <div className="pb-1">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <p className="font-medium">{stage.label}</p>
        {step && stepEditor && !stepEditor.disabled && stage.children.length > 0 ? (
          <StageStepBar
            stageId={stage.id}
            status={stage.status}
            members={stage.children}
            controller={step}
          />
        ) : null}
      </div>
      {stage.children.length === 0 ? (
        <p className="text-muted-foreground">这个阶段还没有子节点。</p>
      ) : (
        <div
          data-testid="progress-stage-nodes"
          className="grid items-start justify-start gap-2 [grid-template-columns:repeat(auto-fill,minmax(min(100%,16rem),16rem))]"
        >
          {stage.children.map((child) => {
            const planLabel = child.plannedAt ? formatScheduleLabel(child.plannedAt) : null;
            const actualLabel = child.completedAt ? formatScheduleLabel(child.completedAt) : null;
            return (
              <article
                key={child.id}
                className="min-w-0 max-w-full rounded-lg border bg-background px-2.5 py-2 shadow-sm"
                data-testid="progress-stage-node"
                data-node-id={child.nodeId}
                data-status={child.status}
                data-demo-status={child.demoStatus}
                data-workflow-status={child.status}
              >
                <div className="flex items-start gap-1.5">
                  <h4 className="min-w-0 flex-1 break-words text-sm font-medium leading-snug">
                    {child.name}
                  </h4>
                  <Badge className="shrink-0" variant={statusBadgeVariant(child.demoStatus)}>
                    {child.statusLabel}
                  </Badge>
                  {planEditor && !planEditor.disabled ? (
                    <PlanEditButton
                      name={child.name}
                      nodeId={child.nodeId}
                      onOpen={() => setEditingId(child.id)}
                    />
                  ) : null}
                </div>
                {child.status === 'blocked' ? (
                  <p
                    className="mt-1.5 text-sm leading-snug break-words text-muted-foreground"
                    data-testid="progress-blocker"
                    data-node-id={child.nodeId}
                  >
                    {child.blockingReason ?? '尚未记录原因'}
                  </p>
                ) : null}
                {planLabel || actualLabel ? (
                  <p className="mt-1 flex flex-wrap gap-x-2 text-xs leading-snug text-muted-foreground">
                    {planLabel ? <span>计划 {planLabel}</span> : null}
                    {actualLabel ? (
                      <span data-testid="node-completed-at">实际 {actualLabel}</span>
                    ) : null}
                  </p>
                ) : null}
                {planEditor && !planEditor.disabled && editingId === child.id ? (
                  <PlanFields child={child} editor={planEditor} />
                ) : null}
                {step && stepEditor && !stepEditor.disabled ? (
                  <NodeStepActions child={child} controller={step} />
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StageDetail({
  stage,
  planEditor,
  stepEditor,
  step,
}: {
  stage: DerivedStage | null;
  planEditor?: PlanEditor;
  stepEditor?: StepEditor;
  step: ReturnType<typeof useStepController> | null;
}) {
  const [grown, setGrown] = useState(false);
  const open = Boolean(stage);

  const stageId = stage?.id ?? null;
  useEffect(() => {
    if (!stageId) {
      setGrown(false);
      return;
    }
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, [stageId]);

  return (
    <div
      data-testid="progress-stage-detail"
      data-open={open ? 'true' : 'false'}
      className="mt-3 text-sm"
    >
      <div
        data-testid="progress-stage-detail-body"
        data-motion="150ms"
        data-open={open && grown ? 'true' : 'false'}
        className="progress-detail-panel"
      >
        <div className="overflow-hidden">
          {stage ? (
            <StageDetailBody
              stage={stage}
              {...(planEditor ? { planEditor } : {})}
              {...(stepEditor ? { stepEditor } : {})}
              step={step}
            />
          ) : null}
        </div>
      </div>
      {stage ? null : (
        <p className="text-muted-foreground">点击阶段连线或终点，查看这一阶段的子节点。</p>
      )}
    </div>
  );
}

export function ProgressTimeline({
  nodes,
  planEditor,
  stepEditor,
}: {
  nodes: TimelineSourceNode[];
  planEditor?: PlanEditor;
  stepEditor?: StepEditor;
}) {
  const timeline = deriveProgressTimeline(nodes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const closeTimer = useRef<number | null>(null);
  const openStage = timeline.stages.find((stage) => stage.id === selectedId) ?? null;
  const step = useStepController(stepEditor, (stageId) => setSelectedId(stageId));
  const tipId = hoverId ?? focusId;
  const tipStage = timeline.stages.find((stage) => stage.id === tipId) ?? null;
  const shownTip = useRef<DerivedStage | null>(null);
  if (tipStage) shownTip.current = tipStage;
  const overlayStage = tipStage ?? shownTip.current;
  const start = timeline.points[0];
  const pointById = new Map(timeline.points.map((point) => [point.id, point]));
  const anchors = useRef(new Map<string, HTMLButtonElement | null>());
  const anchorRef = useRef<HTMLElement | null>(null);
  if (tipId) anchorRef.current = anchors.current.get(tipId) ?? anchorRef.current;

  const cancelClose = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const openHover = (id: string) => {
    cancelClose();
    setHoverId((current) => (current === id ? current : id));
  };
  // The stage and its overlay are 8px apart. Keep it open while the pointer crosses.
  const scheduleClose = (id: string) => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setHoverId((current) => (current === id ? null : current));
      if (!stageChromeHoldsFocus(id)) {
        setFocusId((current) => (current === id ? null : current));
      }
    }, 140);
  };
  const dismissTransient = () => {
    cancelClose();
    setHoverId(null);
    setFocusId(null);
  };

  useEffect(() => cancelClose, []);

  useEffect(() => {
    if (!selectedId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-testid="progress-stage"]')) return;
      if (target.closest('[data-testid="progress-stage-tooltip"]')) return;
      if (target.closest('[data-testid="progress-stage-detail"]')) return;
      if (target.closest('[data-testid="step-confirm"]')) return;
      if (target.closest('[data-testid="step-publish"]')) return;
      if (target.closest('[data-step-layer]')) return;
      if (target.closest('[data-testid="progress-schedule-overlay"]')) return;
      if (target.closest('[data-testid="progress-summary-schedule"]')) return;
      setSelectedId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [selectedId]);

  const escapeState = useRef({
    hoverId,
    focusId,
    selectedId,
    step,
    dismissTransient,
  });
  escapeState.current = { hoverId, focusId, selectedId, step, dismissTransient };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      const latest = escapeState.current;
      if (latest.step.confirm) {
        event.preventDefault();
        latest.step.cancelConfirm();
        return;
      }
      if (latest.step.publish) {
        event.preventDefault();
        latest.step.cancelPublish();
        return;
      }
      if (latest.hoverId || latest.focusId) {
        event.preventDefault();
        latest.dismissTransient();
        return;
      }
      if (latest.selectedId) setSelectedId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">商单进度</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">悬停查看状态，点击查看详情。</p>
      </CardHeader>
      <CardContent>
        <div data-testid="progress-timeline">
          <div className="overflow-x-auto">
            <div className="flex min-w-[64rem] items-end">
              {start ? (
                <div className="flex w-16 shrink-0 flex-col">
                  <span
                    className="flex h-6 items-center justify-center"
                    data-testid="progress-point"
                    data-point-id={start.id}
                    data-status={start.demoStatus}
                    data-workflow-status={start.status}
                  >
                    <PointMark point={start} />
                  </span>
                  <p
                    className="mt-1 min-h-8 text-center text-xs leading-snug font-medium"
                    style={{ color: DEMO_STATUS_COLOR[start.demoStatus] }}
                  >
                    {start.label}
                  </p>
                </div>
              ) : null}
              {timeline.stages.map((stage) => {
                const end = pointById.get(stage.to);
                if (!end) return null;
                return (
                  <StageHit
                    key={stage.id}
                    stage={stage}
                    end={end}
                    selected={selectedId === stage.id}
                    hovered={hoverId === stage.id}
                    focused={focusId === stage.id}
                    onRegister={(id, node) => {
                      anchors.current.set(id, node);
                    }}
                    onHover={openHover}
                    onHoverEnd={scheduleClose}
                    onFocus={(id) => setFocusId(id)}
                    onBlur={(id) => setFocusId((current) => (current === id ? null : current))}
                    onDismiss={dismissTransient}
                    onToggle={() =>
                      setSelectedId((current) => (current === stage.id ? null : stage.id))
                    }
                  />
                );
              })}
            </div>
          </div>
        </div>
        <AnchoredRecordOverlay
          open={Boolean(tipStage)}
          anchorRef={anchorRef}
          title={overlayStage?.label ?? ''}
          testId="progress-stage-tooltip"
          interactive={Boolean(
            stepEditor && !stepEditor.disabled && overlayStage && overlayStage.children.length > 0,
          )}
          {...(overlayStage ? { stageId: overlayStage.id, layoutKey: overlayStage.id } : {})}
          onPointerEnter={() => {
            if (overlayStage) openHover(overlayStage.id);
          }}
          onPointerLeave={() => {
            if (overlayStage) scheduleClose(overlayStage.id);
          }}
          onFocus={(event) => {
            const id = event.currentTarget.getAttribute('data-stage-id');
            if (id) setFocusId(id);
          }}
          onBlur={(event) => {
            const id = event.currentTarget.getAttribute('data-stage-id');
            if (!id) return;
            const next = event.relatedTarget;
            if (isStageChrome(next)) return;
            if (next == null && stageChromeHoldsFocus(id)) return;
            setFocusId((current) => (current === id ? null : current));
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Tab' || !event.shiftKey) return;
            const first = event.currentTarget.querySelector('button:not([disabled])');
            if (event.target !== first) return;
            const id = event.currentTarget.getAttribute('data-stage-id');
            const anchor = id ? anchors.current.get(id) : null;
            if (!anchor) return;
            event.preventDefault();
            anchor.focus();
          }}
        >
          {stepEditor &&
          !stepEditor.disabled &&
          overlayStage &&
          overlayStage.children.length > 0 ? (
            <div
              className="mb-2"
              data-testid="stage-tooltip-actions"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <StageStepBar
                stageId={overlayStage.id}
                status={overlayStage.status}
                members={overlayStage.children}
                controller={step}
                surface="tooltip"
              />
            </div>
          ) : null}
          {overlayStage && overlayStage.children.length === 0 ? (
            <p className="record-overlay-note">这个阶段还没有子节点。</p>
          ) : overlayStage ? (
            <RecordOverlayList items={childItems(overlayStage)} />
          ) : null}
        </AnchoredRecordOverlay>
        {stepEditor ? <StepNotices controller={step} /> : null}
        <StageDetail
          stage={openStage}
          {...(planEditor ? { planEditor } : {})}
          {...(stepEditor ? { stepEditor } : {})}
          step={stepEditor ? step : null}
        />
      </CardContent>
    </Card>
  );
}

function ScheduleCopy({ schedule }: { schedule: KeySchedule }) {
  const summary = schedule.summary;
  if (summary.kind === 'next') {
    return (
      <>
        <p className="text-xs text-muted-foreground">下一次交付</p>
        <p className="font-medium leading-tight" data-testid="progress-next-name">
          {summary.name}
        </p>
        <p className="font-medium leading-tight">
          <span data-testid="progress-next-date">{summary.dateLabel}</span>
          {summary.overdue ? (
            <span
              className="ml-1.5 text-xs font-medium text-destructive"
              data-testid="progress-schedule-overdue"
            >
              逾期
            </span>
          ) : null}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">整体阶段 {summary.overallStageLabel}</p>
      </>
    );
  }
  if (summary.kind === 'published') {
    return (
      <>
        <p className="text-xs text-muted-foreground">发布时间</p>
        <p className="font-medium leading-tight">{summary.dateLabel ?? '已发布'}</p>
        <p className="mt-1 text-xs text-muted-foreground">已发布</p>
      </>
    );
  }
  if (summary.kind === 'closed') {
    return (
      <>
        <p className="text-xs text-muted-foreground">商单</p>
        <p className="font-medium leading-tight">{summary.title}</p>
        <p className="mt-1 text-xs text-muted-foreground">无下一交付</p>
      </>
    );
  }
  return (
    <>
      <p className="text-xs text-muted-foreground">排期</p>
      <p className="font-medium leading-tight">排期待确认</p>
      <p className="mt-1 text-xs text-muted-foreground">整体阶段 {summary.overallStageLabel}</p>
    </>
  );
}

function ScheduleOverlayBody({ schedule }: { schedule: KeySchedule }) {
  return (
    <>
      {schedule.records.length > 0 ? <RecordOverlayList items={schedule.records} /> : null}
      {schedule.pendingNames.length > 0 ? (
        <p className="record-overlay-note" data-testid="progress-schedule-pending">
          待安排：{schedule.pendingNames.join('、')}
        </p>
      ) : null}
      {schedule.records.length === 0 && schedule.pendingNames.length === 0 ? (
        <p className="record-overlay-note">暂无关键排期</p>
      ) : null}
    </>
  );
}

function isCoarsePointer(): boolean {
  return window.matchMedia?.('(pointer: coarse)')?.matches ?? false;
}

export function ProgressSummary({
  facts,
  nodes = [],
  now,
}: {
  facts: TimelineProjectFacts | null;
  nodes?: TimelineSourceNode[];
  now?: Date;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const fromPointer = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const schedule = facts ? deriveKeySchedule(nodes, facts, now) : null;

  const cancelClose = () => {
    if (closeTimer.current != null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const enter = () => {
    cancelClose();
    setHover(true);
  };
  /** The card and the overlay are 8px apart. Keep the overlay up while the pointer crosses that gap. */
  const leave = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setHover(false);
    }, 140);
  };
  const dismissHover = () => {
    cancelClose();
    setHover(false);
  };

  useEffect(() => cancelClose, []);

  if (!facts || !schedule) {
    return (
      <Card data-testid="progress-summary">
        <CardContent className="px-4 py-3 text-sm text-muted-foreground">
          项目概要暂时没有加载出来。
        </CardContent>
      </Card>
    );
  }

  const overlayOpen = hover || focus || pinned;

  return (
    <div
      data-testid="progress-summary"
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
    >
      <Card data-testid="progress-summary-money">
        <CardContent className="px-4 py-3">
          <p className="text-xs text-muted-foreground">到手金额</p>
          <p className="text-lg font-semibold leading-tight">{moneyLabel(facts.netAmount)}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            返点 {moneyLabel(facts.rebateAmount)}
          </p>
        </CardContent>
      </Card>
      <Card
        ref={cardRef}
        data-testid="progress-summary-schedule"
        onPointerEnter={(event) => {
          if (event.pointerType === 'touch' || isCoarsePointer()) return;
          enter();
        }}
        onPointerMove={(event) => {
          if (event.pointerType === 'touch' || isCoarsePointer()) return;
          enter();
        }}
        onPointerLeave={(event) => {
          const next = event.relatedTarget;
          if (
            next instanceof Element &&
            next.closest('[data-testid="progress-schedule-overlay"]')
          ) {
            return;
          }
          leave();
        }}
      >
        <CardContent className="px-4 py-3">
          <button
            type="button"
            className="block w-full text-left"
            data-testid="progress-summary-schedule-trigger"
            aria-expanded={overlayOpen}
            onPointerDown={() => {
              fromPointer.current = true;
            }}
            onClick={() => {
              if (!isCoarsePointer()) return;
              setPinned((current) => !current);
            }}
            onFocus={() => {
              if (fromPointer.current || isCoarsePointer()) return;
              setFocus(true);
            }}
            onBlur={() => {
              fromPointer.current = false;
              setFocus(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                setPinned(false);
                setFocus(false);
                dismissHover();
              }
            }}
          >
            <ScheduleCopy schedule={schedule} />
          </button>
        </CardContent>
      </Card>
      <AnchoredRecordOverlay
        open={overlayOpen}
        anchorRef={cardRef}
        title="关键排期"
        testId="progress-schedule-overlay"
        layoutKey="schedule"
        onPointerEnter={enter}
        onPointerLeave={(event: React.PointerEvent<HTMLDivElement>) => {
          const next = event.relatedTarget;
          if (
            next instanceof Element &&
            next.closest('[data-testid="progress-summary-schedule"]')
          ) {
            return;
          }
          leave();
        }}
      >
        <ScheduleOverlayBody schedule={schedule} />
      </AnchoredRecordOverlay>
      <Card data-testid="progress-summary-tasks">
        <CardContent className="px-4 py-3">
          <p className="text-xs text-muted-foreground">当前任务</p>
          <p className="font-medium">
            {facts.currentTasks.length > 0 ? facts.currentTasks.join('、') : '暂无进行中的任务'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
