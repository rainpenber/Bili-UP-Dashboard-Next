import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  parseCreateMonitorTargetRequest,
  serializeCreateMonitorTargetRequest,
  type MonitorCard,
} from '@studio/contracts';
import { coverAssetUrl, formatCount } from '@/api/monitor-client';
import { useMonitorTargetMutations } from '@/api/hooks/use-monitor-target-queries';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatVideoCardMetricsSummary } from '@/features/monitoring/video-card-metrics';
import { MonitorSettingsDialog } from '@/features/monitoring/monitor-settings-dialog';
import { formatFullLocalTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';

const STATE_LABEL = {
  unmonitored: '未监控',
  active: '监控中',
  paused: '已暂停',
} as const;

function whenText(value: string | null): string {
  return value ? formatFullLocalTime(value) : '暂无';
}

export function monitorFrequencyText(card: MonitorCard): string {
  if (!card.target) return '未设置频率';
  if (card.target.intervalMode === 'fixed') {
    return `固定间隔 · 每 ${card.target.intervalMinutes} 分钟`;
  }
  return '自动';
}

function failureLine(card: MonitorCard): string | null {
  if (card.execution !== 'failed') return null;
  const raw = card.target?.lastError?.trim() ?? '';
  if (!raw || raw === '—' || raw === '-') return null;
  return `最近失败：${raw}`;
}

function ProjectJump({ projects }: { projects: MonitorCard['projects'] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  if (projects.length === 0) return null;
  if (projects.length === 1) {
    const project = projects[0];
    if (!project) return null;
    return (
      <Button type="button" size="sm" variant="outline" asChild>
        <Link to={`/projects/${project.id}`}>进入商单</Link>
      </Button>
    );
  }
  const selected = projects.find((project) => project.id === projectId) ?? projects[0];
  if (!selected) return null;
  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      <label className="grid min-w-0 gap-1 text-xs text-muted-foreground">
        关联商单
        <select
          aria-label="关联商单"
          className="h-8 max-w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          value={selected.id}
          onChange={(event) => setProjectId(event.target.value)}
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
      <Button type="button" size="sm" variant="outline" asChild>
        <Link to={`/projects/${selected.id}`}>进入商单</Link>
      </Button>
    </div>
  );
}

export function MonitorCardControls({
  card,
  listQuery,
  includeDetailLink = true,
  layout = 'card',
  selected = false,
  onSelect,
}: {
  card: MonitorCard;
  listQuery: string;
  includeDetailLink?: boolean;
  layout?: 'card' | 'detail';
  selected?: boolean;
  onSelect?: () => void;
}) {
  const mutations = useMonitorTargetMutations();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pending =
    mutations.create.isPending ||
    mutations.patch.isPending ||
    mutations.remove.isPending ||
    mutations.run.isPending;
  const error =
    (mutations.create.error instanceof Error && mutations.create.error.message) ||
    (mutations.patch.error instanceof Error && mutations.patch.error.message) ||
    (mutations.remove.error instanceof Error && mutations.remove.error.message) ||
    (mutations.run.error instanceof Error && mutations.run.error.message) ||
    null;

  const start = () => {
    setNotice(null);
    const label =
      card.displayName !== card.externalId && card.displayName.length <= 80
        ? card.displayName
        : undefined;
    const request = parseCreateMonitorTargetRequest({
      type: card.type,
      externalId: card.externalId,
      intervalMode: 'auto',
      ...(label ? { label } : {}),
    });
    mutations.create.mutate(serializeCreateMonitorTargetRequest(request), {
      onSuccess: (result) => setNotice(result.message),
    });
  };

  const detailKind = card.type === 'video' ? 'videos' : 'creators';
  const detailsId = `monitor-details-${card.type}-${card.externalId}`;
  const failed = failureLine(card);
  const showMore = Boolean(card.target) || card.projects.length > 0;
  const showLogsOnBar = layout === 'detail' && Boolean(card.target);
  const span = layout === 'card' ? 'col-span-2' : '';

  const primary =
    card.monitorState === 'unmonitored' ? (
      <Button type="button" size="sm" disabled={pending} onClick={start}>
        开始监控
      </Button>
    ) : card.monitorState === 'active' && card.target ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => mutations.patch.mutate({ id: card.target!.id, patch: { enabled: false } })}
      >
        暂停
      </Button>
    ) : card.monitorState === 'paused' && card.target ? (
      <Button
        type="button"
        size="sm"
        disabled={pending}
        onClick={() => mutations.patch.mutate({ id: card.target!.id, patch: { enabled: true } })}
      >
        恢复
      </Button>
    ) : null;

  const detailLink = includeDetailLink ? (
    <Button type="button" size="sm" variant="outline" asChild>
      <Link
        to={`/monitoring/${detailKind}/${encodeURIComponent(card.externalId)}?from=${encodeURIComponent(listQuery)}`}
      >
        查看详情
      </Link>
    </Button>
  ) : null;

  const logsLink = card.target ? (
    <Button type="button" size="sm" variant="outline" asChild>
      <Link
        to={`/ops?${new URLSearchParams({
          targetId: card.target.id,
          targetType: card.type,
          externalId: card.externalId,
        }).toString()}`}
      >
        查看日志
      </Link>
    </Button>
  ) : null;

  const moreButton = showMore ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-expanded={moreOpen}
      onClick={() => {
        setMoreOpen((open) => !open);
        setConfirmRemove(false);
      }}
    >
      更多
    </Button>
  ) : null;

  const stateBadge = (
    <button
      type="button"
      className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`监控状态：${STATE_LABEL[card.monitorState]}`}
      aria-expanded={detailsOpen}
      aria-controls={detailsId}
      onClick={() => setDetailsOpen((open) => !open)}
    >
      <Badge
        variant={
          card.monitorState === 'active'
            ? 'success'
            : card.monitorState === 'paused'
              ? 'warning'
              : 'secondary'
        }
      >
        {STATE_LABEL[card.monitorState]}
      </Badge>
    </button>
  );

  const detailsToggle = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-expanded={detailsOpen}
      aria-controls={detailsId}
      onClick={() => setDetailsOpen((open) => !open)}
    >
      监控详情
    </Button>
  );

  return (
    <div
      className={
        layout === 'card'
          ? cn(
              'grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-lg border p-3',
              selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
            )
          : 'flex min-w-0 max-w-full flex-col gap-2'
      }
      data-testid="monitor-card-controls"
      data-monitor-state={card.monitorState}
      data-execution={card.execution}
      data-external-id={card.externalId}
      data-target-id={card.target?.id ?? ''}
      data-pending={pending ? 'true' : 'false'}
      data-details-open={detailsOpen ? 'true' : 'false'}
      aria-busy={pending}
    >
      {layout === 'card' ? (
        <button
          type="button"
          onClick={onSelect}
          className="col-start-1 row-start-1 flex min-w-0 gap-3 rounded-md text-left hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-pressed={selected}
        >
          <img
            src={coverAssetUrl(card.imageAssetId)}
            alt=""
            width={96}
            height={54}
            className={cn(
              'shrink-0 object-cover',
              card.type === 'creator' ? 'size-14 rounded-full' : 'size-16 rounded',
            )}
          />
          <span className="min-w-0 flex-1 space-y-1">
            <span className="line-clamp-2 break-words font-medium leading-snug">
              {card.displayName}
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              {card.externalId}
              {card.type === 'video' ? ` · ${card.category ?? '未分类'}` : ''}
            </span>
            <span className="block truncate text-xs tabular-nums text-muted-foreground">
              {card.hasSamples
                ? card.type === 'video'
                  ? formatVideoCardMetricsSummary(card.latest)
                  : `粉丝 ${formatCount(card.latest.followerCount)}`
                : '尚无采集数据'}
            </span>
          </span>
        </button>
      ) : null}
      <div
        data-testid={layout === 'detail' ? 'monitor-detail-bar' : 'monitor-card-actions'}
        className={
          layout === 'card'
            ? 'col-start-2 row-start-1 flex w-max max-w-[8.75rem] flex-col items-stretch justify-center gap-1.5 self-center justify-self-end sm:max-w-none sm:flex-row sm:flex-wrap sm:items-center sm:justify-end'
            : 'flex min-w-0 flex-wrap items-center gap-2'
        }
      >
        {layout === 'detail' ? stateBadge : null}
        {layout === 'detail' ? primary : <div className="sm:order-4">{primary}</div>}
        {layout === 'detail' ? detailsToggle : null}
        {showLogsOnBar ? logsLink : null}
        {layout === 'detail' ? moreButton : null}
        {layout === 'card' ? <div className="sm:order-3">{detailLink}</div> : null}
        {layout === 'card' ? <div className="sm:order-2">{moreButton}</div> : null}
        {layout === 'card' ? (
          <div className="flex flex-col items-stretch gap-1 sm:order-1 sm:flex-row sm:items-center">
            <div className="flex justify-end">{stateBadge}</div>
            {detailsToggle}
          </div>
        ) : null}
      </div>
      {failed ? (
        <p
          data-testid="monitor-last-failure"
          className={cn('break-words text-xs text-destructive', span)}
        >
          {failed}
        </p>
      ) : null}
      {detailsOpen ? (
        <div
          id={detailsId}
          data-testid="monitor-frequency-details"
          className={cn(
            'grid gap-1 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground',
            span,
          )}
        >
          <p>频率：{monitorFrequencyText(card)}</p>
          <p className="tabular-nums">
            上一次成功采集：{whenText(card.target?.lastSuccessAt ?? null)}
          </p>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className={cn('break-words text-xs text-muted-foreground', span)}>
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className={cn('break-words text-xs text-destructive', span)}>
          {error}
        </p>
      ) : null}
      {moreOpen && showMore ? (
        <div
          className={cn('flex flex-wrap items-center gap-2', span)}
          role="group"
          aria-label="更多操作"
        >
          {card.target ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setSettingsOpen(true)}
            >
              监控设置
            </Button>
          ) : null}
          {layout === 'card' ? logsLink : null}
          <ProjectJump projects={card.projects} />
          {card.target ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => mutations.run.mutate(card.target!.id)}
            >
              立即采集
            </Button>
          ) : null}
          {card.target ? (
            confirmRemove ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() =>
                    mutations.remove.mutate(card.target!.id, {
                      onSuccess: () => {
                        setConfirmRemove(false);
                        setMoreOpen(false);
                      },
                    })
                  }
                >
                  确认移除
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmRemove(false)}
                >
                  取消
                </Button>
              </>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setConfirmRemove(true)}
              >
                移除
              </Button>
            )
          ) : null}
        </div>
      ) : null}
      {settingsOpen && card.target ? (
        <MonitorSettingsDialog card={card} open={settingsOpen} onOpenChange={setSettingsOpen} />
      ) : null}
    </div>
  );
}

export function MonitorObjectCard({
  card,
  selected,
  listQuery,
  onSelect,
}: {
  card: MonitorCard;
  selected: boolean;
  listQuery: string;
  onSelect: () => void;
}) {
  return (
    <li
      className="min-w-0 max-w-full"
      data-testid="monitor-object-card"
      data-monitor-state={card.monitorState}
      data-execution={card.execution}
      data-external-id={card.externalId}
    >
      <MonitorCardControls
        card={card}
        listQuery={listQuery}
        selected={selected}
        onSelect={onSelect}
      />
    </li>
  );
}
