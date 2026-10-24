import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  parseCreateMonitorTargetRequest,
  serializeCreateMonitorTargetRequest,
  type MonitorCard,
} from '@studio/contracts';
import { coverAssetUrl, formatCount } from '@/api/monitor-client';
import { useMonitorTargetMutations } from '@/api/hooks/use-monitor-target-queries';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { BilibiliExternalLinkButton } from '@/features/monitoring/bilibili-external-link';
import { CreatorGridCard } from '@/features/monitoring/creator-grid-card';
import { formatVideoCardMetricsSummary } from '@/features/monitoring/video-card-metrics';
import { MonitorSettingsDialog } from '@/features/monitoring/monitor-settings-dialog';
import { MonitorStateBadge } from '@/features/monitoring/monitor-state-badge';
import { RemoveMonitorDialog } from '@/features/monitoring/remove-monitor-dialog';
import { VideoGridCard } from '@/features/monitoring/video-grid-card';
import {
  handleCardActivateKey,
  stopCardActivatePropagation,
} from '@/features/monitoring/card-activate';
import { MonitorPinButton } from '@/features/monitoring/monitor-pin-button';
import { detailReturnHref } from '@/features/monitoring/monitor-url-state';
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

/** 卡片上的「查看项目」：仅有关联商单时显示 */
function ProjectViewLink({
  projects,
  selectId,
  stopPropagation = false,
}: {
  projects: MonitorCard['projects'];
  selectId: string;
  stopPropagation?: boolean;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  if (projects.length === 0) return null;
  if (projects.length === 1) {
    const project = projects[0];
    if (!project) return null;
    return (
      <Button type="button" size="sm" variant="outline" asChild>
        <Link
          to={`/projects/${project.id}`}
          aria-label="查看项目"
          onClick={stopPropagation ? (event) => event.stopPropagation() : undefined}
        >
          查看项目
        </Link>
      </Button>
    );
  }
  const selected = projects.find((project) => project.id === projectId) ?? projects[0];
  if (!selected) return null;
  return (
    <div
      className="flex min-w-0 max-w-full flex-nowrap items-center gap-1.5"
      onClick={stopPropagation ? stopCardActivatePropagation : undefined}
      onKeyDown={stopPropagation ? stopCardActivatePropagation : undefined}
    >
      <label className="sr-only" htmlFor={selectId}>
        关联项目
      </label>
      <select
        id={selectId}
        aria-label="关联项目"
        className="h-8 max-w-[6.5rem] min-w-0 rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
        value={selected.id}
        onChange={(event) => setProjectId(event.target.value)}
      >
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <Button type="button" size="sm" variant="outline" asChild>
        <Link to={`/projects/${selected.id}`} aria-label="查看项目">
          查看项目
        </Link>
      </Button>
    </div>
  );
}

/** 详情页关联商单（可多选） */
function ProjectJump({ projects }: { projects: MonitorCard['projects'] }) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  if (projects.length === 0) return null;
  if (projects.length === 1) {
    const project = projects[0];
    if (!project) return null;
    return (
      <Button type="button" size="sm" variant="outline" asChild>
        <Link to={`/projects/${project.id}`}>关联商单</Link>
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
        <Link to={`/projects/${selected.id}`}>关联商单</Link>
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
  const navigate = useNavigate();
  const mutations = useMonitorTargetMutations();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const pending =
    mutations.create.isPending ||
    mutations.patch.isPending ||
    mutations.remove.isPending ||
    mutations.run.isPending;
  const removeError =
    mutations.remove.error instanceof Error ? mutations.remove.error.message : null;
  const error =
    pinError ||
    (mutations.create.error instanceof Error && mutations.create.error.message) ||
    (mutations.patch.error instanceof Error && mutations.patch.error.message) ||
    (!removeOpen && removeError) ||
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
  const detailHref = `/monitoring/${detailKind}/${encodeURIComponent(card.externalId)}?from=${encodeURIComponent(listQuery)}`;
  const detailsId = `monitor-details-${card.type}-${card.externalId}`;
  const failed = failureLine(card);
  const failedDot = card.execution === 'failed';
  /** card = 列表/网格；panel = 分栏右侧；page = 实体详情页 */
  const surface =
    layout === 'card' ? 'card' : includeDetailLink ? ('panel' as const) : ('page' as const);
  const useVideoGrid = surface === 'card' && presentation === 'grid' && card.type === 'video';
  const useCreatorGrid = surface === 'card' && presentation === 'grid' && card.type === 'creator';
  const isVideoCardSurface = card.type === 'video' && (surface === 'card' || surface === 'panel');

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
              label: '继续',
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

  const detailLinkButton = (
    <Button type="button" size="sm" variant="outline" asChild>
      <Link to={detailHref} aria-label="查看详情">
        查看详情
      </Link>
    </Button>
  );

  const projectViewLink = (
    <ProjectViewLink
      projects={card.projects}
      selectId={`card-project-${card.type}-${card.externalId}`}
      stopPropagation={surface === 'card'}
    />
  );

  const confirmRemove = () => {
    if (!card.target) return;
    mutations.remove.mutate(card.target.id, {
      onSuccess: () => {
        setRemoveOpen(false);
        toast('已移除监控');
        navigate(detailReturnHref(detailKind, listQuery || null));
      },
    });
  };

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
        projectLink={projectViewLink}
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
        onPinError={onPinError}
        {...(onSelect ? { onSelect } : {})}
      />
    );
  }

  /** 列表卡片：视频仅四项；UP 主保持主操作 + B 站外链 */
  if (surface === 'card') {
    const metricsLine = card.hasSamples
      ? card.type === 'video'
        ? formatVideoCardMetricsSummary(card.latest)
        : `粉丝 ${formatCount(card.latest.followerCount)}`
      : '尚无采集数据';
    const kindLabel = card.type === 'video' ? '视频' : 'UP 主';

    return (
      <div
        role="button"
        tabIndex={0}
        aria-pressed={selected}
        aria-label={`选择${kindLabel} ${card.displayName}`}
        onClick={() => onSelect?.()}
        onKeyDown={(event) => handleCardActivateKey(event, onSelect)}
        className={cn(
          'flex min-w-0 max-w-full cursor-pointer flex-col gap-2 rounded-lg border p-3',
          'transition-colors hover:border-primary/30 hover:bg-accent/20',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
        )}
        data-testid="monitor-card-controls"
        data-presentation="list"
        data-monitor-state={card.monitorState}
        data-execution={card.execution}
        data-external-id={card.externalId}
        data-target-id={card.target?.id ?? ''}
        data-pinned={card.pinned ? 'true' : 'false'}
        data-pending={pending ? 'true' : 'false'}
        aria-busy={pending}
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div className="relative shrink-0">
            <img
              src={coverAssetUrl(card.imageAssetId)}
              alt=""
              width={card.type === 'creator' ? 56 : 96}
              height={card.type === 'creator' ? 56 : 54}
              data-testid={card.type === 'creator' ? 'monitor-list-avatar' : 'monitor-list-cover'}
              className={cn(
                'object-cover',
                card.type === 'creator' ? 'size-14 rounded-full' : 'aspect-video w-24 rounded-md',
              )}
            />
            <MonitorPinButton
              kind={card.type}
              id={card.externalId}
              pinned={card.pinned}
              onError={onPinError}
              className="absolute -right-1 -top-1 z-10 size-6"
              testId={card.type === 'video' ? 'video-pin-button' : 'monitor-pin-button'}
            />
          </div>
          <div className="min-w-0 flex-1 basis-[10rem] space-y-1 text-left">
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
          </div>
          <div
            data-testid="monitor-card-actions"
            className="ml-auto flex shrink-0 flex-nowrap items-center justify-end gap-1.5"
            onClick={stopCardActivatePropagation}
            onKeyDown={stopCardActivatePropagation}
          >
            {card.type === 'creator' ? (
              <>
                <BilibiliExternalLinkButton kind="creator" id={card.externalId} />
                {primary}
              </>
            ) : (
              <>
                {primary}
                {detailLinkButton}
                {projectViewLink}
              </>
            )}
          </div>
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

  /** 分栏右侧面板：与卡片同口径，次要操作只留在详情页 */
  if (surface === 'panel') {
    return (
      <div
        className="flex min-w-0 max-w-full flex-col gap-2"
        data-testid="monitor-card-controls"
        data-monitor-state={card.monitorState}
        data-execution={card.execution}
        data-external-id={card.externalId}
        data-target-id={card.target?.id ?? ''}
        data-pending={pending ? 'true' : 'false'}
        aria-busy={pending}
      >
        <div
          role="group"
          aria-label="分栏监控操作"
          data-testid="monitor-detail-bar"
          className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto"
        >
          <MonitorStateBadge state={card.monitorState} failed={failedDot} />
          {primary}
          {detailLinkButton}
          {isVideoCardSurface ? projectViewLink : null}
          {card.type === 'creator' ? (
            <BilibiliExternalLinkButton kind="creator" id={card.externalId} />
          ) : null}
        </div>
        {failed ? (
          <p data-testid="monitor-last-failure" className="break-words text-xs text-destructive">
            {failed}
          </p>
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
      </div>
    );
  }

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

  const removeButton = card.target ? (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      disabled={pending}
      aria-label="移除"
      data-testid="remove-monitor-button"
      onClick={() => {
        mutations.remove.reset();
        setRemoveOpen(true);
      }}
    >
      移除
    </Button>
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
      <div
        role="group"
        aria-label="详情页监控操作"
        data-testid="monitor-detail-bar"
        className="flex min-w-0 flex-wrap items-center gap-2"
      >
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
        {logsLink}
        {settingsButton}
        {runButton}
        <ProjectJump projects={card.projects} />
        {removeButton}
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
      {settingsOpen && card.target ? (
        <MonitorSettingsDialog card={card} open={settingsOpen} onOpenChange={setSettingsOpen} />
      ) : null}
      {card.target ? (
        <RemoveMonitorDialog
          open={removeOpen}
          onOpenChange={(open) => {
            setRemoveOpen(open);
            if (!open) mutations.remove.reset();
          }}
          pending={mutations.remove.isPending}
          error={removeError}
          description={
            card.type === 'creator'
              ? '移除后将停止采集该 UP 主数据，历史样本保留，可重新添加恢复。'
              : '移除后将停止采集该视频数据，历史样本保留，可重新添加恢复。'
          }
          onConfirm={confirmRemove}
        />
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
