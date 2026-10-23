import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DynamicListItem } from '@studio/contracts';
import { formatCount } from '@/api/monitor-client';
import {
  handleCardActivateKey,
  stopCardActivatePropagation,
} from '@/features/monitoring/card-activate';
import { DynamicMonitorControls } from '@/features/monitoring/dynamic-monitor-controls';
import { MonitorPinButton } from '@/features/monitoring/monitor-pin-button';
import { MonitorStateBadge } from '@/features/monitoring/monitor-state-badge';
import { formatUnknownMetric } from '@/lib/format-compact-number';
import { formatShanghaiDateTime } from '@/lib/format-time';
import { cn } from '@/lib/utils';

function monitorStateFromItem(item: DynamicListItem): 'unmonitored' | 'active' | 'paused' {
  if (!item.target) return 'unmonitored';
  return item.target.enabled ? 'active' : 'paused';
}

function hasSampleMetrics(item: DynamicListItem): boolean {
  const m = item.latestMetrics;
  return Boolean(m.sampledAt || m.likeCount || m.commentCount || m.repostCount);
}

/** 列表用完整摘要（含发布时间）；网格核心互动行 */
function dynamicSummary(item: DynamicListItem, mode: 'full' | 'core'): string {
  if (!hasSampleMetrics(item)) return '尚无采集数据';
  const m = item.latestMetrics;
  const core = `赞 ${formatCount(m.likeCount)} · 评 ${formatUnknownMetric(m.commentCount)} · 转 ${formatUnknownMetric(m.repostCount)}`;
  if (mode === 'core') return core;
  if (item.publishedAt) return `${core} · ${formatShanghaiDateTime(item.publishedAt)}`;
  if (m.sampledAt) return `${core} · ${formatShanghaiDateTime(m.sampledAt)}`;
  return core;
}

/**
 * 动态列表/网格卡片：无封面；不伪造图片。
 * 分栏：整卡选中右栏；网格：整卡进详情。无冗余「详情」按钮。
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
  const navigate = useNavigate();
  const [pinError, setPinError] = useState<string | null>(null);
  const monitorState = monitorStateFromItem(item);
  const failed = Boolean(item.target?.lastError?.trim());
  const fullSummary = dynamicSummary(item, 'full');
  const coreSummary = dynamicSummary(item, 'core');
  const summary = presentation === 'grid' ? coreSummary : fullSummary;
  const title = item.displayTitle || item.dynamicId;
  const subtitleParts = [
    item.authorName?.trim() || null,
    item.publishedAt ? formatShanghaiDateTime(item.publishedAt) : null,
  ].filter(Boolean);
  const detailHref = `/monitoring/dynamics/${encodeURIComponent(item.dynamicId)}${
    listQuery ? `?from=${encodeURIComponent(listQuery)}` : ''
  }`;
  const activate = presentation === 'grid' ? () => navigate(detailHref) : onSelect;
  const activateLabel =
    presentation === 'grid' ? `打开动态 ${title}` : `选择动态 ${title}`;

  return (
    <li
      className={cn('min-w-0 max-w-full', presentation === 'grid' && 'h-full')}
      data-testid="dynamic-list-item"
      data-presentation={presentation}
      data-monitor-state={monitorState}
      data-external-id={item.dynamicId}
      data-pinned={item.pinned ? 'true' : 'false'}
    >
      <div
        role="button"
        tabIndex={0}
        aria-pressed={presentation === 'list' ? selected : undefined}
        aria-label={activateLabel}
        onClick={activate}
        onKeyDown={(event) => handleCardActivateKey(event, activate)}
        className={cn(
          'flex h-full min-w-0 max-w-full cursor-pointer flex-col gap-2 rounded-lg border p-3',
          'transition-colors hover:border-primary/30 hover:bg-accent/20',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
        )}
      >
        <div
          className={cn(
            'relative flex min-w-0 flex-1',
            presentation === 'grid' ? 'flex-col gap-1.5' : 'flex-wrap items-center gap-x-2 gap-y-2',
          )}
        >
          <MonitorPinButton
            kind="dynamic"
            id={item.dynamicId}
            pinned={item.pinned}
            onError={(message) => setPinError(message)}
            className={cn(
              'z-10 size-6',
              presentation === 'grid' ? 'absolute right-0 top-0' : 'absolute right-0 top-0',
            )}
          />
          <div
            className={cn(
              'flex min-w-0 flex-col gap-1 text-left',
              presentation === 'list' && 'flex-1 basis-[10rem] pr-8',
              presentation === 'grid' && 'pr-8',
            )}
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
                title={title}
                data-testid="dynamic-card-title"
              >
                {title}
              </span>
            </span>
            {subtitleParts.length > 0 ? (
              <span
                className="block truncate text-xs text-muted-foreground"
                data-testid="dynamic-card-subtitle"
                title={subtitleParts.join(' · ')}
              >
                {subtitleParts.join(' · ')}
              </span>
            ) : null}
            <span
              className="block truncate text-xs tabular-nums text-muted-foreground"
              data-testid="dynamic-card-metrics"
              title={fullSummary}
            >
              {summary}
            </span>
          </div>
          <div onClick={stopCardActivatePropagation} onKeyDown={stopCardActivatePropagation}>
            <DynamicMonitorControls
              dynamicId={item.dynamicId}
              target={item.target}
              listQuery={listQuery}
              layout="card"
            />
          </div>
        </div>
        {pinError ? (
          <p role="alert" className="break-words text-xs text-destructive">
            {pinError}
          </p>
        ) : null}
      </div>
    </li>
  );
}
