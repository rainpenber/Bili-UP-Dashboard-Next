import { scrubString, scrubValue } from '@studio/observability/redact';
import type {
  OpsHealth,
  OpsHeartbeat,
  OpsLog,
  OpsRun,
  OpsRunDetail,
  OpsSummary,
} from '@studio/contracts';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { formatFullLocalTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';
import {
  fetchOpsDebugBundle,
  fetchOpsHealth,
  fetchOpsLogs,
  fetchOpsRun,
  fetchOpsRuns,
  fetchOpsSummary,
} from './ops-client';

type Tone = 'green' | 'yellow' | 'red';

type RunFilters = {
  status: string;
  targetId: string;
  since: string;
  until: string;
};

type LogFilters = {
  level: string;
  service: string;
  q: string;
  runId: string;
};

const emptyRuns: RunFilters = { status: '', targetId: '', since: '', until: '' };
const emptyLogs: LogFilters = { level: '', service: '', q: '', runId: '' };

function heartbeatTone(health: OpsHealth, beats: OpsHeartbeat[]): Tone {
  const newest = beats[0];
  if (health.stale || !newest || newest.status === 'stopped') return 'red';
  if (newest.status === 'starting') return 'yellow';
  return 'green';
}

function toneClass(tone: Tone): string {
  if (tone === 'green') return 'bg-success';
  if (tone === 'yellow') return 'bg-warning';
  return 'bg-destructive';
}

function toneLabel(tone: Tone): string {
  if (tone === 'green') return '正常';
  if (tone === 'yellow') return '启动中';
  return '失联';
}

function statusVariant(status: string): 'success' | 'destructive' | 'secondary' {
  if (status === 'succeeded') return 'success';
  if (status === 'failed') return 'destructive';
  return 'secondary';
}

function statusLabel(status: string): string {
  if (status === 'succeeded') return '成功';
  if (status === 'failed') return '失败';
  return status;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

function safeText(value: string | null | undefined): string {
  if (!value) return '—';
  return scrubString(value);
}

function safeContext(value: unknown): string {
  try {
    return scrubString(JSON.stringify(scrubValue(value)));
  } catch {
    return '{}';
  }
}

function localInputToIso(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function initialRunFilters(params: URLSearchParams): RunFilters {
  return {
    ...emptyRuns,
    targetId: params.get('targetId')?.trim() ?? '',
  };
}

export function OpsPage() {
  const [searchParams] = useSearchParams();
  const presetType = searchParams.get('targetType');
  const presetExternalId = searchParams.get('externalId');
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [health, setHealth] = useState<OpsHealth | null>(null);
  const [runs, setRuns] = useState<OpsRun[] | null>(null);
  const [logs, setLogs] = useState<OpsLog[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [runFilters, setRunFilters] = useState<RunFilters>(() => initialRunFilters(searchParams));
  const [logFilters, setLogFilters] = useState<LogFilters>(emptyLogs);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OpsRunDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [copyState, setCopyState] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const runQuery: { status?: string; targetId?: string; since?: string; until?: string } = {};
    if (runFilters.status) runQuery.status = runFilters.status;
    if (runFilters.targetId) runQuery.targetId = runFilters.targetId;
    const since = localInputToIso(runFilters.since);
    const until = localInputToIso(runFilters.until);
    if (since) runQuery.since = since;
    if (until) runQuery.until = until;
    const logQuery: { level?: string; service?: string; q?: string; runId?: string } = {};
    if (logFilters.level) logQuery.level = logFilters.level;
    if (logFilters.service) logQuery.service = logFilters.service;
    if (logFilters.q) logQuery.q = logFilters.q;
    if (logFilters.runId) logQuery.runId = logFilters.runId;
    Promise.all([
      fetchOpsSummary(controller.signal),
      fetchOpsHealth(controller.signal),
      fetchOpsRuns(runQuery, controller.signal),
      fetchOpsLogs(logQuery, controller.signal),
    ])
      .then(([nextSummary, nextHealth, nextRuns, nextLogs]) => {
        if (controller.signal.aborted) return;
        setSummary(nextSummary);
        setHealth(nextHealth);
        setRuns(nextRuns.items);
        setLogs(nextLogs.items);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(reason instanceof Error ? reason.message : '加载失败');
        setLoading(false);
      });
    return () => controller.abort();
  }, [runFilters, logFilters, reloadKey]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => setReloadKey((value) => value + 1), 10_000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      setDetailError(null);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    setCopyState(null);
    fetchOpsRun(selectedId, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setDetail(next);
          setDetailLoading(false);
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setDetailError(reason instanceof Error ? reason.message : '加载失败');
        setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);

  async function copyBundle() {
    if (!selectedId) return;
    const bundle = await fetchOpsDebugBundle(selectedId);
    const text = JSON.stringify(bundle, null, 2);
    if (typeof URL.createObjectURL === 'function') {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `ops-bundle-${selectedId}.json`;
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

  const tone = health && summary ? heartbeatTone(health, summary.heartbeats) : 'red';

  return (
    <div data-testid="ops-page" className="min-w-0 max-w-full overflow-x-hidden">
      <PageHeader
        title="运维诊断"
        description="只读查看采集心跳、运行记录和日志。这里不保存 Cookie，也不发起站外请求。"
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '设置', to: '/integrations' },
          { label: '运维诊断' },
        ]}
      />

      {loading && !summary ? (
        <div data-testid="ops-loading">
          <LoadingListSkeleton rows={3} />
        </div>
      ) : null}

      {error ? (
        <div data-testid="ops-error">
          <ErrorState
            message={safeText(error)}
            onRetry={() => setReloadKey((value) => value + 1)}
          />
        </div>
      ) : null}

      {!error && summary && health && runs && logs ? (
        <div className="min-w-0 space-y-6">
          <section className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
            <StatusCard title="采集端心跳" value={toneLabel(tone)} tone={tone} />
            <StatusCard title="队列积压" value={String(health.queueBacklog)} />
            <StatusCard title="24 小时失败" value={String(summary.queue.failed24h)} />
            <StatusCard title="活跃熔断" value={String(summary.circuits.length)} />
          </section>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>运行记录</CardTitle>
            </CardHeader>
            <CardContent className="min-w-0 space-y-4">
              {runFilters.targetId ? (
                <p
                  className="break-all text-sm text-muted-foreground"
                  data-testid="ops-target-filter"
                >
                  已按目标筛选
                  {presetType === 'video' ? '视频' : presetType === 'creator' ? ' UP 主' : ''}
                  {presetExternalId ? ` ${presetExternalId}` : ''} · {runFilters.targetId}
                </p>
              ) : null}
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="min-w-0 space-y-1 text-sm">
                  <span className="text-muted-foreground">状态</span>
                  <select
                    aria-label="运行状态"
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                    value={runFilters.status}
                    onChange={(event) =>
                      setRunFilters((current) => ({ ...current, status: event.target.value }))
                    }
                  >
                    <option value="">全部</option>
                    <option value="succeeded">成功</option>
                    <option value="failed">失败</option>
                  </select>
                </label>
                <label className="min-w-0 space-y-1 text-sm">
                  <span className="text-muted-foreground">目标</span>
                  <Input
                    aria-label="目标编号"
                    value={runFilters.targetId}
                    placeholder="目标 UUID"
                    onChange={(event) =>
                      setRunFilters((current) => ({ ...current, targetId: event.target.value }))
                    }
                  />
                </label>
                <label className="min-w-0 space-y-1 text-sm">
                  <span className="text-muted-foreground">开始于</span>
                  <Input
                    aria-label="开始时间"
                    type="datetime-local"
                    value={runFilters.since}
                    onChange={(event) =>
                      setRunFilters((current) => ({ ...current, since: event.target.value }))
                    }
                  />
                </label>
                <label className="min-w-0 space-y-1 text-sm">
                  <span className="text-muted-foreground">结束于</span>
                  <Input
                    aria-label="结束时间"
                    type="datetime-local"
                    value={runFilters.until}
                    onChange={(event) =>
                      setRunFilters((current) => ({ ...current, until: event.target.value }))
                    }
                  />
                </label>
              </div>

              {runs.length === 0 ? (
                <div data-testid="ops-empty">
                  <EmptyState
                    title="还没有采集运行"
                    description="采集器写出运行记录后，会显示在这里。"
                  />
                </div>
              ) : (
                <div data-testid="ops-ready" className="min-w-0">
                  <div data-testid="ops-hscroll" className="max-w-full overflow-x-auto">
                    <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                      <thead className="text-muted-foreground">
                        <tr className="border-b">
                          <th className="px-2 py-2 font-medium">时间</th>
                          <th className="px-2 py-2 font-medium">目标</th>
                          <th className="px-2 py-2 font-medium">状态</th>
                          <th className="px-2 py-2 font-medium">耗时</th>
                          <th className="px-2 py-2 font-medium">写入</th>
                          <th className="px-2 py-2 font-medium">错误</th>
                        </tr>
                      </thead>
                      <tbody>
                        {runs.map((run) => (
                          <tr key={run.id} className="border-b last:border-0">
                            <td className="px-2 py-2 align-top whitespace-nowrap">
                              <button
                                type="button"
                                className="text-left underline-offset-4 hover:underline"
                                onClick={() => setSelectedId(run.id)}
                              >
                                {formatFullLocalTime(run.startedAt)}
                              </button>
                            </td>
                            <td className="max-w-[12rem] px-2 py-2 align-top">
                              <span className="block truncate">
                                {run.targetLabel || run.targetId}
                              </span>
                            </td>
                            <td className="px-2 py-2 align-top">
                              <Badge variant={statusVariant(run.status)}>
                                {statusLabel(run.status)}
                              </Badge>
                            </td>
                            <td className="px-2 py-2 align-top whitespace-nowrap">
                              {formatDuration(run.durationMs)}
                            </td>
                            <td className="px-2 py-2 align-top">{run.samplesWritten}</td>
                            <td className="max-w-[16rem] px-2 py-2 align-top break-all text-muted-foreground">
                              {safeText(run.error)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>日志</CardTitle>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={(event) => setAutoRefresh(event.target.checked)}
                />
                自动刷新
              </label>
            </CardHeader>
            <CardContent className="min-w-0 space-y-4">
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <label className="min-w-0 space-y-1 text-sm">
                  <span className="text-muted-foreground">级别</span>
                  <select
                    aria-label="日志级别"
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                    value={logFilters.level}
                    onChange={(event) =>
                      setLogFilters((current) => ({ ...current, level: event.target.value }))
                    }
                  >
                    <option value="">全部</option>
                    <option value="debug">debug</option>
                    <option value="info">info</option>
                    <option value="warn">warn</option>
                    <option value="error">error</option>
                  </select>
                </label>
                <label className="min-w-0 space-y-1 text-sm">
                  <span className="text-muted-foreground">服务</span>
                  <select
                    aria-label="日志服务"
                    className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm"
                    value={logFilters.service}
                    onChange={(event) =>
                      setLogFilters((current) => ({ ...current, service: event.target.value }))
                    }
                  >
                    <option value="">全部</option>
                    <option value="api">api</option>
                    <option value="collector">collector</option>
                  </select>
                </label>
                <label className="min-w-0 space-y-1 text-sm">
                  <span className="text-muted-foreground">关键字</span>
                  <Input
                    aria-label="日志关键字"
                    value={logFilters.q}
                    onChange={(event) =>
                      setLogFilters((current) => ({ ...current, q: event.target.value }))
                    }
                  />
                </label>
                <label className="min-w-0 space-y-1 text-sm">
                  <span className="text-muted-foreground">runId</span>
                  <Input
                    aria-label="日志 runId"
                    value={logFilters.runId}
                    onChange={(event) =>
                      setLogFilters((current) => ({ ...current, runId: event.target.value }))
                    }
                  />
                </label>
              </div>
              {logs.length === 0 ? (
                <p className="text-sm text-muted-foreground">没有匹配的日志。</p>
              ) : (
                <div data-testid="ops-hscroll" className="max-w-full overflow-x-auto">
                  <ul className="min-w-0 space-y-2">
                    {logs.slice(0, 200).map((entry) => (
                      <li key={entry.id} className="min-w-0 rounded-md border px-3 py-2 text-sm">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Badge variant="outline">{entry.level}</Badge>
                          <span className="text-muted-foreground">{entry.service}</span>
                          <span className="break-all text-muted-foreground">
                            {formatFullLocalTime(entry.ts)}
                          </span>
                          {entry.event ? (
                            <span className="break-all">{safeText(entry.event)}</span>
                          ) : null}
                        </div>
                        <p className="mt-1 break-all">{safeText(entry.message)}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Sheet open={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <SheetContent
          side="right"
          className="w-[min(40rem,100vw)] max-w-full overflow-y-auto bg-background text-foreground"
        >
          <div className="min-w-0 space-y-4 p-4 pr-10">
            <h2 className="text-lg font-semibold">运行详情</h2>
            {detailLoading ? <LoadingListSkeleton rows={2} /> : null}
            {detailError ? <ErrorState message={safeText(detailError)} /> : null}
            {detail ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={statusVariant(detail.run.status)}>
                    {statusLabel(detail.run.status)}
                  </Badge>
                  <span className="min-w-0 break-all text-sm">
                    {detail.run.targetLabel || detail.run.targetId}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void copyBundle()}
                  >
                    复制排障包
                  </Button>
                  {copyState ? (
                    <span className="text-sm text-muted-foreground">{copyState}</span>
                  ) : null}
                </div>
                <div data-testid="ops-hscroll" className="max-w-full overflow-x-auto">
                  <table className="w-full min-w-[28rem] text-left text-sm">
                    <thead className="text-muted-foreground">
                      <tr className="border-b">
                        <th className="px-2 py-2 font-medium">端点</th>
                        <th className="px-2 py-2 font-medium">耗时</th>
                        <th className="px-2 py-2 font-medium">bizCode</th>
                        <th className="px-2 py-2 font-medium">错误</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.requests.map((request) => (
                        <tr key={request.id} className="border-b">
                          <td className="px-2 py-2 break-all">{safeText(request.endpoint)}</td>
                          <td className="px-2 py-2 whitespace-nowrap">
                            {formatDuration(request.durationMs)}
                          </td>
                          <td className="px-2 py-2">{request.bizCode ?? '—'}</td>
                          <td className="px-2 py-2 break-all">{safeText(request.error)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="space-y-2">
                  <h3 className="text-sm font-medium">日志尾部</h3>
                  {detail.logs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">这次运行没有入库日志。</p>
                  ) : (
                    <ul className="space-y-2">
                      {detail.logs.map((entry) => (
                        <li
                          key={entry.id}
                          className="break-all rounded-md border px-3 py-2 text-sm"
                        >
                          <span className="text-muted-foreground">{entry.level}</span>{' '}
                          {safeText(entry.message)}
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {safeContext(entry.context)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function StatusCard({ title, value, tone }: { title: string; value: string; tone?: Tone }) {
  return (
    <Card className="min-w-0">
      <CardHeader className="border-0 pb-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center gap-2 pt-3">
        {tone ? (
          <span className={cn('size-2.5 shrink-0 rounded-full', toneClass(tone))} aria-hidden />
        ) : null}
        <span className="truncate text-2xl font-semibold tracking-tight">{value}</span>
      </CardContent>
    </Card>
  );
}
