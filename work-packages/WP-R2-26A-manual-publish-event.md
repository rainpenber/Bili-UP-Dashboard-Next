# WP-R2-26A：动态监控收尾 + 手动发布事件标记

## 范围

- 迁移 `019_publish_event_manual_source`：`creator_publish_events.source` 允许 `manual`；去重键改为 `(mid, event_kind, external_id)`。
- `POST/DELETE /api/v1/monitor/creators/:mid/publish-events`：为历史内容（发现水印之前）打粉丝图标记；仅 `source=manual` 可删；写 `domain_audit_events`。
- 前端：动态/视频详情「在粉丝图上标记 / 取消标记」；粉丝图动态 tooltip 显示可读标题。
- 动态列表/详情标题：优先 `author_name` + 正文摘要，其次目标 label，最后才裸 id；列表展示作者、Asia/Shanghai 发布时间、赞/转/评与监控徽标。

## 不做

- 不回采 8 月历史样本；不改发现轮询 / 密集采集 / 限频；不部署生产。

## 验收要点

- 手动 POST `1241488471951933462` 后 GET `496445222` 事件列表含 `source=manual` 且 `monitored=true`。
- 创作者详情粉丝图 8/28 有标记，tooltip 含《抽PS5和GTA6啦!》。
- 重复 POST `created:false`；DELETE 后消失；再 DELETE 404；bilibili 源 DELETE 409。
- format / lint / typecheck / test / build 全绿；api-inventory / http-coverage 已更新。
