# 监控统一搜索（WP-R2-23A / WP-R2-24A）

## UI

- 视频 / UP 主 tab 顶部仅一个「搜索」输入；分类文本框与「标题 / ID」关键词框已合并。
- 输入本地即时更新，**300ms debounce** 后写入 URL `q` 并请求 `GET /cards`；**无建议 dropdown**。
- 可搜：标题、UP 主名称、分类（模糊）、BV / UID（精确）；清空输入恢复全量列表。
- 搜索框 `max-w-[360px]`、`h-9`（与同排 select 对齐）；筛选栏 `justify-start` 单行横向滚动，不换行。
- Escape / 清除按钮清空；Enter 立即提交；空结果展示「没有匹配的条目」。
- 「只看我的」为 shadcn `Switch`，开/关均可撤销。

## 接口

| 方法  | 路径                        | 说明                                                                                  |
| ----- | --------------------------- | ------------------------------------------------------------------------------------- |
| `GET` | `/api/v1/monitor/cards?q=…` | 唯一搜索入口；`q` 匹配 `external_id` / `title` / `target_label` / `category` / UP 名 / 精确 `mid` |

`category` 精确过滤保留向后兼容（URL）。LIKE 对 `%` / `_` / `\` 转义；参数化查询，无 SQL 拼接。

`/monitor/search-suggestions` 已移除，不再提供建议面板。
