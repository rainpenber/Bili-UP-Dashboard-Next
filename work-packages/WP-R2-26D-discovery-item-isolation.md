# WP-R2-26D — 发现任务单条失败不应拖垮整轮（only_fans/500 跳过）

## 问题

空间动态列表中若含充电/专属（only_fans）条目，`dynamic_detail` 可能返回业务码 500（`Cannot read property 'only_fans' of undefined`）。此前单条失败会使整轮发现失败，`last_success_at` 为空，普通动态也无法入库。

## 范围

- 列表解析逐条隔离：坏条目 / only_fans 记入 `skips`，不抛翻整页。
- 可选详情补全：仅对「已有水印且新于水印」的条目最多请求 1 次 `dynamic_detail`；`500` / `-352` / `only_fans` 记 skip；其余详情失败在列表已有 `id_str`+发布时间时降级用列表建事件。
- 标题回退：`title` → 正文前 40 字 → `动态 <id>`。
- 迁移 `021_discovery_item_skips`：`last_skipped_count`、`last_skips`（JSON，API 最多 20 条）。
- `GET .../discovery` 返回 `lastSkippedCount` / `lastSkips`；列表成功即更新 `lastSuccessAt`。
- 前端发现设置：`lastSkippedCount>0` 时提示「本轮跳过 N 条（多为充电/专属动态）」。
- 不改变采集频率与限频；详情失败不重试。

## 验收

- 单测：1 条 detail 失败 + 2 条正常 → 2 事件、`skipped=1`、`lastSuccessAt` 有值。
- format / lint / typecheck / test / build 全绿；更新 http-coverage 与 api-inventory 备注。
