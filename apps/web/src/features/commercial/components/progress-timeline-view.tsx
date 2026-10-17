import { useState } from 'react';
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

function StageHit({
  stage,
  end,
  open,
  onToggle,
}: {
  stage: DerivedStage;
  end: DerivedPoint;
  open: boolean;
  onToggle: () => void;
}) {
  const color = STATUS_COLOR[stage.demoStatus];
  const situation = stageSituationLabel(stage);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="group relative flex min-w-0 flex-1 flex-col rounded-md text-left"
          data-testid="progress-stage"
          data-stage-id={stage.id}
          data-status={stage.demoStatus}
          data-workflow-status={stage.status}
          data-current={stage.current ? 'true' : 'false'}
          aria-expanded={open}
          onClick={onToggle}
        >
          <span
            data-testid="progress-stage-mask"
            className="pointer-events-none absolute inset-0 rounded-md bg-foreground/[0.04] opacity-0 ring-1 ring-foreground/20 group-data-[state=delayed-open]:opacity-100 group-data-[state=instant-open]:opacity-100"
            aria-hidden
          />
          <span className="relative z-10 flex items-end">
            <span className="relative flex h-6 min-w-0 flex-1 items-center">
              <span
                className="relative z-10 block w-full rounded-full"
                style={{ height: stage.current ? 5 : 4, background: color }}
                aria-hidden
              />
            </span>
            <span
              className="flex w-[4.5rem] shrink-0 flex-col items-center"
              data-testid="progress-point"
              data-point-id={end.id}
              data-status={end.demoStatus}
              data-workflow-status={end.status}
            >
              <span className="relative flex h-14 w-full items-end justify-center">
                {situation ? (
                  <span className="absolute bottom-0 flex flex-col items-center">
                    <span
                      data-testid="progress-stage-situation"
                      className="text-sm leading-tight font-medium whitespace-nowrap"
                      style={{ color }}
                    >
                      {situation}
                    </span>
                    <span
                      data-testid="progress-stage-glow"
                      data-callout="dashed"
                      className="mt-0.5 h-5 w-0"
                      style={{ borderLeft: `1.5px dashed ${color}` }}
                      aria-hidden
                    />
                  </span>
                ) : null}
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

function StageDetail({ stage }: { stage: DerivedStage | null }) {
  return (
    <div data-testid="progress-stage-detail" className="mt-4 border-t pt-4 text-sm">
      <p className="mb-2 font-medium">阶段详情</p>
      {stage ? (
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
      ) : (
        <p className="text-muted-foreground">点击阶段连线或它的终点成就点，查看子节点和卡点。</p>
      )}
    </div>
  );
}

export function ProgressTimeline({ nodes }: { nodes: TimelineSourceNode[] }) {
  const timeline = deriveProgressTimeline(nodes);
  const [openId, setOpenId] = useState<string | null>(null);
  const openStage = timeline.stages.find((stage) => stage.id === openId) ?? null;
  const start = timeline.points[0];
  const pointById = new Map(timeline.points.map((point) => [point.id, point]));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">商单进度</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">
          圆点是成就点，连线是阶段。悬停连线或它的终点成就点查看子节点，点击展开卡点。
        </p>
      </CardHeader>
      <CardContent>
        <TooltipProvider delayDuration={0} disableHoverableContent>
          <div data-testid="progress-timeline">
            <div className="overflow-x-auto">
              <div className="flex min-w-[40rem] items-stretch">
                {start ? (
                  <div className="flex w-[4.5rem] shrink-0 flex-col items-center">
                    <span className="h-14" aria-hidden />
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
                      open={openId === stage.id}
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
      <CardHeader>
        <CardTitle className="text-base">概要</CardTitle>
      </CardHeader>
      <CardContent className="text-sm">
        {facts ? (
          <ProjectFacts facts={facts} />
        ) : (
          <p className="text-muted-foreground">项目概要暂时没有加载出来。</p>
        )}
      </CardContent>
    </Card>
  );
}

function ProjectFacts({ facts }: { facts: TimelineProjectFacts }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="progress-facts">
      <div>
        <dt className="text-muted-foreground">到手金额</dt>
        <dd>{moneyLabel(facts.netAmount)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">返点金额</dt>
        <dd>{moneyLabel(facts.rebateAmount)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">时间</dt>
        <dd>{facts.publishedAt ? formatFullLocalTime(facts.publishedAt) : '尚未发布'}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">整体阶段</dt>
        <dd>{facts.overallStageLabel}</dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="text-muted-foreground">任务</dt>
        <dd>
          {facts.currentTasks.length > 0 ? facts.currentTasks.join('、') : '暂无进行中的任务'}
        </dd>
      </div>
    </dl>
  );
}
