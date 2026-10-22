import { Link } from 'react-router-dom';
import type { MonitorCard } from '@studio/contracts';
import { coverAssetUrl } from '@/api/monitor-client';
import { Button } from '@/components/ui/button';
import { MonitorStateBadge } from '@/features/monitoring/monitor-state-badge';
import { VideoPinButton } from '@/features/monitoring/video-pin-button';
import {
  formatVideoGridMetricsLine,
  formatVideoGridUpdateText,
} from '@/features/monitoring/video-card-metrics';
import { cn } from '@/lib/utils';

type PrimaryAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline';
  disabled?: boolean;
};

/**
 * 视频网格卡片：整宽 16:9 封面 + 信息与两键同一横行（垂直居中）。
 * 列表（分栏）与 UP 主卡片不走这里。
 */
export function VideoGridCard({
  card,
  selected,
  listQuery,
  pending,
  notice,
  error,
  primary,
  onSelect,
  onPinError,
}: {
  card: MonitorCard;
  selected: boolean;
  listQuery: string;
  pending: boolean;
  notice: string | null;
  error: string | null;
  primary: PrimaryAction | null;
  onSelect?: (() => void) | undefined;
  onPinError: (message: string) => void;
}) {
  const failed = card.execution === 'failed';
  const detailHref = `/monitoring/videos/${encodeURIComponent(card.externalId)}?from=${encodeURIComponent(listQuery)}`;
  const category = card.category?.trim() || '未分类';
  const updateText = formatVideoGridUpdateText(card.latest.sampledAt);
  const metricsLine = card.hasSamples ? formatVideoGridMetricsLine(card.latest) : '尚无采集数据';

  return (
    <div
      className={cn(
        'flex h-full min-w-0 max-w-full flex-col gap-2 rounded-lg border p-3',
        selected && 'border-primary/40 bg-accent/40 ring-1 ring-primary/20',
      )}
      data-testid="monitor-card-controls"
      data-presentation="grid"
      data-monitor-state={card.monitorState}
      data-execution={card.execution}
      data-external-id={card.externalId}
      data-target-id={card.target?.id ?? ''}
      data-pinned={card.pinned ? 'true' : 'false'}
      data-pending={pending ? 'true' : 'false'}
      aria-busy={pending}
    >
      <div className="relative min-w-0">
        <button
          type="button"
          onClick={onSelect}
          className="block w-full rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-pressed={selected}
          aria-label={`选择视频 ${card.displayName}`}
        >
          <img
            src={coverAssetUrl(card.imageAssetId)}
            alt=""
            className="aspect-[16/9] w-full rounded-md object-cover"
            data-testid="video-grid-cover"
          />
        </button>
        <VideoPinButton
          bvid={card.externalId}
          pinned={card.pinned}
          onError={onPinError}
          className="absolute right-1.5 top-1.5 z-10"
        />
      </div>

      {/* 四列网格卡片窄（~240px）：不 wrap，信息块 min-w-0 收缩；手机单列足够宽 */}
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-1 flex-col gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-pressed={selected}
          aria-label={`选择视频 ${card.displayName} 详情区`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <MonitorStateBadge
              state={card.monitorState}
              failed={failed}
              badgeClassName="px-1.5 py-0 text-[10px] leading-4"
              testId="video-grid-state-badge"
              failureTestId="video-grid-failure-dot"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium" title={card.displayName}>
              {card.displayName}
            </span>
          </span>
          <span
            className="block truncate text-xs tabular-nums text-muted-foreground"
            data-testid="video-grid-metrics"
          >
            {metricsLine}
          </span>
          <span
            className="block truncate text-xs text-muted-foreground"
            data-testid="video-grid-meta"
            title={`分类：${category} 更新：${updateText}`}
          >
            分类：{category}
            <span className="mx-1 text-border">·</span>
            更新：{updateText}
          </span>
        </button>

        <div
          data-testid="monitor-card-actions"
          className="flex shrink-0 items-center justify-end gap-1.5"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Button type="button" size="sm" variant="outline" asChild>
            <Link to={detailHref} aria-label={`查看 ${card.displayName} 详情`}>
              详情
            </Link>
          </Button>
          {primary ? (
            <Button
              type="button"
              size="sm"
              variant={primary.variant ?? 'default'}
              disabled={primary.disabled ?? pending}
              aria-label={primary.label}
              onClick={primary.onClick}
            >
              {primary.label}
            </Button>
          ) : null}
        </div>
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
    </div>
  );
}
