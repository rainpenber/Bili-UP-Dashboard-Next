import { Link } from 'react-router-dom';
import type { MonitorCard } from '@studio/contracts';
import { coverAssetUrl, formatCount } from '@/api/monitor-client';
import { Button } from '@/components/ui/button';
import { MonitorStateBadge } from '@/features/monitoring/monitor-state-badge';
import { cn } from '@/lib/utils';

type PrimaryAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline';
  disabled?: boolean;
};

/**
 * UP 主网格卡片：大圆形头像；名称独占一行；粉丝摘要整行可读；
 * 两键落在下一行右侧（无 mt-auto 空底行）。不伪造封面。
 */
export function CreatorGridCard({
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
  const detailHref = `/monitoring/creators/${encodeURIComponent(card.externalId)}?from=${encodeURIComponent(listQuery)}`;
  const metricsLine = card.hasSamples
    ? `粉丝 ${formatCount(card.latest.followerCount)}`
    : '尚无采集数据';

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
        className="flex min-w-0 flex-col items-center gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-pressed={selected}
        aria-label={`选择 UP 主 ${card.displayName}`}
      >
        <span
          className="flex aspect-[16/9] w-full items-center justify-center"
          data-testid="creator-grid-avatar-frame"
        >
          <img
            src={coverAssetUrl(card.imageAssetId)}
            alt=""
            className="size-24 rounded-full object-cover sm:size-28"
            data-testid="creator-grid-avatar"
          />
        </span>
      </button>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <button
          type="button"
          onClick={onSelect}
          className="flex min-w-0 flex-col gap-1 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-pressed={selected}
          aria-label={`选择 UP 主 ${card.displayName} 详情区`}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <MonitorStateBadge
              state={card.monitorState}
              failed={failed}
              badgeClassName="px-1.5 py-0 text-[10px] leading-4"
              testId="creator-grid-state-badge"
              failureTestId="creator-grid-failure-dot"
            />
            <span
              className="min-w-0 flex-1 truncate text-sm font-medium"
              title={card.displayName}
              data-testid="creator-grid-title"
            >
              {card.displayName}
            </span>
          </span>
          <span
            className="block truncate text-xs tabular-nums text-muted-foreground"
            data-testid="creator-grid-metrics"
            title={metricsLine}
          >
            {metricsLine}
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
