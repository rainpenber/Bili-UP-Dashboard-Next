# 观众反应模拟（WP-R2-18）

浏览器本地工具：字幕解析 → CSV → Markdown 模板插值 → 复制给外部 AI 做发布前内部评估。

| 项   | 说明                                                 |
| ---- | ---------------------------------------------------- |
| 路由 | `/content`（侧栏「观众反应模拟」）                   |
| 逻辑 | `apps/web/src/features/audience-reaction/`           |
| 草稿 | `localStorage` 键 `studio:audience-reaction:v1:form` |
| 迁移 | 导入旧工具 `version:1` JSON；不读旧站跨源存储        |
| 边界 | 无后端上传、无 LLM/B 站 API、无自动发布              |
