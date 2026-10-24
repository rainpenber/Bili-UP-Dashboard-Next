import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATE_LABEL = {
  unmonitored: '未监控',
  active: '监控中',
  paused: '已暂停',
} as const;

export type MonitorPresenceState = keyof typeof STATE_LABEL;

export function monitorStateLabel(state: MonitorPresenceState): string {
  return STATE_LABEL[state];
}

/** 监控状态徽标；失败时加红点与 aria-label，不另起失败文案行。 */
export function MonitorStateBadge({
  state,
  failed = false,
  className,
  badgeClassName,
  testId,
  failureTestId = 'monitor-failure-dot',
}: {
  state: MonitorPresenceState;
  failed?: boolean;
  className?: string;
  badgeClassName?: string;
  testId?: string;
  failureTestId?: string;
}) {
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Badge
        variant={state === 'active' ? 'success' : state === 'paused' ? 'warning' : 'secondary'}
        className={badgeClassName}
        data-testid={testId}
      >
        {STATE_LABEL[state]}
      </Badge>
      {failed ? (
        <span
          className="absolute -right-1 -top-1 size-2 rounded-full border border-background bg-destructive"
          data-testid={failureTestId}
          aria-label="最近采集失败"
        />
      ) : null}
    </span>
  );
}
