import { Button } from '@/components/ui/button';
import {
  useCreatorUploadsSyncMutation,
  useCreatorUploadsSyncStatusQuery,
} from '@/api/hooks/use-monitor-queries';
import { formatFullLocalTime } from '@/lib/format-time';

/**
 * Lightweight status + manual sync above the follower chart.
 * Opening the page never syncs; only the button POSTs.
 */
export function CreatorUploadsSyncBar({ mid }: { mid: string }) {
  const statusQuery = useCreatorUploadsSyncStatusQuery(mid);
  const sync = useCreatorUploadsSyncMutation(mid);
  const status = sync.data ?? statusQuery.data;
  const pending = sync.isPending;
  const failed = sync.isError;
  const errorMessage = sync.error instanceof Error ? sync.error.message : '同步失败';

  let line = '投稿同步：尚未同步';
  if (pending) {
    line = '投稿同步中…';
  } else if (failed) {
    line = `投稿同步失败：${errorMessage}`;
  } else if (status) {
    const when = status.lastSyncedAt ? formatFullLocalTime(status.lastSyncedAt) : null;
    line = when
      ? `已同步 ${status.videoCount} 条投稿 · 上次 ${when}`
      : `已同步 ${status.videoCount} 条投稿`;
    if (status.lastError && !pending) {
      line = `${line} · 上次错误：${status.lastError}`;
    }
  }

  return (
    <div
      className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
      data-testid="creator-uploads-sync-bar"
    >
      <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={line}>
        {line}
      </p>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        data-testid="creator-uploads-sync-button"
        onClick={() => sync.mutate(true)}
      >
        {failed ? '重试同步' : '同步投稿'}
      </Button>
    </div>
  );
}
