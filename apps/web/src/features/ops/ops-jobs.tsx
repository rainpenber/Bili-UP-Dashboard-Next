import type { OpsCollectorJob, OpsCollectorJobDetail } from '@studio/contracts';
import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import {
  fetchOpsCollectorJob,
  fetchOpsCollectorJobs,
  fetchOpsCollectorTargets,
  fetchOpsDebugBundle,
  fetchOpsProjects,
} from './ops-client';
import {
  formatDuration,
  formatShanghaiDateTime,
  jobStatusLabel,
  jobStatusVariant,
  safeContext,
  safeText,
} from './ops-format';
import type { OpsView } from './ops-state';

type Patch = Partial<Record<keyof OpsView, string | number | boolean | null>>;

const selectClass = 'h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm';

function writeLine(job: OpsCollectorJob): string {
  if (job.samplesWritten === null) {
    if (job.latestAttempt?.status === 'failed') {
      return `尚未写入 · 最近失败尝试写入 ${job.latestAttempt.samplesWritten}`;
    }
    return '尚未写入';
  }
  return `写入 ${job.samplesWritten}`;
}

function JobRow({ job, onOpen }: { job: OpsCollectorJob; onOpen: (id: string) => void }) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        data-testid="ops-job-row"
        className="flex w-full min-w-0 gap-3 rounded-lg border px-3 py-2 text-left hover:bg-muted/40"
        onClick={() => onOpen(job.id)}
      >
        {job.coverUrl ? (
          <img src={job.coverUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" />
        ) : (
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">
            {job.targetType === 'creator' ? 'UP' : 'BV'}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium" title={job.displayName}>
              {safeText(job.displayName)}
            </span>
            <Badge variant={jobStatusVariant(job.status)}>{jobStatusLabel(job.status)}</Badge>
            {job.targetDeleted ? <Badge variant="outline">已移除</Badge> : null}
          </span>
          <span className="mt-1 block truncate text-xs text-muted-foreground">
            {job.targetType === 'creator' ? 'UP 主' : '视频'} {job.externalId}
            {job.label && job.label !== job.displayName ? ` · ${safeText(job.label)}` : ''}
          </span>
          <span className="mt-1 block text-xs text-muted-foreground">
            计划 {formatShanghaiDateTime(job.scheduledFor)}
            {job.startedAt ? ` · 开始 ${formatShanghaiDateTime(job.startedAt)}` : ' · 未开始'}
            {' · '}耗时 {formatDuration(job.durationMs)}
            {' · '}
            {writeLine(job)}
            {' · '}尝试 {job.attempts}
          </span>
          {job.error ? (
            <span className="mt-1 block truncate text-xs text-destructive">
              {safeText(job.error)}
            </span>
          ) : job.status === 'pending' && job.latestAttempt?.error ? (
            <span className="mt-1 block truncate text-xs text-destructive">
              最近失败：{safeText(job.latestAttempt.error)}
            </span>
          ) : null}
        </span>
      </button>
    </li>
  );
}

export function OpsJobsPanel({
  view,
  reloadKey,
  onChange,
}: {
  view: OpsView;
  reloadKey: number;
  onChange: (patch: Patch) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [list, setList] = useState<Awaited<ReturnType<typeof fetchOpsCollectorJobs>> | null>(null);
  const [targetQuery, setTargetQuery] = useState(view.q);
  const [targetOptions, setTargetOptions] = useState<
    { id: string; displayName: string; externalId: string; type: string; deleted: boolean }[]
  >([]);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectOptions, setProjectOptions] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    setTargetQuery(view.q);
  }, [view.q]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchOpsCollectorJobs(
      {
        type: view.type || undefined,
        targetId: view.targetId || undefined,
        externalId: view.externalId || undefined,
        q: view.q || undefined,
        status: view.status || undefined,
        since: view.since || undefined,
        until: view.until || undefined,
        projectId: view.projectId || undefined,
        group: view.group,
        page: view.page,
        pageSize: 20,
        jobsPerGroup: view.group === 'target' ? 5 : undefined,
      },
      controller.signal,
    )
      .then((next) => {
        if (!controller.signal.aborted) {
          setList(next);
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setList(null);
        setError(reason instanceof Error ? reason.message : '加载失败');
        setLoading(false);
      });
    return () => controller.abort();
  }, [
    view.type,
    view.targetId,
    view.externalId,
    view.q,
    view.status,
    view.since,
    view.until,
    view.projectId,
    view.group,
    view.page,
    reloadKey,
  ]);

  useEffect(() => {
    const q = targetQuery.trim();
    if (q.length === 0) {
      setTargetOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchOpsCollectorTargets({ q, type: view.type || undefined }, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setTargetOptions(result.items);
        })
        .catch(() => {
          if (!controller.signal.aborted) setTargetOptions([]);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [targetQuery, view.type]);

  useEffect(() => {
    const q = projectQuery.trim();
    if (q.length === 0) {
      setProjectOptions([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetchOpsProjects(q, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setProjectOptions(result.items);
        })
        .catch(() => {
          if (!controller.signal.aborted) setProjectOptions([]);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [projectQuery]);

  function openJob(id: string) {
    onChange({ job: id, attemptPage: null });
  }

  return (
    <div className="min-w-0 space-y-4">
      {view.targetId ? (
        <p className="break-all text-sm text-muted-foreground" data-testid="ops-target-filter">
          已按目标筛选
          {view.targetType === 'video' ? ' 视频' : view.targetType === 'creator' ? ' UP 主' : ''}
          {view.externalId ? ` ${view.externalId}` : ''} · {view.targetId}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="ml-2"
            onClick={() =>
              onChange({
                targetId: null,
                targetType: null,
                externalId: null,
                page: null,
              })
            }
          >
            清除对象
          </Button>
        </p>
      ) : null}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0 space-y-1 text-sm">
          <span className="text-muted-foreground">类型</span>
          <select
            aria-label="采集类型"
            className={selectClass}
            value={view.type}
            onChange={(event) => onChange({ type: event.target.value, page: null })}
          >
            <option value="">全部</option>
            <option value="video">视频</option>
            <option value="creator">UP 主</option>
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          <span className="text-muted-foreground">执行状态</span>
          <select
            aria-label="执行状态"
            className={selectClass}
            value={view.status}
            onChange={(event) => onChange({ status: event.target.value, page: null })}
          >
            <option value="">全部</option>
            <option value="pending">排队中</option>
            <option value="running">执行中</option>
            <option value="succeeded">成功</option>
            <option value="failed">失败</option>
          </select>
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          <span className="text-muted-foreground">开始日期</span>
          <Input
            aria-label="开始日期"
            type="date"
            value={view.since}
            onChange={(event) => onChange({ since: event.target.value, page: null })}
          />
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          <span className="text-muted-foreground">结束日期</span>
          <Input
            aria-label="结束日期"
            type="date"
            value={view.until}
            onChange={(event) => onChange({ until: event.target.value, page: null })}
          />
        </label>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="min-w-0 space-y-1 text-sm">
          <span className="text-muted-foreground">对象</span>
          <Input
            aria-label="对象搜索"
            value={targetQuery}
            placeholder="标题、名称、BV 或 UID"
            onChange={(event) => {
              setTargetQuery(event.target.value);
              onChange({ q: event.target.value.trim(), page: null });
            }}
          />
          {targetOptions.length > 0 ? (
            <ul className="max-h-40 overflow-auto rounded-md border" aria-label="对象候选">
              {targetOptions.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setTargetQuery('');
                      setTargetOptions([]);
                      onChange({
                        targetId: option.id,
                        targetType: option.type,
                        externalId: option.externalId,
                        q: null,
                        page: null,
                      });
                    }}
                  >
                    {option.displayName} · {option.externalId}
                    {option.deleted ? ' · 已移除' : ''}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="min-w-0 space-y-1 text-sm">
          <span className="text-muted-foreground">商单</span>
          <Input
            aria-label="商单搜索"
            value={projectQuery}
            placeholder="商单名称"
            onChange={(event) => setProjectQuery(event.target.value)}
          />
          {view.projectId ? (
            <p className="text-xs text-muted-foreground">已关联商单 {view.projectId}</p>
          ) : null}
          {projectOptions.length > 0 ? (
            <ul className="max-h-40 overflow-auto rounded-md border" aria-label="商单候选">
              {projectOptions.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    className="block w-full truncate px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setProjectQuery(option.name);
                      setProjectOptions([]);
                      onChange({ projectId: option.id, page: null });
                    }}
                  >
                    {option.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={view.group === 'time' ? 'default' : 'outline'}
          onClick={() => onChange({ group: null, page: null })}
        >
          按时间
        </Button>
        <Button
          type="button"
          size="sm"
          variant={view.group === 'target' ? 'default' : 'outline'}
          onClick={() => onChange({ group: 'target', page: null })}
        >
          按监控对象分组
        </Button>
      </div>
      {list ? (
        <p className="text-xs text-muted-foreground" data-testid="ops-range">
          {list.range.defaulted ? '默认时间范围' : '时间范围'}：{list.range.since} 至{' '}
          {list.range.until}（{list.range.timezone}）。日志保留 {list.logRetention.days} 天
          {list.logRetention.oldestStoredAt
            ? `，最早入库 ${formatShanghaiDateTime(list.logRetention.oldestStoredAt)}`
            : '，当前没有入库日志'}
          。任务和运行记录与日志不是同一份数据。
        </p>
      ) : null}
      {loading ? (
        <div data-testid="ops-jobs-loading">
          <LoadingListSkeleton rows={3} />
        </div>
      ) : null}
      {error ? (
        <div data-testid="ops-jobs-error">
          <ErrorState title="采集记录加载失败" message={safeText(error)} />
        </div>
      ) : null}
      {!loading && !error && list && list.total === 0 ? (
        <div data-testid="ops-jobs-empty">
          <EmptyState
            title="这个范围内没有采集记录"
            description="排队中、尚未执行的任务也会出现在这里。当前筛选没有匹配到任务。"
          />
        </div>
      ) : null}
      {!loading && !error && list && list.mode === 'time' && list.items.length > 0 ? (
        <div data-testid="ops-ready" className="min-w-0">
          <div data-testid="ops-hscroll" className="max-w-full overflow-x-auto">
            <ul className="grid min-w-0 gap-2">
              {list.items.map((job) => (
                <JobRow key={job.id} job={job} onOpen={openJob} />
              ))}
            </ul>
          </div>
          <Pager
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPage={(page) => onChange({ page })}
          />
        </div>
      ) : null}
      {!loading && !error && list && list.mode === 'target' && list.items.length > 0 ? (
        <div className="min-w-0 space-y-4" data-testid="ops-groups">
          {list.items.map((group) => (
            <section key={group.targetId} className="min-w-0 space-y-2" data-testid="ops-group">
              <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                <h3 className="min-w-0 truncate text-sm font-medium" title={group.displayName}>
                  {safeText(group.displayName)} · {group.externalId}
                </h3>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    onChange({
                      targetId: group.targetId,
                      targetType: group.targetType,
                      externalId: group.externalId,
                      group: null,
                      page: null,
                    })
                  }
                >
                  查看该对象全部匹配记录
                </Button>
              </div>
              {group.truncated ? (
                <p className="text-xs text-muted-foreground">
                  本组只列出最近 {group.jobs.length} 条，匹配共 {group.matchCount}{' '}
                  条。这不是该对象的完整历史。
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">匹配 {group.matchCount} 条。</p>
              )}
              <ul className="grid min-w-0 gap-2">
                {group.jobs.map((job) => (
                  <JobRow key={job.id} job={job} onOpen={openJob} />
                ))}
              </ul>
            </section>
          ))}
          <Pager
            page={list.page}
            pageSize={list.pageSize}
            total={list.total}
            onPage={(page) => onChange({ page })}
          />
        </div>
      ) : null}
      <JobDrawer
        jobId={view.job}
        attemptPage={view.attemptPage}
        reloadKey={reloadKey}
        onAttemptPage={(page) => onChange({ attemptPage: page })}
        onClose={() => onChange({ job: null, attemptPage: null })}
      />
    </div>
  );
}

function Pager({
  page,
  pageSize,
  total,
  onPage,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
      <span data-testid="ops-page-status">
        第 {page} 页，共 {total} 条
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        上一页
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        下一页
      </Button>
    </div>
  );
}

function JobDrawer({
  jobId,
  attemptPage,
  reloadKey,
  onAttemptPage,
  onClose,
}: {
  jobId: string;
  attemptPage: number;
  reloadKey: number;
  onAttemptPage: (page: number) => void;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<OpsCollectorJobDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copyState, setCopyState] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setDetail(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchOpsCollectorJob(jobId, { attemptPage, attemptPageSize: 10 }, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setDetail(next);
          setLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '加载失败');
        setLoading(false);
      });
    return () => controller.abort();
  }, [jobId, attemptPage, reloadKey]);

  async function copyBundle(runId: string) {
    const bundle = await fetchOpsDebugBundle(runId);
    const text = JSON.stringify(bundle, null, 2);
    if (typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ops-bundle-${runId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板不可用时仍然提供下载文件。
    }
    setCopyState('已复制排障包');
  }

  const attemptPages = detail
    ? Math.max(1, Math.ceil(detail.attemptTotal / detail.attemptPageSize))
    : 1;

  return (
    <Sheet open={jobId.length > 0} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-[min(40rem,100vw)] max-w-full overflow-y-auto bg-background text-foreground"
      >
        <div className="min-w-0 space-y-4 p-4 pr-10" data-testid="ops-job-drawer">
          <h2 className="text-lg font-semibold">采集任务</h2>
          {loading ? <LoadingListSkeleton rows={2} /> : null}
          {error ? <ErrorState message={safeText(error)} /> : null}
          {detail ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={jobStatusVariant(detail.job.status)}>
                  {jobStatusLabel(detail.job.status)}
                </Badge>
                <span className="min-w-0 truncate text-sm" title={detail.job.displayName}>
                  {safeText(detail.job.displayName)}
                </span>
              </div>
              <p className="break-all text-sm text-muted-foreground">
                {detail.job.targetType === 'creator' ? 'UP 主' : '视频'} {detail.job.externalId}
                {detail.job.targetDeleted ? ' · 监控项已移除，历史任务仍保留' : ''}
              </p>
              <p className="text-sm">
                计划 {formatShanghaiDateTime(detail.job.scheduledFor)}
                {detail.job.startedAt
                  ? ` · 开始 ${formatShanghaiDateTime(detail.job.startedAt)}`
                  : ' · 未开始'}
                {' · '}耗时 {formatDuration(detail.job.durationMs)}
                {' · '}
                {writeLine(detail.job)}
              </p>
              <p className="text-xs text-muted-foreground">
                日志保留 {detail.logRetention.days} 天。没有关联日志不会改变运行结果。
              </p>
              <div className="space-y-3">
                <h3 className="text-sm font-medium">尝试 {detail.attemptTotal}</h3>
                {detail.attempts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">这一轮还没有执行记录。</p>
                ) : (
                  detail.attempts.map((attempt) => (
                    <article key={attempt.id} className="min-w-0 space-y-2 rounded-md border p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={attempt.status === 'succeeded' ? 'success' : 'destructive'}>
                          {attempt.status === 'succeeded' ? '成功' : '失败'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {formatShanghaiDateTime(attempt.startedAt)} ·{' '}
                          {formatDuration(attempt.durationMs)} · 写入 {attempt.samplesWritten}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void copyBundle(attempt.id)}
                        >
                          复制排障包
                        </Button>
                      </div>
                      {attempt.error ? (
                        <p className="break-all text-sm text-destructive">
                          {safeText(attempt.error)}
                        </p>
                      ) : null}
                      <div data-testid="ops-hscroll" className="max-w-full overflow-x-auto">
                        <table className="w-full min-w-[28rem] text-left text-sm">
                          <thead className="text-muted-foreground">
                            <tr className="border-b">
                              <th className="px-2 py-2 font-medium">请求</th>
                              <th className="px-2 py-2 font-medium">状态</th>
                              <th className="px-2 py-2 font-medium">耗时</th>
                              <th className="px-2 py-2 font-medium">结果</th>
                            </tr>
                          </thead>
                          <tbody>
                            {attempt.requests.map((request) => (
                              <tr key={request.id} className="border-b">
                                <td className="px-2 py-2 break-all">
                                  {safeText(request.endpoint)}
                                </td>
                                <td className="px-2 py-2">{request.statusCode ?? '—'}</td>
                                <td className="px-2 py-2 whitespace-nowrap">
                                  {formatDuration(request.durationMs)}
                                </td>
                                <td className="px-2 py-2 break-all">
                                  {request.bizCode ?? '—'} {safeText(request.error)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {attempt.requests.length === 0 ? (
                        <p className="text-sm text-muted-foreground">这次尝试没有请求审计。</p>
                      ) : null}
                      {attempt.requestsTruncated ? (
                        <p className="text-xs text-muted-foreground">请求只显示最近 20 条。</p>
                      ) : null}
                      {attempt.logNote ? (
                        <p className="text-sm text-muted-foreground">{attempt.logNote}</p>
                      ) : (
                        <ul className="space-y-2">
                          {attempt.logs.map((entry) => (
                            <li
                              key={entry.id}
                              className="break-all rounded-md border px-3 py-2 text-sm"
                            >
                              <span className="text-muted-foreground">{entry.level}</span>{' '}
                              {safeText(entry.message)}
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs text-muted-foreground">
                                  技术字段
                                </summary>
                                <pre className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                                  {safeContext(entry.context)}
                                </pre>
                              </details>
                            </li>
                          ))}
                        </ul>
                      )}
                      {attempt.logsTruncated ? (
                        <p className="text-xs text-muted-foreground">关联日志只显示最近 20 条。</p>
                      ) : null}
                    </article>
                  ))
                )}
                {detail.attemptTotal > detail.attemptPageSize ? (
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={attemptPage <= 1}
                      onClick={() => onAttemptPage(attemptPage - 1)}
                    >
                      上一批尝试
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={attemptPage >= attemptPages}
                      onClick={() => onAttemptPage(attemptPage + 1)}
                    >
                      下一批尝试
                    </Button>
                  </div>
                ) : null}
              </div>
              {copyState ? <p className="text-sm text-muted-foreground">{copyState}</p> : null}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
