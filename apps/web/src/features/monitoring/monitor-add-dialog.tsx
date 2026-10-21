import { useState, type FormEvent } from 'react';
import {
  MONITOR_INTERVAL_MINUTES,
  parseCreateMonitorTargetRequest,
  parseMonitorExternalInput,
  serializeCreateMonitorTargetRequest,
  splitTagInput,
  type MonitorIntervalMinutes,
  type MonitorTargetType,
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

export function MonitorAddDialog({
  open,
  type,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  type: MonitorTargetType;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: { externalId: string; message: string; enabled: boolean }) => void;
}) {
  const [externalInput, setExternalInput] = useState('');
  const [label, setLabel] = useState('');
  const [tags, setTags] = useState('');
  const [intervalMode, setIntervalMode] = useState<'auto' | 'fixed'>('auto');
  const [intervalMinutes, setIntervalMinutes] = useState<MonitorIntervalMinutes>(15);
  const [formError, setFormError] = useState<string | null>(null);
  const mutations = useMonitorTargetMutations();

  const reset = () => {
    setExternalInput('');
    setLabel('');
    setTags('');
    setIntervalMode('auto');
    setIntervalMinutes(15);
    setFormError(null);
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    const parsedId = parseMonitorExternalInput(type, externalInput);
    if (!parsedId.ok) {
      setFormError(parsedId.message);
      return;
    }
    try {
      const request = parseCreateMonitorTargetRequest({
        type,
        externalId: parsedId.externalId,
        intervalMode,
        ...(intervalMode === 'fixed' ? { intervalMinutes } : {}),
        ...(label.trim() ? { label } : {}),
        ...(tags.trim() ? { tags: splitTagInput(tags) } : {}),
      });
      const body = serializeCreateMonitorTargetRequest(request);
      mutations.create.mutate(body, {
        onSuccess: (result) => {
          onCreated({
            externalId: result.target.externalId,
            message: result.message,
            enabled: result.target.enabled,
          });
          reset();
          onOpenChange(false);
        },
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : '添加失败');
        },
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '校验失败');
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent data-testid="monitor-add-dialog">
        <DialogHeader>
          <DialogTitle>新增监控</DialogTitle>
          <DialogDescription>
            {type === 'video'
              ? '视频默认按发布年龄自动采集：3 天内 15 分钟，14 天内 120 分钟，其后 360 分钟。'
              : 'UP 主默认自动采集，间隔 240 分钟。'}
            需要固定间隔时再选择下方频率。不会把 60 分钟当作默认策略。
          </DialogDescription>
        </DialogHeader>
        <form className="mt-4 grid gap-3" onSubmit={onSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="monitor-add-type">类型</Label>
            <Input id="monitor-add-type" value={type === 'video' ? '视频' : 'UP 主'} readOnly />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="monitor-add-identity">
              {type === 'video' ? 'BV 号或视频长链接' : 'UID 或空间长链接'}
            </Label>
            <Input
              id="monitor-add-identity"
              value={externalInput}
              autoComplete="off"
              placeholder={
                type === 'video'
                  ? 'BV… 或 https://www.bilibili.com/video/BV…'
                  : 'UID 或 https://space.bilibili.com/…'
              }
              onChange={(event) => setExternalInput(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="monitor-add-mode">频率</Label>
            <select
              id="monitor-add-mode"
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={intervalMode}
              onChange={(event) => setIntervalMode(event.target.value as 'auto' | 'fixed')}
            >
              <option value="auto">自动</option>
              <option value="fixed">固定</option>
            </select>
          </div>
          {intervalMode === 'fixed' ? (
            <div className="grid gap-1.5">
              <Label htmlFor="monitor-add-interval">固定间隔</Label>
              <select
                id="monitor-add-interval"
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={String(intervalMinutes)}
                onChange={(event) =>
                  setIntervalMinutes(Number(event.target.value) as MonitorIntervalMinutes)
                }
              >
                {MONITOR_INTERVAL_MINUTES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {INTERVAL_LABEL[minutes]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          <div className="grid gap-1.5">
            <Label htmlFor="monitor-add-label">名称（可选）</Label>
            <Input
              id="monitor-add-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="monitor-add-tags">标签（可选，逗号分隔）</Label>
            <Input
              id="monitor-add-tags"
              value={tags}
              onChange={(event) => setTags(event.target.value)}
            />
          </div>
          {formError ? (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={mutations.create.isPending}>
              {mutations.create.isPending ? '正在添加' : '添加'}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              取消
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
