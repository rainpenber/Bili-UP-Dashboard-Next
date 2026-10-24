# WP-R2-17B：监控页与项目发布接入计划开始时间（UI 入口）

## 目标

在已验收的 17R1 `startAt` 读写合同上，只做前端入口与展示：监控新增、详情／设置改期、项目发布面板「按此时间创建定时监控」。不改 DB、迁移、API 合同、调度、采集、频率或鉴权。

## Base

`cursor/scheduled-start-at-rw-85dd` @ `e1bb6e72e8aed76280977ee73684090eaa9d9732`（PR #46）。禁止 merge／cherry-pick 已关闭的 PR #44。

## 范围

1. **监控新增**（`monitor-add-dialog.tsx`）：video 可选 `datetime-local` 计划上线时间；空＝不带 `startAt`；有值＝本地偏移 ISO，经 contracts 解析后提交。
2. **详情／设置**：展开详情显示「计划开始」；设置对话框对未成功且非 running 的 video 提供改期；卡片正面不展示。
3. **发布面板**（`publish-panel.tsx`）：保留演示发布语义；新增真实监控创建（video + `startAt`）；幂等提示已存在；文案不暗示真投稿。

## 明确不做

后端／迁移／合同语义、17A2／17C、Compose／CI／鉴权、18492 部署、真实投稿、卡片正面字段、新依赖。
