import { useEffect, useState } from 'react';
import { Pin } from 'lucide-react';
import {
  usePinCreatorMutation,
  usePinDynamicMutation,
  usePinVideoMutation,
} from '@/api/hooks/use-monitor-card-queries';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type PinKind = 'video' | 'creator' | 'dynamic';

/**
 * Cover-corner pin control. Flips the icon while the request is in flight; on
 * failure rolls back and surfaces a readable error. stopPropagation so card
 * click/select/navigate does not fire.
 */
export function MonitorPinButton({
  kind,
  id,
  pinned,
  onError,
  className,
  testId = 'monitor-pin-button',
}: {
  kind: PinKind;
  id: string;
  pinned: boolean;
  onError: (message: string) => void;
  className?: string;
  /** Stable test id; video cards also accept legacy video-pin-button via alias. */
  testId?: string;
}) {
  const videoMutation = usePinVideoMutation();
  const creatorMutation = usePinCreatorMutation();
  const dynamicMutation = usePinDynamicMutation();
  const mutation =
    kind === 'video' ? videoMutation : kind === 'creator' ? creatorMutation : dynamicMutation;
  const [pendingPinned, setPendingPinned] = useState<boolean | null>(null);
  const shown = pendingPinned ?? pinned;

  useEffect(() => {
    setPendingPinned(null);
  }, [pinned]);

  return (
    <Button
      type="button"
      size="icon"
      variant="secondary"
      className={cn(
        'size-7 rounded-md border border-border/80 bg-background/90 shadow-sm backdrop-blur-sm',
        'hover:bg-background',
        className,
      )}
      aria-label={shown ? '取消置顶' : '置顶'}
      aria-pressed={shown}
      disabled={mutation.isPending}
      data-testid={testId}
      data-pinned={shown ? 'true' : 'false'}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = !shown;
        setPendingPinned(next);
        mutation.mutate(
          { id, pinned: next },
          {
            onError: (error) => {
              setPendingPinned(null);
              onError(error instanceof Error ? error.message : '置顶失败');
            },
          },
        );
      }}
    >
      <Pin
        className={cn('size-3.5', shown && 'fill-current')}
        aria-hidden
        data-testid={shown ? 'video-pin-icon-filled' : 'video-pin-icon-outline'}
      />
    </Button>
  );
}

/** @deprecated Prefer MonitorPinButton; kept so existing video imports keep working. */
export function VideoPinButton({
  bvid,
  pinned,
  onError,
  className,
}: {
  bvid: string;
  pinned: boolean;
  onError: (message: string) => void;
  className?: string;
}) {
  return (
    <MonitorPinButton
      kind="video"
      id={bvid}
      pinned={pinned}
      onError={onError}
      className={className}
      testId="video-pin-button"
    />
  );
}
