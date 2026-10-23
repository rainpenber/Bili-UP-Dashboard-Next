import { useMemo, useState } from 'react';
import type { CreatorPublishEventKind } from '@studio/contracts';
import {
  useCreatorPublishEventsQuery,
  useManualPublishEventMutations,
} from '@/api/hooks/use-monitor-queries';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type MarkStatus = 'idle' | 'created' | 'exists' | 'removed' | 'error';

/**
 * Mark / unmark this content on the creator follower chart.
 * Requires author mid; shows inline result without navigation.
 */
export function PublishEventMarkButton({
  mid,
  eventKind,
  externalId,
  publishedAt,
  title,
  className,
}: {
  mid: string | null | undefined;
  eventKind: CreatorPublishEventKind;
  externalId: string;
  publishedAt: string | null | undefined;
  title?: string | null;
  className?: string;
}) {
  const eventsQuery = useCreatorPublishEventsQuery(mid ?? '');
  const mutations = useManualPublishEventMutations(mid ?? '');
  const [status, setStatus] = useState<MarkStatus>('idle');
  const [message, setMessage] = useState<string | null>(null);

  const matched = useMemo(() => {
    if (!mid || !eventsQuery.data) return null;
    return (
      eventsQuery.data.items.find(
        (event) => event.eventKind === eventKind && event.externalId === externalId,
      ) ?? null
    );
  }, [eventsQuery.data, eventKind, externalId, mid]);

  const marked = matched != null;
  const canMark = Boolean(mid && publishedAt);
  const pending = mutations.create.isPending || mutations.remove.isPending;

  if (!mid) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="publish-event-mark-unavailable">
        缺少作者 MID，无法在粉丝图上标记
      </p>
    );
  }

  return (
    <div
      className={cn('flex min-w-0 max-w-full flex-col gap-1', className)}
      data-testid="publish-event-mark"
    >
      <Button
        type="button"
        size="sm"
        variant={marked ? 'outline' : 'secondary'}
        disabled={!canMark || pending || eventsQuery.isLoading}
        className="max-w-full shrink whitespace-normal text-left"
        data-testid="publish-event-mark-button"
        data-marked={marked ? 'true' : 'false'}
        onClick={() => {
          setStatus('idle');
          setMessage(null);
          if (marked && matched) {
            if (matched.source !== 'manual') {
              setStatus('error');
              setMessage('自动发现的事件不能从此处取消');
              return;
            }
            mutations.remove.mutate(matched.id, {
              onSuccess: () => {
                setStatus('removed');
                setMessage('已取消标记');
              },
              onError: (error) => {
                setStatus('error');
                setMessage(error instanceof Error ? error.message : '取消失败');
              },
            });
            return;
          }
          if (!publishedAt) {
            setStatus('error');
            setMessage('缺少发布时间，无法标记');
            return;
          }
          mutations.create.mutate(
            {
              eventKind,
              externalId,
              publishedAt,
              ...(title?.trim() ? { title: title.trim() } : {}),
            },
            {
              onSuccess: (result) => {
                setStatus(result.created ? 'created' : 'exists');
                setMessage(result.created ? '已在粉丝图上标记' : '标记已存在');
              },
              onError: (error) => {
                setStatus('error');
                setMessage(error instanceof Error ? error.message : '标记失败');
              },
            },
          );
        }}
      >
        {marked ? '取消标记' : '在粉丝图上标记'}
      </Button>
      {!publishedAt ? (
        <p className="text-xs text-muted-foreground">缺少发布时间，暂不可标记</p>
      ) : null}
      {message ? (
        <p
          role={status === 'error' ? 'alert' : 'status'}
          className={cn(
            'break-words text-xs',
            status === 'error' ? 'text-destructive' : 'text-muted-foreground',
          )}
          data-testid="publish-event-mark-result"
          data-status={status}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}
