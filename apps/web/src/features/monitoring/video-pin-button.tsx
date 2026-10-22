import { useEffect, useState } from 'react';
import { Pin } from 'lucide-react';
import { usePinVideoMutation } from '@/api/hooks/use-monitor-card-queries';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Cover-corner pin control for video cards. Flips the icon while the request is
 * in flight; on failure rolls back and surfaces a readable error. Does not
 * treat the flip as success until the list refetch confirms it.
 */
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
  const mutation = usePinVideoMutation();
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
      data-testid="video-pin-button"
      data-pinned={shown ? 'true' : 'false'}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const next = !shown;
        setPendingPinned(next);
        mutation.mutate(
          { bvid, pinned: next },
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
