# WP-R2-19E 商单样例软删除（归档可恢复）

## 行为

- 复用 `commercial_projects.archived_at`（**不加迁移**）：`POST .../archive` 设置即软删除；`POST .../unarchive` 清空即恢复。幂等；不存在返回 404。
- 列表默认 `archived_at IS NULL`；`includeArchived=1` 时包含已归档，`total` 与分页一致。
- 详情始终可按 id 读取（含已归档）。归档不改工作流、节点、金额、来源绑定；不做级联删除。
- 前端「搜索与筛选」内「显示已归档」开关写入 URL（`includeArchived=1`），刷新保持；已归档卡片有徽标与单项目恢复入口；详情可归档/恢复。

## 非目标

- 不批量归档数据（由 Hermes 经接口执行）；不物理删除；不改 schemaVersion / 监控 / 飞书 / Cron。

## 验收

- `format` / `lint` / `typecheck` / `test` / `build`
- 列表默认排除、includeArchived 包含、archive/unarchive 幂等与 404；归档后节点/来源仍在；既有 19C 展示态不回归
