# 视频监控置顶与发布时间排序（WP-R2-MON-01）

## 数据

`videos.pinned_at timestamptz NULL`（迁移 `014_video_pinned_at`）。非空即置顶；取消置顶写回 `NULL`。

## 接口

| 方法    | 路径                                      | 说明                                                               |
| ------- | ----------------------------------------- | ------------------------------------------------------------------ |
| `PATCH` | `/api/v1/monitor/videos/:bvid/pin`        | body `{ pinned: boolean }`；成功返回 `{ bvid, pinned, pinnedAt }`  |
| `GET`   | `/api/v1/monitor/cards?type=video&sort=…` | `sort=published_desc\|published_asc`（默认 desc）；卡片含 `pinned` |

排序键（仅 video）：`(pinned_at IS NOT NULL) DESC, pubdate ASC|DESC NULLS LAST, external_id ASC`。creator 仍按 `sampled_at DESC NULLS LAST, external_id ASC`。

## UI

- 视频 tab 筛选栏：Select「最新发布 / 最早发布」，写入 URL `sort`，与分页/分类/关键词/监控状态/视图兼容。
- 分栏与网格封面右上角图钉（`aria-label` 置顶/取消置顶，`aria-pressed`）；不占「详情 + 主操作」两键。
- 失败提示并回滚图钉状态；成功后重新拉取列表。
