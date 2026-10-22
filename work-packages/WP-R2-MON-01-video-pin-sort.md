# WP-R2-MON-01：视频置顶 + 发布时间正/倒序

## 行为

视频监控列表（分栏与网格一致）支持：

1. **置顶**：封面右上角图钉按钮；`PATCH /api/v1/monitor/videos/:bvid/pin`，body `{ pinned: boolean }`；写 `videos.pinned_at`（置顶 `now()`，取消 `NULL`），幂等。
2. **按发布时间排序**：筛选栏「最新发布 / 最早发布」→ URL `sort=published_desc|published_asc`（默认 desc，默认值不写入 URL）。
3. **服务端全量排序**：`pinned_at IS NOT NULL DESC, pubdate ASC/DESC NULLS LAST, bvid ASC`；翻页不重复、不丢项。

卡片响应含 `pinned: boolean`。动态 / UP 主 tab 不显示排序控件与图钉；其列表排序不变。

## 非目标

不改采集、调度、监控启停；不补发布时间；不引入新依赖。

## 验收要点

- 迁移 `014_video_pinned_at` 可重放；非法 bvid 400；不存在 404。
- 置顶组在前、组内按所选方向、null pubdate 置后、稳定次级键、跨页一致。
- 图钉失败回滚图标并可读提示；两键（详情 + 主操作）不受影响。
