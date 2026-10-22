import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  parseCreateMonitorTargetRequest,
  serializeCreateMonitorTargetRequest,
  type DynamicTargetRef,
  type OpsCollectorJob,
} from '@studio/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMonitorTargetMutations } from '@/api/hooks/use-monitor-target-queries';
import { Button } from '@/components/ui/button';
import { MonitorStateBadge } from '@/features/monitoring/monitor-state-badge';
import { fetchOpsCollectorJobs } from '@/features/ops/ops-client';
import { formatShanghaiDateTime, jobStatusLabel } from '@/features/ops/ops-format';
import { formatFullLocalTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';

function monitorStateFromTarget(
  target: DynamicTargetRef | null,
): 'unmonitored' | 'active' | 'paused' {
  if (!target) return 'unmonitored';
  return target.enabled ? 'active' : 'paused';
}

function whenText(value: string | null): string {
  return value ? formatFullLocalTime(value) : '暂无';
}

function RecentCollectLogs({
  targetId,
  externalId,
}: {
  targetId: string | null;
  externalId: string;
}) {
  const jobsQuery = useQuery({
    queryKey: ['ops', 'collector-jobs', 'dynamic', externalId, targetId] as const,
    queryFn: async () => {
      const result = await fetchOpsCollectorJobs({
        type: 'dynamic',
        externalId,
        ...(targetId ? { targetId } : {}),
        page: 1,
        pageSize: 5,
      });
      if (result.mode === 'target') {
        return result.items.flatMap((group) => group.jobs).slice(0, 5);
      }
      return result.items;
    },
    enabled: Boolean(externalId),
  });

  if (jobsQuery.isLoading) {
    return <p className="text-xs text-muted-foreground">正在加载采集记录…</p>;
  }
  if (jobsQuery.isError) {
    return (
      <p role="alert" className="text-xs text-destructive">
        {jobsQuery.error instanceof Error ? jobsQuery.error.message : '采集记录加载失败'}
      </p>
    );
  }
  const jobs = jobsQuery.data ?? [];
  if (jobs.length === 0) {
    return <p className="text-xs text-muted-foreground">暂无采集记录</p>;
  }
  return (
    <ul className="space-y-1.5" data-testid="dynamic-collect-logs">
      {jobs.map((job: OpsCollectorJob) => (
        <li key={job.id} className="break-words tabular-nums">
          <span>{formatShanghaiDateTime(job.scheduledFor)}</span>
          <span className="mx-1.5 text-muted-foreground">·</span>
          <span>{jobStatusLabel(job.status)}</span>
          {job.error ? (
            <>
              <span className="mx-1.5 text-muted-foreground">·</span>
              <span className="text-destructive">{job.error}</span>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function DynamicMonitorControls({
  dynamicId,
  target,
  listQuery = '',
  layout = 'card',
  onStarted,
}: {
  dynamicId: string;
  target: DynamicTargetRef | null;
  listQuery?: string;
  layout?: 'card' | 'detail';
  onStarted?: (result: { message: string; enabled: boolean }) => void;
}) {
  const mutations = useMonitorTargetMutations();
  const [detailsOpen, setDetailsOpen] = useState(layout === 'detail');
  const [notice, setNotice] = useState<string | null>(null);
  const monitorState = monitorStateFromTarget(target);
  const pending =
    mutations.create.isPending || mutations.patch.isPending || mutations.run.isPending;
  const error =
    (mutations.create.error instanceof Error && mutations.create.error.message) ||
    (mutations.patch.error instanceof Error && mutations.patch.error.message) ||
    (mutations.run.error instanceof Error && mutations.run.error.message) ||
    null;
  const detailsId = `dynamic-monitor-details-${dynamicId}`;
  const failed = Boolean(target?.lastError?.trim());
  const detailHref = `/monitoring/dynamics/${encodeURIComponent(dynamicId)}${
    listQuery ? `?from=${encodeURIComponent(listQuery)}` : ''
  }`;

  const start = () => {
    setNotice(null);
    const request = parseCreateMonitorTargetRequest({
      type: 'dynamic',
      externalId: dynamicId,
      intervalMode: 'fixed',
      intervalMinutes: 60,
    });
    mutations.create.mutate(serializeCreateMonitorTargetRequest(request), {
      onSuccess: (result) => {
        setNotice(result.message);
        onStarted?.({ message: result.message, enabled: result.target.enabled });
      },
    });
  };

  const primaryAction =
    monitorState === 'unmonitored'
      ? { label: '开始监控', onClick: start, variant: 'default' as const }
      : monitorState === 'active' && target
        ? {
            label: '暂停',
            onClick: () => mutations.patch.mutate({ id: target.id, patch: { enabled: false } }),
            variant: 'outline' as const,
          }
        : monitorState === 'paused' && target
          ? {
              label: '恢复',
              onClick: () => mutations.patch.mutate({ id: target.id, patch: { enabled: true } }),
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

  const logsLink = target ? (
    <Button type="button" size="sm" variant="outline" asChild>
      <Link
        to={`/ops?${new URLSearchParams({
          targetId: target.id,
          targetType: 'dynamic',
          externalId: dynamicId,
        }).toString()}`}
      >
        查看日志
      </Link>
    </Button>
  ) : (
    <Button type="button" size="sm" variant="outline" asChild>
      <Link to="/ops">查看采集记录</Link>
    </Button>
  );

  if (layout === 'card') {
    return (
      <div
        className="ml-auto flex shrink-0 items-center justify-end gap-1.5"
        data-testid="dynamic-monitor-controls"
        data-monitor-state={monitorState}
        data-external-id={dynamicId}
        data-target-id={target?.id ?? ''}
        data-pending={pending ? 'true' : 'false'}
        aria-busy={pending}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <Button type="button" size="sm" variant="outline" asChild>
          <Link to={detailHref} aria-label={`查看动态 ${dynamicId} 详情`}>
            详情
          </Link>
        </Button>
        {primary}
        {notice ? (
          <p role="status" className="basis-full break-words text-xs text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="basis-full break-words text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn('flex min-w-0 max-w-full flex-col gap-2')}
      data-testid="dynamic-monitor-controls"
      data-monitor-state={monitorState}
      data-external-id={dynamicId}
      data-target-id={target?.id ?? ''}
      data-pending={pending ? 'true' : 'false'}
      aria-busy={pending}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <MonitorStateBadge state={monitorState} failed={failed} />
        {primary}
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
        {logsLink}
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
      {detailsOpen ? (
        <div
          id={detailsId}
          data-testid="dynamic-monitor-details"
          className="grid gap-2 rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
        >
          <p>
            频率：
            {target ? `固定间隔 · 每 ${target.intervalMinutes} 分钟` : '未设置频率'}
          </p>
          <p className="tabular-nums">上一次成功采集：{whenText(target?.lastSuccessAt ?? null)}</p>
          {target?.lastError ? (
            <p className="break-words text-destructive" data-testid="dynamic-last-failure">
              最近失败：{target.lastError}
            </p>
          ) : null}
          <div>
            <p className="mb-1 font-medium text-foreground">最近采集记录</p>
            <RecentCollectLogs targetId={target?.id ?? null} externalId={dynamicId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
