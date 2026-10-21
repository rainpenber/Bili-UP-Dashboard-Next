import { MonitorRequestError } from '@/api/monitor-targets-client';
import { useMonitorJobsQuery } from '@/api/hooks/use-monitor-target-queries';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';

export function RecentCollectorJobs() {
  const jobsQuery = useMonitorJobsQuery(1, true);
  return (
    <section aria-label="最近采集任务" className="mt-6 grid min-w-0 gap-2">
      <h2 className="text-sm font-medium">最近采集任务</h2>
      {jobsQuery.isLoading ? <LoadingListSkeleton rows={1} /> : null}
      {jobsQuery.isError ? (
        <ErrorState
          title="任务加载失败"
          message={
            jobsQuery.error instanceof MonitorRequestError
              ? jobsQuery.error.message
              : jobsQuery.error instanceof Error
                ? jobsQuery.error.message
                : '加载失败'
          }
          onRetry={() => void jobsQuery.refetch()}
        />
      ) : null}
      {jobsQuery.isSuccess && jobsQuery.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">还没有采集任务。</p>
      ) : null}
      {jobsQuery.isSuccess && jobsQuery.data.items.length > 0 ? (
        <ul className="grid min-w-0 grid-cols-1 gap-2">
          {jobsQuery.data.items.map((job) => (
            <li
              key={job.id}
              className="min-w-0 break-words rounded-lg border px-3 py-2 text-xs text-muted-foreground"
            >
              <span className="font-medium text-foreground">{job.externalId}</span> · {job.status} ·
              尝试 {job.attempts}
              {job.latestRun ? ` · 写入 ${job.latestRun.samplesWritten} 条` : ''}
              {job.error ? ` · ${job.error}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
