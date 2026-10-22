import { Link } from 'react-router-dom';
import type { MonitorCard } from '@studio/contracts';
import { coverAssetUrl } from '@/api/monitor-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  formatVideoGridMetricsLine,
  formatVideoGridUpdateText,
} from '@/features/monitoring/video-card-metrics';
import { cn } from '@/lib/utils';

const STATE_LABEL = {
  unmonitored: '未监控',
  active: '监控中',
  paused: '已暂停',
} as const;

type PrimaryAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline';
  disabled?: boolean;
};

/**
 * 视频网格卡片：整宽 16:9 封面 + 精简信息 + 详情/主操作两键。
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
}: {
  card: MonitorCard;
  selected: boolean;
  listQuery: string;
  pending: boolean;
  notice: string | null;
  error: string | null;
  primary: PrimaryAction | null;
  onSelect?: (() => void) | undefined;
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
      data-pending={pending ? 'true' : 'false'}
      aria-busy={pending}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 flex-col gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-pressed={selected}
        aria-label={`选择视频 ${card.displayName}`}
      >
        <img
          src={coverAssetUrl(card.imageAssetId)}
          alt=""
          className="aspect-[16/9] w-full rounded-md object-cover"
          data-testid="video-grid-cover"
        />
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="relative inline-flex shrink-0">
            <Badge
              variant={
                card.monitorState === 'active'
                  ? 'success'
                  : card.monitorState === 'paused'
                    ? 'warning'
                    : 'secondary'
              }
              className="px-1.5 py-0 text-[10px] leading-4"
              data-testid="video-grid-state-badge"
            >
              {STATE_LABEL[card.monitorState]}
            </Badge>
            {failed ? (
              <span
                className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-destructive"
                data-testid="video-grid-failure-dot"
                aria-label="最近采集失败"
              />
            ) : null}
          </span>
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
        className="mt-auto flex items-center justify-end gap-2"
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
