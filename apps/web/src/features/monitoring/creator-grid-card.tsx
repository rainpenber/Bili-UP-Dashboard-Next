import { useNavigate } from 'react-router-dom';
import type { MonitorCard } from '@studio/contracts';
import { coverAssetUrl, formatCount } from '@/api/monitor-client';
import { Button } from '@/components/ui/button';
import {
  handleCardActivateKey,
  stopCardActivatePropagation,
} from '@/features/monitoring/card-activate';
import { MonitorPinButton } from '@/features/monitoring/monitor-pin-button';
import { MonitorStateBadge } from '@/features/monitoring/monitor-state-badge';
import { cn } from '@/lib/utils';

type PrimaryAction = {
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline';
  disabled?: boolean;
};

/**
 * UP 主网格卡片：整卡进入详情页；无冗余「详情」按钮。头像角置顶。
 */
export function CreatorGridCard({
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
  onPinError?: (message: string) => void;
}) {
  const navigate = useNavigate();
  const failed = card.execution === 'failed';
  const detailHref = `/monitoring/creators/${encodeURIComponent(card.externalId)}?from=${encodeURIComponent(listQuery)}`;
  const metricsLine = card.hasSamples
    ? `粉丝 ${formatCount(card.latest.followerCount)}`
    : '尚无采集数据';
  const openDetail = () => navigate(detailHref);
  const handlePinError = onPinError ?? (() => undefined);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开 UP 主 ${card.displayName}`}
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
      <div className="relative flex min-w-0 flex-col items-center gap-2">
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
        <MonitorPinButton
          kind="creator"
          id={card.externalId}
          pinned={card.pinned}
          onError={handlePinError}
          className="absolute right-1.5 top-1.5 z-10"
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-col gap-1 text-left">
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
        </div>

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
