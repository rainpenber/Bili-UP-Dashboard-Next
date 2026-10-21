import { useState, type FormEvent } from 'react';
import {
  MONITOR_INTERVAL_MINUTES,
  isMonitorIntervalMinutes,
  parsePatchMonitorTargetRequest,
  splitTagInput,
  type MonitorCard,
  type MonitorIntervalMinutes,
} from '@studio/contracts';
import { useMonitorTargetMutations } from '@/api/hooks/use-monitor-target-queries';
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
  const [formError, setFormError] = useState<string | null>(null);

  if (!target) return null;

  const choices = Array.from(new Set<number>([...MONITOR_INTERVAL_MINUTES, intervalMinutes])).sort(
    (left, right) => left - right,
  );

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const nextTags = tags.trim() ? splitTagInput(tags) : [];
    const patch: Record<string, unknown> = {};
    if (label.trim() !== target.label) patch.label = label.trim();
    if (nextTags.join('\n') !== target.tags.join('\n')) patch.tags = nextTags;
    if (intervalMode !== target.intervalMode) patch.intervalMode = intervalMode;
    if (intervalMode === 'fixed' && intervalMinutes !== target.intervalMinutes) {
      patch.intervalMinutes = intervalMinutes;
    }
    if (Object.keys(patch).length === 0) {
      setFormError('没有需要保存的修改');
      return;
    }
    try {
      const request = parsePatchMonitorTargetRequest(patch);
      mutations.patch.mutate(
        { id: target.id, patch: request },
        {
          onSuccess: () => onOpenChange(false),
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
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
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
