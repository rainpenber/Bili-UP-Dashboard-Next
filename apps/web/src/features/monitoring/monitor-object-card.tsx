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

const EXECUTION_LABEL = {
  waiting: '等待',
  running: '执行中',
  failed: '最近失败',
  none: '暂无进行中的任务',
} as const;

function whenText(value: string | null): string {
  return value ? formatFullLocalTime(value) : '暂无';
}

export function monitorFrequencyText(card: MonitorCard): string {
  if (!card.target) return '未设置频率';
  if (card.target.intervalMode === 'fixed') {
    return `固定 · 每 ${card.target.intervalMinutes} 分钟`;
  }
  if (card.type === 'creator') return '自动 · 每 240 分钟';
  return '自动 · 按发布年龄 15/120/360 分钟';
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
}: {
  card: MonitorCard;
  listQuery: string;
  includeDetailLink?: boolean;
}) {
  const mutations = useMonitorTargetMutations();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
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

  return (
    <div
      className="min-w-0 max-w-full space-y-2"
      data-testid="monitor-card-controls"
      data-monitor-state={card.monitorState}
      data-execution={card.execution}
      data-external-id={card.externalId}
      data-target-id={card.target?.id ?? ''}
      data-pending={pending ? 'true' : 'false'}
      aria-busy={pending}
    >
      <div className="flex flex-wrap items-center gap-2">
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
        <Badge
          variant={
            card.execution === 'failed'
              ? 'destructive'
              : card.execution === 'running'
                ? 'info'
                : 'outline'
          }
        >
          {EXECUTION_LABEL[card.execution]}
        </Badge>
      </div>
      <p className="break-words text-xs text-muted-foreground">{monitorFrequencyText(card)}</p>
      <p className="break-words text-xs tabular-nums text-muted-foreground">
        最近成功 {whenText(card.target?.lastSuccessAt ?? null)} · 下次计划{' '}
        {whenText(card.target?.nextRunAt ?? null)}
      </p>
      {card.hasSamples ? null : <p className="text-xs text-muted-foreground">尚无采集数据</p>}
      {card.target?.lastError && card.execution === 'failed' ? (
        <p className="break-words text-xs text-destructive">{card.target.lastError}</p>
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
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        {card.monitorState === 'unmonitored' ? (
          <Button type="button" size="sm" disabled={pending} onClick={start}>
            开始监控
          </Button>
        ) : null}
        {card.monitorState === 'active' && card.target ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() =>
              mutations.patch.mutate({ id: card.target!.id, patch: { enabled: false } })
            }
          >
            暂停
          </Button>
        ) : null}
        {card.monitorState === 'paused' && card.target ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              mutations.patch.mutate({ id: card.target!.id, patch: { enabled: true } })
            }
          >
            恢复
          </Button>
        ) : null}
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
        {card.target ? (
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
        ) : null}
        {includeDetailLink ? (
          <Button type="button" size="sm" variant="outline" asChild>
            <Link
              to={`/monitoring/${detailKind}/${encodeURIComponent(card.externalId)}?from=${encodeURIComponent(listQuery)}`}
            >
              查看详情
            </Link>
          </Button>
        ) : null}
        {card.target ? (
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
        ) : null}
        <ProjectJump projects={card.projects} />
      </div>
      {moreOpen && card.target ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="更多操作">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => mutations.run.mutate(card.target!.id)}
          >
            立即采集
          </Button>
          {confirmRemove ? (
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
            <Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
              移除
            </Button>
          )}
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
      <div
        className={cn(
          'flex min-w-0 max-w-full flex-col gap-3 rounded-lg border p-3',
          selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
        )}
      >
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 gap-3 rounded-md text-left hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
        <MonitorCardControls card={card} listQuery={listQuery} />
      </div>
    </li>
  );
}
