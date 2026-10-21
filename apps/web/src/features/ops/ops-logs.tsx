import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { opsDefaultRange } from '@studio/contracts';
import { fetchOpsLogs } from './ops-client';
import { formatShanghaiDateTime, safeContext, safeText } from './ops-format';
import { shanghaiDayBounds, type OpsView } from './ops-state';

type Patch = Partial<Record<keyof OpsView, string | number | boolean | null>>;

const selectClass = 'h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm';

export function OpsLogsPanel({
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
  const [list, setList] = useState<Awaited<ReturnType<typeof fetchOpsLogs>> | null>(null);
  const [cursorStack, setCursorStack] = useState<string[]>(['']);

  useEffect(() => {
    setCursorStack(view.logCursor ? ['', view.logCursor] : ['']);
  }, [
    view.level,
    view.service,
    view.logQ,
    view.runId,
    view.targetId,
    view.since,
    view.until,
    view.attention,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const range = opsDefaultRange();
    const sinceDay = view.since || range.since;
    const untilDay = view.until || range.until;
    const since = shanghaiDayBounds(sinceDay)?.since;
    const until = shanghaiDayBounds(untilDay)?.until;
    fetchOpsLogs(
      {
        level: view.level || undefined,
        service: view.service || undefined,
        q: view.logQ || undefined,
        runId: view.runId || undefined,
        targetId: view.targetId || undefined,
        since,
        until,
        attention: view.attention && !view.level,
        cursor: view.logCursor || undefined,
        limit: 50,
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
    view.level,
    view.service,
    view.logQ,
    view.runId,
    view.targetId,
    view.since,
    view.until,
    view.attention,
    view.logCursor,
    reloadKey,
  ]);

  const range = opsDefaultRange();

  return (
    <div className="min-w-0 space-y-4" data-testid="ops-logs">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="min-w-0 space-y-1 text-sm">
          <span className="text-muted-foreground">级别</span>
          <select
            aria-label="日志级别"
            className={selectClass}
            value={view.level}
            onChange={(event) => onChange({ level: event.target.value, logCursor: null })}
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
            className={selectClass}
            value={view.service}
            onChange={(event) => onChange({ service: event.target.value, logCursor: null })}
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
            value={view.logQ}
            onChange={(event) => onChange({ logQ: event.target.value, logCursor: null })}
          />
        </label>
        <label className="min-w-0 space-y-1 text-sm">
          <span className="text-muted-foreground">runId</span>
          <Input
            aria-label="日志 runId"
            value={view.runId}
            onChange={(event) => onChange({ runId: event.target.value, logCursor: null })}
          />
        </label>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          aria-label="只看告警和失败"
          checked={view.attention && !view.level}
          onChange={(event) =>
            onChange({ attention: event.target.checked ? null : '0', level: null, logCursor: null })
          }
        />
        只看告警和失败
      </label>
      <p className="text-xs text-muted-foreground" data-testid="ops-log-range">
        {view.since || view.until ? '时间范围' : '默认时间范围'}：{view.since || range.since} 至{' '}
        {view.until || range.until}（Asia/Shanghai）。成功的 HTTP
        访问不进入这个列表。技术字段默认折叠。
      </p>
      {loading ? <LoadingListSkeleton rows={2} /> : null}
      {error ? (
        <div data-testid="ops-logs-error">
          <ErrorState title="系统日志加载失败" message={safeText(error)} />
        </div>
      ) : null}
      {!loading && !error && list && list.items.length === 0 ? (
        <EmptyState
          title="没有匹配的日志"
          description="这个筛选下没有系统日志。采集任务是否存在不由这里推断。"
        />
      ) : null}
      {!loading && !error && list && list.items.length > 0 ? (
        <>
          <ul className="min-w-0 space-y-2">
            {list.items.map((entry) => (
              <li
                key={entry.id}
                className="min-w-0 rounded-md border px-3 py-2 text-sm"
                data-testid="ops-log-row"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge
                    variant={
                      entry.level === 'error' || entry.level === 'warn' ? 'destructive' : 'outline'
                    }
                  >
                    {entry.level}
                  </Badge>
                  <span className="text-muted-foreground">{entry.service}</span>
                  <span className="break-all text-muted-foreground">
                    {formatShanghaiDateTime(entry.ts)}
                  </span>
                  {entry.event ? <span className="break-all">{safeText(entry.event)}</span> : null}
                </div>
                <p className="mt-1 break-all">{safeText(entry.message)}</p>
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
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              本页 {list.items.length} 条，共 {list.total} 条
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={cursorStack.length <= 1}
              onClick={() => {
                const previous = cursorStack[cursorStack.length - 2] ?? '';
                setCursorStack((stack) => stack.slice(0, -1));
                onChange({ logCursor: previous || null });
              }}
            >
              上一页
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!list.nextCursor}
              onClick={() => {
                if (!list.nextCursor) return;
                setCursorStack((stack) => [...stack, list.nextCursor ?? '']);
                onChange({ logCursor: list.nextCursor });
              }}
            >
              下一页
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
