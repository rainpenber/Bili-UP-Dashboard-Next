import { useEffect, useState } from 'react';
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

function moneyLabel(value: string | null): string {
  if (value === null) return '未填写';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return value;
  return formatYuan(amount);
}

function childLine(child: DerivedStage['children'][number]): string {
  if (child.status === 'blocked' && child.blockingReason) {
    return `${child.name}：${child.statusLabel}（${child.blockingReason}）`;
  }
  return `${child.name}：${child.statusLabel}`;
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

function blockCaptionLines(label: string): string {
  return label.replaceAll('、', '\n');
}

function StageCallout({ stageId, color }: { stageId: string; color: string }) {
  const gradientId = `progress-dash-${stageId}`;
  return (
    <svg
      data-testid="progress-stage-glow"
      data-callout="dashed"
      width="12"
      height="48"
      viewBox="0 0 12 48"
      className="relative z-10 h-12 w-3 overflow-visible"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="6" y1="48" x2="6" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor={color} stopOpacity="0.55" />
        </linearGradient>
      </defs>
      <line
        x1="6"
        y1="47"
        x2="6"
        y2="1"
        stroke={color}
        strokeWidth="3"
        strokeDasharray="6 5"
        strokeLinecap="butt"
        data-color={color}
      />
    </svg>
  );
}

function StageHit({
  stage,
  end,
  pinned,
  hovered,
  onToggle,
  onHover,
  onHoverEnd,
}: {
  stage: DerivedStage;
  end: DerivedPoint;
  pinned: boolean;
  hovered: boolean;
  onToggle: () => void;
  onHover: (id: string) => void;
  onHoverEnd: (id: string) => void;
}) {
  const color = STATUS_COLOR[stage.demoStatus];
  const caption = stageSituationLabel(stage);
  const tooltipOpen = pinned || hovered;
  return (
    <Tooltip open={tooltipOpen} onOpenChange={() => undefined}>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="group relative flex h-full min-w-0 flex-1 flex-col rounded-md text-left"
          data-testid="progress-stage"
          data-stage-id={stage.id}
          data-status={stage.demoStatus}
          data-workflow-status={stage.status}
          data-current={stage.current ? 'true' : 'false'}
          data-pinned={pinned ? 'true' : 'false'}
          aria-expanded={pinned}
          onClick={onToggle}
          onPointerEnter={() => onHover(stage.id)}
          onPointerMove={() => onHover(stage.id)}
          onPointerLeave={() => onHoverEnd(stage.id)}
        >
          <span
            data-testid="progress-stage-mask"
            className="pointer-events-none absolute inset-0 rounded-md bg-foreground/[0.04] opacity-0 ring-1 ring-foreground/20 group-data-[state=delayed-open]:opacity-100 group-data-[state=instant-open]:opacity-100 group-data-[state=open]:opacity-100"
            aria-hidden
          />
          <span className="relative z-10 flex flex-1 items-end">
            {caption ? (
              <span
                data-testid="progress-stage-gradient"
                data-highlight="block"
                className="pointer-events-none absolute inset-x-1 bottom-6 z-0 h-24 rounded-t-2xl"
                style={{
                  backgroundImage: `linear-gradient(to top, ${color}47, ${color}1a 58%, transparent)`,
                }}
                aria-hidden
              />
            ) : null}
            <span className="flex min-w-0 flex-1 flex-col justify-end">
              {caption ? (
                <span
                  data-testid="progress-stage-line-label"
                  className="relative z-10 mb-1 px-1 text-center text-xs leading-snug font-medium whitespace-pre-line"
                  style={{ color }}
                >
                  {blockCaptionLines(caption)}
                </span>
              ) : null}
              <span className="flex h-6 items-center">
                <span
                  className="block w-full rounded-full"
                  style={{ height: stage.current ? 5 : 4, background: color }}
                  aria-hidden
                />
              </span>
            </span>
            <span
              className="flex w-[4.5rem] shrink-0 flex-col items-center justify-end"
              data-testid="progress-point"
              data-point-id={end.id}
              data-status={end.demoStatus}
              data-workflow-status={end.status}
            >
              <span className="flex min-h-36 w-full items-end justify-center">
                {caption ? <StageCallout stageId={stage.id} color={color} /> : null}
              </span>
              <span className="flex h-6 items-center">
                <PointMark point={end} />
              </span>
            </span>
          </span>
          <span className="relative z-10 mt-1 flex text-sm leading-snug">
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
              className="w-[4.5rem] shrink-0 text-center font-medium"
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
    <div className="space-y-4">
      <p className="text-muted-foreground">{stage.label}</p>
      <ul className="space-y-2" data-testid="progress-stage-nodes">
        {stage.children.length === 0 ? (
          <li className="text-muted-foreground">这个阶段还没有子节点。</li>
        ) : (
          stage.children.map((child) => (
            <li
              key={child.id}
              className="flex items-start justify-between gap-3 rounded-md border px-3 py-2"
              data-testid="progress-stage-node"
              data-node-id={child.nodeId}
              data-status={child.demoStatus}
              data-workflow-status={child.status}
            >
              <span className="font-medium">{child.name}</span>
              <span className="shrink-0" style={{ color: STATUS_COLOR[child.demoStatus] }}>
                {child.statusLabel}
              </span>
            </li>
          ))
        )}
      </ul>
      <div data-testid="progress-stage-blockers">
        <p className="mb-1 text-muted-foreground">卡点</p>
        {stage.blockers.length === 0 ? (
          <p>这个阶段当前没有阻塞节点。</p>
        ) : (
          <ul className="space-y-1">
            {stage.blockers.map((child) => (
              <li key={child.id} data-testid="progress-blocker" data-node-id={child.nodeId}>
                {child.blockingReason
                  ? `${child.name}：${child.blockingReason}`
                  : `${child.name}：阻塞，尚未记录原因`}
              </li>
            ))}
          </ul>
        )}
      </div>
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
      className="mt-4 border-t pt-4 text-sm"
    >
      <p className="mb-2 font-medium">阶段详情</p>
      <div
        data-testid="progress-stage-detail-body"
        data-motion="120ms"
        data-open={open && grown ? 'true' : 'false'}
        className="progress-detail-panel"
      >
        <div className={cn('overflow-hidden', open && 'progress-detail-in')}>
          {stage ? <StageDetailBody stage={stage} /> : null}
        </div>
      </div>
      {stage ? null : (
        <p className="text-muted-foreground">点击阶段连线或它的终点成就点，查看子节点和卡点。</p>
      )}
    </div>
  );
}

export function ProgressTimeline({ nodes }: { nodes: TimelineSourceNode[] }) {
  const timeline = deriveProgressTimeline(nodes);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const openStage = timeline.stages.find((stage) => stage.id === openId) ?? null;
  const start = timeline.points[0];
  const pointById = new Map(timeline.points.map((point) => [point.id, point]));

  useEffect(() => {
    if (!openId) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (target.closest('[data-testid="progress-stage"]')) return;
      if (target.closest('[data-testid="progress-stage-tooltip"]')) return;
      if (target.closest('[data-testid="progress-stage-detail"]')) return;
      setOpenId(null);
      setHoverId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [openId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">商单进度</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">
          圆点是成就点，连线是阶段。进行中和阻塞会在连线上方铺一层同色半透明高亮，并从终点向上拉出同色虚线。悬停查看子节点和阻塞原因，点击后详情保持打开。
        </p>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={0} disableHoverableContent>
          <div data-testid="progress-timeline">
            <div className="overflow-x-auto">
              <div className="flex min-w-[68rem] items-stretch">
                {start ? (
                  <div className="flex w-[4.5rem] shrink-0 flex-col items-center justify-end">
                    <span className="min-h-36 w-full flex-1" aria-hidden />
                    <span
                      className="flex h-6 items-center"
                      data-testid="progress-point"
                      data-point-id={start.id}
                      data-status={start.demoStatus}
                      data-workflow-status={start.status}
                    >
                      <PointMark point={start} />
                    </span>
                    <p
                      className="mt-1 text-center text-sm leading-snug font-medium"
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
                      pinned={openId === stage.id}
                      hovered={hoverId === stage.id}
                      onHover={(id) => setHoverId((current) => (current === id ? current : id))}
                      onHoverEnd={(id) =>
                        setHoverId((current) => (current === id ? null : current))
                      }
                      onToggle={() =>
                        setOpenId((current) => (current === stage.id ? null : stage.id))
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
  return (
    <Card data-testid="progress-summary">
      <CardContent className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
        <span className="text-xs font-medium tracking-wide text-muted-foreground">概要</span>
        {facts ? (
          <ProjectFacts facts={facts} />
        ) : (
          <p className="text-muted-foreground">项目概要暂时没有加载出来。</p>
        )}
      </CardContent>
    </Card>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function ProjectFacts({ facts }: { facts: TimelineProjectFacts }) {
  return (
    <dl
      className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-4 gap-y-1"
      data-testid="progress-facts"
    >
      <Fact label="到手金额" value={moneyLabel(facts.netAmount)} />
      <Fact label="返点金额" value={moneyLabel(facts.rebateAmount)} />
      <Fact
        label="时间"
        value={facts.publishedAt ? formatFullLocalTime(facts.publishedAt) : '尚未发布'}
      />
      <Fact label="整体阶段" value={facts.overallStageLabel} />
      <Fact
        label="任务"
        value={facts.currentTasks.length > 0 ? facts.currentTasks.join('、') : '暂无进行中的任务'}
      />
    </dl>
  );
}
