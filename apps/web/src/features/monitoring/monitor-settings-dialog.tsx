import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MONITOR_INTERVAL_MINUTES,
  isMonitorIntervalMinutes,
  parsePatchMonitorTargetRequest,
  splitTagInput,
  type CreatorDiscoveryConfig,
  type MonitorCard,
  type MonitorIntervalMinutes,
} from '@studio/contracts';
import { useMonitorTargetMutations } from '@/api/hooks/use-monitor-target-queries';
import { fetchCreatorDiscovery, putCreatorDiscovery } from '@/api/monitor-client';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  datetimeLocalToOffsetIso,
  formatStartAtDisplay,
  offsetIsoToDatetimeLocal,
} from '@/lib/datetime-local';

const INTERVAL_LABEL: Record<MonitorIntervalMinutes, string> = {
  5: '每 5 分钟',
  15: '每 15 分钟',
  30: '每 30 分钟',
  60: '每 60 分钟',
  180: '每 3 小时',
  360: '每 6 小时',
  720: '每 12 小时',
  1440: '每天',
};

/** Mirrors API: reschedule only while never successfully collected and not running. */
export function canRescheduleMonitorStartAt(card: MonitorCard): boolean {
  return (
    card.type === 'video' &&
    Boolean(card.target) &&
    card.target?.lastSuccessAt == null &&
    card.execution !== 'running'
  );
}

export function rescheduleStartAtBlockedReason(card: MonitorCard): string | null {
  if (card.type !== 'video' || !card.target) return null;
  if (card.execution === 'running') return '正在采集，不能改计划开始时间';
  if (card.target.lastSuccessAt) return '已开始采集，不能再改计划开始时间';
  return null;
}

