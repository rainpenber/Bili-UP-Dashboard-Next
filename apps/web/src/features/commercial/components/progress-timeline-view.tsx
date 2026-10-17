import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatFullLocalTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';
import { formatYuan } from '../commercial-selectors';
import {
  deriveProgressTimeline,
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

function StageTooltip({ stage }: { stage: DerivedStage }) {
  return (
    <div
      role="tooltip"
      data-testid="progress-stage-tooltip"
      data-stage-id={stage.id}
      className="mt-3 rounded-md border bg-background px-3 py-2 text-left text-xs text-foreground shadow-md"
    >
      <p className="mb-1 font-medium">{stage.label}</p>
      {stage.children.length === 0 ? (
        <p className="text-muted-foreground">这个阶段还没有子节点。</p>
      ) : (
        <ul className="space-y-1">
          {stage.children.map((child) => (
            <li key={child.id} data-status={child.demoStatus} data-workflow-status={child.status}>
              {childLine(child)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StageDetail({
  stage,
  facts,
}: {
  stage: DerivedStage | null;
  facts: TimelineProjectFacts | null;
}) {
  return (
    <Card data-testid="progress-stage-detail">
      <CardHeader>
        <CardTitle className="text-base">阶段详情</CardTitle>
        <p className="text-sm font-normal text-muted-foreground">
          {stage ? stage.label : '点击上方阶段连线，查看该阶段的子节点和卡点。'}
        </p>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {stage ? (
          <>
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
          </>
        ) : null}
        {facts ? <ProjectFacts facts={facts} /> : null}
      </CardContent>
    </Card>
  );
}

function ProjectFacts({ facts }: { facts: TimelineProjectFacts }) {
  return (
    <dl
      className="grid grid-cols-1 gap-3 border-t pt-3 sm:grid-cols-2"
      data-testid="progress-facts"
    >
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

export function ProgressTimeline({
  nodes,
  facts,
}: {
  nodes: TimelineSourceNode[];
  facts: TimelineProjectFacts | null;
}) {
  const timeline = deriveProgressTimeline(nodes);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const openStage = timeline.stages.find((stage) => stage.id === openId) ?? null;
  const hoveredStage = timeline.stages.find((stage) => stage.id === hoveredId) ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">商单进度</CardTitle>
          <p className="text-sm font-normal text-muted-foreground">
            圆点是成就点，连线是阶段。悬停连线查看子节点，点击展开卡点。
          </p>
        </CardHeader>
        <CardContent>
          <div data-testid="progress-timeline">
            <div className="overflow-x-auto">
              <div className="min-w-[44rem]">
                <div className="flex items-center">
                  {timeline.points.map((point, index) => {
                    const stage = timeline.stages[index];
                    const color = STATUS_COLOR[point.demoStatus];
                    return (
                      <div key={point.id} className="contents">
                        <div
                          className="flex w-16 shrink-0 justify-center"
                          data-testid="progress-point"
                          data-point-id={point.id}
                          data-status={point.demoStatus}
                          data-workflow-status={point.status}
                        >
                          <span
                            className="size-3.5 rounded-full border-2"
                            style={{
                              borderColor: color,
                              background: point.demoStatus === 'idle' ? 'transparent' : color,
                              boxShadow:
                                point.demoStatus === 'done' ? `0 0 0 3px ${color}22` : undefined,
                            }}
                            aria-hidden
                          />
                        </div>
                        {stage ? (
                          <button
                            type="button"
                            className="relative mx-1 flex h-8 min-w-0 flex-1 items-center"
                            data-testid="progress-stage"
                            data-stage-id={stage.id}
                            data-status={stage.demoStatus}
                            data-workflow-status={stage.status}
                            data-current={stage.current ? 'true' : 'false'}
                            aria-expanded={openId === stage.id}
                            aria-describedby={
                              hoveredId === stage.id ? `progress-tip-${stage.id}` : undefined
                            }
                            onMouseEnter={() => setHoveredId(stage.id)}
                            onMouseLeave={() =>
                              setHoveredId((current) => (current === stage.id ? null : current))
                            }
                            onFocus={() => setHoveredId(stage.id)}
                            onBlur={() =>
                              setHoveredId((current) => (current === stage.id ? null : current))
                            }
                            onClick={() =>
                              setOpenId((current) => (current === stage.id ? null : stage.id))
                            }
                          >
                            <span
                              className="block w-full rounded-full"
                              style={{
                                height: stage.current ? 6 : 3,
                                background: STATUS_COLOR[stage.demoStatus],
                                boxShadow: stage.current
                                  ? `0 0 0 3px ${STATUS_COLOR[stage.demoStatus]}33`
                                  : undefined,
                              }}
                              aria-hidden
                            />
                            <span className="sr-only">
                              {stage.label}
                              {stage.current ? '，当前阶段' : ''}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
                <div className="mt-3 flex">
                  {timeline.points.map((point, index) => {
                    const stage = timeline.stages[index];
                    return (
                      <div key={`${point.id}-label`} className="contents">
                        <p
                          className="w-16 shrink-0 text-center text-xs leading-snug font-medium"
                          style={{ color: STATUS_COLOR[point.demoStatus] }}
                        >
                          {point.label}
                        </p>
                        {stage ? (
                          <p
                            className={cn(
                              'mx-1 min-w-0 flex-1 text-center text-xs leading-snug',
                              stage.current ? 'font-medium' : 'text-muted-foreground',
                            )}
                            style={
                              stage.current ? { color: STATUS_COLOR[stage.demoStatus] } : undefined
                            }
                          >
                            {stage.label}
                            {stage.current ? ' · 当前' : ''}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            {hoveredStage ? (
              <div id={`progress-tip-${hoveredStage.id}`}>
                <StageTooltip stage={hoveredStage} />
              </div>
            ) : null}
          </div>
        </CardContent>
      </Card>
      <StageDetail stage={openStage} facts={facts} />
    </div>
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
