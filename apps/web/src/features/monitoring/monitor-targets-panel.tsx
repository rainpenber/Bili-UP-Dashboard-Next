import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  MONITOR_INTERVAL_MINUTES,
  parseCreateMonitorTargetRequest,
  splitTagInput,
  type MonitorIntervalMinutes,
  type MonitorTarget,
  type MonitorTargetType,
} from '@studio/contracts';
import { MonitorRequestError } from '@/api/monitor-targets-client';
import {
  useMonitorJobsQuery,
  useMonitorTargetMutations,
  useMonitorTargetsQuery,
} from '@/api/hooks/use-monitor-target-queries';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Pagination } from '@/components/ui/pagination';
import { formatFullLocalTime } from '@/lib/format-time';

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

function formatWhen(value: string | null): string {
  return value ? formatFullLocalTime(value) : '—';
}

function detailHref(target: MonitorTarget): string {
  if (target.type === 'video') return `/monitoring/videos/${encodeURIComponent(target.externalId)}`;
  return `/monitoring/creators/${encodeURIComponent(target.externalId)}`;
}

export function MonitorTargetsPanel() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<MonitorTargetType>('video');
  const [externalId, setExternalId] = useState('');
  const [label, setLabel] = useState('');
  const [tags, setTags] = useState('');
  const [intervalMinutes, setIntervalMinutes] = useState<MonitorIntervalMinutes>(60);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const targetsQuery = useMonitorTargetsQuery(page, true);
  const jobsQuery = useMonitorJobsQuery(1, true);
  const mutations = useMonitorTargetMutations();
  const busy =
    mutations.create.isPending ||
    mutations.patch.isPending ||
    mutations.remove.isPending ||
    mutations.run.isPending;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setFormError(null);
    setFormNotice(null);
    try {
      const request = parseCreateMonitorTargetRequest({
        type,
        externalId,
        ...(label.trim() ? { label } : {}),
        ...(tags.trim() ? { tags: splitTagInput(tags) } : {}),
        intervalMinutes,
      });
      mutations.create.mutate(request, {
        onSuccess: (result) => {
          setFormNotice(result.message);
          if (result.created) {
            setExternalId('');
            setLabel('');
            setTags('');
          }
        },
        onError: (error) => {
          setFormError(error instanceof Error ? error.message : '添加失败');
        },
      });
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '校验失败');
    }
  };

  const actionError =
    mutations.patch.error instanceof Error
      ? mutations.patch.error.message
      : mutations.remove.error instanceof Error
        ? mutations.remove.error.message
        : mutations.run.error instanceof Error
          ? mutations.run.error.message
          : null;

  return (
    <div className="grid grid-cols-1 gap-4" data-testid="monitor-targets-panel">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">添加监控项</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 gap-3" onSubmit={onSubmit}>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="target-type">类型</Label>
                <select
                  id="target-type"
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={type}
                  onChange={(event) => setType(event.target.value as MonitorTargetType)}
                >
                  <option value="video">视频（BV）</option>
                  <option value="creator">UP 主（UID）</option>
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="target-interval">频率</Label>
                <select
                  id="target-interval"
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
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="target-external-id">{type === 'video' ? 'BV 号' : 'UID'}</Label>
              <Input
                id="target-external-id"
                value={externalId}
                placeholder={type === 'video' ? 'BV1xx411c7mD' : '12345'}
                onChange={(event) => setExternalId(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="target-label">名称（可选）</Label>
                <Input
                  id="target-label"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="target-tags">标签（可选，逗号分隔）</Label>
                <Input
                  id="target-tags"
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                />
              </div>
            </div>
            {formError ? (
              <p role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : null}
            {formNotice ? (
              <p role="status" className="text-sm text-muted-foreground">
                {formNotice}
              </p>
            ) : null}
            <div>
              <Button type="submit" disabled={busy}>
                添加监控项
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <section aria-label="监控项列表" className="grid grid-cols-1 gap-3">
        {targetsQuery.isLoading ? <LoadingListSkeleton rows={2} /> : null}
        {targetsQuery.isError ? (
          <ErrorState
            message={
              targetsQuery.error instanceof MonitorRequestError
                ? targetsQuery.error.message
                : targetsQuery.error instanceof Error
                  ? targetsQuery.error.message
                  : '加载失败'
            }
            onRetry={() => void targetsQuery.refetch()}
          />
        ) : null}
        {targetsQuery.isSuccess && targetsQuery.data.items.length === 0 ? (
          <EmptyState
            title="还没有监控项"
            description="添加一个 BV 号或 UID 后，离线采集器会写入第一条样本。"
          />
        ) : null}
        {actionError ? (
          <p role="alert" className="text-sm text-destructive">
            {actionError}
          </p>
        ) : null}
        {targetsQuery.isSuccess && targetsQuery.data.items.length > 0 ? (
          <ul className="grid grid-cols-1 gap-2" data-testid="monitor-target-list">
            {targetsQuery.data.items.map((target) => (
              <li key={target.id} className="rounded-lg border p-3">
                <div className="flex flex-col gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{target.type === 'video' ? '视频' : 'UP 主'}</Badge>
                      <Badge variant={target.enabled ? 'success' : 'secondary'}>
                        {target.enabled ? '采集中' : '已暂停'}
                      </Badge>
                      <span className="truncate font-medium">{target.label}</span>
                    </div>
                    <p className="break-all text-xs text-muted-foreground">{target.externalId}</p>
                    <p className="text-xs text-muted-foreground">
                      {INTERVAL_LABEL[target.intervalMinutes as MonitorIntervalMinutes] ??
                        `每 ${target.intervalMinutes} 分钟`}
                      {target.tags.length > 0 ? ` · ${target.tags.join(' / ')}` : ''}
                    </p>
                    <p className="text-xs tabular-nums text-muted-foreground">
                      最近成功 {formatWhen(target.lastSuccessAt)} · 最近失败{' '}
                      {target.lastError ?? '—'} · 下次计划 {formatWhen(target.nextRunAt)}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        mutations.patch.mutate({
                          id: target.id,
                          patch: { enabled: !target.enabled },
                        })
                      }
                    >
                      {target.enabled ? '暂停' : '恢复'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => mutations.run.mutate(target.id)}
                    >
                      立即采集
                    </Button>
                    <Button type="button" size="sm" variant="outline" asChild>
                      <Link to={detailHref(target)}>查看详情</Link>
                    </Button>
                    {confirmRemoveId === target.id ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          variant="destructive"
                          disabled={busy}
                          onClick={() =>
                            mutations.remove.mutate(target.id, {
                              onSuccess: () => setConfirmRemoveId(null),
                            })
                          }
                        >
                          确认移除
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmRemoveId(null)}
                        >
                          取消
                        </Button>
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmRemoveId(target.id)}
                      >
                        移除
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {targetsQuery.isSuccess ? (
          <Pagination
            page={page}
            totalPages={targetsQuery.data.totalPages}
            disabled={targetsQuery.isFetching}
            onPageChange={setPage}
          />
        ) : null}
      </section>

      <section aria-label="采集任务" className="grid grid-cols-1 gap-2">
        <h2 className="text-sm font-medium">最近采集任务</h2>
        {jobsQuery.isLoading ? <LoadingListSkeleton rows={1} /> : null}
        {jobsQuery.isError ? (
          <ErrorState
            title="任务加载失败"
            message={jobsQuery.error instanceof Error ? jobsQuery.error.message : '加载失败'}
            onRetry={() => void jobsQuery.refetch()}
          />
        ) : null}
        {jobsQuery.isSuccess && jobsQuery.data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">还没有采集任务。</p>
        ) : null}
        {jobsQuery.isSuccess && jobsQuery.data.items.length > 0 ? (
          <ul className="grid grid-cols-1 gap-2">
            {jobsQuery.data.items.map((job) => (
              <li
                key={job.id}
                className="rounded-lg border px-3 py-2 text-xs text-muted-foreground"
              >
                <span className="font-medium text-foreground">{job.externalId}</span> · {job.status}{' '}
                · 尝试 {job.attempts}
                {job.latestRun ? ` · 写入 ${job.latestRun.samplesWritten} 条` : ''}
                {job.error ? ` · ${job.error}` : ''}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