export function MonitorSettingsDialog({
  card,
  open,
  onOpenChange,
}: {
  card: MonitorCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const target = card.target;
  const mutations = useMonitorTargetMutations();
  const [label, setLabel] = useState(target?.label ?? '');
  const [tags, setTags] = useState(target?.tags.join(', ') ?? '');
  const [intervalMode, setIntervalMode] = useState<'auto' | 'fixed'>(
    target?.intervalMode ?? 'auto',
  );
  const initialMinutes =
    target && isMonitorIntervalMinutes(target.intervalMinutes) ? target.intervalMinutes : 15;
  const [intervalMinutes, setIntervalMinutes] = useState<number>(
    target?.intervalMinutes ?? initialMinutes,
  );
  const [startAtLocal, setStartAtLocal] = useState(
    target?.startAt ? offsetIsoToDatetimeLocal(target.startAt) : '',
  );
  const [formError, setFormError] = useState<string | null>(null);
  const [startAtNotice, setStartAtNotice] = useState<string | null>(null);
  const [discoverEnabled, setDiscoverEnabled] = useState(false);
  const [discoverVideos, setDiscoverVideos] = useState(true);
  const [discoverDynamics, setDiscoverDynamics] = useState(true);
  const [monitorNewVideos, setMonitorNewVideos] = useState(false);
  const [discoverySnapshot, setDiscoverySnapshot] = useState<CreatorDiscoveryConfig | null>(null);
  const queryClient = useQueryClient();
  const showDiscovery = card.type === 'creator';
  const discoveryQuery = useQuery({
    queryKey: ['monitor', 'creator-discovery', card.externalId] as const,
    queryFn: () => fetchCreatorDiscovery(card.externalId),
    enabled: open && showDiscovery && Boolean(card.externalId),
  });
  const discoveryMutation = useMutation({
    mutationFn: (body: {
      enabled: boolean;
      discoverVideos: boolean;
      discoverDynamics: boolean;
      monitorNewVideos: boolean;
    }) => putCreatorDiscovery(card.externalId, body),
    onSuccess: (config) => {
      setDiscoverySnapshot(config);
      void queryClient.invalidateQueries({
        queryKey: ['monitor', 'creator-discovery', card.externalId],
      });
    },
  });

  useEffect(() => {
    if (!discoveryQuery.data) return;
    setDiscoverEnabled(discoveryQuery.data.enabled);
    setDiscoverVideos(discoveryQuery.data.discoverVideos);
    setDiscoverDynamics(discoveryQuery.data.discoverDynamics);
    setMonitorNewVideos(discoveryQuery.data.monitorNewVideos);
    setDiscoverySnapshot(discoveryQuery.data);
  }, [discoveryQuery.data]);

  if (!target) return null;

  const choices = Array.from(new Set<number>([...MONITOR_INTERVAL_MINUTES, intervalMinutes])).sort(
    (left, right) => left - right,
  );
  const showStartAt = card.type === 'video';
  const canReschedule = canRescheduleMonitorStartAt(card);
  const blockedReason = rescheduleStartAtBlockedReason(card);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setStartAtNotice(null);
    const nextTags = tags.trim() ? splitTagInput(tags) : [];
    const patch: Record<string, unknown> = {};
    if (label.trim() !== target.label) patch.label = label.trim();
    if (nextTags.join('\n') !== target.tags.join('\n')) patch.tags = nextTags;
    if (intervalMode !== target.intervalMode) patch.intervalMode = intervalMode;
    if (intervalMode === 'fixed' && intervalMinutes !== target.intervalMinutes) {
      patch.intervalMinutes = intervalMinutes;
    }
    if (showStartAt && canReschedule) {
      const trimmed = startAtLocal.trim();
      if (!trimmed) {
        if (target.startAt !== null) patch.startAt = null;
      } else {
        try {
          const next = datetimeLocalToOffsetIso(trimmed);
          // Compare as instants: API stores UTC ISO; input is offset-local.
          const normalized = parsePatchMonitorTargetRequest({ startAt: next }).startAt;
          if (normalized !== target.startAt) patch.startAt = next;
        } catch (error) {
          setFormError(error instanceof Error ? error.message : '请输入合法的计划上线时间');
          return;
        }
      }
    }

    let nextDiscoverVideos = discoverVideos;
    let nextDiscoverDynamics = discoverDynamics;
    let nextMonitorNewVideos = monitorNewVideos;
    if (showDiscovery && discoverEnabled) {
      if (!nextDiscoverVideos && !nextDiscoverDynamics) {
        setFormError('开启发现时至少勾选视频或动态');
        return;
      }
      if (nextMonitorNewVideos && !nextDiscoverVideos) {
        setFormError('同时监控新视频数据需要先开启发现视频');
        return;
      }
    } else if (showDiscovery) {
      nextDiscoverVideos = false;
      nextDiscoverDynamics = false;
      nextMonitorNewVideos = false;
    }

    const discoveryChanged =
      showDiscovery &&
      (!discoverySnapshot ||
        discoverEnabled !== discoverySnapshot.enabled ||
        nextDiscoverVideos !== discoverySnapshot.discoverVideos ||
        nextDiscoverDynamics !== discoverySnapshot.discoverDynamics ||
        nextMonitorNewVideos !== discoverySnapshot.monitorNewVideos);

    if (Object.keys(patch).length === 0 && !discoveryChanged) {
      setFormError('没有需要保存的修改');
      return;
    }

    const saveDiscovery = async () => {
      if (!discoveryChanged) return;
      try {
        await discoveryMutation.mutateAsync({
          enabled: discoverEnabled,
          discoverVideos: discoverEnabled ? nextDiscoverVideos : false,
          discoverDynamics: discoverEnabled ? nextDiscoverDynamics : false,
          monitorNewVideos: discoverEnabled ? nextMonitorNewVideos : false,
        });
      } catch (error) {
        if (discoverySnapshot) {
          setDiscoverEnabled(discoverySnapshot.enabled);
          setDiscoverVideos(discoverySnapshot.discoverVideos);
          setDiscoverDynamics(discoverySnapshot.discoverDynamics);
          setMonitorNewVideos(discoverySnapshot.monitorNewVideos);
        }
        throw error;
      }
    };

    const finish = () => {
      void saveDiscovery()
        .then(() => onOpenChange(false))
        .catch((error: unknown) => {
          setFormError(error instanceof Error ? error.message : '发现设置保存失败，已回滚');
        });
    };

    if (Object.keys(patch).length === 0) {
      finish();
      return;
    }
    try {
      const request = parsePatchMonitorTargetRequest(patch);
      mutations.patch.mutate(
        { id: target.id, patch: request },
        {
          onSuccess: () => {
            if ('startAt' in request) setStartAtNotice('计划开始时间已更新');
            finish();
          },
          onError: (error) => {
            setFormError(error instanceof Error ? error.message : '保存失败');
          },
        },
      );
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '校验失败');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="monitor-settings-dialog">
        <DialogHeader>
          <DialogTitle>监控设置</DialogTitle>
          <DialogDescription>
            修改频率、名称或标签。自动模式沿用现有年龄策略，不会改成固定 60 分钟。
          </DialogDescription>
        </DialogHeader>
        <form className="mt-4 grid min-w-0 gap-3" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor={`monitor-settings-label-${target.id}`}>名称</Label>
            <Input
              id={`monitor-settings-label-${target.id}`}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`monitor-settings-tags-${target.id}`}>标签</Label>
            <Input
              id={`monitor-settings-tags-${target.id}`}
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={`monitor-settings-mode-${target.id}`}>频率</Label>
            <select
              id={`monitor-settings-mode-${target.id}`}
              className="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
              value={intervalMode}
              onChange={(event) => setIntervalMode(event.target.value as 'auto' | 'fixed')}
            >
              <option value="auto">自动</option>
              <option value="fixed">固定</option>
            </select>
          </div>
          {intervalMode === 'fixed' ? (
            <div className="grid gap-1.5">
              <Label htmlFor={`monitor-settings-interval-${target.id}`}>固定间隔</Label>
              <select
                id={`monitor-settings-interval-${target.id}`}
                className="flex h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                value={String(intervalMinutes)}
                onChange={(event) => setIntervalMinutes(Number(event.target.value))}
              >
                {choices.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {isMonitorIntervalMinutes(minutes)
                      ? INTERVAL_LABEL[minutes]
                      : `每 ${minutes} 分钟`}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {showStartAt ? (
            <div className="grid gap-1.5" data-testid="monitor-settings-start-at">
              <Label htmlFor={`monitor-settings-start-at-${target.id}`}>计划开始</Label>
              <p className="text-sm" data-testid="monitor-settings-start-at-display">
                {formatStartAtDisplay(target.startAt)}
              </p>
              {canReschedule ? (
                <>
                  <Input
                    id={`monitor-settings-start-at-${target.id}`}
                    type="datetime-local"
                    data-testid="monitor-settings-start-at-input"
                    value={startAtLocal}
                    onChange={(event) => setStartAtLocal(event.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    改期或清空（留空）后保存。清空表示立即开始采集。
                  </p>
                </>
              ) : (
                <p
                  className="text-xs text-muted-foreground"
                  data-testid="monitor-settings-start-at-blocked"
                >
                  {blockedReason ?? '当前不可改期'}
                </p>
              )}
            </div>
          ) : null}
          {showDiscovery ? (
            <fieldset
              className="grid gap-2 rounded-md border border-border p-3"
              data-testid="monitor-settings-discovery"
            >
              <legend className="px-1 text-sm font-medium">发现新内容</legend>
              <p className="text-xs text-muted-foreground">
                默认关闭。开启后约每 5 分钟检查该 UP
                主的新视频/动态，并在粉丝折线图上标记；不推断涨粉因果。
              </p>
              {discoveryQuery.isError ? (
                <p className="text-xs text-destructive">
                  {discoveryQuery.error instanceof Error
                    ? discoveryQuery.error.message
                    : '无法加载发现设置'}
                </p>
              ) : null}
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={discoverEnabled}
                  onChange={(event) => setDiscoverEnabled(event.target.checked)}
                  data-testid="monitor-settings-discovery-enabled"
                />
                发现新内容
              </label>
              {discoverEnabled ? (
                <>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={discoverVideos}
                      onChange={(event) => setDiscoverVideos(event.target.checked)}
                      data-testid="monitor-settings-discovery-videos"
                    />
                    发现新视频
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={discoverDynamics}
                      onChange={(event) => setDiscoverDynamics(event.target.checked)}
                      data-testid="monitor-settings-discovery-dynamics"
                    />
                    发现新动态（仅图表标记，不自动建动态监控）
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={monitorNewVideos}
                      disabled={!discoverVideos}
                      onChange={(event) => setMonitorNewVideos(event.target.checked)}
                      data-testid="monitor-settings-discovery-monitor-new"
                    />
                    同时监控他的新视频数据（前 5 天每 15 分钟，后 5 天每 30 分钟，10 天后恢复常规）
                  </label>
                </>
              ) : null}
            </fieldset>
          ) : null}
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          {startAtNotice ? (
            <p role="status" className="text-sm text-muted-foreground">
              {startAtNotice}
            </p>
          ) : null}
          <Button type="submit" disabled={mutations.patch.isPending}>
            {mutations.patch.isPending ? '正在保存' : '保存'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
