import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  parseCreateMonitorTargetRequest,
  serializeCreateMonitorTargetRequest,
  type MonitorCard,
} from '@studio/contracts';
import { coverAssetUrl, formatCount } from '@/api/monitor-client';
import { useMonitorTargetMutations } from '@/api/hooks/use-monitor-target-queries';
import { Button } from '@/components/ui/button';
import { CreatorGridCard } from '@/features/monitoring/creator-grid-card';
import { formatVideoCardMetricsSummary } from '@/features/monitoring/video-card-metrics';
import { MonitorSettingsDialog } from '@/features/monitoring/monitor-settings-dialog';
import { MonitorStateBadge } from '@/features/monitoring/monitor-state-badge';
import { VideoGridCard } from '@/features/monitoring/video-grid-card';
import { VideoPinButton } from '@/features/monitoring/video-pin-button';
import { formatStartAtDisplay } from '@/lib/datetime-local';
import { formatFullLocalTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';

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
  presentation = 'list',
  selected = false,
  onSelect,
}: {
  card: MonitorCard;
  listQuery: string;
  includeDetailLink?: boolean;
  layout?: 'card' | 'detail';
  /** 列表沿用横向操作；网格走专用卡片骨架。 */
  presentation?: 'list' | 'grid';
  selected?: boolean;
  onSelect?: () => void;
}) {
  const mutations = useMonitorTargetMutations();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const pending =
    mutations.create.isPending ||
    mutations.patch.isPending ||
    mutations.remove.isPending ||
    mutations.run.isPending;
  const error =
    pinError ||
    (mutations.create.error instanceof Error && mutations.create.error.message) ||
    (mutations.patch.error instanceof Error && mutations.patch.error.message) ||
    (mutations.remove.error instanceof Error && mutations.remove.error.message) ||
    (mutations.run.error instanceof Error && mutations.run.error.message) ||
    null;
  const onPinError = (message: string) => {
    setNotice(null);
    setPinError(message);
  };

  const start = () => {
    setNotice(null);
    setPinError(null);
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
  const failedDot = card.execution === 'failed';
  const showMore = Boolean(card.target) || card.projects.length > 0;
  /** 详情页 / 分栏右侧面板直接摊开次要入口 */
  const detailSecondaryOpen = layout === 'detail' && showMore;
  const showLogsOnBar = layout === 'detail' && Boolean(card.target);
  const useVideoGrid = layout === 'card' && presentation === 'grid' && card.type === 'video';
  const useCreatorGrid = layout === 'card' && presentation === 'grid' && card.type === 'creator';

  const primaryAction =
    card.monitorState === 'unmonitored'
      ? {
          label: '开始监控',
          onClick: start,
          variant: 'default' as const,
        }
      : card.monitorState === 'active' && card.target
        ? {
            label: '暂停',
            onClick: () =>
              mutations.patch.mutate({ id: card.target!.id, patch: { enabled: false } }),
            variant: 'outline' as const,
          }
        : card.monitorState === 'paused' && card.target
          ? {
              label: '恢复',
              onClick: () =>
                mutations.patch.mutate({ id: card.target!.id, patch: { enabled: true } }),
              variant: 'default' as const,
            }
          : null;

  const primary = primaryAction ? (
    <Button
      type="button"
      size="sm"
      variant={primaryAction.variant}
      disabled={pending}
      aria-label={primaryAction.label}
      onClick={primaryAction.onClick}
    >
      {primaryAction.label}
    </Button>
  ) : null;

  if (useVideoGrid) {
    return (
      <VideoGridCard
        card={card}
        selected={selected}
        listQuery={listQuery}
        pending={pending}
        notice={notice}
        error={error}
        primary={primaryAction ? { ...primaryAction, disabled: pending } : null}
        onPinError={onPinError}
        {...(onSelect ? { onSelect } : {})}
      />
    );
  }

  if (useCreatorGrid) {
    return (
      <CreatorGridCard
        card={card}
        selected={selected}
        listQuery={listQuery}
        pending={pending}
        notice={notice}
        error={error}
        primary={primaryAction ? { ...primaryAction, disabled: pending } : null}
        {...(onSelect ? { onSelect } : {})}
      />
    );
  }

  /** 分栏卡片：详情选中右侧面板，不跳转详情页 */
  if (layout === 'card') {
    const metricsLine = card.hasSamples
      ? card.type === 'video'
        ? formatVideoCardMetricsSummary(card.latest)
        : `粉丝 ${formatCount(card.latest.followerCount)}`
      : '尚无采集数据';

    return (
      <div
        className={cn(
          'flex min-w-0 max-w-full flex-col gap-2 rounded-lg border p-3',
          selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
        )}
        data-testid="monitor-card-controls"
        data-presentation="list"
        data-monitor-state={card.monitorState}
        data-execution={card.execution}
        data-external-id={card.externalId}
        data-target-id={card.target?.id ?? ''}
        data-pinned={card.type === 'video' && card.pinned ? 'true' : 'false'}
        data-pending={pending ? 'true' : 'false'}
        aria-busy={pending}
      >
        <div className="flex min-w-0 gap-3">
          <div className="relative shrink-0">
            <button
              type="button"
              onClick={onSelect}
              className="block rounded-md text-left hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-pressed={selected}
              aria-label={`选择${card.type === 'video' ? '视频' : ' UP 主'}封面 ${card.displayName}`}
            >
              <img
                src={coverAssetUrl(card.imageAssetId)}
                alt=""
                width={96}
                height={54}
                className={cn(
                  'object-cover',
                  card.type === 'creator' ? 'size-14 rounded-full' : 'size-16 rounded',
                )}
              />
            </button>
            {card.type === 'video' ? (
              <VideoPinButton
                bvid={card.externalId}
                pinned={card.pinned}
                onError={onPinError}
                className="absolute -right-1 -top-1 z-10 size-6"
              />
            ) : null}
          </div>
          <button
            type="button"
            onClick={onSelect}
            className="min-w-0 flex-1 space-y-1 rounded-md text-left hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-pressed={selected}
            aria-label={`选择${card.type === 'video' ? '视频' : ' UP 主'} ${card.displayName}`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <MonitorStateBadge
                state={card.monitorState}
                failed={failedDot}
                badgeClassName="px-1.5 py-0 text-[10px] leading-4"
                failureTestId="monitor-list-failure-dot"
              />
              <span
                className="min-w-0 flex-1 truncate text-sm font-medium"
                title={card.displayName}
              >
                {card.displayName}
              </span>
            </span>
            <span
              className="block truncate text-xs tabular-nums text-muted-foreground"
              data-testid="monitor-list-metrics"
            >
              {metricsLine}
            </span>
          </button>
        </div>
        <div
          data-testid="monitor-card-actions"
          className="flex flex-wrap items-center justify-end gap-2"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label={`查看 ${card.displayName} 详情`}
            onClick={() => onSelect?.()}
          >
            详情
          </Button>
          {primary}
        </div>
        {notice ? (
          <p role="status" className="break-words text-xs text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="break-words text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

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
        aria-label="查看日志"
      >
        查看日志
      </Link>
    </Button>
  ) : null;

  const detailsToggle = (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-expanded={detailsOpen}
      aria-controls={detailsId}
      aria-label="监控详情"
      onClick={() => setDetailsOpen((open) => !open)}
    >
      监控详情
    </Button>
  );

  const settingsButton = card.target ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label="监控设置"
      onClick={() => setSettingsOpen(true)}
    >
      监控设置
    </Button>
  ) : null;

  const runButton = card.target ? (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label="立即采集"
      onClick={() =>
        mutations.run.mutate(card.target!.id, {
          onSuccess: () => setNotice('已触发立即采集'),
        })
      }
    >
      立即采集
    </Button>
  ) : null;

  const removeControls = card.target ? (
    confirmRemove ? (
      <>
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={pending}
          aria-label="确认移除"
          onClick={() =>
            mutations.remove.mutate(card.target!.id, {
              onSuccess: () => {
                setConfirmRemove(false);
                setNotice('已移除监控');
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
          aria-label="取消移除"
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
        aria-label="移除"
        onClick={() => setConfirmRemove(true)}
      >
        移除
      </Button>
    )
  ) : null;

  return (
    <div
      className="flex min-w-0 max-w-full flex-col gap-2"
      data-testid="monitor-card-controls"
      data-monitor-state={card.monitorState}
      data-execution={card.execution}
      data-external-id={card.externalId}
      data-target-id={card.target?.id ?? ''}
      data-pending={pending ? 'true' : 'false'}
      data-details-open={detailsOpen ? 'true' : 'false'}
      aria-busy={pending}
    >
      <div data-testid="monitor-detail-bar" className="flex min-w-0 flex-wrap items-center gap-2">
        <button
          type="button"
          className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`监控状态：${card.monitorState === 'active' ? '监控中' : card.monitorState === 'paused' ? '已暂停' : '未监控'}`}
          aria-expanded={detailsOpen}
          aria-controls={detailsId}
          onClick={() => setDetailsOpen((open) => !open)}
        >
          <MonitorStateBadge state={card.monitorState} failed={failedDot} />
        </button>
        {primary}
        {detailsToggle}
        {showLogsOnBar ? logsLink : null}
        {detailLink}
      </div>
      {failed ? (
        <p data-testid="monitor-last-failure" className="break-words text-xs text-destructive">
          {failed}
        </p>
      ) : null}
      {detailsOpen ? (
        <div
          id={detailsId}
          data-testid="monitor-frequency-details"
          className="grid gap-1 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          <p>频率：{monitorFrequencyText(card)}</p>
          {card.type === 'video' ? (
            <p data-testid="monitor-start-at-details" className="tabular-nums">
              计划开始：{formatStartAtDisplay(card.target?.startAt ?? null)}
            </p>
          ) : null}
          <p className="tabular-nums">
            上一次成功采集：{whenText(card.target?.lastSuccessAt ?? null)}
          </p>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="break-words text-xs text-muted-foreground">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="break-words text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {detailSecondaryOpen ? (
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label="详情页监控操作"
          data-testid="monitor-detail-secondary-actions"
        >
          {settingsButton}
          {runButton}
          <ProjectJump projects={card.projects} />
          {removeControls}
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
  presentation = 'list',
}: {
  card: MonitorCard;
  selected: boolean;
  listQuery: string;
  onSelect: () => void;
  presentation?: 'list' | 'grid';
}) {
  return (
    <li
      className={cn('min-w-0 max-w-full', presentation === 'grid' && 'h-full')}
      data-testid="monitor-object-card"
      data-presentation={presentation}
      data-monitor-state={card.monitorState}
      data-execution={card.execution}
      data-external-id={card.externalId}
    >
      <MonitorCardControls
        card={card}
        listQuery={listQuery}
        presentation={presentation}
        selected={selected}
        onSelect={onSelect}
      />
    </li>
  );
}
