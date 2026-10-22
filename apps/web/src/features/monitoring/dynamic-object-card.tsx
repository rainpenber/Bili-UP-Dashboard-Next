import type { DynamicListItem } from '@studio/contracts';
import { formatCount } from '@/api/monitor-client';
import { DynamicMonitorControls } from '@/features/monitoring/dynamic-monitor-controls';
import { MonitorStateBadge } from '@/features/monitoring/monitor-state-badge';
import { formatUnknownMetric } from '@/lib/format-compact-number';
import { formatShortTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';

function monitorStateFromItem(item: DynamicListItem): 'unmonitored' | 'active' | 'paused' {
  if (!item.target) return 'unmonitored';
  return item.target.enabled ? 'active' : 'paused';
}

function hasSampleMetrics(item: DynamicListItem): boolean {
  const m = item.latestMetrics;
  return Boolean(m.sampledAt || m.likeCount || m.commentCount || m.repostCount);
}

/** 列表用完整摘要（含时间）；网格核心互动行，时间留给 title 悬停 */
function dynamicSummary(item: DynamicListItem, mode: 'full' | 'core'): string {
  if (!hasSampleMetrics(item)) return '尚无采集数据';
  const m = item.latestMetrics;
  const core = `赞 ${formatCount(m.likeCount)} · 评 ${formatUnknownMetric(m.commentCount)} · 转 ${formatUnknownMetric(m.repostCount)}`;
  if (mode === 'core' || !m.sampledAt) return core;
  return `${core} · ${formatShortTime(m.sampledAt)}`;
}

/**
 * 动态列表/网格卡片：无封面；不伪造图片。
 * 列表：信息与两键同行（可 wrap）。网格：id 与核心摘要整行可读，两键单独一行右侧。
 */
export function DynamicObjectCard({
  item,
  selected,
  listQuery,
  presentation,
  onSelect,
}: {
  item: DynamicListItem;
  selected: boolean;
  listQuery: string;
  presentation: 'list' | 'grid';
  onSelect: () => void;
}) {
  const monitorState = monitorStateFromItem(item);
  const failed = Boolean(item.target?.lastError?.trim());
  const fullSummary = dynamicSummary(item, 'full');
  const coreSummary = dynamicSummary(item, 'core');
  const summary = presentation === 'grid' ? coreSummary : fullSummary;

  if (presentation === 'grid') {
    return (
      <li
        className="h-full min-w-0 max-w-full"
        data-testid="dynamic-list-item"
        data-presentation="grid"
        data-monitor-state={monitorState}
        data-external-id={item.dynamicId}
      >
        <div
          className={cn(
            'flex h-full min-w-0 max-w-full flex-col gap-2 rounded-lg border p-3',
            selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
          )}
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <button
              type="button"
              onClick={onSelect}
              className="flex min-w-0 flex-col gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-pressed={selected}
              aria-label={`选择动态 ${item.dynamicId}`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <MonitorStateBadge
                  state={monitorState}
                  failed={failed}
                  badgeClassName="px-1.5 py-0 text-[10px] leading-4"
                  testId="dynamic-card-state-badge"
                  failureTestId="dynamic-card-failure-dot"
                />
                <span
                  className="min-w-0 flex-1 truncate text-sm font-medium"
                  title={item.dynamicId}
                  data-testid="dynamic-card-title"
                >
                  {item.dynamicId}
                </span>
              </span>
              <span
                className="block truncate text-xs tabular-nums text-muted-foreground"
                data-testid="dynamic-card-metrics"
                title={fullSummary}
              >
                {summary}
              </span>
            </button>
            <DynamicMonitorControls
              dynamicId={item.dynamicId}
              target={item.target}
              listQuery={listQuery}
              layout="card"
            />
          </div>
        </div>
      </li>
    );
  }

  return (
    <li
      className="min-w-0 max-w-full"
      data-testid="dynamic-list-item"
      data-presentation="list"
      data-monitor-state={monitorState}
      data-external-id={item.dynamicId}
    >
      <div
        className={cn(
          'flex h-full min-w-0 max-w-full flex-col gap-2 rounded-lg border p-3',
          selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-2">
          <button
            type="button"
            onClick={onSelect}
            className="flex min-w-0 flex-1 basis-[10rem] flex-col gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-pressed={selected}
            aria-label={`选择动态 ${item.dynamicId}`}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <MonitorStateBadge
                state={monitorState}
                failed={failed}
                badgeClassName="px-1.5 py-0 text-[10px] leading-4"
                testId="dynamic-card-state-badge"
                failureTestId="dynamic-card-failure-dot"
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium" title={item.dynamicId}>
                {item.dynamicId}
              </span>
            </span>
            <span
              className="block truncate text-xs tabular-nums text-muted-foreground"
              data-testid="dynamic-card-metrics"
              title={fullSummary}
            >
              {summary}
            </span>
          </button>
          <DynamicMonitorControls
            dynamicId={item.dynamicId}
            target={item.target}
            listQuery={listQuery}
            layout="card"
          />
        </div>
      </div>
    </li>
  );
}
