import { useNavigate } from 'react-router-dom';
import type { MonitorCard } from '@studio/contracts';
import { coverAssetUrl } from '@/api/monitor-client';
import { Button } from '@/components/ui/button';
import {
  handleCardActivateKey,
  stopCardActivatePropagation,
} from '@/features/monitoring/card-activate';
import { MonitorStateBadge } from '@/features/monitoring/monitor-state-badge';
import { MonitorPinButton } from '@/features/monitoring/monitor-pin-button';
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
 * 视频网格卡片：整卡进入详情页；无冗余「详情」按钮。
 * 封面右上角置顶；主操作 stopPropagation。
 */
export function VideoGridCard({
  card,
  selected,
  listQuery,
  pending,
  notice,
  error,
  primary,
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
  const navigate = useNavigate();
  const failed = card.execution === 'failed';
  const detailHref = `/monitoring/videos/${encodeURIComponent(card.externalId)}?from=${encodeURIComponent(listQuery)}`;
  const category = card.category?.trim() || '未分类';
  const updateText = formatVideoGridUpdateText(card.latest.sampledAt);
  const metricsLine = card.hasSamples ? formatVideoGridMetricsLine(card.latest) : '尚无采集数据';
  const metaFull = `分类：${category} · 更新：${updateText}`;
  const openDetail = () => navigate(detailHref);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开视频 ${card.displayName}`}
      onClick={openDetail}
      onKeyDown={(event) => handleCardActivateKey(event, openDetail)}
      className={cn(
        'flex h-full min-w-0 max-w-full cursor-pointer flex-col gap-2 rounded-lg border p-3',
        'transition-colors hover:border-primary/30 hover:bg-accent/20',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
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
        <img
          src={coverAssetUrl(card.imageAssetId)}
          alt=""
          className="aspect-[16/9] w-full rounded-md object-cover"
          data-testid="video-grid-cover"
        />
        <MonitorPinButton
          kind="video"
          id={card.externalId}
          pinned={card.pinned}
          onError={onPinError}
          className="absolute right-1.5 top-1.5 z-10"
          testId="video-pin-button"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-col gap-1 text-left">
          <span className="flex min-w-0 items-center gap-1.5">
            <MonitorStateBadge
              state={card.monitorState}
              failed={failed}
              badgeClassName="px-1.5 py-0 text-[10px] leading-4"
              testId="video-grid-state-badge"
              failureTestId="video-grid-failure-dot"
            />
            <span
              className="min-w-0 flex-1 truncate text-sm font-medium"
              title={card.displayName}
              data-testid="video-grid-title"
            >
              {card.displayName}
            </span>
          </span>
          <span
            className="block truncate text-xs tabular-nums text-muted-foreground"
            data-testid="video-grid-metrics"
            title={metricsLine}
          >
            {metricsLine}
          </span>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate text-left text-xs text-muted-foreground"
            data-testid="video-grid-meta"
            title={metaFull}
          >
            分类：{category}
            <span className="mx-1 text-border">·</span>
            更新：{updateText}
          </span>
          <div
            data-testid="monitor-card-actions"
            className="flex shrink-0 items-center justify-end gap-1.5"
            onClick={stopCardActivatePropagation}
            onKeyDown={stopCardActivatePropagation}
          >
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
