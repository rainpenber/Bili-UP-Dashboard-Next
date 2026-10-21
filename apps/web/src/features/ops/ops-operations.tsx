import { useEffect, useState } from 'react';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { fetchOpsOperations } from './ops-client';
import {
  actorLabel,
  formatShanghaiDateTime,
  operationLabel,
  safeText,
  sourceLabel,
} from './ops-format';
import type { OpsView } from './ops-state';

type Patch = Partial<Record<keyof OpsView, string | number | boolean | null>>;

const selectClass = 'h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 text-sm';

export function OpsOperationsPanel({
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
  const [list, setList] = useState<Awaited<ReturnType<typeof fetchOpsOperations>> | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    fetchOpsOperations(
      {
        targetId: view.targetId || undefined,
        action: view.action || undefined,
        since: view.since || undefined,
        until: view.until || undefined,
        page: view.opPage,
        pageSize: 20,
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
  }, [view.targetId, view.action, view.since, view.until, view.opPage, reloadKey]);

  return (
    <div className="min-w-0 space-y-4" data-testid="ops-operations">
      <label className="block max-w-xs space-y-1 text-sm">
        <span className="text-muted-foreground">动作</span>
        <select
          aria-label="操作动作"
          className={selectClass}
          value={view.action}
          onChange={(event) => onChange({ action: event.target.value, opPage: null })}
        >
          <option value="">全部</option>
          <option value="create">新增</option>
          <option value="pause">暂停</option>
          <option value="resume">恢复</option>
          <option value="interval">调整频率</option>
          <option value="rename">调整名称</option>
          <option value="tags">调整标签</option>
          <option value="remove">移除</option>
          <option value="run">手动采集</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        只显示已经被接受并提交的动作。幂等返回“已存在”、校验失败和被拒绝的写入不会记成完成。操作者没有单独记录时显示“未记录”。这些事件写在提交之后，不是数据库事务里的审计；日志没写上时，这里不会补一条假记录。
      </p>
      {list ? (
        <p className="text-xs text-muted-foreground">
          {list.range.defaulted ? '默认事件日期' : '事件日期'}：{list.range.since} 至{' '}
          {list.range.until}
          （Asia/Shanghai）
        </p>
      ) : null}
      {loading ? <LoadingListSkeleton rows={2} /> : null}
      {error ? (
        <div data-testid="ops-operations-error">
          <ErrorState title="操作记录加载失败" message={safeText(error)} />
        </div>
      ) : null}
      {!loading && !error && list && list.items.length === 0 ? (
        <EmptyState
          title="没有操作记录"
          description="更早的动作没有回填。只有这次之后被接受的新增、调整、移除和手动采集会出现在这里。"
        />
      ) : null}
      {!loading && !error && list && list.items.length > 0 ? (
        <>
          <ul className="grid min-w-0 gap-2">
            {list.items.map((item) => (
              <li
                key={item.id}
                className="min-w-0 rounded-lg border px-3 py-2 text-sm"
                data-testid="ops-operation-row"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant="outline">{operationLabel(item.action)}</Badge>
                  <span className="text-muted-foreground">{formatShanghaiDateTime(item.ts)}</span>
                  <span className="truncate">
                    {item.label || item.externalId || '对象身份在事件里没有快照'}
                  </span>
                  {item.externalId ? (
                    <span className="text-xs text-muted-foreground">{item.externalId}</span>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  来源 {sourceLabel(item.source)} · 操作者 {actorLabel(item.actor)}
                </p>
                {Object.keys(item.changes).length > 0 ? (
                  <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {Object.entries(item.changes).map(([key, change]) => (
                      <li key={key} className="break-all">
                        {key}：{JSON.stringify(change.before)} → {JSON.stringify(change.after)}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>
              第 {list.page} 页，共 {list.total} 条
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={list.page <= 1}
              onClick={() => onChange({ opPage: list.page - 1 })}
            >
              上一页
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={list.page * list.pageSize >= list.total}
              onClick={() => onChange({ opPage: list.page + 1 })}
            >
              下一页
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
