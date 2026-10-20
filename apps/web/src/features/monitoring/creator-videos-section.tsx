import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { coverAssetUrl, fetchCreatorVideos } from '@/api/monitor-client';
import { EmptyState, ErrorState, LoadingListSkeleton } from '@/components/states/async-states';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatUnknownMetric, formatViewCountDisplay } from '@/lib/format-compact-number';
import { formatFullLocalTime, formatShortTime } from '@/lib/format-time';

const FIRST_PAGE = 20;
const NEXT_PAGE = 100;

export function CreatorVideosSection({ mid }: { mid: string }) {
  const videosQuery = useInfiniteQuery({
    queryKey: ['monitor', 'creator-videos', mid] as const,
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      fetchCreatorVideos(mid, {
        limit: pageParam === 0 ? FIRST_PAGE : NEXT_PAGE,
        offset: pageParam,
      }),
    getNextPageParam: (lastPage, _pages, lastOffset) => {
      const next = lastOffset + lastPage.items.length;
      return next < lastPage.total ? next : undefined;
    },
    enabled: Boolean(mid),
  });

  const items = videosQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const total = videosQuery.data?.pages[0]?.total ?? 0;
  const showTotal = videosQuery.isSuccess && total > 0;

  let body;
  if (videosQuery.isPending) {
    body = <LoadingListSkeleton rows={2} />;
  } else if (videosQuery.isError && !videosQuery.data) {
    body = (
      <ErrorState
        title="无法加载视频列表"
        message={videosQuery.error instanceof Error ? videosQuery.error.message : '加载失败'}
        onRetry={() => void videosQuery.refetch()}
      />
    );
  } else if (items.length === 0) {
    body = (
      <EmptyState
        title="暂无视频"
        description="这个 UP 还没有未删除的视频。新采集或补齐 mid 之后会出现在这里。"
      />
    );
  } else {
    body = (
      <>
        <ul
          data-testid="creator-video-list"
          className="grid min-w-0 grid-cols-1 gap-3 min-[1440px]:grid-cols-2"
        >
          {items.map((item) => (
            <li key={item.bvid} className="min-w-0">
              <Link
                to={`/monitoring/videos/${encodeURIComponent(item.bvid)}`}
                data-testid="creator-video-card"
                className="block min-w-0 overflow-hidden rounded-lg border bg-background shadow-sm transition-colors hover:bg-muted/40"
              >
                <img
                  src={coverAssetUrl(item.coverAssetId)}
                  alt=""
                  className="aspect-video w-full max-w-full object-cover"
                />
                <div className="min-w-0 space-y-1 p-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <h3 className="line-clamp-2 min-w-0 flex-1 break-words text-sm font-medium">
                      {item.title ?? item.bvid}
                    </h3>
                    {item.archivedAt ? <Badge variant="warning">已归档</Badge> : null}
                  </div>
                  <p
                    className="truncate text-xs text-muted-foreground"
                    title={item.pubdate ? formatFullLocalTime(item.pubdate) : undefined}
                  >
                    {item.pubdate ? formatShortTime(item.pubdate) : '发布时间未记录'}
                  </p>
                  {item.latest ? (
                    <p className="truncate text-xs text-muted-foreground">
                      播放 {formatViewCountDisplay(item.latest.viewCount)}
                      <span className="px-1">·</span>
                      评论 {formatUnknownMetric(item.latest.commentCount)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">暂无样本</p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
        {videosQuery.hasNextPage ? (
          <div className="mt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => void videosQuery.fetchNextPage()}
              disabled={videosQuery.isFetchingNextPage}
            >
              {videosQuery.isFetchingNextPage ? '加载中' : '显示全部'}
            </Button>
          </div>
        ) : null}
        {videosQuery.isFetchNextPageError ? (
          <div className="mt-3">
            <ErrorState
              title="无法继续加载"
              message={videosQuery.error instanceof Error ? videosQuery.error.message : '加载失败'}
              onRetry={() => void videosQuery.fetchNextPage()}
            />
          </div>
        ) : null}
      </>
    );
  }

  return (
    <section
      data-testid="creator-videos"
      className="mt-6 min-w-0 max-w-full"
      aria-labelledby="creator-videos-heading"
    >
      <div className="mb-3 flex min-w-0 items-baseline justify-between gap-3">
        <h2 id="creator-videos-heading" className="text-base font-semibold">
          该 UP 的视频
        </h2>
        {showTotal ? (
          <p data-testid="creator-videos-total" className="shrink-0 text-sm text-muted-foreground">
            共 {total} 条
          </p>
        ) : null}
      </div>
      {body}
    </section>
  );
}
