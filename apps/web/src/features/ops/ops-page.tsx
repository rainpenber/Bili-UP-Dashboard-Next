import type { OpsHealth, OpsSummary } from '@studio/contracts';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/page-header';
import { ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { fetchOpsHealth, fetchOpsSummary } from './ops-client';
import { safeText } from './ops-format';
import { OpsJobsPanel } from './ops-jobs';
import { OpsLogsPanel } from './ops-logs';
import { OpsOperationsPanel } from './ops-operations';
import { patchOpsView, readOpsView, type OpsView } from './ops-state';

type Tone = 'green' | 'yellow' | 'red';

function heartbeatTone(health: OpsHealth, summary: OpsSummary): Tone {
  const newest = summary.heartbeats[0];
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

const TABS = [
  { id: 'jobs', label: '采集记录' },
  { id: 'operations', label: '操作记录' },
  { id: 'logs', label: '系统日志' },
] as const;

export function OpsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = readOpsView(searchParams);
  const [summary, setSummary] = useState<OpsSummary | null>(null);
  const [health, setHealth] = useState<OpsHealth | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  function onChange(patch: Partial<Record<keyof OpsView, string | number | boolean | null>>) {
    setSearchParams((current) => patchOpsView(current, patch), { replace: true });
  }

  useEffect(() => {
    const controller = new AbortController();
    setSummaryLoading(true);
    setSummaryError(null);
    Promise.all([fetchOpsSummary(controller.signal), fetchOpsHealth(controller.signal)])
      .then(([nextSummary, nextHealth]) => {
        if (controller.signal.aborted) return;
        setSummary(nextSummary);
        setHealth(nextHealth);
        setSummaryLoading(false);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setSummaryError(reason instanceof Error ? reason.message : '加载失败');
        setSummaryLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => setReloadKey((value) => value + 1), 10_000);
    return () => clearInterval(timer);
  }, [autoRefresh]);

  const tone = health && summary ? heartbeatTone(health, summary) : 'red';

  return (
    <div data-testid="ops-page" className="min-w-0 max-w-full overflow-x-hidden">
      <PageHeader
        title="日志与诊断"
        description="只读查看采集记录、操作记录和系统日志。打开这一页不会发起采集，也不保存 Cookie。"
        crumbs={[
          { label: '工作室', to: '/' },
          { label: '设置', to: '/integrations' },
          { label: '日志与诊断' },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setReloadKey((value) => value + 1)}
        >
          刷新
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            aria-label="自动刷新"
            checked={autoRefresh}
            onChange={(event) => setAutoRefresh(event.target.checked)}
          />
          自动刷新
        </label>
      </div>
      {summaryLoading && !summary ? (
        <div data-testid="ops-loading">
          <LoadingListSkeleton rows={1} />
        </div>
      ) : null}
      {summaryError ? (
        <div data-testid="ops-summary-error" className="mb-4">
          <ErrorState title="健康摘要加载失败" message={safeText(summaryError)} />
        </div>
      ) : null}
      {summary && health ? (
        <section className="mb-4 grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <StatusCard title="采集端心跳" value={toneLabel(tone)} tone={tone} />
          <StatusCard title="队列积压" value={String(health.queueBacklog)} />
          <StatusCard title="24 小时失败" value={String(summary.queue.failed24h)} />
          <StatusCard title="活跃熔断" value={String(summary.circuits.length)} />
        </section>
      ) : null}
      <div role="tablist" aria-label="日志分类" className="mb-4 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Button
            key={tab.id}
            type="button"
            role="tab"
            size="sm"
            aria-selected={view.tab === tab.id}
            variant={view.tab === tab.id ? 'default' : 'outline'}
            onClick={() => onChange({ tab: tab.id === 'jobs' ? null : tab.id })}
          >
            {tab.label}
          </Button>
        ))}
      </div>
      {view.tab === 'jobs' ? (
        <OpsJobsPanel view={view} reloadKey={reloadKey} onChange={onChange} />
      ) : null}
      {view.tab === 'operations' ? (
        <OpsOperationsPanel view={view} reloadKey={reloadKey} onChange={onChange} />
      ) : null}
      {view.tab === 'logs' ? (
        <OpsLogsPanel view={view} reloadKey={reloadKey} onChange={onChange} />
      ) : null}
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
