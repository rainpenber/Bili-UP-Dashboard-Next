# WP-R2-19E 商单样例软删除（归档可恢复）

## 行为

- 复用 `commercial_projects.archived_at`（**不加迁移**）：`POST .../archive` 设置即软删除；`POST .../unarchive` 清空即恢复。幂等；不存在返回 404。
- 列表默认 `archived_at IS NULL`；`includeArchived=1` 时包含已归档，`total` 与分页一致。
- 详情始终可按 id 读取（含已归档）。归档不改工作流、节点、金额、来源绑定；不做级联删除。
- **今日看板**：所有模块（待办 / 临期 / 阻塞等）一律排除 `archived_at` 非空；不允许「仍显示但标归档」。
- **项目页**：主列表不含已归档；底部「已归档（N） ▷/▾」折叠区，展开态用 URL `includeArchived=1` 保持；展开后可恢复；空态「暂无已归档」。无筛选开关、无批量操作。

## 非目标

- 不批量归档数据（由 Hermes 经接口执行）；不物理删除；不改 schemaVersion / 监控 / 飞书 / Cron。

## 验收

- `format` / `lint` / `typecheck` / `test` / `build`
- 看板排除归档；折叠计数 / 展开 / 收起；归档→折叠区、恢复→主列表；includeArchived 刷新保持；19C 展示态不回归
