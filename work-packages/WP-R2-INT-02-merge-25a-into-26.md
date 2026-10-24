# WP-R2-INT-02 — 把 25A 合入 26 线

## 做了什么

- 在 `cursor/wp-r2-26a-manual-publish-event-406f` 上 merge `cursor/wp-r2-25a-bili-accounts-48e2`。
- 迁移冲突：25A 的 `019_account_revoked_at` 重编号为 `022_account_revoked_at`（26 线已占用 019–021）。
- 路由/契约/覆盖：accounts CRUD + verify 与 26A/B/C/D（手动发布事件、投稿同步、发现跳过）一并保留；`api-inventory` 合并后 81 条。

## 不做

- 不部署生产、不改采集频率、不接生产 B 站/微信。
