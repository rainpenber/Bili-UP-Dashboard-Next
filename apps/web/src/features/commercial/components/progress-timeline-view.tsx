import { useEffect, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { formatFullLocalTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';
import { formatYuan } from '../commercial-selectors';
import {
  deriveProgressTimeline,
  stageSituationLabel,
  type DerivedPoint,
  type DerivedStage,
  type TimelineChild,
  type TimelineProjectFacts,
  type TimelineSourceNode,
} from '../progress-timeline';
import type { MockStatus } from '../../workflow-mock/flow-nodes';

const STATUS_COLOR: Record<MockStatus, string> = {
  done: '#15803d',
  active: '#1d4ed8',
  blocked: '#c2410c',
  idle: '#6b7280',
};

/** Bottom of the stage wash. 0x1f / 255 ≈ 0.12, inside the 0.10–0.14 band. */
const HIGHLIGHT_ALPHA = '1f';

function moneyLabel(value: string | null): string {
  if (value === null) return '未填写';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return formatYuan(amount);
}

function childLine(child: TimelineChild): string {
  if (child.status === 'blocked' && child.blockingReason) {
    return `${child.name}：${child.statusLabel}（${child.blockingReason}）`;
  }
  return `${child.name}：${child.statusLabel}`;
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

function PointMark({ point }: { point: DerivedPoint }) {
  const color = STATUS_COLOR[point.demoStatus];
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

function StageTooltipBody({ stage }: { stage: DerivedStage }) {
  return (
    <>
      <p className="mb-1 font-medium">{stage.label}</p>
      {stage.children.length === 0 ? (
        <p>这个阶段还没有子节点。</p>
      ) : (
        <ul className="space-y-1">
          {stage.children.map((child) => (
            <li key={child.id} data-status={child.demoStatus} data-workflow-status={child.status}>
              {childLine(child)}
            </li>
          ))}
        </ul>
      )}
    </>
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
}) {
  const color = STATUS_COLOR[stage.demoStatus];
  const caption = stageSituationLabel(stage);
  const tooltipOpen = hovered || focused;
  const maskOn = selected || hovered || focused;
  const fromPointer = useRef(false);
  return (
    <Tooltip open={tooltipOpen} onOpenChange={() => undefined}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="group relative flex min-w-[12rem] flex-1 flex-col rounded-md text-left"
          data-testid="progress-stage"
          data-stage-id={stage.id}
          data-status={stage.demoStatus}
          data-workflow-status={stage.status}
          data-current={stage.current ? 'true' : 'false'}
          data-selected={selected ? 'true' : 'false'}
          aria-expanded={selected}
          onClick={onToggle}
          onPointerDown={() => {
            fromPointer.current = true;
          }}
          onPointerEnter={() => onHover(stage.id)}
          onPointerMove={() => onHover(stage.id)}
          onPointerLeave={() => onHoverEnd(stage.id)}
          onFocus={(event) => {
            if (fromPointer.current) return;
            if (event.currentTarget.matches(':focus-visible')) onFocus(stage.id);
          }}
          onBlur={() => {
            fromPointer.current = false;
            onBlur(stage.id);
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
              style={{ color: STATUS_COLOR[end.demoStatus] }}
            >
              {end.label}
            </span>
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        sideOffset={8}
        avoidCollisions={false}
        className="max-w-64 overflow-visible px-3 py-2 text-left"
        data-testid="progress-stage-tooltip"
        data-stage-id={stage.id}
      >
        <StageTooltipBody stage={stage} />
      </TooltipContent>
    </Tooltip>
  );
}

function StageDetailBody({ stage }: { stage: DerivedStage }) {
  return (
    <div className="pb-1">
      <p className="mb-2 font-medium">{stage.label}</p>
      {stage.children.length === 0 ? (
        <p className="text-muted-foreground">这个阶段还没有子节点。</p>
      ) : (
        <div
          data-testid="progress-stage-nodes"
          className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3"
        >
          {stage.children.map((child) => (
            <article
              key={child.id}
              className="rounded-lg border bg-background px-3 py-3 shadow-sm"
              data-testid="progress-stage-node"
              data-node-id={child.nodeId}
              data-status={child.demoStatus}
              data-workflow-status={child.status}
            >
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium leading-snug">{child.name}</h4>
                <Badge variant={statusBadgeVariant(child.demoStatus)}>{child.statusLabel}</Badge>
              </div>
              {child.status === 'blocked' ? (
                <p
                  className="mt-2 text-muted-foreground"
                  data-testid="progress-blocker"
                  data-node-id={child.nodeId}
                >
                  {child.blockingReason ?? '尚未记录原因'}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function StageDetail({ stage }: { stage: DerivedStage | null }) {
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
        <div className="overflow-hidden">{stage ? <StageDetailBody stage={stage} /> : null}</div>
      </div>
      {stage ? null : (
        <p className="text-muted-foreground">点击阶段连线或终点，查看这一阶段的子节点。</p>
      )}
    </div>
  );
}

export function ProgressTimeline({ nodes }: { nodes: TimelineSourceNode[] }) {
  const timeline = deriveProgressTimeline(nodes);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const openStage = timeline.stages.find((stage) => stage.id === selectedId) ?? null;
  const start = timeline.points[0];
  const pointById = new Map(timeline.points.map((point) => [point.id, point]));

  useEffect(() => {
    if (!selectedId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-testid="progress-stage"]')) return;
      if (target.closest('[data-testid="progress-stage-tooltip"]')) return;
      if (target.closest('[data-testid="progress-stage-detail"]')) return;
      setSelectedId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selectedId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">商单进度</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">悬停查看状态，点击查看详情。</p>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={0} disableHoverableContent>
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
                      style={{ color: STATUS_COLOR[start.demoStatus] }}
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
                      onHover={(id) => setHoverId((current) => (current === id ? current : id))}
                      onHoverEnd={(id) =>
                        setHoverId((current) => (current === id ? null : current))
                      }
                      onFocus={(id) => setFocusId(id)}
                      onBlur={(id) => setFocusId((current) => (current === id ? null : current))}
                      onToggle={() =>
                        setSelectedId((current) => (current === stage.id ? null : stage.id))
                      }
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </TooltipProvider>
        <StageDetail stage={openStage} />
      </CardContent>
    </Card>
  );
}

export function ProgressSummary({ facts }: { facts: TimelineProjectFacts | null }) {
  if (!facts) {
    return (
      <Card data-testid="progress-summary">
        <CardContent className="px-4 py-3 text-sm text-muted-foreground">
          项目概要暂时没有加载出来。
        </CardContent>
      </Card>
    );
  }

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
      <Card data-testid="progress-summary-schedule">
        <CardContent className="px-4 py-3">
          <p className="text-xs text-muted-foreground">发布时间</p>
          <p className="font-medium">
            {facts.publishedAt ? formatFullLocalTime(facts.publishedAt) : '尚未发布'}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">整体阶段 {facts.overallStageLabel}</p>
        </CardContent>
      </Card>
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
